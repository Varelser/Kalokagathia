import type { ParticleConfig, SequenceTransitionEasing } from '../types';

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
