import type { Layer3Source } from '../types';

export type SourceFieldKind = 'point-cloud' | 'surface-mask' | 'distance-field' | 'curve-seed' | 'volume-seed';
export type SourceInjectionStrategy = 'scatter' | 'surface-project' | 'distance-project' | 'curve-follow' | 'volume-fill';
export type SourceFieldMode = 'legacy-source' | 'unified-field';

export interface SourceFieldFoundation {
  source: Layer3Source;
  fieldKind: SourceFieldKind;
  injectionStrategy: SourceInjectionStrategy;
  sourceFieldMode: SourceFieldMode;
  dimensionality: '2d' | '3d';
  supportsDistanceField: boolean;
  supportsFlowSampling: boolean;
  supportsVolumeOccupancy: boolean;
}

const SOURCE_FIELD_MAP: Record<Layer3Source, Omit<SourceFieldFoundation, 'source'>> = {
  sphere: { fieldKind: 'distance-field', injectionStrategy: 'distance-project', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: true },
  center: { fieldKind: 'point-cloud', injectionStrategy: 'scatter', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: false, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  ring: { fieldKind: 'curve-seed', injectionStrategy: 'curve-follow', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: false, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  disc: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  cube: { fieldKind: 'distance-field', injectionStrategy: 'distance-project', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: true },
  cylinder: { fieldKind: 'distance-field', injectionStrategy: 'distance-project', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: true },
  random: { fieldKind: 'point-cloud', injectionStrategy: 'scatter', sourceFieldMode: 'legacy-source', dimensionality: '3d', supportsDistanceField: false, supportsFlowSampling: false, supportsVolumeOccupancy: false },
  cone: { fieldKind: 'distance-field', injectionStrategy: 'distance-project', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: true },
  torus: { fieldKind: 'distance-field', injectionStrategy: 'distance-project', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: true },
  spiral: { fieldKind: 'curve-seed', injectionStrategy: 'curve-follow', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: false, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  galaxy: { fieldKind: 'curve-seed', injectionStrategy: 'curve-follow', sourceFieldMode: 'unified-field', dimensionality: '3d', supportsDistanceField: false, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  grid: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  plane: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  image: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  video: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
  text: { fieldKind: 'surface-mask', injectionStrategy: 'surface-project', sourceFieldMode: 'unified-field', dimensionality: '2d', supportsDistanceField: true, supportsFlowSampling: true, supportsVolumeOccupancy: false },
};

export function getSourceFieldFoundation(source: Layer3Source): SourceFieldFoundation {
  return { source, ...SOURCE_FIELD_MAP[source] };
}

export function resolveSourceFieldMode(source: Layer3Source): SourceFieldMode {
  return getSourceFieldFoundation(source).sourceFieldMode;
}

export function getSourcesForFieldKind(fieldKind: SourceFieldKind): Layer3Source[] {
  return (Object.keys(SOURCE_FIELD_MAP) as Layer3Source[]).filter((source) => SOURCE_FIELD_MAP[source].fieldKind === fieldKind);
}
