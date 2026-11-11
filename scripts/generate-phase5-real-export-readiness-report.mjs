import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const tempDir = mkdtempSync(path.join(tmpdir(), 'monosphere-phase5-real-export-readiness-report-'));
const outfile = path.join(tempDir, 'generate-phase5-real-export-readiness-report.bundle.mjs');

try {
  await build({
    entryPoints: [path.resolve('scripts/generate-phase5-real-export-readiness-report-entry.ts')],
    outfile,
    platform: 'node',
    format: 'esm',
    bundle: true,
    sourcemap: false,
    target: ['node20'],
  });
  await import(`file://${outfile}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
