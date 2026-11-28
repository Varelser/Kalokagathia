#!/usr/bin/env node
// layer1-wp4-emitter-list-wiring.test.mjs — Layer 1 WP4
// phase D2: the emitter list wired into the position pass.
//
// Phase D1 shipped the list grammar, the resolution, the
// assignment and the column pack (lib/gpgpuEmitterList.ts)
// plus the bake generalisation. Phase D2 wires the list
// into the runtime respawn:
//
//  - getColumnSupply gains a third branch: while a list
//    stands, the EMITTER layout packs fields / paths /
//    emitters into one texture (existing section offsets
//    unmoved, emitters appended at texel 1280) and the
//    supply carries emittersBase / emitterCount. The cache
//    signature covers the list and the light unit keys the
//    pack derives from.
//  - buildPositionFragment gains the emitterList variant:
//    the assignment walk over the weight bands, the record
//    fetch (7 texels per element), the per-element law
//    ('auto' → the legacy ball in the element's frame,
//    shaped → kaloEmitShapePos with the element's light
//    position), the distribution layer inside the block,
//    and the element transform closing the placement.
//    While a source (cloud / path) stands, only the
//    transform generalises (a per-element segment replaces
//    the single-emitter one). While the mask stands, the
//    mask branch keeps its single-law behaviour (the list
//    composition is deferred — pinned as such below).
//  - The assets resolve the variant in the factory AND the
//    swap effect + variant key (the dual-management site),
//    pre-declare uEmittersBase / uEmitterCount, and the
//    passes supply both from the column supply, before the
//    stage-6 liquid block (which is sha256-pinned
//    untouched).
//
// Pins:
// (a) default byte-identity against the phase18 record;
//     the variant names appear in no default string.
// (b) variant strings: uniforms declared once (the column
//     uniforms shared with the path-asset variant, never
//     duplicated), helpers before main(), walk + fetches +
//     law branches + transform close present, the legacy
//     placement gone; distribution inside the block (after
//     the law, before the transform); seed form shifts the
//     draws; source composition swaps only the transform;
//     mask precedence keeps the single-law branch.
// (c) grid match: the GLSL form evaluated in JS (hash1 IS
//     dmHash11 at (p.x * 127.1 + p.y * 311.7); the fetch
//     reads the PACKED column data) equals the lib
//     composition (emitterIndexForIndex + sampleEmitShape /
//     the legacy ball + applyEmitterTransform) on every
//     texel of a 16x16 pool over a 3-element list (auto
//     origin ball / auto light ball / shaped respawn, all
//     with non-identity transforms).
// (d) supply: emitters-only stands at 256x6 with
//     emittersBase 1280; fields / paths offsets unmoved
//     with a list standing; no list → emittersBase 0 and
//     the B1 supply unchanged; the cache turns over on a
//     light-key change the pack depends on.
// (e) wiring: assets + passes source pins; the stage-6
//     liquid block sha256 pin. (第45期統合: 液体は杉判断
//     (c)で除外のため、液体ブロックのピンは不在の確認に
//     反転している。)
//
// Run: node scripts/layer1-wp4-emitter-list-wiring.test.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp4d2-bundle-${process.pid}.mjs`);

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const count = (s, needle) => s.split(needle).length - 1;
const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { getColumnSupply } from './lib/gpgpuPathAssets.ts';
      export { resolveEmitterList, emitterListActive, emitterHashForUv, emitterIndexForIndex, packEmitterColumnData, EMITTER_COLUMN_LAYOUT } from './lib/gpgpuEmitterList.ts';
      export { sampleEmitShape, EMIT_SHAPE_IDS } from './lib/gpgpuEmitShapes.ts';
      export { applyEmitterTransform } from './lib/gpgpuEmitter.ts';
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
  check('a SIM_POS_FRAG matches the phase18 pin (length + sha256)',
    M.SIM_POS_FRAG.length === baseline.parts.SIM_POS_FRAG.length
    && sha256(M.SIM_POS_FRAG) === baseline.parts.SIM_POS_FRAG.sha256);
  check('a buildPositionFragment({ emitterList: false }) is the shipped string',
    M.buildPositionFragment({ emitterList: false }) === M.SIM_POS_FRAG);
  check('a no list name in the default string',
    !M.SIM_POS_FRAG.includes('emitterAssignHash') && !M.SIM_POS_FRAG.includes('uEmittersBase')
    && !M.SIM_POS_FRAG.includes('uEmitterCount') && !M.SIM_POS_FRAG.includes('kaloEmitterColFetch'));
}

// ── (b) variant strings ──────────────────────────────────
{
  const frag = M.buildPositionFragment({ emitterList: true });
  check('b list variant differs from the shipped string', frag !== M.SIM_POS_FRAG);
  check('b list uniforms declared exactly once',
    count(frag, 'uniform float uEmittersBase;') === 1 && count(frag, 'uniform int uEmitterCount;') === 1);
  check('b column uniforms declared exactly once',
    count(frag, 'uniform sampler2D uEmitColTex;') === 1
    && count(frag, 'uniform float uEmitColWidth;') === 1
    && count(frag, 'uniform float uEmitColHeight;') === 1);
  check('b assignment hash is the lib twin composition (offset sync)',
    frag.includes('float emitterAssignHash(vec2 uv) {\n    return hash1(uv + vec2(17.17, 9.43));\n  }'));
  check('b helpers land before main()',
    frag.indexOf('float emitterAssignHash') > -1 && frag.indexOf('float emitterAssignHash') < frag.indexOf('void main() {'));
  check('b shape law chunk spliced without the emitterShape option',
    frag.includes('vec3 kaloEmitShapePos(int shape, vec4 d, float radius, vec3 lightPos)'));
  check('b band walk present',
    frag.includes('if (kaloEmitterColFetch(uEmittersBase + float(emK * 7)).w > emHash) break;'));
  check('b record fetches present (T0/T1/T2/T3/T5/T6)',
    frag.includes('vec4 emT0 = kaloEmitterColFetch(emRec);')
    && frag.includes('vec4 emT1 = kaloEmitterColFetch(emRec + 1.0);')
    && frag.includes('vec4 emT2 = kaloEmitterColFetch(emRec + 2.0);')
    && frag.includes('vec4 emT3 = kaloEmitterColFetch(emRec + 3.0);')
    && frag.includes('vec4 emT5 = kaloEmitterColFetch(emRec + 5.0);')
    && frag.includes('vec4 emT6 = kaloEmitterColFetch(emRec + 6.0);'));
  check('b auto branch: legacy draws, light test on the element shape id',
    frag.includes('if (emT5.z < -0.5) {')
    && frag.includes('float r   = uBounceRadius * (0.05 + hash1(vUv + vec2(age)) * 0.9);')
    && frag.includes('if (emT1.w > 5.5) {')
    && frag.includes('pos = emT6.xyz + vec3(jr * sin(phi) * cos(th), jr * sin(phi) * sin(th), jr * cos(phi));'));
  check('b shaped branch: the shared law with the element light position',
    frag.includes('pos = kaloEmitShapePos(int(emT5.z + 0.5), vec4(hash1(vUv + vec2(11.1)), hash1(vUv + vec2(23.7)), hash1(vUv + vec2(37.3)), hash1(vUv + vec2(51.9))), uBounceRadius, emT6.xyz);'));
  check('b element transform closes the placement',
    frag.includes('pos = emT0.xyz + mat3(emT1.xyz, emT2.xyz, emT3.xyz) * pos;'));
  check('b legacy placement gone', !frag.includes('if (uEmitLight) {'));
  check('b no distribution without the option', !frag.includes('kaloDistApply'));

  const fragDist = M.buildPositionFragment({ emitterList: true, emitDistribution: true });
  const iLaw = fragDist.indexOf('kaloEmitShapePos(int(emT5.z + 0.5)');
  const iDist = fragDist.indexOf('pos = kaloDistApply(pos, uBounceRadius);');
  const iTf = fragDist.indexOf('pos = emT0.xyz + mat3(emT1.xyz, emT2.xyz, emT3.xyz) * pos;');
  check('b distribution inside the block: after the law, before the transform, exactly once',
    count(fragDist, 'kaloDistApply') >= 1 && iLaw > -1 && iDist > iLaw && iTf > iDist
    && count(fragDist, 'pos = kaloDistApply(pos, uBounceRadius);') === 1);

  const fragSeed = M.buildPositionFragment({ emitterList: true, shaderSeed: true });
  check('b seed form shifts the placement draws',
    fragSeed.includes('hash1(vUv + vec2(age + uShaderSeedPhase))')
    && fragSeed.includes('hash1(vUv + vec2(11.1 + uShaderSeedPhase))'));

  const fragCloud = M.buildPositionFragment({ emitterList: true, emitterCloud: true, emitterTransform: true });
  check('b source composition: cloud placement stands, per-element transform segment follows',
    fragCloud.includes('pos = texture2D(uEmitCloudTex, vUv).xyz;')
    && fragCloud.includes('// Emitter list transform (Layer 1 WP4, phase D2):')
    && fragCloud.includes('pos = emT0T.xyz + mat3(emC0T, emC1T, emC2T) * pos;'));
  check('b source composition: no list placement block, no single transform segment',
    !fragCloud.includes('emT5.z < -0.5') && !fragCloud.includes('pos = uEmitterPos + uEmitterRotScale * pos;'));

  const fragBoth = M.buildPositionFragment({ emitterList: true, emitterPathAsset: true });
  check('b list + path asset: column uniforms still declared exactly once',
    count(fragBoth, 'uniform sampler2D uEmitColTex;') === 1
    && count(fragBoth, 'uniform float uEmittersBase;') === 1);

  const fragMask = M.buildPositionFragment({ emitterList: true, emitterMask: true, emitterShape: true });
  check('b mask precedence: the mask branch stands, the list placement does not (composition deferred)',
    fragMask.includes('// Emission mask (stage 2, E3): candidates are gated')
    && !fragMask.includes('emT5.z < -0.5'));
}

// ── (c) grid match: GLSL form vs lib composition ─────────
{
  const R = 30;
  const listCfg = cfg({
    gpgpuEmitters: JSON.stringify([
      { shape: 'sphere', respawnShape: 'auto', pos: [10, 0, 0], rot: [0, 0, 0], scale: 1, weight: 1 },
      { shape: 'light', respawnShape: 'auto', pos: [0, 20, 0], rot: [0, 90, 0], scale: 2, weight: 2, lightUnit: 2 },
      { shape: 'box', respawnShape: 'disc', pos: [-8, -8, 0], rot: [30, 0, 0], scale: 0.5, weight: 1 },
    ]),
    gpgpuLight2Enabled: true,
    gpgpuLight2PosX: 3, gpgpuLight2PosY: 4, gpgpuLight2PosZ: 5,
    gpgpuLight2Intensity: 2,
  });
  const res = M.resolveEmitterList(listCfg);
  check('c fixture resolves to 3 authored elements with bands 0.25 / 0.75 / 1',
    res.listAuthored && res.emitters.length === 3
    && res.emitters[0].cumWeightEnd === 0.25 && res.emitters[1].cumWeightEnd === 0.75
    && res.emitters[2].cumWeightEnd === 1);
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
  const hash1 = (px, py) => M.dmHash11(px * 127.1 + py * 311.7);
  const shapeNameById = Object.fromEntries(Object.entries(M.EMIT_SHAPE_IDS).map(([k, v]) => [v, k]));
  // The GLSL form, transcribed: assignment walk over the
  // packed records, per-element law, element transform.
  const glslPlace = (u, v, age) => {
    const emHash = hash1(u + 17.17, v + 9.43);
    let emIdx = 0;
    for (let emK = 0; emK < 8; emK++) {
      if (emK >= pack.emitterCount) break;
      emIdx = emK;
      if (fetchRec(pack.emittersBase + emK * 7)[3] > emHash) break;
    }
    const rec = pack.emittersBase + emIdx * 7;
    const T0 = fetchRec(rec);
    const T1 = fetchRec(rec + 1);
    const T2 = fetchRec(rec + 2);
    const T3 = fetchRec(rec + 3);
    const T5 = fetchRec(rec + 5);
    const T6 = fetchRec(rec + 6);
    let p;
    if (T5[2] < -0.5) {
      const r = R * (0.05 + hash1(u + age, v + age) * 0.9);
      const th = hash1(u + 1.3, v + 1.3) * 6.2832;
      const phi = Math.acos(2 * hash1(u + 2.7, v + 2.7) - 1);
      const s = [Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)];
      if (T1[3] > 5.5) {
        const jr = r * 0.05;
        p = [T6[0] + jr * s[0], T6[1] + jr * s[1], T6[2] + jr * s[2]];
      } else {
        p = [r * s[0], r * s[1], r * s[2]];
      }
    } else {
      const draws = [hash1(u + 11.1, v + 11.1), hash1(u + 23.7, v + 23.7), hash1(u + 37.3, v + 37.3), hash1(u + 51.9, v + 51.9)];
      let di = 0;
      p = M.sampleEmitShape(shapeNameById[Math.round(T5[2])], () => draws[di++], R, { x: T6[0], y: T6[1], z: T6[2] });
    }
    return [
      T0[0] + T1[0] * p[0] + T2[0] * p[1] + T3[0] * p[2],
      T0[1] + T1[1] * p[0] + T2[1] * p[1] + T3[1] * p[2],
      T0[2] + T1[2] * p[0] + T2[2] * p[1] + T3[2] * p[2],
    ];
  };
  // The lib composition: the bake's per-particle route.
  const libPlace = (index, texSize, age) => {
    const el = res.emitters[M.emitterIndexForIndex(res.emitters, index, texSize)];
    const u = ((index % texSize) + 0.5) / texSize;
    const v = (Math.floor(index / texSize) + 0.5) / texSize;
    let p;
    if (el.def.respawnShape === 'auto') {
      const r = R * (0.05 + hash1(u + age, v + age) * 0.9);
      const th = hash1(u + 1.3, v + 1.3) * 6.2832;
      const phi = Math.acos(2 * hash1(u + 2.7, v + 2.7) - 1);
      const s = [Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)];
      if (el.def.shape === 'light') {
        const jr = r * 0.05;
        p = [el.lightPos.x + jr * s[0], el.lightPos.y + jr * s[1], el.lightPos.z + jr * s[2]];
      } else {
        p = [r * s[0], r * s[1], r * s[2]];
      }
    } else {
      const draws = [hash1(u + 11.1, v + 11.1), hash1(u + 23.7, v + 23.7), hash1(u + 37.3, v + 37.3), hash1(u + 51.9, v + 51.9)];
      let di = 0;
      p = M.sampleEmitShape(el.def.respawnShape, () => draws[di++], R, el.lightPos);
    }
    return M.applyEmitterTransform(el.def.transform, p[0], p[1], p[2]);
  };
  const texSize = 16;
  let assignAll = true;
  let placeAll = true;
  const seen = [0, 0, 0];
  for (let i = 0; i < texSize * texSize; i++) {
    const u = ((i % texSize) + 0.5) / texSize;
    const v = (Math.floor(i / texSize) + 0.5) / texSize;
    const age = (i % 7) * 0.13;
    // Assignment: the GLSL hash composition equals the lib
    // hash, and the packed-band walk equals the lib walk.
    if (hash1(u + 17.17, v + 9.43) !== M.emitterHashForUv(u, v)) assignAll = false;
    const g = glslPlace(u, v, age);
    const l = libPlace(i, texSize, age);
    if (!near(g[0], l[0]) || !near(g[1], l[1]) || !near(g[2], l[2])) placeAll = false;
    seen[M.emitterIndexForIndex(res.emitters, i, texSize)] += 1;
  }
  check('c assignment hash composition equals emitterHashForUv on the grid', assignAll);
  check('c GLSL form equals the lib composition on every texel (16x16)', placeAll);
  check('c every element receives births', seen[0] > 0 && seen[1] > 0 && seen[2] > 0);
}

// ── (d) supply ───────────────────────────────────────────
{
  const listOnly = cfg({
    gpgpuEmitters: JSON.stringify([
      { shape: 'sphere', pos: [1, 2, 3] },
      { shape: 'disc', pos: [-2, 0, 1], weight: 3 },
    ]),
  });
  const s = M.getColumnSupply(listOnly);
  check('d emitters-only config stands (no fields, no paths)',
    s !== null && s.emittersBase === 1280 && s.emitterCount === 2);
  check('d emitters-only supply is 256x6 with path/field counts 0',
    s.width === 256 && s.height === 6 && s.pathCount === 0 && s.instanceCount === 0
    && s.headersBase === 0 && s.pointsBase === 0);
  check('d supply texels carry the packed records (element 0 T0 = pos + cumEnd)',
    s.texture.image.data[(1280) * 4] === 1 && s.texture.image.data[1280 * 4 + 1] === 2
    && s.texture.image.data[1280 * 4 + 2] === 3 && s.texture.image.data[1280 * 4 + 3] === 0.25);

  const withFields = cfg({
    gpgpuFieldInstances: JSON.stringify([{ kind: 'vortex', pos: [10, 0, 0], radius: 100, strength: 2, tilt: 0 }]),
    gpgpuEmitters: JSON.stringify([{ shape: 'sphere', pos: [1, 2, 3] }]),
  });
  const sf = M.getColumnSupply(withFields);
  check('d fields + list: field offsets unmoved, emitters appended',
    sf !== null && sf.fieldsBase === 0 && sf.layersBase === 256 && sf.instanceCount === 1
    && sf.emittersBase === 1280 && sf.emitterCount === 1 && sf.height === 6);

  const withPaths = cfg({
    gpgpuSteerSeekPaths: '[{"points":[[3,3,3],[4,4,4]]}]',
    gpgpuEmitters: JSON.stringify([{ shape: 'sphere', pos: [1, 2, 3] }]),
  });
  const sp = M.getColumnSupply(withPaths);
  check('d paths + list: path offsets unmoved, emitters appended',
    sp !== null && sp.headersBase === 512 && sp.pointsBase === 768 && sp.pathCount === 1
    && sp.emittersBase === 1280 && sp.emitterCount === 1 && sp.height === 6);

  const fieldsOnly = cfg({
    gpgpuFieldInstances: JSON.stringify([{ kind: 'vortex', pos: [10, 0, 0], radius: 100, strength: 2, tilt: 0 }]),
  });
  const sb = M.getColumnSupply(fieldsOnly);
  check('d no list: B1 supply unchanged (emittersBase 0, height 2)',
    sb !== null && sb.emittersBase === 0 && sb.emitterCount === 0 && sb.height === 2);
  check('d empty config resolves to null', M.getColumnSupply(cfg({})) === null);
  check('d variant predicate follows the authored list',
    M.emitterListActive(listOnly) === true && M.emitterListActive(cfg({})) === false);

  const lightCfg = (x) => cfg({
    gpgpuEmitters: JSON.stringify([{ shape: 'light', weightFromLight: true, weight: 1, lightUnit: 1 }]),
    gpgpuLightEnabled: true, gpgpuLightPosX: x, gpgpuLightPosY: 0, gpgpuLightPosZ: 0, gpgpuLightIntensity: 2,
  });
  const s1 = M.getColumnSupply(lightCfg(5));
  const s2 = M.getColumnSupply(lightCfg(5));
  const s3 = M.getColumnSupply(lightCfg(9));
  check('d cache: identical config returns the cached supply', s1 === s2);
  check('d cache: a light position change turns the supply over (signature covers the light keys)',
    s3 !== s1 && s3.texture.image.data[(1280 + 6) * 4] === 9);
}

// ── (e) wiring ───────────────────────────────────────────
{
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('e assets: imports the list predicate',
    assets.includes("import { emitterListActive } from \"../lib/gpgpuEmitterList\";"));
  // Pin update (2026-11-28, Layer 1 WP4 phase D3): the
  // velocity variant options resolve the same predicate
  // (the third site), so the count is 3.
  check('e assets: factory + swap effect both resolve the variant (+ velocity options since D3)',
    count(assets, 'emitterList: emitterListActive(config),') === 3);
  check('e assets: variant key carries the list flag',
    assets.includes('${shaderSeedActive(c)}:${emitterListActive(c)}'));
  check('e assets: swap effect depends on the list key',
    assets.includes('config.gpgpuEmitters, posSimMat]'));
  // Pin update (2026-11-28, Layer 1 WP4 phase D3): the
  // velocity material pre-declares the same pair (one entry
  // per material), so the counts are 2.
  check('e assets: uniform entries pre-declared once each per material (position + velocity since D3)',
    count(assets, 'uEmittersBase:') === 2 && count(assets, 'uEmitterCount:') === 2);
  check('e passes: both uniforms supplied from the column supply',
    passes.includes('posSimMat.uniforms.uEmittersBase.value = colSupply ? colSupply.emittersBase : 0;')
    && passes.includes('posSimMat.uniforms.uEmitterCount.value = colSupply ? colSupply.emitterCount : 0;'));
  // 第45期統合: 液体は杉判断(c)で除外 — the stage-6 liquid
  // block is not part of this tree. The position/sha256 checks
  // against it are replaced by an absence pin; the supply
  // additions themselves stand (checked above and below).
  const liquidStart = passes.lastIndexOf(' // Liquid solver (Limit plan stage 6, L1-2)');
  check('e passes: the supply additions are present (uEmittersBase supply stands)',
    passes.indexOf('uEmittersBase') > -1);
  check('e passes: no stage-6 liquid block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    liquidStart === -1);
}

console.log(`layer1-wp4-emitter-list-wiring: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
console.log('ALL PASS');
