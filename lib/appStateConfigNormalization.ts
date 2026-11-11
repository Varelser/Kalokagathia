import type { ParticleConfig, SequenceDriveMode, SequenceDriveStrengthMode, SequenceTransitionEasing, SynthScale } from '../types';
import { DEFAULT_CONFIG } from './appStateConfigDefaults';

const CONFIG_ARRAY_KEYS = [
  'synthPattern',
  'layer1SourcePositions',
  'layer1Counts',
  'layer1Radii',
  'layer1Volumes',
  'layer1Jitters',
  'layer1Sizes',
  'layer1PulseSpeeds',
  'layer1PulseAmps',
  'layer2SourcePositions',
  'layer2Motions',
  'layer2MotionChain',
  'layer2MotionGraph',
  'layer2MotionDag',
  'layer2Counts',
  'layer2Sizes',
  'layer2RadiusScales',
  'layer2FlowSpeeds',
  'layer2FlowAmps',
  'layer2FlowFreqs',
  'layer3SourcePositions',
  'layer3Motions',
  'layer3MotionChain',
  'layer3MotionGraph',
  'layer3MotionDag',
  'layer3Counts',
  'layer3Sizes',
  'layer3RadiusScales',
  'layer3FlowSpeeds',
  'layer3FlowAmps',
  'layer3FlowFreqs',
] as const satisfies readonly (keyof ParticleConfig)[];

type ConfigArrayKey = typeof CONFIG_ARRAY_KEYS[number];

const DEFAULT_SYNTH_PATTERN = DEFAULT_CONFIG.synthPattern;

const SYNTH_SCALE_INTERVALS: Record<SynthScale, number[]> = {
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'natural-minor': [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const DEFAULT_SEQUENCE_EASING: SequenceTransitionEasing = 'ease-in-out';
export const DEFAULT_SEQUENCE_DRIVE_MODE: SequenceDriveMode = 'inherit';
export const DEFAULT_SEQUENCE_DRIVE_STRENGTH_MODE: SequenceDriveStrengthMode = 'inherit';
export const DEFAULT_SEQUENCE_DRIVE_MULTIPLIER = 1;

export function normalizeSynthPattern(candidate: unknown): number[] {
  if (!Array.isArray(candidate)) return [...DEFAULT_SYNTH_PATTERN];

  return Array.from({ length: DEFAULT_SYNTH_PATTERN.length }, (_, index) => {
    const value = candidate[index];
    return typeof value === 'number' ? Math.max(0, Math.min(15, Math.round(value))) : DEFAULT_SYNTH_PATTERN[index];
  });
}

export function resolveSynthSemitoneOffset(scale: SynthScale, degree: number) {
  const intervals = SYNTH_SCALE_INTERVALS[scale] ?? SYNTH_SCALE_INTERVALS['minor-pentatonic'];
  const octave = Math.floor(degree / intervals.length);
  const interval = intervals[degree % intervals.length] ?? 0;
  return interval + octave * 12;
}

export function normalizeParticleContrast<T extends Pick<ParticleConfig, 'particleColor' | 'backgroundColor'>>(config: T): T {
  if (config.particleColor !== config.backgroundColor) {
    return config;
  }

  return {
    ...config,
    backgroundColor: config.particleColor === 'black' ? 'white' : 'black',
  };
}

export function normalizeConfig(candidate: Partial<ParticleConfig> | null | undefined): ParticleConfig {
  const merged = { ...DEFAULT_CONFIG, ...(candidate ?? {}) } as ParticleConfig;
  const mergedArrayConfig = merged as unknown as Record<string, unknown>;
  const defaultArrayConfig = DEFAULT_CONFIG as ParticleConfig & Record<ConfigArrayKey, unknown[]>;
  for (const key of CONFIG_ARRAY_KEYS) {
    const value = mergedArrayConfig[key];
    mergedArrayConfig[key] = Array.isArray(value) ? [...value] : [...defaultArrayConfig[key]];
  }
  merged.synthPattern = normalizeSynthPattern(merged.synthPattern);
  return normalizeParticleContrast(merged);
}

export function normalizeSequenceTransitionEasing(value: unknown): SequenceTransitionEasing {
  return value === 'linear' || value === 'ease-in' || value === 'ease-out' || value === 'ease-in-out'
    ? value
    : DEFAULT_SEQUENCE_EASING;
}

export function normalizeSequenceDriveMode(value: unknown): SequenceDriveMode {
  return value === 'inherit' || value === 'on' || value === 'off'
    ? value
    : DEFAULT_SEQUENCE_DRIVE_MODE;
}

export function normalizeSequenceDriveStrengthMode(value: unknown): SequenceDriveStrengthMode {
  return value === 'inherit' || value === 'override'
    ? value
    : DEFAULT_SEQUENCE_DRIVE_STRENGTH_MODE;
}

export function normalizeSequenceDriveStrengthOverride(value: unknown) {
  return typeof value === 'number'
    ? Math.max(0, Math.min(1.5, value))
    : null;
}

export function normalizeSequenceDriveMultiplier(value: unknown) {
  return typeof value === 'number'
    ? Math.max(0, Math.min(2, value))
    : DEFAULT_SEQUENCE_DRIVE_MULTIPLIER;
}
