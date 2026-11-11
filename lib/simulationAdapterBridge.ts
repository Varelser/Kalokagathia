import type { Layer2Type, Layer3Source, ParticleConfig, ProjectExecutionRoutingSnapshot } from '../types';
import { resolveExecutionEngineForLayer, getModeExecutionFoundation } from './executionFoundation';
import { getSimulationAdapterForMode, SIMULATION_ADAPTERS } from './simulationAdapter';
import { getSourceFieldFoundation } from './sourceFieldFoundation';

export interface SimulationAdapterBridgePlan {
  mode: Layer2Type;
  source: Layer3Source;
  requestedEngineId: string;
  resolvedEngineId: string;
  pathId: string;
  proceduralSystemId: string | null;
  adapterId: keyof typeof SIMULATION_ADAPTERS;
  adapterLabel: string;
  sourceFieldKind: string;
  sourceFieldMode: string;
  injectionStrategy: string;
  supportsDistanceField: boolean;
  supportsFlowSampling: boolean;
  supportsVolumeOccupancy: boolean;
  reason: string;
}

function buildSimulationAdapterBridgePlan(args: {
  mode: Layer2Type;
  source: Layer3Source;
  requestedEngineId: string;
  resolvedEngineId: string;
  pathId: string;
  proceduralSystemId: string | null;
}): SimulationAdapterBridgePlan {
  const { mode, source, requestedEngineId, resolvedEngineId, pathId, proceduralSystemId } = args;
  const adapter = getSimulationAdapterForMode(mode);
  const sourceField = getSourceFieldFoundation(source);
  return {
    mode,
    source,
    requestedEngineId,
    resolvedEngineId,
    pathId,
    proceduralSystemId,
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    sourceFieldKind: sourceField.fieldKind,
    sourceFieldMode: sourceField.sourceFieldMode,
    injectionStrategy: sourceField.injectionStrategy,
    supportsDistanceField: sourceField.supportsDistanceField,
    supportsFlowSampling: sourceField.supportsFlowSampling,
    supportsVolumeOccupancy: sourceField.supportsVolumeOccupancy,
    reason: resolvedEngineId !== requestedEngineId ? 'layer override/runtime resolve' : 'mode foundation',
  };
}

export function buildModeSimulationAdapterBridgePlan(mode: Layer2Type, source: Layer3Source, resolvedEngineId?: string): SimulationAdapterBridgePlan {
  const foundation = getModeExecutionFoundation(mode);
  return buildSimulationAdapterBridgePlan({
    mode,
    source,
    requestedEngineId: foundation.engineId,
    resolvedEngineId: resolvedEngineId ?? foundation.engineId,
    pathId: foundation.pathId,
    proceduralSystemId: foundation.proceduralSystemId,
  });
}

export function buildLayerSimulationAdapterBridgePlanFromRouting(
  route: Pick<ProjectExecutionRoutingSnapshot, 'mode' | 'requestedEngine' | 'resolvedEngine' | 'path' | 'proceduralSystemId'>,
  source: Layer3Source,
): SimulationAdapterBridgePlan {
  return buildSimulationAdapterBridgePlan({
    mode: route.mode as Layer2Type,
    source,
    requestedEngineId: route.requestedEngine,
    resolvedEngineId: route.resolvedEngine,
    pathId: route.path,
    proceduralSystemId: route.proceduralSystemId,
  });
}

export function buildLayerSimulationAdapterBridgePlan(config: ParticleConfig, layerIndex: 2 | 3): SimulationAdapterBridgePlan {
  const resolved = resolveExecutionEngineForLayer(config, layerIndex);
  const source = layerIndex === 2 ? config.layer2Source : config.layer3Source;
  return buildSimulationAdapterBridgePlan({
    mode: resolved.mode,
    source,
    requestedEngineId: resolved.requestedEngineId,
    resolvedEngineId: resolved.resolvedEngineId,
    pathId: resolved.pathId,
    proceduralSystemId: resolved.proceduralSystemId,
  });
}
