import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
const outdir = join(process.cwd(), '.out', 'phase5-final-closeout');
rmSync(outdir, { recursive: true, force: true });
await build({ entryPoints: ['scripts/generate-phase5-final-closeout-entry.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outdir, logLevel: 'silent' });
await import(join(outdir, 'generate-phase5-final-closeout-entry.js'));
