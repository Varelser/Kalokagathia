import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseProjectData } from '../lib/projectState';
import {
  buildProjectExportFileName,
  buildProjectImportNotice,
  buildProjectImportPreparationReport,
  inspectProjectDataText,
  parseProjectDataText,
  prepareImportedProjectData,
  serializeProjectData,
} from '../lib/projectTransferShared';
import {
  createDuplicateIdsInvalidActiveFixturePayload,
  createNativeRichFixturePayload,
  createOrphanSequenceFixturePayload,
} from './projectPhase5Fixtures.ts';
import { VerificationResult, assert } from './verifyPhase5Shared';

export function verifyFileRoundTripAndImportPreparation(): VerificationResult {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'monosphere-phase5-'));

  try {
    const nativeProject = parseProjectData(createNativeRichFixturePayload());
    assert(nativeProject, '[file-roundtrip] native rich fixture parse failed');
    const exportFileName = buildProjectExportFileName(nativeProject.exportedAt);
    assert(exportFileName === 'monosphere-project-2026-03-31T00-00-00-000Z.json', '[file-roundtrip] export file name mismatch');

    const exportPath = path.join(tempDir, exportFileName);
    writeFileSync(exportPath, serializeProjectData(nativeProject), 'utf8');

    const reparsed = parseProjectDataText(readFileSync(exportPath, 'utf8'));
    assert(reparsed, '[file-roundtrip] parseProjectDataText returned null for exported file');
    assert(JSON.stringify(reparsed.serialization) === JSON.stringify(nativeProject.serialization), '[file-roundtrip] serialization drift after file round-trip');
    assert(JSON.stringify(reparsed.manifest.execution) === JSON.stringify(nativeProject.manifest.execution), '[file-roundtrip] manifest drift after file round-trip');

    const suffixes = ['alpha01', 'beta02', 'gamma03', 'delta04', 'epsilon05'];
    const prepared = prepareImportedProjectData(reparsed, {
      importMode: 'merge',
      existingPresetIds: reparsed.presets.map((preset) => preset.id),
      existingSequenceIds: reparsed.presetSequence.slice(0, 1).map((item) => item.id),
      createIdSuffix: () => suffixes.shift() ?? 'zzzzzz',
    });

    assert(prepared.importedPresets.every((preset) => preset.id.includes('-import-')), '[file-roundtrip] conflicting preset ids were not remapped');
    assert(prepared.importedSequence.some((item) => item.id.includes('-import-')), '[file-roundtrip] conflicting sequence ids were not remapped');
    assert(prepared.importedSequence.some((item) => item.id === reparsed.presetSequence[1]?.id), '[file-roundtrip] non-conflicting sequence ids should be preserved');
    assert(prepared.importedSequence.every((item) => prepared.importedPresets.some((preset) => preset.id === item.presetId)), '[file-roundtrip] sequence preset references were not remapped');
    assert(prepared.remappedActivePresetId === prepared.importedPresets[0]?.id, '[file-roundtrip] active preset id was not remapped');
    assert(prepared.diagnostics.remappedPresetIdCount === reparsed.presets.length, '[file-roundtrip] preset remap diagnostics mismatch');
    assert(prepared.diagnostics.regeneratedSequenceIdCount === 1, '[file-roundtrip] sequence regeneration diagnostics mismatch');
    assert(prepared.diagnostics.activePresetFallbackApplied === false, '[file-roundtrip] active preset fallback should not have been needed');
    assert(prepared.project.manifest.stats.presetCount === prepared.importedPresets.length, '[file-roundtrip] rebuilt manifest preset count drifted');
    assert(prepared.project.manifest.stats.sequenceCount === prepared.importedSequence.length, '[file-roundtrip] rebuilt manifest sequence count drifted');
    assert(prepared.project.manifest.execution.length === 4, '[file-roundtrip] rebuilt manifest execution count mismatch');
    assert(prepared.project.serialization.layers.length === 4, '[file-roundtrip] rebuilt serialization layer count mismatch');
    assert(prepared.project.schema.serializationSchemaVersion === prepared.project.serialization.schemaVersion, '[file-roundtrip] rebuilt serialization schema mismatch');
    assert(prepared.project.schema.manifestSchemaVersion === prepared.project.manifest.schemaVersion, '[file-roundtrip] rebuilt manifest schema mismatch');

    const importedPath = path.join(tempDir, 'prepared-import.json');
    writeFileSync(importedPath, serializeProjectData(prepared.project), 'utf8');
    const importedParsed = parseProjectDataText(readFileSync(importedPath, 'utf8'));
    assert(importedParsed, '[file-roundtrip] prepared imported project could not be reparsed');
    assert(importedParsed.presets.length === prepared.importedPresets.length, '[file-roundtrip] prepared imported preset count changed after disk write');
    assert(importedParsed.presetSequence.length === prepared.importedSequence.length, '[file-roundtrip] prepared imported sequence count changed after disk write');

    const report = buildProjectImportPreparationReport(prepared, reparsed);
    assert(report.presetIdChanges.filter((entry) => entry.changed).length === reparsed.presets.length, '[file-roundtrip] exact preset id change report mismatch');
    assert(report.sequenceIdChanges.filter((entry) => entry.changed).length === 1, '[file-roundtrip] exact sequence id change report mismatch');
    assert(report.sequenceIdChanges.filter((entry) => !entry.changed && !entry.dropped).length === 1, '[file-roundtrip] retained sequence id report mismatch');
    assert(report.presetContentChanges.every((entry) => !entry.nameChanged && !entry.configChanged && !entry.timestampChanged), '[file-roundtrip] preset payload drifted during import preparation');
    assert(report.sequenceContentChanges.every((entry) => !entry.labelChanged && !entry.timingChanged && !entry.driveChanged && !entry.keyframeChanged && !entry.dropped), '[file-roundtrip] sequence payload drifted during import preparation');
    assert(report.summary.preservedPresetPayloadCount === reparsed.presets.length, '[file-roundtrip] preserved preset payload summary mismatch');
    assert(report.summary.preservedSequencePayloadCount === reparsed.presetSequence.length, '[file-roundtrip] preserved sequence payload summary mismatch');
    assert(report.summary.presetReferenceRemapCount === reparsed.presetSequence.length, '[file-roundtrip] preset reference remap summary mismatch');

    return {
      id: 'file-roundtrip-and-import-preparation',
      checks: [
        'export-file-name-stable',
        'exported-file-reparsed',
        'manifest-stable-after-file-io',
        'preset-id-remap-covered',
        'import-diagnostics-synced',
        'rebuilt-manifest-and-serialization-synced',
        'prepared-import-reparsed',
      ],
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function verifyReplaceModePreservesStableIds(): VerificationResult {
  const parsed = parseProjectData(createNativeRichFixturePayload());
  assert(parsed, '[replace-mode] native rich fixture parse failed');

  const suffixes = ['rpl01', 'rpl02', 'rpl03'];
  const prepared = prepareImportedProjectData(parsed, {
    importMode: 'replace',
    existingPresetIds: parsed.presets.map((preset) => preset.id),
    existingSequenceIds: parsed.presetSequence.map((item) => item.id),
    createIdSuffix: () => suffixes.shift() ?? 'zzzzzz',
  });

  assert(
    JSON.stringify(prepared.importedPresets.map((preset) => preset.id)) === JSON.stringify(parsed.presets.map((preset) => preset.id)),
    '[replace-mode] preset ids should be preserved during replace import',
  );
  assert(
    JSON.stringify(prepared.importedSequence.map((item) => item.id)) === JSON.stringify(parsed.presetSequence.map((item) => item.id)),
    '[replace-mode] sequence ids should be preserved during replace import',
  );
  assert(prepared.diagnostics.remappedPresetIdCount === 0, '[replace-mode] preset remap diagnostics should stay zero');
  assert(prepared.diagnostics.regeneratedSequenceIdCount === 0, '[replace-mode] sequence regeneration diagnostics should stay zero');
  assert(prepared.diagnostics.droppedOrphanSequenceCount === 0, '[replace-mode] orphan-drop diagnostics should stay zero');
  assert(prepared.diagnostics.activePresetFallbackApplied === false, '[replace-mode] active preset fallback should stay false');
  assert(prepared.remappedActivePresetId === parsed.activePresetId, '[replace-mode] active preset should be preserved');
  assert(prepared.project.manifest.stats.presetCount === parsed.presets.length, '[replace-mode] rebuilt preset count drifted');
  assert(prepared.project.manifest.stats.sequenceCount === parsed.presetSequence.length, '[replace-mode] rebuilt sequence count drifted');
  const report = buildProjectImportPreparationReport(prepared, parsed);
  assert(report.presetIdChanges.every((entry) => entry.changed === false), '[replace-mode] report should not show preset remaps');
  assert(report.sequenceIdChanges.every((entry) => entry.changed === false && entry.dropped === false), '[replace-mode] report should not show sequence remaps');
  assert(report.summary.retainedPresetIdCount === parsed.presets.length, '[replace-mode] retained preset summary mismatch');
  assert(report.summary.retainedSequenceIdCount === parsed.presetSequence.length, '[replace-mode] retained sequence summary mismatch');
  assert(report.summary.preservedPresetPayloadCount === parsed.presets.length, '[replace-mode] preserved preset payload summary mismatch');
  assert(report.summary.preservedSequencePayloadCount === parsed.presetSequence.length, '[replace-mode] preserved sequence payload summary mismatch');

  return {
    id: 'replace-mode-preserves-stable-ids',
    checks: [
      'replace-mode-ignores-existing-id-pool',
      'replace-mode-keeps-preset-ids-stable',
      'replace-mode-keeps-sequence-ids-stable',
      'replace-mode-diagnostics-stay-zero',
      'replace-mode-report-stays-clean',
    ],
  };
}

export function verifyImportInspectionDiagnostics(): VerificationResult {
  const invalidJson = inspectProjectDataText('{');
  assert(invalidJson.errorCode === 'invalid-json', '[import-inspection] invalid JSON did not report syntax error');
  assert(invalidJson.message === 'Invalid project JSON syntax.', '[import-inspection] invalid JSON message mismatch');

  const unsupportedPayload = inspectProjectDataText(JSON.stringify({ foo: 'bar' }));
  assert(unsupportedPayload.errorCode === 'invalid-project-payload', '[import-inspection] unsupported payload did not report project payload error');
  assert(unsupportedPayload.message === 'JSON parsed, but this file is not a supported project export.', '[import-inspection] unsupported payload message mismatch');

  const validPayload = inspectProjectDataText(JSON.stringify(createNativeRichFixturePayload()));
  assert(validPayload.parsed, '[import-inspection] valid project payload was not parsed');
  assert(validPayload.errorCode === null, '[import-inspection] valid project payload reported error');

  return {
    id: 'import-inspection-diagnostics',
    checks: [
      'invalid-json-detected',
      'unsupported-project-payload-detected',
      'valid-project-payload-accepted',
    ],
  };
}

export function verifyOrphanSequenceRecovery(): VerificationResult {
  const parsed = parseProjectData(createOrphanSequenceFixturePayload());
  assert(parsed, '[orphan-sequence] orphan fixture parse failed');

  const suffixes = ['orph01', 'orph02', 'orph03', 'orph04'];
  const prepared = prepareImportedProjectData(parsed, {
    importMode: 'merge',
    existingPresetIds: ['preset-alpha'],
    existingSequenceIds: ['seq-valid'],
    createIdSuffix: () => suffixes.shift() ?? 'zzzzzz',
  });

  assert(prepared.importedPresets.length === 2, '[orphan-sequence] preset count should be preserved');
  assert(prepared.importedSequence.length === 1, '[orphan-sequence] orphan sequence step was not dropped');
  assert(prepared.importedSequence[0]?.id.includes('-import-'), '[orphan-sequence] surviving sequence step was not regenerated');
  assert(prepared.importedSequence[0]?.presetId === prepared.importedPresets[0]?.id, '[orphan-sequence] surviving sequence reference was not remapped');
  assert(prepared.diagnostics.droppedOrphanSequenceCount === 1, '[orphan-sequence] orphan sequence diagnostics mismatch');
  assert(prepared.project.manifest.stats.sequenceCount === 1, '[orphan-sequence] rebuilt manifest sequence count mismatch');

  const notice = buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics);
  assert(notice.includes('1 orphan sequence steps dropped'), '[orphan-sequence] notice missing orphan-drop summary');
  const report = buildProjectImportPreparationReport(prepared, parsed);
  assert(report.droppedOrphanSequenceIds.length === 1 && report.droppedOrphanSequenceIds[0] === 'seq-orphan', '[orphan-sequence] dropped orphan sequence id report mismatch');
  assert(report.sequenceIdChanges.some((entry) => entry.sourceId === 'seq-orphan' && entry.dropped), '[orphan-sequence] orphan sequence visibility missing from report');
  assert(report.summary.droppedOrphanSequenceCount === 1, '[orphan-sequence] orphan summary mismatch');
  assert(report.summary.preservedPresetPayloadCount === parsed.presets.length, '[orphan-sequence] preset payload summary mismatch');
  assert(report.summary.preservedSequencePayloadCount === 1, '[orphan-sequence] surviving sequence payload summary mismatch');

  return {
    id: 'orphan-sequence-recovery',
    checks: [
      'orphan-sequence-step-dropped',
      'surviving-sequence-remapped',
      'orphan-drop-diagnostics-reported',
      'orphan-drop-visible-in-report',
    ],
  };
}

export function verifyDuplicateImportRecovery(): VerificationResult {
  const parsed = parseProjectData(createDuplicateIdsInvalidActiveFixturePayload());
  assert(parsed, '[duplicate-import] duplicate fixture parse failed');

  const suffixes = ['dup01', 'dup02', 'dup03', 'dup04', 'dup05', 'dup06'];
  const prepared = prepareImportedProjectData(parsed, {
    importMode: 'merge',
    existingPresetIds: ['preset-duplicate'],
    existingSequenceIds: ['seq-duplicate'],
    createIdSuffix: () => suffixes.shift() ?? 'zzzzzz',
  });

  assert(prepared.importedPresets.length === 2, '[duplicate-import] imported preset count mismatch');
  assert(new Set(prepared.importedPresets.map((preset) => preset.id)).size === prepared.importedPresets.length, '[duplicate-import] preset ids were not uniquified');
  assert(new Set(prepared.importedSequence.map((item) => item.id)).size === prepared.importedSequence.length, '[duplicate-import] sequence ids were not uniquified');
  assert(prepared.importedSequence.every((item) => item.id.includes('-import-')), '[duplicate-import] conflicting sequence ids should be regenerated');
  assert(prepared.importedSequence.every((item) => item.presetId === prepared.importedPresets[0]?.id), '[duplicate-import] duplicate preset references should resolve to the first remapped preset');
  assert(prepared.remappedActivePresetId === prepared.importedPresets[0]?.id, '[duplicate-import] invalid active preset did not fall back to first imported preset');
  assert(prepared.diagnostics.remappedPresetIdCount === 2, '[duplicate-import] remapped preset diagnostics mismatch');
  assert(prepared.diagnostics.regeneratedSequenceIdCount === 2, '[duplicate-import] regenerated sequence diagnostics mismatch');
  assert(prepared.diagnostics.activePresetFallbackApplied === true, '[duplicate-import] active preset fallback diagnostics mismatch');
  assert(prepared.project.activePresetId === prepared.importedPresets[0]?.id, '[duplicate-import] rebuilt project active preset mismatch');
  assert(prepared.project.manifest.stats.presetCount === 2, '[duplicate-import] rebuilt manifest preset count mismatch');
  assert(prepared.project.manifest.stats.sequenceCount === 2, '[duplicate-import] rebuilt manifest sequence count mismatch');

  const notice = buildProjectImportNotice(prepared.project, prepared.importedPresets.length, prepared.diagnostics);
  assert(notice.includes('2 preset IDs remapped'), '[duplicate-import] notice missing preset remap summary');
  assert(notice.includes('2 sequence IDs regenerated'), '[duplicate-import] notice missing sequence regeneration summary');
  assert(notice.includes('active preset reset'), '[duplicate-import] notice missing active preset reset summary');
  const report = buildProjectImportPreparationReport(prepared, parsed);
  assert(report.presetIdChanges.filter((entry) => entry.changed).length === 2, '[duplicate-import] duplicate preset visibility missing from report');
  assert(report.sequenceIdChanges.filter((entry) => entry.changed).length === 2, '[duplicate-import] duplicate sequence visibility missing from report');
  assert(report.sequenceIdChanges.every((entry) => entry.importedPresetId === prepared.importedPresets[0]?.id), '[duplicate-import] report should show deterministic preset resolution');
  assert(report.summary.preservedPresetPayloadCount === parsed.presets.length, '[duplicate-import] preset payload summary mismatch');
  assert(report.summary.preservedSequencePayloadCount === parsed.presetSequence.length, '[duplicate-import] sequence payload summary mismatch');
  assert(report.summary.presetReferenceRemapCount === parsed.presetSequence.length, '[duplicate-import] preset reference remap summary mismatch');

  return {
    id: 'duplicate-import-recovery',
    checks: [
      'duplicate-preset-ids-uniquified',
      'duplicate-sequence-ids-uniquified',
      'duplicate-preset-references-resolve-deterministically',
      'invalid-active-preset-falls-back',
      'import-notice-reports-normalization',
      'duplicate-id-visibility-in-report',
    ],
  };
}
