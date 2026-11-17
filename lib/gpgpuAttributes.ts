import type { ParticleConfig } from '../types';
import { sampleAttrColumn, type AttrPointCloud } from './attrPointCloud';

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
  for (let i = 0; i < count; i++) {
    const px = posData[i * 4] ?? 0;
    const py = posData[i * 4 + 1] ?? 0;
    const pz = posData[i * 4 + 2] ?? 0;
    const radius = clamp01(Math.sqrt(px * px + py * py + pz * pz) / radiusDenom);
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
          value = sampleAttrColumn(cloud, names[slot], i);
          break;
      }
      out[i * ATTR_SLOT_COUNT + slot] = value;
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
  >,
): AttrConsumers {
  const sizeActive = normalizeAttrSlot(config.gpgpuAttrSizeSlot) >= 0 && (config.gpgpuAttrSizeAmount || 0) !== 0;
  const brightActive = normalizeAttrSlot(config.gpgpuAttrBrightSlot) >= 0 && (config.gpgpuAttrBrightAmount || 0) !== 0;
  const forceActive = normalizeAttrSlot(config.gpgpuAttrForceSlot) >= 0 && (config.gpgpuAttrForceAmount || 0) !== 0;
  const groupActive = !!config.gpgpuGroupEnabled;
  return {
    sizeActive,
    brightActive,
    forceActive,
    groupActive,
    anyActive: sizeActive || brightActive || forceActive || groupActive,
  };
}
