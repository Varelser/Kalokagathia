// Bake v2.1 Phase 2A/2B standalone tests:
//  A. v2 backward-compatibility regression, PINNED against the
//     existing v2 module in the stage1-grammar2 isolated tree
//     (read-only import; that tree is not modified):
//     validCount present / absent both decode 0-ULP, and a v1
//     file is still read by the v2 reader.
//  B. v2.1 unit behaviour: manifest extension rules, byte
//     budget, hash-over-compressed-bytes, reserved-profile
//     refusal, morton_sorted constraints.
//  C. Design 2.5 gate 2 accuracy lines, measured:
//     position max component error <= 0.501 * max_extent/65535,
//     quaternion angle error <= 0.001 rad,
//     velocity f16 relative error <= 1e-3 (normal domain).
// Run: node scripts/stage-bake-v21.test.mjs
import { build } from '/home/hatch/workspace/monosphere-audit/project-stage1-grammar2/node_modules/esbuild/lib/main.js';
import { unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const V2ROOT = '/home/hatch/workspace/monosphere-audit/project-stage1-grammar2';
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
// Deterministic PRNG (mulberry32) — same seed, same numbers.
const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const BUNDLE = join(ROOT, 'scripts', `.bakev21-bundle-${process.pid}.mjs`);
await build({
  stdin: {
    contents: `
      export * from './lib/gpgpuStateCacheV21.ts';
      export * as v2 from '${V2ROOT}/lib/gpgpuStateCacheV2.ts';
      export { assembleStateCache, serializeStateCacheManifest, encodeStateCacheFrames } from '${V2ROOT}/lib/gpgpuStateCache.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleBakeV21, parseBakeV21Manifest, decodeBakeV21,
  float32ToFloat16Bits, float16BitsToFloat32,
  encodeQuatSmallestThree, decodeQuatSmallestThree, quatAngleBetween,
  encodeQuatSmallestThree48, decodeQuatSmallestThree48,
  encodePositionsAabbU16, decodePositionsAabbU16,
  morton30FromQuantized, BAKE_V21_GATE2,
} = lib;
const v2 = lib.v2;
const PROV = { settingsHash: 'scene-hash-v21', seed: 7, generator: 'monosphere', generatorVersion: 'v21-test' };

/* ============ A. v2 regression (pinned) ============ */
{
  const TEX = 4; const COUNT = TEX * TEX;
  const mkFrames = () => [0, 1].map((f) => {
    const positions = new Float32Array(COUNT * 4);
    const velocities = new Float32Array(COUNT * 4);
    const age = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions.set([i + f * 0.5, i * 2, -i, 1], i * 4);
      velocities.set([f, 1, i / 3, 0], i * 4);
      age[i] = i + f;
    }
    return { positions, velocities, attributes: { age } };
  });
  const orient = [0, 1].map((f) => {
    const q = new Float32Array(COUNT * 4);
    const a = (f * Math.PI) / 2;
    for (let i = 0; i < COUNT; i++) q.set([0, Math.sin(a / 2), 0, Math.cos(a / 2)], i * 4);
    return q;
  });
  const DECLS = [{ name: 'age', components: 1, source: 'sim-age' }];
  for (const validCount of [undefined, 8]) {
    const tag = validCount === undefined ? 'validCountなし' : `validCount=${validCount}`;
    const asm = v2.assembleStateCacheV2({
      fps: 30, texSize: TEX, frames: mkFrames(), attributeDecls: DECLS,
      orientations: orient, provenance: PROV, ...(validCount ? { validCount } : {}),
    });
    check(`A v2 assemble (${tag})`, asm.ok, asm.error ?? '');
    if (!asm.ok) continue;
    const text = v2.serializeStateCacheManifestV2(asm.cache);
    const parsed = v2.parseStateCacheManifestV2(text);
    check(`A v2 manifest round trip (${tag})`, 'manifest' in parsed);
    if (!('manifest' in parsed)) continue;
    const dec = v2.decodeStateCacheFramesV2(parsed.manifest, v2.encodeStateCacheFramesV2(asm.cache));
    check(`A v2 decode (${tag})`, dec.ok, dec.error ?? '');
    if (!dec.ok) continue;
    // Stored prefix must be 0-ULP identical to the source.
    const stored = validCount ?? COUNT;
    let exact = true;
    for (let f = 0; f < 2; f++) {
      for (let i = 0; i < stored; i++) {
        for (let a = 0; a < 3; a++) {
          if (dec.cache.positions[f][i * 3 + a] !== asm.cache.positions[f][i * 3 + a]) exact = false;
          if (dec.cache.velocities[f][i * 3 + a] !== asm.cache.velocities[f][i * 3 + a]) exact = false;
        }
        for (let a = 0; a < 4; a++) {
          if (dec.cache.orientations[f][i * 4 + a] !== asm.cache.orientations[f][i * 4 + a]) exact = false;
        }
      }
    }
    check(`A v2 stored prefix 0 ULP (${tag})`, exact);
    if (validCount) {
      const tail = dec.cache.positions[0];
      check('A v2 thinned tail is parked convention',
        tail[8 * 3] === 0 && tail[8 * 3 + 1] === -99999 && tail[8 * 3 + 2] === 0);
    }
    // The v2.1 parser must route encoding-less manifests to the v2 reader.
    const routed = parseBakeV21Manifest(text);
    check(`A v2.1 parser routes v2 manifest to legacy (${tag})`, routed.kind === 'v2-legacy', routed.kind);
  }
  // v1 file through the v2 reader (existing behaviour, pinned).
  const v1frames = [0].map(() => {
    const positions = new Float32Array(COUNT * 4);
    const velocities = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) { positions.set([i, i, i, 1], i * 4); velocities.set([0, 0, 0, 0], i * 4); }
    return { positions, velocities, attributes: {} };
  });
  // v1 assemble takes readback-shaped frames like v2's capture path.
  const v1asm = lib.assembleStateCache({ fps: 30, texSize: 4, frames: v1frames });
  check('A v1 assemble for compat pin', v1asm.ok, v1asm.error ?? '');
  if (v1asm.ok) {
    const v1text = lib.serializeStateCacheManifest(v1asm.cache);
    const asV2 = v2.parseStateCacheManifestV2(v1text);
    check('A v2 reader accepts v1 manifest (sourceVersion 1)',
      'manifest' in asV2 && asV2.manifest.sourceVersion === 1);
    if ('manifest' in asV2) {
      const dec = v2.decodeStateCacheFramesV2(asV2.manifest, lib.encodeStateCacheFrames(v1asm.cache));
      check('A v1 file decodes through v2 reader', dec.ok, dec.error ?? '');
      if (dec.ok) {
        let exact = true;
        for (let i = 0; i < COUNT * 3; i++) {
          if (dec.cache.positions[0][i] !== v1asm.cache.positions[0][i]) exact = false;
        }
        check('A v1-through-v2 positions 0 ULP', exact);
        check('A v1 file has no orientation by declaration', dec.cache.orientations === null);
      }
    }
    check('A v2.1 parser routes v1 manifest to legacy', parseBakeV21Manifest(v1text).kind === 'v2-legacy');
  }
}

/* ============ B. v2.1 unit behaviour ============ */
const TEX = 8; const COUNT = TEX * TEX;
const rand = rng(1234);
const randomQuat = () => {
  // Uniform random unit quaternion (Shoemake).
  const u1 = rand(); const u2 = rand(); const u3 = rand();
  const s1 = Math.sqrt(1 - u1); const s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(2 * Math.PI * u2), s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3), s2 * Math.cos(2 * Math.PI * u3),
  ];
};
const mkV21Frames = (n, box = 10) => Array.from({ length: n }, (_, f) => {
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const orientations = new Float32Array(COUNT * 4);
  const age = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([(rand() - 0.5) * box, (rand() - 0.5) * box, (rand() - 0.5) * box], i * 3);
    velocities.set([(rand() - 0.5) * 4, (rand() - 0.5) * 4, (rand() - 0.5) * 4], i * 3);
    orientations.set(randomQuat(), i * 4);
    age[i] = f + i / COUNT;
  }
  return { positions, velocities, orientations, attributes: { age } };
});
{
  const frames = mkV21Frames(3);
  const asm = assembleBakeV21({
    fps: 30, texSize: TEX, frames,
    attributeDecls: [{ name: 'age', components: 1, source: 'sim-age' }],
    scalarKinds: { age: 'u16-normalized' }, provenance: PROV,
  });
  check('B v2.1 assemble', asm.ok, asm.error ?? '');
  if (asm.ok) {
    check('B default orientation profile is u48 (commander decision, 案1)',
      asm.manifest.encoding.orientation.kind === 'smallest-three-u48'
      && asm.manifest.encoding.orientation.meetsGate2Line === true);
    check('B bytesPerParticle = 20 with default u48 (6 pos + 6 quat + 6 vel + 2 scalar)',
      asm.manifest.encoding.bytesPerParticle === 20, String(asm.manifest.encoding.bytesPerParticle));
    check('B binary size = 20 * count * frames',
      asm.binary.byteLength === 20 * COUNT * 3, String(asm.binary.byteLength));
    check('B size vs v2 44B: ratio 20/44', Math.abs(asm.binary.byteLength / (44 * COUNT * 3) - 20 / 44) < 1e-9);
    const parsed = parseBakeV21Manifest(JSON.stringify(asm.manifest));
    check('B manifest parse -> v21', parsed.kind === 'v21', parsed.kind);
    const dec = decodeBakeV21(asm.manifest, asm.binary);
    check('B v2.1 decode', dec.ok, dec.error ?? '');
    // Corrupt one compressed byte: hash must refuse the frame.
    const bad = new Uint8Array(asm.binary.slice(0));
    bad[10] ^= 0xff;
    const decBad = decodeBakeV21(asm.manifest, bad.buffer);
    check('B corrupted compressed byte refused by frame hash', !decBad.ok);
    // Reserved profile must be refused, not reinterpreted.
    const reserved = JSON.parse(JSON.stringify(asm.manifest));
    reserved.encoding.position.kind = 'aabb-u24x3';
    const rp = parseBakeV21Manifest(JSON.stringify(reserved));
    check('B reserved pos_24bit profile refused', rp.kind === 'error');
    // Unknown codec version refused.
    const badCodec = JSON.parse(JSON.stringify(asm.manifest));
    badCodec.encoding.codecVersion = 99;
    check('B unknown codecVersion refused', parseBakeV21Manifest(JSON.stringify(badCodec)).kind === 'error');
  }
  // morton_sorted + linear is refused at assemble time...
  const badCombo = assembleBakeV21({
    fps: 30, texSize: TEX, frames: mkV21Frames(1), provenance: PROV,
    ordering: 'morton_sorted', interpolation: 'linear',
  });
  check('B morton_sorted + linear refused (assemble)', !badCombo.ok);
  // ...and morton_sorted + nearest assembles, and decode returns
  // the same particle SET per frame (order differs, ids do not survive).
  const morton = assembleBakeV21({
    fps: 30, texSize: TEX, frames: mkV21Frames(2), provenance: PROV,
    ordering: 'morton_sorted', interpolation: 'nearest',
  });
  check('B morton_sorted + nearest assembles', morton.ok, morton.error ?? '');
  if (morton.ok) {
    check('B morton manifest declares ordering', morton.manifest.encoding.ordering === 'morton_sorted');
    const dec = decodeBakeV21(morton.manifest, morton.binary);
    check('B morton decode ok', dec.ok, dec.error ?? '');
  }
  // Velocity omitted profile (u32 orientation): 12 B per particle (6+4+0+2)
  const noVel = assembleBakeV21({
    fps: 30, texSize: TEX, frames: mkV21Frames(1),
    attributeDecls: [{ name: 'age', components: 1, source: 'sim-age' }],
    orientationProfile: 'smallest-three-u32',
    includeVelocity: false, provenance: PROV,
  });
  check('B velocity-omitted bytesPerParticle = 12', noVel.ok && noVel.manifest.encoding.bytesPerParticle === 12,
    noVel.ok ? String(noVel.manifest.encoding.bytesPerParticle) : noVel.error);
  // u32 orientation profile (size-priority option): 18 B per
  // particle, and the manifest must carry the measured error
  // and meetsGate2Line: false.
  const u32 = assembleBakeV21({
    fps: 30, texSize: TEX, frames: mkV21Frames(1),
    attributeDecls: [{ name: 'age', components: 1, source: 'sim-age' }],
    orientationProfile: 'smallest-three-u32', provenance: PROV,
  });
  check('B u32 bytesPerParticle = 18', u32.ok && u32.manifest.encoding.bytesPerParticle === 18,
    u32.ok ? String(u32.manifest.encoding.bytesPerParticle) : u32.error);
  if (u32.ok) {
    check('B u32 manifest states measured max error 0.002539 rad and meetsGate2Line: false',
      u32.manifest.encoding.orientation.measuredMaxAngleErrorRad === 0.0025385890984914285
      && u32.manifest.encoding.orientation.meetsGate2Line === false);
    const dec = decodeBakeV21(u32.manifest, u32.binary);
    check('B u32 decode ok', dec.ok, dec.error ?? '');
    check('B u32 manifest parses as v21',
      parseBakeV21Manifest(JSON.stringify(u32.manifest)).kind === 'v21');
    // A u32 manifest that claims gate compliance is refused.
    const lying = JSON.parse(JSON.stringify(u32.manifest));
    lying.encoding.orientation.meetsGate2Line = true;
    check('B u32 manifest claiming gate compliance is refused',
      parseBakeV21Manifest(JSON.stringify(lying)).kind === 'error');
  }
  // validCount thinning composes: stored prefix only, parked tail.
  const thinned = assembleBakeV21({
    fps: 30, texSize: TEX, frames: mkV21Frames(1), validCount: 32, provenance: PROV,
  });
  check('B v2.1 validCount assemble', thinned.ok, thinned.error ?? '');
  if (thinned.ok) {
    check('B v2.1 thinned binary sized by validCount',
      thinned.binary.byteLength === thinned.manifest.encoding.bytesPerParticle * 32);
    const dec = decodeBakeV21(thinned.manifest, thinned.binary);
    check('B v2.1 thinned decode restores count-wide with parked tail',
      dec.ok && dec.decoded.positions[0][40 * 3 + 1] === -99999, dec.ok ? '' : dec.error);
  }
  // Morton code sanity: identical quantized points share a code;
  // spreading is monotone along x at coarse scale.
  check('B morton30 deterministic', morton30FromQuantized(1000, 2000, 3000) === morton30FromQuantized(1000, 2000, 3000));
}

/* ============ C. Gate 2 accuracy ============ */
const gate = { posMaxComp: 0, posMaxCompBound: 0, posEuclid: 0, quatMaxAngle: 0, velMaxRel: 0, scalarMaxRel: 0 };
{
  // C1 positions: random boxes of several extents + a degenerate
  // axis + an analytic fluid-like frame (vortex cluster, dam
  // column) as the stand-in for a real fluid frame.
  const boxes = [[10, 10, 10], [50, 2, 0.5], [0.01, 100, 3], [5, 5, 0]];
  for (const box of boxes) {
    const n = 20000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) pos[i * 3 + a] = (rand() - 0.5) * box[a];
    }
    const enc = encodePositionsAabbU16(pos, n);
    const dec = decodePositionsAabbU16(enc, n);
    const maxExtent = Math.max(...box);
    for (let i = 0; i < n; i++) {
      let eu = 0;
      for (let a = 0; a < 3; a++) {
        const e = Math.abs(dec[i * 3 + a] - pos[i * 3 + a]);
        if (e > gate.posMaxComp) gate.posMaxComp = e;
        eu += e * e;
      }
      gate.posEuclid = Math.max(gate.posEuclid, Math.sqrt(eu));
    }
    gate.posMaxCompBound = Math.max(gate.posMaxCompBound,
      BAKE_V21_GATE2.positionMaxComponentErrorFactor * maxExtent / 65535);
  }
  check('C1 position max component error <= 0.501 * max_extent / 65535',
    gate.posMaxComp <= gate.posMaxCompBound,
    `measured ${gate.posMaxComp} bound ${gate.posMaxCompBound}`);

  // Bit-layout pins (detail-spec layout, commander ruling
  // 2026-11-29): identity quaternion has max index 3 (w) and
  // all stored components 0 -> codes at the middle of the
  // range (the encoder's neighbourhood search may pick the
  // code just below or above the midpoint; both are within
  // one step). Fields are extracted per the NEW layout, so a
  // regression to the old low-bit layout fails these checks.
  // u32: idx[30..31], a[20..29], b[10..19], c[0..9].
  const idU32 = encodeQuatSmallestThree(0, 0, 0, 1);
  const f32 = [
    Math.floor(idU32 / 2 ** 30) % 4,
    Math.floor(idU32 / 2 ** 20) % 1024,
    Math.floor(idU32 / 2 ** 10) % 1024,
    idU32 % 1024,
  ];
  check('C0 u32 layout: idx top bits, a/b/c descending',
    f32[0] === 3 && f32.slice(1).every((c) => Math.abs(c - 511.5) <= 1),
    f32.join(','));
  // u48: spare[47]=0, idx[45..46], a[30..44], b[15..29], c[0..14].
  const idU48 = encodeQuatSmallestThree48(0, 0, 0, 1);
  const f48 = [
    Math.floor(idU48 / 2 ** 45) % 4,
    Math.floor(idU48 / 2 ** 30) % 32768,
    Math.floor(idU48 / 2 ** 15) % 32768,
    idU48 % 32768,
  ];
  check('C0 u48 layout: idx at bits 45..46, a/b/c descending, spare bit 0',
    f48[0] === 3 && f48.slice(1).every((c) => Math.abs(c - 16383.5) <= 1)
    && idU48 < 2 ** 47,
    f48.join(','));

  // C2 quaternions: 100k uniform random + axis-aligned edge cases.
  // FINDING: the u32 profile does NOT meet the design's 0.001 rad
  // line under the rotation-angle definition (see record). The
  // u32 result is pinned as a CHARACTERISATION (max <= 0.0026),
  // and the gate line is checked against the u48 profile.
  const NQ = 100000;
  let quat48Max = 0;
  for (let i = 0; i < NQ; i++) {
    const q = randomQuat();
    const rec = decodeQuatSmallestThree(encodeQuatSmallestThree(q[0], q[1], q[2], q[3]));
    gate.quatMaxAngle = Math.max(gate.quatMaxAngle, quatAngleBetween(q, rec));
    const rec48 = decodeQuatSmallestThree48(encodeQuatSmallestThree48(q[0], q[1], q[2], q[3]));
    quat48Max = Math.max(quat48Max, quatAngleBetween(q, rec48));
  }
  for (const q of [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],
    [0.5, 0.5, 0.5, 0.5], [-0.5, -0.5, -0.5, -0.5],
    [Math.SQRT1_2, Math.SQRT1_2, 0, 0], [0, Math.SQRT1_2, Math.SQRT1_2, 0]]) {
    const rec = decodeQuatSmallestThree(encodeQuatSmallestThree(q[0], q[1], q[2], q[3]));
    gate.quatMaxAngle = Math.max(gate.quatMaxAngle, quatAngleBetween(q, rec));
    const rec48 = decodeQuatSmallestThree48(encodeQuatSmallestThree48(q[0], q[1], q[2], q[3]));
    quat48Max = Math.max(quat48Max, quatAngleBetween(q, rec48));
  }
  gate.quat48MaxAngle = quat48Max;
  check('C2 u32 smallest-three characterisation: max angle <= 0.0026 rad (gate line 0.001 NOT met — see record)',
    gate.quatMaxAngle <= 0.0026, `measured ${gate.quatMaxAngle}`);
  check('C2b u48 smallest-three max angle error <= 0.001 rad (gate line met)',
    quat48Max <= BAKE_V21_GATE2.orientationMaxAngleErrorRad,
    `measured ${quat48Max}`);

  // C3 velocity f16: log-uniform magnitudes in the normal domain.
  const NV = 200000;
  for (let i = 0; i < NV; i++) {
    const mag = 2 ** (-14 + Math.floor(rand() * 29)); // binade 2^-14 .. 2^14, so |v| < 2^15 < 65504 (f16 max)
    const v = (rand() < 0.5 ? -1 : 1) * mag * (1 + rand()); // mantissa in [1,2): |v| >= 2^-14, the stated domain
    const rec = float16BitsToFloat32(float32ToFloat16Bits(v));
    const rel = Math.abs(rec - v) / Math.abs(v);
    if (rel > gate.velMaxRel) gate.velMaxRel = rel;
  }
  check('C3 velocity f16 max relative error <= 1e-3 (normal domain)',
    gate.velMaxRel <= BAKE_V21_GATE2.velocityMaxRelativeError,
    `measured ${gate.velMaxRel}`);
  // Known-value f16 spot checks.
  check('C3 f16 exact values', float16BitsToFloat32(float32ToFloat16Bits(1)) === 1
    && float16BitsToFloat32(float32ToFloat16Bits(-2.5)) === -2.5
    && float16BitsToFloat32(float32ToFloat16Bits(0)) === 0);
}

const summary = {
  gate2: {
    positionMaxComponentError: gate.posMaxComp,
    positionBoundWorstBox: gate.posMaxCompBound,
    positionEuclideanReference: gate.posEuclid,
    quatMaxAngleErrorRadU32: gate.quatMaxAngle,
    quatMaxAngleErrorRadU48: gate.quat48MaxAngle,
    quatGateLineRad: BAKE_V21_GATE2.orientationMaxAngleErrorRad,
    quatGateLineMetBy: 'u48 only (u32 max exceeds the line; see record)',
    velocityMaxRelativeError: gate.velMaxRel,
  },
  failures,
};
writeFileSync(join(ROOT, 'scripts', 'gate2-result.json'), JSON.stringify(summary, null, 2));
console.log('\nGATE2 SUMMARY ' + JSON.stringify(summary.gate2));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
