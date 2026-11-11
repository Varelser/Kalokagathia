import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const outDir = path.join(rootDir, '.tmp-phase5-closeout');
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, 'generate-phase5-auto-closeout-entry.cjs');

await build({
  entryPoints: [path.join(rootDir, 'scripts', 'generate-phase5-auto-closeout-entry.ts')],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'silent',
});

await import(`file://${outfile}`);
