#!/usr/bin/env node
// layer1-wp9-local-time.test.mjs — Layer 1 WP9 phase D:
// local time per group — the grammar + resolution in
// lib/gpgpuLocalTime.ts, the position-pass variant (the age
// advances on the local clock) and the velocity-pass
// variant (the Phase AC capture boundary scales the
// built-in force delta by the particle's factor).
//
// Until this phase the simulation had one global clock
// (timeScale); tyFlow §4-21 Speed / §4-23 Slow had no local
// form. The phase adds ONE key (gpgpuLocalTimeGroups, a
// JSON list of {group, factor} over the gpgpuGroupsData
// library), resolves each entry's gate in the
// resolveGroupGate form (predicate groups compile down to
// a shader-evaluated predicate; a baked group reads
// attribute slot 3 and is resident only while it is the
// gpgpuGroupRef group), and supplies the table as uniforms
// — no sampler is spent in either pass.
//
// Pins:
// (a) default byte identity: both fragments built with no
//     options are the shipped strings and carry no trace
//     of the local-time surface.
// (b) variant strings: the position variant declares the
//     entry-table uniforms, splices the factor helper
//     before main() and the factor declaration before the
//     first age advance, and scales both advance lines;
//     the velocity variant declares the uniforms, appends
//     the factor function and splices the scaling block
//     immediately before the Phase AC force block (also
//     alongside the live-rules / age-free-force forms).
// (c) sampler budget: neither variant spends a sampler —
//     the sampler declaration counts equal the stock ones.
// (d) GLSL ⇄ TS numeric agreement: a JS transcription of
//     the GLSL factor loop over the packed table equals
//     localTimeFactor over a grid of attribute values and
//     entry sets; the full-config path (group library →
//     resolution → per-particle factor) agrees with
//     evaluateGpgpuGroup membership, the baked entry
//     included (via a simulated slot-3 bake).
// (e) supply resolution: tolerant parse (malformed
//     dropped, factor clamped, table capped), the drop
//     reasons (group-not-found / identity-factor /
//     baked-not-resident), the residency rules (the ref
//     group resident; particle rules owning slot 3 makes
//     every baked entry non-resident), first-match order
//     and the variant predicate.
// (f) application twins: the age advance (delta × factor)
//     and the velocity capture formula
//     (localTimeScaleForceDelta) — factor exactly 1
//     reconstructs the inputs component-for-component, and
//     the post-capture remainder is never scaled.
// (g) wiring pins: the assets resolve both variants from
//     localTimeVariantActive and carry the uniform entries;
//     the passes fill both materials' tables and counts
//     (the position count held at 0 under
//     args.suppressGroupKill).
// (h) untouched pins: the stage-6 liquid block of the
//     passes and the MainSphGrains shader file keep their
//     sha256. (第45期統合: 液体は杉判断(c)で除外のため、
//     液体ブロックのピンは不在の確認に反転し、MainSphGrains
//     のピンは製品系譜の値に付け替えた。)
//
// Run: node scripts/layer1-wp9-local-time.test.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond, extra) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}${extra !== undefined ? ` — ${extra}` : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

async function load(rel, names) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
  const picked = {};
  for (const n of names) picked[n] = mod[n];
  return picked;
}

const lt = await load('lib/gpgpuLocalTime.ts', [
  'parseLocalTimeEntries', 'serializeLocalTimeEntries', 'resolveLocalTime',
  'localTimeVariantActive', 'packLocalTimeEntries', 'localTimeFactor',
  'localTimeFactorForParticle', 'localTimeScaleForceDelta',
  'localTimeUniformsGlsl', 'localTimeFactorGlsl',
  'LOCAL_TIME_MAX_ENTRIES', 'LOCAL_TIME_UNIFORM_VEC4S',
]);
const groups = await load('lib/gpgpuGroups.ts', [
  'parseGpgpuGroups', 'evaluateGpgpuGroup', 'encodeSnapshotIndices',
]);
const position = await load('components/gpgpuShaderSimulationPosition.ts', ['buildPositionFragment', 'SIM_POS_FRAG']);
const velocity = await load('components/gpgpuShaderSimulationVelocity.ts', ['buildVelocityFragment', 'SIM_VEL_FRAG']);

const samplerCount = (s) => (s.match(/uniform sampler2D/g) || []).length;

// A small group library: two predicate groups over slot 0,
// one inverted band over slot 1, one snapshot group.
const LIBRARY = JSON.stringify([
  { id: 'slowband', name: 'Slow band', source: { kind: 'predicate', predicate: { slot: 0, mode: 'band', low: 0.2, high: 0.6, invert: false } } },
  { id: 'fastlow', name: 'Fast low', source: { kind: 'predicate', predicate: { slot: 0, mode: 'below', low: 0, high: 0.3, invert: false } } },
  { id: 'invband', name: 'Inverted band', source: { kind: 'predicate', predicate: { slot: 1, mode: 'band', low: 0.4, high: 0.8, invert: true } } },
  { id: 'frozen', name: 'Frozen few', source: { kind: 'snapshot', indicesB64: groups.encodeSnapshotIndices(Uint32Array.from([1, 3])) } },
]);
const baseConfig = (over) => ({
  gpgpuLocalTimeGroups: '', gpgpuGroupsData: LIBRARY, gpgpuGroupRef: '', gpgpuParticleRules: '',
  ...over,
});

// ── (a) default byte identity ─────────────────────────────
{
  check('a position: no-options build is the shipped string',
    position.buildPositionFragment() === position.SIM_POS_FRAG);
  check('a position: explicit-off keeps the shipped string',
    position.buildPositionFragment({ localTime: false }) === position.SIM_POS_FRAG);
  check('a position: default carries no local-time surface',
    !position.SIM_POS_FRAG.includes('LocalTime') && !position.SIM_POS_FRAG.includes('localTimeFactor'));
  check('a velocity: no-options build is the shipped string',
    velocity.buildVelocityFragment('', undefined, {}) === velocity.SIM_VEL_FRAG
    && velocity.buildVelocityFragment('') === velocity.SIM_VEL_FRAG);
  check('a velocity: explicit-off keeps the shipped string',
    velocity.buildVelocityFragment('', undefined, { localTime: false }) === velocity.SIM_VEL_FRAG);
  check('a velocity: default carries no local-time surface',
    !velocity.SIM_VEL_FRAG.includes('LocalTime') && !velocity.SIM_VEL_FRAG.includes('uLocalTimeCount'));
}

// ── (b) variant strings ───────────────────────────────────
{
  const frag = position.buildPositionFragment({ localTime: true });
  check('b position variant declares the entry-table uniforms',
    frag.includes(`uniform vec4 uLocalTimeEntries[${lt.LOCAL_TIME_UNIFORM_VEC4S}];`)
    && frag.includes('uniform int uLocalTimeCount;'));
  check('b position variant splices the factor helper before main()',
    frag.indexOf('float kaloLocalTimeFactor(vec4 attrData)') > -1
    && frag.indexOf('float kaloLocalTimeFactor(vec4 attrData)') < frag.indexOf('void main()'));
  check('b position variant declares the factor before the first age advance',
    frag.indexOf('float localTimeFactor = kaloLocalTimeFactor(texture2D(uAttrTex, vUv));') > -1
    && frag.indexOf('float localTimeFactor = kaloLocalTimeFactor(texture2D(uAttrTex, vUv));') < frag.indexOf('age += uCollisionLifeLoss * uDelta * localTimeFactor;'));
  check('b position variant scales both age advances and keeps no stock advance line',
    frag.includes('age += uDelta * localTimeFactor;')
    && frag.includes('age += uCollisionLifeLoss * uDelta * localTimeFactor;')
    && !frag.includes('      age += uDelta;\n')
    && !frag.includes('age += uCollisionLifeLoss * uDelta;'));
  check('b position variant composes with the age-jitter variant',
    position.buildPositionFragment({ localTime: true, ageJitter: true })
      .includes('if (age > uAgeMax * lifetimeMultiplier(vUv, uAgeMaxJitter)) ageRespawn = true;')
    && position.buildPositionFragment({ localTime: true, ageJitter: true })
      .includes('age += uDelta * localTimeFactor;'));

  const vel = velocity.buildVelocityFragment('', undefined, { localTime: true });
  check('b velocity variant declares the entry-table uniforms',
    vel.includes(`uniform vec4 uLocalTimeEntries[${lt.LOCAL_TIME_UNIFORM_VEC4S}];`)
    && vel.includes('uniform int uLocalTimeCount;'));
  check('b velocity variant carries the factor function before main()',
    vel.indexOf('float kaloLocalTimeFactor(vec4 attrData)') > -1
    && vel.indexOf('float kaloLocalTimeFactor(vec4 attrData)') < vel.indexOf('void main()'));
  check('b velocity variant splices the scaling block immediately before the Phase AC force block',
    vel.indexOf('if (uLocalTimeCount > 0) {') > -1
    && vel.indexOf('if (uLocalTimeCount > 0) {') < vel.indexOf('// Force over Lifetime (Phase AC): scale only the built-in')
    && vel.includes('vel = velForceBase + ltDelta * ltFactor + (vel - velAfterForces);')
    && vel.includes('velAfterForces = velForceBase + ltDelta * ltFactor;'));
  const combo = velocity.buildVelocityFragment('', undefined, { localTime: true, particleRulesLive: true, ageFreeForce: true });
  check('b velocity variant composes with live rules and the age-free force form',
    combo.includes('if (uLocalTimeCount > 0) {')
    && combo.includes('kaloEvalAgeFreeForce(ageNorm)')
    && combo.includes('vel *= (1.0 - 1.1 * grpDrag * uDelta);'));
}

// ── (c) sampler budget ────────────────────────────────────
{
  check('c position variant spends no sampler',
    samplerCount(position.buildPositionFragment({ localTime: true })) === samplerCount(position.SIM_POS_FRAG),
    `${samplerCount(position.buildPositionFragment({ localTime: true }))} vs ${samplerCount(position.SIM_POS_FRAG)}`);
  check('c velocity variant spends no sampler',
    samplerCount(velocity.buildVelocityFragment('', undefined, { localTime: true })) === samplerCount(velocity.SIM_VEL_FRAG),
    `${samplerCount(velocity.buildVelocityFragment('', undefined, { localTime: true }))} vs ${samplerCount(velocity.SIM_VEL_FRAG)}`);
}

// ── (d) GLSL ⇄ TS numeric agreement ──────────────────────
// JS transcription of the GLSL factor loop over the packed
// table (groupMembership composed from step() calls, the
// same inclusive boundaries as lib/gpgpuAttributes).
function glslMembership(av, mode, low, high, invert) {
  let m;
  if (mode === 0) m = av <= high ? 1 : 0;
  else if (mode === 1) m = av >= low ? 1 : 0;
  else m = av >= low && av <= high ? 1 : 0;
  return invert ? 1 - m : m;
}
function glslFactor(packed, count, rgba) {
  for (let i = 0; i < lt.LOCAL_TIME_MAX_ENTRIES; i++) {
    if (i >= count) break;
    const a = packed.slice(i * 8, i * 8 + 4);
    const b = packed.slice(i * 8 + 4, i * 8 + 8);
    const member = glslMembership(rgba[Math.round(a[0])], Math.round(a[1]), a[2], a[3], b[0] > 0.5);
    if (member > 0.5) return b[1];
  }
  return 1;
}
{
  const res = lt.resolveLocalTime(baseConfig({
    gpgpuLocalTimeGroups: '[{"group":"slowband","factor":0.25},{"group":"fastlow","factor":2.5},{"group":"invband","factor":0}]',
  }));
  check('d resolution stands with three predicate entries', res.active && res.entries.length === 3);
  const packed = lt.packLocalTimeEntries(res.entries);
  check('d pack layout: A = (slot, modeId, low, high), B = (invert, factor, baked, 0)',
    packed.length === lt.LOCAL_TIME_UNIFORM_VEC4S * 4
    && packed.slice(0, 8).join(',') === '0,2,0.2,0.6,0,0.25,0,0'
    && packed.slice(16, 24).join(',') === '1,2,0.4,0.8,1,0,0,0',
    packed.slice(0, 24).join(','));
  let ok = true;
  for (let s0 = 0; s0 <= 20 && ok; s0++) {
    for (let s1 = 0; s1 <= 20 && ok; s1++) {
      const rgba = [s0 / 20, s1 / 20, 0.7, 0.1];
      const expected = lt.localTimeFactor(res.entries, (slot) => rgba[slot]);
      const got = glslFactor(packed, res.entries.length, rgba);
      if (!near(got, expected, 1e-9)) ok = false;
    }
  }
  check('d GLSL transcription over the packed table equals localTimeFactor on a 21×21 grid', ok);
  check('d first match wins: slot0 0.25 is in slowband (0.25) before fastlow (2.5)',
    near(lt.localTimeFactor(res.entries, (s) => [0.25, 0.9, 0, 0][s]), 0.25));
  check('d no match keeps exactly 1',
    lt.localTimeFactor(res.entries, (s) => [0.9, 0.6, 0, 0][s]) === 1);
  check('d factor 0 freezes a matched group',
    lt.localTimeFactor(res.entries, (s) => [0.9, 0.1, 0, 0][s]) === 0);

  // Full-config path: per-particle factors from the
  // resolution equal the factors derived from
  // evaluateGpgpuGroup membership, baked entry included.
  const count = 8;
  const attr = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    attr[i * 4] = i / (count - 1); // slot 0 sweeps 0..1
    attr[i * 4 + 1] = 0.9;
    attr[i * 4 + 2] = 0;
    attr[i * 4 + 3] = 0;
  }
  const defs = groups.parseGpgpuGroups(LIBRARY);
  const snapMembership = groups.evaluateGpgpuGroup(defs, 'frozen', attr, count);
  const bakedAttr = new Float32Array(attr);
  for (let i = 0; i < count; i++) bakedAttr[i * 4 + 3] = snapMembership[i];
  const res2 = lt.resolveLocalTime(baseConfig({
    gpgpuLocalTimeGroups: '[{"group":"frozen","factor":3},{"group":"slowband","factor":0.5}]',
    gpgpuGroupRef: 'frozen',
  }));
  check('d baked entry resolves resident while the ref names it',
    res2.entries.length === 2 && res2.entries[0].baked === true && res2.entries[0].slot === 3);
  let okFull = true;
  for (let i = 0; i < count; i++) {
    const expected = snapMembership[i] === 1
      ? 3
      : lt.localTimeFactor(res2.entries.slice(1), (s) => bakedAttr[i * 4 + s]);
    const got = lt.localTimeFactorForParticle(res2.entries, bakedAttr, i);
    if (!near(got, expected, 1e-9)) okFull = false;
  }
  check('d per-particle factors agree with evaluateGpgpuGroup membership (baked + predicate)', okFull);
}

// ── (e) supply resolution ─────────────────────────────────
{
  check('e empty key resolves inactive with no drops',
    (() => { const r = lt.resolveLocalTime(baseConfig({})); return !r.active && r.entries.length === 0 && r.dropped.length === 0; })());
  check('e tolerant parse: malformed entries dropped, factor clamped, list capped',
    (() => {
      const parsed = lt.parseLocalTimeEntries('[{"group":"a","factor":99},{"group":7,"factor":1},{"factor":2},{"group":"b","factor":-3},{"group":"c","factor":1.5},{"group":"d","factor":0.5},{"group":"e","factor":0.5},{"group":"f","factor":0.5}]');
      return parsed.length === lt.LOCAL_TIME_MAX_ENTRIES
        && parsed[0].factor === 4 && parsed[1].group === 'b' && parsed[1].factor === 0;
    })());
  check('e parse of non-JSON / non-array is empty',
    lt.parseLocalTimeEntries('nope').length === 0 && lt.parseLocalTimeEntries('{"x":1}').length === 0);
  check('e serialize round-trips and empties to the empty string',
    lt.serializeLocalTimeEntries([]) === ''
    && lt.serializeLocalTimeEntries([{ group: 'slowband', factor: 0.25 }]) === '[{"group":"slowband","factor":0.25}]');
  check('e dangling group drops with group-not-found',
    (() => {
      const r = lt.resolveLocalTime(baseConfig({ gpgpuLocalTimeGroups: '[{"group":"ghost","factor":2}]' }));
      return !r.active && r.dropped.length === 1 && r.dropped[0].reason === 'group-not-found';
    })());
  check('e identity factor drops and never shields later entries',
    (() => {
      const r = lt.resolveLocalTime(baseConfig({
        gpgpuLocalTimeGroups: '[{"group":"slowband","factor":1},{"group":"fastlow","factor":2}]',
      }));
      return r.active && r.entries.length === 1 && r.entries[0].groupId === 'fastlow'
        && r.dropped.length === 1 && r.dropped[0].reason === 'identity-factor';
    })());
  check('e baked entry without the ref drops as baked-not-resident',
    (() => {
      const r = lt.resolveLocalTime(baseConfig({ gpgpuLocalTimeGroups: '[{"group":"frozen","factor":2}]' }));
      return !r.active && r.dropped.length === 1 && r.dropped[0].reason === 'baked-not-resident';
    })());
  check('e particle rules owning slot 3 make the baked entry non-resident',
    (() => {
      const r = lt.resolveLocalTime(baseConfig({
        gpgpuLocalTimeGroups: '[{"group":"frozen","factor":2}]',
        gpgpuGroupRef: 'frozen',
        gpgpuParticleRules: '[{"id":"r1","enabled":true,"target":{"type":"all"},"condition":"","action":{"type":"kill"}}]',
      }));
      return !r.active && r.dropped[0].reason === 'baked-not-resident';
    })());
  check('e variant predicate follows the resolution',
    lt.localTimeVariantActive(baseConfig({ gpgpuLocalTimeGroups: '[{"group":"fastlow","factor":2}]' })) === true
    && lt.localTimeVariantActive(baseConfig({})) === false);
  check('e GLSL chunks carry the table size from the lib constants',
    lt.localTimeUniformsGlsl().includes(`uniform vec4 uLocalTimeEntries[${lt.LOCAL_TIME_UNIFORM_VEC4S}];`)
    && lt.localTimeFactorGlsl().includes(`i < ${lt.LOCAL_TIME_MAX_ENTRIES}`));
}

// ── (f) application twins ─────────────────────────────────
{
  const base = [1, -2, 0.5];
  const after = [4, 2, -1.5];
  const vel = [10, 3, 2];
  check('f factor exactly 1 reconstructs vel component-for-component',
    JSON.stringify(lt.localTimeScaleForceDelta(base, after, vel, 1)) === JSON.stringify(vel));
  check('f factor 0 keeps the base plus the post-capture remainder',
    JSON.stringify(lt.localTimeScaleForceDelta(base, after, vel, 0)) === JSON.stringify([7, -1, 4]));
  check('f factor scales only the captured delta',
    JSON.stringify(lt.localTimeScaleForceDelta(base, after, vel, 0.5)) === JSON.stringify([8.5, 1, 3]));
  check('f age advance twin: delta × factor (0 freezes, 1 is the legacy advance)',
    0.016 * lt.localTimeFactor([], () => 0) === 0.016
    && 0.016 * 0 === 0);
}

// ── (g) wiring pins ───────────────────────────────────────
{
  const assets = read('components/useGpgpuSimulationAssets.ts');
  check('g assets resolve both variants from localTimeVariantActive',
    assets.includes('localTime: localTimeVariantActive(config)')
    && assets.includes('localTime: localTimeVariantActive(config),'));
  check('g assets carry the uniform entries on both materials',
    (assets.match(/uLocalTimeEntries:\s*\{ value: Array\.from\(\{ length: LOCAL_TIME_UNIFORM_VEC4S \}/g) || []).length === 2
    && (assets.match(/uLocalTimeCount:/g) || []).length >= 2);
  check('g variant keys carry the local-time bit on both materials',
    assets.includes(':${localTimeVariantActive(c)}:') && assets.includes('${opts.localTime ? 1 : 0}'));
  const passes = read('components/gpgpuSimulationPasses.ts');
  check('g passes fill the velocity table and hold its count at 0 without the attribute texture',
    passes.includes('velSimMat.uniforms.uLocalTimeEntries')
    && passes.includes('velSimMat.uniforms.uLocalTimeCount.value = attrTex ? localTime.entries.length : 0')
    && passes.includes('|| localTime.active);'));
  check('g passes fill the position table and suppress its count in replica stacks',
    passes.includes('posSimMat.uniforms.uLocalTimeEntries')
    && passes.includes('posSimMat.uniforms.uLocalTimeCount.value = !!args.attrTex && !args.suppressGroupKill ? localTime.entries.length : 0'));
}

// ── (h) untouched pins ────────────────────────────────────
{
  const passes = read('components/gpgpuSimulationPasses.ts');
  // 第45期統合: 液体は杉判断(c)で除外 — the stage-6 liquid
  // block is not part of this tree, so its sha256 pin is
  // replaced by an absence pin.
  const liquidStart = passes.lastIndexOf(' // Liquid solver (Limit plan stage 6, L1-2)');
  check('h no stage-6 liquid block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    liquidStart === -1);
  check('h the MainSphGrains shader file keeps its sha256 pin (untouched)',
    // Re-pinned 2026-11-29 (第45期統合): the file in this tree
    // is byte-identical to the product tree (v2.26.0) file —
    // sha256 verified in both trees — so the pin is the
    // product-lineage value.
    sha256(read('components/gpgpuShaderSimulationVelocityMainSphGrains.ts'))
      === 'b2ad88dbe6b6e054b6a0d0dfd60cce1708f80802d64469d570f2e2b5110eac06');
}

console.log(`layer1-wp9-local-time: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
