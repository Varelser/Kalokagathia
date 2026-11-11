import type { Layer2Type, ParticleConfig } from '../types';
import { getProceduralSystemId } from './proceduralModeRegistry';

export type ExecutionEngineId = 'auto' | 'cpu-geometry' | 'webgl-particle' | 'webgl-procedural-surface' | 'webgl-gpgpu' | 'webgpu-compute' | 'hybrid-runtime';
export type ExecutionPathId = 'points' | 'lines' | 'surface' | 'volume' | 'voxel' | 'trail' | 'mixed';

export interface ModeExecutionFoundation {
  mode: Layer2Type;
  proceduralSystemId: ReturnType<typeof getProceduralSystemId>;
  engineId: Exclude<ExecutionEngineId, 'auto'>;
  pathId: ExecutionPathId;
}

export function getModeExecutionFoundation(mode: Layer2Type): ModeExecutionFoundation {
  const proceduralSystemId = getProceduralSystemId(mode);
  if (proceduralSystemId === 'volume-fog') return { mode, proceduralSystemId, engineId: 'webgl-procedural-surface', pathId: 'volume' };
  if (proceduralSystemId === 'voxel-lattice') return { mode, proceduralSystemId, engineId: 'webgl-procedural-surface', pathId: 'voxel' };
  if (proceduralSystemId === 'erosion-trail') return { mode, proceduralSystemId, engineId: 'webgl-procedural-surface', pathId: 'trail' };
  if (proceduralSystemId) return { mode, proceduralSystemId, engineId: 'webgl-procedural-surface', pathId: 'surface' };
  return { mode, proceduralSystemId, engineId: 'webgl-particle', pathId: 'points' };
}

export function resolveExecutionEngineForLayer(config: ParticleConfig, layerIndex: 2 | 3) {
  const mode = layerIndex === 2 ? config.layer2Type : config.layer3Type;
  const overrideId = layerIndex === 2 ? config.layer2ExecutionEngineOverride : config.layer3ExecutionEngineOverride;
  const foundation = getModeExecutionFoundation(mode);
  let resolvedEngineId: ModeExecutionFoundation['engineId'] = foundation.engineId;
  let reason = 'foundation default';
  if (overrideId && overrideId !== 'auto') {
    resolvedEngineId = overrideId;
    reason = `runtime override: ${overrideId}`;
  } else if (config.gpgpuEnabled && foundation.pathId === 'volume' && config.gpgpuVolumetricEnabled) {
    resolvedEngineId = 'hybrid-runtime';
    reason = config.gpgpuWebGPUEnabled ? 'volumetric hybrid field (webgpu-ready)' : 'volumetric hybrid field';
  } else if (config.hybridSdfEnabled && foundation.proceduralSystemId === 'surface-shell' && foundation.pathId === 'surface') {
    resolvedEngineId = 'hybrid-runtime';
    reason = 'hybrid sdf shell field';
  } else if (config.hybridPatchEnabled && foundation.proceduralSystemId === 'surface-patch' && foundation.pathId === 'surface') {
    resolvedEngineId = 'hybrid-runtime';
    reason = 'hybrid patch field';
  } else if (config.hybridFiberEnabled && foundation.proceduralSystemId === 'fiber-field' && foundation.pathId === 'surface') {
    resolvedEngineId = 'hybrid-runtime';
    reason = 'hybrid fiber field';
  } else if (config.hybridGranularEnabled && foundation.proceduralSystemId === 'crystal-aggregate' && foundation.pathId === 'surface') {
    resolvedEngineId = 'hybrid-runtime';
    reason = 'hybrid granular field';
  }
  else if (config.hybridMembraneEnabled && foundation.proceduralSystemId === 'membrane' && foundation.pathId === 'surface') {
    resolvedEngineId = 'hybrid-runtime';
    reason = 'hybrid membrane surface';
  }
  return {
    mode,
    overrideId,
    requestedEngineId: foundation.engineId,
    resolvedEngineId,
    pathId: foundation.pathId,
    proceduralSystemId: foundation.proceduralSystemId,
    reason,
  };
}
