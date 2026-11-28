// Grammar 2.0 stage 3, slice S3 — the PRT converter
// (lib/stateCachePrt.ts): the canonical frame-sequence
// form (statecache-manifest-v1) <-> Thinkbox PRT files
// (one file per frame). Verified three ways:
//  1. Round trip canonical -> PRT -> canonical, bit-exact
//     per frame hash and per attribute value.
//  2. The writer against the SPEC, not against my own
//     reader: the test parses the header / chunk section /
//     channel definitions by hand and inflates the particle
//     block with node:zlib, comparing against a particle
//     buffer packed by hand in the test.
//  3. The reader against the SPEC: PRT files built by an
//     independent hand-rolled writer in this test (v1.0 and
//     v1.1 shapes, foreign channel types) decode correctly,
//     and every refusal states its reason.
// Format basis: "PRT File Format v1.1" (Thinkbox Software,
// the Krakatoa PRT specification).
// Design: kalokagathia-pro/STAGE3_DESIGN.md §2 S3.
import { build } from 'esbuild';
import { deflateSync, inflateSync } from 'node:zlib';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s3s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { assembleStateCache, hashStateCacheFrame, stateCacheToPointCacheData } from './lib/gpgpuStateCache.ts';
      export { resolvePrtChannels, encodePrtFrame, decodePrtFile, decodePrtFiles, buildPrtFileForFrame, prtFileNameForFrame, prtFrameNumberFromFileName, PRT_CHANNEL_MAPPING, PRT_MAGIC, PRT_TYPE } from './lib/stateCachePrt.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache, hashStateCacheFrame, stateCacheToPointCacheData,
  resolvePrtChannels, encodePrtFrame, decodePrtFile, decodePrtFiles,
  buildPrtFileForFrame, prtFileNameForFrame, prtFrameNumberFromFileName,
  PRT_CHANNEL_MAPPING, PRT_MAGIC, PRT_TYPE,
} = lib;

const TEX = 4; const COUNT = TEX * TEX;
// Distinct, exactly-representable float32 values per frame:
// position (i + f*0.5, -i*2, i - 3.25), velocity (f - 1, 0.25*i, 2),
// age = i + f, heat = i*10 + f. The readback w lanes carry
// junk that assembly must drop.
const frameInput = (f) => {
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
  return { positions, velocities, attributes: { age, heat } };
};
const made = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0), frameInput(1), frameInput(2)], attributeNames: ['age', 'heat'] });
check('0 fixture cache assembles', made.ok === true, made.error ?? '');
const cache = made.cache;

// ── 1. Mapping table + channel plan ─────────────────────────
check('1 mapping table documents the generated ID',
  PRT_CHANNEL_MAPPING.some((e) => e.prtName === 'ID' && e.origin === 'generated')
  && PRT_CHANNEL_MAPPING.some((e) => e.canonical === 'age' && e.prtName === 'Age')
  && PRT_CHANNEL_MAPPING.some((e) => e.canonical === 'positions' && e.prtName === 'Position'));
{
  const plan = resolvePrtChannels(cache);
  check('1 channel plan order and offsets', plan.ok === true
    && plan.channels.map((c) => c.name).join(',') === 'Position,Velocity,Age,ID,heat'
    && plan.channels.map((c) => c.offset).join(',') === '0,12,24,28,32'
    && plan.channels[3].source === 'id-generated' && plan.channels[3].type === PRT_TYPE.int32
    && plan.stride === 36, plan.ok ? '' : plan.error);
}

// ── 2. Round trip, bit-exact ────────────────────────────────
const encodedFrames = [];
for (let f = 0; f < 3; f++) {
  const enc = await encodePrtFrame(cache, f);
  check(`2 frame ${f} encodes`, enc.ok === true, enc.error ?? '');
  encodedFrames.push(enc.buffer);
}
{
  const seq = await decodePrtFiles(encodedFrames.map((buffer, f) => ({ name: `frame${String(f).padStart(4, '0')}.prt`, buffer })), { fps: 30 });
  check('2 sequence round trip ok', seq.ok === true, seq.error ?? '');
  if (seq.ok) {
    check('2 frame count and count preserved', seq.cache.manifest.frameCount === 3 && seq.cache.manifest.count === COUNT);
    let allBits = true;
    let allHashes = true;
    for (let f = 0; f < 3; f++) {
      const a = seq.cache.positions[f]; const b = cache.positions[f];
      const av = seq.cache.velocities[f]; const bv = cache.velocities[f];
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i]) || !Object.is(av[i], bv[i])) allBits = false;
      if (seq.cache.manifest.frameHashes[f] !== hashStateCacheFrame(b, bv)) allHashes = false;
    }
    check('2 positions/velocities bit-exact per frame', allBits);
    check('2 frame hashes match the originals', allHashes);
    check('2 attributes survive by name', seq.cache.manifest.attributes.join(',') === 'age,heat'
      && seq.cache.attrFrames[0][1][5] === 6 && seq.cache.attrFrames[1][2][5] === 52);
    check('2 nothing dropped/converted/filled on our own files',
      seq.report.droppedChannels.length === 1 && seq.report.droppedChannels[0].name === 'ID'
      && seq.report.convertedChannels.length === 0 && seq.report.filledChannels.length === 0,
      JSON.stringify(seq.report));
    check('2 imported cache plays through the point-cache conversion', stateCacheToPointCacheData(seq.cache).ok === true);
    check('2 start frame taken from file names', seq.cache.manifest.startFrame === 0);
  }
  const single = await decodePrtFile(encodedFrames[2], { fps: 30 });
  check('2 single-file decode is a one-frame cache', single.ok === true && single.cache.manifest.frameCount === 1
    && single.cache.positions[0][3] === cache.positions[2][3]);
}

// ── 3. Writer verified against the spec, by hand ────────────
{
  const bytes = new Uint8Array(encodedFrames[1]);
  const view = new DataView(encodedFrames[1]);
  check('3 magic bytes are the spec sequence', PRT_MAGIC.every((b, i) => bytes[i] === b));
  const headerLength = view.getInt32(8, true);
  check('3 signature string', new TextDecoder().decode(bytes.subarray(12, 12 + 26)) === 'Extensible Particle Format');
  check('3 version is 2 (v1.1)', view.getInt32(44, true) === 2);
  check('3 particle count is int64', view.getBigInt64(48, true) === BigInt(COUNT));
  // Walk the chunk section by hand.
  let o = 56;
  const metas = [];
  let stopped = false;
  while (o < headerLength) {
    const type = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const len = view.getInt32(o + 4, true);
    if (type === 'Stop') { stopped = true; o += 8; break; }
    if (type === 'Meta') {
      let p = o + 8;
      const readStr = () => { const s = p; while (bytes[p] !== 0) p++; const r = new TextDecoder().decode(bytes.subarray(s, p)); p++; return r; };
      const chan = readStr(); const name = readStr(); const vtype = view.getInt32(p, true);
      metas.push({ chan, name, vtype, valueAt: p + 4 });
    }
    o += 8 + len;
  }
  check('3 chunk section ends with Stop exactly at headerLength', stopped && o === headerLength);
  const boundBox = metas.find((m) => m.name === 'BoundBox');
  check('3 BoundBox meta matches the frame extent', !!boundBox && boundBox.vtype === PRT_TYPE.float32
    && view.getFloat32(boundBox.valueAt, true) === 0.5 && view.getFloat32(boundBox.valueAt + 12, true) === 15 + 0.5);
  const coordSys = metas.find((m) => m.name === 'CoordSys');
  const lengthUnit = metas.find((m) => m.name === 'LengthUnit');
  check('3 CoordSys = 1 (right-handed Y-up), LengthUnit = 6 (meters)',
    !!coordSys && view.getInt32(coordSys.valueAt, true) === 1
    && !!lengthUnit && view.getInt32(lengthUnit.valueAt, true) === 6);
  check('3 Interpretation metas for Position/Velocity',
    metas.some((m) => m.chan === 'Position' && m.name === 'Interpretation' && view.getInt32(m.valueAt, true) === 1)
    && metas.some((m) => m.chan === 'Velocity' && m.name === 'Interpretation' && view.getInt32(m.valueAt, true) === 2));
  check('3 reserved field is 4', view.getInt32(headerLength, true) === 4);
  const defsAt = headerLength + 4;
  check('3 channel def header', view.getInt32(defsAt, true) === 5 && view.getInt32(defsAt + 4, true) === 44);
  const defNames = [];
  for (let c = 0; c < 5; c++) {
    const at = defsAt + 8 + c * 44;
    let e = at; while (bytes[e] !== 0) e++;
    defNames.push({
      name: new TextDecoder().decode(bytes.subarray(at, e)),
      type: view.getInt32(at + 32, true), arity: view.getInt32(at + 36, true), offset: view.getInt32(at + 40, true),
    });
  }
  check('3 channel definitions match the plan', defNames.map((d) => d.name).join(',') === 'Position,Velocity,Age,ID,heat'
    && defNames[0].type === 4 && defNames[0].arity === 3 && defNames[3].type === 1 && defNames[4].offset === 32);
  // Inflate the particle block with node:zlib and compare
  // against a by-hand packed layout for frame 1.
  const dataAt = defsAt + 8 + 5 * 44;
  const packed = inflateSync(Buffer.from(bytes.subarray(dataAt)));
  const stride = 36;
  check('3 inflated length is count x stride', packed.length === COUNT * stride);
  const pv = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let layoutOk = true;
  for (let i = 0; i < COUNT; i++) {
    const at = i * stride;
    if (pv.getFloat32(at, true) !== i + 0.5 || pv.getFloat32(at + 4, true) !== -i * 2 || pv.getFloat32(at + 8, true) !== i - 3.25) layoutOk = false;
    if (pv.getFloat32(at + 12, true) !== 0 || pv.getFloat32(at + 16, true) !== 0.25 * i || pv.getFloat32(at + 20, true) !== 2) layoutOk = false;
    if (pv.getFloat32(at + 24, true) !== i + 1) layoutOk = false; // Age
    if (pv.getInt32(at + 28, true) !== i) layoutOk = false; // generated ID = index
    if (pv.getFloat32(at + 32, true) !== i * 10 + 1) layoutOk = false; // heat
  }
  check('3 particle layout byte-exact, ID generated from index', layoutOk);
}

// ── Independent hand-rolled PRT writer (spec-shaped) ────────
const TYPE_SIZES = { 0: 2, 1: 4, 2: 8, 3: 2, 4: 4, 5: 8, 6: 2, 7: 4, 8: 8, 9: 1, 10: 1 };
function handPrt({ version = 1, count, channels, values, chunks = [], reserved = 4, defLength = 44, countOverride = null }) {
  // channels: [{name, type, arity}]; values: per channel, per
  // particle flat array of JS numbers (BigInt for 64-bit).
  let offset = 0;
  const defs = channels.map((c) => { const d = { ...c, offset }; offset += TYPE_SIZES[c.type] * c.arity; return d; });
  const stride = offset;
  const packed = new Uint8Array(count * stride);
  const pv = new DataView(packed.buffer);
  const writeVal = (type, at, v) => {
    switch (type) {
      case 0: pv.setInt16(at, v, true); break;
      case 1: pv.setInt32(at, v, true); break;
      case 2: pv.setBigInt64(at, BigInt(v), true); break;
      case 3: pv.setUint16(at, v, true); break; // raw float16 bits
      case 4: pv.setFloat32(at, v, true); break;
      case 5: pv.setFloat64(at, v, true); break;
      case 6: pv.setUint16(at, v, true); break;
      case 7: pv.setUint32(at, v, true); break;
      case 8: pv.setBigUint64(at, BigInt(v), true); break;
      case 9: pv.setInt8(at, v); break;
      case 10: pv.setUint8(at, v); break;
    }
  };
  channels.forEach((c, ci) => {
    const size = TYPE_SIZES[c.type];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < c.arity; k++) writeVal(c.type, i * stride + defs[ci].offset + k * size, values[ci][i * c.arity + k]);
    }
  });
  const chunkBytes = chunks.reduce((s, c) => s + c.length, 0);
  const headerLength = 56 + (version === 2 ? chunkBytes : 0);
  const out = new Uint8Array(headerLength + 4 + 8 + channels.length * defLength + 4096);
  const v = new DataView(out.buffer);
  out.set(PRT_MAGIC, 0);
  v.setInt32(8, headerLength, true);
  out.set(new TextEncoder().encode('Extensible Particle Format'), 12);
  v.setInt32(44, version, true);
  v.setBigInt64(48, BigInt(countOverride ?? count), true);
  let o = 56;
  if (version === 2) for (const c of chunks) { out.set(c, o); o += c.length; }
  v.setInt32(o, reserved, true); o += 4;
  v.setInt32(o, channels.length, true); o += 4;
  v.setInt32(o, defLength, true); o += 4;
  channels.forEach((c, ci) => {
    const at = o + ci * defLength;
    out.set(new TextEncoder().encode(c.name), at);
    v.setInt32(at + 32, c.type, true);
    v.setInt32(at + 36, c.arity, true);
    v.setInt32(at + 40, defs[ci].offset, true);
  });
  o += channels.length * defLength;
  const compressed = deflateSync(Buffer.from(packed));
  out.set(new Uint8Array(compressed), o);
  return out.buffer.slice(0, o + compressed.length);
}
const flat = (count, fn) => { const a = []; for (let i = 0; i < count; i++) a.push(...fn(i)); return a; };

// ── 4. Reader against hand-built files ──────────────────────
{
  // v1.0, plain float32 Position + Velocity.
  const buf = handPrt({
    count: COUNT,
    channels: [{ name: 'Position', type: 4, arity: 3 }, { name: 'Velocity', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [i, i + 0.5, -i]), flat(COUNT, (i) => [1, 2, 3])],
  });
  const dec = await decodePrtFile(buf, { fps: 24 });
  check('4 v1.0 file decodes', dec.ok === true, dec.error ?? '');
  if (dec.ok) {
    check('4 values land in the canonical arrays', dec.cache.positions[0][7] === 2.5 && dec.cache.positions[0][8] === -2
      && dec.cache.velocities[0][0] === 1 && dec.cache.manifest.fps === 24 && dec.cache.manifest.texSize === TEX);
  }
}
{
  // v1.1 with an UNKNOWN chunk before Stop: must be skipped.
  const unknown = new Uint8Array(8 + 3);
  unknown.set([0x61, 0x62, 0x63, 0x64], 0); // 'abcd' (custom, lowercase)
  new DataView(unknown.buffer).setInt32(4, 3, true);
  const stop = new Uint8Array(8);
  stop.set([0x53, 0x74, 0x6f, 0x70], 0);
  const buf = handPrt({
    version: 2, count: COUNT, chunks: [unknown, stop],
    channels: [{ name: 'Position', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [i, 0, 0])],
  });
  const dec = await decodePrtFile(buf);
  check('4 v1.1 unknown chunk skipped, Stop honored', dec.ok === true, dec.error ?? '');
  if (dec.ok) check('4 missing Velocity filled with zero and reported',
    dec.report.filledChannels.length === 1 && dec.cache.velocities[0].every((x) => x === 0));
}
{
  // Foreign types: float64 Velocity, float16 Age (1.5 =
  // 0x3E00, -2 = 0xC000), int32 ID with non-index values,
  // a Color[3] channel (unrepresentable) and a scalar
  // Density channel (representable).
  const buf = handPrt({
    count: COUNT,
    channels: [
      { name: 'Position', type: 4, arity: 3 },
      { name: 'Velocity', type: 5, arity: 3 },
      { name: 'Age', type: 3, arity: 1 },
      { name: 'ID', type: 1, arity: 1 },
      { name: 'Color', type: 4, arity: 3 },
      { name: 'Density', type: 4, arity: 1 },
    ],
    values: [
      flat(COUNT, (i) => [i, 0, 0]),
      flat(COUNT, (i) => [0.1 * i, 2, 3]),
      flat(COUNT, (i) => [i % 2 === 0 ? 0x3e00 : 0xc000]),
      flat(COUNT, (i) => [1000 + i]),
      flat(COUNT, (i) => [1, 1, 1]),
      flat(COUNT, (i) => [i * 3]),
    ],
  });
  const dec = await decodePrtFile(buf);
  check('4 foreign-type file decodes', dec.ok === true, dec.error ?? '');
  if (dec.ok) {
    check('4 float64 Velocity converted and reported', Math.abs(dec.cache.velocities[0][3] - 0.1 * 1) < 1e-6
      && dec.report.convertedChannels.some((c) => c.name === 'Velocity' && c.fromType === 'float64'));
    const ageIdx = dec.cache.manifest.attributes.indexOf('age');
    check('4 float16 Age converted to the age column', ageIdx >= 0
      && dec.cache.attrFrames[ageIdx][0][0] === 1.5 && dec.cache.attrFrames[ageIdx][0][1] === -2
      && dec.report.convertedChannels.some((c) => c.name === 'Age' && c.fromType === 'float16'));
    check('4 foreign ID dropped and reported, never stored',
      dec.report.droppedChannels.some((d) => d.name === 'ID') && !dec.cache.manifest.attributes.includes('ID'));
    check('4 arity-3 custom dropped and reported, scalar custom kept',
      dec.report.droppedChannels.some((d) => d.name === 'Color')
      && dec.cache.manifest.attributes.includes('Density')
      && dec.cache.attrFrames[dec.cache.manifest.attributes.indexOf('Density')][0][4] === 12);
  }
}

// ── 5. Refusals state their reason ──────────────────────────
{
  const good = new Uint8Array(encodedFrames[0]);
  const badMagic = good.slice(); badMagic[1] = 0x51;
  check('5 bad magic refused', (await decodePrtFile(badMagic.buffer)).ok === false);
  const badVersion = good.slice(); new DataView(badVersion.buffer).setInt32(44, 3, true);
  const vRes = await decodePrtFile(badVersion.buffer);
  check('5 version 3 refused with reason', vRes.ok === false && vRes.error.includes('version'));
  const incomplete = handPrt({
    count: COUNT, countOverride: -1,
    channels: [{ name: 'Position', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [i, 0, 0])],
  });
  check('5 particle count -1 (incomplete) refused', (await decodePrtFile(incomplete)).ok === false);
  const nonSquare = handPrt({
    count: 8,
    channels: [{ name: 'Position', type: 4, arity: 3 }],
    values: [flat(8, (i) => [i, 0, 0])],
  });
  const nsRes = await decodePrtFile(nonSquare);
  check('5 non-square count refused with the texSize reason', nsRes.ok === false && nsRes.error.includes('平方数'), nsRes.error ?? '');
  const badReserved = handPrt({
    count: COUNT, reserved: 5,
    channels: [{ name: 'Position', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [i, 0, 0])],
  });
  check('5 reserved != 4 refused', (await decodePrtFile(badReserved)).ok === false);
  const badDefLen = handPrt({
    count: COUNT, defLength: 40,
    channels: [{ name: 'Position', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [i, 0, 0])],
  });
  check('5 channel def length != 44 refused', (await decodePrtFile(badDefLen)).ok === false);
  const noPosition = handPrt({
    count: COUNT,
    channels: [{ name: 'Velocity', type: 4, arity: 3 }],
    values: [flat(COUNT, (i) => [1, 2, 3])],
  });
  check('5 missing Position refused', (await decodePrtFile(noPosition)).ok === false);
  const truncated = good.slice(0, good.length - 6);
  check('5 truncated zlib stream refused', (await decodePrtFile(truncated.buffer)).ok === false);
  const tooShort = good.slice(0, 30);
  check('5 header-short file refused', (await decodePrtFile(tooShort.buffer)).ok === false);
  check('5 encode frame out of range refused', (await encodePrtFrame(cache, 3)).ok === false);
  check('5 empty sequence refused', (await decodePrtFiles([])).ok === false);
  // Sequence disagreement: different counts per file.
  const smallPositions = new Float32Array(2 * 2 * 4);
  const smallVelocities = new Float32Array(2 * 2 * 4);
  const other = assembleStateCache({ fps: 30, texSize: 2, frames: [{ positions: smallPositions, velocities: smallVelocities }], attributeNames: [] });
  check('5 small fixture assembles', other.ok === true, other.error ?? '');
  const otherEnc = await encodePrtFrame(other.cache, 0);
  const mixed = await decodePrtFiles([
    { name: 'a0000.prt', buffer: encodedFrames[0] },
    { name: 'a0001.prt', buffer: otherEnc.buffer },
  ]);
  check('5 sequence with mismatched counts refused', mixed.ok === false);
}

// ── 6. Export-side refusals + edition gate + names ──────────
{
  const badNameFrame = frameInput(0);
  badNameFrame.attributes = { 'bad name': new Float32Array(COUNT) };
  const badName = assembleStateCache({
    fps: 30, texSize: TEX, frames: [badNameFrame], attributeNames: ['bad name'],
  });
  // assembleStateCache accepts the name; the PRT layer must
  // refuse it (no silent rename).
  check('6 attribute name PRT cannot carry refused on export',
    badName.ok === true && (await encodePrtFrame(badName.cache, 0)).ok === false);
  const collision = assembleStateCache({
    fps: 30, texSize: TEX,
    frames: [{ positions: frameInput(0).positions, velocities: frameInput(0).velocities, attributes: { Position: new Float32Array(COUNT) } }],
    attributeNames: ['Position'],
  });
  check('6 attribute colliding with a reserved channel refused',
    collision.ok === true && (await encodePrtFrame(collision.cache, 0)).ok === false);
  check('6 public edition refused by the file builder', (await buildPrtFileForFrame(cache, 0, 'public')).ok === false);
  const full = await buildPrtFileForFrame(cache, 1, 'full');
  check('6 full edition builds with the sequence file name',
    full.ok === true && full.fileName === 'monosphere-state-cache-0001.prt', full.ok ? full.fileName : full.error);
  check('6 file name uses the absolute (startFrame + index) number',
    prtFileNameForFrame({ manifest: { ...cache.manifest, startFrame: 100 } }, 5) === 'monosphere-state-cache-0105.prt');
  check('6 frame number parsed back from names',
    prtFrameNumberFromFileName('monosphere-state-cache-0105.prt') === 105
    && prtFrameNumberFromFileName('no-number.prt') === null);
  // A cache with NO age attribute exports without an Age
  // channel and still round trips.
  const noAge = assembleStateCache({ fps: 30, texSize: TEX, frames: [frameInput(0)], attributeNames: ['heat'] });
  const enc = await encodePrtFrame(noAge.cache, 0);
  const dec = enc.ok ? await decodePrtFile(enc.buffer) : { ok: false };
  check('6 cache without age exports and round trips without an Age channel',
    enc.ok === true && dec.ok === true && dec.cache.manifest.attributes.join(',') === 'heat');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
