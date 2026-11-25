// FLIP 3D WebGL freeze fix — S0 test pins (design draft
// FLIP_WEBGL_ATLAS_DESIGN_DRAFT §5 S0, §4.2, §4.3).
//
// (a) Invariant pin: in a '3d'-mode frame the resolved
// uFlipEnabled must never become true, and the 2D FLIP
// pipeline's uFlipBaseTex binding (gpgpuSimulationPasses.ts,
// end of runFluidAdvectionPass) must not execute. 案B reuses
// the dead uFlipBaseTex slot, so this invariant is the fix's
// structural foundation: if a future change lets the 2D
// pipeline run in a 3D frame, this test must fall.
//
// (b) Sampler-count assertion: for every variant combination
// (grains x flip3d x steering x akinci x attractor2/3/4) the
// assembled velocity fragment's sampler declaration count is
// taken TWICE:
//   raw      — the requested options fed straight into
//              buildVelocityFragment (no variant resolution).
//              flip3d+grains measures 17 here: the atlas merge
//              (S2) reuses the uFlipBaseTex slot so flip3d adds
//              0 net, but the Grains full scan still costs +1.
//   resolved — a config carrying the same combination run
//              through velocityVariantOptions, the product's
//              assembly path, on a stubbed 16-unit GPU (the
//              §4.3 floor case). There the downgrade resolves
//              grainsFullScan away whenever flip3d stands, so
//              flip3d+grains measures 16.
// The assertion is on the RESOLVED count; the raw count is
// pinned alongside it so the size of the downgrade's effect
// (17 raw vs 16 resolved) stays visible and cannot silently
// shrink or grow.
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.flip-s0-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { flip3dMode, flip3dActive } from './lib/flip3d.ts';
      export { buildVelocityFragment } from './components/gpgpuShaders.ts';
      export { velocityVariantOptions } from './components/useGpgpuSimulationAssets.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
// velocityVariantOptions probes MAX_TEXTURE_IMAGE_UNITS via
// lib/gpuDiagnostics.ts (cached on first call). Stub a
// 16-unit GPU — the §4.3 floor case this file's expectations
// are written for — before the bundle is imported, so the
// probe can only ever see the stub.
globalThis.document = {
  createElement: () => ({
    getContext: () => ({
      MAX_TEXTURE_IMAGE_UNITS: 35661,
      getParameter: () => 16,
      getExtension: () => null,
    }),
  }),
};
const { flip3dMode, flip3dActive, buildVelocityFragment, velocityVariantOptions } = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

// --- (a) invariant pin ------------------------------------------------
{
  const cfg3d = { gpgpuFlipMode: '3d', gpgpuFlipEnabled: true, gpgpuFluidEnabled: true };
  check("mode resolution: '3d' config resolves flip3dActive", flip3dMode(cfg3d) === '3d' && flip3dActive(cfg3d) === true);
  check("mode resolution: '2d' config never resolves flip3dActive",
    flip3dActive({ gpgpuFlipMode: '2d', gpgpuFlipEnabled: true, gpgpuFluidEnabled: true }) === false);

  const src = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  const fnStart = src.indexOf('export function runFluidAdvectionPass');
  const fnEnd = src.indexOf('\n}\n', fnStart);
  const fn = src.slice(fnStart, fnEnd);
  check('runFluidAdvectionPass located', fnStart >= 0 && fnEnd > fnStart);

  const trueAssign = 'velSimMat.uniforms.uFlipEnabled.value = true';
  check('uFlipEnabled=true is assigned exactly once in the whole file',
    src.split(trueAssign).length - 1 === 1, `count=${src.split(trueAssign).length - 1}`);
  const idxTrue = fn.indexOf(trueAssign);
  const idx3d = fn.indexOf("config.gpgpuFlipMode === '3d'");
  check("the '3d' early return precedes the uFlipEnabled=true assignment",
    idx3d >= 0 && idxTrue > idx3d, `idx3d=${idx3d} idxTrue=${idxTrue}`);
  const branch3d = fn.slice(idx3d, idxTrue);
  check("the '3d' branch sets uFlipEnabled=false and returns before the 2D pipeline",
    branch3d.includes('uFlipEnabled.value = false') && branch3d.includes('return;'));
  const idxBind = fn.indexOf('uFlipBaseTex.value =');
  check('the uFlipBaseTex binding sits in the same post-3d-return tail as uFlipEnabled=true',
    idxBind > idxTrue, `idxBind=${idxBind} idxTrue=${idxTrue}`);
  check('no uFlipEnabled=true assignment exists anywhere before the 3d branch',
    src.indexOf(trueAssign) > src.indexOf("config.gpgpuFlipMode === '3d'"));
}

// --- (b) sampler-count assertion ---------------------------------------
const countSamplers = (frag) => (frag.match(/uniform\s+sampler(?:2D|3D)\s+\w+\s*;/g) || []).length;
// Raw expectation (no variant resolution): base 16; the
// Grains full scan costs +1; flip3d contributes 0 net (S2
// moved its pair into the already-declared uFlipBaseTex
// slot). So flip3d+grains raw = 17 — one over the floor,
// which is exactly why the §4.3 downgrade has to exist.
const expectedRawCount = (grainsFullScan) => 16 + (grainsFullScan ? 1 : 0);
// Resolved expectation (velocityVariantOptions on the
// stubbed 16-unit GPU, design §3.3/§3.4/§4.3): the full scan
// survives resolution only when flip3d is off; with flip3d
// standing, the downgrade resolves it to subsample.
const expectedResolvedCount = (grainsFullScan, flip3dCouple) => 16 + (grainsFullScan && !flip3dCouple ? 1 : 0);
// The config velocityVariantOptions resolves each requested
// combination from. Every resolved dimension is driven by
// its own config keys, mirroring how the product builds it.
const configFor = (grainsFullScan, flip3dCouple, steeringSeek, sphAkinci, attr) => ({
  gpgpuGrainsNeighborhood: grainsFullScan ? 1 : 0,
  gpgpuFlipMode: flip3dCouple ? '3d' : '2d',
  gpgpuFlipEnabled: flip3dCouple,
  gpgpuFluidEnabled: flip3dCouple,
  gpgpuSteerSeekEnabled: steeringSeek,
  gpgpuSphEnabled: sphAkinci,
  gpgpuSphSurfaceTensionAkinci: sphAkinci ? 1 : 0,
  gpgpuAttractor2Enabled: !!attr.attractor2,
  gpgpuAttractor3Enabled: !!attr.attractor3,
  gpgpuAttractor4Enabled: !!attr.attractor4,
});

const attractorStates = [
  ['none', {}],
  ['a2', { attractor2: true }],
  ['a3', { attractor3: true }],
  ['a4', { attractor4: true }],
  ['a234', { attractor2: true, attractor3: true, attractor4: true }],
];
let combos = 0;
const measured = [];
for (const grainsFullScan of [false, true]) {
  for (const flip3dCouple of [false, true]) {
    for (const steeringSeek of [false, true]) {
      for (const sphAkinci of [false, true]) {
        for (const [attrName, attr] of attractorStates) {
          const label = `grains=${grainsFullScan ? 1 : 0} flip3d=${flip3dCouple ? 1 : 0} steering=${steeringSeek ? 1 : 0} akinci=${sphAkinci ? 1 : 0} attr=${attrName}`;
          const rawOpts = { grainsFullScan, flip3dCouple, steeringSeek, sphAkinci, attractor2: false, attractor3: false, attractor4: false, ...attr };
          const rawActual = countSamplers(buildVelocityFragment('', undefined, rawOpts));
          const rawExpected = expectedRawCount(grainsFullScan);
          const resolvedOpts = velocityVariantOptions(configFor(grainsFullScan, flip3dCouple, steeringSeek, sphAkinci, attr));
          const resolvedActual = countSamplers(buildVelocityFragment('', undefined, resolvedOpts));
          const resolvedExpected = expectedResolvedCount(grainsFullScan, flip3dCouple);
          combos += 1;
          measured.push(`${label}: raw=${rawActual} (expected ${rawExpected}) resolved=${resolvedActual} (expected ${resolvedExpected})`);
          check(`samplers (raw, unresolved) ${label}`,
            rawActual === rawExpected, `raw=${rawActual} expected=${rawExpected}`);
          check(`samplers (resolved via velocityVariantOptions) ${label}`,
            resolvedActual === resolvedExpected, `resolved=${resolvedActual} expected=${resolvedExpected}`);
        }
      }
    }
  }
}
console.log(`\nMeasured sampler counts (${combos} combinations, raw = before variant resolution, resolved = velocityVariantOptions on a 16-unit GPU):`);
for (const line of measured) console.log(`  ${line}`);

// The resolution rule itself, pinned directly: on the
// 16-unit GPU the full scan is resolved away exactly when
// flip3d stands, and kept otherwise.
{
  const on = velocityVariantOptions(configFor(true, true, false, false, {}));
  check('resolution: flip3d+grains on 16 units resolves grainsFullScan off (§4.3 downgrade)',
    on.grainsFullScan === false && on.flip3dCouple === true,
    JSON.stringify(on));
  const off = velocityVariantOptions(configFor(true, false, false, false, {}));
  check('resolution: grains without flip3d keeps the full scan',
    off.grainsFullScan === true && off.flip3dCouple === false,
    JSON.stringify(off));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
