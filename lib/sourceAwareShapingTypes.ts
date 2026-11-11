import type { Layer3Source } from '../types/scene';

export type LineLike = {
  searchMul: number;
  budgetMul: number;
  sampleMul: number;
  neighborBonus: number;
  planarBias: number;
  radialBias: number;
  gateFreq: number;
  gateThreshold: number;
  dropout: number;
  widthMul: number;
  softnessMul: number;
  opacityMul: number;
  glowMul: number;
  alphaMul: number;
  pulseMul: number;
  shimmerMul: number;
  flickerMul: number;
  hueShiftAdd: number;
};

export type ShellLike = {
  opacityMul: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  radialLift: number;
  ringLift: number;
  quantize: number;
  droop: number;
  scriptWarp: number;
  scanScale: number;
  bandStrength: number;
  grainStrength: number;
  haloSpread: number;
  haloSharpness: number;
  etchStrength: number;
  equatorBias: number;
  poreAmount: number;
  sporeAmount: number;
  bloomAmount: number;
  centerDarkness: number;
  auraAmount: number;
  diskAmount: number;
  lacquerAmount: number;
  flowAmount: number;
  blendMode: 'additive' | 'normal';
};

export type FogLike = {
  opacityMul: number;
  densityMul: number;
  scaleMul: number;
  driftMul: number;
  glowMul: number;
  anisotropyAdd: number;
  planeScaleMul: number;
  depthMul: number;
  streak: number;
  grain: number;
  swirl: number;
  verticalBias: number;
  coreTightness: number;
  pulseNoise: number;
  plumeAmount: number;
  fallAmount: number;
  mirageAmount: number;
  staticAmount: number;
  dustAmount: number;
  sootAmount: number;
  runeAmount: number;
  velvetAmount: number;
  ledgerAmount: number;
  edgeFade: number;
  blending: 'additive' | 'normal';
};

export type DepositionLike = {
  reliefMul: number;
  bandsMul: number;
  bandsMin: number;
  opacityMul: number;
  scaleMul: number;
  scaleYMul: number;
  rotationMul: number;
  pitchMul: number;
  dotField: number;
  dotSoftness: number;
  bandWarp: number;
  bleedSpread: number;
  glyphGrid: number;
  contourMix: number;
  sootStain: number;
  runeRetention: number;
  velvetMatte: number;
  vaporLift: number;
  normalBlend: boolean;
};

export type GlyphLike = {
  copies: number;
  spread: number;
  dropout: number;
  jitter: number;
  shear: number;
  quantize: number;
  zJitter: number;
  drift: number;
  gateFreq: number;
  gateThreshold: number;
  opacityMul: number;
  widthMul: number;
  shimmerMul: number;
  motionMul: number;
  tintMix: number;
  blendMode: 'additive' | 'normal';
};

export type PatchLike = {
  rippleMul: number;
  opacityMul: number;
  opacityAdd: number;
  fresnelAdd: number;
  contourBands: number;
  contourSharpness: number;
  plateMix: number;
  echoMix: number;
  shearMix: number;
  planarPull: number;
  rotationMul: number;
  blendMode: 'additive' | 'normal';
};

export type FiberLike = {
  densityBoost: number;
  lengthBase: number;
  curlBoost: number;
  tangentStretch: number;
  normalBias: number;
  bitangentBias: number;
  seedBias: number;
  verticalBias: number;
  radialLift: number;
  radialPull: number;
  planarPull: number;
  curtainAmount: number;
  braidAmount: number;
  quantize: number;
  waveAmplitude: number;
  waveFrequency: number;
  phaseSpeed: number;
  glow: number;
  bandFrequency: number;
  bandMix: number;
  prismAmount: number;
  gateAmount: number;
  shimmerScale: number;
  pulseMix: number;
  alphaMul: number;
  charAmount: number;
};

export type SourceAwareLayerConfig = {
  layer2Source: Layer3Source;
  layer3Source: Layer3Source;
};
