import type { ParticleConfig } from '../types';
import type { ProceduralSystemId } from './proceduralModeRegistry';
import type { LayerExecutionRoute } from './sceneRenderRoutingTypes';

import { HYBRID_RUNTIME_ENGINE, PROCEDURAL_SURFACE_ENGINE, getLayerRoute, getLayerRuntimeAuxEnabled, getLayerRuntimeConnectionEnabled, getLayerRuntimeConnectionStyle, getLayerRuntimeGeomMode3D, getLayerRuntimeGhostTrailEnabled, getLayerRuntimeGlyphOutlineEnabled, getLayerRuntimeMediaLumaMap, getLayerRuntimeSource, getLayerRuntimeSparkEnabled } from './sceneRenderRoutingRuntimeAccessors';

export function doesLayerRouteRenderParticleCore(route: LayerExecutionRoute): boolean {
  return !(route.proceduralSystemId && route.resolvedEngine === PROCEDURAL_SURFACE_ENGINE);
}

export function doesLayerRouteRenderProceduralSystem(route: LayerExecutionRoute, system: ProceduralSystemId): boolean {
  return route.proceduralSystemId === system && route.resolvedEngine === PROCEDURAL_SURFACE_ENGINE;
}

export function doesLayerRouteRenderHybridSystem(route: LayerExecutionRoute, system: ProceduralSystemId): boolean {
  return route.proceduralSystemId === system && route.resolvedEngine === HYBRID_RUNTIME_ENGINE;
}

export function doesLayerUseProceduralSystem(config: ParticleConfig, system: ProceduralSystemId): boolean {
  return [getLayerRoute(config, 2), getLayerRoute(config, 3)].some((route) => route.enabled && route.proceduralSystemId === system);
}

export function doesLayerRenderParticleCore(config: ParticleConfig, layerIndex: 2 | 3): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled && doesLayerRouteRenderParticleCore(route);
}

export function doesLayerRenderGlyphOutline(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): boolean {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  if (!resolvedRoute.enabled) return false;
  return getLayerRuntimeGlyphOutlineEnabled(config, layerIndex) && getLayerRuntimeSource(config, layerIndex) === 'text';
}

export function doesLayerRenderAuxParticles(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): boolean {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  return resolvedRoute.enabled && getLayerRuntimeAuxEnabled(config, layerIndex) && doesLayerRouteRenderParticleCore(resolvedRoute);
}

export function doesLayerRenderSparkParticles(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): boolean {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  return resolvedRoute.enabled && getLayerRuntimeSparkEnabled(config, layerIndex) && doesLayerRouteRenderParticleCore(resolvedRoute);
}

export function doesLayerUseMediaParticleLayout(config: ParticleConfig, layerIndex: 2 | 3, source: 'image' | 'video' | 'text'): boolean {
  const route = getLayerRoute(config, layerIndex);
  if (!route.enabled || !doesLayerRouteRenderParticleCore(route)) return false;
  return getLayerRuntimeSource(config, layerIndex) === source && getLayerRuntimeMediaLumaMap(config, layerIndex).length > 0;
}

export function doesLayerRenderInstancedSolids(config: ParticleConfig, layerIndex: 2 | 3): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled && doesLayerRouteRenderParticleCore(route) && getLayerRuntimeGeomMode3D(config, layerIndex) !== 'billboard';
}

export function doesLayerRenderTextInstancedSolids(config: ParticleConfig, layerIndex: 2 | 3): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled
    && doesLayerRouteRenderParticleCore(route)
    && getLayerRuntimeSource(config, layerIndex) === 'text'
    && getLayerRuntimeGeomMode3D(config, layerIndex) !== 'billboard'
    && getLayerRuntimeMediaLumaMap(config, layerIndex).length > 0;
}

export function doesLayerRenderConnectionLines(config: ParticleConfig, layerIndex: 2 | 3): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled && doesLayerRouteRenderParticleCore(route) && getLayerRuntimeConnectionEnabled(config, layerIndex);
}

export function doesLayerRenderConnectionStyle(config: ParticleConfig, layerIndex: 2 | 3, style: string): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled
    && doesLayerRouteRenderParticleCore(route)
    && getLayerRuntimeConnectionEnabled(config, layerIndex)
    && getLayerRuntimeConnectionStyle(config, layerIndex) === style;
}

export function doesLayerRenderGhostTrail(config: ParticleConfig, layerIndex: 2 | 3): boolean {
  const route = getLayerRoute(config, layerIndex);
  return route.enabled && doesLayerRouteRenderParticleCore(route) && getLayerRuntimeGhostTrailEnabled(config, layerIndex);
}
