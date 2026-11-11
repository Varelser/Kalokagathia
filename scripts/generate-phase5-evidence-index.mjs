import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const tempDir = mkdtempSync(path.join(tmpdir(), 'monosphere-phase5-evidence-index-'));
const outfile = path.join(tempDir, 'generate-phase5-evidence-index.bundle.mjs');

await build({
  entryPoints: [path.resolve('scripts/generate-phase5-evidence-index-entry.ts')],
  outfile,
  platform: 'node',
  format: 'esm',
  bundle: true,
  target: ['node20'],
  sourcemap: false,
  logLevel: 'silent',
});

await import(pathToFileURL(outfile).href);

function pathToFileURL(filePath) {
  const resolved = path.resolve(filePath);
  return new URL(`file://${resolved}`);
}
