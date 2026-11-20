import type { ParticleConfig } from '../types';
import { sampleAttrColumn, sampleAttrColumnRaw, type AttrPointCloud } from './attrPointCloud';
import {
  compileExpression,
  evaluateCompiledExpressionWithVars,
  EXPRESSION_MAX_LENGTH,
  type ExpressionCompileResult,
} from './expression';

/**
 * Named point attributes (Phase AK).
 *
 * The GPGPU pool's per-particle data used to be a fixed layout —
 * position (xyz + age) and velocity (xyz + phase) — plus the
 * Particle Life species derived from the texel index. This module
 * adds the missing general mechanism: FOUR named scalar attributes
 * per particle (one RGBA texture), generated deterministically at
 * spawn / bake time and carried through the pipeline —
 *
 *   generation  buildAttributeData (this module) bakes the values
 *               from the initial cloud, the morph bake and the
 *               registered attribute point cloud;
 *   transform   the velocity pass reads the texture (the force
 *               drive and the group gate below);
 *   render      the points readout reads the same texture (the
 *               size / brightness drives).
 *
 * The texture is a STATIC DataTexture (the initPosTex supply
 * pattern): the position / velocity layout is untouched, and the
 * runtime only builds the texture while at least one consumer is
 * active, so a config that never touches the attribute keys pays
 * nothing and renders bit-identically.
 *
 * Each slot has a NAME (config gpgpuAttrNames) and a SOURCE
 * (config gpgpuAttrSources). The name is functional, not just a
 * label: the 'data' source reads the point-cloud column whose
 * name matches the slot's name (case-insensitive).
 *
 * GLSL twins: the channel picker (kaloAttrChannel), the species
 * derivation (plSpecies in the velocity / points shaders — the
 * hash below is the same plHash) and the group membership test
 * live in components/gpgpuShaderSimulationVelocity.ts and
 * components/gpgpuShaderPoints.ts and must stay numerically
 * identical to the functions here; the unit tests pin both sides
 * by pinning these.
 */

export const ATTR_SLOT_COUNT = 4;

/**
 * Colour drive (Phase CL): when all three colour names are
 * assigned to slots (config gpgpuAttrNames) and the drive is
 * enabled (config gpgpuAttrColorEnabled), the draw pass tints
 * each point by the RAW values of those columns — the bake
 * writes them unnormalised (see buildAttributeData's
 * colorRawSlots). The slot assignment is the single source of
 * truth: if any of the three names is missing from the slots,
 * the drive resolves off entirely.
 */
export const ATTR_COLOR_SLOT_NAMES: readonly string[] = ['colorR', 'colorG', 'colorB'];

/** Slot indices of [colorR, colorG, colorB], or null when any
 *  of the three names is not assigned to a slot. */
export function resolveAttrColorSlots(names: readonly string[]): [number, number, number] | null {
  const normalized = normalizeAttrNames([...names]);
  const slots: number[] = [];
  for (const colorName of ATTR_COLOR_SLOT_NAMES) {
    const slot = normalized.findIndex((n) => n.trim().toLowerCase() === colorName.toLowerCase());
    if (slot < 0) return null;
    slots.push(slot);
  }
  return [slots[0], slots[1], slots[2]];
}

export type AttrSource =
  | 'hash'
  | 'index'
  | 'species'
  | 'radius'
  | 'height'
  | 'age'
  | 'target'
  | 'data';

export const ATTR_SOURCES: readonly AttrSource[] = [
  'hash',
  'index',
  'species',
  'radius',
  'height',
  'age',
  'target',
  'data',
];

export const ATTR_SOURCE_LABELS: Record<AttrSource, string> = {
  hash: 'Hash （決定的ハッシュ）',
  index: 'Index （粒子番号）',
  species: 'Species （種）',
  radius: 'Radius （初期半径）',
  height: 'Height （初期高さ）',
  age: 'Age （初期年齢）',
  target: 'Target （ベイク先の半径）',
  data: 'Data （点群の同名列）',
};

export const DEFAULT_ATTR_NAMES: readonly string[] = ['a', 'b', 'c', 'd'];
export const DEFAULT_ATTR_SOURCES: readonly AttrSource[] = ['hash', 'species', 'radius', 'height'];

/** Coerce arbitrary input into exactly 4 slot names. */
export function normalizeAttrNames(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const names: string[] = [];
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const value = raw[slot];
    const name = typeof value === 'string' ? value.trim().slice(0, 24) : '';
    names.push(name || DEFAULT_ATTR_NAMES[slot]);
  }
  return names;
}

/**
 * Coerce arbitrary input into exactly 4 bake-time expression
 * strings (Phase BI). Non-strings become '' (no arithmetic) and
 * each entry is capped at the expression language's length
 * limit; '' is the identity element — with all four empty the
 * bake never touches the expression code path at all.
 */
export function normalizeAttrExprs(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : [];
  const exprs: string[] = [];
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const value = raw[slot];
    exprs.push(typeof value === 'string' ? value.slice(0, EXPRESSION_MAX_LENGTH) : '');
  }
  return exprs;
}

/** Coerce arbitrary input into exactly 4 valid sources. */
export function normalizeAttrSources(input: unknown): AttrSource[] {
  const raw = Array.isArray(input) ? input : [];
  const sources: AttrSource[] = [];
  for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
    const value = raw[slot];
    sources.push(
      typeof value === 'string' && (ATTR_SOURCES as readonly string[]).includes(value)
        ? (value as AttrSource)
        : DEFAULT_ATTR_SOURCES[slot],
    );
  }
  return sources;
}

/** Clamp a slot selector: -1 (off) or 0..3. Non-finite → -1. */
export function normalizeAttrSlot(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return -1;
  const slot = Math.round(value);
  return slot >= 0 && slot < ATTR_SLOT_COUNT ? slot : -1;
}

/**
 * Resolve the stage-2 re-evaluation interval (Phase BO, config
 * gpgpuAttrDynInterval): whole frames, clamped to 1..240.
 * Non-finite / non-number input resolves to 1 (every frame).
 */
export function resolveAttrDynInterval(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(240, Math.round(value)));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The Particle Life hash (GLSL plHash in the velocity and points
 * shaders): fract(sin(idx * 127.1 + 311.7) * 43758.5453123). JS
 * doubles vs GLSL floats differ in the last bits, so this twin is
 * used for the 'hash' / 'species' attribute VALUES (where a 1-ulp
 * difference is invisible), never for cross-pass agreement — the
 * sim and the draw derive species inside GLSL on both sides.
 */
export function attrHash(index: number): number {
  const s = Math.sin(index * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** Species of a texel index, normalised to [0, 1] (plSpecies twin). */
export function attrSpeciesValue(index: number, speciesCount: number): number {
  const count = Math.max(2, Math.min(6, Math.round(speciesCount) || 4));
  const species = Math.min(Math.floor(attrHash(index + 17.17) * count), count - 1);
  return species / (count - 1);
}

export type AttrGroupMode = 'below' | 'above' | 'band';

/**
 * Group membership (Phase AK-2): 1 when the attribute value is in
 * the selected range, else 0; invert flips it. Boundaries are
 * inclusive on both sides — the GLSL twin composes the same test
 * from step() calls (step(av, high) is 1 exactly when av <= high).
 */
export function groupMembership(
  value: number,
  mode: AttrGroupMode,
  low: number,
  high: number,
  invert: boolean,
): number {
  let member: boolean;
  if (mode === 'below') member = value <= high;
  else if (mode === 'above') member = value >= low;
  else member = value >= low && value <= high;
  const m = member ? 1 : 0;
  return invert ? 1 - m : m;
}

export interface BuildAttributeDataArgs {
  texSize: number;
  /** Seeded initial positions (xyz + age), from buildGpgpuInitialData. */
  posData: Float32Array;
  ageMax: number;
  bounceRadius: number;
  /** Particle Life species count (for the 'species' source). */
  speciesCount: number;
  /** Morph bake cloud (xyz + alpha) or null (for 'target'). */
  morphData?: Float32Array | null;
  /** World-units multiplier of the morph bake (for 'target'). */
  morphWorldScale?: number;
  /** Registered attribute point cloud (for 'data'). */
  cloud?: AttrPointCloud | null;
  names: string[];
  sources: AttrSource[];
  /**
   * Bake-time arithmetic per slot (Phase BI, config
   * gpgpuAttrExprs). An empty string means no arithmetic for
   * that slot; when ALL slots are empty the bake runs the
   * legacy path verbatim (the expression code is never
   * entered), which is the structural identity guarantee.
   */
  exprs?: readonly string[];
  /**
   * Colour drive slots (Phase CL): slots whose 'data' values
   * are baked RAW (sampleAttrColumnRaw) instead of normalised,
   * and which skip the bake-time expression stage (expressions
   * clamp to [0, 1] and would falsify the colour; the slots'
   * raw values still serve as variables for the OTHER slots'
   * expressions). Null / absent = the legacy bake verbatim.
   */
  colorRawSlots?: readonly number[] | null;
}

/**
 * Bake the attribute texture data (RGBA per texel, values 0..1).
 * A pure function of its arguments — the same inputs reproduce the
 * same texture bit-for-bit, which is what the deterministic render
 * relies on.
 */
export function buildAttributeData(args: BuildAttributeDataArgs): Float32Array {
  const { texSize, posData, ageMax, bounceRadius, speciesCount } = args;
  const names = normalizeAttrNames(args.names);
  const sources = normalizeAttrSources(args.sources);
  const count = texSize * texSize;
  const out = new Float32Array(count * ATTR_SLOT_COUNT);
  const radiusDenom = Math.max(bounceRadius, 0.001);
  const ageDenom = Math.max(ageMax, 0.001);
  const morphData = args.morphData ?? null;
  const morphScale = Math.max(args.morphWorldScale ?? 0, 0.001);
  const cloud = args.cloud ?? null;
  const colorRaw = new Set(args.colorRawSlots ?? []);
  // Bake-time arithmetic (Phase BI): compile each non-empty
  // slot expression ONCE per bake, with the slot names
  // (lowercased — the tokenizer lowercases identifiers) as the
  // extra variables. When every expression is empty this whole
  // block is skipped and the per-particle loop below runs the
  // legacy path verbatim, so the default bake is bit-identical.
  const exprs = normalizeAttrExprs(args.exprs);
  const hasExprs = exprs.some((expr) => expr.trim().length > 0);
  const lowerNames = hasExprs ? names.map((name) => name.toLowerCase()) : [];
  const compiledExprs: (ExpressionCompileResult | null)[] = hasExprs
    ? exprs.map((expr) => (expr.trim().length > 0 ? compileExpression(expr, lowerNames) : null))
    : [];
  for (let i = 0; i < count; i++) {
    const px = posData[i * 4] ?? 0;
    const py = posData[i * 4 + 1] ?? 0;
    const pz = posData[i * 4 + 2] ?? 0;
    const radius = clamp01(Math.sqrt(px * px + py * py + pz * pz) / radiusDenom);
    const values: number[] = [0, 0, 0, 0];
    for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
      let value = 0;
      switch (sources[slot]) {
        case 'hash':
          value = attrHash(i);
          break;
        case 'index':
          value = count > 1 ? i / (count - 1) : 0;
          break;
        case 'species':
          value = attrSpeciesValue(i, speciesCount);
          break;
        case 'radius':
          value = radius;
          break;
        case 'height':
          value = clamp01(py / radiusDenom * 0.5 + 0.5);
          break;
        case 'age':
          value = clamp01((posData[i * 4 + 3] ?? 0) / ageDenom);
          break;
        case 'target': {
          if (morphData) {
            const tx = morphData[i * 4] ?? 0;
            const ty = morphData[i * 4 + 1] ?? 0;
            const tz = morphData[i * 4 + 2] ?? 0;
            value = clamp01(Math.sqrt(tx * tx + ty * ty + tz * tz) / morphScale);
          }
          break;
        }
        case 'data':
          value = colorRaw.has(slot)
            ? sampleAttrColumnRaw(cloud, names[slot], i)
            : sampleAttrColumn(cloud, names[slot], i);
          break;
      }
      values[slot] = value;
    }
    if (hasExprs) {
      // Slots are processed in order 0 → 3. The environment for
      // slot k is: x = slot k's own source value, t = 0, and
      // each slot name → that slot's CURRENT value (slots
      // already processed hold their arithmetic result, the
      // rest — including slot k itself — hold their source
      // value). Duplicate names (after lowercasing) resolve to
      // the FIRST matching slot. A failed compile or a
      // non-finite result leaves the slot at its source value
      // (the Phase AJ fallback discipline: never throw, never
      // inject NaN); finite results are clamped to [0, 1].
      for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
        const compiled = compiledExprs[slot];
        if (!compiled || !compiled.ok || colorRaw.has(slot)) continue;
        const sourceValue = values[slot];
        const vars: Record<string, number> = { x: sourceValue, t: 0 };
        for (let s = 0; s < ATTR_SLOT_COUNT; s++) {
          const key = lowerNames[s];
          if (!(key in vars)) vars[key] = values[s];
        }
        const result = evaluateCompiledExpressionWithVars(compiled.ast, vars);
        values[slot] = Number.isFinite(result) ? clamp01(result) : sourceValue;
      }
    }
    for (let slot = 0; slot < ATTR_SLOT_COUNT; slot++) {
      out[i * ATTR_SLOT_COUNT + slot] = values[slot];
    }
  }
  return out;
}

export interface AttrConsumers {
  /** Points readout: size driven by a slot (slot >= 0, amount != 0). */
  sizeActive: boolean;
  /** Points readout: brightness driven by a slot. */
  brightActive: boolean;
  /** Velocity pass: built-in force delta scaled by a slot. */
  forceActive: boolean;
  /** Velocity pass: group gate enabled (attribute texture needed). */
  groupActive: boolean;
  /** Points readout: colour drive enabled AND all three colour
   *  names assigned to slots (Phase CL). */
  colorActive: boolean;
  /** Position pass: named-group kill enabled AND a group
   *  referenced (Phase DG). Non-members respawn. */
  groupKillActive: boolean;
  /** Points readout: named-group colour gating enabled AND a
   *  group referenced AND the colour drive itself active
   *  (Phase DG). The attribute colour applies to members only. */
  groupColorActive: boolean;
  /** Any consumer at all — the attribute texture is built only then. */
  anyActive: boolean;
}

/**
 * Which consumers a config actually engages. A drive is active
 * only when its slot is selected AND its amount is non-zero, so
 * both the "off" states keep the passes on their legacy paths.
 */
export function resolveAttrConsumers(
  config: Pick<
    ParticleConfig,
    | 'gpgpuAttrSizeSlot'
    | 'gpgpuAttrSizeAmount'
    | 'gpgpuAttrBrightSlot'
    | 'gpgpuAttrBrightAmount'
    | 'gpgpuAttrForceSlot'
    | 'gpgpuAttrForceAmount'
    | 'gpgpuGroupEnabled'
    | 'gpgpuGroupRef'
    | 'gpgpuGroupKillEnabled'
    | 'gpgpuGroupColorEnabled'
    | 'gpgpuAttrColorEnabled'
    | 'gpgpuAttrNames'
  >,
): AttrConsumers {
  const sizeActive = normalizeAttrSlot(config.gpgpuAttrSizeSlot) >= 0 && (config.gpgpuAttrSizeAmount || 0) !== 0;
  const brightActive = normalizeAttrSlot(config.gpgpuAttrBrightSlot) >= 0 && (config.gpgpuAttrBrightAmount || 0) !== 0;
  const forceActive = normalizeAttrSlot(config.gpgpuAttrForceSlot) >= 0 && (config.gpgpuAttrForceAmount || 0) !== 0;
  // Phase CV: a named-group reference also activates the group
  // consumer (its membership is baked into a texture the gate
  // samples instead of the legacy predicate). An empty ref keeps
  // exactly the Phase AK behaviour.
  const groupActive = !!config.gpgpuGroupEnabled
    || (typeof config.gpgpuGroupRef === 'string' && config.gpgpuGroupRef.length > 0);
  const colorActive = !!config.gpgpuAttrColorEnabled
    && resolveAttrColorSlots(normalizeAttrNames(config.gpgpuAttrNames)) !== null;
  // Phase DG: the group kill / group colour consumers ride the
  // shared reference. Without a reference there is no group, so
  // both stay inactive and the passes keep their legacy paths.
  const hasGroupRef = typeof config.gpgpuGroupRef === 'string' && config.gpgpuGroupRef.length > 0;
  const groupKillActive = !!config.gpgpuGroupKillEnabled && hasGroupRef;
  const groupColorActive = !!config.gpgpuGroupColorEnabled && hasGroupRef && colorActive;
  return {
    sizeActive,
    brightActive,
    forceActive,
    groupActive,
    colorActive,
    groupKillActive,
    groupColorActive,
    anyActive: sizeActive || brightActive || forceActive || groupActive || colorActive,
  };
}
