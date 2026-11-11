import type { ParticleConfig } from '../types';
import type { FiberProfile } from './sceneFiberFieldSystemTypes';

const DEFAULT_FIBER_PROFILE: FiberProfile = {
  densityBoost: 1,
  lengthBase: 1,
  curlBoost: 1,
  tangentStretch: 1,
  normalBias: 0,
  bitangentBias: 0,
  seedBias: 0,
  verticalBias: 0,
  radialLift: 0,
  radialPull: 0,
  planarPull: 0,
  curtainAmount: 0,
  braidAmount: 0,
  quantize: 0,
  waveAmplitude: 0,
  waveFrequency: 1,
  phaseSpeed: 1,
  glow: 1,
  bandFrequency: 1,
  bandMix: 0,
  prismAmount: 0,
  gateAmount: 0,
  shimmerScale: 1,
  pulseMix: 1,
  alphaMul: 1,
  charAmount: 0,
  canopyAmount: 0,
  stormAmount: 0,
  fractureAmount: 0,
  droopAmount: 0,
  spineAmount: 0,
  fanAmount: 0,
};

const FIBER_MODE_PROFILES: Partial<Record<ParticleConfig['layer2Type'], Partial<FiberProfile>>> = {
  mesh_weave: { densityBoost: 1.35, lengthBase: 0.74, curlBoost: 1.08, tangentStretch: 0.92, planarPull: 0.34, quantize: 0.12, bandFrequency: 2.1, bandMix: 0.18, shimmerScale: 0.9, alphaMul: 0.94, spineAmount: 0.28 },
  plasma_thread: { densityBoost: 1.18, lengthBase: 1.36, curlBoost: 1.08, tangentStretch: 1.14, glow: 1.18, bandFrequency: 2.6, bandMix: 0.22, pulseMix: 1.08, stormAmount: 0.16, canopyAmount: 0.12 },
  branch_propagation: { densityBoost: 1.38, lengthBase: 0.92, tangentStretch: 0.88, radialLift: 0.18, verticalBias: 0.24, alphaMul: 0.9, canopyAmount: 0.42, spineAmount: 0.64, fanAmount: 0.32 },
  nerve_web: { densityBoost: 1.34, lengthBase: 0.72, curlBoost: 1.1, tangentStretch: 0.84, normalBias: 0.22, bitangentBias: 0.16, bandFrequency: 2.8, bandMix: 0.18, shimmerScale: 0.92, spineAmount: 0.52 },
  static_lace: { densityBoost: 1.32, lengthBase: 0.68, curlBoost: 0.72, tangentStretch: 0.72, planarPull: 0.42, quantize: 0.34, waveAmplitude: 0.08, waveFrequency: 4.2, phaseSpeed: 0.38, bandFrequency: 11.0, bandMix: 0.72, gateAmount: 0.82, shimmerScale: 1.06, pulseMix: 0.8, alphaMul: 0.82, fractureAmount: 0.56 },
  signal_braid: { densityBoost: 1.5, lengthBase: 1.42, curlBoost: 1.1, tangentStretch: 1.12, normalBias: 0.18, bitangentBias: 0.26, radialLift: 0.18, braidAmount: 0.92, waveAmplitude: 0.22, waveFrequency: 5.4, phaseSpeed: 1.12, glow: 1.24, bandFrequency: 7.6, bandMix: 0.46, gateAmount: 0.64, shimmerScale: 1.16, pulseMix: 1.2, alphaMul: 0.95, stormAmount: 0.34, spineAmount: 0.18 },
  cinder_web: { densityBoost: 1.42, lengthBase: 0.58, curlBoost: 0.94, tangentStretch: 0.8, seedBias: 0.18, radialPull: 0.18, curtainAmount: 0.08, waveAmplitude: 0.1, waveFrequency: 2.8, phaseSpeed: 0.54, bandFrequency: 3.8, bandMix: 0.34, gateAmount: 0.28, shimmerScale: 0.88, pulseMix: 0.84, alphaMul: 0.86, charAmount: 0.84, droopAmount: 0.52, fractureAmount: 0.18 },
  spectral_mesh: { densityBoost: 1.42, lengthBase: 1.12, curlBoost: 1.02, tangentStretch: 1.04, normalBias: 0.1, bitangentBias: 0.14, waveAmplitude: 0.18, waveFrequency: 3.6, phaseSpeed: 0.86, glow: 1.32, bandFrequency: 6.4, bandMix: 0.4, prismAmount: 0.78, gateAmount: 0.22, shimmerScale: 1.24, pulseMix: 1.14, alphaMul: 0.96, canopyAmount: 0.18, stormAmount: 0.14 },
  ember_lace: { densityBoost: 1.46, lengthBase: 0.7, curlBoost: 1.04, tangentStretch: 0.82, radialLift: 0.08, waveAmplitude: 0.12, waveFrequency: 2.6, phaseSpeed: 0.62, glow: 1.1, bandFrequency: 4.0, bandMix: 0.28, charAmount: 0.46, alphaMul: 0.9, droopAmount: 0.36, stormAmount: 0.12 },
  aurora_threads: { densityBoost: 1.56, lengthBase: 1.568, curlBoost: 1.16, tangentStretch: 1.18, verticalBias: 0.16, curtainAmount: 0.48, waveAmplitude: 0.28, waveFrequency: 2.4, phaseSpeed: 0.84, glow: 1.36, bandFrequency: 4.6, bandMix: 0.26, shimmerScale: 1.18, pulseMix: 1.12, alphaMul: 0.96, canopyAmount: 0.36, stormAmount: 0.46, fanAmount: 0.28 },
  prism_threads: { densityBoost: 1.5, lengthBase: 1.2, curlBoost: 1.08, tangentStretch: 1.08, braidAmount: 0.28, waveAmplitude: 0.2, waveFrequency: 3.8, phaseSpeed: 0.92, glow: 1.28, bandFrequency: 7.2, bandMix: 0.42, prismAmount: 0.92, shimmerScale: 1.22, pulseMix: 1.1, fanAmount: 0.44, canopyAmount: 0.16 },
  glyph_weave: { densityBoost: 1.36, lengthBase: 0.86, curlBoost: 0.92, tangentStretch: 0.84, planarPull: 0.32, quantize: 0.24, braidAmount: 0.18, waveAmplitude: 0.08, waveFrequency: 5.2, phaseSpeed: 0.52, bandFrequency: 8.4, bandMix: 0.5, gateAmount: 0.78, shimmerScale: 1.12, pulseMix: 0.92, alphaMul: 0.88, fractureAmount: 0.3, spineAmount: 0.22 },
};

export function getFiberProfile(mode: ParticleConfig['layer2Type']): FiberProfile {
  return { ...DEFAULT_FIBER_PROFILE, ...(FIBER_MODE_PROFILES[mode] ?? {}) };
}
