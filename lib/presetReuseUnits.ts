// Named reuse units over arbitrary config key subsets
// (Layer 1 WP10 phase B: the generalisation of the fixed
// partial-apply groups in lib/presetPartial.ts).
//
// A reuse unit is a named, self-contained capture of the
// values of an arbitrary subset of config keys, taken from
// some source config. Applying a unit copies exactly those
// keys onto the current config — the same discipline as
// applyPartialConfig, but the key set is authored per unit
// instead of being one of the fixed PARTIAL_GROUPS. A fixed
// group selection can be frozen into a unit
// (createPresetReuseUnitFromGroups), so the generalisation
// is a strict superset of the fixed groups: nothing about
// presetPartial's behaviour changes.
//
// Units are plain lib values. Serialisation is a JSON
// payload ({ format, units }) a caller may keep wherever it
// keeps preset-shaped records; this module owns no storage
// key and registers no config key. Panel wiring is WP10
// phase C's scope.

import type { ParticleConfig } from '../types';
import { normalizeConfig } from './appStateConfig';
import { PARTIAL_GROUPS } from './presetPartial';

export const PRESET_REUSE_UNITS_FORMAT = 'preset-reuse-units-v1';
export const PRESET_REUSE_UNIT_MAX_KEYS = 1024;
export const PRESET_REUSE_UNITS_MAX_UNITS = 256;
export const PRESET_REUSE_UNITS_MAX_CHARS = 4_000_000;

export interface PresetReuseUnit {
  id: string;
  name: string;
  createdAt: number;
  /** The config keys this unit speaks for (capture order,
   *  deduplicated). Applying the unit touches only these. */
  keys: string[];
  /** The captured value for each key in `keys`. */
  values: Record<string, unknown>;
}

const UNIT_KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

let presetReuseUnitCounter = 0;
export function createPresetReuseUnitId(): string {
  presetReuseUnitCounter += 1;
  return `reuse-${Date.now().toString(36)}-${presetReuseUnitCounter.toString(36)}`;
}

/**
 * Capture the values of `keys` from a source config into a
 * named unit. Keys missing from the source are skipped (a
 * unit can only speak for values that exist); duplicates
 * collapse, keeping first-mention order. Returns null when
 * nothing was captured — an empty unit would apply as a
 * silent no-op, which is exactly the failure mode this
 * grammar exists to avoid.
 */
export function createPresetReuseUnit(args: {
  name: string;
  source: Record<string, unknown>;
  keys: readonly string[];
  createdAt?: number;
  id?: string;
}): PresetReuseUnit | null {
  const values: Record<string, unknown> = {};
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of args.keys) {
    if (keys.length >= PRESET_REUSE_UNIT_MAX_KEYS) break;
    if (seen.has(key) || !UNIT_KEY_RE.test(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(args.source, key)) continue;
    seen.add(key);
    keys.push(key);
    values[key] = args.source[key];
  }
  if (keys.length === 0) return null;
  return {
    id: args.id ?? createPresetReuseUnitId(),
    name: args.name.trim().slice(0, 80) || 'Reuse Unit',
    createdAt: args.createdAt ?? Date.now(),
    keys,
    values,
  };
}

/**
 * Freeze a fixed partial-group selection into a named unit:
 * the keys are exactly the source keys the selected groups
 * match (the groupKeyCount discipline), so applying the
 * resulting unit reproduces applyPartialConfig for those
 * groups while remaining editable as an explicit key list.
 */
export function createPresetReuseUnitFromGroups(args: {
  name: string;
  source: Record<string, unknown>;
  groupIds: ReadonlySet<string>;
  createdAt?: number;
  id?: string;
}): PresetReuseUnit | null {
  const groups = PARTIAL_GROUPS.filter((g) => args.groupIds.has(g.id));
  if (groups.length === 0) return null;
  const keys = Object.keys(args.source).filter((key) => groups.some((g) => g.matches(key)));
  return createPresetReuseUnit({ ...args, keys });
}

/** Structural validation of an untrusted unit. Values are
 *  normalised to exactly the declared keys; anything
 *  malformed returns null (units drop individually, like
 *  designer block records). */
export function validatePresetReuseUnit(raw: unknown): PresetReuseUnit | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 96) return null;
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) return null;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  if (!Array.isArray(raw.keys) || raw.keys.length === 0) return null;
  if (raw.keys.length > PRESET_REUSE_UNIT_MAX_KEYS) return null;
  if (!isRecord(raw.values)) return null;
  const keys: string[] = [];
  const values: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const key of raw.keys) {
    if (typeof key !== 'string' || !UNIT_KEY_RE.test(key) || seen.has(key)) return null;
    if (!Object.prototype.hasOwnProperty.call(raw.values, key)) return null;
    seen.add(key);
    keys.push(key);
    values[key] = raw.values[key];
  }
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 80),
    createdAt: raw.createdAt,
    keys,
    values,
  };
}

/** Serialise a unit library (validated first; invalid units
 *  throw — the programmer-facing side, mirroring
 *  serializeDesignerBlockModel). */
export function serializePresetReuseUnits(units: readonly PresetReuseUnit[]): string {
  const validated: PresetReuseUnit[] = [];
  for (const unit of units) {
    const checked = validatePresetReuseUnit(unit);
    if (!checked) throw new Error(`preset reuse units: cannot serialise invalid unit (${unit?.id ?? '?'})`);
    validated.push(checked);
  }
  return JSON.stringify({ format: PRESET_REUSE_UNITS_FORMAT, units: validated });
}

/** Parse a serialised unit library; a broken payload reads
 *  as empty and broken units drop individually. Never throws. */
export function parsePresetReuseUnits(text: string | null | undefined): PresetReuseUnit[] {
  if (typeof text !== 'string' || text.length === 0 || text.length > PRESET_REUSE_UNITS_MAX_CHARS) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.format !== PRESET_REUSE_UNITS_FORMAT) return [];
  if (!Array.isArray(parsed.units)) return [];
  const units: PresetReuseUnit[] = [];
  const seen = new Set<string>();
  for (const item of parsed.units) {
    if (units.length >= PRESET_REUSE_UNITS_MAX_UNITS) break;
    const unit = validatePresetReuseUnit(item);
    if (!unit || seen.has(unit.id)) continue;
    seen.add(unit.id);
    units.push(unit);
  }
  return units;
}

/** True when the unit speaks for `key`. */
export function presetReuseUnitCovers(unit: PresetReuseUnit, key: string): boolean {
  return unit.keys.includes(key);
}

/**
 * Copy only the unit's keys, with the unit's captured
 * values, onto the current config — everything else stays
 * exactly as it is (the applyPartialConfig discipline).
 */
export function applyPresetReuseUnit(current: ParticleConfig, unit: PresetReuseUnit): ParticleConfig {
  const checked = validatePresetReuseUnit(unit);
  if (!checked) return normalizeConfig(current);
  const out: Record<string, unknown> = { ...(current as unknown as Record<string, unknown>) };
  for (const key of checked.keys) out[key] = checked.values[key];
  return normalizeConfig(out);
}

/** Apply several units in order; later units win on the
 *  keys they share with earlier ones. */
export function applyPresetReuseUnits(
  current: ParticleConfig,
  units: readonly PresetReuseUnit[],
): ParticleConfig {
  let out = current;
  for (const unit of units) out = applyPresetReuseUnit(out, unit);
  return out;
}
