import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parseProjectData } from '../lib/projectState';
import { buildProjectSerializationSnapshot } from '../lib/projectSerializationSnapshot';
import { inspectProjectDataText, parseProjectDataText, serializeProjectData } from '../lib/projectTransferShared';
import {
  PHASE5_FIXTURE_DEFINITIONS,
  createLegacyV24FixturePayload,
  createNativeRichFixturePayload,
  createSparseLayer2FixturePayload,
  getPhase5FixtureDir,
  getPhase5RealExportFixtureDir,
  listPhase5RealExportFixtureFileNames,
  readPhase5RealExportManifest,
} from './projectPhase5Fixtures.ts';
import { VerificationResult, assert, assertProjectFingerprintStable, createHash, getLayer, stableJsonStringify } from './verifyPhase5Shared';

export function verifyFixtureFilesAreSynced(): VerificationResult {
  const fixtureDir = getPhase5FixtureDir();

  for (const definition of PHASE5_FIXTURE_DEFINITIONS) {
    const expected = stableJsonStringify(definition.buildPayload());
    const absolutePath = path.join(fixtureDir, definition.fileName);
    const actual = readFileSync(absolutePath, 'utf8');
    assert(actual === expected, `[fixture-sync:${definition.fileName}] fixture file is stale; regenerate Phase 5 fixtures`);
  }

  return {
    id: 'fixture-files-synced',
    checks: PHASE5_FIXTURE_DEFINITIONS.map((definition) => definition.fileName),
  };
}

export function verifySparseSerializationRecovery(): VerificationResult {
  const project = parseProjectData(createNativeRichFixturePayload());
  const payload = createSparseLayer2FixturePayload();

  assert(project, '[sparse-serialization] native rich fixture parse failed');
  const parsed = parseProjectData(payload);
  assert(parsed, '[sparse-serialization] parseProjectData returned null');
  const layer2 = getLayer(parsed, 'layer2');
  const fallbackLayer2 = getLayer(project, 'layer2');

  assert(parsed.schema.serializationSchemaVersion === project.schema.serializationSchemaVersion, '[sparse-serialization] schema serialization version drift');
  assert(layer2.label === 'Layer 2 Custom', '[sparse-serialization] custom layer label not preserved');
  assert(layer2.modeId === 'custom-mode-id', '[sparse-serialization] custom mode id not preserved');
  assert(layer2.blocks.source.id === 'source-custom', '[sparse-serialization] source id not preserved');
  assert(layer2.blocks.source.values.includes('custom-source-token'), '[sparse-serialization] custom source token lost');
  assert(layer2.blocks.source.values.includes(fallbackLayer2.blocks.source.values[0]), '[sparse-serialization] fallback source tokens not restored');
  assert(layer2.blocks.execution.values.includes('custom-execution-token'), '[sparse-serialization] custom execution token lost');

  for (const requiredValue of fallbackLayer2.blocks.execution.values) {
    assert(layer2.blocks.execution.values.includes(requiredValue), `[sparse-serialization] execution fallback token missing: ${requiredValue}`);
  }

  assert(layer2.blocks.simulation.values.length >= fallbackLayer2.blocks.simulation.values.length, '[sparse-serialization] simulation block not backfilled');
  assert(layer2.blocks.shading.values.length >= fallbackLayer2.blocks.shading.values.length, '[sparse-serialization] shading block not backfilled');

  return {
    id: 'sparse-serialization-recovery',
    checks: [
      'custom-layer-metadata-preserved',
      'fallback-block-values-restored',
      'execution-block-merged',
      'serialization-schema-synced',
    ],
  };
}

export function verifyLegacyMigrationRebuild(): VerificationResult {
  const payload = createLegacyV24FixturePayload();

  const parsed = parseProjectData(payload);
  assert(parsed, '[legacy-migration] parseProjectData returned null');
  assert(parsed.schema.migrationState === 'migrated', '[legacy-migration] migrationState not set');
  assert(parsed.schema.migratedFromProjectDataVersion === 24, '[legacy-migration] migratedFromProjectDataVersion mismatch');
  assert(parsed.serialization.layers.length === 4, '[legacy-migration] serialization not rebuilt');
  assert(parsed.manifest.execution.length === 4, '[legacy-migration] manifest execution not rebuilt');
  assert(parsed.presetSequence.length === 2, '[legacy-migration] preset sequence did not survive migration');

  return {
    id: 'legacy-migration-rebuild',
    checks: [
      'schema-marked-migrated',
      'manifest-rebuilt',
      'serialization-rebuilt',
      'sequence-preserved',
    ],
  };
}

export function verifyRoundTripStability(): VerificationResult {
  const project = createNativeRichFixturePayload();
  const firstParsed = parseProjectData(JSON.parse(JSON.stringify(project)));
  assert(firstParsed, '[roundtrip] first parse failed');
  const secondParsed = parseProjectData(JSON.parse(JSON.stringify(firstParsed)));
  assert(secondParsed, '[roundtrip] second parse failed');

  assert(JSON.stringify(firstParsed.serialization) === JSON.stringify(secondParsed.serialization), '[roundtrip] serialization changed between parses');
  assert(JSON.stringify(firstParsed.manifest.execution) === JSON.stringify(secondParsed.manifest.execution), '[roundtrip] manifest execution changed between parses');
  assert(firstParsed.schema.serializationSchemaVersion === secondParsed.schema.serializationSchemaVersion, '[roundtrip] schema serialization version changed');
  const checks = [
    'parse-parse-serialization-stable',
    'manifest-execution-stable',
  ];
  assertProjectFingerprintStable(firstParsed, secondParsed, 'roundtrip', checks, 'project-fingerprint-stable');

  const freshSerialization = buildProjectSerializationSnapshot(secondParsed.currentConfig, secondParsed.schema.serializationSchemaVersion);
  assert(freshSerialization.layers.length === secondParsed.serialization.layers.length, '[roundtrip] fresh serialization layer count mismatch');

  checks.push('fresh-serialization-compatible');

  return {
    id: 'roundtrip-stability',
    checks,
  };
}

export function verifyFixtureFileParsing(): VerificationResult {
  const fixtureDir = getPhase5FixtureDir();
  const checks: string[] = [];

  for (const definition of PHASE5_FIXTURE_DEFINITIONS) {
    const absolutePath = path.join(fixtureDir, definition.fileName);
    const payload = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
    const parsed = parseProjectData(payload);
    assert(parsed, `[fixture-parse:${definition.fileName}] parseProjectData returned null`);
    assert(parsed.serialization.layers.length === 4, `[fixture-parse:${definition.fileName}] serialization layer count mismatch`);
    assert(parsed.manifest.execution.length === 4, `[fixture-parse:${definition.fileName}] manifest execution count mismatch`);
    checks.push(`${definition.id}:parsed`);
    const reparsed = parseProjectDataText(serializeProjectData(parsed));
    assert(reparsed, `[fixture-parse:${definition.fileName}] serialize/parse returned null`);
    assertProjectFingerprintStable(parsed, reparsed, `fixture-parse:${definition.fileName}`, checks, `${definition.id}:fingerprint-stable`);

    if (definition.id === 'legacy-v24') {
      assert(parsed.schema.migrationState === 'migrated', '[fixture-parse:legacy-v24] expected migrated schema');
      assert(parsed.schema.migratedFromProjectDataVersion === 24, '[fixture-parse:legacy-v24] expected migratedFromProjectDataVersion = 24');
      checks.push('legacy-v24:migration-confirmed');
      continue;
    }

    if (definition.id === 'sparse-layer2-custom') {
      const layer2 = getLayer(parsed, 'layer2');
      assert(layer2.blocks.execution.values.includes('custom-execution-token'), '[fixture-parse:sparse-layer2-custom] custom execution token missing');
      checks.push('sparse-layer2-custom:custom-token-preserved');
      continue;
    }

    if (definition.id === 'duplicate-ids-invalid-active') {
      const duplicateIds = parsed.presets.filter((preset) => preset.id === 'preset-duplicate');
      assert(duplicateIds.length === 2, '[fixture-parse:duplicate-ids-invalid-active] expected duplicate preset ids to survive parse for import hardening');
      assert(parsed.activePresetId === 'preset-missing', '[fixture-parse:duplicate-ids-invalid-active] invalid active preset id should survive parse before preparation');
      checks.push('duplicate-ids-invalid-active:duplicate-input-preserved');
      continue;
    }

    if (definition.id === 'orphan-sequence') {
      const orphanStep = parsed.presetSequence.find((item) => item.id === 'seq-orphan');
      assert(orphanStep?.presetId === 'preset-gone', '[fixture-parse:orphan-sequence] orphan sequence reference should survive parse before preparation');
      checks.push('orphan-sequence:orphan-input-preserved');
      continue;
    }

    const layer2 = getLayer(parsed, 'layer2');
    assert(layer2.blocks.source.values.includes('video'), '[fixture-parse:native-rich] expected layer2 source token');
    checks.push('native-rich:source-token-confirmed');
  }

  return {
    id: 'fixture-file-parsing',
    checks,
  };
}

export function verifyOptionalRealExportFixtures(): VerificationResult {
  const fixtureDir = getPhase5RealExportFixtureDir();
  const fileNames = listPhase5RealExportFixtureFileNames();
  const manifest = readPhase5RealExportManifest();
  const manifestEntries = new Map(manifest.entries.map((entry) => [entry.fileName, entry]));
  const checks: string[] = [];

  assert(manifest.entryCount === manifest.entries.length, '[real-export] manifest entryCount mismatch');
  assert(manifest.entries.length === fileNames.length, '[real-export] manifest file count mismatch');

  for (const fileName of fileNames) {
    const absolutePath = path.join(fixtureDir, fileName);
    const raw = readFileSync(absolutePath, 'utf8');
    const inspection = inspectProjectDataText(raw);
    assert(inspection.parsed, `[real-export:${fileName}] inspectProjectDataText returned null`);
    assert(/^monosphere-project-.+\.json$/.test(fileName), `[real-export:${fileName}] file name does not match export naming pattern`);

    const manifestEntry = manifestEntries.get(fileName);
    assert(manifestEntry, `[real-export:${fileName}] manifest entry missing`);

    const sha256 = createHash('sha256').update(raw).digest('hex');
    assert(manifestEntry.sha256 === sha256, `[real-export:${fileName}] manifest sha256 drift`);
    assert(manifestEntry.projectName === inspection.parsed.name, `[real-export:${fileName}] manifest project name drift`);
    assert(manifestEntry.projectDataVersion === inspection.parsed.schema.projectDataVersion, `[real-export:${fileName}] manifest projectDataVersion drift`);
    assert(manifestEntry.manifestSchemaVersion === inspection.parsed.schema.manifestSchemaVersion, `[real-export:${fileName}] manifest manifestSchemaVersion drift`);
    assert(manifestEntry.serializationSchemaVersion === inspection.parsed.schema.serializationSchemaVersion, `[real-export:${fileName}] manifest serializationSchemaVersion drift`);
    assert(manifestEntry.presetCount === inspection.parsed.presets.length, `[real-export:${fileName}] manifest presetCount drift`);
    assert(manifestEntry.sequenceCount === inspection.parsed.presetSequence.length, `[real-export:${fileName}] manifest sequenceCount drift`);
    assert(manifestEntry.executionCount === inspection.parsed.manifest.execution.length, `[real-export:${fileName}] manifest executionCount drift`);
    assert(manifestEntry.serializationLayerCount === inspection.parsed.serialization.layers.length, `[real-export:${fileName}] manifest serializationLayerCount drift`);

    const reparsed = parseProjectDataText(serializeProjectData(inspection.parsed));
    assert(reparsed, `[real-export:${fileName}] reparsed serialized payload returned null`);
    assert(JSON.stringify(reparsed.serialization) === JSON.stringify(inspection.parsed.serialization), `[real-export:${fileName}] serialization drift after serialize+parse`);
    assert(JSON.stringify(reparsed.manifest.execution) === JSON.stringify(inspection.parsed.manifest.execution), `[real-export:${fileName}] manifest drift after serialize+parse`);
    checks.push(`${fileName}:verified`);
  }

  const manifestOnlyEntries = manifest.entries
    .map((entry) => entry.fileName)
    .filter((fileName) => !fileNames.includes(fileName));
  assert(manifestOnlyEntries.length === 0, `[real-export] manifest has stale entries: ${manifestOnlyEntries.join(', ')}`);

  checks.unshift(`manifest:${manifest.entries.length}-entries`);

  return {
    id: 'optional-real-export-fixtures',
    checks,
  };
}
