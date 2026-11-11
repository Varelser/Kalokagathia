import type { PresetSequenceItem, ProjectData } from '../types';
import type { PreparedImportedProjectData, ProjectImportPreparationDiagnostics, ProjectImportPreparationReport } from './projectTransferShared';
import { buildProjectImportDiagnosticsSuffix } from './projectTransferPrepare';

function stableCompare(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compareSequenceTiming(left: PresetSequenceItem, right: PresetSequenceItem) {
  return left.holdSeconds === right.holdSeconds
    && left.transitionSeconds === right.transitionSeconds
    && left.transitionEasing === right.transitionEasing;
}

function compareSequenceDrive(left: PresetSequenceItem, right: PresetSequenceItem) {
  return left.screenSequenceDriveMode === right.screenSequenceDriveMode
    && left.screenSequenceDriveStrengthMode === right.screenSequenceDriveStrengthMode
    && left.screenSequenceDriveStrengthOverride === right.screenSequenceDriveStrengthOverride
    && left.screenSequenceDriveMultiplier === right.screenSequenceDriveMultiplier;
}

export function buildProjectImportPreparationReport(prepared: PreparedImportedProjectData, sourceProject: ProjectData): ProjectImportPreparationReport {
  const presetIdChanges = sourceProject.presets.map((preset, index) => {
    const importedId = prepared.importedPresets[index]?.id ?? null;
    return {
      index,
      sourceId: preset.id,
      importedId,
      changed: importedId !== null && importedId !== preset.id,
    };
  });

  const sequenceIdChanges = sourceProject.presetSequence.map((item, index) => {
    const imported = prepared.importedSequence[index] ?? null;
    const dropped = prepared.droppedOrphanSequenceIds.includes(item.id);
    return {
      index,
      sourceId: item.id,
      importedId: imported?.id ?? null,
      changed: imported ? imported.id !== item.id : false,
      sourcePresetId: item.presetId,
      importedPresetId: imported?.presetId ?? null,
      dropped,
    };
  });

  const presetContentChanges = sourceProject.presets.map((preset, index) => {
    const imported = prepared.importedPresets[index] ?? null;
    return {
      index,
      sourceId: preset.id,
      importedId: imported?.id ?? null,
      nameChanged: imported ? imported.name !== preset.name : false,
      configChanged: imported ? !stableCompare(imported.config, preset.config) : false,
      timestampChanged: imported ? imported.createdAt !== preset.createdAt || imported.updatedAt !== preset.updatedAt : false,
    };
  });

  const sequenceContentChanges = sourceProject.presetSequence.map((item, index) => {
    const imported = prepared.importedSequence[index] ?? null;
    const dropped = prepared.droppedOrphanSequenceIds.includes(item.id);
    return {
      index,
      sourceId: item.id,
      importedId: imported?.id ?? null,
      labelChanged: imported ? imported.label !== item.label : false,
      timingChanged: imported ? !compareSequenceTiming(imported, item) : false,
      driveChanged: imported ? !compareSequenceDrive(imported, item) : false,
      keyframeChanged: imported ? !stableCompare(imported.keyframeConfig, item.keyframeConfig) : false,
      presetReferenceChanged: imported ? imported.presetId !== item.presetId : false,
      dropped,
    };
  });

  return {
    presetIdChanges,
    sequenceIdChanges,
    presetContentChanges,
    sequenceContentChanges,
    droppedOrphanSequenceIds: [...prepared.droppedOrphanSequenceIds],
    summary: {
      presetIdChangedCount: presetIdChanges.filter((entry) => entry.changed).length,
      sequenceIdChangedCount: sequenceIdChanges.filter((entry) => entry.changed).length,
      droppedOrphanSequenceCount: prepared.droppedOrphanSequenceIds.length,
      retainedPresetIdCount: presetIdChanges.filter((entry) => !entry.changed && entry.importedId !== null).length,
      retainedSequenceIdCount: sequenceIdChanges.filter((entry) => !entry.changed && !entry.dropped && entry.importedId !== null).length,
      preservedPresetPayloadCount: presetContentChanges.filter((entry) => !entry.nameChanged && !entry.configChanged && !entry.timestampChanged && entry.importedId !== null).length,
      preservedSequencePayloadCount: sequenceContentChanges.filter((entry) => !entry.labelChanged && !entry.timingChanged && !entry.driveChanged && !entry.keyframeChanged && !entry.dropped && entry.importedId !== null).length,
      presetReferenceRemapCount: sequenceContentChanges.filter((entry) => entry.presetReferenceChanged && !entry.dropped).length,
    },
  };
}

export function buildProjectImportNotice(
  project: ProjectData,
  importedPresetCount: number,
  diagnostics?: ProjectImportPreparationDiagnostics,
) {
  const migrationSuffix = project.schema.migrationState === 'migrated' && project.schema.migratedFromProjectDataVersion !== null
    ? ` · migrated from v${project.schema.migratedFromProjectDataVersion}`
    : '';
  return `Project loaded: ${importedPresetCount} presets restored (schema v${project.schema.projectDataVersion} / manifest v${project.schema.manifestSchemaVersion})${migrationSuffix}${buildProjectImportDiagnosticsSuffix(diagnostics)}.`;
}
