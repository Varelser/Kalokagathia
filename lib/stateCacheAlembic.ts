import {
  hashStateCacheFrame,
  stateCacheExportAllowed,
  type StateCacheData,
} from './gpgpuStateCache';

/**
 * Alembic exporter (Grammar 2.0 stage 3, slice S4): translate
 * the canonical frame-sequence form (lib/gpgpuStateCache.ts,
 * statecache-manifest-v1) into ONE Alembic (.abc) file
 * holding the whole sequence as time samples of a Points
 * object. Export only — reading .abc is out of this stage's
 * scope (STAGE3_DESIGN §2 S4). Design: STAGE3_DESIGN §4.5-1
 * (杉 decision: the user picks PRT or Alembic; PRT is slice
 * S3, lib/stateCachePrt.ts).
 *
 * Method decision (recorded in STAGE3_S4_IMPL_RECORD.md):
 * no practical browser-side Alembic WRITER exists on npm
 * (alembic-js is a native Node module and read-only;
 * alembic-web and three-alembic are readers/loaders), so
 * this is a self-contained minimal writer for the Ogawa
 * form, Points only. No product dependency was added.
 *
 * Format basis, verified against primary sources at
 * implementation time (no byte was written from memory):
 * - "Ogawa Specification", the Alembic project's official
 *   wiki (github.com/alembic/alembic/wiki/Ogawa-Specification):
 *   16-byte header ("Ogawa", frozen byte, version {0,1},
 *   root group offset), groups of u64 child refs (top bit
 *   set = Data), data streams of u64 size + bytes, empty
 *   group = offset 0, empty data = flagged offset 0. All
 *   little-endian, uncompressed.
 * - The AbcCoreOgawa meta-schema as implemented by the
 *   official library, read from the Alembic 1.8.8 sources
 *   (WriteUtil.cpp / AwImpl.cpp / ApwImpl.cpp / SpwImpl.cpp /
 *   CpwData.cpp / OwData.cpp / MetaDataMap.cpp) and
 *   cross-checked byte by byte against a reference file
 *   written by the official library itself (OPoints with
 *   velocities, ids and an arbGeomParam): archive root =
 *   [int32 ogawa file version 0, int32 library version,
 *   top object group, archive metadata, time samplings,
 *   indexed metadata]; object group = [compound group,
 *   child object groups..., headers + 32 bytes of hashes];
 *   compound group = [property groups..., property headers];
 *   array property group = (sample data, dims) pairs with
 *   rank-1 dims stored as empty data; every sample data
 *   stream is prefixed with its 16-byte MurmurHash3 digest.
 * - The Points schema (AbcGeom OPoints): the object's one
 *   top-compound property is the compound ".geom"
 *   (schema=AbcGeom_Points_v1) holding, in the library's
 *   own creation order: ".selfBnds" (a SCALAR float64[6]
 *   property — the per-frame bounds), "P" (float32[3]),
 *   ".pointIds" (uint64), ".arbGeomParams" (compound),
 *   ".velocities" (float32[3]).
 *
 * The hash chain is reproduced faithfully, not stubbed:
 * sample digests are MurmurHash3_x64_128 (seed 0 on
 * little-endian, per AbcCoreAbstract/ArraySample.cpp), and
 * the property / compound / object hashes in the headers
 * streams are SpookyHash V2 (short path) composed exactly
 * as AbcCoreOgawa composes them (HashPropertyHeader,
 * HashDimensions, ShortEnd mixing, OwData::writeHeaders).
 * Readers only consult these hashes through the
 * getPropertiesHash / getChildrenHash APIs (AbcDiff and
 * friends), but writing the true values keeps those APIs
 * honest. The writer's repeated-sample handling also
 * mirrors the library: a sample whose digest equals the
 * previous one is not stored again, and the header's
 * first/last changed indices describe the mapping (a
 * property whose samples never change is stored once and
 * flagged constant). Metadata is written inline (index
 * 0xff) rather than through the archive's indexed-metadata
 * stream, which therefore stays empty — both forms are
 * equally valid to readers.
 *
 * Attribute mapping — the ONE table, the Alembic twin of
 * PRT_CHANNEL_MAPPING (lib/stateCachePrt.ts), same
 * principles (values pass through unconverted; what the
 * canonical form does not hold is never invented silently):
 * - positions       -> "P" float32[3] array property of
 *   ".geom" (metadata geoScope=var;interpretation=point)
 * - velocities      -> ".velocities" float32[3]
 *   (interpretation=vector)
 * - attribute 'age' -> ".arbGeomParams" float GeomParam
 *   named 'age' (Alembic has no reserved age channel, so
 *   the canonical name is kept, unlike PRT's "Age")
 * - every other declared attribute, in manifest order
 *                  -> a float GeomParam of the same name
 *   in ".arbGeomParams"
 * - ".pointIds" uint64 is GENERATED from the particle
 *   index on export (the canonical form has no ID entity;
 *   particles ARE their index — same treatment as PRT's
 *   ID channel, documented here and in the panel text).
 * - ".selfBnds" float64[6] is DERIVED per frame from the
 *   positions (the bounds the official schema computes
 *   itself when the caller does not supply them).
 * Coordinates / units / fps are told through metadata,
 * never applied to the values: a uniform TimeSampling
 * (timePerCycle = 1/fps, first stored time =
 * startFrame/fps) that every property references, and the
 * schema metadata. (Alembic has no global up-axis / unit
 * declaration for points; Y-up meters is the canonical
 * form's own declaration and the values are written as
 * stored.)
 *
 * Export discipline, mirroring S3: only a cache that
 * passes the canonical form's own checks is converted —
 * the manifest must agree with the arrays, and every
 * frame's FNV-1a hash must match the manifest's
 * frameHashes. Anything else refuses with the reason.
 */

/* ---------------- format constants ---------------- */

/** ALEMBIC_OGAWA_FILE_VERSION (AbcCoreOgawa/Foundation.h). */
export const ALEMBIC_OGAWA_FILE_VERSION = 0;
/** The library version whose format this writer implements
 *  (Alembic 1.8.8 -> 1*10000 + 8*100 + 8). Written into the
 *  archive root as the format version stamp readers gate
 *  features on; this module is not the Alembic library and
 *  does not claim its _ai_AlembicVersion metadata key. */
export const ALEMBIC_FORMAT_LIBRARY_VERSION = 10808;
export const ALEMBIC_POINTS_OBJECT_NAME = 'particles';
export const ALEMBIC_FILE_NAME = 'monosphere-state-cache.abc';

/** PlainOldDataType codes (AbcCoreAbstract). */
const POD = {
  uint64: 7,
  float32: 10,
  float64: 11,
} as const;

/* ---------------- attribute mapping (the one table) ---------------- */

export interface AlembicChannelMappingEntry {
  /** Canonical side: 'positions' | 'velocities' | an
   *  attribute name | 'id' | 'bounds'. */
  canonical: string;
  alembicName: string;
  alembicType: string;
  /** 'stored' = the value lives in the canonical form;
   *  'generated' = produced on export from the index;
   *  'derived' = computed from stored values on export. */
  origin: 'stored' | 'generated' | 'derived';
  note: string;
}

export const ALEMBIC_CHANNEL_MAPPING: readonly AlembicChannelMappingEntry[] = [
  { canonical: 'positions', alembicName: 'P', alembicType: 'float32[3]', origin: 'stored', note: '位置。Points スキーマの必須プロパティ（.geom 直下）。' },
  { canonical: 'velocities', alembicName: '.velocities', alembicType: 'float32[3]', origin: 'stored', note: '速度。Points スキーマの標準プロパティ。' },
  { canonical: 'age', alembicName: '.arbGeomParams/age', alembicType: 'float32[1]', origin: 'stored', note: '年齢（属性列 "age"）。Alembic に予約済みの年齢チャンネルは無いため、正本の属性名そのまま GeomParam として書く（PRT の "Age" とは扱いが違う）。キャッシュが age 列を持つ場合のみ。' },
  { canonical: '(その他の属性列)', alembicName: '.arbGeomParams/(属性名そのまま)', alembicType: 'float32[1]', origin: 'stored', note: 'manifest の宣言順に同名の float GeomParam として書く。名前に "/" を含む属性は Alembic のプロパティ名にできないため、理由つきで拒否する（黙って改名しない）。' },
  { canonical: 'id', alembicName: '.pointIds', alembicType: 'uint64[1]', origin: 'generated', note: '正本形式に ID の実体は無い（粒子＝そのインデックス）ため、書き出し時に粒子インデックスから生成する。PRT の ID チャンネルと同じ扱い。' },
  { canonical: 'bounds', alembicName: '.selfBnds', alembicType: 'float64[6] (scalar)', origin: 'derived', note: 'フレームごとの位置の最小・最大から導出する境界。公式スキーマが呼び出し側から渡されない場合に自ら計算する値で、捏造ではなく位置からの決定的な導出。' },
];

/* ---------------- 64-bit helpers (BigInt) ---------------- */

const MASK64 = (1n << 64n) - 1n;
const rotl64 = (x: bigint, r: number): bigint =>
  ((x << BigInt(r)) | (x >> BigInt(64 - r))) & MASK64;

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[offset + i]);
  return v;
}

function writeU64LE(out: Uint8Array, offset: number, value: bigint): void {
  let v = value & MASK64;
  for (let i = 0; i < 8; i++) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

function u64PairToBytes(w0: bigint, w1: bigint): Uint8Array {
  const out = new Uint8Array(16);
  writeU64LE(out, 0, w0);
  writeU64LE(out, 8, w1);
  return out;
}

/* ---------------- MurmurHash3_x64_128 ---------------- */

/**
 * MurmurHash3_x64_128 exactly as Alembic's copy computes it
 * on little-endian platforms (Util/Murmur3.cpp): the seed
 * is 0 — the third C++ parameter is the POD size, used
 * only for big-endian byte swapping. Returns the digest
 * as two u64 words (the byte form is their LE packing).
 */
export function murmurHash3X64_128(data: Uint8Array): [bigint, bigint] {
  const c1 = 0x87c37b91114253d5n;
  const c2 = 0x4cf5ad432745937fn;
  let h1 = 0n;
  let h2 = 0n;
  const nblocks = Math.floor(data.length / 16);
  for (let i = 0; i < nblocks; i++) {
    let k1 = readU64LE(data, i * 16);
    let k2 = readU64LE(data, i * 16 + 8);
    k1 = (k1 * c1) & MASK64;
    k1 = rotl64(k1, 31);
    k1 = (k1 * c2) & MASK64;
    h1 ^= k1;
    h1 = rotl64(h1, 27);
    h1 = (h1 + h2) & MASK64;
    h1 = (h1 * 5n + 0x52dce729n) & MASK64;
    k2 = (k2 * c2) & MASK64;
    k2 = rotl64(k2, 33);
    k2 = (k2 * c1) & MASK64;
    h2 ^= k2;
    h2 = rotl64(h2, 31);
    h2 = (h2 + h1) & MASK64;
    h2 = (h2 * 5n + 0x38495ab5n) & MASK64;
  }
  const tail = nblocks * 16;
  const rem = data.length & 15;
  let k1 = 0n;
  let k2 = 0n;
  if (rem >= 9) {
    for (let j = 8; j < rem; j++) k2 ^= BigInt(data[tail + j]) << BigInt((j - 8) * 8);
    k2 = (k2 * c2) & MASK64;
    k2 = rotl64(k2, 33);
    k2 = (k2 * c1) & MASK64;
    h2 ^= k2;
  }
  if (rem >= 1) {
    const upto = Math.min(rem, 8);
    for (let j = 0; j < upto; j++) k1 ^= BigInt(data[tail + j]) << BigInt(j * 8);
    k1 = (k1 * c1) & MASK64;
    k1 = rotl64(k1, 31);
    k1 = (k1 * c2) & MASK64;
    h1 ^= k1;
  }
  const len = BigInt(data.length);
  h1 ^= len;
  h2 ^= len;
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  const fmix = (h: bigint): bigint => {
    h ^= h >> 33n;
    h = (h * 0xff51afd7ed558ccdn) & MASK64;
    h ^= h >> 33n;
    h = (h * 0xc4ceb9fe1a85ec53n) & MASK64;
    h ^= h >> 33n;
    return h;
  };
  h1 = fmix(h1);
  h2 = fmix(h2);
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  return [h1, h2];
}

/* ---------------- SpookyHash V2 (short path) ---------------- */

const SPOOKY_CONST = 0xdeadbeefdeadbeefn;
/** sc_bufSize: at or above this total length the streaming
 *  hash switches to the long path. Every hash this writer
 *  composes stays far below it (names + metadata + at most
 *  8 attribute hash words), so only the short path is
 *  implemented; exceeding it is an internal error. */
const SPOOKY_BUF_SIZE = 192;

function spookyShortMix(a: bigint, b: bigint, c: bigint, d: bigint): [bigint, bigint, bigint, bigint] {
  c = rotl64(c, 50); c = (c + d) & MASK64; a ^= c;
  d = rotl64(d, 52); d = (d + a) & MASK64; b ^= d;
  a = rotl64(a, 30); a = (a + b) & MASK64; c ^= a;
  b = rotl64(b, 41); b = (b + c) & MASK64; d ^= b;
  c = rotl64(c, 54); c = (c + d) & MASK64; a ^= c;
  d = rotl64(d, 48); d = (d + a) & MASK64; b ^= d;
  a = rotl64(a, 38); a = (a + b) & MASK64; c ^= a;
  b = rotl64(b, 37); b = (b + c) & MASK64; d ^= b;
  c = rotl64(c, 62); c = (c + d) & MASK64; a ^= c;
  d = rotl64(d, 34); d = (d + a) & MASK64; b ^= d;
  a = rotl64(a, 5); a = (a + b) & MASK64; c ^= a;
  b = rotl64(b, 36); b = (b + c) & MASK64; d ^= b;
  return [a, b, c, d];
}

function spookyShortEnd(a: bigint, b: bigint, c: bigint, d: bigint): [bigint, bigint, bigint, bigint] {
  d ^= c; c = rotl64(c, 15); d = (d + c) & MASK64;
  a ^= d; d = rotl64(d, 52); a = (a + d) & MASK64;
  b ^= a; a = rotl64(a, 26); b = (b + a) & MASK64;
  c ^= b; b = rotl64(b, 51); c = (c + b) & MASK64;
  d ^= c; c = rotl64(c, 28); d = (d + c) & MASK64;
  a ^= d; d = rotl64(d, 9); a = (a + d) & MASK64;
  b ^= a; a = rotl64(a, 47); b = (b + a) & MASK64;
  c ^= b; b = rotl64(b, 54); c = (c + b) & MASK64;
  d ^= c; c = rotl64(c, 32); d = (d + c) & MASK64;
  a ^= d; d = rotl64(d, 25); a = (a + d) & MASK64;
  b ^= a; a = rotl64(a, 63); b = (b + a) & MASK64;
  return [a, b, c, d];
}

/** SpookyHash::Short (Util/SpookyV2.cpp), seeds included. */
export function spookyHashShort(data: Uint8Array, seed1: bigint, seed2: bigint): [bigint, bigint] {
  let a = seed1;
  let b = seed2;
  let c = SPOOKY_CONST;
  let d = SPOOKY_CONST;
  const length = data.length;
  let pos = 0;
  if (length > 15) {
    const end = Math.floor(length / 32) * 32;
    for (; pos < end; pos += 32) {
      c = (c + readU64LE(data, pos)) & MASK64;
      d = (d + readU64LE(data, pos + 8)) & MASK64;
      [a, b, c, d] = spookyShortMix(a, b, c, d);
      a = (a + readU64LE(data, pos + 16)) & MASK64;
      b = (b + readU64LE(data, pos + 24)) & MASK64;
    }
    if (length - pos >= 16) {
      c = (c + readU64LE(data, pos)) & MASK64;
      d = (d + readU64LE(data, pos + 8)) & MASK64;
      [a, b, c, d] = spookyShortMix(a, b, c, d);
      pos += 16;
    }
  }
  const remainder = length - pos;
  d = (d + (BigInt(length) << 56n)) & MASK64;
  // The C++ switch falls through (15 -> 14 -> 13 -> 12,
  // 11 -> 10 -> 9 -> 8, 7 -> 6 -> 5 -> 4, 3 -> 2 -> 1);
  // the branches below reproduce it case by case. u32
  // reads are assembled unsigned (JS bitwise ops are
  // signed 32-bit and would corrupt the top byte).
  const tailU32 = (at: number): bigint => BigInt(
    data[pos + at] + data[pos + at + 1] * 256
    + data[pos + at + 2] * 65536 + data[pos + at + 3] * 16777216,
  );
  const tailByte = (at: number, shift: number): bigint => BigInt(data[pos + at]) << BigInt(shift);
  if (remainder >= 12) {
    if (remainder === 15) d = (d + tailByte(14, 48)) & MASK64;
    if (remainder >= 14) d = (d + tailByte(13, 40)) & MASK64;
    if (remainder >= 13) d = (d + tailByte(12, 32)) & MASK64;
    d = (d + tailU32(8)) & MASK64;
    c = (c + readU64LE(data, pos)) & MASK64;
  } else if (remainder >= 8) {
    if (remainder === 11) d = (d + tailByte(10, 16)) & MASK64;
    if (remainder >= 10) d = (d + tailByte(9, 8)) & MASK64;
    if (remainder >= 9) d = (d + BigInt(data[pos + 8])) & MASK64;
    c = (c + readU64LE(data, pos)) & MASK64;
  } else if (remainder >= 4) {
    if (remainder === 7) c = (c + tailByte(6, 48)) & MASK64;
    if (remainder >= 6) c = (c + tailByte(5, 40)) & MASK64;
    if (remainder >= 5) c = (c + tailByte(4, 32)) & MASK64;
    c = (c + tailU32(0)) & MASK64;
  } else if (remainder >= 1) {
    if (remainder === 3) c = (c + tailByte(2, 16)) & MASK64;
    if (remainder >= 2) c = (c + tailByte(1, 8)) & MASK64;
    c = (c + BigInt(data[pos])) & MASK64;
  } else {
    c = (c + SPOOKY_CONST) & MASK64;
    d = (d + SPOOKY_CONST) & MASK64;
  }
  [a, b] = spookyShortEnd(a, b, c, d);
  return [a, b];
}

/** The streaming SpookyHash as AbcCoreOgawa uses it:
 *  Init(0,0), any number of Updates, Final. All inputs in
 *  this writer stay below sc_bufSize, where Update simply
 *  buffers and Final runs Short over the whole input. */
export class SpookyHash128 {
  private chunks: Uint8Array[] = [];
  private total = 0;

  update(data: Uint8Array): void {
    this.chunks.push(data);
    this.total += data.length;
    if (this.total >= SPOOKY_BUF_SIZE) {
      throw new Error('SpookyHash128: input reached the long-path threshold (internal error)');
    }
  }

  final(): [bigint, bigint] {
    const all = new Uint8Array(this.total);
    let o = 0;
    for (const chunk of this.chunks) {
      all.set(chunk, o);
      o += chunk.length;
    }
    return spookyHashShort(all, 0n, 0n);
  }
}

/** HashDimensions (WriteUtil.cpp): fold the dimensions
 *  into a sample digest for the property-hash chain. */
function hashDimensions(dims: bigint[], digest: [bigint, bigint]): [bigint, bigint] {
  const hash = new SpookyHash128();
  const dimsBytes = new Uint8Array(dims.length * 8);
  dims.forEach((d, i) => writeU64LE(dimsBytes, i * 8, d));
  hash.update(dimsBytes);
  hash.update(u64PairToBytes(digest[0], digest[1]));
  return hash.final();
}

/** The static ShortEnd mixing ApwImpl / SpwImpl apply to
 *  fold each sample digest into the accumulated hash. */
function spookyMixDigest(acc: [bigint, bigint], digest: [bigint, bigint]): [bigint, bigint] {
  const [a, b] = spookyShortEnd(acc[0], acc[1], digest[0], digest[1]);
  return [a, b];
}

/* ---------------- metadata ---------------- */

/** MetaData::serialize(): keys sorted, "k=v;k=v". */
function serializeMetaData(entries: Record<string, string>): string {
  return Object.keys(entries)
    .sort()
    .map((k) => `${k}=${entries[k]}`)
    .join(';');
}

const GEOM_SCOPE_METADATA = { geoScope: 'var' };
const POINTS_SCHEMA_METADATA = {
  schema: 'AbcGeom_Points_v1',
  schemaBaseType: 'AbcGeom_GeomBase_v1',
};
const POINTS_OBJECT_METADATA = {
  ...POINTS_SCHEMA_METADATA,
  schemaObjTitle: 'AbcGeom_Points_v1:.geom',
};
const GEOM_PARAM_METADATA = {
  arrayExtent: '1',
  geoScope: 'var',
  isGeomParam: 'true',
  podExtent: '1',
  podName: 'float32_t',
};
/** What this writer honestly stamps as the archive
 *  metadata: the producing application. (The official
 *  library additionally stamps _ai_AlembicVersion with
 *  its own build string; this writer is not that library
 *  and does not claim the key.) */
const ARCHIVE_METADATA = { application: 'Monosphere (Kalokagathia)' };

/* ---------------- Ogawa tree ---------------- */

type OgawaNode =
  | { kind: 'data'; bytes: Uint8Array }
  | { kind: 'group'; children: OgawaNode[] };

const emptyDataNode = (): OgawaNode => ({ kind: 'data', bytes: new Uint8Array(0) });
const dataNode = (bytes: Uint8Array): OgawaNode => ({ kind: 'data', bytes });
const groupNode = (children: OgawaNode[]): OgawaNode => ({ kind: 'group', children });

const DATA_FLAG = 1n << 63n;

/** Assign offsets and serialize: header (16 bytes, root
 *  offset patched in at the end), then every node in
 *  first-encounter order — data streams as size + bytes,
 *  groups as child count + child refs. Shared node objects
 *  (sample dedup / copies) serialize once and are
 *  referenced from every parent, exactly like Ogawa's
 *  OData sharing. An empty group is referenced as 0 and
 *  never written; an empty data stream as the flagged 0. */
function serializeOgawa(root: OgawaNode): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  const emit = (bytes: Uint8Array) => {
    chunks.push(bytes);
    cursor += bytes.length;
  };
  const header = new Uint8Array(16);
  header.set([0x4f, 0x67, 0x61, 0x77, 0x61], 0); // "Ogawa"
  header[5] = 0xff; // frozen (the file is complete)
  header[6] = 0;
  header[7] = 1; // Ogawa version {0, 1}
  emit(header);
  const offsets = new Map<OgawaNode, bigint>();
  const serializeNode = (node: OgawaNode): bigint => {
    const seen = offsets.get(node);
    if (seen !== undefined) return seen;
    if (node.kind === 'group' && node.children.length === 0) {
      offsets.set(node, 0n);
      return 0n;
    }
    if (node.kind === 'data' && node.bytes.length === 0) {
      offsets.set(node, DATA_FLAG);
      return DATA_FLAG;
    }
    // Reserve the offset before recursing so a shared
    // node can never be laid out twice.
    const myOffset = BigInt(cursor);
    offsets.set(node, node.kind === 'data' ? myOffset | DATA_FLAG : myOffset);
    if (node.kind === 'data') {
      const sizeWord = new Uint8Array(8);
      writeU64LE(sizeWord, 0, BigInt(node.bytes.length));
      emit(sizeWord);
      emit(node.bytes);
    } else {
      const refs: bigint[] = node.children.map((child) => serializeNode(child));
      const table = new Uint8Array(8 + refs.length * 8);
      writeU64LE(table, 0, BigInt(refs.length));
      refs.forEach((ref, i) => writeU64LE(table, 8 + i * 8, ref));
      // The group's own bytes go AFTER its children in
      // this layout; its recorded offset must therefore
      // be where the table lands, not where we started.
      offsets.set(node, BigInt(cursor));
      emit(table);
    }
    return offsets.get(node)!;
  };
  const rootOffset = serializeNode(root);
  writeU64LE(header, 8, rootOffset & ~DATA_FLAG);
  const out = new Uint8Array(cursor);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out.buffer;
}

/* ---------------- property model ---------------- */

interface TimeSamplingInfo {
  /** Serialized into the archive's time-sampling stream. */
  maxSample: number;
  timePerCycle: number;
  storedTimes: number[];
}

interface PropertyBuild {
  /** The property's Ogawa group node. */
  node: OgawaNode;
  /** Serialized header bytes (WritePropertyInfo). */
  headerBytes: Uint8Array;
  /** The property hash (16 bytes) for the parent chain. */
  hash: [bigint, bigint];
}

const textEncoder = new TextEncoder();

function pushUintWithHint(out: number[], value: number, hint: number): void {
  out.push(value & 0xff);
  if (hint >= 1) out.push((value >> 8) & 0xff);
  if (hint >= 2) {
    out.push((value >> 16) & 0xff);
    out.push((value >> 24) & 0xff);
  }
}

function sizeHintFor(maxValue: number): number {
  if (maxValue > 255 && maxValue < 65536) return 1;
  if (maxValue >= 65536) return 2;
  return 0;
}

/**
 * WritePropertyInfo (WriteUtil.cpp). Metadata is always
 * written inline (index 0xff) except empty metadata,
 * which is index 0; the indexed-metadata stream therefore
 * stays empty. isScalarLike is folded into the type bits
 * exactly as the library does (array + scalarlike = 3,
 * which readers decode as array with isScalarLike set).
 */
function writePropertyHeader(args: {
  name: string;
  metaData: string;
  propertyType: 0 | 1 | 2; // compound | scalar | array
  isScalarLike: boolean;
  isHomogenous: boolean;
  pod: number;
  extent: number;
  timeSamplingIndex: number;
  numSamples: number;
  firstChangedIndex: number;
  lastChangedIndex: number;
}): Uint8Array {
  const { name, metaData } = args;
  const nameSize = textEncoder.encode(name).length;
  const metaDataSize = textEncoder.encode(metaData).length;
  let maxSize = Math.max(metaDataSize, nameSize);
  if (args.propertyType !== 0) {
    maxSize = Math.max(maxSize, args.numSamples, args.timeSamplingIndex);
  }
  const sizeHint = sizeHintFor(maxSize);
  let info = 0;
  info |= (sizeHint << 2) & 0x000c;
  const metaDataIndex = metaDataSize === 0 ? 0 : 0xff;
  info |= (metaDataIndex << 20) & 0xff00000;
  if (args.propertyType !== 0) {
    info |= args.propertyType & 0x0003;
    if (args.isScalarLike) info |= 1;
    info |= (args.pod << 4) & 0x00f0;
    if (args.timeSamplingIndex !== 0) info |= 0x0100;
    let needsFirstLast = false;
    if (args.firstChangedIndex === 0 && args.lastChangedIndex === 0) {
      info |= 0x0800;
    } else if (args.firstChangedIndex !== 1 || args.lastChangedIndex !== args.numSamples - 1) {
      info |= 0x0200;
      needsFirstLast = true;
    }
    info |= (args.extent << 12) & 0xff000;
    if (args.isHomogenous) info |= 0x0400;
    const out: number[] = [];
    pushUintWithHint(out, info, 2);
    pushUintWithHint(out, args.numSamples, sizeHint);
    if (needsFirstLast) {
      pushUintWithHint(out, args.firstChangedIndex, sizeHint);
      pushUintWithHint(out, args.lastChangedIndex, sizeHint);
    }
    if (args.timeSamplingIndex !== 0) {
      pushUintWithHint(out, args.timeSamplingIndex, sizeHint);
    }
    pushUintWithHint(out, nameSize, sizeHint);
    out.push(...textEncoder.encode(name));
    if (metaDataIndex === 0xff) {
      pushUintWithHint(out, metaDataSize, sizeHint);
      out.push(...textEncoder.encode(metaData));
    }
    return new Uint8Array(out);
  }
  // Compound: just the info word (always 4 bytes), then
  // name size + name and any inline metadata, all at the
  // computed size hint (WritePropertyInfo's tail, shared
  // with the non-compound path).
  const out: number[] = [];
  pushUintWithHint(out, info, 2);
  pushUintWithHint(out, nameSize, sizeHint);
  out.push(...textEncoder.encode(name));
  if (metaDataIndex === 0xff) {
    pushUintWithHint(out, metaDataSize, sizeHint);
    out.push(...textEncoder.encode(metaData));
  }
  return new Uint8Array(out);
}

/** HashPropertyHeader (WriteUtil.cpp): name + serialized
 *  metadata, then for non-compounds the pod / extent (and
 *  a 0 marker for scalars) and the time sampling's stored
 *  shape (timePerCycle f64, stored-time count u32,
 *  stored times f64 each). */
function hashPropertyHeader(
  hash: SpookyHash128,
  args: { name: string; metaData: string; pod?: number; extent?: number; isScalar?: boolean },
  timeSampling: TimeSamplingInfo,
): void {
  const data: number[] = [];
  data.push(...textEncoder.encode(args.name));
  data.push(...textEncoder.encode(args.metaData));
  if (args.pod !== undefined && args.extent !== undefined) {
    data.push(args.pod & 0xff);
    data.push(args.extent & 0xff);
    if (args.isScalar) data.push(0);
    const tpc = new Uint8Array(8);
    new DataView(tpc.buffer).setFloat64(0, timeSampling.timePerCycle, true);
    data.push(...tpc);
    const spc = new Uint8Array(4);
    new DataView(spc.buffer).setUint32(0, timeSampling.storedTimes.length, true);
    data.push(...spc);
    for (const t of timeSampling.storedTimes) {
      const tb = new Uint8Array(8);
      new DataView(tb.buffer).setFloat64(0, t, true);
      data.push(...tb);
    }
  }
  if (data.length > 0) hash.update(new Uint8Array(data));
}

/** The archive-wide written-sample map (WriteData's
 *  dedup): identical digests share one Ogawa data node. */
class WrittenSampleMap {
  private map = new Map<string, OgawaNode>();

  nodeFor(digest: [bigint, bigint], rawBytes: Uint8Array): OgawaNode {
    const key = `${digest[0].toString(16)}:${digest[1].toString(16)}:${rawBytes.length}`;
    const existing = this.map.get(key);
    if (existing) return existing;
    const payload = new Uint8Array(16 + rawBytes.length);
    payload.set(u64PairToBytes(digest[0], digest[1]), 0);
    payload.set(rawBytes, 16);
    const node = dataNode(payload);
    this.map.set(key, node);
    return node;
  }
}

interface SampleStorage {
  /** Ogawa children for the property group, in order. */
  children: OgawaNode[];
  firstChangedIndex: number;
  lastChangedIndex: number;
  /** The accumulated sample hash (m_hash) over ALL set
   *  samples, repeats included. */
  accHash: [bigint, bigint] | null;
}

/**
 * The library's sample-storage algorithm (ApwImpl /
 * SpwImpl setSample + setFromPreviousSample), shared by
 * array and scalar properties: a sample is stored when it
 * is the first or its digest differs from the previous
 * sample's; when a change lands after a run of repeats,
 * copies of the previous stored sample fill the gap from
 * lastChanged+1 (the reader's index mapping makes the
 * head run before firstChanged collapse onto sample 0, so
 * no copies are written for it). Every set sample folds
 * its digest into the accumulated hash, stored or not.
 * `foldDims` selects the array flavour (HashDimensions
 * before mixing) vs the scalar flavour (raw digest).
 */
function storeSamples(
  samples: Uint8Array[],
  sampleMap: WrittenSampleMap,
  withDims: boolean,
  dimsOf: (sampleIndex: number) => bigint[],
): SampleStorage {
  const children: OgawaNode[] = [];
  let firstChangedIndex = 0;
  let lastChangedIndex = 0;
  let prevDigest: [bigint, bigint] | null = null;
  let prevNode: OgawaNode | null = null;
  let accHash: [bigint, bigint] | null = null;
  for (let i = 0; i < samples.length; i++) {
    const digest = murmurHash3X64_128(samples[i]);
    const changed = i === 0 || prevDigest === null
      || digest[0] !== prevDigest[0] || digest[1] !== prevDigest[1];
    if (changed) {
      if (firstChangedIndex !== 0) {
        for (let s = lastChangedIndex + 1; s < i; s++) {
          children.push(prevNode!);
          if (withDims) children.push(emptyDataNode());
        }
      }
      prevNode = sampleMap.nodeFor(digest, samples[i]);
      children.push(prevNode);
      if (withDims) children.push(emptyDataNode());
      if (firstChangedIndex === 0) firstChangedIndex = i;
      lastChangedIndex = i;
    }
    const folded = withDims ? hashDimensions(dimsOf(i), digest) : digest;
    accHash = accHash === null ? folded : spookyMixDigest(accHash, folded);
    prevDigest = digest;
  }
  return { children, firstChangedIndex, lastChangedIndex, accHash };
}

function buildArrayProperty(args: {
  name: string;
  metaData: string;
  pod: number;
  extent: number;
  samples: Uint8Array[];
  /** Points per sample (values / extent). */
  numPoints: number;
  timeSamplingIndex: number;
  timeSampling: TimeSamplingInfo;
  sampleMap: WrittenSampleMap;
}): PropertyBuild {
  const storage = storeSamples(args.samples, args.sampleMap, true,
    () => [BigInt(args.numPoints)]);
  // isScalarLike turns false at the first stored sample
  // whose numPoints != 1 (ApwImpl); our counts are
  // constant across frames, so this is a single test.
  const isScalarLike = args.numPoints === 1;
  // isHomogenous, replicating ApwImpl exactly: it compares
  // the just-stored sample's numPoints against the stored
  // sample's recorded count, which WriteData records as
  // extent * numPoints — so an extent > 1 array with any
  // points always ends non-homogenous (an upstream quirk,
  // reproduced so the headers match the library's own).
  const isHomogenous = !(args.extent > 1 && args.numPoints > 0);
  const headerBytes = writePropertyHeader({
    name: args.name, metaData: args.metaData, propertyType: 2,
    isScalarLike, isHomogenous, pod: args.pod, extent: args.extent,
    timeSamplingIndex: args.timeSamplingIndex,
    numSamples: args.samples.length,
    firstChangedIndex: storage.firstChangedIndex,
    lastChangedIndex: storage.lastChangedIndex,
  });
  const hash = new SpookyHash128();
  hashPropertyHeader(hash, { name: args.name, metaData: args.metaData, pod: args.pod, extent: args.extent, isScalar: false }, args.timeSampling);
  if (storage.accHash) hash.update(u64PairToBytes(storage.accHash[0], storage.accHash[1]));
  return { node: groupNode(storage.children), headerBytes, hash: hash.final() };
}

function buildScalarProperty(args: {
  name: string;
  metaData: string;
  pod: number;
  extent: number;
  samples: Uint8Array[];
  timeSamplingIndex: number;
  timeSampling: TimeSamplingInfo;
  sampleMap: WrittenSampleMap;
}): PropertyBuild {
  const storage = storeSamples(args.samples, args.sampleMap, false, () => []);
  const headerBytes = writePropertyHeader({
    name: args.name, metaData: args.metaData, propertyType: 1,
    isScalarLike: true, isHomogenous: true, pod: args.pod, extent: args.extent,
    timeSamplingIndex: args.timeSamplingIndex,
    numSamples: args.samples.length,
    firstChangedIndex: storage.firstChangedIndex,
    lastChangedIndex: storage.lastChangedIndex,
  });
  const hash = new SpookyHash128();
  hashPropertyHeader(hash, { name: args.name, metaData: args.metaData, pod: args.pod, extent: args.extent, isScalar: true }, args.timeSampling);
  if (storage.accHash) hash.update(u64PairToBytes(storage.accHash[0], storage.accHash[1]));
  return { node: groupNode(storage.children), headerBytes, hash: hash.final() };
}

function buildCompoundProperty(args: {
  name: string;
  metaData: string;
  properties: PropertyBuild[];
}): PropertyBuild {
  const children: OgawaNode[] = args.properties.map((p) => p.node);
  const headers = concatBytes(args.properties.map((p) => p.headerBytes));
  if (headers.length > 0) children.push(dataNode(headers));
  const headerBytes = writePropertyHeader({
    name: args.name, metaData: args.metaData, propertyType: 0,
    isScalarLike: true, isHomogenous: true, pod: 0, extent: 0,
    timeSamplingIndex: 0, numSamples: 0, firstChangedIndex: 0, lastChangedIndex: 0,
  });
  // CpwImpl: computeHash over the child hash words FIRST,
  // then HashPropertyHeader over this compound's own
  // name + metadata.
  const hash = new SpookyHash128();
  if (args.properties.length > 0) {
    hash.update(concatBytes(args.properties.map((p) => u64PairToBytes(p.hash[0], p.hash[1]))));
  }
  hashPropertyHeader(hash, { name: args.name, metaData: args.metaData },
    { maxSample: 0, timePerCycle: 1, storedTimes: [0] });
  return { node: groupNode(children), headerBytes, hash: hash.final() };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ---------------- object model ---------------- */

function writeObjectHeader(name: string, metaData: string): Uint8Array {
  const out: number[] = [];
  pushUintWithHint(out, textEncoder.encode(name).length, 2);
  out.push(...textEncoder.encode(name));
  const metaDataIndex = metaData.length === 0 ? 0 : 0xff;
  out.push(metaDataIndex);
  if (metaDataIndex === 0xff) {
    pushUintWithHint(out, textEncoder.encode(metaData).length, 2);
    out.push(...textEncoder.encode(metaData));
  }
  return new Uint8Array(out);
}

/* ---------------- cache validation ---------------- */

export type AlembicEncodeResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; error: string };

const fail = (error: string): AlembicEncodeResult => ({ ok: false, error });

/**
 * The conversion precondition (the S3 discipline): the
 * cache must satisfy the canonical form's own checks —
 * manifest/array agreement and the per-frame FNV-1a
 * hashes — or the export refuses with the reason. A
 * hand-assembled or corrupted cache is never written out
 * as if it were a valid one.
 */
export function validateCacheForAlembicExport(cache: StateCacheData): { ok: true } | { ok: false; error: string } {
  const { manifest } = cache;
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'マニフェストがありません。' };
  if (manifest.format !== 'statecache-manifest-v1' || manifest.version !== 1) {
    return { ok: false, error: `正本形式（statecache-manifest-v1）ではないため、Alembic へ変換できません（format="${String(manifest.format)}"、version=${String(manifest.version)}）。` };
  }
  if (!Number.isFinite(manifest.fps) || manifest.fps <= 0) {
    return { ok: false, error: 'マニフェストの fps が不正なため、Alembic へ変換できません。' };
  }
  if (manifest.texSize * manifest.texSize !== manifest.count) {
    return { ok: false, error: 'マニフェストの texSize と count が一致しないため、Alembic へ変換できません。' };
  }
  if (cache.positions.length !== manifest.frameCount || cache.velocities.length !== manifest.frameCount) {
    return { ok: false, error: 'フレーム列の長さがマニフェストの frameCount と一致しないため、Alembic へ変換できません。' };
  }
  if (cache.attrFrames.length !== manifest.attributes.length) {
    return { ok: false, error: '属性列の数がマニフェストの attributes と一致しないため、Alembic へ変換できません。' };
  }
  for (let a = 0; a < manifest.attributes.length; a++) {
    const name = manifest.attributes[a];
    if (name.includes('/')) {
      return { ok: false, error: `属性 "${name}" の名前に "/" が含まれ、Alembic のプロパティ名として書けません。黙って改名はしないため、Alembic 書き出しを中止しました。` };
    }
    if (cache.attrFrames[a].length !== manifest.frameCount) {
      return { ok: false, error: `属性 "${name}" のフレーム数がマニフェストと一致しないため、Alembic へ変換できません。` };
    }
  }
  for (let f = 0; f < manifest.frameCount; f++) {
    const pos = cache.positions[f];
    const vel = cache.velocities[f];
    if (pos.length !== manifest.count * 3 || vel.length !== manifest.count * 3) {
      return { ok: false, error: `フレーム ${f} の位置・速度の長さが粒子数と一致しないため、Alembic へ変換できません。` };
    }
    for (let a = 0; a < manifest.attributes.length; a++) {
      if (cache.attrFrames[a][f].length !== manifest.count) {
        return { ok: false, error: `フレーム ${f} の属性 "${manifest.attributes[a]}" の長さが粒子数と一致しないため、Alembic へ変換できません。` };
      }
    }
    if (hashStateCacheFrame(pos, vel) !== manifest.frameHashes[f]) {
      return { ok: false, error: `フレーム ${f} のハッシュがマニフェストと一致しないため、Alembic へ変換できません（正本形式の検証を通ったキャッシュだけを変換します）。` };
    }
  }
  return { ok: true };
}

/* ---------------- the encoder ---------------- */

function float32Bytes(values: Float32Array): Uint8Array {
  return new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
}

function boundsOf(positions: Float32Array): Float64Array {
  const box = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < box[k]) box[k] = v;
      if (v > box[k + 3]) box[k + 3] = v;
    }
  }
  return box;
}

/**
 * Encode a whole canonical cache as one Alembic (.abc)
 * file: a uniform TimeSampling over all frames and one
 * Points object ("particles") whose ".geom" compound
 * carries every frame as a sample. Values are written
 * exactly as stored (float32 stays float32; the bounds
 * are the float64 the schema computes).
 */
export function encodeAlembic(cache: StateCacheData): AlembicEncodeResult {
  const valid = validateCacheForAlembicExport(cache);
  if (!valid.ok) return fail(valid.error);
  const { manifest } = cache;
  const count = manifest.count;
  const frameCount = manifest.frameCount;

  const timeSampling: TimeSamplingInfo = {
    maxSample: frameCount,
    timePerCycle: 1 / manifest.fps,
    storedTimes: [manifest.startFrame / manifest.fps],
  };
  const defaultTimeSampling: TimeSamplingInfo = {
    maxSample: 0, timePerCycle: 1, storedTimes: [0],
  };
  const TS_INDEX = 1;
  const sampleMap = new WrittenSampleMap();

  // Per-frame raw sample bytes for every property.
  const positionSamples = cache.positions.map((p) => float32Bytes(p));
  const velocitySamples = cache.velocities.map((v) => float32Bytes(v));
  const idSamples: Uint8Array[] = [];
  const boundsSamples: Uint8Array[] = [];
  for (let f = 0; f < frameCount; f++) {
    const ids = new BigUint64Array(count);
    for (let i = 0; i < count; i++) ids[i] = BigInt(i);
    idSamples.push(new Uint8Array(ids.buffer));
    const bounds = boundsOf(cache.positions[f]);
    boundsSamples.push(new Uint8Array(bounds.buffer, bounds.byteOffset, bounds.byteLength));
  }

  const selfBnds = buildScalarProperty({
    name: '.selfBnds', metaData: serializeMetaData({ interpretation: 'box' }),
    pod: POD.float64, extent: 6, samples: boundsSamples,
    timeSamplingIndex: TS_INDEX, timeSampling, sampleMap,
  });
  const positions = buildArrayProperty({
    name: 'P', metaData: serializeMetaData({ ...GEOM_SCOPE_METADATA, interpretation: 'point' }),
    pod: POD.float32, extent: 3, samples: positionSamples, numPoints: count,
    timeSamplingIndex: TS_INDEX, timeSampling, sampleMap,
  });
  const pointIds = buildArrayProperty({
    name: '.pointIds', metaData: serializeMetaData(GEOM_SCOPE_METADATA),
    pod: POD.uint64, extent: 1, samples: idSamples, numPoints: count,
    timeSamplingIndex: TS_INDEX, timeSampling, sampleMap,
  });
  const velocities = buildArrayProperty({
    name: '.velocities', metaData: serializeMetaData({ interpretation: 'vector' }),
    pod: POD.float32, extent: 3, samples: velocitySamples, numPoints: count,
    timeSamplingIndex: TS_INDEX, timeSampling, sampleMap,
  });

  const geomProperties: PropertyBuild[] = [selfBnds, positions, pointIds];
  let arbGeomParams: PropertyBuild | null = null;
  if (manifest.attributes.length > 0) {
    const params = manifest.attributes.map((name, a) => buildArrayProperty({
      name, metaData: serializeMetaData(GEOM_PARAM_METADATA),
      pod: POD.float32, extent: 1,
      samples: cache.attrFrames[a].map((col) => float32Bytes(col)),
      numPoints: count,
      timeSamplingIndex: TS_INDEX, timeSampling, sampleMap,
    }));
    arbGeomParams = buildCompoundProperty({
      name: '.arbGeomParams', metaData: '', properties: params,
    });
    geomProperties.push(arbGeomParams);
  }
  geomProperties.push(velocities);

  const geom = buildCompoundProperty({
    name: '.geom', metaData: serializeMetaData(POINTS_SCHEMA_METADATA),
    properties: geomProperties,
  });

  // The Points object's top compound holds exactly one
  // property: ".geom" itself.
  const topCompound = buildCompoundProperty({
    name: '', metaData: '', properties: [geom],
  });

  // Object assembly (OwData): group = [compound group,
  // child object groups..., headers data]. The headers
  // data = child object headers + properties hash +
  // children hash (32 bytes).
  const buildObjectNode = (args: {
    compound: PropertyBuild;
    compoundChildHashes: [bigint, bigint][];
    children: { node: OgawaNode; name: string; metaData: string; hash: [bigint, bigint] }[];
  }): { node: OgawaNode; hash: [bigint, bigint] } => {
    const propertiesHashWords = new SpookyHash128();
    if (args.compoundChildHashes.length > 0) {
      propertiesHashWords.update(concatBytes(
        args.compoundChildHashes.map((h) => u64PairToBytes(h[0], h[1]))));
    }
    const propertiesHash = propertiesHashWords.final();
    let childrenHash: [bigint, bigint] = [0n, 0n];
    if (args.children.length > 0) {
      const h = new SpookyHash128();
      h.update(concatBytes(args.children.map((c) => u64PairToBytes(c.hash[0], c.hash[1]))));
      childrenHash = h.final();
    }
    const headersData = concatBytes([
      ...args.children.map((c) => writeObjectHeader(c.name, c.metaData)),
      u64PairToBytes(propertiesHash[0], propertiesHash[1]),
      u64PairToBytes(childrenHash[0], childrenHash[1]),
    ]);
    const node = groupNode([
      args.compound.node,
      ...args.children.map((c) => c.node),
      dataNode(headersData),
    ]);
    return { node, hash: propertiesHash };
  };

  const objectHash = (args: {
    childHashes: [bigint, bigint][];
    propertiesHash: [bigint, bigint];
    metaData: string;
    name: string;
  }): [bigint, bigint] => {
    const hash = new SpookyHash128();
    if (args.childHashes.length > 0) {
      hash.update(concatBytes(args.childHashes.map((h) => u64PairToBytes(h[0], h[1]))));
    }
    // Final for the children hash is computed on a COPY
    // of the state in the library (Final does not
    // invalidate), then the state continues with the
    // properties hash bytes. SpookyHash128 here is
    // buffer-based, so emulate: the continuing state is
    // (children words || properties hash || metadata ||
    // name) hashed as one short message ONLY when the
    // children-words part is present; with no children
    // the library's state at Update(propertiesHash) time
    // is still empty. Both cases equal one Short over
    // the concatenation, because Final on the buffered
    // prefix does not alter the buffer.
    hash.update(u64PairToBytes(args.propertiesHash[0], args.propertiesHash[1]));
    if (args.metaData.length > 0) hash.update(textEncoder.encode(args.metaData));
    hash.update(textEncoder.encode(args.name));
    return hash.final();
  };

  const pointsObjectMetaData = serializeMetaData(POINTS_OBJECT_METADATA);
  const particlesBuilt = buildObjectNode({
    compound: topCompound,
    compoundChildHashes: [geom.hash],
    children: [],
  });
  const particlesHash = objectHash({
    childHashes: [],
    propertiesHash: particlesBuilt.hash,
    metaData: pointsObjectMetaData,
    name: ALEMBIC_POINTS_OBJECT_NAME,
  });

  const topCompoundEmpty = buildCompoundProperty({
    name: '', metaData: '', properties: [],
  });
  const topBuilt = buildObjectNode({
    compound: topCompoundEmpty,
    compoundChildHashes: [],
    children: [{
      node: particlesBuilt.node,
      name: ALEMBIC_POINTS_OBJECT_NAME,
      metaData: pointsObjectMetaData,
      hash: particlesHash,
    }],
  });

  // Time samplings stream: the default sampling (index 0)
  // then ours (index 1), each WriteTimeSampling-shaped.
  const tsStreamParts: Uint8Array[] = [];
  for (const ts of [defaultTimeSampling, timeSampling]) {
    const part = new Uint8Array(4 + 8 + 4 + ts.storedTimes.length * 8);
    const view = new DataView(part.buffer);
    view.setUint32(0, ts.maxSample, true);
    view.setFloat64(4, ts.timePerCycle, true);
    view.setUint32(12, ts.storedTimes.length, true);
    ts.storedTimes.forEach((t, i) => view.setFloat64(16 + i * 8, t, true));
    tsStreamParts.push(part);
  }

  const int32Data = (value: number): OgawaNode => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    return dataNode(bytes);
  };

  const root = groupNode([
    int32Data(ALEMBIC_OGAWA_FILE_VERSION),
    int32Data(ALEMBIC_FORMAT_LIBRARY_VERSION),
    topBuilt.node,
    dataNode(textEncoder.encode(serializeMetaData(ARCHIVE_METADATA))),
    dataNode(concatBytes(tsStreamParts)),
    emptyDataNode(),
  ]);

  return { ok: true, buffer: serializeOgawa(root) };
}

export type AlembicFileResult =
  | { ok: true; fileName: string; buffer: ArrayBuffer }
  | { ok: false; error: string };

/**
 * The panel's export entry point: the edition gate (杉
 * decision §4.5-3 — export is a full-edition feature, the
 * same predicate as the state-cache save and the PRT
 * export) around encodeAlembic. One file holds the whole
 * sequence, so the name carries no frame number.
 */
export function buildAlembicFile(cache: StateCacheData, edition?: string): AlembicFileResult {
  if (!stateCacheExportAllowed(edition)) {
    return { ok: false, error: '公開版では Alembic の書き出しはできません（完全版の機能です）。' };
  }
  const encoded = encodeAlembic(cache);
  if (!encoded.ok) return { ok: false, error: encoded.error };
  return { ok: true, fileName: ALEMBIC_FILE_NAME, buffer: encoded.buffer };
}
