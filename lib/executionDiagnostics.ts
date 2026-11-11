import type { ParticleConfig, ProjectCapabilityFlag } from '../types';
import { buildLayerSimulationAdapterBridgePlanFromRouting } from './simulationAdapterBridge';
import { resolveGpgpuExecutionFoundation } from './gpgpuExecutionFoundation';
import { buildProjectExecutionRouting } from './projectExecutionRouting';
import {
  getGpgpuSceneBranches,
  getLayerSceneBranches,
  type GpgpuExecutionRoute,
  type LayerExecutionRoute,
} from './sceneRenderRouting';

export interface ExecutionDiagnosticEntry {
  hybridKind: string | null;
  id: 'layer2' | 'layer3' | 'gpgpu';
  label: string;
  mode: string;
  engine: string;
  requestedEngine: string;
  overrideId: string;
  path: string;
  proceduralSystemId: string | null;
  reason: string;
  capabilityFlags: ProjectCapabilityFlag[];
  notes: string[];
  adapterId?: string;
  sourceFieldKind?: string;
  sourceFieldMode?: string;
  injectionStrategy?: string;
  features?: string[];
  supportedFeatures?: string[];
  unsupportedFeatures?: string[];
  sceneBranches: string[];
}

export function getExecutionDiagnostics(config: ParticleConfig): ExecutionDiagnosticEntry[] {
  const routing = buildProjectExecutionRouting(config);
  const layerEntries: ExecutionDiagnosticEntry[] = ([2, 3] as const).map((layerIndex): ExecutionDiagnosticEntry => {
    const entry = routing.find((item) => item.key === (layerIndex === 2 ? 'layer2' : 'layer3'));
    const source = layerIndex === 2 ? config.layer2Source : config.layer3Source;
    if (!entry) {
      return {
        id: layerIndex === 2 ? 'layer2' : 'layer3',
        label: layerIndex === 2 ? 'Layer 2' : 'Layer 3',
        hybridKind: null,
        mode: layerIndex === 2 ? config.layer2Type : config.layer3Type,
        engine: 'unknown',
        requestedEngine: 'unknown',
        overrideId: 'unknown',
        path: 'points',
        proceduralSystemId: null,
        reason: 'routing entry missing',
        capabilityFlags: [],
        notes: [],
        sceneBranches: [],
      };
    }
    const bridge = buildLayerSimulationAdapterBridgePlanFromRouting(entry, source);
    return {
      id: layerIndex === 2 ? 'layer2' : 'layer3',
      label: entry.label,
      hybridKind: entry.hybridKind,
      mode: entry.mode,
      engine: entry.resolvedEngine,
      requestedEngine: entry.requestedEngine,
      overrideId: entry.overrideId,
      path: entry.path,
      proceduralSystemId: entry.proceduralSystemId,
      reason: entry.reason,
      capabilityFlags: entry.capabilityFlags,
      notes: entry.notes,
      adapterId: bridge.adapterId,
      sourceFieldKind: bridge.sourceFieldKind,
      sourceFieldMode: bridge.sourceFieldMode,
      injectionStrategy: bridge.injectionStrategy,
      sceneBranches: getLayerSceneBranches(config, layerIndex, entry as LayerExecutionRoute),
    };
  });

  const gpgpu = resolveGpgpuExecutionFoundation(config);
  const gpgpuEntry = routing.find((item) => item.key === 'gpgpu');
  if (!gpgpu.enabled || !gpgpuEntry) return layerEntries;

  return [
    ...layerEntries,
    {
      id: 'gpgpu',
      label: gpgpuEntry.label,
      hybridKind: gpgpuEntry.hybridKind,
      mode: gpgpuEntry.mode,
      engine: gpgpuEntry.resolvedEngine,
      requestedEngine: gpgpuEntry.requestedEngine,
      overrideId: gpgpuEntry.overrideId,
      path: gpgpuEntry.path,
      proceduralSystemId: gpgpuEntry.proceduralSystemId,
      reason: gpgpuEntry.reason,
      capabilityFlags: gpgpuEntry.capabilityFlags,
      notes: gpgpuEntry.notes,
      features: gpgpu.features,
      supportedFeatures: gpgpu.supportedFeatures,
      unsupportedFeatures: gpgpu.unsupportedFeatures,
      sceneBranches: getGpgpuSceneBranches(config, gpgpuEntry as GpgpuExecutionRoute),
    },
  ];
}
