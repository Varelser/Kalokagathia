import type { ParticleConfig } from '../types';
import { withCrossFamilyLineProfile, withSourceAwareLineProfile } from '../lib/sourceAwareShaping';
import { getLayerRuntimeLineSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';
import type { LineProfile } from './sceneLineSystemShared';

const DEFAULT_LINE_PROFILE: LineProfile = {
  searchMul: 1,
  budgetMul: 1,
  sampleMul: 1,
  neighborBonus: 0,
  planarBias: 0,
  radialBias: 0,
  gateFreq: 0,
  gateThreshold: 0,
  dropout: 0,
  widthMul: 1,
  softnessMul: 1,
  opacityMul: 1,
  glowMul: 1,
  alphaMul: 1,
  pulseMul: 1,
  shimmerMul: 1,
  flickerMul: 1,
  hueShiftAdd: 0,
};

const LINE_MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<LineProfile>>> = {
  contour_echo: { searchMul: 0.84, budgetMul: 0.9, sampleMul: 0.88, neighborBonus: -1, planarBias: 1.18, radialBias: 0.34, gateFreq: 0.58, gateThreshold: 0.18, widthMul: 1.08, softnessMul: 0.94, opacityMul: 0.9, glowMul: 0.76, alphaMul: 0.82, pulseMul: 0.84, shimmerMul: 0.78, flickerMul: 0.86, hueShiftAdd: 0.01 },
  shell_script: { searchMul: 0.78, budgetMul: 0.76, sampleMul: 0.86, neighborBonus: -1, planarBias: 0.82, radialBias: 0.92, gateFreq: 0.94, gateThreshold: 0.34, dropout: 0.08, widthMul: 0.84, softnessMul: 0.78, opacityMul: 0.78, glowMul: 0.64, alphaMul: 0.72, pulseMul: 0.72, shimmerMul: 0.8, flickerMul: 1.18, hueShiftAdd: 0.03 },
  sigil_dust: { searchMul: 0.76, budgetMul: 0.72, sampleMul: 0.8, neighborBonus: -1, planarBias: 1.02, radialBias: 0.42, gateFreq: 1.18, gateThreshold: 0.46, dropout: 0.16, widthMul: 0.78, softnessMul: 0.72, opacityMul: 0.72, glowMul: 0.58, alphaMul: 0.66, pulseMul: 0.68, shimmerMul: 0.76, flickerMul: 1.1, hueShiftAdd: 0.02 },
  drift_glyph_dust: { searchMul: 0.82, budgetMul: 0.64, sampleMul: 0.74, neighborBonus: -2, planarBias: 0.7, radialBias: 0.26, gateFreq: 1.08, gateThreshold: 0.52, dropout: 0.24, widthMul: 0.74, softnessMul: 0.7, opacityMul: 0.58, glowMul: 0.5, alphaMul: 0.6, pulseMul: 0.64, shimmerMul: 0.72, flickerMul: 1.06, hueShiftAdd: -0.01 },
  glyph_weave: { searchMul: 1.12, budgetMul: 1.22, sampleMul: 1.14, neighborBonus: 1, planarBias: 0.62, radialBias: 0.34, gateFreq: 0.78, gateThreshold: 0.22, dropout: 0.04, widthMul: 0.94, softnessMul: 0.58, opacityMul: 0.9, glowMul: 1.1, alphaMul: 1.08, pulseMul: 0.96, shimmerMul: 1.1, flickerMul: 1.18, hueShiftAdd: 0.04 },
  mesh_weave: { searchMul: 1.08, budgetMul: 1.14, sampleMul: 1.1, neighborBonus: 1, planarBias: 0.3, radialBias: 0.24, gateFreq: 0.34, gateThreshold: 0.08, widthMul: 0.9, softnessMul: 0.66, opacityMul: 0.88, glowMul: 0.96, alphaMul: 0.96, pulseMul: 0.9, shimmerMul: 0.96, flickerMul: 0.96, hueShiftAdd: 0.01 },
  static_lace: { searchMul: 1.02, budgetMul: 1.04, sampleMul: 1.0, neighborBonus: 1, planarBias: 0.72, radialBias: 0.18, gateFreq: 1.22, gateThreshold: 0.4, dropout: 0.14, widthMul: 0.82, softnessMul: 0.56, opacityMul: 0.78, glowMul: 0.7, alphaMul: 0.74, pulseMul: 0.86, shimmerMul: 1.04, flickerMul: 1.34, hueShiftAdd: 0.02 },
  signal_braid: { searchMul: 1.18, budgetMul: 1.24, sampleMul: 1.12, neighborBonus: 1, planarBias: 0.26, radialBias: 0.32, gateFreq: 1.08, gateThreshold: 0.18, dropout: 0.08, widthMul: 0.9, softnessMul: 0.56, opacityMul: 0.9, glowMul: 1.18, alphaMul: 1.06, pulseMul: 1.16, shimmerMul: 1.18, flickerMul: 1.24, hueShiftAdd: 0.06 },
  cinder_web: { searchMul: 0.94, budgetMul: 0.98, sampleMul: 0.96, neighborBonus: 0, planarBias: 0.44, radialBias: 0.16, gateFreq: 0.72, gateThreshold: 0.22, dropout: 0.12, widthMul: 0.92, softnessMul: 0.68, opacityMul: 0.82, glowMul: 0.74, alphaMul: 0.8, pulseMul: 0.86, shimmerMul: 0.92, flickerMul: 1.02, hueShiftAdd: -0.02 },
  spectral_mesh: { searchMul: 1.14, budgetMul: 1.22, sampleMul: 1.14, neighborBonus: 1, planarBias: 0.22, radialBias: 0.24, gateFreq: 0.54, gateThreshold: 0.06, widthMul: 0.86, softnessMul: 0.58, opacityMul: 0.94, glowMul: 1.24, alphaMul: 1.1, pulseMul: 1.08, shimmerMul: 1.22, flickerMul: 1.24, hueShiftAdd: 0.06 },
  aurora_threads: { searchMul: 1.14, budgetMul: 1.2, sampleMul: 1.12, neighborBonus: 1, planarBias: 0.22, radialBias: 0.28, gateFreq: 0.42, gateThreshold: 0.05, widthMul: 0.9, softnessMul: 0.6, opacityMul: 0.9, glowMul: 1.22, alphaMul: 1.12, pulseMul: 1.08, shimmerMul: 1.18, flickerMul: 1.22, hueShiftAdd: 0.06 },
  prism_threads: { searchMul: 1.1, budgetMul: 1.18, sampleMul: 1.1, neighborBonus: 1, planarBias: 0.24, radialBias: 0.24, gateFreq: 0.66, gateThreshold: 0.12, widthMul: 0.88, softnessMul: 0.58, opacityMul: 0.88, glowMul: 1.2, alphaMul: 1.08, pulseMul: 1.06, shimmerMul: 1.22, flickerMul: 1.18, hueShiftAdd: 0.08 },
  branch_propagation: { searchMul: 1.16, budgetMul: 0.92, sampleMul: 1.08, neighborBonus: 0, planarBias: 0.12, radialBias: 0.18, gateFreq: 0.26, gateThreshold: 0.02, widthMul: 0.86, softnessMul: 0.68, opacityMul: 0.84, glowMul: 0.9, alphaMul: 0.94, pulseMul: 0.88, shimmerMul: 0.92, flickerMul: 0.94, hueShiftAdd: 0.01 },
};

export function getLineRefreshInterval(quality: ParticleConfig['renderQuality'], particleCount: number) {
  if (quality === 'draft') return particleCount > 12000 ? 0.4 : 0.3;
  if (quality === 'cinematic') return particleCount > 18000 ? 0.2 : 0.14;
  return particleCount > 12000 ? 0.28 : 0.2;
}

export function getLineBudget(quality: ParticleConfig['renderQuality'], particleCount: number) {
  if (quality === 'draft') return Math.min(2200, Math.floor(particleCount * 0.45));
  if (quality === 'cinematic') return Math.min(10000, Math.floor(particleCount * 1.4));
  return Math.min(6000, Math.floor(particleCount * 0.9));
}

export function getLineSampleLimit(quality: ParticleConfig['renderQuality']) {
  if (quality === 'draft') return 900;
  if (quality === 'cinematic') return 2600;
  return 1600;
}

export function getLineNeighborLimit(quality: ParticleConfig['renderQuality']) {
  if (quality === 'draft') return 3;
  if (quality === 'cinematic') return 5;
  return 4;
}

export function getResolvedLineProfile(config: ParticleConfig, layerIndex: 2 | 3): LineProfile {
  const runtime = getLayerRuntimeLineSnapshot(config, layerIndex);
  const layerType = getLayerRuntimeMode(config, layerIndex, runtime.route);
  const layerSource = runtime.source;
  return withCrossFamilyLineProfile(withSourceAwareLineProfile({ ...DEFAULT_LINE_PROFILE, ...(LINE_MODE_PROFILES[layerType] ?? {}) }, layerSource), layerType, layerSource);
}
