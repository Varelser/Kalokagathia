import type { ParticleConfig } from '../types';

export const WEBGPU_COMPUTE_SUPPORTED_FEATURES = [
  'particles',
  'metaball',
  'volumetric',
  'smooth-tube',
  'ribbon',
  'tube',
  'trail',
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
