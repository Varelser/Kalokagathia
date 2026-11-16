import type { ParticleConfig } from '../types';

export const WEBGPU_COMPUTE_SUPPORTED_FEATURES = [
  'particles',
  'metaball',
  'volumetric',
  'smooth-tube',
  'ribbon',
  'tube',
  'trail',
  // Morph attraction joined the WGSL velocity pass in Phase R
  // (baked target cloud as a storage buffer, same force law as
  // WebGL). Before Phase R morph was not even listed as a requested
  // feature, so morph configs silently lost the force on this path.
  'morph',
  // Phase X3: the WGSL passes now carry the full WebGL force set
  // (verbatim force laws in lib/webgpuCompute.ts), including the
  // OBJ normal kick inside the morph block, so every feature below
  // is genuinely implemented on this path. Still unsupported —
  // and therefore still routing to WebGL — are 'age' (the respawn
  // lifecycle lives in the WebGL position pass), 'fluid-field'
  // (its solver is a WebGL FBO pass with no WGSL counterpart) and
  // 'custom-force' (user GLSL cannot be compiled to WGSL).
  'audio-reactive',
  'verlet',
  'nbody',
  'curl',
  'boids',
  'attractor',
  'vortex',
  'wind',
  'well',
  'elastic',
  'magnetic',
  'sph',
  'vector-field',
  'spring',
  'sdf-collider',
  'mouse-force',
  'kuramoto',
  'particle-life',
  'levy',
  'floor',
] as const;

export type WebgpuComputeFeature = typeof WEBGPU_COMPUTE_SUPPORTED_FEATURES[number];

const SUPPORTED_SET = new Set<string>(WEBGPU_COMPUTE_SUPPORTED_FEATURES);

function getRequestedGpgpuFeatures(config: ParticleConfig): string[] {
  const features: string[] = ['particles'];
  if (config.gpgpuMetaballEnabled) features.push('metaball');
  if (config.gpgpuVolumetricEnabled) features.push('volumetric');
  if (config.gpgpuSmoothTubeEnabled) features.push('smooth-tube');
  if (config.gpgpuRibbonEnabled) features.push('ribbon');
  if (config.gpgpuTubeEnabled) features.push('tube');
  if (config.gpgpuTrailEnabled) features.push('trail');
  if (config.gpgpuAudioReactive) features.push('audio-reactive');
  if (config.gpgpuAgeEnabled) features.push('age');
  if (config.gpgpuVerletEnabled) features.push('verlet');
  if (config.gpgpuNBodyEnabled) features.push('nbody');
  if (config.gpgpuCurlEnabled) features.push('curl');
  if (config.gpgpuBoidsEnabled) features.push('boids');
  if (config.gpgpuAttractorEnabled) features.push('attractor');
  if (config.gpgpuVortexEnabled) features.push('vortex');
  if (config.gpgpuWindEnabled) features.push('wind');
  if (config.gpgpuWellEnabled) features.push('well');
  if (config.gpgpuElasticEnabled) features.push('elastic');
  if (config.gpgpuMagneticEnabled) features.push('magnetic');
  if (config.gpgpuSphEnabled) features.push('sph');
  if (config.gpgpuVFieldEnabled) features.push('vector-field');
  if (config.gpgpuSpringEnabled) features.push('spring');
  if (config.gpgpuSdfEnabled) features.push('sdf-collider');
  if (config.gpgpuMouseEnabled) features.push('mouse-force');
  if (config.gpgpuFluidEnabled) features.push('fluid-field');
  if (config.gpgpuMorphEnabled) features.push('morph');
  // Phase X3 inventory: the features below exist in the WebGL
  // velocity/position shaders but were never requested here, so
  // configs using them silently lost the effect on the WebGPU
  // path (the Phase R morph bug, in four more places). Kuramoto,
  // Particle Life, Lévy and floor are implemented in WGSL as of
  // Phase X3; custom force (user GLSL) and the Aux event pools
  // (WebGL FBO passes that only run off the WebGPU path) stay
  // unsupported so those configs route to WebGL instead of
  // dropping the effect without a word.
  if (config.gpgpuKuramotoEnabled) features.push('kuramoto');
  if (config.gpgpuParticleLifeEnabled) features.push('particle-life');
  if (config.gpgpuLevyEnabled) features.push('levy');
  if (config.gpgpuFloorEnabled) features.push('floor');
  if (config.gpgpuCustomForceEnabled && (config.gpgpuCustomForceCode || '').trim().length > 0) features.push('custom-force');
  if (config.gpgpuAuxMode !== 'none') features.push('aux');
  return features;
}

export interface WebgpuComputeCapabilityReport {
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  requestedFeatures: string[];
  canRunRequestedConfig: boolean;
}

export function getWebgpuComputeCapabilityReport(config: ParticleConfig): WebgpuComputeCapabilityReport {
  const requestedFeatures = getRequestedGpgpuFeatures(config);
  const supportedFeatures = requestedFeatures.filter((feature) => SUPPORTED_SET.has(feature));
  const unsupportedFeatures = requestedFeatures.filter((feature) => !SUPPORTED_SET.has(feature));
  return {
    supportedFeatures,
    unsupportedFeatures,
    requestedFeatures,
    canRunRequestedConfig: unsupportedFeatures.length === 0,
  };
}
