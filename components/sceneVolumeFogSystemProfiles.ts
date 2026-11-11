import type { FogMode, FogProfile } from './sceneVolumeFogSystemTypes';

const DEFAULT_FOG_PROFILE: FogProfile = {
  sliceMul: 1,
  opacityMul: 1,
  opacityAdd: 0,
  densityMul: 1,
  scaleMul: 1,
  driftMul: 1,
  driftAdd: 0,
  glowMul: 1,
  glowAdd: 0,
  anisotropyAdd: 0,
  planeScaleMul: 1,
  depthMul: 1,
  streak: 0.12,
  grain: 0.08,
  swirl: 0.12,
  verticalBias: 0,
  coreTightness: 0.2,
  pulseNoise: 0.16,
  ember: 0,
  plumeAmount: 0,
  fallAmount: 0,
  mirageAmount: 0,
  staticAmount: 0,
  dustAmount: 0,
  sootAmount: 0,
  runeAmount: 0,
  velvetAmount: 0,
  ledgerAmount: 0,
  edgeFade: 0.22,
  blending: 'additive',
};

const FOG_PROFILES: Partial<Record<FogMode, Partial<FogProfile>>> = {
  dust_plume: { sliceMul: 0.78, opacityMul: 0.86, densityMul: 1.3, scaleMul: 0.88, driftMul: 1.42, driftAdd: 0.08, glowMul: 0.62, anisotropyAdd: 0.32, planeScaleMul: 0.92, streak: 0.24, grain: 0.3, swirl: 0.1, verticalBias: 0.34, coreTightness: 0.42, pulseNoise: 0.12, plumeAmount: 0.86, dustAmount: 0.82, edgeFade: 0.36, blending: 'normal' },
  ashfall: { sliceMul: 0.68, opacityMul: 0.72, densityMul: 1.42, scaleMul: 0.92, driftMul: 0.74, driftAdd: -0.12, glowMul: 0.44, planeScaleMul: 0.9, streak: 0.3, grain: 0.58, swirl: 0.02, verticalBias: -0.86, coreTightness: 0.34, pulseNoise: 0.14, fallAmount: 0.94, dustAmount: 0.68, edgeFade: 0.28, blending: 'normal' },
  vapor_canopy: { sliceMul: 1.18, opacityMul: 0.86, densityMul: 1.08, scaleMul: 1.22, glowMul: 0.82, anisotropyAdd: 0.28, planeScaleMul: 1.16, depthMul: 1.18, streak: 0.06, grain: 0.1, swirl: 0.18, verticalBias: 0.82, coreTightness: 0.12, pulseNoise: 0.2 },
  ember_swarm: { sliceMul: 0.94, opacityMul: 0.84, densityMul: 0.92, driftMul: 1.28, driftAdd: 0.08, glowMul: 1.28, glowAdd: 0.1, planeScaleMul: 0.94, streak: 0.18, grain: 0.3, swirl: 0.28, verticalBias: 0.44, coreTightness: 0.24, pulseNoise: 0.28, ember: 0.48 },
  soot_veil: { sliceMul: 1.12, opacityMul: 0.46, densityMul: 1.5, scaleMul: 0.72, driftMul: 0.34, driftAdd: -0.12, glowMul: 0.32, glowAdd: 0.01, anisotropyAdd: 0.02, planeScaleMul: 0.88, streak: 0.12, grain: 0.74, swirl: 0.06, verticalBias: -0.08, coreTightness: 0.54, pulseNoise: 0.08, dustAmount: 0.26, sootAmount: 0.96, ledgerAmount: 0.74, edgeFade: 0.18, blending: 'normal' },
  foam_drift: { sliceMul: 1.18, opacityMul: 0.94, densityMul: 1.08, scaleMul: 1.34, driftMul: 1.76, driftAdd: 0.22, glowMul: 0.92, glowAdd: 0.08, anisotropyAdd: 0.58, planeScaleMul: 1.18, depthMul: 1.06, streak: 0.04, grain: 0.1, swirl: 0.34, verticalBias: 0.3, coreTightness: 0.08, pulseNoise: 0.22 },
  charge_veil: { sliceMul: 0.92, opacityMul: 0.76, densityMul: 1.16, scaleMul: 0.78, driftMul: 1.6, driftAdd: 0.24, glowMul: 1.52, glowAdd: 0.22, anisotropyAdd: 0.84, planeScaleMul: 0.96, streak: 0.92, grain: 0.18, swirl: 0.48, verticalBias: -0.22, coreTightness: 0.42, pulseNoise: 0.46 },
  prism_smoke: { sliceMul: 1.22, opacityMul: 0.9, densityMul: 1.3, scaleMul: 1.2, driftMul: 0.86, driftAdd: 0.02, glowMul: 1.34, glowAdd: 0.16, anisotropyAdd: 0.4, planeScaleMul: 1.08, depthMul: 1.08, streak: 0.2, grain: 0.08, swirl: 0.34, verticalBias: 0.08, coreTightness: 0.24, pulseNoise: 0.26 },
  rune_smoke: { sliceMul: 0.82, opacityMul: 0.66, densityMul: 1.42, scaleMul: 0.8, driftMul: 0.62, driftAdd: -0.04, glowMul: 0.84, glowAdd: 0.24, anisotropyAdd: 0.14, planeScaleMul: 0.94, streak: 0.28, grain: 0.42, swirl: 0.1, verticalBias: 0.02, coreTightness: 0.46, pulseNoise: 0.52, runeAmount: 0.94, ledgerAmount: 0.36, edgeFade: 0.2, blending: 'normal' },
  mirage_smoke: { sliceMul: 1.28, opacityMul: 0.56, densityMul: 0.78, scaleMul: 1.34, driftMul: 1.82, driftAdd: 0.24, glowMul: 0.7, glowAdd: 0.06, anisotropyAdd: 0.72, planeScaleMul: 1.26, depthMul: 1.24, streak: 0.06, grain: 0.04, swirl: 0.92, verticalBias: 0.22, coreTightness: 0.03, pulseNoise: 0.12, mirageAmount: 0.94, edgeFade: 0.18 },
  ion_rain: { sliceMul: 0.9, opacityMul: 0.72, opacityAdd: 0.04, densityMul: 1.18, scaleMul: 0.74, driftMul: 1.84, driftAdd: 0.3, glowMul: 1.46, glowAdd: 0.26, anisotropyAdd: 0.96, planeScaleMul: 0.98, depthMul: 1.08, streak: 1, grain: 0.18, swirl: 0.1, verticalBias: -1, coreTightness: 0.52, pulseNoise: 0.36 },
  velvet_ash: { sliceMul: 1.08, opacityMul: 0.98, opacityAdd: 0.04, densityMul: 1.42, scaleMul: 0.9, driftMul: 0.56, driftAdd: -0.02, glowMul: 0.38, anisotropyAdd: 0.12, planeScaleMul: 1.02, depthMul: 0.92, streak: 0.08, grain: 0.16, swirl: 0.08, verticalBias: -0.18, coreTightness: 0.8, pulseNoise: 0.08, sootAmount: 0.22, velvetAmount: 0.96, ledgerAmount: 0.52, edgeFade: 0.26, blending: 'normal' },
  static_smoke: { sliceMul: 1.1, opacityMul: 0.8, densityMul: 1.28, scaleMul: 0.82, driftMul: 0.34, glowMul: 0.24, anisotropyAdd: 0.06, planeScaleMul: 1.04, depthMul: 0.96, streak: 0.74, grain: 1, swirl: 0.02, verticalBias: 0, coreTightness: 0.46, pulseNoise: 1, staticAmount: 0.96, dustAmount: 0.18, edgeFade: 0.14, blending: 'normal' },
  ember_drift: { sliceMul: 0.94, opacityMul: 0.9, densityMul: 1.04, scaleMul: 1.04, driftMul: 1.3, driftAdd: 0.16, glowMul: 1.24, glowAdd: 0.14, planeScaleMul: 0.98, streak: 0.24, grain: 0.28, swirl: 0.22, verticalBias: 0.58, coreTightness: 0.2, pulseNoise: 0.34, ember: 0.74 },
  condense_field: { sliceMul: 0.86, opacityMul: 0.82, densityMul: 1.52, scaleMul: 0.84, driftMul: 0.58, driftAdd: -0.04, glowMul: 0.64, glowAdd: 0.04, anisotropyAdd: 0.18, planeScaleMul: 0.92, depthMul: 0.88, streak: 0.1, grain: 0.22, swirl: 0.08, verticalBias: -0.26, coreTightness: 0.82, pulseNoise: 0.1, plumeAmount: 0.18, dustAmount: 0.08, velvetAmount: 0.22, ledgerAmount: 0.18, edgeFade: 0.24, blending: 'normal' },
  sublimate_cloud: { sliceMul: 1.22, opacityMul: 0.52, densityMul: 0.72, scaleMul: 1.24, driftMul: 1.46, driftAdd: 0.22, glowMul: 0.94, glowAdd: 0.1, anisotropyAdd: 0.54, planeScaleMul: 1.08, depthMul: 1.22, streak: 0.06, grain: 0.12, swirl: 0.42, verticalBias: 0.68, coreTightness: 0.06, pulseNoise: 0.2, mirageAmount: 0.26, staticAmount: 0.06, dustAmount: 0.12, edgeFade: 0.12, blending: 'additive' },
};

export function getFogProfile(mode: FogMode): FogProfile {
  return { ...DEFAULT_FOG_PROFILE, ...(FOG_PROFILES[mode] ?? {}) };
}

