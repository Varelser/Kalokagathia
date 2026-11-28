#!/usr/bin/env node
// layer1-wp4-emitter-list-velocity.test.mjs — Layer 1 WP4
// phase D3: the emitter list wired into the velocity pass's
// activation handover.
//
// Phase D1 shipped the list grammar / resolution / pack,
// phase D2 the position-pass respawn. Phase D3 closes the
// D2 separation note ("while a list stands, the runtime
// activation still follows the single-emitter keys"): while
// an authored emitter list stands, the velocity pass's
// activation segment takes its LIST form —
//
//  - buildVelocityFragment gains the emitterList option:
//    the preamble splices the shared column chunk (unless
//    the merged supply stands) + the list uniform pair
//    (uEmittersBase / uEmitterCount) and gives the
//    spawn-order texture unit back like B1/B2; the helpers
//    splice the column fetch (merged form under the merged
//    supply) + the list function set (assignment hash, the
//    parameterised directed law, the band walk over the
//    packed records); the main forces splice the list form
//    of the activation segment (same thresholds, the
//    handover reads the particle's own emitter record, a
//    'cube' element hands nothing over).
//  - While the list stands it REPLACES the single-emitter
//    form (the D2 replacement discipline): the single
//    uniforms / function / handover are not spliced even
//    when the emitterVelocity option is also set.
//  - The assets resolve the variant in velocityVariantOptions
//    (+ the variant key + the custom-force effect deps),
//    pre-declare the uniform pair on the velocity material,
//    and the passes supply both from getColumnSupply,
//    before the stage-6 liquid block (sha256-pinned
//    untouched).
//
// Pins:
// (a) default byte-identity against the phase18 record;
//     the list names appear in no default string; the
//     single-emitter variant keeps its shipped form.
// (b) variant strings: uniforms declared once, give-back
//     applied, single law absent, list functions present
//     (hash sync line pinned), helpers before main(), the
//     segment before the event block, allocator / demand
//     threshold composition, merged-supply composition.
// (c) grid match: the GLSL form evaluated in JS (the fetch
//     reads the PACKED column data; the law is
//     directedInitialVelocity over the record's values)
//     equals the lib route (emitterIndexForIndex +
//     ResolvedEmitter.velocity + directedInitialVelocity)
//     on every texel of a 16x16 pool over a 3-element list
//     (directed / cube / directed, distinct dir, speed and
//     spread per element).
// (d) activation semantics: the list segment's threshold
//     lines are the single form's verbatim; the burst guard
//     and the event block's precedence are unchanged.
// (e) wiring: assets + passes source pins; the stage-6
//     liquid block sha256 pin. (第45期統合: 液体は杉判断
//     (c)で除外のため、液体ブロックのピンは不在の確認に
//     反転している。)
//
// Run: node scripts/layer1-wp4-emitter-list-velocity.test.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp4d3-bundle-${process.pid}.mjs`);

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const count = (s, needle) => s.split(needle).length - 1;
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { getColumnSupply } from './lib/gpgpuPathAssets.ts';
      export { resolveEmitterList, emitterListActive, emitterHashForUv, emitterIndexForIndex, packEmitterColumnData, EMITTER_COLUMN_LAYOUT } from './lib/gpgpuEmitterList.ts';
      export { directedInitialVelocity } from './lib/gpgpuLifecycle.ts';
      export { dmHash11 } from './lib/gpgpuRandom.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const cfg = (over) => ({ ...M.DEFAULT_CONFIG, ...over });

// ── (a) default byte-identity ────────────────────────────
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  check('a SIM_VEL_FRAG matches the phase18 pin (length + sha256)',
    M.SIM_VEL_FRAG.length === baseline.parts.SIM_VEL_FRAG.length
    && sha256(M.SIM_VEL_FRAG) === baseline.parts.SIM_VEL_FRAG.sha256);
  check('a buildVelocityFragment with no / false list option is the shipped string',
    M.buildVelocityFragment('') === M.SIM_VEL_FRAG
    && M.buildVelocityFragment('', undefined, { emitterList: false }) === M.SIM_VEL_FRAG);
  check('a no list name in the default string',
    !M.SIM_VEL_FRAG.includes('kaloEmitterVelocityList') && !M.SIM_VEL_FRAG.includes('uEmittersBase')
    && !M.SIM_VEL_FRAG.includes('uEmitterCount') && !M.SIM_VEL_FRAG.includes('kaloEmitterDirectedVelocity'));
  const single = M.buildVelocityFragment('', undefined, { emitterVelocity: true });
  check('a single-emitter variant keeps its shipped form (uniforms + function + handover, no list names)',
    single.includes('uniform vec3  uEmitterVelDir;')
    && single.includes('vec3 kaloEmitterVelocity(vec2 uv) {')
    && count(single, 'vel = kaloEmitterVelocity(vUv);') === 1
    && !single.includes('kaloEmitterVelocityList') && !single.includes('uEmittersBase'));
}

// ── (b) variant strings ──────────────────────────────────
{
  const frag = M.buildVelocityFragment('', undefined, { emitterList: true });
  check('b list variant differs from the shipped string', frag !== M.SIM_VEL_FRAG);
  check('b list uniforms declared exactly once',
    count(frag, 'uniform float uEmittersBase;') === 1 && count(frag, 'uniform int   uEmitterCount;') === 1);
  check('b column uniforms declared exactly once',
    count(frag, 'uniform sampler2D uColTex;') === 1
    && count(frag, 'uniform float uColWidth;') === 1
    && count(frag, 'uniform float uColHeight;') === 1);
  check('b spawn-order give-back applied (sampler returned, normaliser declared)',
    !frag.includes('uniform sampler2D uSpawnOrderTex;')
    && count(frag, 'uniform float uSpawnOrderMaxDist;') === 1
    && frag.includes('float v = clamp(length(texture2D(uInitPosTex, uv).xyz) / max(uSpawnOrderMaxDist, 1.0e-6), 0.0, 1.0);'));
  check('b single-emitter law absent (uniforms, function, handover)',
    !frag.includes('uEmitterVelDir') && !frag.includes('vec3 kaloEmitterVelocity(vec2 uv) {')
    && !frag.includes('vel = kaloEmitterVelocity(vUv);'));
  check('b assignment hash is the lib twin composition (offset sync)',
    frag.includes('return dmHash11(dot(uv + vec2(17.17, 9.43), vec2(127.1, 311.7)));'));
  check('b list functions present (hash / parameterised law / walk)',
    frag.includes('float emitterAssignHash(vec2 uv) {')
    && frag.includes('vec3 kaloEmitterDirectedVelocity(vec3 baseDir, float speed, float spread, vec2 uv) {')
    && frag.includes('vec4 kaloEmitterVelocityList(vec2 uv) {')
    && frag.includes('if (kaloColFetch(uEmittersBase + float(emK * 7)).w > emHash) break;'));
  check('b record reads present (T2.w mode gate / T4 dir+speed / T5.x spread)',
    frag.includes('if (kaloColFetch(emRec + 2.0).w < 0.5) return vec4(0.0);')
    && frag.includes('vec4 emT4 = kaloColFetch(emRec + 4.0);')
    && frag.includes('vec4 emT5 = kaloColFetch(emRec + 5.0);')
    && frag.includes('return vec4(kaloEmitterDirectedVelocity(emT4.xyz, emT4.w, emT5.x, uv), 1.0);'));
  check('b column fetch spliced exactly once, before the list function',
    count(frag, 'vec4 kaloColFetch(float idx) {') === 1
    && frag.indexOf('vec4 kaloColFetch(float idx) {') < frag.indexOf('vec4 kaloEmitterVelocityList(vec2 uv) {'));
  check('b helpers land before main()',
    frag.indexOf('vec4 kaloEmitterVelocityList(vec2 uv) {') > -1
    && frag.indexOf('vec4 kaloEmitterVelocityList(vec2 uv) {') < frag.indexOf('void main() {'));
  check('b activation segment hands over through the list, before the event block',
    frag.includes('vec4 emVel = kaloEmitterVelocityList(vUv);')
    && frag.includes('if (emVel.w > 0.5) vel = emVel.xyz;')
    && frag.indexOf('vec4 emVel = kaloEmitterVelocityList(vUv);') < frag.indexOf('// Spawn burst event (Phase AX): on the single frame the'));

  const both = M.buildVelocityFragment('', undefined, { emitterVelocity: true, emitterList: true });
  check('b list replaces single when both options stand (identical string)',
    both === frag);

  const alloc = M.buildVelocityFragment('', undefined, { emitterList: true, spawnAlloc: true });
  check('b allocator composition: list handover over the allocator thresholds',
    alloc.includes('float eThr = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockTime));')
    && alloc.includes('float eThrPrev = min(1.0, uSpawnBurst + uSpawnRateEff * spawnPulseTimeEx(uSpawnClockPrev));')
    && alloc.includes('vec4 emVel = kaloEmitterVelocityList(vUv);'));

  const demand = M.buildVelocityFragment('', undefined, { emitterList: true, spawnEventDemand: true });
  check('b demand composition: list handover over the demand thresholds',
    demand.includes('float eThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime) + uSpawnEventDueFrac);')
    && demand.includes('float eThrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta) + uSpawnEventDuePrevFrac);')
    && demand.includes('vec4 emVel = kaloEmitterVelocityList(vUv);'));

  const merged = M.buildVelocityFragment('', undefined, { emitterList: true, particleRulesLive: true, mergedSupply: true });
  check('b merged composition: merged fetch, no column sampler, list uniforms still once',
    merged.includes('return texture2D(uMergedTex,')
    && !merged.includes('uniform sampler2D uColTex;')
    && count(merged, 'uniform sampler2D uMergedTex;') === 1
    && count(merged, 'uniform float uEmittersBase;') === 1
    && merged.includes('vec4 kaloEmitterVelocityList(vec2 uv) {'));
}

// ── (c) grid match: GLSL form vs lib route ───────────────
{
  const listCfg = cfg({
    gpgpuEmitters: JSON.stringify([
      { shape: 'sphere', velMode: 'directed', velDir: [1, 0, 0], velSpeed: 3, velSpread: 0.25, weight: 1 },
      { shape: 'disc', velMode: 'cube', weight: 1 },
      { shape: 'box', velMode: 'directed', velDir: [1, 2, 3], velSpeed: 12, velSpread: 0.9, weight: 2 },
    ]),
  });
  const res = M.resolveEmitterList(listCfg);
  check('c fixture resolves to 3 authored elements with bands 0.25 / 0.5 / 1',
    res.listAuthored && res.emitters.length === 3
    && res.emitters[0].cumWeightEnd === 0.25 && res.emitters[1].cumWeightEnd === 0.5
    && res.emitters[2].cumWeightEnd === 1);
  check('c fixture velocity specs: directed / cube(null) / directed with distinct values',
    res.emitters[0].velocity !== null && res.emitters[1].velocity === null && res.emitters[2].velocity !== null
    && res.emitters[0].velocity.speed === 3 && res.emitters[2].velocity.speed === 12
    && res.emitters[0].velocity.spread === 0.25 && res.emitters[2].velocity.spread === 0.9);
  const layout = M.EMITTER_COLUMN_LAYOUT;
  const data = new Float32Array(layout.width * layout.height * 4);
  const pack = M.packEmitterColumnData(data, layout, res);
  check('c pack stands at 1280 with 3 elements', pack.emittersBase === 1280 && pack.emitterCount === 3);
  const fetchRec = (idx) => {
    const cx = idx % layout.width;
    const cy = Math.floor(idx / layout.width);
    const o = (cy * layout.width + cx) * 4;
    return [data[o], data[o + 1], data[o + 2], data[o + 3]];
  };
  // The GLSL form, transcribed: assignment walk over the
  // packed records, the mode gate, the parameterised law.
  const glslListVel = (u, v) => {
    const emHash = M.dmHash11((u + 17.17) * 127.1 + (v + 9.43) * 311.7);
    let emIdx = 0;
    for (let emK = 0; emK < 8; emK++) {
      if (emK >= pack.emitterCount) break;
      emIdx = emK;
      if (fetchRec(pack.emittersBase + emK * 7)[3] > emHash) break;
    }
    const rec = pack.emittersBase + emIdx * 7;
    if (fetchRec(rec + 2)[3] < 0.5) return null;
    const T4 = fetchRec(rec + 4);
    const T5 = fetchRec(rec + 5);
    return M.directedInitialVelocity({ x: T4[0], y: T4[1], z: T4[2] }, u, v, T4[3], T5[0]);
  };
  // The lib route: the assignment + the resolved element's
  // velocity spec through the same law.
  const libListVel = (index, texSize) => {
    const el = res.emitters[M.emitterIndexForIndex(res.emitters, index, texSize)];
    if (!el.velocity) return null;
    const u = ((index % texSize) + 0.5) / texSize;
    const v = (Math.floor(index / texSize) + 0.5) / texSize;
    return M.directedInitialVelocity(el.velocity.dir, u, v, el.velocity.speed, el.velocity.spread);
  };
  const texSize = 16;
  let hashAll = true;
  let velAll = true;
  let flagAll = true;
  const seen = [0, 0, 0];
  const speeds = [[], [], []];
  for (let i = 0; i < texSize * texSize; i++) {
    const u = ((i % texSize) + 0.5) / texSize;
    const v = (Math.floor(i / texSize) + 0.5) / texSize;
    if (M.dmHash11((u + 17.17) * 127.1 + (v + 9.43) * 311.7) !== M.emitterHashForUv(u, v)) hashAll = false;
    const g = glslListVel(u, v);
    const l = libListVel(i, texSize);
    if ((g === null) !== (l === null)) flagAll = false;
    if (g && l && (!near(g.x, l.x) || !near(g.y, l.y) || !near(g.z, l.z))) velAll = false;
    const idx = M.emitterIndexForIndex(res.emitters, i, texSize);
    seen[idx] += 1;
    if (l) speeds[idx].push(Math.hypot(l.x, l.y, l.z));
  }
  check('c assignment hash composition equals emitterHashForUv on the grid', hashAll);
  check('c directed flag (cube hands nothing over) agrees on every texel', flagAll);
  check('c GLSL form equals the lib route on every texel (16x16)', velAll);
  check('c every element receives births', seen[0] > 0 && seen[1] > 0 && seen[2] > 0);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  check('c per-element laws actually differ (element 2 mean speed well above element 0)',
    speeds[0].length > 0 && speeds[2].length > 0 && mean(speeds[2]) > mean(speeds[0]) + 3);
}

// ── (d) activation semantics ─────────────────────────────
{
  const frag = M.buildVelocityFragment('', undefined, { emitterList: true });
  check('d threshold lines are the single form verbatim',
    frag.includes('float eGate = spawnGateValue(vUv);')
    && frag.includes('float eThr = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime));')
    && frag.includes('float eThrPrev = min(1.0, uSpawnBurst + uSpawnRate * spawnPulseTimeEx(uSpawnTime - uDelta));')
    && frag.includes('if (eGate >= eThrPrev && eGate < eThr) {'));
  check('d burst guard stands over the segment',
    frag.includes('if (uSpawnBurst < 1.0) {\n      float eGate = spawnGateValue(vUv);'));
  const single = M.buildVelocityFragment('', undefined, { emitterVelocity: true });
  const segOf = (s) => s.slice(s.indexOf('if (uSpawnBurst < 1.0) {'), s.indexOf('// Spawn burst event (Phase AX): on the single frame the'));
  // The segments' code lines (comments stripped), with each
  // form's handover normalised to one token: the sequences
  // must be identical — the list form changes nothing but
  // the handover.
  const segCode = (s) => segOf(s).split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => (l === 'vec4 emVel = kaloEmitterVelocityList(vUv);' || l === 'vel = kaloEmitterVelocity(vUv);' ? 'HANDOVER' : l))
    .filter((l) => l !== 'if (emVel.w > 0.5) vel = emVel.xyz;');
  check('d list segment code equals the single segment code outside the handover',
    JSON.stringify(segCode(frag)) === JSON.stringify(segCode(single))
    && segOf(single).includes('vel = kaloEmitterVelocity(vUv);')
    && !segOf(single).includes('kaloEmitterVelocityList'));
}

// ── (e) wiring ───────────────────────────────────────────
{
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('e assets: velocity options resolve the list variant',
    assets.includes('emitterList: emitterListActive(config),'));
  check('e assets: variant key carries the list flag',
    assets.includes('${opts.mergedSupply ? 1 : 0}${opts.emitterList ? 1 : 0}'));
  check('e assets: custom-force effect depends on the list key',
    assets.includes('config.gpgpuEmitterVelMode, config.gpgpuEmitters, config.gpgpuFieldInstances,'));
  check('e assets: velocity material pre-declares the uniform pair (2 entries incl. position)',
    count(assets, 'uEmittersBase:') === 2 && count(assets, 'uEmitterCount:') === 2);
  check('e passes: both uniforms supplied from the column supply (velocity block)',
    passes.includes('if (fu.uEmittersBase) fu.uEmittersBase.value = fieldSupply ? fieldSupply.emittersBase : 0;')
    && passes.includes('if (fu.uEmitterCount) fu.uEmitterCount.value = fieldSupply ? fieldSupply.emitterCount : 0;'));
  // 第45期統合: 液体は杉判断(c)で除外 — the stage-6 liquid
  // block is not part of this tree. The position/sha256 checks
  // against it are replaced by an absence pin; the supply
  // additions themselves stand (checked above and below).
  const liquidStart = passes.lastIndexOf(' // Liquid solver (Limit plan stage 6, L1-2)');
  check('e passes: the supply additions are present (fu.uEmittersBase supply stands)',
    passes.indexOf('fu.uEmittersBase') > -1);
  check('e passes: no stage-6 liquid block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    liquidStart === -1);
}

console.log(`layer1-wp4-emitter-list-velocity: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
