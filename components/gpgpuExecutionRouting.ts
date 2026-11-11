import type { RefObject } from 'react';
import * as THREE from 'three';
import type { ParticleConfig, ProjectExecutionRoutingSnapshot } from '../types';
import { resolveGpgpuExecutionFoundation } from '../lib/gpgpuExecutionFoundation';
import { getProjectExecutionRoutingEntry } from '../lib/projectExecutionRouting';
import type { WebGPUComputeState } from '../lib/webgpuCompute';

type PingPongTargets = {
  posA: THREE.WebGLRenderTarget;
  posB: THREE.WebGLRenderTarget;
  velA: THREE.WebGLRenderTarget;
  velB: THREE.WebGLRenderTarget;
};

export type GpgpuReadbackMode = 'none' | 'webgl-readback' | 'webgpu-skip';

export type GpgpuFrameRouting = {
  foundation: ReturnType<typeof resolveGpgpuExecutionFoundation>;
  execution: ProjectExecutionRoutingSnapshot;
  useWebGPU: boolean;
  outputPosTexture: THREE.Texture;
  readbackMode: GpgpuReadbackMode;
};

export function resolvePingPongTargets(buffers: PingPongTargets, pingIsA: boolean) {
  return {
    isA: pingIsA,
    posIn: pingIsA ? buffers.posA : buffers.posB,
    posOut: pingIsA ? buffers.posB : buffers.posA,
    velIn: pingIsA ? buffers.velA : buffers.velB,
    velOut: pingIsA ? buffers.velB : buffers.velA,
  };
}

export function resolveGpgpuAudioBlast(
  config: ParticleConfig,
  audioLevels: { bass: number; pulse: number },
): number {
  if (!config.gpgpuAudioReactive || !config.audioEnabled) return 0;
  return (audioLevels.bass * 0.55 + audioLevels.pulse * 0.9) * config.gpgpuAudioBlast;
}

export function resolveGpgpuFrameRouting(args: {
  config: ParticleConfig;
  webgpuState: WebGPUComputeState | null;
  webgpuPosTexture: THREE.Texture | null;
  fallbackPosTexture: THREE.Texture;
  posReadbackRef?: RefObject<Float32Array | null>;
}): GpgpuFrameRouting {
  const { config, webgpuState, webgpuPosTexture, fallbackPosTexture, posReadbackRef } = args;
  const webgpuAvailable = webgpuState !== null && webgpuPosTexture !== null;
  const foundation = resolveGpgpuExecutionFoundation(config, {
    webgpuAvailable,
  });
  const execution = getProjectExecutionRoutingEntry(config, 'gpgpu', {
    gpgpuWebgpuAvailable: webgpuAvailable,
  }) ?? {
    key: 'gpgpu',
    label: 'GPGPU',
    enabled: config.gpgpuEnabled,
    mode: foundation.features.includes('metaball') ? 'metaball' : foundation.path,
    renderClass: foundation.features.includes('metaball') ? 'metaball-surface' : 'gpu-particles',
    simulationClass: foundation.backend,
    requestedEngine: foundation.requestedBackend,
    resolvedEngine: foundation.backend,
    path: foundation.path,
    overrideId: 'auto',
    proceduralSystemId: null,
    hybridKind: foundation.backend === 'webgpu-compute' ? 'compute' : null,
    capabilityFlags: [],
    reason: foundation.reason,
    notes: [],
  };
  const useWebGPU = execution.resolvedEngine === 'webgpu-compute'
    && webgpuState !== null
    && webgpuPosTexture !== null;

  const readbackMode: GpgpuReadbackMode = !posReadbackRef
    ? 'none'
    : useWebGPU
      ? 'webgpu-skip'
      : (config.gpgpuMetaballEnabled || config.gpgpuSmoothTubeEnabled)
        ? 'webgl-readback'
        : 'none';

  return {
    foundation,
    execution,
    useWebGPU,
    outputPosTexture: useWebGPU && webgpuPosTexture ? webgpuPosTexture : fallbackPosTexture,
    readbackMode,
  };
}
