import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = mkdtempSync(path.join(tmpdir(), 'monosphere-generate-phase5-real-export-manifest-'));
const outfile = path.join(tempDir, 'generate-phase5-real-export-manifest.bundle.mjs');

try {
  await build({
    entryPoints: [path.resolve('scripts/generate-phase5-real-export-manifest-entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    logLevel: 'silent',
  });

  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
