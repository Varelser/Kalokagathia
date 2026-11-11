import type {
  ParticleConfig,
  ProjectCapabilityFlag,
  ProjectExecutionRoutingSnapshot,
  ProjectLayerSnapshotKey,
} from '../types';
import { getDepictionArchitecture } from './depictionArchitecture';
import { resolveExecutionEngineForLayer } from './executionFoundation';
import { resolveGpgpuExecutionFoundation } from './gpgpuExecutionFoundation';
import { inferPostFxStackBundleId } from './postFxLibrary';
import { getProceduralSystemId } from './proceduralModeRegistry';
import { getGpgpuSceneBranches, getLayerSceneBranches } from './sceneRenderRouting';
import type { GpgpuExecutionRoute, LayerExecutionRoute } from './sceneRenderRoutingTypes';
import { buildLayerSimulationAdapterBridgePlanFromRouting } from './simulationAdapterBridge';

export interface ProjectExecutionRoutingBuildOptions {
  gpgpuWebgpuAvailable?: boolean;
}

interface LayerRoutingInput {
  key: 'layer2' | 'layer3';
  label: 'Layer 2' | 'Layer 3';
  layerIndex: 2 | 3;
  enabled: boolean;
  mode: ParticleConfig['layer2Type'];
  source: ParticleConfig['layer2Source'];
  connectionEnabled: boolean;
  connectionStyle: ParticleConfig['layer2ConnectionStyle'];
  geometry: ParticleConfig['layer2GeomMode3D'];
}

interface GpgpuRoutingInput {
  enabled: boolean;
  count: number;
  requestedBackend: ParticleConfig['gpgpuExecutionPreference'];
  webgpuToggle: boolean;
  geomMode: ParticleConfig['gpgpuGeomMode'];
  metaballEnabled: boolean;
  metaballResolution: number;
  volumetricEnabled: boolean;
  volumetricSteps: number;
  ribbonEnabled: boolean;
  tubeEnabled: boolean;
  smoothTubeEnabled: boolean;
}

function uniqueFlags(values: Array<ProjectCapabilityFlag | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is ProjectCapabilityFlag => Boolean(value))));
}

function getLayerRoutingInput(config: ParticleConfig, layerIndex: 2 | 3): LayerRoutingInput {
  return layerIndex === 2
    ? {
      key: 'layer2',
      label: 'Layer 2',
      layerIndex: 2,
      enabled: config.layer2Enabled,
      mode: config.layer2Type,
      source: config.layer2Source,
      connectionEnabled: config.layer2ConnectionEnabled,
      connectionStyle: config.layer2ConnectionStyle,
      geometry: config.layer2GeomMode3D,
    }
    : {
      key: 'layer3',
      label: 'Layer 3',
      layerIndex: 3,
      enabled: config.layer3Enabled,
      mode: config.layer3Type,
      source: config.layer3Source,
      connectionEnabled: config.layer3ConnectionEnabled,
      connectionStyle: config.layer3ConnectionStyle,
      geometry: config.layer3GeomMode3D,
    };
}

function getGpgpuRoutingInput(config: ParticleConfig): GpgpuRoutingInput {
  return {
    enabled: config.gpgpuEnabled,
    count: config.gpgpuCount,
    requestedBackend: config.gpgpuExecutionPreference,
    webgpuToggle: config.gpgpuWebGPUEnabled,
    geomMode: config.gpgpuGeomMode,
    metaballEnabled: config.gpgpuMetaballEnabled,
    metaballResolution: config.gpgpuMetaballResolution,
    volumetricEnabled: config.gpgpuVolumetricEnabled,
    volumetricSteps: config.gpgpuVolumetricSteps,
    ribbonEnabled: config.gpgpuRibbonEnabled,
    tubeEnabled: config.gpgpuTubeEnabled,
    smoothTubeEnabled: config.gpgpuSmoothTubeEnabled,
  };
}

export function getExecutionHybridKind(resolvedEngine: string, reason: string, proceduralSystemId: string | null): string | null {
  if (resolvedEngine !== 'hybrid-runtime') return null;
  if (proceduralSystemId === 'volume-fog') return 'volumetric';
  if (proceduralSystemId === 'surface-shell') return 'sdf-shell';
  if (proceduralSystemId === 'surface-patch') return 'patch';
  if (proceduralSystemId === 'fiber-field') return 'fiber';
  if (proceduralSystemId === 'crystal-aggregate') return 'granular';
  if (proceduralSystemId === 'membrane') return 'membrane';
  if (reason.includes('volumetric')) return 'volumetric';
  if (reason.includes('sdf')) return 'sdf-shell';
  if (reason.includes('patch')) return 'patch';
  if (reason.includes('fiber')) return 'fiber';
  if (reason.includes('granular')) return 'granular';
  if (reason.includes('membrane')) return 'membrane';
  return 'hybrid';
}

function getLayerCapabilityFlags(config: ParticleConfig, layer: LayerRoutingInput, resolvedEngine: string, pathId: string): ProjectCapabilityFlag[] {
  const proceduralSystemId = getProceduralSystemId(layer.mode);
  const postStackId = inferPostFxStackBundleId(config);
  const hasHeavyPost = postStackId === 'dream-smear' || postStackId === 'retro-feedback';
  const renderPrimitive = getDepictionArchitecture(layer.mode).renderPrimitive;
  const hasHeavySurface = proceduralSystemId === 'volume-fog'
    || proceduralSystemId === 'crystal-aggregate'
    || proceduralSystemId === 'voxel-lattice'
    || proceduralSystemId === 'crystal-deposition';
  const usesHybrid = resolvedEngine === 'hybrid-runtime';
  const prefersWebgpu = usesHybrid || (config.gpgpuEnabled && (config.gpgpuExecutionPreference === 'webgpu' || config.gpgpuWebGPUEnabled));
  const riskyForMobile = usesHybrid
    || hasHeavySurface
    || hasHeavyPost
    || (renderPrimitive === 'instanced solids' && layer.geometry !== 'billboard')
    || (layer.connectionEnabled && layer.connectionStyle !== 'classic')
    || layer.source === 'video';
  const exportOnly = proceduralSystemId === 'volume-fog'
    || (hasHeavySurface && pathId !== 'points')
    || (renderPrimitive === 'instanced solids' && layer.source === 'video');

  return uniqueFlags([
    resolvedEngine === 'cpu-geometry' || resolvedEngine === 'webgl-particle' || resolvedEngine === 'webgl-procedural-surface' ? 'webgl-stable' : null,
    prefersWebgpu ? 'webgpu-preferred' : null,
    exportOnly ? 'export-only' : null,
    riskyForMobile ? 'mobile-risky' : null,
  ]);
}

function getGpgpuCapabilityFlags(input: GpgpuRoutingInput, foundation: ReturnType<typeof resolveGpgpuExecutionFoundation>): ProjectCapabilityFlag[] {
  const heavyFeatureEnabled = input.metaballEnabled
    || input.volumetricEnabled
    || input.smoothTubeEnabled
    || input.ribbonEnabled
    || input.tubeEnabled;
  const exportOnly = (input.metaballEnabled && input.metaballResolution >= 48)
    || (input.volumetricEnabled && input.volumetricSteps >= 80)
    || (input.count >= 262144 && heavyFeatureEnabled);
  const mobileRisky = heavyFeatureEnabled || input.count >= 131072;

  return uniqueFlags([
    foundation.backend === 'webgl-gpgpu' ? 'webgl-stable' : null,
    foundation.backend === 'webgpu-compute' || foundation.requestedBackend === 'webgpu-compute' ? 'webgpu-preferred' : null,
    exportOnly ? 'export-only' : null,
    mobileRisky ? 'mobile-risky' : null,
  ]);
}

function getLayerRenderClass(layer: LayerRoutingInput) {
  const depiction = getDepictionArchitecture(layer.mode);
  if (layer.connectionEnabled && layer.connectionStyle === 'brush') return 'brush-connection-lines';
  if (layer.connectionEnabled && layer.connectionStyle === 'filament') return 'filament-connection-lines';
  return depiction.depictionClass;
}

function buildLayerExecutionRouting(config: ParticleConfig, layerIndex: 2 | 3): ProjectExecutionRoutingSnapshot {
  const layer = getLayerRoutingInput(config, layerIndex);
  const resolved = resolveExecutionEngineForLayer(config, layerIndex);
  const routing: ProjectExecutionRoutingSnapshot = {
    key: layer.key,
    label: layer.label,
    enabled: layer.enabled,
    mode: layer.mode,
    renderClass: getLayerRenderClass(layer),
    simulationClass: 'unknown',
    requestedEngine: resolved.requestedEngineId,
    resolvedEngine: resolved.resolvedEngineId,
    path: resolved.pathId,
    overrideId: resolved.overrideId,
    proceduralSystemId: resolved.proceduralSystemId,
    hybridKind: getExecutionHybridKind(resolved.resolvedEngineId, resolved.reason, resolved.proceduralSystemId),
    capabilityFlags: getLayerCapabilityFlags(config, layer, resolved.resolvedEngineId, resolved.pathId),
    reason: resolved.reason,
    notes: [],
    sceneBranches: [],
  };
  const bridge = buildLayerSimulationAdapterBridgePlanFromRouting(routing, layer.source);
  routing.simulationClass = bridge.adapterId;
  routing.notes = [
    bridge.sourceFieldMode !== 'legacy-source' ? `source-field:${bridge.sourceFieldMode}` : null,
    bridge.supportsDistanceField ? 'distance-field ready' : null,
    bridge.supportsFlowSampling ? 'flow-sampling ready' : null,
    bridge.supportsVolumeOccupancy ? 'volume-occupancy ready' : null,
  ].filter((value): value is string => Boolean(value));
  routing.sceneBranches = getLayerSceneBranches(config, layerIndex, routing as LayerExecutionRoute);
  return routing;
}

function buildLayer1ExecutionRouting(config: ParticleConfig): ProjectExecutionRoutingSnapshot {
  const capabilityFlags = uniqueFlags([
    'webgl-stable',
    config.layer1Count > 1800 || inferPostFxStackBundleId(config) === 'dream-smear' ? 'mobile-risky' : null,
  ]);
  return {
    key: 'layer1',
    label: 'Layer 1',
    enabled: config.layer1Enabled,
    mode: 'spheres',
    renderClass: 'point-cloud',
    simulationClass: 'cpu-noise-field',
    requestedEngine: 'cpu-geometry',
    resolvedEngine: 'cpu-geometry',
    path: 'points',
    overrideId: 'baseline',
    proceduralSystemId: null,
    hybridKind: null,
    capabilityFlags,
    reason: 'baseline particle layer',
    notes: [config.layer1SdfEnabled ? 'sdf-lighting enabled' : 'classic sprite path'],
    sceneBranches: ['particle-core'],
  };
}

function buildGpgpuExecutionRouting(
  config: ParticleConfig,
  options: ProjectExecutionRoutingBuildOptions = {},
): ProjectExecutionRoutingSnapshot {
  const input = getGpgpuRoutingInput(config);
  const foundation = resolveGpgpuExecutionFoundation(config, {
    webgpuAvailable: options.gpgpuWebgpuAvailable,
  });
  const renderClass = input.metaballEnabled
    ? 'metaball-surface'
    : input.volumetricEnabled
      ? 'volumetric-field'
      : (input.smoothTubeEnabled || input.ribbonEnabled || input.tubeEnabled)
        ? 'trail-geometry'
        : 'gpu-particles';
  const simulationTokens = [
    foundation.backend,
    ...foundation.features.filter((feature) => feature !== 'particles'),
  ];
  const routing: ProjectExecutionRoutingSnapshot = {
    key: 'gpgpu',
    label: 'GPGPU',
    enabled: input.enabled,
    mode: foundation.features.includes('metaball') ? 'metaball' : foundation.path,
    renderClass,
    simulationClass: simulationTokens.join(' + ') || foundation.backend,
    requestedEngine: foundation.requestedBackend,
    resolvedEngine: foundation.backend,
    path: foundation.path,
    overrideId: 'auto',
    proceduralSystemId: null,
    hybridKind: foundation.backend === 'webgpu-compute' ? 'compute' : null,
    capabilityFlags: getGpgpuCapabilityFlags(input, foundation),
    reason: foundation.reason,
    notes: [
      foundation.supportedFeatures.length > 0 ? `supported:${foundation.supportedFeatures.join(', ')}` : null,
      foundation.unsupportedFeatures.length > 0 ? `unsupported:${foundation.unsupportedFeatures.join(', ')}` : null,
    ].filter((value): value is string => Boolean(value)),
    sceneBranches: [],
  };
  routing.sceneBranches = getGpgpuSceneBranches(config, routing as GpgpuExecutionRoute);
  return routing;
}

export function buildProjectExecutionRouting(
  config: ParticleConfig,
  options: ProjectExecutionRoutingBuildOptions = {},
): ProjectExecutionRoutingSnapshot[] {
  return [
    buildLayer1ExecutionRouting(config),
    buildLayerExecutionRouting(config, 2),
    buildLayerExecutionRouting(config, 3),
    buildGpgpuExecutionRouting(config, options),
  ];
}

export function buildProjectExecutionRoutingMap(
  config: ParticleConfig,
  options: ProjectExecutionRoutingBuildOptions = {},
): Record<ProjectLayerSnapshotKey, ProjectExecutionRoutingSnapshot> {
  const entries = buildProjectExecutionRouting(config, options);
  return entries.reduce((acc, entry) => {
    acc[entry.key] = entry;
    return acc;
  }, {} as Record<ProjectLayerSnapshotKey, ProjectExecutionRoutingSnapshot>);
}

export function getProjectExecutionRoutingEntry(
  config: ParticleConfig,
  key: ProjectLayerSnapshotKey,
  options: ProjectExecutionRoutingBuildOptions = {},
): ProjectExecutionRoutingSnapshot | undefined {
  return buildProjectExecutionRouting(config, options).find((item) => item.key === key);
}

export function getLayerExecutionRoutingSnapshot(
  config: ParticleConfig,
  layerIndex: 2 | 3,
): ProjectExecutionRoutingSnapshot {
  return buildLayerExecutionRouting(config, layerIndex);
}

export function getExecutionCapabilityFlagsForLayer(config: ParticleConfig, key: ProjectLayerSnapshotKey): ProjectCapabilityFlag[] {
  const entry = getProjectExecutionRoutingEntry(config, key);
  return entry?.capabilityFlags ?? [];
}
