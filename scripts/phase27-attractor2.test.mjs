// Phase 27 — 9-6 stage 1: strange attractor unit 2 (the
// '2号機' second parameter set, Aux2-style). Checks:
//   - the five new keys mirror unit 1's defaults and the unit
//     ships disabled, so existing configs are untouched
//   - GLSL: the 'attractor-2' chunk is DERIVED from the unit-1
//     chunk by uniform-prefix renaming (the force laws can
//     never drift apart), it is variant-gated exactly like
//     'steer-seek' (stock assembly byte-identical), and in the
//     variant assembly it lands immediately after unit 1
//   - the Phase 27 full string equals the builder output with
//     every variant on, and the preamble gains exactly the
//     five uAttractor2* declarations
//   - WGSL: the unit-2 block in the velocity shader is the
//     unit-1 block under the u.attractor -> u.attractor2
//     rename; the uniform struct appends the four fields at
//     indices 148-151 (VEL_UNIFORM_BYTES 592 -> 608) and the
//     writer writes those indices from the forces params
//   - routing: a non-legacy space mode on unit 2 declares
//     'attractor-space-mode' exactly like unit 1 (the WGSL
//     twin stays legacy-only on both units)
//   - plumbing: variant selection, the variant key, the
//     material uniform entries, the pass-layer writes (both
//     routes) and the panel section all reference unit 2
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p27-attractor2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { GPGPU_FORCE_CHUNK_NAMES, normalizeGpgpuForceOrder } from './lib/gpgpuForceOrder.ts';
      export { VEL_FRAG_FORCE_ATTRACTOR, VEL_FRAG_FORCE_ATTRACTOR2, VEL_FRAG_FORCE_CHUNKS, buildMainForcesFragment, VEL_FRAG_MAIN_FORCES } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { SIM_VEL_FRAG, SIM_VEL_FRAG_PHASE27, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
      export { VEL_FRAG_PREAMBLE, VEL_FRAG_PREAMBLE_PHASE27 } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// ── Keys ────────────────────────────────────────────────────────
const defaultsSrc = readFileSync(join(ROOT, 'lib/appStateDefaultGpgpu.ts'), 'utf8');
check('unit-2 keys present in defaults', defaultsSrc.includes('gpgpuAttractor2Enabled: false')
  && defaultsSrc.includes("gpgpuAttractor2Type: 'lorenz'")
  && defaultsSrc.includes('gpgpuAttractor2Strength: 1.0')
  && defaultsSrc.includes('gpgpuAttractor2Scale: 8.0')
  && defaultsSrc.includes("gpgpuAttractor2SpaceMode: 'legacy'"));
check('unit-2 defaults mirror unit 1 (disabled)', defaultsSrc.includes('gpgpuAttractorEnabled: false')
  && defaultsSrc.includes("gpgpuAttractorType: 'lorenz'")
  && defaultsSrc.includes('gpgpuAttractorStrength: 1.0')
  && defaultsSrc.includes('gpgpuAttractorScale: 8.0')
  && defaultsSrc.includes("gpgpuAttractorSpaceMode: 'legacy'"));

// ── GLSL chunk derivation + gating ─────────────────────────────
const derived = lib.VEL_FRAG_FORCE_ATTRACTOR
  .replace('// Strange Attractor\n', '// Strange Attractor (unit 2)\n')
  .replaceAll('uAttractor', 'uAttractor2');
check('GLSL unit-2 chunk === rename derivation of unit 1', lib.VEL_FRAG_FORCE_ATTRACTOR2 === derived);
check('GLSL unit-2 chunk drives uAttractor2 uniforms only',
  lib.VEL_FRAG_FORCE_ATTRACTOR2.includes('if (uAttractor2Enabled)')
  && lib.VEL_FRAG_FORCE_ATTRACTOR2.includes('uAttractor2Strength * uDelta * 40.0')
  && !/uAttractor(?!2)/.test(lib.VEL_FRAG_FORCE_ATTRACTOR2));
check('chunk order: attractor-2 immediately after attractor',
  lib.GPGPU_FORCE_CHUNK_NAMES.indexOf('attractor-2') === lib.GPGPU_FORCE_CHUNK_NAMES.indexOf('attractor') + 1);
check('stock main forces carry no unit-2 trace', !lib.VEL_FRAG_MAIN_FORCES.includes('uAttractor2'));
check('stock velocity fragment carries no unit-2 trace', !lib.SIM_VEL_FRAG.includes('uAttractor2'));
const variantMain = lib.buildMainForcesFragment(undefined, { attractor2: true });
check('variant main forces: unit 2 lands right after unit 1',
  variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR2) === variantMain.indexOf(lib.VEL_FRAG_FORCE_ATTRACTOR) + lib.VEL_FRAG_FORCE_ATTRACTOR.length);
check('Phase 27 string === builder with every variant on',
  lib.buildVelocityFragment('', '', { grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true }) === lib.SIM_VEL_FRAG_PHASE27);
check('attractor2-only build differs from stock and contains the chunk',
  lib.buildVelocityFragment('', '', { attractor2: true }) !== lib.SIM_VEL_FRAG
  && lib.buildVelocityFragment('', '', { attractor2: true }).includes(lib.VEL_FRAG_FORCE_ATTRACTOR2));
check('preamble Phase 27 adds exactly the five unit-2 declarations',
  ['uAttractor2Enabled', 'uAttractor2Type', 'uAttractor2Strength', 'uAttractor2Scale', 'uAttractor2SpaceMode']
    .every((u) => lib.VEL_FRAG_PREAMBLE_PHASE27.includes(u) && !lib.VEL_FRAG_PREAMBLE.includes(u)));

// ── WGSL twin ───────────────────────────────────────────────────
const wgsl = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
check('VEL uniform buffer 768 (736 through G10 stage 2; stage 3 appended the particle-rules field)', wgsl.includes('const VEL_UNIFORM_BYTES = 768;'));
check('uniform struct appends attractor2 fields after steerPath',
  wgsl.indexOf('attractor2Enabled : f32') > wgsl.indexOf('steerPath : array<vec3f, 8>')
  && wgsl.includes('attractor2Type : i32') && wgsl.includes('attractor2Strength : f32') && wgsl.includes('attractor2Scale : f32'));
check('writer writes indices 148-151 from the forces params',
  wgsl.includes('velU[148] = f && f.attractor2Enabled ? 1 : 0;')
  && wgsl.includes('velI[149] = f ? f.attractor2Type : 0;')
  && wgsl.includes('velU[150] = f ? f.attractor2Strength : 0;')
  && wgsl.includes('velU[151] = f ? f.attractor2Scale : 0;'));
check('forces params type carries the unit-2 fields',
  wgsl.includes('attractor2Enabled: boolean; attractor2Type: number; attractor2Strength: number; attractor2Scale: number;'));
const block1Start = wgsl.indexOf('// Strange attractors (all 12 WebGL types');
const block1End = wgsl.indexOf('\n  }\n', wgsl.indexOf('u.attractorStrength * u.delta * 40.0')) + 4;
const block2Start = wgsl.indexOf('// Strange attractor unit 2 (Phase 27', block1End);
const block2End = wgsl.indexOf('\n  }\n', wgsl.indexOf('u.attractor2Strength * u.delta * 40.0')) + 4;
const block1 = wgsl.slice(block1Start, block1End);
const block2 = wgsl.slice(block2Start, block2End);
check('WGSL unit-2 block === rename of the unit-1 block',
  block2 === block1
    .replace('// Strange attractors (all 12 WebGL types, verbatim force laws).',
      '// Strange attractor unit 2 (Phase 27, 9-6 stage 1):\n  // the same 12 laws, driven by the attractor2* fields.')
    .replaceAll('u.attractor', 'u.attractor2'),
  `lens ${block1.length}/${block2.length}`);
check('WGSL unit 2 sits between unit 1 and Lévy', block2Start > block1End && wgsl.indexOf('// Lévy flight', block2End) > block2End);

// ── Routing + plumbing ──────────────────────────────────────────
const foundation = readFileSync(join(ROOT, 'lib/webgpuComputeFoundation.ts'), 'utf8');
check('unit-2 non-legacy space mode declares attractor-space-mode',
  foundation.includes("config.gpgpuAttractor2Enabled && config.gpgpuAttractor2SpaceMode && config.gpgpuAttractor2SpaceMode !== 'legacy') features.push('attractor-space-mode')"));
const assets = readFileSync(join(ROOT, 'components/useGpgpuSimulationAssets.ts'), 'utf8');
check('variant selection reads the unit-2 enable key', assets.includes('attractor2: !!config.gpgpuAttractor2Enabled'));
check('material declares the five unit-2 uniform entries',
  ['uAttractor2Enabled', 'uAttractor2Type', 'uAttractor2Strength', 'uAttractor2Scale', 'uAttractor2SpaceMode']
    .every((u) => assets.includes(`${u}:`)));
const passes = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
check('passes feed unit 2 on the WGSL route', passes.includes('attractor2Enabled: config.gpgpuAttractor2Enabled')
  && passes.includes('attractor2Scale: config.gpgpuAttractor2Scale'));
check('passes write unit 2 on the WebGL route', passes.includes('uAttractor2Enabled.value = config.gpgpuAttractor2Enabled')
  && passes.includes('uAttractor2SpaceMode.value'));
const panel = readFileSync(join(ROOT, 'components/controlPanelGlobalDisplayGpgpuForcesCore.tsx'), 'utf8');
check('panel has the Strange Attractor 2 section', panel.includes('label="Strange Attractor 2"')
  && panel.includes("updateConfig('gpgpuAttractor2Type', v)")
  && panel.includes("updateConfig('gpgpuAttractor2SpaceMode', v)"));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
