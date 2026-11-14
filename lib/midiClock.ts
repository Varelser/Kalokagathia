/**
 * MIDI Clock tracking (Phase 6.5).
 *
 * Pure logic for the MIDI real-time messages: Timing Clock (0xF8,
 * 24 PPQN), Start (0xFA), Continue (0xFB) and Stop (0xFC). The tracker
 * derives a smoothed BPM from the intervals between clock ticks and
 * reports when a musical division boundary (quarter note, bar, …) is
 * crossed, so the Play tab can drive sequence steps from an external
 * DAW / sequencer clock. No DOM or React in here — the Web MIDI wiring
 * lives in the Play tab component, same split as lib/midiControl.ts.
 *
 * Transport semantics follow the MIDI spec:
 * - Start:    position resets to 0 and the clock is running.
 * - Continue: running resumes from the current position.
 * - Stop:     running halts; position is kept.
 * Timing Clock bytes only count while running (devices that emit
 * clock while stopped must not advance anything).
 */

export const MIDI_CLOCK_TICKS_PER_QUARTER = 24;

export type MidiClockDivision = 'quarter' | 'half' | 'bar' | '2bars';

export const MIDI_CLOCK_DIVISIONS: { id: MidiClockDivision; label: string; ticks: number }[] = [
  { id: 'quarter', label: '4分音符', ticks: 24 },
  { id: 'half', label: '2分音符', ticks: 48 },
  { id: 'bar', label: '1小節 (4/4)', ticks: 96 },
  { id: '2bars', label: '2小節', ticks: 192 },
];

export function ticksForDivision(division: MidiClockDivision): number {
  return MIDI_CLOCK_DIVISIONS.find((entry) => entry.id === division)?.ticks ?? 24;
}

export function isValidMidiClockDivision(value: unknown): value is MidiClockDivision {
  return MIDI_CLOCK_DIVISIONS.some((entry) => entry.id === value);
}

export type MidiRealtimeKind = 'clock' | 'start' | 'continue' | 'stop' | null;

/** Classify a raw status byte; null for anything not clock-related. */
export function classifyMidiRealtime(status: number): MidiRealtimeKind {
  switch (status) {
    case 0xf8:
      return 'clock';
    case 0xfa:
      return 'start';
    case 0xfb:
      return 'continue';
    case 0xfc:
      return 'stop';
    default:
      return null;
  }
}

export interface MidiClockSnapshot {
  /** A Start/Continue has been seen and no Stop since. */
  running: boolean;
  /** Any clock byte has ever been received on this tracker. */
  hasClock: boolean;
  /** Smoothed tempo, or null until enough ticks have arrived. */
  bpm: number | null;
  /** Ticks since the last Start (position in the stream). */
  tickCount: number;
}

export type MidiClockEvent =
  | { type: 'start' }
  | { type: 'continue' }
  | { type: 'stop' }
  | { type: 'tick'; boundary: boolean };

/** Intervals further apart than this are treated as a resync (the
 *  sender paused), not as a very slow tempo. */
const RESYNC_GAP_MS = 500;
/** BPM is averaged over at most this many recent tick intervals. */
const MAX_INTERVALS = 48;

export class MidiClockTracker {
  private running = false;
  private hasClock = false;
  private tickCount = 0;
  private intervals: number[] = [];
  private lastTickAt: number | null = null;
  private divisionTicks: number;

  constructor(division: MidiClockDivision = 'quarter') {
    this.divisionTicks = ticksForDivision(division);
  }

  setDivision(division: MidiClockDivision): void {
    this.divisionTicks = ticksForDivision(division);
  }

  get snapshot(): MidiClockSnapshot {
    return {
      running: this.running,
      hasClock: this.hasClock,
      bpm: this.bpm,
      tickCount: this.tickCount,
    };
  }

  get bpm(): number | null {
    if (this.intervals.length === 0) return null;
    const average = this.intervals.reduce((sum, value) => sum + value, 0) / this.intervals.length;
    if (!(average > 0)) return null;
    // One quarter note = 24 ticks, so a beat lasts average * 24 ms.
    return 60000 / (average * MIDI_CLOCK_TICKS_PER_QUARTER);
  }

  /**
   * Feed one raw status byte with its arrival time (performance.now()
   * scale). Returns the semantic event, or null for unrelated bytes
   * and for clock ticks received while stopped.
   */
  feed(status: number, nowMs: number): MidiClockEvent | null {
    const kind = classifyMidiRealtime(status);
    if (kind === null) return null;
    this.hasClock = true;
    if (kind === 'start') {
      this.running = true;
      this.tickCount = 0;
      this.intervals = [];
      this.lastTickAt = null;
      return { type: 'start' };
    }
    if (kind === 'continue') {
      this.running = true;
      // The gap while stopped is not a tempo: drop the timing history
      // so the next ticks re-measure cleanly.
      this.intervals = [];
      this.lastTickAt = null;
      return { type: 'continue' };
    }
    if (kind === 'stop') {
      this.running = false;
      return { type: 'stop' };
    }
    // kind === 'clock'
    if (!this.running) return null;
    if (this.lastTickAt !== null) {
      const interval = nowMs - this.lastTickAt;
      if (interval > RESYNC_GAP_MS) {
        this.intervals = [];
      } else if (interval > 0) {
        this.intervals.push(interval);
        if (this.intervals.length > MAX_INTERVALS) {
          this.intervals.splice(0, this.intervals.length - MAX_INTERVALS);
        }
      }
    }
    this.lastTickAt = nowMs;
    this.tickCount += 1;
    const boundary = this.tickCount % this.divisionTicks === 0;
    return { type: 'tick', boundary };
  }
}

/** Which external source may drive sequence steps (Phase 6.6 adds
 *  Ableton Link next to the MIDI clock). 'off' = nothing drives. */
export type SequenceSyncSource = 'off' | 'midi-clock' | 'link';

export const SEQUENCE_SYNC_SOURCES: { id: SequenceSyncSource; label: string }[] = [
  { id: 'off', label: '同期しない' },
  { id: 'midi-clock', label: 'MIDI Clock' },
  { id: 'link', label: 'Ableton Link' },
];

export function isValidSequenceSyncSource(value: unknown): value is SequenceSyncSource {
  return SEQUENCE_SYNC_SOURCES.some((entry) => entry.id === value);
}

/** Sync preferences (source + division), persisted like the other
 *  MIDI setup: localStorage, outside presets and projects.
 *
 *  Phase 6.5 stored {enabled, division} under this same key. The
 *  migration is read-time only: a stored {enabled:true} with no
 *  `source` yet means source='midi-clock' (exactly the behaviour the
 *  user had switched on), and saves keep writing `enabled` as
 *  (source === 'midi-clock') so an older build reading the same key
 *  still sees a truthful value. */
export interface MidiClockSyncPrefs {
  /** Legacy mirror: true iff source === 'midi-clock'. */
  enabled: boolean;
  division: MidiClockDivision;
  source: SequenceSyncSource;
}

const SYNC_STORAGE_KEY = 'kalokagathia.midiClockSync.v1';

export const DEFAULT_MIDI_CLOCK_SYNC_PREFS: MidiClockSyncPrefs = {
  enabled: false,
  division: 'bar',
  source: 'off',
};

export function loadMidiClockSyncPrefs(
  storage: Pick<Storage, 'getItem'> | undefined,
): MidiClockSyncPrefs {
  if (!storage) return DEFAULT_MIDI_CLOCK_SYNC_PREFS;
  try {
    const raw = storage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return DEFAULT_MIDI_CLOCK_SYNC_PREFS;
    const parsed = JSON.parse(raw) as Partial<MidiClockSyncPrefs>;
    const source: SequenceSyncSource = isValidSequenceSyncSource(parsed.source)
      ? parsed.source
      : parsed.enabled === true
        ? 'midi-clock'
        : 'off';
    return {
      enabled: source === 'midi-clock',
      source,
      division: isValidMidiClockDivision(parsed.division)
        ? parsed.division
        : DEFAULT_MIDI_CLOCK_SYNC_PREFS.division,
    };
  } catch {
    return DEFAULT_MIDI_CLOCK_SYNC_PREFS;
  }
}

export function saveMidiClockSyncPrefs(
  storage: Pick<Storage, 'setItem'> | undefined,
  prefs: MidiClockSyncPrefs,
): void {
  if (!storage) return;
  try {
    storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage full/blocked: prefs simply won't persist
  }
}
