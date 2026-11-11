import type { ParticleConfig } from '../types';
import type { BrushMode, BrushProfile, BrushSettings, BrushSourceProfile } from './sceneBrushSurfaceSystemTypes';

const DEFAULT_BRUSH_SOURCE_PROFILE: BrushSourceProfile = {
  spiralAmount: 0,
  advectAmount: 0,
  meltAmount: 0,
  evaporateAmount: 0,
  curlAmount: 0,
  fanAmount: 0,
  curtainAmount: 0,
  widthMul: 1,
  heightMul: 1,
  alphaMul: 1,
  trailShearAdd: 0,
  rotYAdd: 0,
  rotZAdd: 0,
};

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 91.173 + 17.137) * 43758.5453123);
}

export function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

const DEFAULT_BRUSH_PROFILE: BrushProfile = {
  groupRotX: 0.24,
  groupRotY: 0.28,
  groupRotZ: 0.18,
  jitterMul: 1,
  ribbonDrift: 1,
  smearDrift: 1,
  zStretch: 1,
  pulseMul: 1,
  widthBase: 0.6,
  widthMix: 0.6,
  heightBase: 0.48,
  heightMix: 0.42,
  squashBase: 0.8,
  squashOsc: 0.08,
  baseScale: 0.9,
  rotXMul: 1,
  rotYMul: 1,
  rotZMul: 1,
  trailShear: 0.18,
  edgeSoftness: 0.88,
  streakFreq: 120,
  tearFreq: 36,
  bandFreq: 24,
  bleedWarp: 0.14,
  veilCurve: 0.16,
  alphaMul: 1,
  additive: true,
  spiralAmount: 0,
  advectAmount: 0,
  meltAmount: 0,
  evaporateAmount: 0,
  curlAmount: 0,
  fanAmount: 0,
  curtainAmount: 0,
};

const BRUSH_PROFILES: Partial<Record<BrushMode, Partial<BrushProfile>>> = {
  brush_surface: {
    spiralAmount: 0.08,
    fanAmount: 0.12,
    widthBase: 0.66,
    widthMix: 0.72,
    heightBase: 0.52,
    heightMix: 0.44,
    trailShear: 0.24,
    edgeSoftness: 0.9,
    streakFreq: 118,
    tearFreq: 34,
    bandFreq: 26,
    bleedWarp: 0.18,
    alphaMul: 1.02,
  },
  ribbon_veil: {
    curlAmount: 0.24,
    curtainAmount: 0.62,
    jitterMul: 0.42,
    ribbonDrift: 1.9,
    smearDrift: 0.82,
    zStretch: 1.82,
    pulseMul: 1.18,
    widthBase: 0.94,
    widthMix: 1.1,
    heightBase: 0.18,
    heightMix: 0.2,
    squashBase: 0.42,
    squashOsc: 0.04,
    baseScale: 0.94,
    rotYMul: 1.9,
    rotZMul: 0.82,
    trailShear: 0.34,
    edgeSoftness: 0.96,
    streakFreq: 92,
    tearFreq: 20,
    bandFreq: 18,
    bleedWarp: 0.08,
    veilCurve: 0.54,
    alphaMul: 0.94,
    additive: true,
  },
  mist_ribbon: {
    evaporateAmount: 0.32,
    curlAmount: 0.18,
    curtainAmount: 0.86,
    jitterMul: 0.34,
    ribbonDrift: 2.16,
    smearDrift: 1.18,
    zStretch: 1.92,
    pulseMul: 0.88,
    widthBase: 1.12,
    widthMix: 1.24,
    heightBase: 0.12,
    heightMix: 0.15,
    squashBase: 0.4,
    squashOsc: 0.03,
    baseScale: 0.98,
    rotYMul: 1.54,
    rotZMul: 0.72,
    trailShear: 0.42,
    edgeSoftness: 1.08,
    streakFreq: 72,
    tearFreq: 12,
    bandFreq: 12,
    bleedWarp: 0.05,
    veilCurve: 0.76,
    alphaMul: 0.82,
    additive: true,
  },
  liquid_smear: {
    meltAmount: 0.38,
    advectAmount: 0.16,
    jitterMul: 0.74,
    ribbonDrift: 0.86,
    smearDrift: 1.46,
    zStretch: 0.92,
    pulseMul: 1.08,
    widthBase: 0.72,
    widthMix: 0.8,
    heightBase: 0.5,
    heightMix: 0.54,
    squashBase: 0.88,
    squashOsc: 0.1,
    baseScale: 0.84,
    rotXMul: 1.18,
    rotYMul: 0.88,
    rotZMul: 0.58,
    trailShear: 0.22,
    edgeSoftness: 0.86,
    streakFreq: 132,
    tearFreq: 42,
    bandFreq: 28,
    bleedWarp: 0.24,
    veilCurve: 0.1,
    alphaMul: 1.08,
    additive: false,
  },
  paint_daubs: {
    meltAmount: 0.16,
    fanAmount: 0.08,
    jitterMul: 0.92,
    ribbonDrift: 0.7,
    smearDrift: 0.82,
    zStretch: 0.72,
    pulseMul: 0.9,
    widthBase: 0.54,
    widthMix: 0.46,
    heightBase: 0.56,
    heightMix: 0.42,
    squashBase: 0.94,
    squashOsc: 0.06,
    baseScale: 0.74,
    rotXMul: 0.84,
    rotYMul: 0.68,
    rotZMul: 0.54,
    trailShear: 0.14,
    edgeSoftness: 0.8,
    streakFreq: 144,
    tearFreq: 48,
    bandFreq: 32,
    bleedWarp: 0.28,
    veilCurve: 0.06,
    alphaMul: 1.1,
    additive: false,
  },
};

export function getBrushProfile(mode: BrushMode): BrushProfile {
  return { ...DEFAULT_BRUSH_PROFILE, ...(BRUSH_PROFILES[mode] ?? {}) };
}

export function getSourceBrushProfile(source: ParticleConfig['layer2Source']): BrushSourceProfile {
  switch (source) {
    case 'text':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, fanAmount: 0.12, curlAmount: 0.08, curtainAmount: 0.08, widthMul: 0.92, alphaMul: 0.94, trailShearAdd: 0.1, rotZAdd: 0.08 };
    case 'image':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, curtainAmount: 0.12, fanAmount: 0.1, widthMul: 1.04, heightMul: 0.96, alphaMul: 0.98, trailShearAdd: 0.04 };
    case 'video':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, curtainAmount: 0.18, evaporateAmount: 0.1, curlAmount: 0.08, widthMul: 1.06, heightMul: 0.94, alphaMul: 0.96, rotYAdd: 0.06 };
    case 'ring':
    case 'disc':
    case 'torus':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, spiralAmount: 0.22, fanAmount: 0.18, curlAmount: 0.08, widthMul: 1.02, rotYAdd: 0.12 };
    case 'spiral':
    case 'galaxy':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, spiralAmount: 0.3, advectAmount: 0.12, curlAmount: 0.14, fanAmount: 0.08, rotYAdd: 0.16, rotZAdd: 0.06 };
    case 'grid':
    case 'plane':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, advectAmount: 0.18, fanAmount: 0.08, widthMul: 1.08, heightMul: 0.92, alphaMul: 0.96, trailShearAdd: 0.14 };
    case 'cube':
    case 'cylinder':
    case 'cone':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, meltAmount: 0.14, curtainAmount: 0.08, fanAmount: 0.12, heightMul: 1.04, trailShearAdd: 0.08, rotZAdd: 0.12 };
    case 'center':
    case 'random':
      return { ...DEFAULT_BRUSH_SOURCE_PROFILE, curtainAmount: 0.08, fanAmount: 0.1, widthMul: 0.98, heightMul: 1.02 };
    case 'sphere':
    default:
      return DEFAULT_BRUSH_SOURCE_PROFILE;
  }
}

export function withSourceAwareBrushProfile(profile: BrushProfile, source: ParticleConfig['layer2Source']): BrushProfile {
  const sourceProfile = getSourceBrushProfile(source);
  return {
    ...profile,
    spiralAmount: profile.spiralAmount + sourceProfile.spiralAmount,
    advectAmount: profile.advectAmount + sourceProfile.advectAmount,
    meltAmount: profile.meltAmount + sourceProfile.meltAmount,
    evaporateAmount: profile.evaporateAmount + sourceProfile.evaporateAmount,
    curlAmount: profile.curlAmount + sourceProfile.curlAmount,
    fanAmount: profile.fanAmount + sourceProfile.fanAmount,
    curtainAmount: profile.curtainAmount + sourceProfile.curtainAmount,
    widthBase: profile.widthBase * sourceProfile.widthMul,
    widthMix: profile.widthMix * sourceProfile.widthMul,
    heightBase: profile.heightBase * sourceProfile.heightMul,
    heightMix: profile.heightMix * sourceProfile.heightMul,
    alphaMul: profile.alphaMul * sourceProfile.alphaMul,
    trailShear: profile.trailShear + sourceProfile.trailShearAdd,
    groupRotY: profile.groupRotY + sourceProfile.rotYAdd,
    groupRotZ: profile.groupRotZ + sourceProfile.rotZAdd,
  };
}

export function getBrushMaterialStyleValue(materialStyle: BrushSettings['materialStyle']) {
  return materialStyle === 'glass' ? 1 : materialStyle === 'hologram' ? 2 : materialStyle === 'chrome' ? 3 : materialStyle === 'halftone' ? 4 : 0;
}
