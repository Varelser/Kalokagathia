import type { MidiClockDivision } from './midiClock';

/**
 * Ableton Link sync (Phase 6.6).
 *
 * Browsers cannot speak Ableton Link (a native UDP protocol), so —
 * exactly like OSC — the app talks JSON over a WebSocket to a tiny
 * local bridge (tools/link-bridge/link-bridge.mjs) which joins the
 * Link session on this machine and relays the session state:
 *
 *   bridge -> browser: {"type":"link-state","bpm":120,"beat":16.5,
 *                       "phase":0.5,"isPlaying":true,"numPeers":2}
 *   bridge -> browser: {"type":"link-unavailable","reason":"..."}
 *   browser -> bridge: {"type":"set-tempo","bpm":128}
 *                      {"type":"set-playing","isPlaying":true}
 *
 * This module holds the client, the latest-state store and the pure
 * division-boundary logic; the React wiring lives in the Play tab's
 * MIDI section, same split as lib/midiClock.ts / lib/oscControl.ts.
 */

export const DEFAULT_LINK_BRIDGE_URL = 'ws://127.0.0.1:8766';

/** Musical length of one sequence step, in Link beats, per division.
 *  Aligns with the MIDI clock model: quarter=24 ticks=1 beat,
 *  half=48=2, bar (4/4)=96=4, 2 bars=192=8. */
export function beatsForDivision(division: MidiClockDivision): number {
  switch (division) {
    case 'quarter':
      return 1;
    case 'half':
      return 2;
    case 'bar':
      return 4;
    case '2bars':
      return 8;
    default:
      return 4;
  }
}

/**
 * How many division boundaries lie between two beat positions.
 * Returns 0 when the timeline stands still or moves backwards
 * (a jump/reset re-bases instead of firing a burst of steps).
 */
export function countLinkDivisionCrossings(
  prevBeat: number,
  nextBeat: number,
  divisionBeats: number,
): number {
  if (!Number.isFinite(prevBeat) || !Number.isFinite(nextBeat) || !(divisionBeats > 0)) return 0;
  if (nextBeat <= prevBeat) return 0;
  const crossed =
    Math.floor(nextBeat / divisionBeats) - Math.floor(prevBeat / divisionBeats);
  return crossed > 0 ? crossed : 0;
}

/**
 * Stateful boundary tracker fed with the session's beat timeline.
 * Emits at most one step per feed: at bridge cadence (25–50 ms) and
 * musical divisions (>= 1 beat) a feed can never legitimately cross
 * more than one boundary, and a timeline jump should land one step,
 * not a burst. While the session is not playing, the tracker silently
 * re-bases so resuming never fires a catch-up step.
 */
export class LinkDivisionTracker {
  private divisionBeats: number;
  private lastBeat: number | null = null;

  constructor(division: MidiClockDivision = 'bar') {
    this.divisionBeats = beatsForDivision(division);
  }

  setDivision(division: MidiClockDivision): void {
    this.divisionBeats = beatsForDivision(division);
    this.lastBeat = null;
  }

  /** Returns true when one step should fire for this beat position. */
  feed(beat: number, isPlaying: boolean): boolean {
    if (!Number.isFinite(beat)) return false;
    if (!isPlaying) {
      this.lastBeat = beat;
      return false;
    }
    if (this.lastBeat === null) {
      this.lastBeat = beat;
      return false;
    }
    const crossed = countLinkDivisionCrossings(this.lastBeat, beat, this.divisionBeats);
    this.lastBeat = beat;
    return crossed > 0;
  }
}

export interface LinkBridgeState {
  /** WebSocket to the bridge is open. */
  connected: boolean;
  /** The bridge has a working Ableton Link session. */
  available: boolean;
  /** Why Link is unavailable (bridge's own explanation), if it is. */
  reason: string | null;
  bpm: number | null;
  /** Session beat timeline position (float beats). */
  beat: number | null;
  /** Phase within the quantum (bar), 0..<quantum. */
  phase: number | null;
  isPlaying: boolean;
  numPeers: number | null;
}

export const INITIAL_LINK_STATE: LinkBridgeState = {
  connected: false,
  available: false,
  reason: null,
  bpm: null,
  beat: null,
  phase: null,
  isPlaying: false,
  numPeers: null,
};

export interface LinkSyncCallbacks {
  /** One sequence step should fire now (division boundary crossed). */
  onStep?: () => void;
  /** Session transport flipped (false->true / true->false). */
  onPlayingChange?: (isPlaying: boolean) => void;
  /** Any state change (already throttled by the bridge's cadence). */
  onState?: (state: LinkBridgeState) => void;
}

const RECONNECT_MIN_MS = 750;
const RECONNECT_MAX_MS = 8000;

/**
 * WebSocket client for the Link bridge with automatic reconnect
 * (exponential backoff). All callbacks are replaceable via
 * `callbacks` so a React component can keep them in a ref without
 * reconnecting. If the bridge drops mid-play, stepping simply stops —
 * nothing here (or in the app) silently takes over with an internal
 * timer.
 */
export class LinkSyncClient {
  callbacks: LinkSyncCallbacks = {};

  private url: string;
  private socket: WebSocket | null = null;
  private tracker = new LinkDivisionTracker();
  private state: LinkBridgeState = INITIAL_LINK_STATE;
  private stopped = true;
  private reconnectTimer: number | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private lastPlaying = false;

  constructor(url: string = DEFAULT_LINK_BRIDGE_URL) {
    this.url = url;
  }

  get snapshot(): LinkBridgeState {
    return this.state;
  }

  setDivision(division: MidiClockDivision): void {
    this.tracker.setDivision(division);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* already gone */
      }
    }
    this.lastPlaying = false;
    this.setState({ ...INITIAL_LINK_STATE });
  }

  setTempo(bpm: number): void {
    if (Number.isFinite(bpm) && bpm > 0) {
      this.send({ type: 'set-tempo', bpm });
    }
  }

  setPlaying(isPlaying: boolean): void {
    this.send({ type: 'set-playing', isPlaying });
  }

  private send(payload: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify(payload));
      } catch {
        /* a dead socket surfaces via onclose/reconnect */
      }
    }
  }

  private setState(next: LinkBridgeState): void {
    this.state = next;
    this.callbacks.onState?.(next);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private openSocket(): void {
    if (this.stopped || typeof WebSocket === 'undefined') return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.setState({ ...this.state, connected: true });
    };
    socket.onmessage = (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      this.handleMessage(msg as Record<string, unknown>);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.lastPlaying = false;
      this.setState({ ...INITIAL_LINK_STATE });
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* onclose will follow */
      }
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.type === 'link-unavailable') {
      this.setState({
        ...this.state,
        connected: true,
        available: false,
        reason: typeof msg.reason === 'string' ? msg.reason : 'Link is unavailable in the bridge.',
        isPlaying: false,
      });
      return;
    }
    if (msg.type !== 'link-state') return;

    const num = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const isPlaying = msg.isPlaying === true;
    const beat = num(msg.beat);
    const next: LinkBridgeState = {
      connected: true,
      available: true,
      reason: null,
      bpm: num(msg.bpm),
      beat,
      phase: num(msg.phase),
      isPlaying,
      numPeers: num(msg.numPeers),
    };
    this.setState(next);

    if (isPlaying !== this.lastPlaying) {
      this.lastPlaying = isPlaying;
      this.callbacks.onPlayingChange?.(isPlaying);
    }
    if (beat !== null && this.tracker.feed(beat, isPlaying)) {
      this.callbacks.onStep?.();
    }
  }
}
