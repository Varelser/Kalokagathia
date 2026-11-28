import {
  hashStateCacheFrame,
  parseStateCacheManifest,
  stateCacheExportAllowed,
  STATE_CACHE_MAX_FRAMES,
  STATE_CACHE_MAX_POINTS,
  type StateCacheData,
} from './gpgpuStateCache';

/**
 * PRT converter (Grammar 2.0 stage 3, slice S3): translate
 * between the canonical frame-sequence form
 * (lib/gpgpuStateCache.ts, statecache-manifest-v1) and
 * Thinkbox's PRT particle file format — one PRT file holds
 * exactly ONE frame, so a cache maps to a numbered file
 * sequence and back. Design: kalokagathia-pro/STAGE3_DESIGN.md
 * §2 S3 (PRT is a converter off the canonical form; the
 * canonical form is never bent to PRT's needs).
 *
 * Format basis, verified against the official specification
 * at implementation time: "PRT File Format v1.1" (Thinkbox
 * Software, the Krakatoa PRT specification document).
 * Everything is little-endian:
 * - Header (56 bytes): magic {192, 'P', 'R', 'T', '\r',
 *   '\n', 26, '\n'}; int32 header length (56 + the size of
 *   the chunk section); a 32-byte signature string
 *   ("Extensible Particle Format"); int32 version (1 for
 *   v1.0 = no chunk section, 2 for v1.1); int64 particle
 *   count (-1 marks an incomplete file).
 * - Chunk section (v1.1 only): {4-char type, int32 data
 *   length, data} chunks, ended by a mandatory 'Stop'
 *   chunk. The standard 'Meta' chunk carries a
 *   NUL-terminated channel name (empty = global), a
 *   NUL-terminated value name, an int32 type and the value.
 *   Standard globals: BoundBox (float32[6]), CoordSys
 *   (int32: 1 = right-handed Y-up, 2 = right-handed Z-up),
 *   LengthUnit (int32: 6 = meters). Per-channel:
 *   Interpretation (int32: 1 = Point, 2 = Vector).
 * - Reserved int32, value 4.
 * - Channel definitions: int32 channel count, int32
 *   definition length (44); per channel a 32-byte
 *   NUL-padded name (regex [a-zA-Z_][0-9a-zA-Z_]*), int32
 *   data type, int32 arity, int32 offset from the start
 *   of the particle. Type codes: int16 0, int32 1,
 *   int64 2, float16 3, float32 4, float64 5, uint16 6,
 *   uint32 7, uint64 8, int8 9, uint8 10.
 * - Particle data: the particles byte-packed back to back
 *   in the channel layout, compressed as ONE zlib
 *   (RFC 1950 deflate) stream. Compression here goes
 *   through the platform CompressionStream ('deflate' IS
 *   the zlib format); when the platform lacks it, encode
 *   and decode refuse with the reason rather than writing
 *   something that is not a PRT.
 *
 * Attribute mapping — the ONE table, shared with the
 * canonical manifest's attribute declarations
 * (PRT_CHANNEL_MAPPING below):
 * - positions      -> "Position" float32[3] (mandatory in
 *   PRT; Krakatoa hard-codes this channel's shape)
 * - velocities     -> "Velocity" float32[3]
 * - attribute 'age' (the column the capture supplies)
 *                  -> "Age" float32[1]
 * - every other declared attribute, in manifest order
 *                  -> a float32[1] channel of the same name
 * - "ID" int32[1] is GENERATED from the particle index on
 *   export. The canonical form has no ID entity (particles
 *   ARE their index), so on import an ID channel is
 *   dropped and reported, never stored.
 *
 * Import discipline, mirroring the canonical form's:
 * version / header / channel-definition inconsistencies
 * and byte-length mismatches refuse the whole file with
 * the reason. What the canonical form cannot represent is
 * never silently dropped or silently filled:
 * - channels it cannot hold (ID, arity > 1 customs) are
 *   listed in the result's droppedChannels;
 * - channels whose stored type is not float32 are
 *   converted and listed in convertedChannels (float64 /
 *   int64 / uint64 can lose precision in float32);
 * - a missing Velocity channel is zero-filled and listed
 *   in filledChannels (PRT loaders treat an absent
 *   Velocity as zero; the canonical form must carry one).
 * The canonical form is texSize-based (count must be a
 * perfect square) and capped at STATE_CACHE_MAX_POINTS,
 * so a foreign PRT beyond that is refused with the reason
 * — never resampled or decimated. Coordinate VALUES pass
 * through unconverted in both directions; the CoordSys /
 * LengthUnit metadata is carried so a reader that does
 * convert (Krakatoa) is told the truth about the data.
 * PRT carries no frame rate: import takes the caller's
 * fps (the panel passes its fps field).
 */

/* ---------------- spec constants ---------------- */

export const PRT_MAGIC: readonly number[] = [192, 0x50, 0x52, 0x54, 0x0d, 0x0a, 26, 0x0a];
export const PRT_SIGNATURE = 'Extensible Particle Format';
export const PRT_VERSION_1_0 = 1;
export const PRT_VERSION_1_1 = 2;
export const PRT_RESERVED_VALUE = 4;
export const PRT_CHANNEL_DEF_LENGTH = 44;
export const PRT_CHANNEL_NAME_MAX = 31; // 32-byte field, NUL included

export const PRT_TYPE = {
  int16: 0, int32: 1, int64: 2, float16: 3, float32: 4, float64: 5,
  uint16: 6, uint32: 7, uint64: 8, int8: 9, uint8: 10,
} as const;

const PRT_TYPE_NAMES: Record<number, string> = {
  0: 'int16', 1: 'int32', 2: 'int64', 3: 'float16', 4: 'float32', 5: 'float64',
  6: 'uint16', 7: 'uint32', 8: 'uint64', 9: 'int8', 10: 'uint8',
};

const PRT_TYPE_SIZES: Record<number, number> = {
  0: 2, 1: 4, 2: 8, 3: 2, 4: 4, 5: 8, 6: 2, 7: 4, 8: 8, 9: 1, 10: 1,
};

const PRT_CHANNEL_NAME_RE = /^[a-zA-Z_][0-9a-zA-Z_]*$/;

/* ---------------- attribute mapping (the one table) ---------------- */

export interface PrtChannelMappingEntry {
  /** Canonical side: 'positions' | 'velocities' | an
   *  attribute name | 'id'. */
  canonical: string;
  prtName: string;
  prtType: number;
  arity: number;
  /** 'stored' = the value lives in the canonical form;
   *  'generated' = produced on export, dropped on import. */
  origin: 'stored' | 'generated';
  note: string;
}

export const PRT_CHANNEL_MAPPING: readonly PrtChannelMappingEntry[] = [
  { canonical: 'positions', prtName: 'Position', prtType: PRT_TYPE.float32, arity: 3, origin: 'stored', note: '位置。PRT では必須で、Krakatoa が float32[3] に固定しているチャンネル。' },
  { canonical: 'velocities', prtName: 'Velocity', prtType: PRT_TYPE.float32, arity: 3, origin: 'stored', note: '速度。読み込み時に Velocity チャンネルが無い PRT は 0 で埋めて、その旨を結果に明示する。' },
  { canonical: 'age', prtName: 'Age', prtType: PRT_TYPE.float32, arity: 1, origin: 'stored', note: '年齢（属性列 "age"）。キャッシュが age 列を持つ場合のみ書き出す。' },
  { canonical: 'id', prtName: 'ID', prtType: PRT_TYPE.int32, arity: 1, origin: 'generated', note: '正本形式に ID の実体は無い（粒子＝そのインデックス）ため、書き出し時に粒子インデックスから生成する。読み込み時は保存せず、落としたことを結果に明示する。' },
  { canonical: '(その他の属性列)', prtName: '(属性名そのまま)', prtType: PRT_TYPE.float32, arity: 1, origin: 'stored', note: 'manifest の宣言順に float32[1] の同名チャンネルとして書き出す。PRT の名前規則に合わない属性名・予約名と衝突する属性名は理由つきで拒否する（黙って改名しない）。' },
];

/* ---------------- channel plan (export side) ---------------- */

export interface PrtChannelPlan {
  name: string;
  type: number;
  arity: number;
  offset: number;
  source: 'position' | 'velocity' | 'age' | 'id-generated' | 'attribute';
  /** Index into manifest.attributes for 'age'/'attribute'. */
  attributeIndex: number;
}

export type PrtChannelsResult =
  | { ok: true; channels: PrtChannelPlan[]; stride: number }
  | { ok: false; error: string };

const RESERVED_PRT_NAMES = ['Position', 'Velocity', 'Age', 'ID'];

/**
 * Resolve the PRT channel layout for a canonical cache.
 * Pure and sync so the mapping is testable without the
 * compression platform. Refuses (with the reason) on
 * attribute names PRT cannot carry and on collisions with
 * the reserved channel names — nothing is renamed.
 */
export function resolvePrtChannels(cache: StateCacheData): PrtChannelsResult {
  const { manifest } = cache;
  const channels: PrtChannelPlan[] = [];
  let offset = 0;
  const push = (ch: Omit<PrtChannelPlan, 'offset'>) => {
    channels.push({ ...ch, offset });
    offset += PRT_TYPE_SIZES[ch.type] * ch.arity;
  };
  push({ name: 'Position', type: PRT_TYPE.float32, arity: 3, source: 'position', attributeIndex: -1 });
  push({ name: 'Velocity', type: PRT_TYPE.float32, arity: 3, source: 'velocity', attributeIndex: -1 });
  // The age column: exact 'age' first, then the S1-style
  // case-insensitive resolution (gpgpuInitialState uses the
  // same order).
  let ageIndex = manifest.attributes.indexOf('age');
  if (ageIndex < 0) {
    ageIndex = manifest.attributes.findIndex((n) => n.trim().toLowerCase() === 'age');
  }
  if (ageIndex >= 0) {
    push({ name: 'Age', type: PRT_TYPE.float32, arity: 1, source: 'age', attributeIndex: ageIndex });
  }
  push({ name: 'ID', type: PRT_TYPE.int32, arity: 1, source: 'id-generated', attributeIndex: -1 });
  for (let a = 0; a < manifest.attributes.length; a++) {
    if (a === ageIndex) continue;
    const name = manifest.attributes[a];
    if (!PRT_CHANNEL_NAME_RE.test(name) || name.length > PRT_CHANNEL_NAME_MAX) {
      return {
        ok: false,
        error: `属性 "${name}" は PRT のチャンネル名として書けません（先頭は英字か "_"、使用できるのは英数字と "_"、${PRT_CHANNEL_NAME_MAX} 文字まで）。黙って改名はしないため、PRT 書き出しを中止しました。`,
      };
    }
    if (RESERVED_PRT_NAMES.includes(name)) {
      return {
        ok: false,
        error: `属性 "${name}" が PRT の予約チャンネル名と衝突するため、PRT 書き出しを中止しました（同名の別チャンネルとして二重に書くことはしません）。`,
      };
    }
    push({ name, type: PRT_TYPE.float32, arity: 1, source: 'attribute', attributeIndex: a });
  }
  return { ok: true, channels, stride: offset };
}

/* ---------------- zlib via the platform ---------------- */

function zlibPlatformAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function deflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------------- encode (one frame -> one PRT file) ---------------- */

export type PrtEncodeResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; error: string };

function metaChunk(channelName: string, valueName: string, type: number, value: ArrayBufferView): Uint8Array {
  const chanBytes = new TextEncoder().encode(channelName + '\0');
  const nameBytes = new TextEncoder().encode(valueName + '\0');
  const dataLength = chanBytes.length + nameBytes.length + 4 + value.byteLength;
  const out = new Uint8Array(8 + dataLength);
  const view = new DataView(out.buffer);
  out.set([0x4d, 0x65, 0x74, 0x61], 0); // 'Meta'
  view.setInt32(4, dataLength, true);
  let o = 8;
  out.set(chanBytes, o); o += chanBytes.length;
  out.set(nameBytes, o); o += nameBytes.length;
  view.setInt32(o, type, true); o += 4;
  out.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), o);
  return out;
}

function stopChunk(): Uint8Array {
  const out = new Uint8Array(8);
  out.set([0x53, 0x74, 0x6f, 0x70], 0); // 'Stop'
  return out; // data length 0
}

function boundBoxOf(positions: Float32Array): Float32Array {
  const box = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (Number.isFinite(v)) {
        if (v < box[k]) box[k] = v;
        if (v > box[k + 3]) box[k + 3] = v;
      }
    }
  }
  // No finite position at all: the spec's default is an
  // all-NaN box ("the bounding box did not exist").
  if (!Number.isFinite(box[0])) return new Float32Array(6).fill(NaN);
  return box;
}

const LENGTH_UNIT_CODES: Record<string, number> = {
  in: 1, ft: 2, mi: 3, mm: 4, cm: 5, m: 6, km: 7,
};

/**
 * Encode ONE frame of a canonical cache as a PRT v1.1
 * file (header + standard Meta chunks + channel
 * definitions + one zlib stream of byte-packed
 * particles). Bit-exact for the stored channels: every
 * stored value is written as the float32 it already is.
 */
export async function encodePrtFrame(cache: StateCacheData, frameIndex: number): Promise<PrtEncodeResult> {
  const { manifest } = cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return { ok: false, error: `フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。` };
  }
  if (!zlibPlatformAvailable()) {
    return { ok: false, error: 'この環境では zlib 圧縮（CompressionStream）が使えないため、PRT を書き出せません（PRT の粒子データは zlib 圧縮が仕様で必須です）。' };
  }
  const plan = resolvePrtChannels(cache);
  if (!plan.ok) return { ok: false, error: plan.error };
  const { channels, stride } = plan;
  const count = manifest.count;

  // Byte-pack the particles in channel layout order.
  const packed = new Uint8Array(count * stride);
  const view = new DataView(packed.buffer);
  const positions = cache.positions[frameIndex];
  const velocities = cache.velocities[frameIndex];
  for (const ch of channels) {
    for (let i = 0; i < count; i++) {
      const at = i * stride + ch.offset;
      if (ch.source === 'position') {
        view.setFloat32(at, positions[i * 3], true);
        view.setFloat32(at + 4, positions[i * 3 + 1], true);
        view.setFloat32(at + 8, positions[i * 3 + 2], true);
      } else if (ch.source === 'velocity') {
        view.setFloat32(at, velocities[i * 3], true);
        view.setFloat32(at + 4, velocities[i * 3 + 1], true);
        view.setFloat32(at + 8, velocities[i * 3 + 2], true);
      } else if (ch.source === 'id-generated') {
        view.setInt32(at, i, true);
      } else {
        view.setFloat32(at, cache.attrFrames[ch.attributeIndex][frameIndex][i], true);
      }
    }
  }
  let compressed: Uint8Array;
  try {
    compressed = await deflateZlib(packed);
  } catch (error) {
    return { ok: false, error: `PRT の圧縮に失敗しました: ${error instanceof Error ? error.message : String(error)}` };
  }

  // Chunk section: the standard global Meta values the
  // spec encourages writers to always write, the two
  // channel Interpretations, then Stop.
  const int32 = (v: number) => new Int32Array([v]);
  const chunks: Uint8Array[] = [
    metaChunk('', 'BoundBox', PRT_TYPE.float32, boundBoxOf(positions)),
    metaChunk('', 'CoordSys', PRT_TYPE.int32, int32(manifest.coordinates.up === 'z' ? 2 : 1)),
    metaChunk('', 'LengthUnit', PRT_TYPE.int32, int32(LENGTH_UNIT_CODES[manifest.coordinates.unit] ?? 0)),
    metaChunk('Position', 'Interpretation', PRT_TYPE.int32, int32(1)),
    metaChunk('Velocity', 'Interpretation', PRT_TYPE.int32, int32(2)),
    stopChunk(),
  ];
  const chunkBytes = chunks.reduce((sum, c) => sum + c.length, 0);
  const headerLength = 56 + chunkBytes;

  const out = new Uint8Array(headerLength + 4 + 8 + channels.length * PRT_CHANNEL_DEF_LENGTH + compressed.length);
  const outView = new DataView(out.buffer);
  out.set(PRT_MAGIC, 0);
  outView.setInt32(8, headerLength, true);
  const signature = new TextEncoder().encode(PRT_SIGNATURE);
  out.set(signature, 12); // remaining signature bytes stay 0 (NUL padded)
  outView.setInt32(44, PRT_VERSION_1_1, true);
  outView.setBigInt64(48, BigInt(count), true);
  let o = 56;
  for (const chunk of chunks) { out.set(chunk, o); o += chunk.length; }
  outView.setInt32(o, PRT_RESERVED_VALUE, true); o += 4;
  outView.setInt32(o, channels.length, true); o += 4;
  outView.setInt32(o, PRT_CHANNEL_DEF_LENGTH, true); o += 4;
  for (const ch of channels) {
    const nameBytes = new TextEncoder().encode(ch.name);
    out.set(nameBytes, o); // rest of the 32-byte field stays 0
    outView.setInt32(o + 32, ch.type, true);
    outView.setInt32(o + 36, ch.arity, true);
    outView.setInt32(o + 40, ch.offset, true);
    o += PRT_CHANNEL_DEF_LENGTH;
  }
  out.set(compressed, o);
  return { ok: true, buffer: out.buffer };
}

/** File name for one frame's PRT: the state-cache stem
 *  plus the ABSOLUTE frame number (startFrame + index),
 *  zero-padded so sequence readers sort it correctly. */
export function prtFileNameForFrame(cache: StateCacheData, frameIndex: number): string {
  const absolute = cache.manifest.startFrame + frameIndex;
  return `monosphere-state-cache-${String(absolute).padStart(4, '0')}.prt`;
}

export type PrtFileResult =
  | { ok: true; fileName: string; buffer: ArrayBuffer }
  | { ok: false; error: string };

/**
 * The panel's export entry point: the edition gate (杉
 * decision §4.5-3 — export is a full-edition feature,
 * the same predicate as the state-cache save) plus the
 * file name, around encodePrtFrame.
 */
export async function buildPrtFileForFrame(
  cache: StateCacheData,
  frameIndex: number,
  edition?: string,
): Promise<PrtFileResult> {
  if (!stateCacheExportAllowed(edition)) {
    return { ok: false, error: '公開版では PRT の書き出しはできません（完全版の機能です）。' };
  }
  const encoded = await encodePrtFrame(cache, frameIndex);
  if (!encoded.ok) return { ok: false, error: encoded.error };
  return { ok: true, fileName: prtFileNameForFrame(cache, frameIndex), buffer: encoded.buffer };
}

/* ---------------- decode (PRT file(s) -> canonical) ---------------- */

export interface PrtImportReport {
  /** Channels the canonical form cannot hold, with why. */
  droppedChannels: { name: string; reason: string }[];
  /** Channels stored in a non-float32 type, converted. */
  convertedChannels: { name: string; fromType: string }[];
  /** Channels the canonical form must carry but the file
   *  did not have, filled with a stated value. */
  filledChannels: string[];
}

export type PrtDecodeResult =
  | { ok: true; cache: StateCacheData; report: PrtImportReport }
  | { ok: false; error: string };

const fail = (error: string): PrtDecodeResult => ({ ok: false, error });

function float16ToFloat32(h: number): number {
  const sign = (h & 0x8000) !== 0 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * (frac / 1024) * 2 ** -14;
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function readChannelValue(view: DataView, type: number, byteOffset: number): number {
  switch (type) {
    case PRT_TYPE.int16: return view.getInt16(byteOffset, true);
    case PRT_TYPE.int32: return view.getInt32(byteOffset, true);
    case PRT_TYPE.int64: return Number(view.getBigInt64(byteOffset, true));
    case PRT_TYPE.float16: return float16ToFloat32(view.getUint16(byteOffset, true));
    case PRT_TYPE.float32: return view.getFloat32(byteOffset, true);
    case PRT_TYPE.float64: return view.getFloat64(byteOffset, true);
    case PRT_TYPE.uint16: return view.getUint16(byteOffset, true);
    case PRT_TYPE.uint32: return view.getUint32(byteOffset, true);
    case PRT_TYPE.uint64: return Number(view.getBigUint64(byteOffset, true));
    case PRT_TYPE.int8: return view.getInt8(byteOffset);
    case PRT_TYPE.uint8: return view.getUint8(byteOffset);
    default: return NaN;
  }
}

interface ParsedPrtFrame {
  count: number;
  positions: Float32Array;
  velocities: Float32Array;
  /** Canonical attribute name -> column. */
  attributes: Map<string, Float32Array>;
  coordinates: { up: string; unit: string };
  report: PrtImportReport;
}

type ParsedResult = { ok: true; frame: ParsedPrtFrame } | { ok: false; error: string };

const LENGTH_UNIT_NAMES: Record<number, string> = {
  0: 'unitless', 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km',
};

async function parsePrtFrame(buffer: ArrayBuffer): Promise<ParsedResult> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 56) return { ok: false, error: 'ファイルが PRT ヘッダ（56 バイト）より短いため、読み込めません。' };
  for (let i = 0; i < PRT_MAGIC.length; i++) {
    if (bytes[i] !== PRT_MAGIC[i]) {
      return { ok: false, error: 'マジックナンバーが PRT 形式と一致しません（PRT ではない、または PRT2 など別形式のファイルです）。' };
    }
  }
  const headerLength = view.getInt32(8, true);
  const version = view.getInt32(44, true);
  if (version !== PRT_VERSION_1_0 && version !== PRT_VERSION_1_1) {
    return { ok: false, error: `PRT の version が対応範囲外です（${version}。対応は 1 = v1.0 と 2 = v1.1）。` };
  }
  if (headerLength < 56 || headerLength > bytes.length) {
    return { ok: false, error: `ヘッダ長（${headerLength}）がファイルサイズと一致しません。` };
  }
  if (version === PRT_VERSION_1_0 && headerLength !== 56) {
    return { ok: false, error: `version 1（v1.0）のファイルでヘッダ長が 56 ではありません（${headerLength}）。` };
  }
  const countBig = view.getBigInt64(48, true);
  if (countBig <= 0n) {
    return { ok: false, error: `粒子数が不正です（${countBig.toString()}。-1 は未完成ファイルの印です）。` };
  }
  if (countBig > BigInt(STATE_CACHE_MAX_POINTS)) {
    return { ok: false, error: `上限超過のため読み込めません: 点数 ${countBig.toString()} が上限 ${STATE_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。` };
  }
  const count = Number(countBig);
  const texSize = Math.sqrt(count);
  if (!Number.isInteger(texSize)) {
    return { ok: false, error: `粒子数 ${count} が平方数ではないため、正本形式（texSize の二乗が点数）に取り込めません。粒子数のリサンプルはしません。` };
  }

  // Chunk section (v1.1): walk to the mandatory Stop,
  // collecting only the global CoordSys / LengthUnit.
  let coordSys = 0;
  let lengthUnit = 0;
  if (version === PRT_VERSION_1_1) {
    let o = 56;
    let stopped = false;
    while (o < headerLength) {
      if (o + 8 > headerLength) return { ok: false, error: 'チャンク部の構造が壊れています（チャンクヘッダがヘッダ長を超えています）。' };
      const type = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
      const dataLength = view.getInt32(o + 4, true);
      if (dataLength < 0 || o + 8 + dataLength > headerLength) {
        return { ok: false, error: `チャンク "${type}" の長さ（${dataLength}）がヘッダ長を超えています。` };
      }
      if (type === 'Stop') {
        if (dataLength !== 0) return { ok: false, error: 'Stop チャンクの長さが 0 ではありません。' };
        stopped = true;
        o += 8;
        break;
      }
      if (type === 'Meta') {
        // channel name\0 name\0 int32 type value...
        let p = o + 8;
        const end = o + 8 + dataLength;
        const readString = (): string | null => {
          const start = p;
          while (p < end && bytes[p] !== 0) p++;
          if (p >= end) return null;
          const s = new TextDecoder().decode(bytes.subarray(start, p));
          p++; // the NUL
          return s;
        };
        const channelName = readString();
        const valueName = channelName === null ? null : readString();
        if (channelName !== null && valueName !== null && p + 4 <= end) {
          const valueType = view.getInt32(p, true);
          const valueAt = p + 4;
          if (channelName === '' && valueType === PRT_TYPE.int32 && valueAt + 4 <= end) {
            if (valueName === 'CoordSys') coordSys = view.getInt32(valueAt, true);
            if (valueName === 'LengthUnit') lengthUnit = view.getInt32(valueAt, true);
          }
        }
      }
      o += 8 + dataLength;
    }
    if (!stopped) return { ok: false, error: 'チャンク部が Stop チャンクで終わっていません（v1.1 の必須要素です）。' };
    if (o !== headerLength) {
      return { ok: false, error: `チャンク部の終わり（${o}）がヘッダ長（${headerLength}）と一致しません。` };
    }
  }

  let o = headerLength;
  if (o + 4 > bytes.length) return { ok: false, error: 'ファイルが予約フィールドの前で終わっています。' };
  const reserved = view.getInt32(o, true); o += 4;
  if (reserved !== PRT_RESERVED_VALUE) {
    return { ok: false, error: `予約フィールドが仕様値 ${PRT_RESERVED_VALUE} ではありません（${reserved}）。` };
  }
  if (o + 8 > bytes.length) return { ok: false, error: 'ファイルがチャンネル定義部の前で終わっています。' };
  const channelCount = view.getInt32(o, true);
  const defLength = view.getInt32(o + 4, true); o += 8;
  if (channelCount < 1) return { ok: false, error: 'チャンネルが1つも定義されていません。' };
  if (defLength !== PRT_CHANNEL_DEF_LENGTH) {
    return { ok: false, error: `チャンネル定義の長さが仕様値 ${PRT_CHANNEL_DEF_LENGTH} ではありません（${defLength}）。` };
  }
  if (o + channelCount * defLength > bytes.length) {
    return { ok: false, error: 'ファイルがチャンネル定義の途中で終わっています。' };
  }
  interface ChannelDef { name: string; type: number; arity: number; offset: number }
  const defs: ChannelDef[] = [];
  const seenNames = new Set<string>();
  let expectedOffset = 0;
  for (let c = 0; c < channelCount; c++) {
    const at = o + c * defLength;
    let nameEnd = at;
    while (nameEnd < at + 32 && bytes[nameEnd] !== 0) nameEnd++;
    const name = new TextDecoder().decode(bytes.subarray(at, nameEnd));
    const type = view.getInt32(at + 32, true);
    const arity = view.getInt32(at + 36, true);
    const offset = view.getInt32(at + 40, true);
    if (!PRT_CHANNEL_NAME_RE.test(name)) {
      return { ok: false, error: `チャンネル名 "${name}" が PRT の名前規則に一致しません。` };
    }
    if (seenNames.has(name)) return { ok: false, error: `チャンネル名 "${name}" が重複しています。` };
    seenNames.add(name);
    if (!(type in PRT_TYPE_SIZES)) {
      return { ok: false, error: `チャンネル "${name}" のデータ型コード（${type}）が仕様の表にありません。` };
    }
    if (!Number.isInteger(arity) || arity < 1) {
      return { ok: false, error: `チャンネル "${name}" の arity（${arity}）が不正です。` };
    }
    if (offset !== expectedOffset) {
      return { ok: false, error: `チャンネル "${name}" の offset（${offset}）が詰め込み順（${expectedOffset}）と一致しません。隙間・重なりのあるレイアウトは読み込めません。` };
    }
    expectedOffset += PRT_TYPE_SIZES[type] * arity;
    defs.push({ name, type, arity, offset });
  }
  const stride = expectedOffset;
  o += channelCount * defLength;

  if (!zlibPlatformAvailable()) {
    return { ok: false, error: 'この環境では zlib 展開（DecompressionStream）が使えないため、PRT を読み込めません。' };
  }
  let packed: Uint8Array;
  try {
    packed = await inflateZlib(bytes.subarray(o));
  } catch (error) {
    return { ok: false, error: `粒子データの zlib 展開に失敗しました: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (packed.length !== count * stride) {
    return { ok: false, error: `粒子データのバイト長が一致しません（展開後 ${packed.length} バイト、期待 ${count * stride} バイト＝${count} 点 × ストライド ${stride}）。` };
  }
  const packedView = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const readColumn = (def: ChannelDef): Float32Array => {
    const size = PRT_TYPE_SIZES[def.type];
    const out = new Float32Array(count * def.arity);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < def.arity; k++) {
        out[i * def.arity + k] = readChannelValue(packedView, def.type, i * stride + def.offset + k * size);
      }
    }
    return out;
  };

  const report: PrtImportReport = { droppedChannels: [], convertedChannels: [], filledChannels: [] };
  const noteConversion = (def: ChannelDef) => {
    if (def.type !== PRT_TYPE.float32) {
      report.convertedChannels.push({ name: def.name, fromType: PRT_TYPE_NAMES[def.type] });
    }
  };

  const positionDef = defs.find((d) => d.name === 'Position');
  if (!positionDef) {
    return { ok: false, error: 'Position チャンネルがありません（PRT では必須です）。' };
  }
  if (positionDef.arity !== 3) {
    return { ok: false, error: `Position チャンネルの arity が 3 ではありません（${positionDef.arity}）。` };
  }
  noteConversion(positionDef);
  const positions = readColumn(positionDef);

  let velocities: Float32Array;
  const velocityDef = defs.find((d) => d.name === 'Velocity');
  if (velocityDef && velocityDef.arity === 3) {
    noteConversion(velocityDef);
    velocities = readColumn(velocityDef);
  } else {
    if (velocityDef) {
      report.droppedChannels.push({ name: 'Velocity', reason: `arity が 3 ではない（${velocityDef.arity}）ため速度として取り込めませんでした。` });
    }
    velocities = new Float32Array(count * 3);
    report.filledChannels.push('Velocity（チャンネルが無いため 0 で埋めました）');
  }

  const attributes = new Map<string, Float32Array>();
  for (const def of defs) {
    if (def === positionDef || def === velocityDef) continue;
    if (def.name === 'ID') {
      report.droppedChannels.push({ name: 'ID', reason: '正本形式に ID の実体は無い（粒子＝そのインデックス）ため、保存しませんでした。' });
      continue;
    }
    const isAge = def.name === 'Age' || (def.name.toLowerCase() === 'age' && !attributes.has('age'));
    if (isAge && def.arity === 1) {
      noteConversion(def);
      attributes.set('age', readColumn(def));
      continue;
    }
    if (def.arity !== 1) {
      report.droppedChannels.push({ name: def.name, reason: `arity が ${def.arity} のチャンネルは、正本形式のスカラ属性列（arity 1）では表現できないため取り込めませんでした。` });
      continue;
    }
    // Canonical attribute names must be unique ignoring
    // case (the manifest assembly's own rule).
    const lowered = def.name.toLowerCase();
    for (const existing of attributes.keys()) {
      if (existing.toLowerCase() === lowered) {
        return { ok: false, error: `属性名 "${def.name}" が取り込み済みの属性 "${existing}" と（大小文字を除いて）重複するため、読み込めません。` };
      }
    }
    if (lowered === 'x' || lowered === 'y' || lowered === 'z') {
      return { ok: false, error: `属性名 "${def.name}" は位置の列と重なるため、正本形式に取り込めません。` };
    }
    noteConversion(def);
    attributes.set(def.name, readColumn(def));
  }

  const coordinates = {
    up: coordSys === 2 || coordSys === 4 ? 'z' : 'y',
    unit: LENGTH_UNIT_NAMES[lengthUnit] ?? 'unitless',
  };
  return { ok: true, frame: { count, positions, velocities, attributes, coordinates, report } };
}

export interface PrtImportOptions {
  /** PRT carries no frame rate; the caller supplies it. */
  fps?: number;
  startFrame?: number;
}

/** Assemble a canonical cache from parsed frames, running
 *  the manifest through the canonical parser so the
 *  result provably satisfies the format's own validation. */
function assembleImportedCache(
  frames: ParsedPrtFrame[],
  options: PrtImportOptions,
): PrtDecodeResult {
  const first = frames[0];
  const attributeNames = [...first.attributes.keys()];
  const mergedReport: PrtImportReport = { droppedChannels: [], convertedChannels: [], filledChannels: [] };
  const mergeOnce = <T extends { name: string }>(list: T[], entry: T) => {
    if (!list.some((e) => e.name === entry.name)) list.push(entry);
  };
  for (const frame of frames) {
    frame.report.droppedChannels.forEach((e) => mergeOnce(mergedReport.droppedChannels, e));
    frame.report.convertedChannels.forEach((e) => mergeOnce(mergedReport.convertedChannels, e));
    frame.report.filledChannels.forEach((name) => {
      if (!mergedReport.filledChannels.includes(name)) mergedReport.filledChannels.push(name);
    });
  }
  const manifestText = JSON.stringify({
    format: 'statecache-manifest-v1',
    version: 1,
    fps: options.fps ?? 30,
    count: first.count,
    texSize: Math.sqrt(first.count),
    frameCount: frames.length,
    startFrame: options.startFrame ?? 0,
    loop: true,
    interpolation: 'linear',
    coordinates: first.coordinates,
    attributes: attributeNames,
    frameHashes: frames.map((f) => hashStateCacheFrame(f.positions, f.velocities)),
  });
  const parsed = parseStateCacheManifest(manifestText);
  if ('error' in parsed) return fail(`取り込んだ内容が正本形式の検証を通りませんでした: ${parsed.error}`);
  const cache: StateCacheData = {
    manifest: parsed.manifest,
    positions: frames.map((f) => f.positions),
    velocities: frames.map((f) => f.velocities),
    attrFrames: attributeNames.map((name) => frames.map((f) => f.attributes.get(name)!)),
  };
  return { ok: true, cache, report: mergedReport };
}

/** Decode ONE PRT file into a one-frame canonical cache. */
export async function decodePrtFile(buffer: ArrayBuffer, options?: PrtImportOptions): Promise<PrtDecodeResult> {
  const parsed = await parsePrtFrame(buffer);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return assembleImportedCache([parsed.frame], options ?? {});
}

/** The frame number a sequence file name carries: the
 *  last run of digits before the extension, if any. */
export function prtFrameNumberFromFileName(name: string): number | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const match = /(\d+)\.prt$/i.exec(base);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Decode a PRT file SEQUENCE (one file per frame) into a
 * canonical cache. Files are ordered by the frame number
 * in their names (falling back to name order); every file
 * must agree on the particle count and the canonical
 * attribute set, or the whole sequence is refused with
 * the reason — frames are never padded or dropped.
 */
export async function decodePrtFiles(
  files: { name: string; buffer: ArrayBuffer }[],
  options?: PrtImportOptions,
): Promise<PrtDecodeResult> {
  if (files.length === 0) return fail('PRT ファイルが選択されていません。');
  if (files.length > STATE_CACHE_MAX_FRAMES) {
    return fail(`上限超過のため読み込めません: ファイル数 ${files.length} が上限 ${STATE_CACHE_MAX_FRAMES} フレームを超えています。`);
  }
  const ordered = [...files].sort((a, b) => {
    const na = prtFrameNumberFromFileName(a.name);
    const nb = prtFrameNumberFromFileName(b.name);
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const frames: ParsedPrtFrame[] = [];
  for (const file of ordered) {
    const parsed = await parsePrtFrame(file.buffer);
    if (!parsed.ok) return fail(`${file.name}: ${parsed.error}`);
    frames.push(parsed.frame);
  }
  const first = frames[0];
  const firstAttrs = [...first.attributes.keys()].sort().join('\n');
  for (let f = 1; f < frames.length; f++) {
    if (frames[f].count !== first.count) {
      return fail(`フレーム間で粒子数が一致しません（${ordered[0].name}: ${first.count} 点、${ordered[f].name}: ${frames[f].count} 点）。`);
    }
    if ([...frames[f].attributes.keys()].sort().join('\n') !== firstAttrs) {
      return fail(`フレーム間で属性の組が一致しません（${ordered[f].name}）。`);
    }
    if (frames[f].coordinates.up !== first.coordinates.up || frames[f].coordinates.unit !== first.coordinates.unit) {
      return fail(`フレーム間で座標系メタデータが一致しません（${ordered[f].name}）。`);
    }
  }
  const startFrame = options?.startFrame ?? prtFrameNumberFromFileName(ordered[0].name) ?? 0;
  return assembleImportedCache(frames, { ...options, startFrame });
}
