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
