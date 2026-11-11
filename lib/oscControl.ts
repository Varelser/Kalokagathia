import { MACRO_DEFINITIONS } from './macroControls';
import { PARAMETER_CATALOG } from './parameterCatalog';
import type { MidiTarget } from './midiControl';

/**
 * OSC control (roadmap Phase 8 remainder).
 *
 * Browsers cannot speak OSC directly (it rides on UDP), so the app
 * talks JSON over a WebSocket to a tiny local bridge
 * (tools/osc-bridge/osc-bridge.mjs, a dependency-free Node script)
 * which relays OSC <-> WebSocket. The mapping model deliberately
 * mirrors MIDI control: an OSC address is learned and bound to one
 * of the 8 macro knobs or any catalogued numeric parameter, and the
 * assignments persist in localStorage — a property of the user's
 * controller setup, not of any preset or project file.
 *
 * Value convention: the first numeric argument is the control
 * value. Values inside [0, 1] are used as the ratio directly;
 * larger values are treated as a 0..127 controller scale (the
 * TouchOSC / MIDI-style convention), then clamped to [0, 1].
 */

export type OscTarget = MidiTarget;

export interface OscAssignment {
  address: string;
  target: OscTarget;
}

const STORAGE_KEY = 'kalokagathia.oscAssignments.v1';

export const DEFAULT_OSC_BRIDGE_URL = 'ws://127.0.0.1:8765';

export function oscValueToRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const ratio = value <= 1 ? value : value / 127;
  return Math.min(1, Math.max(0, ratio));
}

export function scaleOscValue(ratio: number, min: number, max: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return min + clamped * (max - min);
}

export function resolveOscAssignment(
  assignments: OscAssignment[],
  address: string,
): OscAssignment | undefined {
  return assignments.find((assignment) => assignment.address === address);
}

export function describeOscTarget(target: OscTarget): string {
  if (target.kind === 'macro') {
    const definition = MACRO_DEFINITIONS.find((macro) => macro.id === target.id);
    return definition ? `マクロ：${definition.label}` : `マクロ：${target.id}`;
  }
  const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === target.key);
  return entry ? `${entry.label}（${entry.key}）` : String(target.key);
}

export function isValidOscAddress(address: unknown): address is string {
  return typeof address === 'string' && address.length > 1 && address.startsWith('/') && !/\s/.test(address);
}

function isValidTarget(value: unknown): value is OscTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as OscTarget;
  if (target.kind === 'macro') {
    return MACRO_DEFINITIONS.some((macro) => macro.id === (target as { id: string }).id);
  }
  if (target.kind === 'param') {
    return PARAMETER_CATALOG.some((entry) => entry.key === (target as { key: string }).key);
  }
  return false;
}

export function loadOscAssignments(storage: Pick<Storage, 'getItem'> | undefined): OscAssignment[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OscAssignment => {
      if (!entry || typeof entry !== 'object') return false;
      const assignment = entry as OscAssignment;
      return isValidOscAddress(assignment.address) && isValidTarget(assignment.target);
    });
  } catch {
    return [];
  }
}

export function saveOscAssignments(storage: Pick<Storage, 'setItem'>, assignments: OscAssignment[]): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(assignments));
  } catch {
    // Storage full/blocked: assignments simply won't persist.
  }
}

