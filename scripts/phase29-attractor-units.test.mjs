// Phase 29 — 9-6 stage 2: attractor units 3 and 4 via the
// replication machinery, plus the parent-resolution table
// extension in preset breeding. Checks:
//   - the ten new keys mirror unit 1's defaults and ship
//     disabled, so existing configs are untouched
//   - GLSL: deriveAttractorUnitChunk(2) reproduces the
//     historical Phase 27 derivation byte-for-byte; units 3/4
//     come from the same function and drive only their own
//     uniform families; all chunks are variant-gated (stock
//     assembly byte-identical) and land in order 1,2,3,4
//   - the preamble generator reproduces the Phase 27 unit-2
//     literal byte-for-byte; the Phase 29 preamble adds
//     exactly the unit-3/4 declaration sets
//   - WGSL: the unit-3/4 blocks are renames of the unit-2
//     block; the uniform struct appends their fields at the
//     tail (indices 156-163, VEL_UNIFORM_BYTES 624 -> 656)
//     and the writer writes those indices from the params
//   - routing: a non-legacy space mode on units 3/4 declares
//     'attractor-space-mode' exactly like units 1/2
//   - breeding: parent index arrays are inherited whole from
//     one parent config, never interpolated
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p29-attractor-units-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder } from './lib/gpgpuForceOrder.ts';
      export { VEL_FRAG_FORCE_ATTRACTOR, VEL_FRAG_FORCE_ATTRACTOR2, VEL_FRAG_FORCE_ATTRACTOR3, VEL_FRAG_FORCE_ATTRACTOR4, deriveAttractorUnitChunk, VEL_FRAG_FORCE_CHUNKS, buildMainForcesFragment, VEL_FRAG_MAIN_FORCES } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE29, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE29, buildAttractorUnitPreamble } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { breedConfigs, createSeededRng } from './lib/presetBreeding.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// ── Keys ────────────────────────────────────────────────────────
const defaultsSrc = readFileSync(join(ROOT, 'lib/appStateDefaultGpgpu.ts'), 'utf8');
for (const unit of [3, 4]) {
  check(`unit-${unit} keys present in defaults, mirroring unit 1, disabled`,
    defaultsSrc.includes(`gpgpuAttractor${unit}Enabled: false`)
    && defaultsSrc.includes(`gpgpuAttractor${unit}Type: 'lorenz'`)
    && defaultsSrc.includes(`gpgpuAttractor${unit}Strength: 1.0`)
    && defaultsSrc.includes(`gpgpuAttractor${unit}Scale: 8.0`)
    && defaultsSrc.includes(`gpgpuAttractor${unit}SpaceMode: 'legacy'`));
}

// ── GLSL chunk replication ──────────────────────────────────────
const historical2 = lib.VEL_FRAG_FORCE_ATTRACTOR
  .replace('// Strange Attractor\n', '// Strange Attractor (unit 2)\n')
  .replaceAll('uAttractor', 'uAttractor2');
check('deriveAttractorUnitChunk(2) === historical Phase 27 derivation',
  lib.deriveAttractorUnitChunk(2) === historical2 && lib.VEL_FRAG_FORCE_ATTRACTOR2 === historical2);
for (const unit of [3, 4]) {
  const chunk = lib.deriveAttractorUnitChunk(unit);
  check(`unit-${unit} chunk === deriveAttractorUnitChunk(${unit}) and is registered`,
    chunk === lib[`VEL_FRAG_FORCE_ATTRACTOR${unit}`] && lib.VEL_FRAG_FORCE_CHUNKS[`attractor-${unit}`] === chunk);
  check(`unit-${unit} chunk drives uAttractor${unit} uniforms only`,
    chunk.includes(`if (uAttractor${unit}Enabled)`)
    && chunk.includes(`uAttractor${unit}Strength * uDelta * 40.0`)
    && !new RegExp(`uAttractor(?!${unit})`).test(chunk));
  check(`chunk order: attractor-${unit} follows attractor-${unit - 1}`,
    lib.GPGPU_FORCE_CHUNK_NAMES.indexOf(`attractor-${unit}`) === lib.GPGPU_FORCE_CHUNK_NAMES.indexOf(`attractor-${unit - 1}`) + 1);
}
check('stock main forces carry no unit-3/4 trace',
  !lib.VEL_FRAG_MAIN_FORCES.includes('uAttractor3') && !lib.VEL_FRAG_MAIN_FORCES.includes('uAttractor4'));
check('stock velocity fragment carries no unit-3/4 trace',
  !lib.SIM_VEL_FRAG.includes('uAttractor3') && !lib.SIM_VEL_FRAG.includes('uAttractor4'));
const variantMain = lib.buildMainForcesFragment(undefined, { attractor2: true, attractor3: true, attractor4: true });
check('variant main forces: units land in order 1,2,3,4, adjacent',
  variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR2) === variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR) + lib.VEL_FRAG_FORCE_ATTRACTOR.length
  && variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR3) === variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR2) + lib.VEL_FRAG_FORCE_ATTRACTOR2.length
  && variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR4) === variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR3) + lib.VEL_FRAG_FORCE_ATTRACTOR3.length);
check('unit-3-only build contains unit 3 but not units 2/4',
  lib.buildVelocityFragment('', '', { attractor3: true }).includes(lib.VEL_FRAG_FORCE_ATTRACTOR3)
  && !lib.buildVelocityFragment('', '', { attractor3: true }).includes(lib.VEL_FRAG_FORCE_ATTRACTOR2)
  && !lib.buildVelocityFragment('', '', { attractor3: true }).includes(lib.VEL_FRAG_FORCE_ATTRACTOR4));
check('Phase 29 string === builder with every variant on',
  lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true, attractor3: true, attractor4: true }) === lib.SIM_VEL_FRAG_PHASE29);
check('force order normaliser keeps attractor-3/4 names in a user order',
  lib.normalizeGpgpuForceOrder('attractor-4,attractor-3')[0] === 'attractor-4'
  && lib.normalizeGpgpuForceOrder('attractor-4,attractor-3')[1] === 'attractor-3');

// ── Preamble generator ──────────────────────────────────────────
const historicalPreamble2 = `  // Strange attractor unit 2 (Phase 27, 9-6 stage 1): the
  // second parameter set of the attractor force ('attractor-2'
  // chunk). Spliced in only behind this option, in the
  // Phase 19 manner — the stock preamble carries no trace
  // of it.
  uniform bool  uAttractor2Enabled;
  uniform int   uAttractor2Type;
  uniform float uAttractor2Strength;
  uniform float uAttractor2Scale;
  uniform int   uAttractor2SpaceMode;
`;
check('preamble generator reproduces the Phase 27 unit-2 literal byte-for-byte',
  lib.buildAttractorUnitPreamble(2, 'second', 'Phase 27, 9-6 stage 1') === historicalPreamble2);
for (const unit of [3, 4]) {
  check(`Phase 29 preamble adds exactly the five unit-${unit} declarations`,
    [`uAttractor${unit}Enabled`, `uAttractor${unit}Type`, `uAttractor${unit}Strength`, `uAttractor${unit}Scale`, `uAttractor${unit}SpaceMode`]
      .every((u) => lib.VEL_FRAG_PREAMBLE_PHASE29.includes(u) && !lib.VEL_FRAG_PREAMBLE.includes(u)));
}

// ── WGSL twin ───────────────────────────────────────────────────
const wgsl = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
check('VEL uniform buffer is 656 bytes (624 through Phase 28)', wgsl.includes('const VEL_UNIFORM_BYTES = 656;'));
check('uniform struct appends unit-3/4 fields at the tail (after the Phase 28 pads)',
  wgsl.indexOf('attractor3Enabled : f32') > wgsl.indexOf('steerStatePad1 : f32')
  && wgsl.indexOf('attractor4Enabled : f32') > wgsl.indexOf('attractor3Enabled : f32')
  && wgsl.includes('attractor3Type : i32') && wgsl.includes('attractor4Scale : f32'));
check('writer writes indices 156-163 from the forces params',
  wgsl.includes('velU[156] = f && f.attractor3Enabled ? 1 : 0;')
  && wgsl.includes('velI[157] = f ? f.attractor3Type : 0;')
  && wgsl.includes('velU[158] = f ? f.attractor3Strength : 0;')
  && wgsl.includes('velU[159] = f ? f.attractor3Scale : 0;')
  && wgsl.includes('velU[160] = f && f.attractor4Enabled ? 1 : 0;')
  && wgsl.includes('velI[161] = f ? f.attractor4Type : 0;')
  && wgsl.includes('velU[162] = f ? f.attractor4Strength : 0;')
  && wgsl.includes('velU[163] = f ? f.attractor4Scale : 0;'));
check('forces params type carries the unit-3/4 fields',
  wgsl.includes('attractor3Enabled: boolean; attractor3Type: number; attractor3Strength: number; attractor3Scale: number;')
  && wgsl.includes('attractor4Enabled: boolean; attractor4Type: number; attractor4Strength: number; attractor4Scale: number;'));
const blockOf = (unit) => {
  // Anchor on the two-line shader header (the uniform-struct
  // comment shares the first line and must not match).
  const start = wgsl.indexOf(`// Strange attractor unit ${unit} (Phase ${unit === 2 ? '27, 9-6 stage 1' : '29, 9-6 stage 2'}):\n  // the same 12 laws, driven by the attractor${unit}* fields.`);
  const end = wgsl.indexOf('\n  }\n', wgsl.indexOf(`u.attractor${unit}Strength * u.delta * 40.0`)) + 4;
  return { start, text: wgsl.slice(start, end) };
};
const b2 = blockOf(2); const b3 = blockOf(3); const b4 = blockOf(4);
check('WGSL unit-3 block === rename of the unit-2 block',
  b3.text === b2.text
    .replace('(Phase 27, 9-6 stage 1)', '(Phase 29, 9-6 stage 2)')
    .replace('unit 2', 'unit 3')
    .replaceAll('attractor2', 'attractor3'),
  `lens ${b2.text.length}/${b3.text.length}`);
check('WGSL unit-4 block === rename of the unit-2 block',
  b4.text === b2.text
    .replace('(Phase 27, 9-6 stage 1)', '(Phase 29, 9-6 stage 2)')
    .replace('unit 2', 'unit 4')
    .replaceAll('attractor2', 'attractor4'),
  `lens ${b2.text.length}/${b4.text.length}`);
check('WGSL units sit in order 2,3,4 before Lévy',
  b2.start < b3.start && b3.start < b4.start && wgsl.indexOf('// Lévy flight', b4.start) > b4.start);

// ── Routing ─────────────────────────────────────────────────────
const foundation = readFileSync(join(ROOT, 'lib/webgpuComputeFoundation.ts'), 'utf8');
for (const unit of [3, 4]) {
  check(`unit-${unit} non-legacy space mode declares attractor-space-mode`,
    foundation.includes(`config.gpgpuAttractor${unit}Enabled && config.gpgpuAttractor${unit}SpaceMode && config.gpgpuAttractor${unit}SpaceMode !== 'legacy') features.push('attractor-space-mode')`));
}

// ── Breeding: parent arrays are inherited whole ─────────────────
const parentA = { layer1SourceParents: [1, -1, 0], layer2SourceParents: [2, 0], layer3SourceParents: [-1, -1, 1] };
const parentB = { layer1SourceParents: [2, 0, -1], layer2SourceParents: [0, -1], layer3SourceParents: [0, 2, -1] };
let inheritOk = true;
for (let seed = 1; seed <= 24 && inheritOk; seed += 1) {
  const child = lib.breedConfigs(parentA, parentB, 0.5, lib.createSeededRng(seed));
  for (const key of Object.keys(parentA)) {
    const got = JSON.stringify(child[key]);
    if (got !== JSON.stringify(parentA[key]) && got !== JSON.stringify(parentB[key])) inheritOk = false;
  }
}
check('breeding inherits parent index arrays whole from one side (24 seeds, t=0.5)', inheritOk);
const breedingSrc = readFileSync(join(ROOT, 'lib/presetBreeding.ts'), 'utf8');
check('INHERIT_ONLY_KEYS lists all three SourceParents keys',
  breedingSrc.includes("'layer1SourceParents'") && breedingSrc.includes("'layer2SourceParents'") && breedingSrc.includes("'layer3SourceParents'"));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
