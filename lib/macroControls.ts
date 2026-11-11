import type { ParticleConfig } from '../types';

/**
 * Macro controls (Phase 6A of the expression roadmap).
 *
 * A macro is a perceptual, high-level knob defined as data: it maps a
 * normalized position (0..1) onto a set of existing ParticleConfig fields.
 * Applying a macro only writes those underlying fields through the normal
 * config update path, so presets, project files, and serialization are
 * completely unaffected — a macro position is always *derived* from the
 * current config (see getMacroValue), never stored.
 *
 * Each target range is a perceptual sub-range of the field's full slider
 * range, chosen so the whole macro sweep stays usable.
 */
export interface MacroTarget {
  key: keyof ParticleConfig;
  /** Value written when the macro position is 0. */
  from: number;
  /** Value written when the macro position is 1. */
  to: number;
  /** 'log' interpolates geometrically (for counts and scales). */
  scale?: 'linear' | 'log';
  /** Round the written value to this step (for count-like fields). */
  roundTo?: number;
}

export interface MacroDefinition {
  id: string;
  label: string;
  gloss: string;
  lowLabel: string;
  highLabel: string;
  targets: MacroTarget[];
}

export const MACRO_DEFINITIONS: MacroDefinition[] = [
  {
    id: 'density',
    label: 'Density',
    gloss: '密度',
    lowLabel: 'sparse',
    highLabel: 'dense',
    targets: [
      { key: 'layer2Count', from: 200, to: 20000, scale: 'log', roundTo: 50 },
      { key: 'layer3Count', from: 100, to: 12000, scale: 'log', roundTo: 50 },
      { key: 'gpgpuCount', from: 1024, to: 262144, scale: 'log', roundTo: 1024 },
    ],
  },
  {
    id: 'spread',
    label: 'Spread',
    gloss: '拡散 ⇄ 凝集',
    lowLabel: 'compact',
    highLabel: 'wide',
    targets: [
      { key: 'layer2RadiusScale', from: 0.3, to: 3 },
      { key: 'layer3RadiusScale', from: 0.3, to: 3 },
    ],
  },
  {
    id: 'chaos',
    label: 'Chaos',
    gloss: '秩序 ⇄ 混沌',
    lowLabel: 'ordered',
    highLabel: 'chaotic',
    targets: [
      { key: 'layer2Complexity', from: 0, to: 25 },
      { key: 'layer3Complexity', from: 0, to: 25 },
      { key: 'gpgpuTurbulence', from: 0, to: 1 },
    ],
  },
  {
    id: 'speed',
    label: 'Speed',
    gloss: '速さ',
    lowLabel: 'still',
    highLabel: 'fast',
    targets: [
      { key: 'layer2FlowSpeed', from: 0, to: 4 },
      { key: 'layer3FlowSpeed', from: 0, to: 4 },
      { key: 'gpgpuSpeed', from: 0.1, to: 3 },
      { key: 'rotationSpeedY', from: 0, to: 0.08 },
    ],
  },
  {
    id: 'weight',
    label: 'Weight',
    gloss: '重さ',
    lowLabel: 'buoyant',
    highLabel: 'heavy',
    targets: [
      { key: 'layer2Gravity', from: 0, to: -120 },
      { key: 'layer3Gravity', from: 0, to: -120 },
      { key: 'layer2Resistance', from: 0, to: 0.6 },
      { key: 'layer3Resistance', from: 0, to: 0.6 },
      { key: 'gpgpuGravity', from: 0, to: 1.5 },
    ],
  },
  {
    id: 'trails',
    label: 'Trails',
    gloss: '残像',
    lowLabel: 'crisp',
    highLabel: 'lingering',
    targets: [
      { key: 'screenPersistenceIntensity', from: 0, to: 0.95 },
      { key: 'layer2Trail', from: 0, to: 0.95 },
      { key: 'layer3Trail', from: 0, to: 0.95 },
    ],
  },
  {
    id: 'burst',
    label: 'Burst',
    gloss: '弾け',
    lowLabel: 'calm',
    highLabel: 'explosive',
    targets: [
      { key: 'layer2Burst', from: 0, to: 1.6 },
      { key: 'layer3Burst', from: 0, to: 1.6 },
      { key: 'screenBurstDrive', from: 0, to: 1.5 },
    ],
  },
  {
    id: 'glow',
    label: 'Glow',
    gloss: '光',
    lowLabel: 'matte',
    highLabel: 'radiant',
    targets: [
      { key: 'particleGlow', from: 0, to: 1.5 },
      { key: 'postBloomIntensity', from: 0, to: 3 },
      { key: 'opacity', from: 0.35, to: 1 },
    ],
  },
];

function interpolate(target: MacroTarget, position: number): number {
  const t = Math.min(1, Math.max(0, position));
  let value: number;
  if (target.scale === 'log' && target.from > 0 && target.to > 0) {
    value = Math.exp(Math.log(target.from) + (Math.log(target.to) - Math.log(target.from)) * t);
  } else {
    value = target.from + (target.to - target.from) * t;
  }
  if (target.roundTo) {
    value = Math.round(value / target.roundTo) * target.roundTo;
  }
  return value;
}

function invert(target: MacroTarget, raw: number): number {
  const { from, to } = target;
  if (to === from) return 0;
  if (target.scale === 'log' && from > 0 && to > 0) {
    if (raw <= 0) return 0;
    return (Math.log(raw) - Math.log(from)) / (Math.log(to) - Math.log(from));
  }
  return (raw - from) / (to - from);
}

/** Derive the macro's current position (0..1) from a config. */
export function getMacroValue(config: ParticleConfig, definition: MacroDefinition): number {
  if (definition.targets.length === 0) return 0;
  const sum = definition.targets.reduce((acc, target) => {
    const raw = config[target.key];
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? raw : target.from;
    return acc + Math.min(1, Math.max(0, invert(target, numeric)));
  }, 0);
  return sum / definition.targets.length;
}

/** Compute the concrete field updates for moving a macro to `position`. */
export function getMacroUpdates(
  definition: MacroDefinition,
  position: number,
): { key: keyof ParticleConfig; value: number }[] {
  return definition.targets.map((target) => ({
    key: target.key,
    value: interpolate(target, position),
  }));
}
