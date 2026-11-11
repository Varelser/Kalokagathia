import type { PreparedImportedProjectData, PrepareImportedProjectDataOptions, ProjectImportPreparationDiagnostics } from './projectTransferSharedTypes';
import type { PresetSequenceItem, ProjectData } from '../types';
import { buildProjectData } from './projectState';
import { createProjectImportIdSuffix } from './projectTransferSharedTypes';

export function buildImportedId(baseId: string, createIdSuffix: () => string, usedIds: Set<string>) {
  let candidate = `${baseId}-import-${createIdSuffix()}`;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-import-${createIdSuffix()}`;
  }
  usedIds.add(candidate);
  return candidate;
}

export function buildProjectImportDiagnosticsSuffix(diagnostics?: ProjectImportPreparationDiagnostics) {
  if (!diagnostics) return '';

  const parts: string[] = [];
  if (diagnostics.remappedPresetIdCount > 0) {
    parts.push(`${diagnostics.remappedPresetIdCount} preset IDs remapped`);
  }
  if (diagnostics.regeneratedSequenceIdCount > 0) {
    parts.push(`${diagnostics.regeneratedSequenceIdCount} sequence IDs regenerated`);
  }
  if (diagnostics.droppedOrphanSequenceCount > 0) {
    parts.push(`${diagnostics.droppedOrphanSequenceCount} orphan sequence steps dropped`);
  }
  if (diagnostics.activePresetFallbackApplied) {
    parts.push('active preset reset');
  }

  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

export function prepareImportedProjectData(
  parsed: ProjectData,
  options?: PrepareImportedProjectDataOptions,
): PreparedImportedProjectData {
  const createIdSuffix = options?.createIdSuffix ?? createProjectImportIdSuffix;
  const importMode = options?.importMode ?? 'merge';
  const shouldReuseExistingIds = importMode === 'merge';
  const usedPresetIds = new Set<string>(
    shouldReuseExistingIds && options?.existingPresetIds ? Array.from(options.existingPresetIds) : [],
  );

  let remappedPresetIdCount = 0;
  const importedPresets = parsed.presets.map((preset) => {
    if (!usedPresetIds.has(preset.id)) {
      usedPresetIds.add(preset.id);
      return preset;
    }

    remappedPresetIdCount += 1;
    return {
      ...preset,
      id: buildImportedId(preset.id, createIdSuffix, usedPresetIds),
    };
  });

  const presetIdRemap = new Map<string, string>();
  parsed.presets.forEach((preset, index) => {
    if (!presetIdRemap.has(preset.id)) {
      presetIdRemap.set(preset.id, importedPresets[index]?.id ?? preset.id);
    }
  });

  const importedPresetIds = new Set(importedPresets.map((preset) => preset.id));
  const usedSequenceIds = new Set<string>(
    shouldReuseExistingIds && options?.existingSequenceIds ? Array.from(options.existingSequenceIds) : [],
  );

  const sourcePresetIds = parsed.presets.map((preset) => preset.id);
  const sequenceIdRemap = new Map<string, string>();
  const retainedSourceSequenceIds: string[] = [];
  const droppedOrphanSequenceIds: string[] = [];

  let regeneratedSequenceIdCount = 0;
  let droppedOrphanSequenceCount = 0;
  const importedSequence = parsed.presetSequence
    .map((item) => {
      const remappedPresetId = presetIdRemap.get(item.presetId) ?? item.presetId;
      if (!importedPresetIds.has(remappedPresetId)) {
        droppedOrphanSequenceCount += 1;
        droppedOrphanSequenceIds.push(item.id);
        return null;
      }

      const sequenceId = usedSequenceIds.has(item.id)
        ? (() => {
            regeneratedSequenceIdCount += 1;
            return buildImportedId(item.id, createIdSuffix, usedSequenceIds);
          })()
        : (usedSequenceIds.add(item.id), item.id);

      if (!sequenceIdRemap.has(item.id)) {
        sequenceIdRemap.set(item.id, sequenceId);
      }
      if (sequenceId === item.id) {
        retainedSourceSequenceIds.push(item.id);
      }

      return {
        ...item,
        id: sequenceId,
        presetId: remappedPresetId,
      };
    })
    .filter((item): item is PresetSequenceItem => Boolean(item));

  const explicitActivePresetId = parsed.activePresetId
    ? (presetIdRemap.get(parsed.activePresetId) ?? parsed.activePresetId)
    : null;
  const remappedActivePresetId = explicitActivePresetId && importedPresetIds.has(explicitActivePresetId)
    ? explicitActivePresetId
    : (importedPresets[0]?.id ?? null);
  const activePresetFallbackApplied = remappedActivePresetId !== explicitActivePresetId;

  const rebuiltProject = buildProjectData({
    name: parsed.name,
    config: parsed.currentConfig,
    activePresetId: remappedActivePresetId,
    presetBlendDuration: parsed.presetBlendDuration,
    sequenceLoopEnabled: parsed.sequenceLoopEnabled,
    presets: importedPresets,
    presetSequence: importedSequence,
    ui: parsed.ui,
  });

  const project: ProjectData = {
    ...rebuiltProject,
    exportedAt: parsed.exportedAt,
    schema: {
      ...rebuiltProject.schema,
      migrationState: parsed.schema.migrationState,
      migratedFromProjectDataVersion: parsed.schema.migratedFromProjectDataVersion,
    },
  };

  return {
    project,
    importedPresets,
    importedSequence,
    remappedActivePresetId,
    presetIdRemap,
    sequenceIdRemap,
    sourcePresetIds,
    retainedSourceSequenceIds,
    droppedOrphanSequenceIds,
    diagnostics: {
      remappedPresetIdCount,
      regeneratedSequenceIdCount,
      droppedOrphanSequenceCount,
      activePresetFallbackApplied,
    },
  };
}
