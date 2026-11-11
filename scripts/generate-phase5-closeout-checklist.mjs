import { build } from 'esbuild';
import path from 'node:path';

const rootDir = process.cwd();
const entry = path.join(rootDir, 'scripts', 'generate-phase5-closeout-checklist-entry.ts');
const out = path.join(rootDir, '.out', 'generate-phase5-closeout-checklist-entry.cjs');

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  outfile: out,
  sourcemap: false,
  logLevel: 'silent',
});

await import(pathToFileURL(out).href);

function pathToFileURL(filePath) {
  return new URL(`file://${filePath}`);
}
