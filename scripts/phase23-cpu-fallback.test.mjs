// Phase 23 block 3 — CPU fallback regression pin (scripts/ formalisation).
//
// What this is: a self-contained, in-repo version of the Phase X2 CPU
// port checks that used to live only outside the repo at
// ~/workspace/kalokagathia-pro/phasex2_cpu_port_test.mjs. That external
// harness depended on a recovered pre-X2 legacy sim fixture, and its
// two signature assertions went stale (25/27 in MAINT_PHASE_REPORT)
// after Phase AA extended the morph signature. This file drops the
// legacy dependency entirely and pins the CURRENT (v2.05) behaviour
// directly:
//
//   (a) OBJ normal kick: velocity aligns along the baked normals,
//       the burst decays and the shape re-forms, raising the speed
//       key re-triggers the envelope, speed 0 is inert, and the
//       kick also fires inside attractor mode.
//   (b) Morph inside attractor mode: normalised positions converge
//       onto the assigned morph targets far beyond the
//       attractor-only control.
//   (c) Age lifecycle + replica age phase: the age gate, the exact
//       per-replica initial-age offset, wrap restarting at the
//       replica offset and respawning at home, ages staying inside
//       the lifecycle, and ages staying 0 while the system is off.
//   (bake) buildCpuMorphData targets equal the buildCpuMorphTargets
//       wrapper and the OBJ normals are unit directions.
//   (sig) cpuShapeSignature: the morph-off string is the plain base
//       string; the morph-on string is exactly the current field
//       order (legacy fields + Phase AA stamp/disperse/twist/fractal
//       + Phase AM path/glyph/contour + Phase AW polygon/jitter);
//       the age block appends only while the age system is live.
//       If a future phase legitimately adds bake-input fields, this
//       section is the place to update — deliberately, in the open.
//
// Run: node scripts/phase23-cpu-fallback.test.mjs
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p23cpu-bundle-${process.pid}.mjs`);
let failures = 0;
let passes = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (cond) passes += 1; else failures += 1;
};
const bitEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

await build({
  stdin: {
    contents: `
      export {
        createCpuParticleState, stepCpuParticles, buildCpuMorphData,
        buildCpuMorphTargets, cpuShapeSignature, isCpuAgeLive,
        cpuReplicaIndexOf, cpuAgeRestartAge, resolveCpuParticleCount,
      } from './lib/cpuParticleSim.ts';
      export { sampleObjPointCloudWithNormals } from './lib/objMorph.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const sim = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  createCpuParticleState, stepCpuParticles, buildCpuMorphData,
  buildCpuMorphTargets, cpuShapeSignature, isCpuAgeLive,
  cpuReplicaIndexOf, cpuAgeRestartAge, resolveCpuParticleCount,
  sampleObjPointCloudWithNormals,
} = sim;

const BASE = {
  layer1Enabled: true, layer1Count: 1200, layer1SourceCount: 1200,
  layer2Enabled: false, layer2Count: 0,
  layer3Enabled: false, layer3Count: 0,
  gpgpuEnabled: true, gpgpuCount: 4000, gpgpuSeed: 7,
  sphereRadius: 50, jitter: 0,
  gpgpuAttractorEnabled: false, gpgpuAttractorType: 'thomas', gpgpuAttractorScale: 1, gpgpuAttractorStrength: 1,
  gpgpuTurbulence: 0.3, gpgpuCurlEnabled: true, gpgpuCurlStrength: 0.8,
  gpgpuGravity: 0.2, gpgpuVortexEnabled: false, gpgpuVortexStrength: 0,
  gpgpuWindEnabled: false, gpgpuWindX: 0, gpgpuWindY: 0, gpgpuWindStrength: 0,
  gpgpuMorphEnabled: false, gpgpuMorphTarget: 'trefoil',
  gpgpuMorphStrength: 3.0, gpgpuMorphScale: 1.0, gpgpuMorphJitter: 0.05, gpgpuMorphOrbitSpeed: 0,
  gpgpuMorphSvgSource: '', gpgpuMorphObjSource: '', gpgpuMorphObjSampleMode: 'surface',
  gpgpuMorphObjNormalSpeed: 0,
  gpgpuMorphReplicaCount: 1, gpgpuMorphReplicaSpacing: 0.6, gpgpuMorphReplicaAxis: 'x',
  gpgpuMorphReplicaRotation: 0, gpgpuMorphReplicaScaleStep: 1, gpgpuMorphReplicaPhaseStep: 0,
  gpgpuMorphReplicaAgeStep: 0,
  gpgpuMorphTerrainAmplitude: 0.55, gpgpuMorphTerrainFrequency: 1.6, gpgpuMorphTerrainOctaves: 4, gpgpuMorphTerrainSeed: 0,
  gpgpuMorphPathMode: 'off', gpgpuMorphPathWriteOnStart: 0, gpgpuMorphPathWriteOnEnd: 1,
  gpgpuMorphPathTaper: 0, gpgpuMorphPathTaperShape: 'linear', gpgpuMorphPathSubpathMode: 'proportional',
  gpgpuMaskMode: 'off', gpgpuMaskMap: null, gpgpuMaskMapWidth: 0, gpgpuMaskMapHeight: 0,
  gpgpuMaskThreshold: 0.5, gpgpuMaskInvert: false,
  gpgpuAgeEnabled: false, gpgpuAgeMax: 8,
  gpgpuBounceRadius: 150,
  layer2TextMapText: 'TEXT', layer2TextMapFontFamily: 'Arial', layer2TextMapWeight: 700,
  layer2TextMapSize: 0.76, layer2TextMapPadding: 0.1, layer2TextMapInvert: false,
  layer2MediaLumaMap: [], layer2MediaMapWidth: 0, layer2MediaMapHeight: 0,
};

const OBJ_TEXT = [
  'v 0 1 0', 'v 1 0 0', 'v 0 0 1', 'v -1 0 0', 'v 0 0 -1', 'v 0 -1 0',
  'f 1 2 3', 'f 1 3 4', 'f 1 4 5', 'f 1 5 2',
  'f 6 3 2', 'f 6 4 3', 'f 6 5 4', 'f 6 2 5',
].join('\n');

function runSteps(state, cfg, steps, dt = 1 / 60) {
  let t = 0;
  for (let s = 0; s < steps; s++) { t += dt; stepCpuParticles(state, cfg, dt, t); }
  return state;
}

// ---------------------------------------------------------------- bake
{
  const cfg = { ...BASE, gpgpuMorphEnabled: true, gpgpuMorphTarget: 'obj', gpgpuMorphObjSource: OBJ_TEXT };
  const count = resolveCpuParticleCount(cfg);
  const sample = sampleObjPointCloudWithNormals(OBJ_TEXT, 'surface');
  check('obj sample produced', !!sample);
  const extras = { objPoints: sample.points, objNormals: sample.normals };
  const data = buildCpuMorphData(cfg, count, extras);
  check('bake wrapper buildCpuMorphTargets matches buildCpuMorphData targets',
    bitEqual(buildCpuMorphTargets(cfg, count, extras), data.targets));
  let lenSum = 0; let n = 0;
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(data.normals[i * 3], data.normals[i * 3 + 1], data.normals[i * 3 + 2]);
    if (l > 0.01) { lenSum += l; n++; }
  }
  check('bake normals are unit directions', n > count * 0.9 && Math.abs(lenSum / n - 1) < 0.05,
    `n=${n}/${count} meanLen=${n ? (lenSum / n).toFixed(4) : 'n/a'}`);
}

// ---------------------------------------------------------------- (a)
// OBJ normal kick.
{
  const objCfg = {
    ...BASE, gpgpuMorphEnabled: true, gpgpuMorphTarget: 'obj', gpgpuMorphObjSource: OBJ_TEXT,
    gpgpuTurbulence: 0, gpgpuCurlEnabled: false, gpgpuGravity: 0, gpgpuMorphJitter: 0,
  };
  const count = resolveCpuParticleCount(objCfg);
  const sample = sampleObjPointCloudWithNormals(OBJ_TEXT, 'surface');
  const extras = { objPoints: sample.points, objNormals: sample.normals };
  const bake = buildCpuMorphData(objCfg, count, extras);
  const meanAlign = (state) => {
    let sum = 0;
    for (let i = 0; i < state.count; i++) {
      sum += state.vel[i * 3] * bake.normals[i * 3]
        + state.vel[i * 3 + 1] * bake.normals[i * 3 + 1]
        + state.vel[i * 3 + 2] * bake.normals[i * 3 + 2];
    }
    return sum / state.count;
  };
  const meanTargetDist = (state) => {
    let sum = 0;
    for (let i = 0; i < state.count; i++) {
      sum += Math.hypot(
        state.pos[i * 3] - bake.targets[i * 4],
        state.pos[i * 3 + 1] - bake.targets[i * 4 + 1],
        state.pos[i * 3 + 2] - bake.targets[i * 4 + 2],
      );
    }
    return sum / state.count;
  };

  const kickedCfg = { ...objCfg, gpgpuMorphObjNormalSpeed: 42 };
  const kicked = createCpuParticleState(kickedCfg, null, bake.targets, bake.normals);
  const control = createCpuParticleState(objCfg, null, bake.targets, bake.normals);
  runSteps(kicked, kickedCfg, 8);
  runSteps(control, objCfg, 8);
  const alignKicked = meanAlign(kicked);
  const alignControl = meanAlign(control);
  check('kick aligns velocity with normals', alignKicked > 1.0 && alignKicked > alignControl + 0.8,
    `kicked=${alignKicked.toFixed(3)} control=${alignControl.toFixed(3)}`);
  check('kick bursts outward (target distance grows early)',
    meanTargetDist(kicked) > meanTargetDist(control) + 0.05);

  runSteps(kicked, kickedCfg, 172);
  runSteps(control, objCfg, 172);
  const dK = meanTargetDist(kicked); const dC = meanTargetDist(control);
  check('kick decays and the shape re-forms', Math.abs(dK - dC) < 0.25 * Math.max(dC, 0.05),
    `kicked=${dK.toFixed(4)} control=${dC.toFixed(4)}`);

  const reCfg = { ...objCfg };
  const re = createCpuParticleState(reCfg, null, bake.targets, bake.normals);
  runSteps(re, reCfg, 120);
  const before = meanAlign(re);
  reCfg.gpgpuMorphObjNormalSpeed = 42;
  runSteps(re, reCfg, 8);
  const after = meanAlign(re);
  check('kick re-triggers on speed change', after > before + 0.8,
    `before=${before.toFixed(3)} after=${after.toFixed(3)}`);

  const attCfg = { ...objCfg, gpgpuAttractorEnabled: true, gpgpuAttractorType: 'lorenz', gpgpuMorphObjNormalSpeed: 42 };
  const att0Cfg = { ...attCfg, gpgpuMorphObjNormalSpeed: 0 };
  const attK = createCpuParticleState(attCfg, null, bake.targets, bake.normals);
  const attC = createCpuParticleState(att0Cfg, null, bake.targets, bake.normals);
  runSteps(attK, attCfg, 8);
  runSteps(attC, att0Cfg, 8);
  check('kick active inside attractor mode', !bitEqual(attK.vel, attC.vel) && meanAlign(attK) > meanAlign(attC) + 0.3);
}

// ---------------------------------------------------------------- (b)
// Morph inside attractor mode.
{
  const attBase = {
    ...BASE, gpgpuAttractorEnabled: true, gpgpuAttractorType: 'lorenz',
    gpgpuTurbulence: 0, gpgpuCurlEnabled: false, gpgpuGravity: 0,
  };
  const morphCfg = { ...attBase, gpgpuMorphEnabled: true };
  const count = resolveCpuParticleCount(attBase);
  const bake = buildCpuMorphData(morphCfg, count, {});
  const meanNormTargetDist = (state) => {
    const div = state.attractorRenderDivisor;
    let sum = 0;
    for (let i = 0; i < state.count; i++) {
      sum += Math.hypot(
        state.pos[i * 3] / div - bake.targets[i * 4],
        state.pos[i * 3 + 1] / div - bake.targets[i * 4 + 1],
        state.pos[i * 3 + 2] / div - bake.targets[i * 4 + 2],
      );
    }
    return sum / state.count;
  };
  const withMorph = createCpuParticleState(morphCfg, null, bake.targets, bake.normals);
  const control = createCpuParticleState(attBase, null, null, null);
  runSteps(withMorph, morphCfg, 300);
  runSteps(control, attBase, 300);
  const dM = meanNormTargetDist(withMorph); const dC = meanNormTargetDist(control);
  check('morph pulls attractor particles onto targets', dM < dC * 0.6,
    `morph=${dM.toFixed(4)} control=${dC.toFixed(4)}`);
}

// ---------------------------------------------------------------- (c)
// Age lifecycle + replica age phase.
{
  const ageCfg = {
    ...BASE, gpgpuMorphEnabled: true, gpgpuMorphReplicaCount: 4,
    gpgpuAgeEnabled: true, gpgpuAgeMax: 8, gpgpuMorphReplicaAgeStep: 0.25,
  };
  check('age live gate', isCpuAgeLive(ageCfg) === true);
  check('age not live when disabled', isCpuAgeLive({ ...ageCfg, gpgpuAgeEnabled: false }) === false);
  check('age not live at ageMax 0', isCpuAgeLive({ ...ageCfg, gpgpuAgeMax: 0 }) === false);
  const count = resolveCpuParticleCount(ageCfg);
  const bake = buildCpuMorphData(ageCfg, count, {});
  const phased = createCpuParticleState(ageCfg, null, bake.targets, bake.normals);
  const plain = createCpuParticleState({ ...ageCfg, gpgpuMorphReplicaAgeStep: 0 }, null, bake.targets, bake.normals);
  let offsetOk = true;
  for (let i = 0; i < count; i++) {
    const r = cpuReplicaIndexOf(i, 4);
    const expected = r * 0.25 * 8;
    let diff = (phased.age[i] - plain.age[i]) % 8;
    if (diff < 0) diff += 8;
    if (Math.abs(diff - expected) > 1e-6) { offsetOk = false; break; }
  }
  check('initial age offset per replica block (exact)', offsetOk);

  const idx = (() => { for (let i = 0; i < count; i++) if (cpuReplicaIndexOf(i, 4) === 2) return i; return -1; })();
  check('found a block-2 particle', idx >= 0);
  const st = createCpuParticleState(ageCfg, null, bake.targets, bake.normals);
  st.age[idx] = 8 - 0.001;
  st.pos[idx * 3] = 99; st.pos[idx * 3 + 1] = 99; st.pos[idx * 3 + 2] = 99;
  stepCpuParticles(st, ageCfg, 1 / 60, 1 / 60);
  check('wrap restarts at replica offset', Math.abs(st.age[idx] - cpuAgeRestartAge(ageCfg, idx)) < 1e-9
    && Math.abs(st.age[idx] - 4) < 1e-9, `age=${st.age[idx]}`);
  check('wrap respawns at home', st.pos[idx * 3] === st.home[idx * 3]
    && st.pos[idx * 3 + 1] === st.home[idx * 3 + 1] && st.pos[idx * 3 + 2] === st.home[idx * 3 + 2]);

  const run = createCpuParticleState(ageCfg, null, bake.targets, bake.normals);
  runSteps(run, ageCfg, 600);
  let inRange = true;
  for (let i = 0; i < count; i++) if (!(run.age[i] >= 0 && run.age[i] <= 8)) { inRange = false; break; }
  check('ages stay inside the lifecycle over 10 s', inRange);
  const offCfg = { ...ageCfg, gpgpuAgeEnabled: false };
  const off = createCpuParticleState(offCfg, null, bake.targets, bake.normals);
  runSteps(off, offCfg, 60);
  check('ages stay 0 while age is off', off.age.every((v) => v === 0) && off.ageLive === false);
}

// ---------------------------------------------------------------- (sig)
// Signature, pinned to the CURRENT field order in cpuShapeSignature
// (lib/cpuParticleSim.ts). The morph field list below mirrors the
// implementation order exactly: the first 19 fields, then Phase AA
// stamp (4), Phase AM path/glyph/contour (6), AA tail disperse /
// twist / fractal (7), the source-hash + text/media fields, and
// finally the Phase AW polygon / path-jitter pair. The two source
// hashes are internal (cpuSourceHash is not exported), so for the
// empty sources in BASE they are pinned by position and by the
// surrounding fields rather than by value: the expected string is
// built by splitting the actual signature and re-joining with the
// hash slots masked — every other slot must match exactly.
{
  const count = resolveCpuParticleCount(BASE);
  const expectedBase = [
    count,
    1, BASE.layer1Count, BASE.layer1SourceCount,
    0, BASE.layer2Count,
    0, BASE.layer3Count,
    1, BASE.gpgpuSeed,
    BASE.sphereRadius,
    'none',
    BASE.gpgpuAttractorScale,
  ].join('|');
  check('signature (morph+age off) is the plain base string',
    cpuShapeSignature({ ...BASE }) === expectedBase,
    cpuShapeSignature({ ...BASE }));

  const morph = { ...BASE, gpgpuMorphEnabled: true };
  const sig = cpuShapeSignature(morph);
  check('signature (morph on) starts with base + morph block',
    sig.startsWith(`${expectedBase}|morph:`), sig.slice(0, 80));
  const fields = sig.slice(`${expectedBase}|morph:`.length).split(',');
  // Expected non-hash slots, in implementation order. null = the
  // cpuSourceHash slots (svg, obj), pinned by count/position only.
  const expectedFields = [
    morph.gpgpuMorphTarget,
    morph.gpgpuMorphScale, morph.gpgpuMorphJitter,
    morph.gpgpuMorphReplicaCount, morph.gpgpuMorphReplicaSpacing,
    morph.gpgpuMorphReplicaAxis, morph.gpgpuMorphReplicaRotation,
    morph.gpgpuMorphReplicaScaleStep, morph.gpgpuMorphReplicaPhaseStep,
    morph.gpgpuMorphTerrainAmplitude, morph.gpgpuMorphTerrainFrequency,
    morph.gpgpuMorphTerrainOctaves, morph.gpgpuMorphTerrainSeed,
    morph.gpgpuMorphPathMode, morph.gpgpuMorphPathWriteOnStart,
    morph.gpgpuMorphPathWriteOnEnd, morph.gpgpuMorphPathTaper,
    morph.gpgpuMorphPathTaperShape, morph.gpgpuMorphPathSubpathMode,
    // Phase AA stamp
    morph.gpgpuMorphStampSpacing, morph.gpgpuMorphStampSize,
    morph.gpgpuMorphStampShape, morph.gpgpuMorphStampAlign,
    // Phase AM path offset / glyph / contour
    morph.gpgpuMorphPathOffset,
    morph.gpgpuMorphTextOnPathGlyphScale, morph.gpgpuMorphTextOnPathGlyphRotate,
    morph.gpgpuMorphTextOnPathGlyphFade,
    morph.gpgpuMorphContourSource, morph.gpgpuMorphContourThreshold,
    // Phase AA tail: disperse / twist / fractal
    morph.gpgpuMorphDisperseAmount, morph.gpgpuMorphDisperseDirection,
    morph.gpgpuMorphTwistAmount, morph.gpgpuMorphTwistAxis,
    morph.gpgpuMorphFractalAmount, morph.gpgpuMorphFractalFrequency,
    morph.gpgpuMorphFractalEvolution,
    null, null, morph.gpgpuMorphObjSampleMode,
    morph.layer2TextMapText, morph.layer2TextMapFontFamily,
    morph.layer2TextMapWeight, morph.layer2TextMapSize,
    morph.layer2TextMapPadding, 0,
    morph.layer2MediaMapWidth, morph.layer2MediaMapHeight, 0,
    // Phase AW, appended at the end
    morph.gpgpuMorphPolygonSides,
    morph.layer1LineJitterPaths ? morph.layer1LineJitter : 0,
  ];
  check('signature morph field count matches current implementation',
    fields.length === expectedFields.length,
    `got ${fields.length}, expected ${expectedFields.length}`);
  let fieldsOk = fields.length === expectedFields.length;
  if (fieldsOk) {
    for (let i = 0; i < expectedFields.length; i++) {
      if (expectedFields[i] === null) continue;
      if (fields[i] !== String(expectedFields[i] ?? '')) { fieldsOk = false; break; }
    }
  }
  check('signature morph fields match current order/values (AA+AM+AW included)', fieldsOk);

  const aged = { ...morph, gpgpuAgeEnabled: true, gpgpuMorphReplicaAgeStep: 0.3 };
  check('signature gains the age block only when live',
    cpuShapeSignature(aged) === `${sig}|age:${aged.gpgpuAgeMax},${aged.gpgpuMorphReplicaAgeStep}`,
    cpuShapeSignature(aged).slice(-30));
  check('signature has no age block when age is off', !sig.includes('|age:'));
}

console.log(`\nphase23 cpu fallback tests: ${passes} passed, ${failures} failed`);
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
