import type { ParticleConfig } from '../types';
import { getWebgpuComputeCapabilityReport } from './webgpuComputeFoundation';

export type GpgpuExecutionBackend = 'disabled' | 'webgl-gpgpu' | 'webgpu-compute';
export type GpgpuExecutionPath = 'points' | 'lines' | 'surface' | 'volume' | 'mixed';

export interface GpgpuExecutionFoundation {
  enabled: boolean;
  backend: GpgpuExecutionBackend;
  requestedBackend: GpgpuExecutionBackend;
  path: GpgpuExecutionPath;
  features: string[];
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  reason: string;
}

export interface GpgpuExecutionResolveOptions {
  webgpuAvailable?: boolean;
}

function getRequestedBackend(config: ParticleConfig): GpgpuExecutionBackend {
  if (!config.gpgpuEnabled) return 'disabled';
  if (config.gpgpuExecutionPreference === 'webgl') return 'webgl-gpgpu';
  if (config.gpgpuExecutionPreference === 'webgpu') return 'webgpu-compute';
  return config.gpgpuWebGPUEnabled ? 'webgpu-compute' : 'webgl-gpgpu';
}

export function resolveGpgpuExecutionFoundation(
  config: ParticleConfig,
  options: GpgpuExecutionResolveOptions = {},
): GpgpuExecutionFoundation {
  if (!config.gpgpuEnabled) {
    return {
      enabled: false,
      backend: 'disabled',
      requestedBackend: 'disabled',
      path: 'points',
      features: [],
      supportedFeatures: [],
      unsupportedFeatures: [],
      reason: 'gpgpu disabled',
    };
  }

  const features: string[] = ['particles'];
  let path: GpgpuExecutionPath = 'points';

  if (config.gpgpuSmoothTubeEnabled || config.gpgpuRibbonEnabled || config.gpgpuTrailEnabled || config.gpgpuTubeEnabled) {
    path = 'lines';
  }
  if (config.gpgpuMetaballEnabled) {
    path = path === 'lines' ? 'mixed' : 'surface';
    features.push('metaball');
  }
  if (config.gpgpuVolumetricEnabled) {
    path = path === 'points' ? 'volume' : 'mixed';
    features.push('volumetric');
  }
  if (config.gpgpuSmoothTubeEnabled) features.push('smooth-tube');
  if (config.gpgpuRibbonEnabled) features.push('ribbon');
  if (config.gpgpuTubeEnabled) features.push('tube');
  if (config.gpgpuTrailEnabled) features.push('trail');
  if (config.gpgpuFluidEnabled) features.push('fluid-field');
  if (config.gpgpuSphEnabled) features.push('sph');
  if (config.gpgpuBoidsEnabled) features.push('boids');
  if (config.gpgpuAttractorEnabled) features.push('attractor');
  if (config.gpgpuVortexEnabled) features.push('vortex');
  if (config.gpgpuCurlEnabled) features.push('curl');

  const requestedBackend = getRequestedBackend(config);
  const capability = getWebgpuComputeCapabilityReport(config);
  let backend = requestedBackend;
  let reason = requestedBackend === 'webgpu-compute' ? 'gpgpu webgpu requested' : 'gpgpu fragment simulation';

  if (requestedBackend === 'webgpu-compute' && options.webgpuAvailable === false) {
    backend = 'webgl-gpgpu';
    reason = 'webgpu requested, fell back to webgl (unavailable)';
  } else if (requestedBackend === 'webgpu-compute' && !capability.canRunRequestedConfig) {
    backend = 'webgl-gpgpu';
    reason = `webgpu requested, fell back to webgl (unsupported: ${capability.unsupportedFeatures.join(', ')})`;
  } else if (requestedBackend === 'webgpu-compute') {
    reason = 'gpgpu webgpu compute';
  }

  return {
    enabled: true,
    backend,
    requestedBackend,
    path,
    features,
    supportedFeatures: capability.supportedFeatures,
    unsupportedFeatures: capability.unsupportedFeatures,
    reason,
  };
}
