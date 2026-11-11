import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const tempDir = mkdtempSync(path.join(tmpdir(), 'monosphere-phase5-execution-readiness-report-'));
const outfile = path.join(tempDir, 'generate-phase5-execution-readiness-report.bundle.mjs');

await build({
  entryPoints: [path.resolve('scripts/generate-phase5-execution-readiness-report-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile,
  sourcemap: false,
});

await import(pathToFileURL(outfile).href);

function pathToFileURL(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  return new URL(`file://${resolved.startsWith('/') ? '' : '/'}${resolved}`);
}
