declare const process: { cwd(): string };

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { inspectProjectDataText, parseProjectDataText, serializeProjectData } from '../lib/projectTransferShared.ts';
import {
  arePhase5ProjectFingerprintsEqual,
  buildPhase5ProjectFingerprint,
  getPhase5RealExportFixtureDir,
  listPhase5RealExportFixtureFileNames,
  readPhase5RealExportManifest,
  stableJsonStringify,
} from './projectPhase5Fixtures.ts';

interface Phase5RealExportFixtureMetadataSnapshot {
  projectName: string;
  projectDataVersion: number;
  manifestSchemaVersion: number;
  serializationSchemaVersion: number;
  presetCount: number;
  sequenceCount: number;
  executionCount: number;
  serializationLayerCount: number;
}

interface Phase5RealExportFixtureRoundtripDrift {
  serializationDrift: boolean;
  manifestExecutionDrift: boolean;
  fingerprintDrift: boolean;
  driftedFields: string[];
}

interface Phase5RealExportFixtureReadinessEntry {
  fileName: string;
  status: 'verified' | 'invalid-name' | 'invalid-json' | 'invalid-project-payload' | 'manifest-entry-missing' | 'manifest-sha256-drift' | 'manifest-metadata-drift' | 'roundtrip-drift';
  reasons: string[];
  sha256Actual: string | null;
  manifestMetadataExpected: Phase5RealExportFixtureMetadataSnapshot | null;
  manifestMetadataActual: Phase5RealExportFixtureMetadataSnapshot | null;
  metadataDriftFields: string[];
  roundtripDrift: Phase5RealExportFixtureRoundtripDrift | null;
}

interface Phase5RealExportReadinessReport {
  generatedAt: string;
  fixtureCount: number;
  manifestEntryCount: number;
  staleManifestEntries: string[];
  verifiedCount: number;
  failingCount: number;
  statusCounts: Record<Phase5RealExportFixtureReadinessEntry['status'], number>;
  entries: Phase5RealExportFixtureReadinessEntry[];
}

function buildMetadataSnapshot(project: NonNullable<ReturnType<typeof inspectProjectDataText>['parsed']>): Phase5RealExportFixtureMetadataSnapshot {
  return {
    projectName: project.name,
    projectDataVersion: project.schema.projectDataVersion,
    manifestSchemaVersion: project.schema.manifestSchemaVersion,
    serializationSchemaVersion: project.schema.serializationSchemaVersion,
    presetCount: project.presets.length,
    sequenceCount: project.presetSequence.length,
    executionCount: project.manifest.execution.length,
    serializationLayerCount: project.serialization.layers.length,
  };
}

function listMetadataDriftFields(expected: Phase5RealExportFixtureMetadataSnapshot, actual: Phase5RealExportFixtureMetadataSnapshot) {
  const fields: string[] = [];
  for (const key of Object.keys(expected) as (keyof Phase5RealExportFixtureMetadataSnapshot)[]) {
    if (expected[key] !== actual[key]) {
      fields.push(key);
    }
  }
  return fields;
}

function buildEntry(rootDir: string, fileName: string): Phase5RealExportFixtureReadinessEntry {
  const fixtureDir = getPhase5RealExportFixtureDir(rootDir);
  const manifest = readPhase5RealExportManifest(rootDir);
  const manifestEntry = manifest.entries.find((entry) => entry.fileName === fileName) ?? null;
  const absolutePath = path.join(fixtureDir, fileName);
  const raw = readFileSync(absolutePath, 'utf8');
  const inspection = inspectProjectDataText(raw);
  const reasons: string[] = [];
  let status: Phase5RealExportFixtureReadinessEntry['status'] = 'verified';
  const sha256Actual = createHash('sha256').update(raw).digest('hex');

  if (!/^monosphere-project-.+\.json$/.test(fileName)) {
    status = 'invalid-name';
    reasons.push('file-name-does-not-match-export-pattern');
  }

  if (!inspection.parsed) {
    if (inspection.errorCode === 'invalid-json') {
      status = 'invalid-json';
      reasons.push('json-syntax-invalid');
      return {
        fileName,
        status,
        reasons,
        sha256Actual,
        manifestMetadataExpected: null,
        manifestMetadataActual: null,
        metadataDriftFields: [],
        roundtripDrift: null,
      };
    }
    status = 'invalid-project-payload';
    reasons.push('json-parsed-but-project-payload-unsupported');
    return {
      fileName,
      status,
      reasons,
      sha256Actual,
      manifestMetadataExpected: null,
      manifestMetadataActual: null,
      metadataDriftFields: [],
      roundtripDrift: null,
    };
  }

  const manifestMetadataActual = buildMetadataSnapshot(inspection.parsed);
  const manifestMetadataExpected = manifestEntry
    ? {
        projectName: manifestEntry.projectName,
        projectDataVersion: manifestEntry.projectDataVersion,
        manifestSchemaVersion: manifestEntry.manifestSchemaVersion,
        serializationSchemaVersion: manifestEntry.serializationSchemaVersion,
        presetCount: manifestEntry.presetCount,
        sequenceCount: manifestEntry.sequenceCount,
        executionCount: manifestEntry.executionCount,
        serializationLayerCount: manifestEntry.serializationLayerCount,
      }
    : null;
  const metadataDriftFields = manifestMetadataExpected
    ? listMetadataDriftFields(manifestMetadataExpected, manifestMetadataActual)
    : [];

  if (!manifestEntry) {
    status = 'manifest-entry-missing';
    reasons.push('manifest-entry-missing');
    return {
      fileName,
      status,
      reasons,
      sha256Actual,
      manifestMetadataExpected,
      manifestMetadataActual,
      metadataDriftFields,
      roundtripDrift: null,
    };
  }

  if (manifestEntry.sha256 !== sha256Actual) {
    status = 'manifest-sha256-drift';
    reasons.push('manifest-sha256-drift');
  }

  if (metadataDriftFields.length > 0) {
    if (status === 'verified') {
      status = 'manifest-metadata-drift';
    }
    reasons.push(`manifest-metadata-drift:${metadataDriftFields.join(',')}`);
  }

  const reparsed = parseProjectDataText(serializeProjectData(inspection.parsed));
  let roundtripDrift: Phase5RealExportFixtureRoundtripDrift | null;
  if (!reparsed) {
    status = 'roundtrip-drift';
    reasons.push('serialize-parse-returned-null');
    roundtripDrift = {
      serializationDrift: true,
      manifestExecutionDrift: true,
      fingerprintDrift: true,
      driftedFields: ['serialize-parse-returned-null'],
    };
  } else {
    const beforeFingerprint = buildPhase5ProjectFingerprint(inspection.parsed);
    const afterFingerprint = buildPhase5ProjectFingerprint(reparsed);
    const serializationDrift = JSON.stringify(reparsed.serialization) !== JSON.stringify(inspection.parsed.serialization);
    const manifestExecutionDrift = JSON.stringify(reparsed.manifest.execution) !== JSON.stringify(inspection.parsed.manifest.execution);
    const fingerprintDrift = !arePhase5ProjectFingerprintsEqual(beforeFingerprint, afterFingerprint);
    const driftedFields: string[] = [];
    if (serializationDrift) driftedFields.push('serialization');
    if (manifestExecutionDrift) driftedFields.push('manifest.execution');
    if (fingerprintDrift) driftedFields.push('fingerprint');
    roundtripDrift = {
      serializationDrift,
      manifestExecutionDrift,
      fingerprintDrift,
      driftedFields,
    };
    if (driftedFields.length > 0) {
      status = 'roundtrip-drift';
      reasons.push(`roundtrip-drift:${driftedFields.join(',')}`);
    }
  }

  return {
    fileName,
    status,
    reasons,
    sha256Actual,
    manifestMetadataExpected,
    manifestMetadataActual,
    metadataDriftFields,
    roundtripDrift,
  };
}

function buildReport(rootDir = process.cwd()): Phase5RealExportReadinessReport {
  const fileNames = listPhase5RealExportFixtureFileNames(rootDir);
  const manifest = readPhase5RealExportManifest(rootDir);
  const entries = fileNames.map((fileName) => buildEntry(rootDir, fileName));
  const staleManifestEntries = manifest.entries
    .map((entry) => entry.fileName)
    .filter((fileName) => !fileNames.includes(fileName));
  const statusCounts = entries.reduce<Phase5RealExportReadinessReport['statusCounts']>((counts, entry) => {
    counts[entry.status] += 1;
    return counts;
  }, {
    verified: 0,
    'invalid-name': 0,
    'invalid-json': 0,
    'invalid-project-payload': 0,
    'manifest-entry-missing': 0,
    'manifest-sha256-drift': 0,
    'manifest-metadata-drift': 0,
    'roundtrip-drift': 0,
  });

  return {
    generatedAt: new Date().toISOString(),
    fixtureCount: fileNames.length,
    manifestEntryCount: manifest.entryCount,
    staleManifestEntries,
    verifiedCount: entries.filter((entry) => entry.status === 'verified').length,
    failingCount: entries.filter((entry) => entry.status !== 'verified').length + staleManifestEntries.length,
    statusCounts,
    entries,
  };
}

const rootDir = process.cwd();
const report = buildReport(rootDir);
const outPath = path.join(rootDir, 'docs', 'archive', 'phase5-real-export-readiness-report.json');
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, stableJsonStringify(report));
console.log(`phase5 real-export readiness report written: ${outPath}`);
