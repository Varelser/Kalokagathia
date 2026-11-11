declare const process: { exitCode?: number; cwd(): string };

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  buildPhase5RealExportManifestEntry,
  getPhase5RealExportFixtureDir,
  getPhase5RealExportManifestPath,
  listPhase5RealExportFixtureFileNames,
  stableJsonStringify,
} from './projectPhase5Fixtures.ts';

export async function main() {
  const rootDir = process.cwd();
  const fixtureDir = getPhase5RealExportFixtureDir(rootDir);
  const manifestPath = getPhase5RealExportManifestPath(rootDir);
  const fileNames = listPhase5RealExportFixtureFileNames(rootDir);
  const entries = fileNames.map((fileName) => {
    const absolutePath = path.join(fixtureDir, fileName);
    const raw = readFileSync(absolutePath, 'utf8');
    const payload = JSON.parse(raw);
    return buildPhase5RealExportManifestEntry(payload, fileName);
  });

  writeFileSync(manifestPath, stableJsonStringify({
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries,
  }));

  console.log(JSON.stringify({
    fixtureDir,
    manifestPath,
    entryCount: entries.length,
    fileNames,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
