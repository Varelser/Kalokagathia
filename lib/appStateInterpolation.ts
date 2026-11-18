import type { ParticleConfig, SequenceTransitionEasing } from '../types';
import { shapedKeyProgress, type PresetTransitionShape } from './transitionShape';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function interpolateValue(fromValue: unknown, toValue: unknown, progress: number): unknown {
  if (typeof fromValue === 'number' && typeof toValue === 'number') {
    return fromValue + (toValue - fromValue) * progress;
  }

  if (Array.isArray(fromValue) && Array.isArray(toValue)) {
    const maxLength = Math.max(fromValue.length, toValue.length);
    return Array.from({ length: maxLength }, (_, index) => interpolateValue(fromValue[index], toValue[index], progress));
  }

  if (isPlainObject(fromValue) && isPlainObject(toValue)) {
    const keys = new Set([...Object.keys(fromValue), ...Object.keys(toValue)]);
    return Array.from(keys).reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = interpolateValue(fromValue[key], toValue[key], progress);
      return acc;
    }, {});
  }

  return progress < 0.5 ? (fromValue ?? toValue) : (toValue ?? fromValue);
}

export function interpolateConfig(fromConfig: ParticleConfig, toConfig: ParticleConfig, progress: number): ParticleConfig {
  return interpolateValue(fromConfig, toConfig, progress) as ParticleConfig;
}

/**
 * Shaped preset morph (Phase AW, lib/transitionShape.ts): each
 * top-level key advances on its own shaped progress (its whole
 * subtree follows its window, so a key's value morphs as a
 * unit); the per-value interpolation itself is the legacy
 * interpolateValue verbatim. 'crossfade' delegates to
 * interpolateConfig, so the default morph is bit-identical.
 */
export function interpolateConfigShaped(
  fromConfig: ParticleConfig,
  toConfig: ParticleConfig,
  progress: number,
  shape: PresetTransitionShape,
): ParticleConfig {
  if (shape === 'crossfade') return interpolateConfig(fromConfig, toConfig, progress);
  const from = fromConfig as unknown as Record<string, unknown>;
  const to = toConfig as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    out[key] = interpolateValue(from[key], to[key], shapedKeyProgress(shape, key, progress));
  }
  return out as unknown as ParticleConfig;
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

export function applyTransitionEasing(progress: number, easing: SequenceTransitionEasing) {
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-in':
      return progress * progress * progress;
    case 'ease-out':
      return 1 - Math.pow(1 - progress, 3);
    case 'ease-in-out':
    default:
      return easeInOutCubic(progress);
  }
}
