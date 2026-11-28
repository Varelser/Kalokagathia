#!/usr/bin/env node
// layer1-wp5-field-wiring.test.mjs — Layer 1 WP5 phase D:
// the field grammar wired into the velocity shader.
//
// Phase A-C shipped the lib assets (falloff shapes + group
// gates in lib/gpgpuFieldInstances.ts, the daemon laws in
// lib/gpgpuDaemonFields.ts, and the phase C judgment that
// the Akinci surface tension generalises as a force-order
// chunk with its own neighbour scan). Phase D wires them:
//
//  - 'drag' and 'crown' join the field-instance kinds; the
//    column pack gains APPEND-ONLY extension sections
//    (fieldExt at texel 1536, layerExt at 1792 in the
//    extension layout — every earlier offset unmoved)
//    carrying the falloff shape ids, the normalised group
//    gates and the daemon parameters.
//  - kaloFieldForceExt (helpers) generalises the B1 loop:
//    shaped falloffs, per-instance / per-layer group gates
//    effective for ALL kinds (the vortex / well multipliers
//    are no longer fixed 1.0), and the daemon laws. The
//    stock chunk calls it; the live form derives by the
//    same one-anchor replacement as B1.
//  - 'surface-tension' joins the force order (appended
//    last, variant-gated): the Akinci law on its own
//    neighbour scan, mutually exclusive with the SPH form
//    by the CPU resolution genericSurfaceTensionActive.
//  - Sheeter is NOT stood up as a kind (its neighbourhood
//    supply is solver-side — a WP6 separation, recorded in
//    LAYER1_WP5_IMPL_RECORD).
//
// Pins:
// (a) invariance: the default string matches the phase18
//     pin; the legacy field variant and the field+live
//     variant match their PRE-PHASE-D sha256 captures (the
//     captures were re-pinned at the 第45期統合 to the
//     product-lineage values, verified byte-identical
//     against the product tree v2.26.0); a legacy-only
//     field config never stands the extension
//     (B1 supply bytes, bases 0).
// (b) extension pack: layout offsets, record contents
//     (drag target / crown height+width / falloff ids /
//     predicate + baked gate normalisation), cache turnover
//     on a group-library change.
// (c) shader composition: the ext function defined once and
//     called once (stock + live forms), the extension
//     uniforms declared once, NO new sampler; the tension
//     chunk gated off by default and orderable.
// (d) grid match: the GLSL ext form evaluated in JS over
//     the PACKED column data equals the lib composition
//     (fieldInstanceForce x resolved gate multipliers) on a
//     grid of positions / velocities / attribute values.
// (e) surface tension: the mutual-exclusion resolution and
//     the chunk's JS evaluation against
//     sphSurfaceTensionAkinciForce on a fixed neighbour set.
// (f) source pins: the stage-6 liquid block of the passes
//     and the liquid preamble block keep their sha256 (this
//     phase must not touch either); assets / passes wiring
//     pins. (第45期統合: 液体は杉判断(c)で除外のため、液体
//     ブロックのピンは不在の確認に反転している。)
//
// Run: node scripts/layer1-wp5-field-wiring.test.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.l1wp5d-bundle-${process.pid}.mjs`);

let failures = 0;
let checks = 0;
const check = (name, cond, extra = '') => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}${extra ? ` — ${extra}` : ''}`); }
};
const count = (s, needle) => s.split(needle).length - 1;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const near3 = (a, b, eps = 1e-4) => near(a[0], b[0], eps) && near(a[1], b[1], eps) && near(a[2], b[2], eps);

await build({
  stdin: {
    contents: `
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildVelocityPreamble } from './components/gpgpuShaderSimulationVelocityPreamble.ts';
      export { buildMainForcesFragment, VEL_FRAG_FORCE_CHUNKS } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { getColumnSupply, FIELD_EXT_COLUMN_LAYOUT } from './lib/gpgpuPathAssets.ts';
      export { resolveFieldInstances, fieldInstancesExtended, fieldGroupGateActive, fieldInstanceForce, packFieldGate, resolveFieldGroupGate, columnSectionOffset, FALLOFF_SHAPE_IDS, FIELD_INSTANCE_KIND_IDS } from './lib/gpgpuFieldInstances.ts';
      export { genericSurfaceTensionActive, sphSurfaceTensionAkinciForce } from './lib/gpgpuLifecycle.ts';
      export { groupMembership } from './lib/gpgpuAttributes.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const cfg = (over) => ({ ...M.DEFAULT_CONFIG, ...over });
const samplerCount = (s) => count(s, 'uniform sampler2D') + count(s, 'uniform sampler3D');

// Shared fixtures: a predicate group (band on slot 0) and a
// snapshot group (baked onto slot 3).
const GROUPS_JSON = JSON.stringify([
  { id: 'gpred', name: 'P', source: { kind: 'predicate', predicate: { slot: 0, mode: 'band', low: 0.2, high: 0.8, invert: false } } },
  { id: 'gsnap', name: 'S', source: { kind: 'snapshot', indicesB64: 'AAAA' } },
]);
// Grid config: vortex (linear falloff + predicate gate),
// well (in a baked-gated layer), drag, crown (smoothstep).
const INSTANCES_JSON = JSON.stringify([
  { kind: 'vortex', pos: [10, 0, 0], radius: 50, strength: 1.5, tilt: 0.3, falloff: 'linear', group: 'gpred' },
  { kind: 'well', pos: [-20, 5, 0], radius: 60, strength: 1, softening: 10, orbit: 0.5 },
  { kind: 'drag', pos: [0, 0, 0], radius: 40, strength: 2.5, target: [3, -2, 1] },
  { kind: 'crown', pos: [0, -10, 0], radius: 30, strength: 1.2, height: 50, width: 10, falloff: 'smoothstep' },
]);
const LAYERS_JSON = JSON.stringify([
  { name: 'L', weight: 0.7, slot: -1, members: [2], group: 'gsnap' },
]);
const EXT_CFG = cfg({ gpgpuFieldInstances: INSTANCES_JSON, gpgpuFieldLayers: LAYERS_JSON, gpgpuGroupsData: GROUPS_JSON });

// ── (a) invariance ───────────────────────────────────────
{
  const baseline = JSON.parse(readFileSync(join(ROOT, 'scripts', 'phase18-shader-hash.baseline.json'), 'utf8'));
  check('a SIM_VEL_FRAG matches the phase18 pin (length + sha256)',
    M.SIM_VEL_FRAG.length === baseline.parts.SIM_VEL_FRAG.length
    && sha256(M.SIM_VEL_FRAG) === baseline.parts.SIM_VEL_FRAG.sha256);
  // Re-pinned 2026-11-29 (第45期統合): the pre-Phase-D captures
  // were measured on the layer-1 lineage. In the integrated
  // tree the velocity builder carries the product lineage, and
  // both variants were verified byte-identical to the product
  // tree (v2.26.0) buildVelocityFragment outputs — the pins
  // below are those product-lineage values.
  check('a legacy field variant is byte-identical to its pre-Phase-D capture',
    sha256(M.buildVelocityFragment('', undefined, { fieldInstances: true }))
      === 'eee6915dca09d2a220d666881d187b9aceee80e19ee12193ae2ab9be9e9a1a2e',
    sha256(M.buildVelocityFragment('', undefined, { fieldInstances: true })));
  check('a field+live variant is byte-identical to its pre-Phase-D capture',
    sha256(M.buildVelocityFragment('', undefined, { fieldInstances: true, particleRulesLive: true }))
      === 'e45e9ce43a035f8b0baeaf9ef4ec9ab93217ad1b0df710c9419a3a7ef2a883e9');
  check('a explicit-off options return the shipped string',
    M.buildVelocityFragment('', undefined, { fieldExt: false, surfaceTension: false }) === M.SIM_VEL_FRAG
    && M.buildVelocityFragment('', undefined, {}) === M.SIM_VEL_FRAG);
  check('a default main-forces assembly carries neither new form',
    !M.buildMainForcesFragment().includes('kaloFieldForceExt')
    && !M.buildMainForcesFragment().includes('stCohesion'));
  check('a default config stands neither extension',
    !M.fieldInstancesExtended(M.DEFAULT_CONFIG) && !M.genericSurfaceTensionActive(M.DEFAULT_CONFIG)
    && !M.fieldGroupGateActive(M.DEFAULT_CONFIG));
  // A legacy-only field config: the extension stays down and
  // the supply is B1's, byte for byte.
  const legacyCfg = cfg({ gpgpuFieldInstances: JSON.stringify([{ kind: 'vortex', pos: [1, 2, 3], radius: 40, strength: 1 }]) });
  check('a legacy-only instances do not stand the extension', !M.fieldInstancesExtended(legacyCfg));
  const legacySupply = M.getColumnSupply(legacyCfg);
  check('a legacy supply: B1 layout (256x2), ext bases 0',
    legacySupply !== null && legacySupply.width === 256 && legacySupply.height === 2
    && legacySupply.fieldExtBase === 0 && legacySupply.layerExtBase === 0);
}

// ── (b) extension pack ───────────────────────────────────
{
  check('b ext predicate stands for the grid config', M.fieldInstancesExtended(EXT_CFG));
  check('b gate predicate stands for the grid config', M.fieldGroupGateActive(EXT_CFG));
  check('b layout: earlier offsets unmoved, ext appended (1536 / 1792), height 8',
    M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'fields') === 0
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'layers') === 256
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'pathHeaders') === 512
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'pathPoints') === 768
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'emitters') === 1280
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'fieldExt') === 1536
    && M.columnSectionOffset(M.FIELD_EXT_COLUMN_LAYOUT, 'layerExt') === 1792
    && M.FIELD_EXT_COLUMN_LAYOUT.height === 8);
  check('b kind ids appended (drag 3, crown 4), legacy ids unmoved',
    M.FIELD_INSTANCE_KIND_IDS.vortex === 0 && M.FIELD_INSTANCE_KIND_IDS.well === 1
    && M.FIELD_INSTANCE_KIND_IDS.wind === 2 && M.FIELD_INSTANCE_KIND_IDS.drag === 3
    && M.FIELD_INSTANCE_KIND_IDS.crown === 4);
  const supply = M.getColumnSupply(EXT_CFG);
  check('b supply: ext layout stands (256x8) with both bases',
    supply !== null && supply.width === 256 && supply.height === 8
    && supply.fieldExtBase === 1536 && supply.layerExtBase === 1792
    && supply.fieldsBase === 0 && supply.layersBase === 256 && supply.instanceCount === 4);
  // Read the packed records back out of the supply texture's
  // data (getColumnSupply built it from the same array).
  const data = supply.texture.image.data;
  const texel = (base, i, rec) => {
    const a = (base + i * rec) * 4;
    return [data[a], data[a + 1], data[a + 2], data[a + 3]];
  };
  check('b E0 of the vortex: falloff linear (1), predicate gate (kind 1, slot 0, mode band 2)',
    JSON.stringify(texel(1536, 0, 3)) === JSON.stringify([1, 1, 0, 2]), texel(1536, 0, 3).join(','));
  check('b E1 of the vortex: gate low / high / invert (0.2 / 0.8 / 0)',
    near3(texel(1536 + 1, 0, 3).slice(0, 3), [0.2, 0.8, 0], 1e-6) && texel(1536 + 1, 0, 3)[3] === 0);
  check('b E2 of the drag: the target velocity rides verbatim',
    JSON.stringify(texel(1536 + 2, 2, 3)) === JSON.stringify([3, -2, 1, 0]));
  check('b E2 of the crown: height / width ride (50 / 10)',
    JSON.stringify(texel(1536 + 2, 3, 3)) === JSON.stringify([50, 10, 0, 0]));
  check('b E0 of the crown: falloff smoothstep (2), no gate',
    texel(1536, 3, 3)[0] === 2 && texel(1536, 3, 3)[1] === 0);
  check('b layerExt of the gated layer: baked normalised to (1, slot 3, above 1, 0.5) + (1, 0)',
    JSON.stringify(texel(1792, 0, 2)) === JSON.stringify([1, 3, 1, 0.5])
    && JSON.stringify(texel(1792 + 1, 0, 2)) === JSON.stringify([1, 0, 0, 0]));
  check('b falloff shape ids (smooth 0 / linear 1 / smoothstep 2)',
    M.FALLOFF_SHAPE_IDS.smooth === 0 && M.FALLOFF_SHAPE_IDS.linear === 1 && M.FALLOFF_SHAPE_IDS.smoothstep === 2);
  check('b gate normalisation: unresolved ref packs as no gate',
    M.packFieldGate(M.resolveFieldGroupGate([], 'missing')).kind === 0);
  // Cache: identical config returns the cached supply; a
  // group-library change turns the cache over.
  check('b cache: identical config returns the same supply object', M.getColumnSupply(EXT_CFG) === supply);
  const changed = M.getColumnSupply(cfg({ ...EXT_CFG, gpgpuGroupsData: '[]' }));
  check('b cache: a group-library change rebuilds the supply', changed !== null && changed !== supply);
  check('b with the library gone the gates vanish (extension still stands on the daemon kinds)',
    changed.fieldExtBase === 1536 && !M.fieldGroupGateActive(cfg({ ...EXT_CFG, gpgpuGroupsData: '[]' })));
}

// ── (c) shader composition ───────────────────────────────
{
  const ext = M.buildVelocityFragment('', undefined, { fieldInstances: true, fieldExt: true });
  check('c ext variant: function defined once, called once, B1 call gone',
    count(ext, 'vec3 kaloFieldForceExt(') === 1
    && count(ext, 'vel += kaloFieldForceExt(') === 1
    && !ext.includes('vel += kaloFieldForce('));
  check('c ext variant: extension uniforms declared once each',
    count(ext, 'uniform float uColFieldExtBase;') === 1
    && count(ext, 'uniform float uColLayerExtBase;') === 1
    && count(ext, 'uniform bool  uFieldExtAttrEnabled;') === 1);
  check('c ext variant: no new sampler over the legacy field variant',
    samplerCount(ext) === samplerCount(M.buildVelocityFragment('', undefined, { fieldInstances: true })),
    `${samplerCount(ext)} vs ${samplerCount(M.buildVelocityFragment('', undefined, { fieldInstances: true }))}`);
  const extLive = M.buildVelocityFragment('', undefined, { fieldInstances: true, fieldExt: true, particleRulesLive: true });
  check('c ext+live variant: the live gates reach the ext chunk',
    extLive.includes('kaloFieldForceExt(pos, vel, attrData, replicaSeed, replicaTime, grpWind, grpVortex, grpWell);'));
  const tension = M.buildVelocityFragment('', undefined, { surfaceTension: true });
  check('c tension variant: chunk present once, Akinci uniform declared once, SPH form absent',
    count(tension, 'stCohesion') >= 2 && count(tension, 'uniform float uSphSurfaceTensionAkinci;') === 1
    && !tension.includes('akinciCohesionForce'));
  check('c tension chunk is variant-gated in the assembly',
    !M.buildMainForcesFragment(undefined, {}).includes('stCohesion')
    && M.buildMainForcesFragment(undefined, { surfaceTension: true }).includes('stCohesion'));
  check('c tension chunk is orderable (named first, it assembles first)',
    M.buildMainForcesFragment('surface-tension,wind', { surfaceTension: true }).indexOf('stCohesion')
    < M.buildMainForcesFragment('surface-tension,wind', { surfaceTension: true }).indexOf('uWindEnabled'));
  check('c chunk registry carries the tension chunk text',
    typeof M.VEL_FRAG_FORCE_CHUNKS['surface-tension'] === 'string'
    && M.VEL_FRAG_FORCE_CHUNKS['surface-tension'].includes('stCohesion'));
}

// ── (d) grid match: GLSL ext form (JS evaluation over the
// packed column data) vs the lib composition ─────────────
{
  const supply = M.getColumnSupply(EXT_CFG);
  const data = supply.texture.image.data;
  const res = M.resolveFieldInstances(EXT_CFG);
  const fetch4 = (texelIdx) => {
    const a = texelIdx * 4;
    return [data[a], data[a + 1], data[a + 2], data[a + 3]];
  };
  const shapeFalloff = (shapeId, dist, radius) => {
    if (shapeId > 1.5) {
      const q = Math.min(1, Math.max(0, dist / Math.max(radius, 0.000001)));
      const t = q * q * (3 - 2 * q);
      return 1 - t;
    }
    if (shapeId > 0.5) return Math.min(1, Math.max(0, 1 - dist / Math.max(radius, 0.000001)));
    const fq = dist / radius;
    const f = 1 - fq * fq;
    return f * f;
  };
  // The gate record spans E0/E1 (instance) and L0/L1 (layer);
  // reassemble (kind, slot, mode, low, high, invert) per side.
  const instGate = (i) => {
    const e0 = fetch4(1536 + i * 3);
    const e1 = fetch4(1536 + i * 3 + 1);
    return [e0[1], e0[2], e0[3], e1[0], e1[1], e1[2]];
  };
  const layerGate = (j) => {
    const l0 = fetch4(1792 + j * 2);
    const l1 = fetch4(1792 + j * 2 + 1);
    return [l0[0], l0[1], l0[2], l0[3], l1[0], l1[1]];
  };
  const gateEval = (g, attr) => (g[0] < 0.5
    ? 1
    : M.groupMembership(attr[Math.round(g[1])], ['below', 'above', 'band'][Math.round(g[2])], g[3], g[4], g[5] > 0.5));
  // JS transcription of kaloFieldForceExt (gust = 0, gates
  // grp* = 1, attribute-enabled), reading ONLY the pack.
  const evalExt = (pos, vel, attr, delta) => {
    const acc = [0, 0, 0];
    for (let i = 0; i < res.instances.length; i++) {
      const fA = fetch4(0 + i * 3);
      const fB = fetch4(0 + i * 3 + 1);
      const fC = fetch4(0 + i * 3 + 2);
      const fE0 = fetch4(1536 + i * 3);
      const fE1 = fetch4(1536 + i * 3 + 1);
      const fE2 = fetch4(1536 + i * 3 + 2);
      const kind = Math.round(fC[0]);
      let layerW = 1;
      let lGate = 1;
      if (fC[3] > 0.5) {
        const fL = fetch4(256 + (fC[3] - 1));
        layerW = fL[0];
        lGate = gateEval(layerGate(fC[3] - 1), attr);
      }
      const gMult = lGate * gateEval(instGate(i), attr);
      const rel = [pos[0] - fA[0], pos[1] - fA[1], pos[2] - fA[2]];
      if (kind === 4) {
        if (fA[3] > 0 && fE2[0] > 0) {
          const cy = rel[1];
          if (cy >= 0 && cy < fE2[0]) {
            const rho = Math.hypot(rel[0], rel[2]);
            const cw = fE2[1] > 0 ? fE2[1] : fA[3] * 0.5;
            const rq = (rho - fA[3]) / cw;
            const ring = Math.exp(-rq * rq);
            const wgt = ring * shapeFalloff(fE0[0], cy, fE2[0]) * layerW * gMult;
            if (wgt > 0) {
              const ox = rho > 1e-9 ? rel[0] / rho : 0;
              const oz = rho > 1e-9 ? rel[2] / rho : 0;
              const len = Math.hypot(ox, 1, oz) || 1;
              const s = (fB[3] * wgt * delta * 30) / len;
              acc[0] += ox * s; acc[1] += s; acc[2] += oz * s;
            }
          }
        }
        continue;
      }
      const dist = Math.hypot(rel[0], rel[1], rel[2]);
      if (fA[3] <= 0 || dist >= fA[3]) continue;
      const fFall = shapeFalloff(fE0[0], dist, fA[3]);
      const wgt = fFall * layerW * gMult;
      if (kind === 0) {
        const t = [
          fB[1] * rel[2] - fB[2] * rel[1],
          fB[2] * rel[0] - fB[0] * rel[2],
          fB[0] * rel[1] - fB[1] * rel[0],
        ];
        const tl = Math.hypot(t[0], t[1], t[2]);
        if (tl > 0.001) {
          const s = (fB[3] * wgt * delta * 80) / tl;
          acc[0] += t[0] * s; acc[1] += t[1] * s; acc[2] += t[2] * s;
        }
      } else if (kind === 1) {
        const d = Math.max(dist + fC[1], 0.001);
        const pull = (fB[3] * wgt * delta * 2000) / (d * d);
        acc[0] += -rel[0] * pull; acc[1] += -rel[1] * pull; acc[2] += -rel[2] * pull;
        const nLen = Math.hypot(-rel[0] + 0.001, -rel[1], -rel[2]) || 1;
        const n = [(-rel[0] + 0.001) / nLen, -rel[1] / nLen, -rel[2] / nLen];
        const os = fC[2] * wgt * delta * 50;
        acc[0] += -n[2] * os; acc[2] += n[0] * os;
      } else if (kind === 3) {
        const rate = Math.min(100, Math.max(0, fB[3]));
        const k = 1 - Math.exp(-rate * fFall * delta);
        const s = k * layerW * gMult;
        acc[0] += (fE2[0] - vel[0]) * s; acc[1] += (fE2[1] - vel[1]) * s; acc[2] += (fE2[2] - vel[2]) * s;
      } else {
        const s = wgt * delta * 30;
        acc[0] += fB[0] * fB[3] * s; acc[1] += fB[1] * fB[3] * s; acc[2] += fB[2] * fB[3] * s;
      }
    }
    return acc;
  };
  // The lib composition: fieldInstanceForce per instance
  // (layer weight from the layer record), times the resolved
  // gate multipliers evaluated per particle.
  const defs = [
    { id: 'gpred', name: 'P', source: { kind: 'predicate', predicate: { slot: 0, mode: 'band', low: 0.2, high: 0.8, invert: false } } },
    { id: 'gsnap', name: 'S', source: { kind: 'snapshot', indicesB64: 'AAAA' } },
  ];
  const libGate = (ref, attr) => {
    const g = M.resolveFieldGroupGate(defs, ref);
    if (g.kind === 'predicate') {
      const p = g.predicate;
      return M.groupMembership(attr[p.slot], p.mode, p.low, p.high, p.invert);
    }
    if (g.kind === 'baked') return M.groupMembership(attr[3], 'above', 0.5, 1, false);
    return 1;
  };
  const evalLib = (pos, vel, attr, delta) => {
    const acc = [0, 0, 0];
    res.instances.forEach((inst, i) => {
      const layer = inst.layerIndex >= 0 ? res.layers[inst.layerIndex] : null;
      const layerWeight = layer ? layer.weight : 1;
      const dv = M.fieldInstanceForce(inst, layerWeight, pos, delta, [0, 0, 0], vel);
      const gMult = libGate(inst.group, attr) * (layer ? libGate(layer.group, attr) : 1);
      acc[0] += dv[0] * gMult; acc[1] += dv[1] * gMult; acc[2] += dv[2] * gMult;
    });
    return acc;
  };
  let gridOk = true;
  let gridDetail = '';
  const positions = [
    [20, 0, 0], [10, 10, 5], [-10, 5, 0], [-20, 5, 30], [0, 0, 0], [5, -5, 5],
    [30, 20, -10], [0, 30, 0], [0, -10, 30], [15, -10, 15], [100, 0, 0], [-60, 5, 0],
  ];
  const vels = [[0, 0, 0], [5, -3, 2], [-10, 10, 0]];
  const attrs = [[0.5, 0, 0, 1], [0.1, 0, 0, 1], [0.5, 0, 0, 0], [0.9, 0, 0, 0.7]];
  for (const pos of positions) {
    for (const vel of vels) {
      for (const attr of attrs) {
        const a = evalExt(pos, vel, attr, 0.016);
        const b = evalLib(pos, vel, attr, 0.016);
        if (!near3(a, b, 1e-3)) { gridOk = false; gridDetail = `pos=${pos} vel=${vel} attr=${attr}: ${a} vs ${b}`; }
      }
    }
  }
  check('d grid: GLSL ext evaluation == lib composition (12 pos x 3 vel x 4 attr)', gridOk, gridDetail);
  check('d grid exercised the gates (a gated-off attribute value zeroes the vortex + the layered well)',
    (() => {
      const on = evalLib([20, 0, 0], [0, 0, 0], [0.5, 0, 0, 1], 0.016);
      const off = evalLib([20, 0, 0], [0, 0, 0], [0.1, 0, 0, 0], 0.016);
      return Math.hypot(...on) > 0 && Math.hypot(...off) < Math.hypot(...on);
    })());
}

// ── (e) surface tension ──────────────────────────────────
{
  check('e mutual exclusion: generic stands only with SPH off and strength on',
    M.genericSurfaceTensionActive(cfg({ gpgpuSphSurfaceTensionAkinci: 1.5, gpgpuSphEnabled: false }))
    && !M.genericSurfaceTensionActive(cfg({ gpgpuSphSurfaceTensionAkinci: 1.5, gpgpuSphEnabled: true }))
    && !M.genericSurfaceTensionActive(cfg({ gpgpuSphSurfaceTensionAkinci: 0, gpgpuSphEnabled: false })));
  // JS transcription of the chunk over a fixed neighbour
  // set (the stride subsample covers every texel here).
  const evalChunk = (self, neighbours, h, strength, delta) => {
    const coh = [0, 0, 0];
    const grad = [0, 0, 0];
    let lap = 0;
    const h2 = h * h;
    for (const o of neighbours) {
      const r = [self[0] - o[0], self[1] - o[1], self[2] - o[2]];
      const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
      if (r2 < h2 && r2 > 0.001) {
        const q = Math.sqrt(r2) / h;
        const w = Math.max(0, 1 - q * q);
        const rl = Math.sqrt(r2);
        const omq = 1 - q;
        let kA = omq * omq * omq * q * q * q;
        if (q <= 0.5) kA = 2.0 * kA - 0.015625;
        coh[0] += ((o[0] - self[0]) / rl) * (kA * 32);
        coh[1] += ((o[1] - self[1]) / rl) * (kA * 32);
        coh[2] += ((o[2] - self[2]) / rl) * (kA * 32);
        grad[0] += (-2.0 * r[0]) / h2; grad[1] += (-2.0 * r[1]) / h2; grad[2] += (-2.0 * r[2]) / h2;
        lap += (-6.0 / h2) * w;
      }
    }
    const gl = Math.hypot(grad[0], grad[1], grad[2]);
    const gate = Math.min(1, Math.max(0, gl * h * 0.25));
    const kappa = gl > 0.000001 ? -lap / gl : 0;
    const scale = gl > 0.000001 ? kappa * gl * gate * gate * 8.0 : 0;
    const sum = [
      coh[0] + (gl > 0.000001 ? (grad[0] / gl) * scale : 0),
      coh[1] + (gl > 0.000001 ? (grad[1] / gl) * scale : 0),
      coh[2] + (gl > 0.000001 ? (grad[2] / gl) * scale : 0),
    ];
    const sl = Math.hypot(sum[0], sum[1], sum[2]);
    const capped = sl > 3.0 ? sum.map((v) => v * (3.0 / sl)) : sum;
    return capped.map((v) => v * strength * delta * 1.0);
  };
  const neighbours = [
    [0, 0, 0], [8, 0, 0], [-8, 3, 0], [0, 9, -4], [5, 5, 5], [-3, -7, 6], [20, 0, 0], [0, 0, 25],
  ];
  let tensionOk = true;
  let tensionDetail = '';
  for (const self of [[0, 0, 0], [4, 1, -2], [30, 0, 0]]) {
    for (const [h, strength] of [[40, 1.5], [15, 3.0], [10, 0.5]]) {
      const a = evalChunk(self, neighbours, h, strength, 0.016);
      const twin = M.sphSurfaceTensionAkinciForce(
        { x: self[0], y: self[1], z: self[2] },
        neighbours.map((p) => ({ pos: { x: p[0], y: p[1], z: p[2] } })),
        h, strength,
      );
      const b = [twin.x * strength * 0.016, twin.y * strength * 0.016, twin.z * strength * 0.016];
      if (!near3(a, b, 1e-3)) { tensionOk = false; tensionDetail = `self=${self} h=${h} s=${strength}: ${a} vs ${b}`; }
    }
  }
  check('e grid: chunk evaluation == sphSurfaceTensionAkinciForce x strength x delta', tensionOk, tensionDetail);
}

// ── (f) source pins ──────────────────────────────────────
{
  const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  // 第45期統合: 液体は杉判断(c)で除外 — the stage-6 liquid
  // block is not part of this tree. Its sha256/position checks
  // are replaced by absence pins; the field supply additions
  // themselves stand (checked here and below).
  const liquidStart = passes.lastIndexOf(' // Liquid solver (Limit plan stage 6, L1-2)');
  check('f passes: no stage-6 liquid block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    liquidStart === -1);
  check('f passes: the field supply additions are present (uColFieldExtBase supply stands)',
    passes.indexOf('uColFieldExtBase') > -1);
  // Pin updated 2026-11-28 (Layer 1 WP9 phase D: the
  // condition gained the local-time consumer after the
  // field gate consumer — the field gate term itself is
  // unchanged, the line now ends with the local-time term).
  check('f passes: uAttrEnabled gains the field gate consumer',
    passes.includes('|| fieldGroupGateActive(config) || localTime.active);'));
  // 第45期統合: 液体は杉判断(c)で除外 — the preamble builder
  // in this tree has no liquid segment at all (the liquidSolver
  // option stands nothing), so the pin becomes an absence pin.
  check('f preamble: no liquid control block in this tree (第45期統合: 液体は杉判断(c)で除外)',
    !M.buildVelocityPreamble({ liquidSolver: true }).includes('Liquid solver')
    && !M.buildVelocityPreamble().includes('Liquid solver'));
  check('f preamble: fieldExt set splices after the field set, stock carries none of it',
    M.buildVelocityPreamble({ fieldInstances: true, fieldExt: true }).includes('uniform float uColFieldExtBase;')
    && !M.buildVelocityPreamble().includes('uColFieldExtBase')
    && !M.buildVelocityPreamble({ surfaceTension: true }).includes('uColFieldExtBase')
    && count(M.buildVelocityPreamble({ surfaceTension: true }), 'uniform float uSphSurfaceTensionAkinci;') === 1);
  const assets = readFileSync(join(ROOT, 'components', 'useGpgpuSimulationAssets.ts'), 'utf8');
  // Pin updated 2026-11-29 (Layer 1 WP11 phase C added config.glslSharedSnippets
  // to this dependency array; the field-ext entries themselves are unchanged).
  check('f assets: variant resolution + uniform entries wired',
    assets.includes('fieldExt: fieldInstancesExtended(config)')
    && assets.includes('surfaceTension: genericSurfaceTensionActive(config)')
    && assets.includes('uColFieldExtBase:      { value: 0 }')
    && assets.includes('config.gpgpuSphSurfaceTensionAkinci, config.glslSharedSnippets, gl, velSimMat]'));
}

console.log(`\n${checks} checks, ${failures} failures`);
console.log(failures === 0 ? 'ALL PASS' : 'FAILURES PRESENT');
process.exit(failures === 0 ? 0 : 1);
