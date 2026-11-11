import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { PHASE5_FIXTURE_DEFINITIONS } from './projectPhase5FixturePayloads';
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  getPhase5FixtureDir,
  getPhase5RealExportFixtureDir,
  getPhase5RealExportManifestPath,
  type Phase5ProjectFingerprint,
  type Phase5RealExportManifest,
  type Phase5RealExportManifestEntry,
  stableJsonStringify,
} from './projectPhase5FixturesShared';

export function listPhase5RealExportFixtureFileNames(rootDir = process.cwd()): string[] {
  const targetDir = getPhase5RealExportFixtureDir(rootDir);
  try {
    return readdirSync(targetDir)
      .filter((fileName) => fileName.endsWith('.json') && fileName !== 'manifest.json')
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

export function buildPhase5RealExportManifestEntry(
  payload: unknown,
  fileName: string,
): Phase5RealExportManifestEntry {
  const json = stableJsonStringify(payload);
  const sha256 = createHash('sha256').update(json).digest('hex');
  const project = asRecord(payload);
  const schema = asRecord(project.schema);
  const manifest = asRecord(project.manifest);
  const stats = asRecord(manifest.stats);
  const serialization = asRecord(project.serialization);
  return {
    fileName,
    sha256,
    projectName: typeof project.name === 'string' ? project.name : fileName,
    projectDataVersion: asNumber(schema.projectDataVersion ?? project.version),
    manifestSchemaVersion: asNumber(schema.manifestSchemaVersion),
    serializationSchemaVersion: asNumber(schema.serializationSchemaVersion),
    presetCount: asNumber(stats.presetCount ?? asArray(project.presets).length),
    sequenceCount: asNumber(stats.sequenceCount ?? asArray(project.presetSequence).length),
    executionCount: asArray(manifest.execution).length,
    serializationLayerCount: asArray(serialization.layers).length,
  };
}

export function readPhase5RealExportManifest(rootDir = process.cwd()): Phase5RealExportManifest {
  const manifestPath = getPhase5RealExportManifestPath(rootDir);
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const manifest = asRecord(parsed);
    const entries = asArray(manifest.entries).map((entry) => asRecord(entry)).map((entry) => ({
      fileName: typeof entry.fileName === 'string' ? entry.fileName : '',
      sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
      projectName: typeof entry.projectName === 'string' ? entry.projectName : '',
      projectDataVersion: asNumber(entry.projectDataVersion),
      manifestSchemaVersion: asNumber(entry.manifestSchemaVersion),
      serializationSchemaVersion: asNumber(entry.serializationSchemaVersion),
      presetCount: asNumber(entry.presetCount),
      sequenceCount: asNumber(entry.sequenceCount),
      executionCount: asNumber(entry.executionCount),
      serializationLayerCount: asNumber(entry.serializationLayerCount),
    })).filter((entry) => entry.fileName);
    return {
      generatedAt: typeof manifest.generatedAt === 'string' ? manifest.generatedAt : '',
      entryCount: entries.length,
      entries,
    };
  } catch {
    return {
      generatedAt: '',
      entryCount: 0,
      entries: [],
    };
  }
}

export function buildPhase5ProjectFingerprint(project: unknown): Phase5ProjectFingerprint {
  const record = asRecord(project);
  const manifest = asRecord(record.manifest);
  const serialization = asRecord(record.serialization);

  return {
    projectName: asString(record.name),
    activePresetId: typeof record.activePresetId === 'string' ? record.activePresetId : null,
    presetIds: asArray(record.presets).map((entry) => asString(asRecord(entry).id)).filter(Boolean),
    sequenceIds: asArray(record.presetSequence).map((entry) => asString(asRecord(entry).id)).filter(Boolean),
    sequencePresetIds: asArray(record.presetSequence).map((entry) => asString(asRecord(entry).presetId)).filter(Boolean),
    executionKeys: asArray(manifest.execution).map((entry) => asString(asRecord(entry).key)).filter(Boolean),
    serializationLayerKeys: asArray(serialization.layers).map((entry) => asString(asRecord(entry).key)).filter(Boolean),
  };
}

export function arePhase5ProjectFingerprintsEqual(left: Phase5ProjectFingerprint, right: Phase5ProjectFingerprint) {
  return stableJsonStringify(left) === stableJsonStringify(right);
}

export function writePhase5Fixtures(rootDir = process.cwd()): { targetDir: string; fileNames: string[] } {
  const targetDir = getPhase5FixtureDir(rootDir);
  mkdirSync(targetDir, { recursive: true });
  const fileNames: string[] = [];
  for (const definition of PHASE5_FIXTURE_DEFINITIONS) {
    const absolutePath = path.join(targetDir, definition.fileName);
    writeFileSync(absolutePath, stableJsonStringify(definition.buildPayload()));
    fileNames.push(definition.fileName);
  }
  return { targetDir, fileNames };
}

export function writeEmptyPhase5RealExportManifest(rootDir = process.cwd()): { targetPath: string; entryCount: number } {
  const targetPath = getPhase5RealExportManifestPath(rootDir);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const manifest: Phase5RealExportManifest = {
    generatedAt: '',
    entryCount: 0,
    entries: [],
  };
  writeFileSync(targetPath, stableJsonStringify(manifest));
  return { targetPath, entryCount: 0 };
}
