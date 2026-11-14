/**
 * Noise link receiver (Phase 6.7).
 *
 * Cross-tab integration with the user's Noise app. Both apps are
 * served from the same origin, so Noise broadcasts its playback
 * state on a BroadcastChannel and this module keeps the latest copy:
 *
 *   channel: 'varelser-link-v1'
 *   message: {app:'noise', type:'state', ts:<ms epoch>,
 *             master:<0..1>,
 *             layers:[{type:<string>, gain:<0..1>, on:<bool>} x up to 3],
 *             binauralHz:<number|null>, playing:<bool>}
 *
 * The sender broadcasts ~5 Hz while its link toggle is enabled. A
 * state older than 1 s (tab closed, sender disabled, machine slept)
 * or one with playing=false counts as silence — every normalised
 * value drops to 0 — so a dead Noise tab can never leave a parameter
 * stuck mid-air. The values are exposed as modulation sources next
 * to the audio bands (see lib/modulation.ts).
 *
 * This module is the receiving half only; Noise implements the
 * sender against the exact protocol above.
 */

export const NOISE_LINK_CHANNEL_NAME = 'varelser-link-v1';

/** A state older than this is treated as "no sender". */
export const NOISE_LINK_STALE_MS = 1000;
/** Binaural beat frequencies map onto 0..1 over this range. */
export const NOISE_BINAURAL_MAX_HZ = 20;

export type NoiseSourceId = 'master' | 'layer1' | 'layer2' | 'layer3' | 'binaural';

export const NOISE_SOURCE_IDS: NoiseSourceId[] = ['master', 'layer1', 'layer2', 'layer3', 'binaural'];

export const NOISE_SOURCE_OPTIONS: { value: NoiseSourceId; label: string }[] = [
  { value: 'master', label: 'Noise · 全体 Master' },
  { value: 'layer1', label: 'Noise · レイヤー1 Layer 1' },
  { value: 'layer2', label: 'Noise · レイヤー2 Layer 2' },
  { value: 'layer3', label: 'Noise · レイヤー3 Layer 3' },
  { value: 'binaural', label: 'Noise · バイノーラル Binaural' },
];

export interface NoiseLayerState {
  type: string;
  gain: number;
  on: boolean;
}

export interface NoiseLinkState {
  master: number;
  layers: NoiseLayerState[];
  binauralHz: number | null;
  playing: boolean;
  /** Sender timestamp (ms epoch) from the message itself. */
  ts: number;
}

export type NoiseLinkValues = Record<NoiseSourceId, number>;

export const ZERO_NOISE_VALUES: NoiseLinkValues = {
  master: 0,
  layer1: 0,
  layer2: 0,
  layer3: 0,
  binaural: 0,
};

function clamp01(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/**
 * Validate one raw BroadcastChannel payload against the protocol.
 * Returns null for anything that is not a Noise state message, so
 * other apps on the same channel can never disturb the receiver.
 */
export function parseNoiseLinkMessage(value: unknown): NoiseLinkState | null {
  if (!value || typeof value !== 'object') return null;
  const msg = value as Record<string, unknown>;
  if (msg.app !== 'noise' || msg.type !== 'state') return null;
  const master = clamp01(msg.master);
  if (master === null) return null;
  const layers: NoiseLayerState[] = [];
  if (Array.isArray(msg.layers)) {
    for (const entry of msg.layers.slice(0, 3)) {
      if (!entry || typeof entry !== 'object') continue;
      const layer = entry as Record<string, unknown>;
      const gain = clamp01(layer.gain);
      layers.push({
        type: typeof layer.type === 'string' ? layer.type : '',
        gain: gain ?? 0,
        on: layer.on === true,
      });
    }
  }
  return {
    master,
    layers,
    binauralHz:
      typeof msg.binauralHz === 'number' && Number.isFinite(msg.binauralHz) ? msg.binauralHz : null,
    playing: msg.playing === true,
    ts: typeof msg.ts === 'number' && Number.isFinite(msg.ts) ? msg.ts : 0,
  };
}

/**
 * Normalise a received state into modulation values at time `nowMs`.
 * Stale state (older than NOISE_LINK_STALE_MS by arrival time) and
 * stopped senders are silence: all zeros.
 */
export function noiseValuesFromState(
  state: NoiseLinkState | null,
  receivedAtMs: number | null,
  nowMs: number,
): NoiseLinkValues {
  if (!state || receivedAtMs === null) return ZERO_NOISE_VALUES;
  if (nowMs - receivedAtMs > NOISE_LINK_STALE_MS) return ZERO_NOISE_VALUES;
  if (!state.playing) return ZERO_NOISE_VALUES;
  const layerGain = (index: number): number => {
    const layer = state.layers[index];
    return layer && layer.on ? layer.gain : 0;
  };
  return {
    master: state.master,
    layer1: layerGain(0),
    layer2: layerGain(1),
    layer3: layerGain(2),
    binaural:
      state.binauralHz === null
        ? 0
        : Math.min(1, Math.max(0, state.binauralHz / NOISE_BINAURAL_MAX_HZ)),
  };
}

export interface NoiseLinkStatus {
  /** A fresh (< 1 s old) state has been received at all. */
  receiving: boolean;
  /** The sender says it is playing (only meaningful when receiving). */
  playing: boolean;
  /** Normalised master level (0 when not receiving / not playing). */
  master: number;
}

interface BroadcastChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  close: () => void;
}

/**
 * Singleton receiver. The channel opens lazily on first use (first
 * value read or explicit start) so merely importing this module —
 * which lib/modulation.ts does — never opens anything.
 */
export class NoiseLinkReceiver {
  private channel: BroadcastChannelLike | null = null;
  private latest: NoiseLinkState | null = null;
  private receivedAtMs: number | null = null;

  start(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    try {
      const channel = new BroadcastChannel(NOISE_LINK_CHANNEL_NAME) as BroadcastChannelLike;
      channel.onmessage = (event) => {
        this.handleMessage(event.data, Date.now());
      };
      this.channel = channel;
    } catch {
      // BroadcastChannel unavailable (very old browser / worker):
      // the receiver simply stays silent forever.
      this.channel = null;
    }
  }

  stop(): void {
    if (this.channel) {
      this.channel.onmessage = null;
      try {
        this.channel.close();
      } catch {
        /* already gone */
      }
      this.channel = null;
    }
    this.latest = null;
    this.receivedAtMs = null;
  }

  /** Feed one raw payload (the channel listener calls this; tests too). */
  handleMessage(data: unknown, nowMs: number): boolean {
    const parsed = parseNoiseLinkMessage(data);
    if (!parsed) return false;
    this.latest = parsed;
    this.receivedAtMs = nowMs;
    return true;
  }

  getValues(nowMs: number): NoiseLinkValues {
    this.start();
    return noiseValuesFromState(this.latest, this.receivedAtMs, nowMs);
  }

  getStatus(nowMs: number): NoiseLinkStatus {
    this.start();
    const receiving =
      this.latest !== null &&
      this.receivedAtMs !== null &&
      nowMs - this.receivedAtMs <= NOISE_LINK_STALE_MS;
    const values = this.getValues(nowMs);
    return {
      receiving,
      playing: receiving && this.latest !== null ? this.latest.playing : false,
      master: values.master,
    };
  }
}

let sharedReceiver: NoiseLinkReceiver | null = null;

export function getNoiseLinkReceiver(): NoiseLinkReceiver {
  if (!sharedReceiver) sharedReceiver = new NoiseLinkReceiver();
  return sharedReceiver;
}

/** Current normalised Noise values for the modulation engine. */
export function getNoiseLinkValues(nowMs: number = Date.now()): NoiseLinkValues {
  return getNoiseLinkReceiver().getValues(nowMs);
}

/** Current link status for UI status lines. */
export function getNoiseLinkStatus(nowMs: number = Date.now()): NoiseLinkStatus {
  return getNoiseLinkReceiver().getStatus(nowMs);
}
