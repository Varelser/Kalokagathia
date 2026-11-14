import type { ParticleConfig } from '../types';
import { MACRO_DEFINITIONS } from './macroControls';
import { PARAMETER_CATALOG } from './parameterCatalog';

/**
 * MIDI control (roadmap Phase 8B).
 *
 * Maps MIDI Control Change messages onto the Play tab's own control
 * surfaces: the 8 macro knobs, or any numeric parameter in the catalog.
 * Assignments are learned (pick a target, press "learn", turn a knob on
 * the controller) and persisted in localStorage — they are a property
 * of the user's controller setup, not of any preset or project file, so
 * they deliberately live outside the config.
 *
 * This module holds the pure mapping/storage logic; the Web MIDI wiring
 * lives in the Play tab component.
 */

export type MidiTarget =
  | { kind: 'macro'; id: string }
  | { kind: 'param'; key: keyof ParticleConfig };

export interface MidiAssignment {
  /** 0-based MIDI channel, or null to accept any channel. */
  channel: number | null;
  cc: number;
  target: MidiTarget;
}

const STORAGE_KEY = 'kalokagathia.midiAssignments.v1';

export function scaleCcValue(value: number, min: number, max: number): number {
  const ratio = Math.min(127, Math.max(0, value)) / 127;
  return min + ratio * (max - min);
}

export function resolveAssignment(
  assignments: MidiAssignment[],
  channel: number,
  cc: number,
): MidiAssignment | undefined {
  return assignments.find(
    (assignment) => assignment.cc === cc && (assignment.channel === null || assignment.channel === channel),
  );
}

export function describeMidiTarget(target: MidiTarget): string {
  if (target.kind === 'macro') {
    const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
    return definition ? `マクロ：${definition.label}` : `マクロ：${target.id}`;
  }
  const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
  return entry ? `${entry.label}（${entry.key}）` : String(target.key);
}

function isValidTarget(value: unknown): value is MidiTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as MidiTarget;
  if (target.kind === 'macro') {
    return MACRO_DEFINITIONS.some((macro) => macro.id === (target as { id: string }).id);
  }
  if (target.kind === 'param') {
    return PARAMETER_CATALOG.some((entry) => entry.key === (target as { key: string }).key);
  }
  return false;
}

export function loadMidiAssignments(storage: Pick<Storage, 'getItem'> | undefined): MidiAssignment[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MidiAssignment => {
      if (!entry || typeof entry !== 'object') return false;
      const assignment = entry as MidiAssignment;
      return (
        typeof assignment.cc === 'number' &&
        assignment.cc >= 0 &&
        assignment.cc <= 127 &&
        (assignment.channel === null ||
          (typeof assignment.channel === 'number' && assignment.channel >= 0 && assignment.channel <= 15)) &&
        isValidTarget(assignment.target)
      );
    });
  } catch {
    return [];
  }
}

export function saveMidiAssignments(
  storage: Pick<Storage, 'setItem'> | undefined,
  assignments: MidiAssignment[],
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // storage full/blocked: assignments simply won't persist
  }
}

/**
 * Note assignments (Phase 6.5): Note On messages bound to transport /
 * navigation ACTIONS instead of continuous parameters. Stored under a
 * separate key from the CC assignments above — the CC storage shape is
 * untouched, so existing controller setups load exactly as before.
 * Like CC assignments these live in localStorage only (a property of
 * the user's controller setup, not of any preset or project file).
 */
export type MidiNoteAction =
  | 'preset-next'
  | 'preset-prev'
  | 'sequence-next'
  | 'sequence-play-stop'
  | 'randomize';

export const MIDI_NOTE_ACTIONS: { id: MidiNoteAction; label: string }[] = [
  { id: 'preset-next', label: '次のプリセット' },
  { id: 'preset-prev', label: '前のプリセット' },
  { id: 'sequence-next', label: 'シーケンスを1ステップ進める' },
  { id: 'sequence-play-stop', label: 'シーケンス再生 / 停止' },
  { id: 'randomize', label: 'ランダム化' },
];

export interface MidiNoteAssignment {
  /** 0-based MIDI channel, or null to accept any channel. */
  channel: number | null;
  note: number;
  action: MidiNoteAction;
}

const NOTE_STORAGE_KEY = 'kalokagathia.midiNoteAssignments.v1';

export function isValidMidiNoteAction(value: unknown): value is MidiNoteAction {
  return MIDI_NOTE_ACTIONS.some((entry) => entry.id === value);
}

export function describeMidiNoteAction(action: MidiNoteAction): string {
  return MIDI_NOTE_ACTIONS.find((entry) => entry.id === action)?.label ?? action;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Display name for a MIDI note number (60 = C4). */
export function describeMidiNote(note: number): string {
  const name = NOTE_NAMES[((note % 12) + 12) % 12];
  const octave = Math.floor(note / 12) - 1;
  return `${name}${octave}`;
}

export function resolveNoteAssignment(
  assignments: MidiNoteAssignment[],
  channel: number,
  note: number,
): MidiNoteAssignment | undefined {
  return assignments.find(
    (assignment) => assignment.note === note && (assignment.channel === null || assignment.channel === channel),
  );
}

export function loadMidiNoteAssignments(
  storage: Pick<Storage, 'getItem'> | undefined,
): MidiNoteAssignment[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(NOTE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MidiNoteAssignment => {
      if (!entry || typeof entry !== 'object') return false;
      const assignment = entry as MidiNoteAssignment;
      return (
        typeof assignment.note === 'number' &&
        assignment.note >= 0 &&
        assignment.note <= 127 &&
        (assignment.channel === null ||
          (typeof assignment.channel === 'number' && assignment.channel >= 0 && assignment.channel <= 15)) &&
        isValidMidiNoteAction(assignment.action)
      );
    });
  } catch {
    return [];
  }
}

export function saveMidiNoteAssignments(
  storage: Pick<Storage, 'setItem'> | undefined,
  assignments: MidiNoteAssignment[],
): void {
  if (!storage) return;
  try {
    storage.setItem(NOTE_STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // storage full/blocked: assignments simply won't persist
  }
}
