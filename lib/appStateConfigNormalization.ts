import type { ParticleConfig, SequenceDriveMode, SequenceDriveStrengthMode, SequenceTransitionEasing, SynthScale } from '../types';
import { DEFAULT_CONFIG } from './appStateConfigDefaults';

const CONFIG_ARRAY_KEYS = [
  'gpgpuMaskMap',
  'gpgpuMaskBoolOperandMap',
  'gpgpuAgeCurveSizePoints',
  'gpgpuAgeCurveOpacityPoints',
  'gpgpuAgeCurveVelocityPoints',
  'gpgpuAgeCurveForcePoints',
  'gpgpuAgeCurveRotationPoints',
  'gpgpuAgeCurveSizeFreePoints',
  'gpgpuAgeCurveOpacityFreePoints',
  'gpgpuAgeCurveVelocityFreePoints',
  'gpgpuAgeCurveForceFreePoints',
  'gpgpuAgeCurveRotationFreePoints',
  'gpgpuFreeCurvePoints',
  'pointCacheRetimerSpeedCurvePoints',
  'gpgpuSmoothTubeSectionProfile',
  'gpgpuSmoothTubeWidthProfile',
  'gpgpuSmoothTubeHeightProfile',
  'gpgpuAttrNames',
  'gpgpuAttrSources',
  'gpgpuAttrExprs',
  'gpgpuAttrNames2',
  'gpgpuAttrSources2',
  'gpgpuAttrExprs2',
  'gpgpuAttrChainExprs',
  'gpgpuGradStopPositions',
  'gpgpuGradStopColors',
  'synthPattern',
  'layer1SourcePositions',
  'layer1SourceParents',
  'layer1Counts',
  'layer1Radii',
  'layer1Volumes',
  'layer1Jitters',
  'layer1Sizes',
  'layer1PulseSpeeds',
  'layer1PulseAmps',
  'layer2SourcePositions',
  'layer2SourceParents',
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
  'layer3SourceParents',
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

// ---------------------------------------------------------------------------
// Colour master switch (Layer 1 WP7 Phase A)
//
// Layer 0 decision: colour is an on/off feature and the
// default is OFF — with colour off, the draw must be
// completely identical to the legacy monochrome rendering.
// The colour features each carry their own opt-in key (all
// default off):
//
//   velocity colour   gpgpuVelColorEnabled
//   age colour        gpgpuAgeColorEnabled
//   gradient          gpgpuGradEnabled
//   attribute colour  gpgpuAttrColorEnabled
//   group colour      gpgpuGroupColorEnabled
//   cluster colour    gpgpuRigidClusterColorEnabled
//   aux inherit mix   gpgpuAuxInheritColor (> 0 is active)
//
// The master key gpgpuColorMasterEnabled sits in front of
// all of them HERE, in the config resolution layer — not
// inside the shader builders — so a resolved config with
// the master off is indistinguishable from a config that
// never opted into colour: every downstream predicate,
// resolver and uniform sync reads the feature keys off and
// the generated draw strings stay the stock ones
// byte-identically. The single-colour tints (gpgpuColor,
// gpgpuAuxColor, gpgpuAux2Color) are NOT colour features
// and are never touched by this resolution.

/** The colour-feature keys the master switch gates. */
export const COLOR_MASTER_FEATURE_KEYS = [
  'gpgpuVelColorEnabled',
  'gpgpuAgeColorEnabled',
  'gpgpuGradEnabled',
  'gpgpuAttrColorEnabled',
  'gpgpuGroupColorEnabled',
  'gpgpuRigidClusterColorEnabled',
  'gpgpuAuxInheritColor',
] as const satisfies readonly (keyof ParticleConfig)[];

export function colorMasterEnabled(
  config: Pick<ParticleConfig, 'gpgpuColorMasterEnabled'>,
): boolean {
  return config.gpgpuColorMasterEnabled === true;
}

/**
 * Resolve the colour master switch: master ON returns the
 * config untouched (every feature keeps its own key's
 * meaning, exactly as before this switch existed); master
 * OFF returns a config whose colour features are all off —
 * the feature booleans false and the aux inheritance colour
 * mix 0 — regardless of the individual keys' values. When
 * every feature is already off the input is returned as-is,
 * so the default configuration resolves to itself.
 */
export function resolveColorMaster(config: ParticleConfig): ParticleConfig {
  if (colorMasterEnabled(config)) return config;
  if (!config.gpgpuVelColorEnabled
    && !config.gpgpuAgeColorEnabled
    && !config.gpgpuGradEnabled
    && !config.gpgpuAttrColorEnabled
    && !config.gpgpuGroupColorEnabled
    && !config.gpgpuRigidClusterColorEnabled
    && !(config.gpgpuAuxInheritColor > 0)) {
    return config;
  }
  return {
    ...config,
    gpgpuVelColorEnabled: false,
    gpgpuAgeColorEnabled: false,
    gpgpuGradEnabled: false,
    gpgpuAttrColorEnabled: false,
    gpgpuGroupColorEnabled: false,
    gpgpuRigidClusterColorEnabled: false,
    gpgpuAuxInheritColor: 0,
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
  return normalizeParticleContrast(resolveColorMaster(merged));
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
