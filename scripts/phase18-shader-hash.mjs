// Phase 18 stage 0 — byte-identity ruler for the GPGPU velocity
// simulation shader (and the position shader as a bystander).
//
// Stage 2 of Phase 18 splits VEL_FRAG_MAIN_FORCES into per-force
// chunks and later reads an order key at shader-build time. The
// gate for that work is: with the default order, the built shader
// string must stay byte-identical to the pre-split string. This
// script measures the built strings (the module-level constants
// and buildVelocityFragment('')) and pins them by sha256 + length,
// per chunk, so a drift can be localised to one chunk.
//
// Usage:
//   node scripts/phase18-shader-hash.mjs
//       print the current hashes (no comparison)
//   node scripts/phase18-shader-hash.mjs --record [path]
//       write the baseline record
//       (default: scripts/phase18-shader-hash.baseline.json)
//   node scripts/phase18-shader-hash.mjs --check [path]
//       compare against the baseline record; exit 1 on any drift
//       and list which parts changed
//
// Exit codes: 0 = clean / printed, 1 = drift, 2 = usage or I/O error.

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECORD_PATH = join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json');
const BUNDLE = join(ROOT, 'scripts', `.p18sh-bundle-${process.pid}.mjs`);

const args = process.argv.slice(2);
const mode = args[0] === '--record' ? 'record' : args[0] === '--check' ? 'check' : 'print';
if (args.length > 0 && mode === 'print') {
  console.error('usage: phase18-shader-hash.mjs [--record|--check] [record-path]');
  process.exit(2);
}
const recordPath = args[1] ? join(ROOT, args[1]) : DEFAULT_RECORD_PATH;

await build({
  stdin: {
    contents: `
      export { SIM_VEL_FRAG, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { VEL_FRAG_HELPERS } from './components/gpgpuShaderSimulationVelocityHelpers.ts';
      export { VEL_FRAG_MAIN_FORCES } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { VEL_FRAG_MAIN_SPH_GRAINS } from './components/gpgpuShaderSimulationVelocityMainSphGrains.ts';
      export { VEL_FRAG_MAIN_TAIL } from './components/gpgpuShaderSimulationVelocityMainTail.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const measure = (s) => ({ length: s.length, sha256: sha256(s) });

const parts = {
  SIM_VEL_FRAG: lib.SIM_VEL_FRAG,
  VEL_FRAG_PREAMBLE: lib.VEL_FRAG_PREAMBLE,
  VEL_FRAG_HELPERS: lib.VEL_FRAG_HELPERS,
  VEL_FRAG_MAIN_FORCES: lib.VEL_FRAG_MAIN_FORCES,
  VEL_FRAG_MAIN_SPH_GRAINS: lib.VEL_FRAG_MAIN_SPH_GRAINS,
  VEL_FRAG_MAIN_TAIL: lib.VEL_FRAG_MAIN_TAIL,
  SIM_POS_FRAG: lib.SIM_POS_FRAG,
  'buildVelocityFragment(empty)': lib.buildVelocityFragment(''),
};
const report = { version: 1, parts: {} };
for (const [name, s] of Object.entries(parts)) report.parts[name] = measure(s);

// Structural invariants of the current assembly, checked in every mode:
// the whole is the concatenation of the five chunks in order, and the
// empty-snippet builder returns the stock shader unchanged.
const concat = lib.VEL_FRAG_PREAMBLE + lib.VEL_FRAG_HELPERS + lib.VEL_FRAG_MAIN_FORCES
  + lib.VEL_FRAG_MAIN_SPH_GRAINS + lib.VEL_FRAG_MAIN_TAIL;
const invariants = {
  concatenationMatches: concat === lib.SIM_VEL_FRAG,
  emptySnippetIsStock: lib.buildVelocityFragment('') === lib.SIM_VEL_FRAG,
};

console.log('phase18-shader-hash: GPGPU simulation shader byte identity');
for (const [name, m] of Object.entries(report.parts)) {
  console.log(`  ${name}: length ${m.length}, sha256 ${m.sha256}`);
}
console.log(`  invariant concatenation === SIM_VEL_FRAG: ${invariants.concatenationMatches}`);
console.log(`  invariant buildVelocityFragment('') === SIM_VEL_FRAG: ${invariants.emptySnippetIsStock}`);
if (!invariants.concatenationMatches || !invariants.emptySnippetIsStock) {
  console.error('  result: FAIL — structural invariant broken');
  process.exit(1);
}

if (mode === 'record') {
  writeFileSync(recordPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  recorded baseline: ${recordPath}`);
  process.exit(0);
}
if (mode === 'check') {
  if (!existsSync(recordPath)) {
    console.error(`  result: ERROR — no baseline record at ${recordPath} (run --record first)`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(recordPath, 'utf8'));
  let drift = 0;
  for (const [name, m] of Object.entries(report.parts)) {
    const b = baseline.parts?.[name];
    if (!b) { console.log(`  DRIFT ${name}: missing from baseline`); drift += 1; continue; }
    if (b.length !== m.length || b.sha256 !== m.sha256) {
      console.log(`  DRIFT ${name}: baseline length ${b.length} sha256 ${b.sha256} -> current length ${m.length} sha256 ${m.sha256}`);
      drift += 1;
    }
  }
  for (const name of Object.keys(baseline.parts ?? {})) {
    if (!(name in report.parts)) { console.log(`  DRIFT ${name}: in baseline but no longer measured`); drift += 1; }
  }
  console.log(drift === 0 ? '  result: OK — byte-identical to baseline' : `  result: FAIL — ${drift} part(s) drifted`);
  process.exit(drift === 0 ? 0 : 1);
}
process.exit(0);
