import type { ParticleConfig } from '../types';
import { normalizeConfig } from './appStateConfigNormalization';

/**
 * Preset breeding (roadmap Phase 7B).
 *
 * Generates offspring configs from two parent configs:
 * - numeric fields are interpolated (like the preset morph),
 * - enum/boolean/string fields are inherited per-field from either parent
 *   (uniform crossover),
 * - number arrays are interpolated element-wise when lengths match,
 * - media luma maps and other data payloads are never blended — they are
 *   inherited whole from one parent, because blending them produces noise
 *   that is unrelated to either parent's image.
 *
 * Everything is driven by a seedable RNG so a generation is reproducible,
 * and every child is passed through normalizeConfig before it is used.
 */

export type Rng = () => number;

/** Deterministic PRNG (mulberry32). */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fields whose values are data payloads, not expression parameters. */
const INHERIT_ONLY_KEYS = new Set<string>([
  'layer2MediaLumaMap',
  'layer3MediaLumaMap',
  'layer2SourcePositions',
  'layer3SourcePositions',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function crossoverValue(key: string, a: unknown, b: unknown, t: number, rng: Rng): unknown {
  if (typeof a === 'number' && typeof b === 'number') {
    return a + (b - a) * t;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (INHERIT_ONLY_KEYS.has(key)) {
      return rng() < 0.5 ? a : b;
    }
    if (a.length === b.length) {
      return a.map((item, index) => crossoverValue(key, item, b[index], t, rng));
    }
    return rng() < 0.5 ? a : b;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: Record<string, unknown> = {};
    keys.forEach((childKey) => {
      out[childKey] = crossoverValue(childKey, a[childKey], b[childKey], t, rng);
    });
    return out;
  }
  return rng() < 0.5 ? (a ?? b) : (b ?? a);
}

/** Blend two parent configs. `t` is the numeric interpolation position. */
export function breedConfigs(
  parentA: ParticleConfig,
  parentB: ParticleConfig,
  t: number,
  rng: Rng,
): ParticleConfig {
  const out: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(parentA), ...Object.keys(parentB)]);
  keys.forEach((key) => {
    out[key] = crossoverValue(
      key,
      (parentA as unknown as Record<string, unknown>)[key],
      (parentB as unknown as Record<string, unknown>)[key],
      t,
      rng,
    );
  });
  return normalizeConfig(out as Partial<ParticleConfig>);
}

/**
 * Perturb a fraction of the numeric fields of a config.
 * `amount` is a relative perturbation (0.1 = up to ±10%); probability is
 * the chance that any given numeric field is perturbed at all.
 */
export function mutateConfig(
  config: ParticleConfig,
  amount: number,
  probability: number,
  rng: Rng,
): ParticleConfig {
  if (amount <= 0) return normalizeConfig({ ...config });
  const out: Record<string, unknown> = { ...(config as unknown as Record<string, unknown>) };
  const perturb = (value: number): number => {
    if (rng() > probability) return value;
    return value * (1 + (rng() * 2 - 1) * amount);
  };
  Object.keys(out).forEach((key) => {
    if (INHERIT_ONLY_KEYS.has(key)) return;
    const value = out[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = perturb(value);
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      out[key] = value.map((item) => perturb(item as number));
    }
  });
  return normalizeConfig(out as Partial<ParticleConfig>);
}

export interface OffspringSpec {
  t: number;
  mutation: number;
}

export const DEFAULT_OFFSPRING_PLAN: OffspringSpec[] = [
  { t: 0.5, mutation: 0 },
  { t: 0.3, mutation: 0.08 },
  { t: 0.7, mutation: 0.08 },
  { t: 0.5, mutation: 0.18 },
  { t: 0.35, mutation: 0.3 },
  { t: 0.65, mutation: 0.45 },
];

export interface BredChild {
  name: string;
  config: ParticleConfig;
  spec: OffspringSpec;
}

/**
 * Generate a generation of children from two parents.
 * `mutationScale` (0..2) scales every planned mutation amount.
 */
export function generateOffspring(
  parentAName: string,
  parentA: ParticleConfig,
  parentBName: string,
  parentB: ParticleConfig,
  seed: number,
  mutationScale = 1,
): BredChild[] {
  const rng = createSeededRng(seed);
  return DEFAULT_OFFSPRING_PLAN.map((spec, index) => {
    const blended = breedConfigs(parentA, parentB, spec.t, rng);
    const config = mutateConfig(blended, spec.mutation * mutationScale, 0.35, rng);
    return {
      name: `${shortName(parentAName)} × ${shortName(parentBName)} ${index + 1}`,
      config,
      spec,
    };
  });
}

function shortName(name: string): string {
  const trimmed = name.replace(/^Frontier\s+/i, '').trim();
  return trimmed.length <= 18 ? trimmed : `${trimmed.slice(0, 17)}…`;
}
