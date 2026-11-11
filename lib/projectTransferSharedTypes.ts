import type { PresetRecord, PresetSequenceItem, ProjectData } from '../types';
import { parseProjectData } from './projectState';

export interface PrepareImportedProjectDataOptions {
  existingPresetIds?: Iterable<string>;
  existingSequenceIds?: Iterable<string>;
  createIdSuffix?: () => string;
  importMode?: 'replace' | 'merge';
}

export interface ProjectImportPreparationDiagnostics {
  remappedPresetIdCount: number;
  regeneratedSequenceIdCount: number;
  droppedOrphanSequenceCount: number;
  activePresetFallbackApplied: boolean;
}

export interface ProjectImportInspectionResult {
  parsed: ProjectData | null;
  errorCode: 'invalid-json' | 'invalid-project-payload' | null;
  message: string | null;
}

export interface ProjectImportIdChange {
  index: number;
  sourceId: string;
  importedId: string | null;
  changed: boolean;
}

export interface ProjectImportSequenceIdChange extends ProjectImportIdChange {
  sourcePresetId: string;
  importedPresetId: string | null;
  dropped: boolean;
}

export interface ProjectImportPresetContentChange {
  index: number;
  sourceId: string;
  importedId: string | null;
  nameChanged: boolean;
  configChanged: boolean;
  timestampChanged: boolean;
}

export interface ProjectImportSequenceContentChange {
  index: number;
  sourceId: string;
  importedId: string | null;
  labelChanged: boolean;
  timingChanged: boolean;
  driveChanged: boolean;
  keyframeChanged: boolean;
  presetReferenceChanged: boolean;
  dropped: boolean;
}

export interface ProjectImportPreparationSummary {
  presetIdChangedCount: number;
  sequenceIdChangedCount: number;
  droppedOrphanSequenceCount: number;
  retainedPresetIdCount: number;
  retainedSequenceIdCount: number;
  preservedPresetPayloadCount: number;
  preservedSequencePayloadCount: number;
  presetReferenceRemapCount: number;
}

export interface ProjectImportPreparationReport {
  presetIdChanges: ProjectImportIdChange[];
  sequenceIdChanges: ProjectImportSequenceIdChange[];
  presetContentChanges: ProjectImportPresetContentChange[];
  sequenceContentChanges: ProjectImportSequenceContentChange[];
  droppedOrphanSequenceIds: string[];
  summary: ProjectImportPreparationSummary;
}

export interface PreparedImportedProjectData {
  project: ProjectData;
  importedPresets: PresetRecord[];
  importedSequence: PresetSequenceItem[];
  remappedActivePresetId: string | null;
  presetIdRemap: Map<string, string>;
  sequenceIdRemap: Map<string, string>;
  sourcePresetIds: string[];
  retainedSourceSequenceIds: string[];
  droppedOrphanSequenceIds: string[];
  diagnostics: ProjectImportPreparationDiagnostics;
}

export function buildProjectExportFileName(exportedAt: string = new Date().toISOString()) {
  return `monosphere-project-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

export function serializeProjectData(project: ProjectData) {
  return JSON.stringify(project, null, 2);
}

export function inspectProjectDataText(text: string): ProjectImportInspectionResult {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      parsed: null,
      errorCode: 'invalid-json',
      message: 'Invalid project JSON syntax.',
    };
  }

  const parsed = parseProjectData(payload);
  if (!parsed) {
    return {
      parsed: null,
      errorCode: 'invalid-project-payload',
      message: 'JSON parsed, but this file is not a supported project export.',
    };
  }

  return {
    parsed,
    errorCode: null,
    message: null,
  };
}

export function parseProjectDataText(text: string): ProjectData | null {
  return inspectProjectDataText(text).parsed;
}

export function createProjectImportIdSuffix() {
  return Math.random().toString(36).slice(2, 8);
}
