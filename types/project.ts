import type { ParticleConfig } from './config';
import type { PresetRecord } from './presets';
import type { PresetSequenceItem } from './sequence';

export type ProjectLayerSnapshotKey = 'layer1' | 'layer2' | 'layer3' | 'gpgpu';
export type ProjectCapabilityFlag = 'webgl-stable' | 'webgpu-preferred' | 'export-only' | 'mobile-risky';

export interface ProjectUiState {
  isPlaying: boolean;
  isPanelOpen: boolean;
  videoExportMode: 'current' | 'sequence';
  videoDurationSeconds: number;
  videoFps: number;
}

export interface ProjectSerializationBlock {
  id: string;
  label: string;
  values: string[];
}

export interface ProjectLayerSerializationBlocks {
  source: ProjectSerializationBlock;
  simulation: ProjectSerializationBlock;
  primitive: ProjectSerializationBlock;
  shading: ProjectSerializationBlock;
  postfx: ProjectSerializationBlock;
  execution: ProjectSerializationBlock;
}

export interface ProjectLayerSerializationSnapshot {
  key: ProjectLayerSnapshotKey;
  label: string;
  modeId: string;
  blocks: ProjectLayerSerializationBlocks;
}

export interface ProjectExecutionRoutingSnapshot {
  key: ProjectLayerSnapshotKey;
  label: string;
  enabled: boolean;
  mode: string;
  renderClass: string;
  simulationClass: string;
  requestedEngine: string;
  resolvedEngine: string;
  path: string;
  overrideId: string;
  proceduralSystemId: string | null;
  hybridKind: string | null;
  capabilityFlags: ProjectCapabilityFlag[];
  reason: string;
  notes: string[];
  sceneBranches?: string[];
}

export interface ProjectLayerSnapshot {
  key: ProjectLayerSnapshotKey;
  label: string;
  enabled: boolean;
  mode: string;
  source?: string;
  material?: string;
  geometry?: string;
  connectionStyle?: string;
  features: string[];
  capabilityFlags?: ProjectCapabilityFlag[];
}

export interface ProjectProductPackScorecardSummary {
  id: string;
  label: string;
  family: string;
  coverageScore: number;
  targetHitCount: number;
  targetTotal: number;
  emphasis: string[];
  solverFamilies: string[];
  specialistFamilies: string[];
  physicalFamilies: string[];
  geometryFamilies: string[];
  temporalFamilies: string[];
  missingTargets: string[];
}

export interface ProjectCoverageAxisRollupSummary {
  covered: string[];
  missing: string[];
  hitCount: number;
  targetCount: number;
  ratio: number;
}

export interface ProjectCoverageRollupSummary {
  coverageScore: number;
  targetHitCount: number;
  targetTotal: number;
  averagePackCoverageScore: number;
  bestPackId: string | null;
  bestPackLabel: string | null;
  bestPackCoverageScore: number;
  sourceAxis: ProjectCoverageAxisRollupSummary;
  renderAxis: ProjectCoverageAxisRollupSummary;
  postAxis: ProjectCoverageAxisRollupSummary;
  computeAxis: ProjectCoverageAxisRollupSummary;
  motionAxis: ProjectCoverageAxisRollupSummary;
  solverAxis: ProjectCoverageAxisRollupSummary;
  specialistAxis: ProjectCoverageAxisRollupSummary;
  physicalAxis: ProjectCoverageAxisRollupSummary;
  geometryAxis: ProjectCoverageAxisRollupSummary;
  temporalAxis: ProjectCoverageAxisRollupSummary;
  missingTargets: string[];
}

export interface ProjectAugmentationSuggestionSummary {
  id: string;
  label: string;
  family: string;
  coverageGain: number;
  resultCoverageScore: number;
  resultTargetHitCount: number;
  coveredGapTargets: string[];
}

export interface ProjectCoverageSummary {
  depictionMethods: string[];
  motionFamilies: string[];
  computeBackends: string[];
  sourceFamilies: string[];
  renderFamilies: string[];
  postFamilies: string[];
  solverFamilies: string[];
  specialistFamilies: string[];
  physicalFamilies: string[];
  geometryFamilies: string[];
  temporalFamilies: string[];
  productPackFamilies: string[];
  productPacks: string[];
  postStackTemplates: string[];
  activePostStackId: string | null;
  activeProductPackId: string | null;
  gpgpuFeatures: string[];
  gapTargets: string[];
  productPackScorecards: ProjectProductPackScorecardSummary[];
  coverageRollup: ProjectCoverageRollupSummary;
  augmentationSuggestions: ProjectAugmentationSuggestionSummary[];
}

export interface ProjectManifestStats {
  presetCount: number;
  sequenceCount: number;
  enabledLayerCount: number;
  mediaSourceCount: number;
  textSourceCount: number;
  proceduralModeCount: number;
  distinctMaterialCount: number;
  depictionMethodCount: number;
  motionFamilyCount: number;
  computeBackendCount: number;
  sourceFamilyCount: number;
  renderFamilyCount: number;
  postFamilyCount: number;
  solverFamilyCount: number;
  specialistFamilyCount: number;
  physicalFamilyCount: number;
  geometryFamilyCount: number;
  temporalFamilyCount: number;
  productPackFamilyCount: number;
  productPackCount: number;
  postStackTemplateCount: number;
  gpgpuFeatureCount: number;
  coverageGapCount: number;
  productPackScorecardCount: number;
  activeProductPackCoverageScore: number;
  currentCoverageScore: number;
  currentTargetHitCount: number;
  currentTargetTotal: number;
  overallCoverageScore: number;
  overallTargetHitCount: number;
  overallTargetTotal: number;
  averagePackCoverageScore: number;
  bestPackCoverageScore: number;
  augmentationSuggestionCount: number;
}

export interface ProjectManifest {
  schemaVersion: number;
  serializationSchemaVersion: number;
  layers: ProjectLayerSnapshot[];
  execution: ProjectExecutionRoutingSnapshot[];
  coverage: ProjectCoverageSummary;
  stats: ProjectManifestStats;
}

export interface ProjectExportSchema {
  format: 'monosphere-project';
  projectDataVersion: number;
  manifestSchemaVersion: number;
  serializationSchemaVersion: number;
  migrationState: 'native' | 'migrated';
  migratedFromProjectDataVersion: number | null;
}

export interface ProjectSerializationSnapshot {
  schemaVersion: number;
  layers: ProjectLayerSerializationSnapshot[];
}

export interface ProjectData {
  version: number;
  schema: ProjectExportSchema;
  exportedAt: string;
  name: string;
  currentConfig: ParticleConfig;
  activePresetId: string | null;
  presetBlendDuration: number;
  sequenceLoopEnabled: boolean;
  presets: PresetRecord[];
  presetSequence: PresetSequenceItem[];
  ui: ProjectUiState;
  serialization: ProjectSerializationSnapshot;
  manifest: ProjectManifest;
}
