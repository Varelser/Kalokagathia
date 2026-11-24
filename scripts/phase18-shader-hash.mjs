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
// Phase 19 gate fix: the Phase 19 shader additions (Grains scan
// plan + projection, FLIP 3D coupling, Vellum crack) are spliced
// in only by builder options, because on the target GPU any
// code-text change breaks bit-identity with v2.00 even when the
// code never runs. The baseline therefore pins BOTH sides: the
// default exports at their v2.00 hashes and the *_PHASE19 variant
// exports at the Phase 19 hashes, plus the position / points /
// geometry draw strings in both forms.
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
      export { SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE19, SIM_VEL_FRAG_PHASE20, SIM_VEL_FRAG_PHASE24, SIM_VEL_FRAG_PHASE27, SIM_VEL_FRAG_PHASE29, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE19, VEL_FRAG_PREAMBLE_PHASE20, VEL_FRAG_PREAMBLE_PHASE24, VEL_FRAG_PREAMBLE_PHASE27, VEL_FRAG_PREAMBLE_PHASE29 } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { VEL_FRAG_HELPERS } from './components/gpgpuShaderSimulationVelocityHelpers.ts';
      export { VEL_FRAG_MAIN_FORCES } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { VEL_FRAG_MAIN_SPH_GRAINS, VEL_FRAG_MAIN_SPH_GRAINS_PHASE19, VEL_FRAG_MAIN_SPH_GRAINS_PHASE24, buildVelocitySphGrains } from './components/gpgpuShaderSimulationVelocityMainSphGrains.ts';
      export { VEL_FRAG_MAIN_TAIL, VEL_FRAG_MAIN_TAIL_PHASE19 } from './components/gpgpuShaderSimulationVelocityMainTail.ts';
      export { SIM_POS_FRAG, SIM_POS_FRAG_PHASE19, SIM_POS_FRAG_PHASE19_CELL, buildPositionFragment } from './components/gpgpuShaderSimulationPosition.ts';
      export { DRAW_VERT, DRAW_VERT_PHASE19, DRAW_VERT_PHASE20, DRAW_VERT_PHASE23, DRAW_FRAG, DRAW_FRAG_PHASE19, DRAW_FRAG_PHASE20, DRAW_FRAG_PHASE23, buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { GEOM_VERT, GEOM_VERT_PHASE19, GEOM_VERT_PHASE24, GEOM_FRAG, GEOM_FRAG_PHASE19, GEOM_FRAG_PHASE24, buildGeomVertShader, buildGeomFragShader } from './components/gpgpuShaderVolumes.ts';
      export { AUX_VEL_FRAG, AUX_POS_FRAG, AUX_VEL_FRAG_PHASE20, AUX_POS_FRAG_PHASE20, buildAuxVelFrag, buildAuxPosFrag } from './components/gpgpuShaderAux.ts';
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
  // Phase 19 string variants: defaults above pin the v2.00
  // strings; these pin the Phase 19 (all-options-on) strings.
  SIM_VEL_FRAG_PHASE19: lib.SIM_VEL_FRAG_PHASE19,
  VEL_FRAG_PREAMBLE_PHASE19: lib.VEL_FRAG_PREAMBLE_PHASE19,
  VEL_FRAG_MAIN_SPH_GRAINS_PHASE19: lib.VEL_FRAG_MAIN_SPH_GRAINS_PHASE19,
  VEL_FRAG_MAIN_TAIL_PHASE19: lib.VEL_FRAG_MAIN_TAIL_PHASE19,
  SIM_POS_FRAG_PHASE19: lib.SIM_POS_FRAG_PHASE19,
  // Phase 19 fix2: the position variant whose projection
  // segment searches the sorted cell index. The stage-1
  // SIM_POS_FRAG_PHASE19 string above is unchanged — the cell
  // text is a separate, additional variant.
  SIM_POS_FRAG_PHASE19_CELL: lib.SIM_POS_FRAG_PHASE19_CELL,
  DRAW_VERT: lib.DRAW_VERT,
  DRAW_VERT_PHASE19: lib.DRAW_VERT_PHASE19,
  DRAW_FRAG: lib.DRAW_FRAG,
  DRAW_FRAG_PHASE19: lib.DRAW_FRAG_PHASE19,
  // Phase 20 stage 1 string variants: the cluster-colouring
  // additions splice in only behind the clusterColor builder
  // option; the defaults and Phase 19 variants above stay at
  // their v2.00 / Phase 19 hashes.
  DRAW_VERT_PHASE20: lib.DRAW_VERT_PHASE20,
  DRAW_FRAG_PHASE20: lib.DRAW_FRAG_PHASE20,
  'buildDrawVert(phase19+phase20)': lib.buildDrawVert({ vellumCrack: true, clusterColor: true }),
  'buildDrawFrag(phase19+phase20)': lib.buildDrawFrag({ vellumCrack: true, clusterColor: true }),
  // Phase 23 stage 2 string variants: the true-shadow-map
  // additions splice in only behind the shadowMap builder
  // option; every part above stays at its shipped hash.
  DRAW_VERT_PHASE23: lib.DRAW_VERT_PHASE23,
  DRAW_FRAG_PHASE23: lib.DRAW_FRAG_PHASE23,
  'buildDrawVert(shadowMap)': lib.buildDrawVert({ shadowMap: true }),
  'buildDrawFrag(shadowMap)': lib.buildDrawFrag({ shadowMap: true }),
  GEOM_VERT: lib.GEOM_VERT,
  GEOM_VERT_PHASE19: lib.GEOM_VERT_PHASE19,
  GEOM_FRAG: lib.GEOM_FRAG,
  GEOM_FRAG_PHASE19: lib.GEOM_FRAG_PHASE19,
  // Phase 24 stage 3 string variants: the GEOM true-shadow-map
  // additions splice in only behind the shadowMap builder
  // option; every part above stays at its shipped hash.
  GEOM_VERT_PHASE24: lib.GEOM_VERT_PHASE24,
  GEOM_FRAG_PHASE24: lib.GEOM_FRAG_PHASE24,
  'buildGeomVertShader(shadowMap)': lib.buildGeomVertShader({ shadowMap: true }),
  'buildGeomFragShader(shadowMap)': lib.buildGeomFragShader({ shadowMap: true }),
  'buildVelocityFragment(phase19)': lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true }),
  // Phase 20 stage 2 string variants: the crowd-steering
  // additions (preamble uniform set + 'steer-seek' chunk) splice
  // in only behind the steeringSeek builder option; every part
  // above stays at its shipped hash.
  VEL_FRAG_PREAMBLE_PHASE20: lib.VEL_FRAG_PREAMBLE_PHASE20,
  SIM_VEL_FRAG_PHASE20: lib.SIM_VEL_FRAG_PHASE20,
  'buildVelocityFragment(phase20)': lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true }),
  'buildVelocityFragment(steering-only)': lib.buildVelocityFragment('', '', { steeringSeek: true }),
  // Phase 24 string variants: the Akinci surface-tension
  // additions (preamble uniform + SPH-head declaration /
  // accumulation / application chunks) splice in only behind
  // the sphAkinci builder option; every part above stays at
  // its shipped hash.
  VEL_FRAG_PREAMBLE_PHASE24: lib.VEL_FRAG_PREAMBLE_PHASE24,
  VEL_FRAG_MAIN_SPH_GRAINS_PHASE24: lib.VEL_FRAG_MAIN_SPH_GRAINS_PHASE24,
  SIM_VEL_FRAG_PHASE24: lib.SIM_VEL_FRAG_PHASE24,
  'buildVelocityFragment(phase24)': lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true }),
  // Phase 27 (9-6 stage 1) string variants: the attractor
  // unit-2 additions, behind the attractor2 builder option;
  // every part above stays at its shipped hash.
  VEL_FRAG_PREAMBLE_PHASE27: lib.VEL_FRAG_PREAMBLE_PHASE27,
  SIM_VEL_FRAG_PHASE27: lib.SIM_VEL_FRAG_PHASE27,
  'buildVelocityFragment(phase27)': lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true }),
  'buildVelocityFragment(attractor2-only)': lib.buildVelocityFragment('', '', { attractor2: true }),
  // Phase 29 (9-6 stage 2) string variants: the attractor
  // unit-3 / unit-4 additions from the replication machinery,
  // behind their builder options; every part above stays at
  // its shipped hash.
  VEL_FRAG_PREAMBLE_PHASE29: lib.VEL_FRAG_PREAMBLE_PHASE29,
  SIM_VEL_FRAG_PHASE29: lib.SIM_VEL_FRAG_PHASE29,
  'buildVelocityFragment(phase29)': lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true, attractor3: true, attractor4: true }),
  'buildVelocityFragment(attractor3-only)': lib.buildVelocityFragment('', '', { attractor3: true }),
  'buildVelocityFragment(attractor4-only)': lib.buildVelocityFragment('', '', { attractor4: true }),
  'buildVelocityFragment(akinci-only)': lib.buildVelocityFragment('', '', { sphAkinci: true }),
  'buildVelocitySphGrains(akinci-only)': lib.buildVelocitySphGrains({ sphAkinci: true }),
  'buildPositionFragment(phase19)': lib.buildPositionFragment({ grainsProjection: true }),
  'buildPositionFragment(phase19-cell)': lib.buildPositionFragment({ grainsProjection: true, grainsCellSort: true }),
  // Phase 20 stage 4 string variants: the Aux event pool pair.
  // The defaults pin the v2.01.0 strings; the PHASE20 variants
  // carry the bounceSplash SDF contact source (UE5 #22), spliced
  // in only behind the sdfSplash builder option.
  AUX_VEL_FRAG: lib.AUX_VEL_FRAG,
  AUX_POS_FRAG: lib.AUX_POS_FRAG,
  AUX_VEL_FRAG_PHASE20: lib.AUX_VEL_FRAG_PHASE20,
  AUX_POS_FRAG_PHASE20: lib.AUX_POS_FRAG_PHASE20,
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
  phase19SnippetIsVariant: lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true }) === lib.SIM_VEL_FRAG_PHASE19,
  positionDefaultIsStock: lib.buildPositionFragment() === lib.SIM_POS_FRAG,
  positionPhase19IsVariant: lib.buildPositionFragment({ grainsProjection: true }) === lib.SIM_POS_FRAG_PHASE19,
  positionCellIsVariant: lib.buildPositionFragment({ grainsProjection: true, grainsCellSort: true }) === lib.SIM_POS_FRAG_PHASE19_CELL,
  positionCellNeedsProjection: lib.buildPositionFragment({ grainsCellSort: true }) === lib.SIM_POS_FRAG,
  phase20SnippetIsVariant: lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true }) === lib.SIM_VEL_FRAG_PHASE20,
  steeringOnlyDiffersFromStock: lib.buildVelocityFragment('', '', { steeringSeek: true }) !== lib.SIM_VEL_FRAG,
  phase24SnippetIsVariant: lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true }) === lib.SIM_VEL_FRAG_PHASE24,
  akinciOnlyDiffersFromStock: lib.buildVelocityFragment('', '', { sphAkinci: true }) !== lib.SIM_VEL_FRAG,
  phase27SnippetIsVariant: lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true }) === lib.SIM_VEL_FRAG_PHASE27,
  attractor2OnlyDiffersFromStock: lib.buildVelocityFragment('', '', { attractor2: true }) !== lib.SIM_VEL_FRAG,
  akinciSphGrainsIsVariant: lib.buildVelocitySphGrains({ grainsFullScan: true, sphAkinci: true }) === lib.VEL_FRAG_MAIN_SPH_GRAINS_PHASE24,
  drawDefaultIsStock: lib.buildDrawVert() === lib.DRAW_VERT && lib.buildDrawFrag() === lib.DRAW_FRAG,
  drawShadowMapIsVariant: lib.buildDrawVert({ shadowMap: true }) === lib.DRAW_VERT_PHASE23
    && lib.buildDrawFrag({ shadowMap: true }) === lib.DRAW_FRAG_PHASE23,
  geomShadowMapIsVariant: lib.buildGeomVertShader({ shadowMap: true }) === lib.GEOM_VERT_PHASE24
    && lib.buildGeomFragShader({ shadowMap: true }) === lib.GEOM_FRAG_PHASE24,
  auxDefaultIsStock: lib.buildAuxVelFrag() === lib.AUX_VEL_FRAG && lib.buildAuxPosFrag() === lib.AUX_POS_FRAG,
  auxPhase20IsVariant: lib.buildAuxVelFrag({ sdfSplash: true }) === lib.AUX_VEL_FRAG_PHASE20
    && lib.buildAuxPosFrag({ sdfSplash: true }) === lib.AUX_POS_FRAG_PHASE20,
};

console.log('phase18-shader-hash: GPGPU simulation shader byte identity');
for (const [name, m] of Object.entries(report.parts)) {
  console.log(`  ${name}: length ${m.length}, sha256 ${m.sha256}`);
}
console.log(`  invariant concatenation === SIM_VEL_FRAG: ${invariants.concatenationMatches}`);
console.log(`  invariant buildVelocityFragment('') === SIM_VEL_FRAG: ${invariants.emptySnippetIsStock}`);
console.log(`  invariant buildVelocityFragment(phase19) === SIM_VEL_FRAG_PHASE19: ${invariants.phase19SnippetIsVariant}`);
console.log(`  invariant buildPositionFragment() === SIM_POS_FRAG: ${invariants.positionDefaultIsStock}`);
console.log(`  invariant buildPositionFragment(phase19) === SIM_POS_FRAG_PHASE19: ${invariants.positionPhase19IsVariant}`);
console.log(`  invariant buildPositionFragment(phase19-cell) === SIM_POS_FRAG_PHASE19_CELL: ${invariants.positionCellIsVariant}`);
console.log(`  invariant buildPositionFragment(cell-only) === SIM_POS_FRAG: ${invariants.positionCellNeedsProjection}`);
console.log(`  invariant buildVelocityFragment(phase20) === SIM_VEL_FRAG_PHASE20: ${invariants.phase20SnippetIsVariant}`);
console.log(`  invariant buildVelocityFragment(steering-only) !== SIM_VEL_FRAG: ${invariants.steeringOnlyDiffersFromStock}`);
console.log(`  invariant buildVelocityFragment(phase24) === SIM_VEL_FRAG_PHASE24: ${invariants.phase24SnippetIsVariant}`);
console.log(`  invariant buildVelocityFragment(akinci-only) !== SIM_VEL_FRAG: ${invariants.akinciOnlyDiffersFromStock}`);
console.log(`  invariant buildVelocityFragment(phase27) === SIM_VEL_FRAG_PHASE27: ${invariants.phase27SnippetIsVariant}`);
console.log(`  invariant buildVelocityFragment(attractor2-only) !== SIM_VEL_FRAG: ${invariants.attractor2OnlyDiffersFromStock}`);
console.log(`  invariant buildVelocitySphGrains(phase19+akinci) === VEL_FRAG_MAIN_SPH_GRAINS_PHASE24: ${invariants.akinciSphGrainsIsVariant}`);
console.log(`  invariant buildDrawVert()/buildDrawFrag() === stock pair: ${invariants.drawDefaultIsStock}`);
console.log(`  invariant buildDrawVert(shadowMap)/buildDrawFrag(shadowMap) === PHASE23 pair: ${invariants.drawShadowMapIsVariant}`);
console.log(`  invariant buildGeomVertShader(shadowMap)/buildGeomFragShader(shadowMap) === PHASE24 pair: ${invariants.geomShadowMapIsVariant}`);
console.log(`  invariant buildAuxVelFrag()/buildAuxPosFrag() === stock pair: ${invariants.auxDefaultIsStock}`);
console.log(`  invariant buildAuxVelFrag(sdf)/buildAuxPosFrag(sdf) === PHASE20 pair: ${invariants.auxPhase20IsVariant}`);
if (!invariants.concatenationMatches || !invariants.emptySnippetIsStock
  || !invariants.phase19SnippetIsVariant || !invariants.positionDefaultIsStock
  || !invariants.positionPhase19IsVariant || !invariants.positionCellIsVariant
  || !invariants.positionCellNeedsProjection || !invariants.phase20SnippetIsVariant
  || !invariants.steeringOnlyDiffersFromStock
  || !invariants.phase24SnippetIsVariant || !invariants.akinciOnlyDiffersFromStock
  || !invariants.phase27SnippetIsVariant || !invariants.attractor2OnlyDiffersFromStock
  || !invariants.akinciSphGrainsIsVariant
  || !invariants.drawDefaultIsStock || !invariants.drawShadowMapIsVariant
  || !invariants.geomShadowMapIsVariant
  || !invariants.auxDefaultIsStock || !invariants.auxPhase20IsVariant) {
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
