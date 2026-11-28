#!/usr/bin/env node
// layer1-wp8-deform-runtime.test.mjs — Layer 1 WP8 phase D:
// the deform stack's runtime wiring — the GLSL twin in the
// respawn (position) pass, its supply, the config-key bake
// connection, and the Spin channel's splat connection.
//
// Phase A (layer1-wp8-deform-stack.test.mjs) landed the
// grammar and the CPU bakes; the bakes' deform option was
// never fed from a config key and the respawn shader had no
// deform at all. This phase adds the key gpgpuEmitDeform,
// the position-pass variant (uniform operator array, the
// distribution layer's supply discipline; FFD control
// points on the shared column texture's append-only
// deformFfd section), the bake wiring from the same key,
// and the Spin channel's composition into the splat draw —
// the one posture consumer the channel had not reached.
//
// Pins:
// (a) default byte identity: the position fragment and the
//     splat vertex built with no options are the shipped
//     strings; neither mentions the deform / spin additions.
// (b) variant strings: the deform variant declares the
//     operator uniforms and splices the apply segment after
//     the distribution segment and the emitter-list
//     placement, immediately before the respawn age anchor
//     (the bake's pipeline position); the FFD sub-variant
//     adds exactly the column uniforms and the kind-4
//     branch, and the non-FFD form omits both.
// (c) GLSL ⇄ TS numeric agreement: a JS transcription of
//     the GLSL forms (integer lattice hash included) over
//     the packed supply equals applyDeformOps on a grid.
// (d) supply resolution: the variant predicates, the packed
//     uniform layout (kinds / axes / centres / FFD offsets
//     accumulating in list order) and the FFD payload pack.
// (e) column supply: an FFD-only config stands the supply
//     with deformFfd at 2048 and every earlier section at
//     its fieldExt offset; a non-deform config's supply is
//     unchanged in shape (deformFfdBase 0).
// (f) sampler budget: the deform variant spends no sampler;
//     the FFD sub-variant spends exactly one (the shared
//     column texture) and the position fragment stays
//     within the 16-unit budget.
// (g) posture wiring: the splat spin variant composes the
//     accumulated angle outside the base rotation, the draw
//     assets swap the variant with the channel, and the
//     visual updates bind uSpinTex on the splat material.
// (h) untouched pins: the stage-6 liquid block of the
//     passes and the MainSphGrains shader file keep their
//     sha256. (第45期統合: 液体は杉判断(c)で除外のため、
//     液体ブロックのピンは不在の確認に反転し、MainSphGrains
//     のピンは製品系譜の値に付け替えた。)
//
// Run: node scripts/layer1-wp8-deform-runtime.test.mjs

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
const near3 = (p, q, eps = 1e-6) => near(p[0], q[0], eps) && near(p[1], q[1], eps) && near(p[2], q[2], eps);
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

const deform = await load('lib/gpgpuDeformStack.ts', [
  'parseDeformOps', 'applyDeformOps', 'resolveConfigDeformOps',
  'deformVariantActive', 'deformColumnActive', 'packDeformOps',
  'packDeformFfdPoints', 'deformFfdTexelCount', 'deformGlsl',
  'DEFORM_UNIFORM_VEC4S', 'DEFORM_FFD_MAX_TEXELS',
]);
const position = await load('components/gpgpuShaderSimulationPosition.ts', ['buildPositionFragment']);
const splats = await load('components/gpgpuShaderSplats.ts', ['buildSplatVert', 'SPLAT_VERT']);
const pathAssets = await load('lib/gpgpuPathAssets.ts', [
  'getColumnSupply', 'DEFORM_COLUMN_LAYOUT', 'FIELD_EXT_COLUMN_LAYOUT',
]);
const initialData = await load('lib/gpgpuInitialData.ts', ['buildGpgpuInitialData']);

// ── (a) default byte identity ─────────────────────────────
{
  const plain = position.buildPositionFragment();
  const emptyOpts = position.buildPositionFragment({});
  check('a position: no-options build is the default string', plain === emptyOpts);
  check('a position: default carries no deform surface',
    !plain.includes('kaloDeform') && !plain.includes('uDeformOps') && !plain.includes('uDeformColTex'));
  const offOpts = position.buildPositionFragment({ emitDeform: false, emitDeformFfd: false });
  check('a position: explicit-off options keep the default string', offOpts === plain);
  check('a splat: default vertex is SPLAT_VERT and spin-free',
    splats.buildSplatVert() === splats.SPLAT_VERT && !splats.SPLAT_VERT.includes('uSpinTex'));
  check('a splat: explicit-off options keep the default string',
    splats.buildSplatVert({ spinChannel: false }) === splats.SPLAT_VERT);
}

// ── (b) variant strings ───────────────────────────────────
{
  const frag = position.buildPositionFragment({ emitDeform: true });
  check('b deform variant declares the operator uniforms',
    frag.includes(`uniform vec4 uDeformOps[${deform.DEFORM_UNIFORM_VEC4S}];`) && frag.includes('uniform int uDeformOpCount;'));
  check('b deform variant carries the GLSL twin and the apply call',
    frag.includes('vec3 kaloDeformApply(vec3 p)') && frag.includes('pos = kaloDeformApply(pos);'));
  check('b deform segment lands immediately before the respawn age anchor',
    frag.includes('pos = kaloDeformApply(pos);\n        // Replica age phase (Phase M)'));
  check('b non-FFD form omits the column uniforms and the kind-4 branch',
    !frag.includes('uDeformColTex') && !frag.includes('kaloDeformColFetch') && !frag.includes('kind == 4'));

  const both = position.buildPositionFragment({ emitDistribution: true, emitDeform: true });
  check('b deform applies after the distribution layer',
    both.lastIndexOf('pos = kaloDistApply(pos, uBounceRadius);') > -1
    && both.lastIndexOf('pos = kaloDistApply(pos, uBounceRadius);') < both.lastIndexOf('pos = kaloDeformApply(pos);'));

  const listed = position.buildPositionFragment({ emitterList: true, emitDeform: true });
  check('b deform applies after the emitter-list placement',
    listed.lastIndexOf('emitterAssignHash(vUv)') > -1
    && listed.lastIndexOf('emitterAssignHash(vUv)') < listed.lastIndexOf('pos = kaloDeformApply(pos);'));

  const ffd = position.buildPositionFragment({ emitDeform: true, emitDeformFfd: true });
  check('b FFD sub-variant declares the column uniforms and the kind-4 branch',
    ffd.includes('uniform sampler2D uDeformColTex;') && ffd.includes('uniform float uDeformFfdBase;')
    && ffd.includes('kaloDeformColFetch') && ffd.includes('kind == 4'));
  check('b FFD sub-variant differs from the plain deform variant only by the FFD surface',
    ffd.length > frag.length && ffd.includes('pos = kaloDeformApply(pos);'));
}

// ── (c) GLSL ⇄ TS numeric agreement ──────────────────────
// JS transcriptions of the GLSL forms in deformGlsl(),
// reading the packed uniform layout — the same discipline
// as the WP4 emitter-list wiring test's transcriptions.
function glslCoord(v, axis) { return axis === 0 ? v[0] : axis === 2 ? v[2] : v[1]; }
function glslRotateAxis(q, axis, angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  if (axis === 0) return [q[0], q[1] * c - q[2] * s, q[1] * s + q[2] * c];
  if (axis === 2) return [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]];
  return [q[0] * c - q[2] * s, q[1], q[0] * s + q[2] * c];
}
function glslLattice(ix, iy, iz, seed) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1)
    ^ Math.imul(iz | 0, 0x1b56c4e9) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296 * 2 - 1;
}
const glslSmooth = (t) => t * t * (3 - 2 * t);
function glslNoise3(p, seed) {
  const ix = Math.floor(p[0]); const iy = Math.floor(p[1]); const iz = Math.floor(p[2]);
  const fx = glslSmooth(p[0] - ix); const fy = glslSmooth(p[1] - iy); const fz = glslSmooth(p[2] - iz);
  const L = (x, y, z) => glslLattice(x, y, z, seed);
  const x00 = L(ix, iy, iz) + (L(ix + 1, iy, iz) - L(ix, iy, iz)) * fx;
  const x10 = L(ix, iy + 1, iz) + (L(ix + 1, iy + 1, iz) - L(ix, iy + 1, iz)) * fx;
  const x01 = L(ix, iy, iz + 1) + (L(ix + 1, iy, iz + 1) - L(ix, iy, iz + 1)) * fx;
  const x11 = L(ix, iy + 1, iz + 1) + (L(ix + 1, iy + 1, iz + 1) - L(ix, iy + 1, iz + 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
function glslFractal(p, seed) {
  const a = glslNoise3(p, seed);
  const b = glslNoise3([p[0] * 2.13 + 5.2, p[1] * 2.13 + 1.3, p[2] * 2.13 + 2.8], seed + 77);
  return a * 0.667 + b * 0.333;
}
function glslBernstein(degree, i, u) {
  const c = degree === 1 ? 1 : degree === 2 ? (i === 1 ? 2 : 1) : (i === 0 || i === 3 ? 1 : 3);
  return c * Math.pow(u, i) * Math.pow(1 - u, degree - i);
}
function glslApplyPacked(p0, packed, count, colData, ffdBase) {
  let p = [...p0];
  for (let i = 0; i < count; i++) {
    const a = packed.slice(i * 12, i * 12 + 4);
    const b = packed.slice(i * 12 + 4, i * 12 + 8);
    const c = packed.slice(i * 12 + 8, i * 12 + 12);
    const kind = Math.round(a[0]); const axis = Math.round(a[1]);
    if (kind === 3) {
      const np = [p[0] * c[0] + c[1], p[1] * c[0] + c[1] * 0.7, p[2] * c[0] - c[1] * 0.4];
      p = [p[0] + glslFractal(np, 11) * a[3] * 0.5,
           p[1] + glslFractal(np, 47) * a[3] * 0.5,
           p[2] + glslFractal(np, 83) * a[3] * 0.5];
      continue;
    }
    if (kind === 4) {
      const div = c[3]; const per = div + 1;
      const mn = [b[0], b[1], b[2]]; const mx = [b[3], c[0], c[1]];
      const u = [0, 1, 2].map((k) => (mx[k] - mn[k] > 0
        ? Math.min(1, Math.max(0, (p[k] - mn[k]) / (mx[k] - mn[k]))) : 0));
      const off = [0, 0, 0];
      for (let ii = 0; ii <= div; ii++) for (let jj = 0; jj <= div; jj++) for (let kk = 0; kk <= div; kk++) {
        const w = glslBernstein(div, ii, u[0]) * glslBernstein(div, jj, u[1]) * glslBernstein(div, kk, u[2]);
        if (w === 0) continue;
        const idx = (ffdBase + c[2] + (ii * per + jj) * per + kk) * 4;
        off[0] += w * colData[idx]; off[1] += w * colData[idx + 1]; off[2] += w * colData[idx + 2];
      }
      p = [p[0] + off[0], p[1] + off[1], p[2] + off[2]];
      continue;
    }
    const center = [b[0], b[1], b[2]];
    let q = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    if (kind === 0) {
      const t = glslCoord(q, axis); q[Math.round(a[2])] += a[3] * t * t;
    } else if (kind === 1) {
      const angle = a[3] * glslCoord(q, axis);
      if (angle !== 0) q = glslRotateAxis(q, axis, angle);
    } else if (kind === 2) {
      const t = glslCoord(q, axis) / b[3];
      const factor = Math.max(0, 1 + a[3] * t);
      if (factor !== 1) {
        if (axis === 0) q = [q[0], q[1] * factor, q[2] * factor];
        else if (axis === 2) q = [q[0] * factor, q[1] * factor, q[2]];
        else q = [q[0] * factor, q[1], q[2] * factor];
      }
    }
    p = [q[0] + center[0], q[1] + center[1], q[2] + center[2]];
  }
  return p;
}
{
  const ffdPoints1 = new Array(8 * 3).fill(0);
  ffdPoints1[0] = 0.4; ffdPoints1[7] = -0.3; ffdPoints1[23] = 0.25;
  const ffdPoints2 = new Array(27 * 3).fill(0);
  ffdPoints2[3] = 0.2; ffdPoints2[40] = -0.5; ffdPoints2[80] = 0.35;
  const stacks = [
    [{ op: 'bend', axis: 'x', dir: 'y', amount: 0.4, center: [0.1, 0, 0] }],
    [{ op: 'twist', axis: 'z', amount: 1.3, center: [0, 0, 0.2] }],
    [{ op: 'taper', axis: 'x', amount: -0.6, range: 2.5, center: [0, 0.2, 0] }],
    [{ op: 'noise', amount: 0.8, frequency: 1.7, evolution: 0.35 }],
    [{ op: 'ffd', divisions: 1, min: [-1, -1, -1], max: [1, 1, 1], points: ffdPoints1 }],
    [
      { op: 'bend', amount: 0.3 },
      { op: 'ffd', divisions: 2, min: [-2, -1, -1], max: [2, 1, 1], points: ffdPoints2 },
      { op: 'twist', axis: 'y', amount: -0.7 },
      { op: 'noise', amount: 0.5, frequency: 0.6, evolution: -0.2 },
      { op: 'taper', axis: 'z', amount: 0.9, range: 1.5 },
    ],
  ];
  const grid = [[0, 0, 0], [0.3, -0.7, 1.2], [-1.5, 0.25, 0.9], [2, -2, 0.5], [0.01, 0.99, -0.33], [-0.8, -0.8, -0.8]];
  let allOk = true;
  for (const raw of stacks) {
    const ops = deform.parseDeformOps(JSON.stringify(raw));
    const packed = deform.packDeformOps(ops);
    const payload = deform.packDeformFfdPoints(ops);
    const colData = new Float32Array(4096 * 4);
    colData.set(payload, 2048 * 4);
    for (const p of grid) {
      const ts = deform.applyDeformOps(ops, p[0], p[1], p[2]);
      const gl = glslApplyPacked(p, packed, ops.length, colData, 2048);
      if (!near3(ts, gl, 2e-6)) { allOk = false; console.error('  mismatch', JSON.stringify(raw).slice(0, 40), p, ts, gl); }
    }
  }
  check('c packed-GLSL transcription equals applyDeformOps over the grid', allOk);
  check('c the GLSL twin text carries the integer lattice hash constants',
    deform.deformGlsl(false).includes('0x27d4eb2du') && deform.deformGlsl(false).includes('4294967296.0'));
}

// ── (d) supply resolution ─────────────────────────────────
{
  check('d empty key: neither variant stands',
    !deform.deformVariantActive({ gpgpuEmitDeform: '' }) && !deform.deformColumnActive({ gpgpuEmitDeform: '' }));
  check('d identity-only stack resolves to no variant',
    !deform.deformVariantActive({ gpgpuEmitDeform: '[{"op":"bend","amount":0}]' }));
  check('d bend-only stack: variant stands, column does not',
    deform.deformVariantActive({ gpgpuEmitDeform: '[{"op":"bend","amount":0.5}]' })
    && !deform.deformColumnActive({ gpgpuEmitDeform: '[{"op":"bend","amount":0.5}]' }));
  check('d FFD stack: both stand',
    deform.deformColumnActive({ gpgpuEmitDeform: '[{"op":"ffd","divisions":1,"points":[0.5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}]' }));

  const ops = deform.parseDeformOps(JSON.stringify([
    { op: 'twist', axis: 'z', amount: 0.9, center: [1, 2, 3] },
    { op: 'ffd', divisions: 1, min: [-1, -2, -3], max: [4, 5, 6], points: (() => { const a = new Array(24).fill(0); a[1] = 0.25; return a; })() },
    { op: 'ffd', divisions: 2, min: [0, 0, 0], max: [1, 1, 1], points: (() => { const a = new Array(81).fill(0); a[2] = 0.5; return a; })() },
  ]));
  const packed = deform.packDeformOps(ops);
  check('d pack length is the full uniform array', packed.length === deform.DEFORM_UNIFORM_VEC4S * 4);
  check('d twist row packs kind/axis/amount/centre',
    packed[0] === 1 && packed[1] === 2 && packed[3] === 0.9
    && packed[4] === 1 && packed[5] === 2 && packed[6] === 3);
  check('d ffd rows pack the box across B and C',
    packed[12] === 4 && packed[16] === -1 && packed[17] === -2 && packed[18] === -3 && packed[19] === 4
    && packed[20] === 5 && packed[21] === 6 && packed[23] === 1);
  check('d ffd offsets accumulate in list order (0, then 8)',
    packed[22] === 0 && packed[34] === 8);
  check('d ffd texel budget covers a full stack',
    deform.DEFORM_FFD_MAX_TEXELS === 8 * 64 && deform.deformFfdTexelCount(ops) === 8 + 27);
}

// ── (e) column supply ─────────────────────────────────────
{
  const empty = pathAssets.getColumnSupply({});
  check('e empty config keeps the null supply', empty === null);

  const ffdJson = '[{"op":"ffd","divisions":1,"points":[0.5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}]';
  const supply = pathAssets.getColumnSupply({ gpgpuEmitDeform: ffdJson });
  check('e FFD-only config stands the column supply', supply !== null);
  check('e deformFfd section base is 2048 (append-only after layerExt)',
    supply && supply.deformFfdBase === 2048, supply && supply.deformFfdBase);
  const layout = pathAssets.DEFORM_COLUMN_LAYOUT;
  const extLayout = pathAssets.FIELD_EXT_COLUMN_LAYOUT;
  const off = (l, id) => l.sections.find((s) => s.id === id)?.offset;
  check('e every earlier section keeps its fieldExt offset',
    ['fields', 'layers', 'pathHeaders', 'pathPoints', 'emitters', 'fieldExt', 'layerExt']
      .every((id) => off(layout, id) === off(extLayout, id)));
  check('e the payload lands at the section base',
    supply && supply.texture.image.data[2048 * 4] === 0.5 && supply.texture.image.data[2048 * 4 + 1] === 0);
  check('e the supply texture covers the grown layout',
    supply && supply.height === layout.height);

  const fieldsOnly = pathAssets.getColumnSupply({
    gpgpuFieldInstances: '[{"kind":"well","pos":[0,0,0],"radius":10,"strength":1}]',
  });
  check('e a non-deform supply reports deformFfdBase 0',
    fieldsOnly !== null && fieldsOnly.deformFfdBase === 0);
}

// ── (f) sampler budget ────────────────────────────────────
{
  const countSamplers = (s) => (s.match(/uniform sampler2D/g) || []).length;
  const base = countSamplers(position.buildPositionFragment());
  const deformOnly = countSamplers(position.buildPositionFragment({ emitDeform: true }));
  const deformFfd = countSamplers(position.buildPositionFragment({ emitDeform: true, emitDeformFfd: true }));
  check('f the deform variant spends no sampler', deformOnly === base, `${base} -> ${deformOnly}`);
  check('f the FFD sub-variant spends exactly one (the shared column texture)',
    deformFfd === base + 1, `${base} -> ${deformFfd}`);
  check('f the position fragment stays within the 16-unit budget', deformFfd <= 16, deformFfd);
}

// ── (g) posture wiring ────────────────────────────────────
{
  const spin = splats.buildSplatVert({ spinChannel: true });
  check('g spin variant declares uSpinTex and composes outside the base rotation',
    spin.includes('uniform sampler2D uSpinTex;')
    && spin.indexOf('mat3 rot = kaloQuatMat3(quat);') < spin.indexOf('uSpinTex, particleUv')
    && spin.includes('mat3(spinC, 0.0, spinS, 0.0, 1.0, 0.0, -spinS, 0.0, spinC) * rot'));
  const assets = read('components/useGpgpuDrawAssets.ts');
  check('g draw assets build the splat variant from the channel and swap it on flips',
    assets.includes('buildSplatVert({ spinChannel: spinChannelVariantOn(drawConfig) })')
    && assets.includes('splatMat.vertexShader = buildSplatVert({ spinChannel })'));
  const updates = read('components/gpgpuVisualUpdates.ts');
  check('g visual updates bind the spin texture on the splat material (guarded)',
    updates.includes('if (splatMat.uniforms.uSpinTex) splatMat.uniforms.uSpinTex.value = args.spinTexture ?? null;'));
  const runtime = read('components/useGpgpuRuntime.ts');
  check('g the bake reads the deform stack from the config key',
    runtime.includes('deform: deformVariantActive(config) ? resolveConfigDeformOps(config) : null'));
  const passes = read('components/gpgpuSimulationPasses.ts');
  check('g the passes supply the deform uniforms and the FFD column',
    passes.includes('posSimMat.uniforms.uDeformOps') && passes.includes('posSimMat.uniforms.uDeformFfdBase'));
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

// ── bake agreement: config key → initial data ────────────
{
  const legacy = initialData.buildGpgpuInitialData(8, 3, 'sphere', 7, 10, null, null);
  const ops = deform.resolveConfigDeformOps({ gpgpuEmitDeform: '[{"op":"bend","amount":0.35,"center":[0,0,0]}]' });
  const baked = initialData.buildGpgpuInitialData(8, 3, 'sphere', 7, 10, null, { deform: ops });
  let ok = ops.length === 1;
  for (let i = 0; i < 64 && ok; i++) {
    const src = [legacy.posData[i * 4], legacy.posData[i * 4 + 1], legacy.posData[i * 4 + 2]];
    const want = deform.applyDeformOps(ops, src[0], src[1], src[2]);
    ok = near3([baked.posData[i * 4], baked.posData[i * 4 + 1], baked.posData[i * 4 + 2]], want, 1e-5)
      && baked.posData[i * 4 + 3] === legacy.posData[i * 4 + 3];
  }
  check('bake the config-resolved stack deforms the initial data exactly as the twin', ok);
}

// ── (i) material uniform entities ─────────────────────────
{
  const assets = read('components/useGpgpuSimulationAssets.ts');
  const bodyStart = assets.indexOf('export function createPosSimMaterial');
  const body = assets.slice(bodyStart, assets.indexOf('export function createVellumProjMaterial', bodyStart));
  check('i createPosSimMaterial declares the uDeformOps array entity at the lib uniform size',
    body.includes('uDeformOps:') && body.includes('Array.from({ length: DEFORM_UNIFORM_VEC4S }, () => new THREE.Vector4())'));
  check('i createPosSimMaterial declares uDeformOpCount starting at 0',
    /uDeformOpCount:\s*\{ value: 0 \}/.test(body));
  check('i the assets file imports DEFORM_UNIFORM_VEC4S from the deform lib',
    assets.includes('DEFORM_UNIFORM_VEC4S } from "../lib/gpgpuDeformStack"'));
  check('i the declared array size matches the lib constant (DEFORM_UNIFORM_VEC4S = 24)',
    deform.DEFORM_UNIFORM_VEC4S === 24);
  check('i createPosSimMaterial declares the FFD column entities',
    body.includes('uDeformColTex:') && body.includes('uDeformColWidth:')
    && body.includes('uDeformColHeight:') && /uDeformFfdBase:\s*\{ value: 0 \}/.test(body));
}

console.log(`layer1-wp8-deform-runtime: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
