import type { ParticleConfig } from '../types';
import type { ProceduralSystemId } from './proceduralModeRegistry';
import type { GpgpuExecutionRoute, GpgpuRenderOutputPlan, LayerExecutionRoute, LayerSceneRenderPlan } from './sceneRenderRoutingTypes';
import { doesLayerRenderAuxParticles, doesLayerRenderGlyphOutline, doesLayerRenderSparkParticles, doesLayerRouteRenderHybridSystem, doesLayerRouteRenderParticleCore, doesLayerRouteRenderProceduralSystem, getGpgpuRoute, getLayerRoute, getLayerRuntimeConnectionEnabled, getLayerRuntimeConnectionStyle, getLayerRuntimeGeomMode3D, getLayerRuntimeGhostTrailEnabled } from './sceneRenderRoutingRuntime';

export function layerRouteHasSceneBranch(config: ParticleConfig, layerIndex: 2 | 3, branch: string, route?: LayerExecutionRoute): boolean {
  return getLayerSceneBranches(config, layerIndex, route).includes(branch);
}

export function anyLayerHasSceneBranch(config: ParticleConfig, branch: string): boolean {
  return ([2, 3] as const).some((layerIndex) => layerRouteHasSceneBranch(config, layerIndex, branch));
}

export function getLayerSceneBranches(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): string[] {
  return getLayerSceneRenderPlan(config, layerIndex, route).sceneBranches;
}

export function getLayerSceneRenderPlan(config: ParticleConfig, layerIndex: 2 | 3, route?: LayerExecutionRoute): LayerSceneRenderPlan {
  const resolvedRoute = route ?? getLayerRoute(config, layerIndex);
  const proceduralSystemId = resolvedRoute.proceduralSystemId as ProceduralSystemId | null;
  const particleCore = resolvedRoute.enabled && doesLayerRouteRenderParticleCore(resolvedRoute);
  const proceduralRenderSystemId = proceduralSystemId && doesLayerRouteRenderProceduralSystem(resolvedRoute, proceduralSystemId)
    ? proceduralSystemId
    : null;
  const hybridRenderSystemId = proceduralSystemId && doesLayerRouteRenderHybridSystem(resolvedRoute, proceduralSystemId)
    ? proceduralSystemId
    : null;
  const glyphOutline = doesLayerRenderGlyphOutline(config, layerIndex, resolvedRoute);
  const auxParticles = doesLayerRenderAuxParticles(config, layerIndex, resolvedRoute);
  const sparkParticles = doesLayerRenderSparkParticles(config, layerIndex, resolvedRoute);
  const instancedSolids = resolvedRoute.enabled && getLayerRuntimeGeomMode3D(config, layerIndex) !== 'billboard' && particleCore;
  const connectionStyle = resolvedRoute.enabled && getLayerRuntimeConnectionEnabled(config, layerIndex) && particleCore
    ? getLayerRuntimeConnectionStyle(config, layerIndex)
    : null;
  const ghostTrail = resolvedRoute.enabled && getLayerRuntimeGhostTrailEnabled(config, layerIndex) && particleCore;
  const sceneBranches: string[] = [];
  if (particleCore) sceneBranches.push('particle-core');
  if (proceduralRenderSystemId) sceneBranches.push(`procedural:${proceduralRenderSystemId}`);
  if (hybridRenderSystemId) sceneBranches.push(`hybrid:${hybridRenderSystemId}`);
  if (glyphOutline) sceneBranches.push('glyph-outline');
  if (auxParticles) sceneBranches.push('aux-particles');
  if (sparkParticles) sceneBranches.push('spark-particles');
  if (instancedSolids) sceneBranches.push('instanced-solids');
  if (connectionStyle) sceneBranches.push(`connections:${connectionStyle}`);
  if (ghostTrail) sceneBranches.push('ghost-trail');
  return {
    route: resolvedRoute,
    particleCore,
    proceduralSystemId: proceduralRenderSystemId,
    hybridSystemId: hybridRenderSystemId,
    glyphOutline,
    auxParticles,
    sparkParticles,
    instancedSolids,
    connectionStyle,
    ghostTrail,
    sceneBranches,
  };
}

export function doesGpgpuRouteRenderCore(route: GpgpuExecutionRoute | undefined): boolean {
  return Boolean(route?.enabled);
}

export function doesGpgpuRouteRenderPointSprites(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuGeomMode === 'point');
}

export function doesGpgpuRouteRenderInstancedSolids(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuGeomMode !== 'point');
}

export function doesGpgpuRouteRenderTrailPoints(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuTrailEnabled);
}

export function doesGpgpuRouteRenderRibbons(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuRibbonEnabled);
}

export function doesGpgpuRouteRenderTubes(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuTubeEnabled);
}

export function doesGpgpuRouteRenderStreakLines(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuStreakEnabled);
}

export function doesGpgpuRouteRenderSmoothTube(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuSmoothTubeEnabled);
}

export function doesGpgpuRouteRenderMetaball(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  if (!route?.enabled || !config.gpgpuMetaballEnabled) return false;
  return route.resolvedEngine === 'webgl-gpgpu' || route.resolvedEngine === 'webgpu-compute';
}

export function doesGpgpuRouteRenderVolumetric(route: GpgpuExecutionRoute | undefined, config: ParticleConfig): boolean {
  return Boolean(route?.enabled && config.gpgpuVolumetricEnabled);
}

export function getGpgpuSceneBranches(config: ParticleConfig, route?: GpgpuExecutionRoute): string[] {
  return getGpgpuRenderOutputPlan(config, route).sceneBranches;
}

export function getGpgpuRenderOutputPlan(config: ParticleConfig, route?: GpgpuExecutionRoute): GpgpuRenderOutputPlan {
  const resolvedRoute = route ?? getGpgpuRoute(config);
  const core = doesGpgpuRouteRenderCore(resolvedRoute);
  const pointSprites = doesGpgpuRouteRenderPointSprites(resolvedRoute, config);
  const instancedSolids = doesGpgpuRouteRenderInstancedSolids(resolvedRoute, config);
  const trailPoints = doesGpgpuRouteRenderTrailPoints(resolvedRoute, config);
  const ribbons = doesGpgpuRouteRenderRibbons(resolvedRoute, config);
  const tubes = doesGpgpuRouteRenderTubes(resolvedRoute, config);
  const streakLines = doesGpgpuRouteRenderStreakLines(resolvedRoute, config);
  const smoothTubes = doesGpgpuRouteRenderSmoothTube(resolvedRoute, config);
  const metaballs = doesGpgpuRouteRenderMetaball(resolvedRoute, config);
  const volumetric = doesGpgpuRouteRenderVolumetric(resolvedRoute, config);
  const sceneBranches: string[] = [];
  if (core) sceneBranches.push('gpgpu-core');
  if (instancedSolids) sceneBranches.push('instanced-solids');
  if (trailPoints) sceneBranches.push('trail-points');
  if (streakLines) sceneBranches.push('streak-lines');
  if (ribbons) sceneBranches.push('ribbons');
  if (tubes) sceneBranches.push('tubes');
  if (smoothTubes) sceneBranches.push('smooth-tubes');
  if (metaballs) sceneBranches.push('metaballs');
  if (volumetric) sceneBranches.push('volumetric');
  return {
    route: resolvedRoute,
    core,
    pointSprites,
    instancedSolids,
    trailPoints,
    ribbons,
    tubes,
    streakLines,
    smoothTubes,
    metaballs,
    volumetric,
    sceneBranches,
  };
}
