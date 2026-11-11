import type { ParticleConfig } from '../types';

export type TemporalProfile = 'steady' | 'growth' | 'decay' | 'crystallize' | 'melt' | 'rupture' | 'oscillate' | 'accrete' | 'evaporate' | 'shed' | 'resonate' | 'condense' | 'ignite' | 'unravel' | 'accumulate' | 'exfoliate' | 'phase_shift' | 'inhale' | 'rewrite' | 'saturate' | 'delaminate' | 'anneal' | 'bifurcate' | 'recur' | 'percolate' | 'slump' | 'rebound' | 'fissure' | 'ossify' | 'intermittent' | 'hysteresis' | 'fatigue' | 'recover' | 'erupt' | 'latency' | 'emerge' | 'collapse' | 'regrow' | 'invert';

const PROCEDURAL_OPACITY_SUFFIXES = [
  'SheetOpacity',
  'BrushOpacity',
  'FiberOpacity',
  'GrowthOpacity',
  'DepositionOpacity',
  'CrystalOpacity',
  'CrystalDepositionOpacity',
  'ErosionTrailOpacity',
  'VoxelOpacity',
  'PatchOpacity',
  'HullOpacity',
  'ReactionOpacity',
  'FogOpacity',
  'GlyphOutlineOpacity',
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothPulse(time: number, speed: number) {
  return 0.5 + 0.5 * Math.sin(time * speed);
}

function steppedCrystal(time: number, speed: number) {
  const phase = (time * speed) % 1;
  if (phase < 0.2) return 0.15;
  if (phase < 0.45) return 0.38;
  if (phase < 0.72) return 0.62;
  return 0.92;
}

function getLayerValue(config: ParticleConfig, key: string) {
  return (config as unknown as Record<string, unknown>)[key];
}

function setLayerNumber(next: ParticleConfig, key: string, value: number) {
  (next as unknown as Record<string, unknown>)[key] = value;
}

function modulate(
  next: ParticleConfig,
  key: string,
  multiplier: number,
  options: { min?: number; max?: number; round?: boolean } = {},
) {
  const current = getLayerValue(next, key);
  if (typeof current !== 'number') return;
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const value = clamp(current * multiplier, min, max);
  setLayerNumber(next, key, options.round ? Math.round(value) : value);
}

function addNumber(
  next: ParticleConfig,
  key: string,
  amount: number,
  options: { min?: number; max?: number; round?: boolean } = {},
) {
  const current = getLayerValue(next, key);
  if (typeof current !== 'number') return;
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  const value = clamp(current + amount, min, max);
  setLayerNumber(next, key, options.round ? Math.round(value) : value);
}

function opacityBoostByProfile(profile: TemporalProfile, time: number, speed: number, strength: number) {
  const pulse = smoothPulse(time, speed * 1.35);
  const crystal = steppedCrystal(time, Math.max(0.15, speed));
  const rupture = Math.max(0, Math.sin(time * speed * 0.9));
  switch (profile) {
    case 'growth':
      return 0.96 + pulse * 0.22 * strength;
    case 'decay':
      return 0.95 - (0.08 + pulse * 0.2) * strength;
    case 'crystallize':
      return 0.96 + crystal * 0.24 * strength;
    case 'melt':
      return 0.92 + pulse * 0.12 * strength;
    case 'rupture':
      return 0.9 + rupture * 0.34 * strength;
    case 'oscillate':
      return 0.94 + pulse * 0.18 * strength;
    case 'accrete':
      return 0.98 + crystal * 0.2 * strength;
    case 'evaporate':
      return 0.9 - pulse * 0.16 * strength;
    case 'shed':
      return 0.88 + rupture * 0.18 * strength;
    case 'resonate':
      return 0.96 + pulse * 0.2 * strength;
    case 'condense':
      return 0.94 + crystal * 0.18 * strength;
    case 'ignite':
      return 0.9 + rupture * 0.3 * strength;
    case 'unravel':
      return 0.88 - pulse * 0.12 * strength;
    case 'accumulate':
      return 0.98 + crystal * 0.22 * strength;
    case 'exfoliate':
      return 0.84 + rupture * 0.16 * strength;
    case 'phase_shift':
      return 0.9 + (0.12 + pulse * 0.12) * strength;
    case 'inhale':
      return 0.92 + pulse * 0.2 * strength;
    case 'rewrite':
      return 0.9 + crystal * 0.14 * strength;
    case 'saturate':
      return 0.96 + crystal * 0.18 * strength;
    case 'delaminate':
      return 0.84 + rupture * 0.18 * strength;
    case 'anneal':
      return 0.92 + pulse * 0.1 * strength;
    case 'bifurcate':
      return 0.94 + pulse * 0.16 * strength;
    case 'recur':
      return 0.92 + (crystal * 0.1 + pulse * 0.08) * strength;
    case 'percolate':
      return 0.94 + (crystal * 0.08 + pulse * 0.06) * strength;
    case 'slump':
      return 0.86 + pulse * 0.12 * strength;
    case 'rebound':
      return 0.92 + pulse * 0.18 * strength;
    case 'fissure':
      return 0.88 + rupture * 0.16 * strength;
    case 'ossify':
      return 0.94 + crystal * 0.18 * strength;
    case 'intermittent':
      return 0.82 + Math.max(0, Math.sin(time * speed * 2.6)) * 0.28 * strength;
    case 'hysteresis':
      return 0.9 + (0.08 + pulse * 0.06) * strength;
    case 'fatigue':
      return 0.96 - (0.06 + pulse * 0.1) * strength;
    case 'recover':
      return 0.9 + pulse * 0.16 * strength;
    case 'erupt':
      return 0.86 + rupture * 0.32 * strength;
    case 'latency':
      return 0.78 + (1 - pulse) * 0.12 * strength;
    case 'emerge':
      return 0.84 + (0.12 + pulse * 0.18) * strength;
    case 'collapse':
      return 0.8 + rupture * 0.24 * strength;
    case 'regrow':
      return 0.88 + (crystal * 0.14 + pulse * 0.08) * strength;
    case 'invert':
      return 0.9 + Math.abs(Math.sin(time * speed * 1.6)) * 0.14 * strength;
    default:
      return 1;
  }
}

export { PROCEDURAL_OPACITY_SUFFIXES, clamp, smoothPulse, steppedCrystal, getLayerValue, setLayerNumber, modulate, addNumber, opacityBoostByProfile };
