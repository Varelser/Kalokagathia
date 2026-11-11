import type { ParticleConfig } from '../types';
import { getLayerParticleLayoutDeps, getLayerRuntimeBrushSnapshot, getLayerRuntimeMode } from '../lib/sceneRenderRouting';
import type { BrushSettings } from './sceneBrushSurfaceSystemTypes';

export function getLayerMode(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerRuntimeMode(config, layerIndex);
}

export function getParticleDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  return getLayerParticleLayoutDeps(config, layerIndex);
}

export function getBrushSettings(config: ParticleConfig, layerIndex: 2 | 3): BrushSettings {
  const runtime = getLayerRuntimeBrushSnapshot(config, layerIndex);
  return {
    opacity: runtime.opacity,
    layers: runtime.layers,
    scale: runtime.scale,
    jitter: runtime.jitter,
    audioReactive: runtime.audioReactive,
    color: runtime.color,
    materialStyle: runtime.materialStyle,
    source: runtime.source,
  };
}
