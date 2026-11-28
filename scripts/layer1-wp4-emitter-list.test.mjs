#!/usr/bin/env node
// layer1-wp4-emitter-list.test.mjs — Layer 1 WP4 phase D1:
// the emitter list (lib/gpgpuEmitterList.ts + the
// gpgpuEmitters key + the bake generalisation in
// lib/gpgpuInitialData.ts).
//
// Until this phase the emitter was a singleton: one shape /
// transform / velocity law for the whole pool. The list
// authors up to 8 emitters in one JSON key; while it names
// a valid element it REPLACES the single emitter, and each
// particle is born from the emitter a dedicated hash
// (offset 17.17, 9.43 — not the spawn / event / lifetime
// hashes) assigns to it, walked against weight bands.
//
// Pins:
// (a) parse tolerance: malformed data resolves to "no
//     list"; non-objects and unknown shapes are skipped;
//     numbers fall back per field (with the single
//     emitter's clamps); the list caps at 8.
// (b) serialise round-trip: parse -> serialize -> parse is
//     a fixed point; an empty list serialises to ''.
// (c) conversion: emitterDefToListElement carries the
//     legacy single def into an element whose resolution
//     is that same def.
// (d) assignment: band endpoints are strict (cumWeightEnd
//     > hash), a weight-0 element is never selected, an
//     all-zero weight list falls back to equal shares,
//     weightFromLight multiplies by the unit intensity,
//     and a full pool's measured shares track the weights.
//     Hash draws are pinned to exact values and the index
//     form equals the UV form at the texel centre.
// (e) bake identity: routing the FALLBACK resolution (an
//     unauthored config) and an EQUIVALENT single-element
//     list (a non-trivial single config: light shape on
//     unit 2, active transform, directed velocity) through
//     GpgpuEmitOptions.emitterList reproduces the legacy
//     bake arrays bit for bit (sha256 over pos + vel).
// (f) two-element bake: every particle lands inside its
//     own emitter's ball (disjoint centres), the directed
//     emitter's particles carry exactly
//     directedInitialVelocity's output, and both emitters
//     receive births.
// (g) column pack: the emitters section appends after the
//     path sections at texel 1280 without moving any
//     earlier offset; record texels carry the design's
//     layout; the full pack is sha256-pinned.
// (h) key registration: gpgpuEmitters is in the recorded
//     fingerprint set (1,683 keys at this phase's landing;
//     the count pin below was re-recorded to 1,687 on
//     2026-11-28 when Layer 1 WP7 Phase C1 added the four
//     gpgpuSplat* keys), DEFAULT_CONFIG carries
//     it as '', and normalizeConfig round-trips it.
//
// Run: node scripts/layer1-wp4-emitter-list.test.mjs

import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const near = (a, b, eps = 1e-12) => Math.abs(a - b) <= eps;
const arrEq = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((v, i) => v === b[i]);
const sha = (arr) => createHash('sha256')
  .update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');

async function load(rel) {
  const out = await build({
    entryPoints: [join(ROOT, rel)], bundle: true, format: 'esm',
    write: false, logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

const EL = await load('lib/gpgpuEmitterList.ts');
const EM = await load('lib/gpgpuEmitter.ts');
const ID = await load('lib/gpgpuInitialData.ts');
const LU = await load('lib/gpgpuLightUnits.ts');
const LC = await load('lib/gpgpuLifecycle.ts');
const D = await load('lib/appStateConfigDefaults.ts');
const BASE = D.DEFAULT_CONFIG;

// ---- (a) parse tolerance ----------------------------------------------
check('parse: empty / junk / non-array resolves to no list',
  EL.parseEmitterList('').length === 0
  && EL.parseEmitterList(undefined).length === 0
  && EL.parseEmitterList('not json').length === 0
  && EL.parseEmitterList('{}').length === 0
  && EL.parseEmitterList('[]').length === 0);
check('parse: non-objects and unknown shapes are skipped',
  EL.parseEmitterList('[1, "x", null, {"shape":"blob"}, {"shape":"disc"}]').length === 1
  && EL.parseEmitterList('[1, "x", null, {"shape":"blob"}, {"shape":"disc"}]')[0].shape === 'disc');
{
  const many = JSON.stringify(Array.from({ length: 10 }, () => ({ shape: 'sphere' })));
  check('parse: list caps at EMITTER_LIST_MAX (8)', EL.parseEmitterList(many).length === 8);
}
{
  const [el] = EL.parseEmitterList('[{"shape":"sphere"}]');
  check('parse: field defaults mirror the single emitter',
    el.respawnShape === 'auto' && arrEq(el.pos, [0, 0, 0]) && arrEq(el.rot, [0, 0, 0])
    && el.scale === 1 && el.velMode === 'cube' && arrEq(el.velDir, [0, 1, 0])
    && el.velSpeed === 2 && el.velSpread === 0.5 && el.weight === 1
    && el.lightUnit === 1 && el.weightFromLight === false);
}
{
  const [el] = EL.parseEmitterList(JSON.stringify([{
    shape: 'box', respawnShape: 'junk', pos: [null, 'a', {}], scale: 'x',
    velMode: 'junk', velSpeed: 999, velSpread: -1, weight: -3, lightUnit: 99,
    weightFromLight: 1,
  }]));
  check('parse: bad fields fall back / clamp per field',
    el.respawnShape === 'auto' && arrEq(el.pos, [0, 0, 0]) && el.scale === 1
    && el.velMode === 'cube' && el.velSpeed === 50 && el.velSpread === 0
    && el.weight === 0 && el.lightUnit === 4 && el.weightFromLight === false);
  const [el2] = EL.parseEmitterList('[{"shape":"box","weight":"x","lightUnit":0}]');
  check('parse: non-number weight falls back to 1, lightUnit 0 clamps to 1',
    el2.weight === 1 && el2.lightUnit === 1);
}

// ---- (b) serialise round-trip ------------------------------------------
{
  const authored = JSON.stringify([
    { shape: 'cone', respawnShape: 'disc', pos: [1, 2, 3], rot: [10, 20, 30], scale: 2, velMode: 'directed', velDir: [0, 0, 2], velSpeed: 5, velSpread: 0.25, weight: 2, lightUnit: 3, weightFromLight: true },
    { shape: 'light' },
  ]);
  const once = EL.parseEmitterList(authored);
  const twice = EL.parseEmitterList(EL.serializeEmitterList(once));
  check('serialize: parse -> serialize -> parse is a fixed point',
    JSON.stringify(once) === JSON.stringify(twice));
  check('serialize: empty list is the empty string', EL.serializeEmitterList([]) === '');
}

// ---- (c) conversion ------------------------------------------------------
const SINGLE_CFG = {
  ...BASE,
  gpgpuEmitShape: 'light', gpgpuRespawnShape: 'disc',
  gpgpuEmitLightUnit: 2,
  gpgpuLight2Enabled: true, gpgpuLight2PosX: 3, gpgpuLight2PosY: -2, gpgpuLight2PosZ: 5,
  gpgpuEmitterPosX: 1, gpgpuEmitterPosY: 2, gpgpuEmitterPosZ: 3,
  gpgpuEmitterRotX: 15, gpgpuEmitterRotY: 0, gpgpuEmitterRotZ: 40, gpgpuEmitterScale: 1.5,
  gpgpuEmitterVelMode: 'directed', gpgpuEmitterVelDirX: 0, gpgpuEmitterVelDirY: 0, gpgpuEmitterVelDirZ: 2,
  gpgpuEmitterVelSpeed: 5, gpgpuEmitterVelSpread: 0.25,
};
{
  const el = EL.emitterDefToListElement(SINGLE_CFG);
  check('conversion: element carries the single def',
    el.shape === 'light' && el.respawnShape === 'disc'
    && arrEq(el.pos, [1, 2, 3]) && arrEq(el.rot, [15, 0, 40]) && el.scale === 1.5
    && el.velMode === 'directed' && arrEq(el.velDir, [0, 0, 2])
    && el.velSpeed === 5 && el.velSpread === 0.25
    && el.weight === 1 && el.lightUnit === 2 && el.weightFromLight === false);
  const listCfg = { ...SINGLE_CFG, gpgpuEmitters: EL.serializeEmitterList([el]) };
  const res = EL.resolveEmitterList(listCfg);
  check('conversion: the element resolves to the single def verbatim',
    res.listAuthored === true && res.emitters.length === 1
    && JSON.stringify(res.emitters[0].def) === JSON.stringify(EM.resolveEmitterDef(SINGLE_CFG))
    && res.emitters[0].cumWeightEnd === 1 && res.emitters[0].share === 1);
  const fb = EL.resolveEmitterList(SINGLE_CFG);
  check('resolution: unauthored config falls back to the single def',
    fb.listAuthored === false && fb.emitters.length === 1
    && JSON.stringify(fb.emitters[0].def) === JSON.stringify(EM.resolveEmitterDef(SINGLE_CFG)));
}

// ---- (d) assignment ------------------------------------------------------
{
  const cfg = { ...BASE, gpgpuEmitters: JSON.stringify([{ shape: 'sphere', weight: 1 }, { shape: 'disc', weight: 3 }]) };
  const res = EL.resolveEmitterList(cfg);
  check('bands: cumWeightEnd for weights [1, 3]',
    res.emitters[0].cumWeightEnd === 0.25 && res.emitters[1].cumWeightEnd === 1);
  check('bands: the walk is strict (cumWeightEnd > hash)',
    EL.emitterIndexForHash(res.emitters, 0) === 0
    && EL.emitterIndexForHash(res.emitters, 0.2499) === 0
    && EL.emitterIndexForHash(res.emitters, 0.25) === 1
    && EL.emitterIndexForHash(res.emitters, 0.999) === 1);
  let n0 = 0;
  const N = 128 * 128;
  for (let i = 0; i < N; i++) if (EL.emitterIndexForIndex(res.emitters, i, 128) === 0) n0++;
  check('bands: measured share tracks the weight within 0.01', Math.abs(n0 / N - 0.25) < 0.01);
}
{
  const cfg = { ...BASE, gpgpuEmitters: JSON.stringify([{ shape: 'sphere', weight: 0 }, { shape: 'disc', weight: 1 }]) };
  const res = EL.resolveEmitterList(cfg);
  let allOne = true;
  for (let i = 0; i < 64 * 64; i++) if (EL.emitterIndexForIndex(res.emitters, i, 64) !== 1) { allOne = false; break; }
  check('bands: a weight-0 element is never selected', allOne && res.emitters[0].cumWeightEnd === 0);
}
{
  const cfg = { ...BASE, gpgpuEmitters: JSON.stringify([{ shape: 'sphere', weight: 0 }, { shape: 'disc', weight: 0 }]) };
  const res = EL.resolveEmitterList(cfg);
  check('bands: all-zero weights fall back to equal shares',
    res.emitters[0].share === 0.5 && res.emitters[0].cumWeightEnd === 0.5 && res.emitters[1].cumWeightEnd === 1);
}
{
  const cfg = {
    ...BASE,
    gpgpuLight2Intensity: 3,
    gpgpuEmitters: JSON.stringify([
      { shape: 'sphere', weight: 2, lightUnit: 2, weightFromLight: true },
      { shape: 'disc', weight: 1 },
    ]),
  };
  const res = EL.resolveEmitterList(cfg);
  check('bands: weightFromLight multiplies by the unit intensity',
    res.emitters[0].weight === 6 && near(res.emitters[0].share, 6 / 7) && near(res.emitters[1].share, 1 / 7));
}
check('hash pin: index 0 @128', EL.emitterHashForIndex(0, 128) === 0.6130138033558978);
check('hash pin: index 1 @128', EL.emitterHashForIndex(1, 128) === 0.48113236396966386);
check('hash pin: index 42 @128', EL.emitterHashForIndex(42, 128) === 0.021828703861501708);
check('hash pin: index 12345 @128', EL.emitterHashForIndex(12345, 128) === 0.08908009875631251);
check('hash pin: uv (0.5, 0.5)', EL.emitterHashForUv(0.5, 0.5) === 0.8017230072955499);
{
  const size = 128;
  const idx = 1234;
  const u = ((idx % size) + 0.5) / size;
  const v = (Math.floor(idx / size) + 0.5) / size;
  check('hash: index form equals UV form at texel centre',
    EL.emitterHashForIndex(idx, size) === EL.emitterHashForUv(u, v));
}
check('hash: decorrelated from the spawn / event / lifetime draws',
  EL.emitterHashForIndex(42, 128) !== LC.spawnHashForIndex(42, 128)
  && EL.emitterHashForIndex(42, 128) !== LC.spawnEventHashForIndex(42, 128)
  && EL.emitterHashForIndex(42, 128) !== LC.ageJitterHashForIndex(42, 128));

// ---- (e) bake identity ----------------------------------------------------
{
  const res = EL.resolveEmitterList(BASE);
  const legacy = ID.buildGpgpuInitialData(32, BASE.gpgpuBounceRadius, BASE.gpgpuEmitShape, BASE.gpgpuSeed, BASE.gpgpuAgeMax, null, null);
  const listed = ID.buildGpgpuInitialData(32, BASE.gpgpuBounceRadius, BASE.gpgpuEmitShape, BASE.gpgpuSeed, BASE.gpgpuAgeMax, null, { emitterList: res.emitters });
  check('bake identity: fallback resolution reproduces the default bake bit for bit',
    sha(legacy.posData) === sha(listed.posData) && sha(legacy.velData) === sha(listed.velData));
}
{
  const el = EL.emitterDefToListElement(SINGLE_CFG);
  const listCfg = { ...SINGLE_CFG, gpgpuEmitters: EL.serializeEmitterList([el]) };
  const res = EL.resolveEmitterList(listCfg);
  const legacy = ID.buildGpgpuInitialData(32, SINGLE_CFG.gpgpuBounceRadius, SINGLE_CFG.gpgpuEmitShape, SINGLE_CFG.gpgpuSeed, SINGLE_CFG.gpgpuAgeMax, null, {
    lightPos: LU.resolveEmitLightPos(SINGLE_CFG),
    transform: EM.resolveEmitterTransform(SINGLE_CFG),
    initialVelocity: {
      dir: EM.resolveEmitterBaseDirection(SINGLE_CFG),
      speed: EM.clampEmitterVelSpeed(SINGLE_CFG.gpgpuEmitterVelSpeed),
      spread: EM.clampEmitterVelSpread(SINGLE_CFG.gpgpuEmitterVelSpread),
    },
  });
  const listed = ID.buildGpgpuInitialData(32, SINGLE_CFG.gpgpuBounceRadius, SINGLE_CFG.gpgpuEmitShape, SINGLE_CFG.gpgpuSeed, SINGLE_CFG.gpgpuAgeMax, null, { emitterList: res.emitters });
  check('bake identity: equivalent single-element list reproduces the non-trivial bake bit for bit',
    sha(legacy.posData) === sha(listed.posData) && sha(legacy.velData) === sha(listed.velData));
}

// ---- (f) two-element bake ---------------------------------------------------
{
  const size = 32;
  const radius = 2;
  const cfg = {
    ...BASE,
    gpgpuEmitters: JSON.stringify([
      { shape: 'sphere', pos: [100, 0, 0], weight: 1 },
      { shape: 'sphere', pos: [-100, 0, 0], velMode: 'directed', velDir: [0, 1, 0], velSpeed: 3, velSpread: 0, weight: 1 },
    ]),
  };
  const res = EL.resolveEmitterList(cfg);
  const data = ID.buildGpgpuInitialData(size, radius, 'sphere', 7, 8, null, { emitterList: res.emitters });
  const centres = [[100, 0, 0], [-100, 0, 0]];
  const counts = [0, 0];
  let placed = true;
  let velocities = true;
  for (let i = 0; i < size * size; i++) {
    const k = EL.emitterIndexForIndex(res.emitters, i, size);
    counts[k] += 1;
    const px = data.posData[i * 4];
    const py = data.posData[i * 4 + 1];
    const pz = data.posData[i * 4 + 2];
    const own = Math.hypot(px - centres[k][0], py - centres[k][1], pz - centres[k][2]);
    const other = Math.hypot(px - centres[1 - k][0], py - centres[1 - k][1], pz - centres[1 - k][2]);
    if (!(own <= radius + 1e-4 && other > 50)) placed = false;
    const vx = data.velData[i * 4];
    const vy = data.velData[i * 4 + 1];
    const vz = data.velData[i * 4 + 2];
    if (k === 1) {
      const u = ((i % size) + 0.5) / size;
      const v = (Math.floor(i / size) + 0.5) / size;
      const dv = LC.directedInitialVelocity({ x: 0, y: 1, z: 0 }, u, v, 3, 0);
      if (!(vx === dv.x && vy === dv.y && vz === dv.z)) velocities = false;
    } else if (!(Math.abs(vx) <= 2 && Math.abs(vy) <= 2 && Math.abs(vz) <= 2)) {
      velocities = false;
    }
  }
  check('two-element bake: every particle lands in its own emitter ball', placed);
  check('two-element bake: directed particles carry the exact directed velocity, cube particles stay in the cube', velocities);
  check('two-element bake: both emitters receive births', counts[0] > 0 && counts[1] > 0);
}

// ---- (g) column pack ---------------------------------------------------------
{
  const cfg = {
    ...BASE,
    gpgpuLight2Enabled: true, gpgpuLight2PosX: 5, gpgpuLight2PosY: 6, gpgpuLight2PosZ: 7, gpgpuLight2Intensity: 2.5,
    gpgpuEmitters: JSON.stringify([
      { shape: 'cone', respawnShape: 'disc', pos: [1, 2, 3], rot: [10, 20, 30], scale: 2, velMode: 'directed', velDir: [0, 0, 2], velSpeed: 5, velSpread: 0.25, weight: 1, lightUnit: 1 },
      { shape: 'light', pos: [-4, 0, 4], weight: 3, lightUnit: 2 },
    ]),
  };
  const res = EL.resolveEmitterList(cfg);
  const layout = EL.EMITTER_COLUMN_LAYOUT;
  const offsets = Object.fromEntries(layout.sections.map((s) => [s.id, s.offsetTexel]));
  check('pack: sections append without moving earlier offsets',
    offsets.fields === 0 && offsets.layers === 256 && offsets.pathHeaders === 512
    && offsets.pathPoints === 768 && offsets.emitters === 1280);
  check('pack: requests append the emitters section after the path sections',
    EL.EMITTER_COLUMN_REQUESTS[EL.EMITTER_COLUMN_REQUESTS.length - 1].id === 'emitters'
    && EL.EMITTER_COLUMN_REQUESTS[EL.EMITTER_COLUMN_REQUESTS.length - 1].texels === 56);
  const data = new Float32Array(layout.width * layout.height * 4);
  const pack = EL.packEmitterColumnData(data, layout, res);
  check('pack: base and count', pack.emittersBase === 1280 && pack.emitterCount === 2);
  const b = pack.emittersBase * 4;
  check('pack: T0 carries pos + cumWeightEnd',
    data[b] === 1 && data[b + 1] === 2 && data[b + 2] === 3 && data[b + 3] === 0.25);
  check('pack: T1 carries shapeId (cone = 5)', data[b + 7] === 5);
  check('pack: T5 carries spread / weight / respawnShapeId (disc = 1)',
    data[b + 20] === 0.25 && data[b + 21] === 1 && data[b + 22] === 1 && data[b + 23] === 0);
  check('pack: second record T0 / T6 carry pos, band end and the unit-2 light pos',
    data[b + 28] === -4 && data[b + 30] === 4 && data[b + 31] === 1
    && data[b + 52] === 5 && data[b + 53] === 6 && data[b + 54] === 7);
  check('pack: full array sha256 pin',
    sha(data) === 'e223deeb74e0cf9a23b4d952d6e3a4c1655b57d90421d7d67c1558dc926c5dad');
}

// ---- (h) key registration ------------------------------------------------------
{
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts', 'validate-keys.fingerprint.json'), 'utf8'));
  check('fingerprint record contains gpgpuEmitters', record.keys.includes('gpgpuEmitters'));
  // Pin re-recorded 2026-11-28 (Layer 1 WP7 Phase C1 added
  // the four gpgpuSplat* keys; 1,683 -> 1,687). The intent —
  // the record is self-consistent and this phase's key is
  // registered — is unchanged.
  // Re-pinned again 2026-11-28 (WP7 Phase C2 added the two
  // splat supply keys gpgpuSplatScaleAttr / gpgpuSplatOpacityAttr;
  // 1,687 -> 1,689).
  // Re-pinned again 2026-11-28 (WP7 Phase B added the two
  // lighting keys gpgpuShadowMapLightUnit /
  // gpgpuLightVolumeDepthIntersect; 1,689 -> 1,691).
  // Re-pinned again 2026-11-28 (WP7 Phase D added the two
  // density keys gpgpuLightVolumeDensity /
  // postShineDensityLayers; 1,691 -> 1,693).
  // Re-pinned again 2026-11-28 (WP8 Phase D added the
  // deform stack key gpgpuEmitDeform; 1,693 -> 1,694).
  // Re-pinned again 2026-11-28 (WP9 Phase C added the two
  // track/modulation keys sequenceTracks / modulationSetup;
  // 1,694 -> 1,696).
  // Re-pinned again 2026-11-28 (WP9 Phase D added the
  // local-time key gpgpuLocalTimeGroups; 1,696 -> 1,697).
  // Re-pinned again 2026-11-28 (WP11 Phase B added the six
  // script-bake keys gpgpuScript*; 1,697 -> 1,703).
  // Re-pinned again 2026-11-28 (WP11 Phase C added
  // glslSharedSnippets and the six replacement keys;
  // 1,703 -> 1,710).
  // Re-pinned again 2026-11-29 (第45期統合の固定値;
  // 1,710 -> 1,738).
  check('fingerprint record keyCount is 1,738', record.keyCount === 1738 && record.keyCount === record.keys.length);
}
{
  check('DEFAULT_CONFIG.gpgpuEmitters defaults to the empty string', BASE.gpgpuEmitters === '');
  const N = await load('lib/appStateConfigNormalization.ts');
  check('normalizeConfig fills the default empty string', N.normalizeConfig({}).gpgpuEmitters === '');
  check('normalizeConfig preserves an authored list',
    N.normalizeConfig({ gpgpuEmitters: '[{"shape":"disc"}]' }).gpgpuEmitters === '[{"shape":"disc"}]');
  check('emitterListActive: false at default, true with a valid list',
    EL.emitterListActive(BASE) === false
    && EL.emitterListActive({ gpgpuEmitters: '[{"shape":"disc"}]' }) === true
    && EL.emitterListActive({ gpgpuEmitters: '[{"shape":"blob"}]' }) === false);
}

if (failures > 0) {
  console.error(`layer1-wp4-emitter-list: ${failures}/${checks} checks FAILED`);
  process.exit(1);
}
console.log(`layer1-wp4-emitter-list: ${checks}/${checks} checks passed`);
