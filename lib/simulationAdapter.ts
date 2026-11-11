import type { Layer2Type } from '../types';
import { getModeExecutionFoundation } from './executionFoundation';

export type SimulationAdapterId =
  | 'cpu-particle-layout'
  | 'webgl-particle-field'
  | 'webgl-procedural-family'
  | 'webgl-gpgpu-state'
  | 'webgpu-compute-state'
  | 'hybrid-field-runtime';

export type SimulationAdapterPath = 'points' | 'lines' | 'surface' | 'volume' | 'voxel' | 'trail' | 'mixed';

export interface SimulationAdapterDefinition {
  id: SimulationAdapterId;
  label: string;
  supportedPaths: SimulationAdapterPath[];
  stateDomain: 'cpu' | 'gpu' | 'hybrid';
  sourceFieldMode: 'legacy-source' | 'unified-field';
  deterministicReset: boolean;
  supportsReadback: boolean;
  supportsNeighborOps: boolean;
  supportsVolumeState: boolean;
}

export const SIMULATION_ADAPTERS: Record<SimulationAdapterId, SimulationAdapterDefinition> = {
  'cpu-particle-layout': { id: 'cpu-particle-layout', label: 'CPU Layout', supportedPaths: ['points', 'lines'], stateDomain: 'cpu', sourceFieldMode: 'legacy-source', deterministicReset: true, supportsReadback: true, supportsNeighborOps: false, supportsVolumeState: false },
  'webgl-particle-field': { id: 'webgl-particle-field', label: 'WebGL Particle', supportedPaths: ['points', 'lines', 'mixed'], stateDomain: 'gpu', sourceFieldMode: 'legacy-source', deterministicReset: true, supportsReadback: false, supportsNeighborOps: false, supportsVolumeState: false },
  'webgl-procedural-family': { id: 'webgl-procedural-family', label: 'Procedural Surface', supportedPaths: ['surface', 'volume', 'voxel', 'trail'], stateDomain: 'gpu', sourceFieldMode: 'legacy-source', deterministicReset: true, supportsReadback: false, supportsNeighborOps: false, supportsVolumeState: false },
  'webgl-gpgpu-state': { id: 'webgl-gpgpu-state', label: 'WebGL GPGPU', supportedPaths: ['points', 'lines', 'surface', 'volume', 'mixed'], stateDomain: 'gpu', sourceFieldMode: 'legacy-source', deterministicReset: true, supportsReadback: true, supportsNeighborOps: true, supportsVolumeState: false },
  'webgpu-compute-state': { id: 'webgpu-compute-state', label: 'WebGPU Compute', supportedPaths: ['points', 'lines', 'surface', 'volume', 'voxel', 'mixed'], stateDomain: 'gpu', sourceFieldMode: 'unified-field', deterministicReset: true, supportsReadback: true, supportsNeighborOps: true, supportsVolumeState: true },
  'hybrid-field-runtime': { id: 'hybrid-field-runtime', label: 'Hybrid Runtime', supportedPaths: ['surface', 'volume', 'voxel', 'trail', 'mixed'], stateDomain: 'hybrid', sourceFieldMode: 'unified-field', deterministicReset: true, supportsReadback: false, supportsNeighborOps: false, supportsVolumeState: true },
};

export function getSimulationAdapterForMode(mode: Layer2Type): SimulationAdapterDefinition {
  const foundation = getModeExecutionFoundation(mode);
  if (foundation.engineId === 'webgl-particle') return SIMULATION_ADAPTERS['webgl-particle-field'];
  if (foundation.engineId === 'webgl-gpgpu') return SIMULATION_ADAPTERS['webgl-gpgpu-state'];
  if (foundation.engineId === 'webgpu-compute') return SIMULATION_ADAPTERS['webgpu-compute-state'];
  if (foundation.engineId === 'hybrid-runtime') return SIMULATION_ADAPTERS['hybrid-field-runtime'];
  if (foundation.engineId === 'cpu-geometry') return SIMULATION_ADAPTERS['cpu-particle-layout'];
  return SIMULATION_ADAPTERS['webgl-procedural-family'];
}
