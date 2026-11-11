import type { Layer2Type, Layer3Source } from '../types';
import { getMotionArchitecture } from './motionArchitecture';
import { getMotionGroupName } from './motionGrouping';
import { buildModeSimulationAdapterBridgePlan } from './simulationAdapterBridge';

export interface ModeExecutionManifestEntry {
  mode: Layer2Type;
  group: string;
  driver: string;
  editingProfile: string;
  depictionHint: string;
  source: Layer3Source;
  requestedEngineId: string;
  resolvedEngineId: string;
  pathId: string;
  proceduralSystemId: string | null;
  adapterId: string;
  sourceFieldKind: string;
  sourceFieldMode: string;
  injectionStrategy: string;
}

export function getModeExecutionManifestEntry(mode: Layer2Type, source: Layer3Source = 'sphere'): ModeExecutionManifestEntry {
  const architecture = getMotionArchitecture(mode);
  const bridge = buildModeSimulationAdapterBridgePlan(mode, source);
  return {
    mode,
    group: getMotionGroupName(mode),
    driver: architecture.driver,
    editingProfile: architecture.editingProfile,
    depictionHint: architecture.depictionHint,
    source,
    requestedEngineId: bridge.requestedEngineId,
    resolvedEngineId: bridge.resolvedEngineId,
    pathId: bridge.pathId,
    proceduralSystemId: bridge.proceduralSystemId,
    adapterId: bridge.adapterId,
    sourceFieldKind: bridge.sourceFieldKind,
    sourceFieldMode: bridge.sourceFieldMode,
    injectionStrategy: bridge.injectionStrategy,
  };
}
