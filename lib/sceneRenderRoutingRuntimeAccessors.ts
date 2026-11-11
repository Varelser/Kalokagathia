import type { ParticleConfig } from '../types';
import { getLayerExecutionRoutingSnapshot, getProjectExecutionRoutingEntry } from './projectExecutionRouting';
import type { GpgpuExecutionRoute, LayerExecutionRoute } from './sceneRenderRoutingTypes';

export const PROCEDURAL_SURFACE_ENGINE = 'webgl-procedural-surface';
export const HYBRID_RUNTIME_ENGINE = 'hybrid-runtime';

export function getLayerRoute(config: ParticleConfig, layerIndex: 2 | 3): LayerExecutionRoute {
  return getLayerExecutionRoutingSnapshot(config, layerIndex) as LayerExecutionRoute;
}

export function getLayerRuntimeMode(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): ParticleConfig['layer2Type'] {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  return resolvedRoute.mode as ParticleConfig['layer2Type'];
}

export function getLayerRuntimeEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2Enabled : config.layer3Enabled;
}

export function getLayerRuntimeTemporalProfile(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2TemporalProfile : config.layer3TemporalProfile;
}

export function getLayerRuntimeTemporalStrength(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2TemporalStrength : config.layer3TemporalStrength;
}

export function getLayerRuntimeColor(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2Color : config.layer3Color;
}

export function getLayerRuntimeRadiusScale(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2RadiusScale : config.layer3RadiusScale;
}

export function getLayerRuntimeMaterialStyle(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2MaterialStyle : config.layer3MaterialStyle;
}

export function getGpgpuRoute(config: ParticleConfig): GpgpuExecutionRoute | undefined {
  return getProjectExecutionRoutingEntry(config, 'gpgpu') as GpgpuExecutionRoute | undefined;
}

export function getLayerRuntimeSource(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2Source : config.layer3Source;
}

export function getLayerRuntimeGlyphOutlineEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2GlyphOutlineEnabled : config.layer3GlyphOutlineEnabled;
}

export function getLayerRuntimeAuxEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2AuxEnabled : config.layer3AuxEnabled;
}

export function getLayerRuntimeSparkEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2SparkEnabled : config.layer3SparkEnabled;
}

export function getLayerRuntimeMediaLumaMap(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2MediaLumaMap : config.layer3MediaLumaMap;
}

export function getLayerRuntimeGeomMode3D(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2GeomMode3D : config.layer3GeomMode3D;
}

export function getLayerRuntimeConnectionEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2ConnectionEnabled : config.layer3ConnectionEnabled;
}

export function getLayerRuntimeConnectionStyle(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2ConnectionStyle : config.layer3ConnectionStyle;
}

export function getLayerRuntimeGhostTrailEnabled(config: ParticleConfig, layerIndex: 2 | 3) {
  return layerIndex === 2 ? config.layer2GhostTrailEnabled : config.layer3GhostTrailEnabled;
}
