// Grammar 2.0 stage 3, slice S4 — the Alembic exporter
// (lib/stateCacheAlembic.ts): the canonical frame-sequence
// form (statecache-manifest-v1) -> ONE Alembic .abc file
// (Ogawa form, Points object, export only).
// Verified three ways:
//  1. Against the SPEC, by hand: this test parses the
//     Ogawa tree, the AbcCoreOgawa property headers, the
//     time-sampling stream and every sample payload
//     itself, following the official Ogawa specification
//     (alembic/alembic wiki) and the meta-schema of the
//     official library (Alembic 1.8.8 sources).
//  2. Against GROUND TRUTH from the official library: a
//     reference file for the age-only fixture below was
//     written with the real Alembic 1.8.8 (OPoints) and
//     read back with its IPoints reader during
//     implementation; the sample digests and the composed
//     SpookyHash values measured from that file are
//     asserted here as constants. (The live real-reader
//     check itself is an environment command, not part of
//     this suite — see STAGE3_S4_IMPL_RECORD.md for the
//     commands and their measured results.)
//  3. Refusals state their reason: a cache that fails the
//     canonical form's own checks is never converted.
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S4, §4.5-1.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export { encodeAlembic, buildAlembicFile, validateCacheForAlembicExport, ALEMBIC_CHANNEL_MAPPING, ALEMBIC_FILE_NAME, ALEMBIC_FORMAT_LIBRARY_VERSION } from './lib/stateCacheAlembic.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache, encodeAlembic, buildAlembicFile, validateCacheForAlembicExport,
  ALEMBIC_CHANNEL_MAPPING, ALEMBIC_FILE_NAME, ALEMBIC_FORMAT_LIBRARY_VERSION,
} = lib;

const TEX = 4; const COUNT = TEX * TEX;
// The S3 fixture values: position (i + f*0.5, -i*2,
// i - 3.25), velocity (f - 1, 0.25*i, 2), age = i + f,
// heat = i*10 + f. (In JS, -i*2 at i=0 is -0; the ground
// truth constants below were measured against a C++
// reference written with the same -0 lane.)
const frameInput = (f, attrs = ['age', 'heat']) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  const age = new Float32Array(COUNT);
  const heat = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    positions.set([i + f * 0.5, -i * 2, i - 3.25, 999], i * 4);
    velocities.set([f - 1, 0.25 * i, 2, -7], i * 4);
    age[i] = i + f;
    heat[i] = i * 10 + f;
  }
  const attributes = {};
  if (attrs.includes('age')) attributes.age = age;
  if (attrs.includes('heat')) attributes.heat = heat;
  return { positions, velocities, attributes };
};
const made = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1), frameInput(2)], attributeNames: ['age', 'heat'] });
check('0 fixture cache assembles', made.ok === true, made.error ?? '');
const cache = made.cache;
const madeAgeOnly = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0, ['age']), frameInput(1, ['age']), frameInput(2, ['age'])], attributeNames: ['age'] });
check('0 age-only fixture assembles', madeAgeOnly.ok === true, madeAgeOnly.error ?? '');
const ageCache = madeAgeOnly.cache;

/* ---------- a hand Ogawa reader (spec-shaped) ---------- */
const DATA_FLAG = 1n << 63n;
function ogawaReader(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const u64 = (off) => view.getBigUint64(off, true);
  const dataAt = (ref) => {
    const off = Number(ref & ~DATA_FLAG);
    if (off === 0) return new Uint8Array(0);
    const size = Number(u64(off));
    return bytes.subarray(off + 8, off + 8 + size);
  };
  const childrenOf = (ref) => {
    const off = Number(ref & ~DATA_FLAG);
    if (off === 0) return [];
    const n = Number(u64(off));
    const out = [];
    for (let i = 0; i < n; i++) out.push(u64(off + 8 + i * 8));
    return out;
  };
  const isData = (ref) => (ref & DATA_FLAG) !== 0n;
  return { bytes, view, u64, dataAt, childrenOf, isData, rootOffset: u64(8) };
}
function readHint(view, bytes, pos, hint) {
  const n = [1, 2, 4][hint];
  let v = 0;
  for (let i = 0; i < n; i++) v |= bytes[pos + i] << (8 * i);
  return [v >>> 0, pos + n];
}
function decodePropertyHeaders(stream) {
  const headers = [];
  let pos = 0;
  while (pos < stream.length) {
    const info = stream[pos] | (stream[pos + 1] << 8) | (stream[pos + 2] << 16) | (stream[pos + 3] << 24);
    pos += 4;
    const type = info & 3;
    const hint = (info >> 2) & 3;
    const pod = (info >> 4) & 0xf;
    const extent = (info >> 12) & 0xff;
    const mdIndex = (info >> 20) & 0xff;
    const h = {
      info, type, hint, pod, extent, mdIndex,
      hasTs: !!(info & 0x100), hasFirstLast: !!(info & 0x200),
      homogenous: !!(info & 0x400), constant: !!(info & 0x800),
      isScalarLike: !!(info & 1) && type !== 1 ? true : (type === 2 ? false : !!(info & 1)),
    };
    if (type !== 0) {
      let v; [v, pos] = readHint(null, stream, pos, hint); h.numSamples = v;
      if (h.hasFirstLast) {
        [v, pos] = readHint(null, stream, pos, hint); h.firstChanged = v;
        [v, pos] = readHint(null, stream, pos, hint); h.lastChanged = v;
      } else if (h.constant) { h.firstChanged = 0; h.lastChanged = 0; }
      else { h.firstChanged = 1; h.lastChanged = h.numSamples - 1; }
      if (h.hasTs) { [v, pos] = readHint(null, stream, pos, hint); h.tsIndex = v; }
    }
    let nameSize; [nameSize, pos] = readHint(null, stream, pos, hint);
    h.name = new TextDecoder().decode(stream.subarray(pos, pos + nameSize)); pos += nameSize;
    if (mdIndex === 0xff) {
      let mdSize; [mdSize, pos] = readHint(null, stream, pos, hint);
      h.metaData = new TextDecoder().decode(stream.subarray(pos, pos + mdSize)); pos += mdSize;
    } else {
      h.metaData = mdIndex === 0 ? '' : `<indexed ${mdIndex}>`;
    }
    headers.push(h);
  }
  return headers;
}
/** The reader-side sample index mapping (verifyIndex). */
function verifyIndex(h, i) {
  if (i < h.firstChanged) return 0;
  if (h.firstChanged === h.lastChanged && h.firstChanged === 0) return 0;
  if (i >= h.lastChanged) return h.lastChanged - h.firstChanged + 1;
  return i - h.firstChanged + 1;
}
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
/** Walk root -> top object -> particles -> top compound
 *  -> .geom and return the .geom compound's children. */
function geomKidsOf(RD) {
  const root = RD.childrenOf(RD.rootOffset);
  const top = RD.childrenOf(root[2]);
  const part = RD.childrenOf(top[1]);
  const topCompound = RD.childrenOf(part[0]);
  return RD.childrenOf(topCompound[0]);
}

/* ---------- 1. Mapping table ---------- */
check('1 mapping table documents generated ids and derived bounds',
  ALEMBIC_CHANNEL_MAPPING.some((e) => e.alembicName === '.pointIds' && e.origin === 'generated')
  && ALEMBIC_CHANNEL_MAPPING.some((e) => e.alembicName === '.selfBnds' && e.origin === 'derived')
  && ALEMBIC_CHANNEL_MAPPING.some((e) => e.canonical === 'age' && e.alembicName === '.arbGeomParams/age')
  && ALEMBIC_CHANNEL_MAPPING.some((e) => e.canonical === 'positions' && e.alembicName === 'P'));

/* ---------- 2. Ogawa + archive structure ---------- */
const enc = encodeAlembic(cache);
check('2 main fixture encodes', enc.ok === true, enc.error ?? '');
const R = ogawaReader(enc.buffer);
check('2 Ogawa header', R.bytes[0] === 0x4f && R.bytes[1] === 0x67 && R.bytes[2] === 0x61
  && R.bytes[3] === 0x77 && R.bytes[4] === 0x61 && R.bytes[5] === 0xff
  && R.bytes[6] === 0 && R.bytes[7] === 1);
const rootKids = R.childrenOf(R.rootOffset);
check('2 root has 6 children', rootKids.length === 6);
check('2 archive version stamps', R.view.getInt32(Number(rootKids[0] & ~DATA_FLAG) + 8, true) === 0
  && R.view.getInt32(Number(rootKids[1] & ~DATA_FLAG) + 8, true) === ALEMBIC_FORMAT_LIBRARY_VERSION
  && ALEMBIC_FORMAT_LIBRARY_VERSION === 10808);
check('2 archive metadata names the application, no library impersonation',
  new TextDecoder().decode(R.dataAt(rootKids[3])) === 'application=Monosphere (Kalokagathia)');
check('2 indexed metadata stream is empty (metadata is inline)', R.dataAt(rootKids[5]).length === 0);
{
  const ts = R.dataAt(rootKids[4]);
  const tv = new DataView(ts.buffer, ts.byteOffset, ts.byteLength);
  check('2 time sampling stream: default + uniform',
    ts.length === 48
    && tv.getUint32(0, true) === 0 && tv.getFloat64(4, true) === 1 && tv.getUint32(12, true) === 1 && tv.getFloat64(16, true) === 0
    && tv.getUint32(24, true) === 3 && Math.abs(tv.getFloat64(28, true) - 1 / 30) < 1e-15
    && tv.getUint32(36, true) === 1 && tv.getFloat64(40, true) === 0);
}
// Object tree: top -> [empty compound, particles group, headers]
const topKids = R.childrenOf(rootKids[2]);
check('2 top object shape', topKids.length === 3 && Number(topKids[0]) === 0 && !R.isData(topKids[1]) && R.isData(topKids[2]));
{
  const topHeaders = R.dataAt(topKids[2]);
  const nameSize = new DataView(topHeaders.buffer, topHeaders.byteOffset).getUint32(0, true);
  const objName = new TextDecoder().decode(topHeaders.subarray(4, 4 + nameSize));
  const mdIndex = topHeaders[4 + nameSize];
  let objMeta = '';
  if (mdIndex === 0xff) {
    const ms = new DataView(topHeaders.buffer, topHeaders.byteOffset).getUint32(4 + nameSize + 1, true);
    objMeta = new TextDecoder().decode(topHeaders.subarray(4 + nameSize + 5, 4 + nameSize + 5 + ms));
  }
  check('2 particles object header with schema metadata', objName === 'particles'
    && objMeta === 'schema=AbcGeom_Points_v1;schemaBaseType=AbcGeom_GeomBase_v1;schemaObjTitle=AbcGeom_Points_v1:.geom', objMeta);
  check('2 top headers end with properties+children hashes (empty-message Spooky first)',
    hex(topHeaders.subarray(topHeaders.length - 32, topHeaders.length - 16)) === '1909f56bfc062723c751e8b465ee728b');
}
const partKids = R.childrenOf(topKids[1]);
check('2 particles object shape', partKids.length === 2 && !R.isData(partKids[0]) && R.isData(partKids[1]));
check('2 particles headers are hashes only, children hash zero',
  R.dataAt(partKids[1]).length === 32 && hex(R.dataAt(partKids[1]).subarray(16)) === '00000000000000000000000000000000');
// Top compound of particles: [.geom group, headers stream]
const topCompoundKids = R.childrenOf(partKids[0]);
check('2 top compound holds exactly .geom', topCompoundKids.length === 2);
{
  const hs = decodePropertyHeaders(R.dataAt(topCompoundKids[1]));
  check('2 .geom compound header', hs.length === 1 && hs[0].name === '.geom' && hs[0].type === 0
    && hs[0].metaData === 'schema=AbcGeom_Points_v1;schemaBaseType=AbcGeom_GeomBase_v1', JSON.stringify(hs));
}
// .geom compound: 5 property groups + headers stream
const geomKids = R.childrenOf(topCompoundKids[0]);
check('2 .geom has 5 property groups + headers', geomKids.length === 6 && R.isData(geomKids[5]));
const geomHeaders = decodePropertyHeaders(R.dataAt(geomKids[5]));
check('2 .geom property order (library creation order)',
  geomHeaders.map((h) => h.name).join(',') === '.selfBnds,P,.pointIds,.arbGeomParams,.velocities',
  geomHeaders.map((h) => h.name).join(','));
{
  const [sb, p, ids, arb, vel] = geomHeaders;
  check('2 .selfBnds is a scalar float64[6] with box interpretation',
    sb.type === 1 && sb.pod === 11 && sb.extent === 6 && sb.numSamples === 3 && sb.tsIndex === 1
    && sb.metaData === 'interpretation=box' && sb.homogenous === true);
  check('2 P is a float32[3] array, varying point scope, not homogenous (extent>1 quirk)',
    p.type === 2 && p.pod === 10 && p.extent === 3 && p.numSamples === 3 && p.tsIndex === 1
    && p.metaData === 'geoScope=var;interpretation=point' && p.homogenous === false);
  check('2 .pointIds is uint64, constant (identical samples stored once)',
    ids.type === 2 && ids.pod === 7 && ids.extent === 1 && ids.constant === true && ids.numSamples === 3
    && ids.metaData === 'geoScope=var');
  check('2 .arbGeomParams is a compound with empty metadata', arb.type === 0 && arb.metaData === '');
  check('2 .velocities is a float32[3] array with vector interpretation',
    vel.type === 2 && vel.pod === 10 && vel.extent === 3 && vel.metaData === 'interpretation=vector');
}
// .arbGeomParams: [age group, heat group, headers]
const arbKids = R.childrenOf(geomKids[3]);
const arbHeaders = decodePropertyHeaders(R.dataAt(arbKids[arbKids.length - 1]));
check('2 arbGeomParams holds the attributes in manifest order with GeomParam metadata',
  arbHeaders.map((h) => h.name).join(',') === 'age,heat'
  && arbHeaders.every((h) => h.metaData === 'arrayExtent=1;geoScope=var;isGeomParam=true;podExtent=1;podName=float32_t'
    && h.type === 2 && h.pod === 10 && h.extent === 1 && h.homogenous === true));

/* ---------- 3. Sample payloads ---------- */
function samplePayloads(RD, groupRef, { withDims }) {
  const kids = RD.childrenOf(groupRef);
  const out = [];
  if (withDims) {
    for (let i = 0; i < kids.length; i += 2) {
      out.push({ data: RD.dataAt(kids[i]), dimsEmpty: RD.dataAt(kids[i + 1]).length === 0 && RD.isData(kids[i + 1]) });
    }
  } else {
    for (const k of kids) out.push({ data: RD.dataAt(k) });
  }
  return out;
}
{
  const pSamples = samplePayloads(R, geomKids[1], { withDims: true });
  check('3 P stores 3 samples with empty dims children', pSamples.length === 3 && pSamples.every((s) => s.dimsEmpty));
  const f0 = pSamples[0].data;
  check('3 P frame 0 payload is digest + 192 bytes', f0.length === 208);
  const pv = new DataView(f0.buffer, f0.byteOffset + 16, 192);
  let valuesOk = true;
  for (let i = 0; i < COUNT; i++) {
    if (pv.getFloat32(i * 12, true) !== i || !Object.is(pv.getFloat32(i * 12 + 4, true), -i * 2)
      || pv.getFloat32(i * 12 + 8, true) !== i - 3.25) valuesOk = false;
  }
  check('3 P frame 0 values bit-exact (including the -0 lane)', valuesOk);
  const idSamples = samplePayloads(R, geomKids[2], { withDims: true });
  check('3 .pointIds stores ONE sample for 3 identical frames', idSamples.length === 1);
  const idv = new DataView(idSamples[0].data.buffer, idSamples[0].data.byteOffset + 16, COUNT * 8);
  let idsOk = true;
  for (let i = 0; i < COUNT; i++) if (idv.getBigUint64(i * 8, true) !== BigInt(i)) idsOk = false;
  check('3 .pointIds values are the particle indices', idsOk);
  const sbSamples = samplePayloads(R, geomKids[0], { withDims: false });
  check('3 .selfBnds stores 3 scalar samples of 48 bytes + digest', sbSamples.length === 3
    && sbSamples.every((s) => s.data.length === 64));
  const bv = new DataView(sbSamples[0].data.buffer, sbSamples[0].data.byteOffset + 16, 48);
  check('3 .selfBnds frame 0 bounds match the positions extent',
    bv.getFloat64(0, true) === 0 && bv.getFloat64(8, true) === -30 && bv.getFloat64(16, true) === -3.25
    && bv.getFloat64(24, true) === 15 && Object.is(bv.getFloat64(32, true), -0) && bv.getFloat64(40, true) === 11.75);
  const ageSamples = samplePayloads(R, arbKids[0], { withDims: true });
  const av = new DataView(ageSamples[1].data.buffer, ageSamples[1].data.byteOffset + 16, COUNT * 4);
  let ageOk = true;
  for (let i = 0; i < COUNT; i++) if (av.getFloat32(i * 4, true) !== i + 1) ageOk = false;
  check('3 age frame 1 values', ageOk && ageSamples.length === 3);
}

/* ---------- 4. Ground truth from the official library ---------- */
{
  const encAge = encodeAlembic(ageCache);
  check('4 age-only fixture encodes', encAge.ok === true, encAge.error ?? '');
  const RA = ogawaReader(encAge.buffer);
  const aRoot = RA.childrenOf(RA.rootOffset);
  const aTop = RA.childrenOf(aRoot[2]);
  const aPart = RA.childrenOf(aTop[1]);
  check('4 particles properties hash equals the official library value',
    hex(RA.dataAt(aPart[1])) === 'dc881c857c4078ccae887b5acf2fb78d00000000000000000000000000000000',
    hex(RA.dataAt(aPart[1])));
  check('4 top object hashes equal the official library values',
    hex(RA.dataAt(aTop[2]).subarray(RA.dataAt(aTop[2]).length - 32))
      === '1909f56bfc062723c751e8b465ee728b4360844207bde89895aad2d2fd07b456');
  const aGeom = RA.childrenOf(RA.childrenOf(aPart[0])[0]);
  const digestOf = (groupRef, sampleIdx) => hex(RA.dataAt(RA.childrenOf(groupRef)[sampleIdx * 2]).subarray(0, 16));
  check('4 P frame 0 digest equals the official Murmur value',
    digestOf(aGeom[1], 0) === '153e59018e95535c0b0176248760f719', digestOf(aGeom[1], 0));
  check('4 velocities frame 0 digest equals the official Murmur value',
    digestOf(aGeom[4], 0) === 'c437c55693d5bc5792f8edfbf2074c44', digestOf(aGeom[4], 0));
  const aArb = RA.childrenOf(aGeom[3]);
  check('4 age frame 0 digest equals the official Murmur value',
    digestOf(aArb[0], 0) === 'c87b2385d8f97c33551d022bc7f58cf3', digestOf(aArb[0], 0));
  const sbData = RA.dataAt(RA.childrenOf(aGeom[0])[0]);
  check('4 .selfBnds frame 0 digest equals the official Murmur value',
    hex(sbData.subarray(0, 16)) === '037f8e4b4c557757f5281117af93b298', hex(sbData.subarray(0, 16)));
  check('4 .pointIds digest equals the official Murmur value',
    digestOf(aGeom[2], 0) === '59e99ad7c82c2f4d398f5d4054dfd744', digestOf(aGeom[2], 0));
}

/* ---------- 5. Repeated samples: storage + index mapping ---------- */
{
  // Frames A A B B for positions (velocities also follow
  // the frame index, so use position pattern only by
  // reusing frame inputs 0,0,1,1).
  const rep = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [frameInput(0), frameInput(0), frameInput(1), frameInput(1)],
    attributeNames: ['age', 'heat'],
  });
  check('5 repeat fixture assembles', rep.ok === true, rep.error ?? '');
  const encRep = encodeAlembic(rep.cache);
  check('5 repeat fixture encodes', encRep.ok === true, encRep.error ?? '');
  const RR = ogawaReader(encRep.buffer);
  const rGeom = geomKidsOf(RR);
  const rHeaders = decodePropertyHeaders(RR.dataAt(rGeom[5]));
  const pHead = rHeaders[1];
  // The library collapses a trailing run of repeats onto
  // lastChanged (no copies are written for it): A A B B
  // stores [A, B] with first=2, last=2.
  check('5 P header records first=2 last=2 for the A A B B pattern',
    pHead.firstChanged === 2 && pHead.lastChanged === 2 && pHead.numSamples === 4,
    JSON.stringify(pHead));
  const stored = samplePayloads(RR, rGeom[1], { withDims: true });
  check('5 P stores 2 samples for A A B B', stored.length === 2);
  // Reconstruct every frame through verifyIndex and
  // compare against the canonical arrays.
  let reconOk = true;
  for (let f = 0; f < 4; f++) {
    const payload = stored[verifyIndex(pHead, f)].data;
    const vals = new Float32Array(payload.buffer, payload.byteOffset + 16, COUNT * 3);
    const expected = rep.cache.positions[f];
    for (let i = 0; i < vals.length; i++) if (!Object.is(vals[i], expected[i])) reconOk = false;
  }
  check('5 verifyIndex reconstruction reproduces all 4 frames bit-exactly', reconOk);

  // The copy-fill path: A B B A — when the second change
  // lands, the writer first back-fills a copy of B for
  // the repeated middle frame, so 4 samples are stored
  // with first=1, last=3.
  const rep2 = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [frameInput(0), frameInput(1), frameInput(1), frameInput(0)],
    attributeNames: ['age', 'heat'],
  });
  const encRep2 = rep2.ok ? encodeAlembic(rep2.cache) : { ok: false };
  check('5 A B B A fixture encodes', encRep2.ok === true, encRep2.error ?? '');
  if (encRep2.ok) {
    const R2 = ogawaReader(encRep2.buffer);
    const g2 = geomKidsOf(R2);
    const h2 = decodePropertyHeaders(R2.dataAt(g2[5]))[1];
    const stored2 = samplePayloads(R2, g2[1], { withDims: true });
    check('5 A B B A stores 4 samples (copy-filled) with first=1 last=3',
      stored2.length === 4 && h2.firstChanged === 1 && h2.lastChanged === 3,
      `stored=${stored2.length} first=${h2.firstChanged} last=${h2.lastChanged}`);
    let recon2 = true;
    for (let f = 0; f < 4; f++) {
      const payload = stored2[verifyIndex(h2, f)].data;
      const vals = new Float32Array(payload.buffer, payload.byteOffset + 16, COUNT * 3);
      const expected = rep2.cache.positions[f];
      for (let i = 0; i < vals.length; i++) if (!Object.is(vals[i], expected[i])) recon2 = false;
    }
    check('5 A B B A reconstruction is bit-exact', recon2);
  }
}

/* ---------- 6. startFrame / fps land in the TimeSampling ---------- */
{
  const shifted = assembleStateCache({
    fps: 24, texSize: TEX, startFrame: 100,
    frames: [frameInput(0)], attributeNames: ['age'],
  });
  check('6 shifted fixture assembles', shifted.ok === true, shifted.error ?? '');
  const encS = encodeAlembic(shifted.cache);
  const RS = ogawaReader(encS.buffer);
  const ts = RS.dataAt(RS.childrenOf(RS.rootOffset)[4]);
  const tv = new DataView(ts.buffer, ts.byteOffset, ts.byteLength);
  check('6 TS carries 1/24 cycle and start time 100/24, maxSample = frameCount',
    Math.abs(tv.getFloat64(28, true) - 1 / 24) < 1e-15
    && Math.abs(tv.getFloat64(40, true) - 100 / 24) < 1e-12
    && tv.getUint32(24, true) === 1);
  // Single frame: every property is constant.
  const sGeom = geomKidsOf(RS);
  const sHeaders = decodePropertyHeaders(RS.dataAt(sGeom[5]));
  check('6 single-frame cache marks every property constant',
    sHeaders.filter((h) => h.type !== 0).every((h) => h.constant === true && h.numSamples === 1));
}

/* ---------- 7. Refusals + edition gate + names ---------- */
{
  const tampered = {
    ...cache,
    manifest: { ...cache.manifest, frameHashes: cache.manifest.frameHashes.map((h, i) => (i === 1 ? 'deadbeef' : h)) },
  };
  const tRes = encodeAlembic(tampered);
  check('7 frame hash mismatch refused with the reason', tRes.ok === false && tRes.error.includes('ハッシュ'), tRes.error ?? '');
  check('7 validation entry point agrees', validateCacheForAlembicExport(tampered).ok === false);

  const slash = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [{ positions: frameInput(0).positions, velocities: frameInput(0).velocities, attributes: { 'a/b': new Float32Array(COUNT) } }],
    attributeNames: ['a/b'],
  });
  check('7 slash-named attribute assembles canonically', slash.ok === true, slash.error ?? '');
  const sRes = slash.ok ? encodeAlembic(slash.cache) : { ok: false, error: 'n/a' };
  check('7 slash-named attribute refused on Alembic export (no silent rename)',
    sRes.ok === false && sRes.error.includes('"/"'), sRes.error ?? '');

  const short = {
    ...cache,
    positions: cache.positions.map((p, i) => (i === 0 ? p.subarray(0, 10) : p)),
  };
  check('7 length-mismatched frame refused', encodeAlembic(short).ok === false);

  check('7 public edition refused by the file builder', buildAlembicFile(cache, 'public').ok === false);
  const full = buildAlembicFile(cache, 'full');
  check('7 full edition builds with the fixed file name',
    full.ok === true && full.fileName === ALEMBIC_FILE_NAME && ALEMBIC_FILE_NAME === 'monosphere-state-cache.abc',
    full.ok ? full.fileName : full.error);

  const noAttrs = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeNames: [] });
  const encNo = noAttrs.ok ? encodeAlembic(noAttrs.cache) : { ok: false };
  check('7 attribute-less cache encodes (no .arbGeomParams)', encNo.ok === true, encNo.error ?? '');
  if (encNo.ok) {
    const RN = ogawaReader(encNo.buffer);
    const nGeom = geomKidsOf(RN);
    const nHeaders = decodePropertyHeaders(RN.dataAt(nGeom[nGeom.length - 1]));
    check('7 attribute-less .geom has no .arbGeomParams',
      nHeaders.map((h) => h.name).join(',') === '.selfBnds,P,.pointIds,.velocities');
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
