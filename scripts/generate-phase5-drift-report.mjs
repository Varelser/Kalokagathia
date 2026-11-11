import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, 'generate-phase5-drift-report-entry.ts');
const outfile = path.join(__dirname, '.tmp-generate-phase5-drift-report.cjs');

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile,
  target: 'node20',
  logLevel: 'silent',
});

await import(path.toNamespacedPath(outfile));
