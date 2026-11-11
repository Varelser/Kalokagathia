import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseProjectDataText, serializeProjectData } from '../lib/projectTransferShared.ts';
import {
  PHASE5_FIXTURE_DEFINITIONS,
  arePhase5ProjectFingerprintsEqual,
  buildPhase5ProjectFingerprint,
  getPhase5FixtureDir,
  getPhase5RealExportFixtureDir,
  stableJsonStringify,
} from './projectPhase5Fixtures.ts';

function listJsonFiles(dir: string) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json') && name !== 'manifest.json').sort();
  } catch {
    return [];
  }
}

function buildReportEntry(baseDir: string, fileName: string) {
  const absolutePath = path.join(baseDir, fileName);
  const originalText = readFileSync(absolutePath, 'utf8');
  const parsed = parseProjectDataText(originalText);
  if (!parsed) {
    return {
      fileName,
      parsed: false,
      fingerprintStable: false,
      serializationStable: false,
      manifestExecutionStable: false,
    };
  }

  const reparsed = parseProjectDataText(serializeProjectData(parsed));
  const originalFingerprint = buildPhase5ProjectFingerprint(parsed);
  const reparsedFingerprint = reparsed ? buildPhase5ProjectFingerprint(reparsed) : null;

  return {
    fileName,
    parsed: true,
    fingerprintStable: Boolean(reparsed && reparsedFingerprint && arePhase5ProjectFingerprintsEqual(originalFingerprint, reparsedFingerprint)),
    serializationStable: Boolean(reparsed && stableJsonStringify(parsed.serialization) === stableJsonStringify(reparsed.serialization)),
    manifestExecutionStable: Boolean(reparsed && stableJsonStringify(parsed.manifest.execution) === stableJsonStringify(reparsed.manifest.execution)),
    fingerprint: originalFingerprint,
  };
}

const rootDir = process.cwd();
const generatedDir = getPhase5FixtureDir(rootDir);
const realExportDir = getPhase5RealExportFixtureDir(rootDir);
const generatedFiles = PHASE5_FIXTURE_DEFINITIONS.map((entry) => entry.fileName);
const realExportFiles = listJsonFiles(realExportDir);

const report = {
  generatedAt: new Date().toISOString(),
  generatedFixtures: generatedFiles.map((fileName) => buildReportEntry(generatedDir, fileName)),
  realExportFixtures: realExportFiles.map((fileName) => buildReportEntry(realExportDir, fileName)),
};

const outputPath = path.join(rootDir, 'docs', 'archive', 'phase5-drift-report.json');
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, stableJsonStringify(report));
console.log(JSON.stringify({ outputPath, generatedFixtureCount: generatedFiles.length, realExportFixtureCount: realExportFiles.length }));
