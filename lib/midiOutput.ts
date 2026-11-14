/**
 * MIDI output (Phase 6.7).
 *
 * The mirror of lib/midiControl.ts: until now the app only received
 * MIDI. This module sends three things back to a selected output
 * device, so a DAW or a motorised controller can follow the show:
 *
 *  (a) Macro CC echo — whenever one of the 8 macros moves, its
 *      position goes out as Control Change (base CC + macro index)
 *      on the configured channel. Sends are coalesced per macro
 *      (~30 ms) so a morph or a drag never floods the port.
 *  (b) Sequence step trigger — every time the sequence lands on a
 *      new item (internal playback, MIDI clock, Ableton Link, a
 *      note action or a manual click — they all share the item-load
 *      path, and the Play tab watches the active item id), a short
 *      Note On/Off pulse fires on the configured step note.
 *  (c) Preset Program Change — loading a preset sends Program
 *      Change with the preset's index in the current shelf order
 *      (mod 128), so a DAW track or a hardware patch bay can follow.
 *
 * Settings persist in localStorage like the other MIDI setup: they
 * describe the user's rig, not any preset or project. All byte
 * building and throttling is pure/testable here; the Play tab owns
 * the Web MIDI access object and hands the engine a port.
 */

export interface MidiOutputSettings {
  enabled: boolean;
  /** Selected MIDIOutput id, or null for "none chosen yet". */
  outputId: string | null;
  /** CC number for macro 0; macro i uses baseCc + i (must stay ≤ 120). */
  baseCc: number;
  /** Note number for the sequence step pulse. */
  stepNote: number;
  /** 0-based MIDI channel (0 = CH1). */
  channel: number;
}

const STORAGE_KEY = 'kalokagathia.midiOutput.v1';

export const DEFAULT_MIDI_OUTPUT_SETTINGS: MidiOutputSettings = {
  enabled: false,
  outputId: null,
  baseCc: 20,
  stepNote: 36,
  channel: 0,
};

export const MACRO_COUNT = 8;
/** Velocity of the sequence step pulse. */
export const STEP_NOTE_VELOCITY = 100;
/** How long the step pulse stays on, in ms. */
export const STEP_NOTE_DURATION_MS = 120;
/** Minimum interval between two CC sends for the same macro. */
export const MACRO_CC_THROTTLE_MS = 30;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function sanitizeMidiOutputSettings(value: unknown): MidiOutputSettings {
  if (!value || typeof value !== 'object') return DEFAULT_MIDI_OUTPUT_SETTINGS;
  const raw = value as Partial<MidiOutputSettings>;
  return {
    enabled: raw.enabled === true,
    outputId: typeof raw.outputId === 'string' && raw.outputId.length > 0 ? raw.outputId : null,
    // baseCc + 7 (the last macro) must stay a valid CC number.
    baseCc: clampInt(raw.baseCc, 0, 120, DEFAULT_MIDI_OUTPUT_SETTINGS.baseCc),
    stepNote: clampInt(raw.stepNote, 0, 127, DEFAULT_MIDI_OUTPUT_SETTINGS.stepNote),
    channel: clampInt(raw.channel, 0, 15, DEFAULT_MIDI_OUTPUT_SETTINGS.channel),
  };
}

export function loadMidiOutputSettings(
  storage: Pick<Storage, 'getItem'> | undefined,
): MidiOutputSettings {
  if (!storage) return DEFAULT_MIDI_OUTPUT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MIDI_OUTPUT_SETTINGS;
    return sanitizeMidiOutputSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_MIDI_OUTPUT_SETTINGS;
  }
}

export function saveMidiOutputSettings(
  storage: Pick<Storage, 'setItem'> | undefined,
  settings: MidiOutputSettings,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage full/blocked: settings simply won't persist
  }
}

/* ---------------- pure byte builders ---------------- */

function clamp7(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(127, Math.max(0, Math.round(value)));
}

function clampChannel(channel: number): number {
  if (!Number.isFinite(channel)) return 0;
  return Math.min(15, Math.max(0, Math.round(channel)));
}

/** Macro position 0..1 -> CC value 0..127. */
export function macroValueToCcValue(value01: number): number {
  if (!Number.isFinite(value01)) return 0;
  return Math.round(Math.min(1, Math.max(0, value01)) * 127);
}

export function buildControlChange(channel: number, cc: number, value: number): number[] {
  return [0xb0 | clampChannel(channel), clamp7(cc), clamp7(value)];
}

export function buildNoteOn(channel: number, note: number, velocity: number): number[] {
  return [0x90 | clampChannel(channel), clamp7(note), clamp7(velocity)];
}

export function buildNoteOff(channel: number, note: number): number[] {
  return [0x80 | clampChannel(channel), clamp7(note), 0];
}

/** Preset index in shelf order -> Program Change number (mod 128). */
export function programForPresetIndex(index: number): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.floor(index) % 128;
}

export function buildProgramChange(channel: number, program: number): number[] {
  return [0xc0 | clampChannel(channel), clamp7(program)];
}

/* ---------------- sending engine ---------------- */

/** The slice of MIDIOutput this module needs (structurally the real thing). */
export interface MidiOutputPortLike {
  id: string;
  name?: string | null;
  send: (data: number[]) => void;
}

/**
 * Stateful sender: holds the selected port + settings, throttles
 * macro CCs, and manages the step-note pulse (including cutting a
 * still-sounding pulse short when steps come faster than its length).
 * All times are caller-supplied (performance.now() scale) except the
 * note-off timer, which uses a real timer like any note gate.
 */
export class MidiOutputEngine {
  private settings: MidiOutputSettings = DEFAULT_MIDI_OUTPUT_SETTINGS;
  private port: MidiOutputPortLike | null = null;
  private lastCcValue: number[] = new Array<number>(MACRO_COUNT).fill(-1);
  private lastCcAt: number[] = new Array<number>(MACRO_COUNT).fill(0);
  private pendingCc: (number | null)[] = new Array<number | null>(MACRO_COUNT).fill(null);
  private stepNoteTimer: ReturnType<typeof setTimeout> | null = null;
  private soundingStepNote = false;

  get active(): boolean {
    return this.settings.enabled && this.port !== null;
  }

  setSettings(settings: MidiOutputSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    if (!settings.enabled) {
      this.pendingCc.fill(null);
      this.cutStepNote();
    } else if (!wasEnabled) {
      // Re-send current macro positions on the next poll.
      this.lastCcValue.fill(-1);
    }
  }

  setPort(port: MidiOutputPortLike | null): void {
    if (this.port?.id === port?.id) return;
    this.cutStepNote();
    this.port = port;
    // A new device knows nothing: re-sync on the next poll.
    this.lastCcValue.fill(-1);
    this.pendingCc.fill(null);
  }

  dispose(): void {
    this.cutStepNote();
    this.port = null;
  }

  /**
   * Offer the current position of one macro. Sends immediately when
   * the value changed and the throttle window has passed; otherwise
   * remembers the newest value for flushPending().
   */
  echoMacro(index: number, value01: number, nowMs: number): void {
    if (!this.active || index < 0 || index >= MACRO_COUNT) return;
    const value = macroValueToCcValue(value01);
    if (value === this.lastCcValue[index]) {
      this.pendingCc[index] = null;
      return;
    }
    if (this.lastCcValue[index] === -1 || nowMs - this.lastCcAt[index] >= MACRO_CC_THROTTLE_MS) {
      this.sendCc(index, value, nowMs);
    } else {
      this.pendingCc[index] = value;
    }
  }

  /** Send any coalesced macro values whose throttle window has passed. */
  flushPending(nowMs: number): void {
    if (!this.active) return;
    for (let index = 0; index < MACRO_COUNT; index++) {
      const value = this.pendingCc[index];
      if (value === null) continue;
      if (nowMs - this.lastCcAt[index] >= MACRO_CC_THROTTLE_MS) {
        this.sendCc(index, value, nowMs);
      }
    }
  }

  /** One sequence step landed: fire the step-note pulse. */
  triggerStepNote(): void {
    if (!this.active || !this.port) return;
    // Retriggering inside the previous pulse: close it first so the
    // receiver sees two distinct gates.
    this.cutStepNote();
    try {
      this.port.send(buildNoteOn(this.settings.channel, this.settings.stepNote, STEP_NOTE_VELOCITY));
    } catch {
      return;
    }
    this.soundingStepNote = true;
    this.stepNoteTimer = setTimeout(() => {
      this.stepNoteTimer = null;
      this.cutStepNote();
    }, STEP_NOTE_DURATION_MS);
  }

  /** A preset was loaded: Program Change by shelf index. */
  sendProgramChange(presetIndex: number): void {
    if (!this.active || !this.port || presetIndex < 0) return;
    try {
      this.port.send(buildProgramChange(this.settings.channel, programForPresetIndex(presetIndex)));
    } catch {
      /* a dead port surfaces via statechange; never throw into the UI */
    }
  }

  private sendCc(index: number, value: number, nowMs: number): void {
    if (!this.port) return;
    try {
      this.port.send(buildControlChange(this.settings.channel, this.settings.baseCc + index, value));
    } catch {
      return;
    }
    this.lastCcValue[index] = value;
    this.lastCcAt[index] = nowMs;
    this.pendingCc[index] = null;
  }

  private cutStepNote(): void {
    if (this.stepNoteTimer !== null) {
      clearTimeout(this.stepNoteTimer);
      this.stepNoteTimer = null;
    }
    if (this.soundingStepNote && this.port) {
      this.soundingStepNote = false;
      try {
        this.port.send(buildNoteOff(this.settings.channel, this.settings.stepNote));
      } catch {
        /* port gone mid-pulse */
      }
    }
    this.soundingStepNote = false;
  }
}
