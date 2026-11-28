import {
  hashStateCacheFrame,
  STATE_CACHE_MAX_ATTRIBUTE_COLUMNS,
  STATE_CACHE_MAX_FRAMES,
  STATE_CACHE_MAX_POINTS,
  stateCacheToPointCacheData,
  type StateCacheData,
} from './gpgpuStateCache';
import { buildGpgpuInitialDataFromStateFrame } from './gpgpuInitialData';

/**
 * State cache v2 (C2 bake-layer extension): the v1 frame-sequence
 * format plus an orientation channel, extended attribute
 * declarations and provenance, and the bake-job split / merge
 * contract (checkpoint chaining). Design:
 * kalokagathia-pro/expanded-ruler/bake-layer-design.md.
 * Record: kalokagathia-pro/BAKE_V2_IMPL_RECORD.md.
 *
 * v1 (lib/gpgpuStateCache.ts) is NOT modified. This module is a
 * new reader/writer pair beside it:
 * - New files are written as `statecache-manifest-v2`, version 2.
 * - This reader also accepts v1 files. A v1 file declares no
 *   orientation channel, and that is NOT a missing-data gap to
 *   fill: it is accepted as a file that by declaration has no
 *   orientation, and sampling it yields the identity quaternion
 *   explicitly through that declaration (see sampleStateCacheV2).
 * - The v1 reader keeps refusing v2 files with its existing
 *   version/format mismatch errors (no forward compatibility).
 *
 * Binary layout per frame (v2): positions count x 3, velocities
 * count x 3, one count-wide column per declared attribute (in
 * declaration order), then — only when the manifest declares
 * the orientation channel — orientations count x 4. (With
 * validCount declared, every "count" in this layout is the
 * stored count — see the thinning paragraph below.) The v1
 * prefix is interpreted exactly as in v1; orientation is
 * appended behind it. Orientation components are (x, y, z, w),
 * the same order as the Orient render target
 * (lib/gpgpuOrient.ts), stored as normalized float32
 * quaternions with no compression encoding, so an encode ->
 * decode round trip is bit-exact.
 *
 * The per-frame hash (FNV-1a, the same algorithm family as v1)
 * covers the WHOLE stored frame — positions, velocities, every
 * attribute column and the orientation bytes — so a file whose
 * orientation alone is corrupted is rejected by hash mismatch.
 * (For files read as v1, the v1 hash definition applies, since
 * that is what their manifests were written with.)
 *
 * Validation discipline is v1's: never fill gaps. A version
 * mismatch, cap overflow, length mismatch, undeclared /
 * missing attribute, malformed provenance or a frame-hash
 * mismatch rejects the whole cache with the reason stated.
 *
 * Limits sit in two layers (A-5 follow-up a, settled after
 * the thinned re-measurement of 2026-11-28):
 *
 * 1. Format caps — unchanged from v1 (65,536 points x 3,600
 *    frames: STATE_CACHE_MAX_POINTS / STATE_CACHE_MAX_FRAMES).
 *    They apply to `count` (the pool width) and `frameCount`,
 *    NEVER to validCount: decoding restores count-wide
 *    arrays, so what these caps guard is the restored pool
 *    size and the in-memory footprint. Declaring a small
 *    validCount does not relax them.
 * 2. Operational recommendation — for oriented bakes, the
 *    playback range of 8,192 STORED points x 240 frames
 *    (STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_* below).
 *    "Stored points" means validCount when the manifest
 *    declares it, else count: since thinning, the stored
 *    count is what decides the file size. Measured on a
 *    real GPU (round11 re-measurement): one stored point
 *    costs 44 bytes per frame with one attribute column
 *    and orientation, so the recommended maximum stores
 *    86,507,520 bytes of binary (plus ~3 KB of manifest).
 *    This layer is a guideline, not a format cap; the exact
 *    stored size of any manifest is
 *    stateCacheStoredBinaryBytesV2.
 *
 * Valid-count thinning (A-5 follow-up b): the pool a capture
 * reads back is texSize x texSize, but the scene's valid
 * particles are the leading gpgpuCount of them — the draw
 * geometry's vertices are in index order and applyLodPolicy
 * draws exactly drawRange(0, min(gpgpuCount, texSize^2)).
 * A v2 manifest may therefore declare `validCount` (< count):
 * the binary then stores, per frame and channel, only the
 * first validCount particles, and the frame hash covers
 * exactly those stored bytes (the hash's domain is the
 * stored frame, as it has always been — thinning redefines
 * what the stored frame is, by declaration in the manifest).
 * Decoding restores count-wide arrays: the stored prefix is
 * verbatim, and the tail beyond validCount is filled with
 * the sim's own inactive-particle convention — parked
 * position (0, -99999, 0) (the position pass's parked write;
 * the velocity pass zeroes a parked particle's velocity),
 * zero attribute columns, and the identity quaternion for
 * orientation. That tail is NOT recovered data and is never
 * claimed to be: it is outside the declared stored set, and
 * no hash covers it. A manifest without validCount (every
 * file written before this change) stores the whole pool
 * exactly as before.
 *
 * Bake-job splitting (design §3): splitting is by scene and
 * by frame range ONLY — never by particle domain. The default
 * (and only chaining this module blesses) is method A,
 * checkpoint chaining: job N+1 starts from job N's last frame,
 * cut out as a single-frame checkpoint cache and fed through
 * the stage-3 S1 initial-state path. Method B (independent
 * recomputation from time 0) is NOT the default and is not
 * implemented here: cross-device bit-exactness of the GPU
 * solver is unverified, so independent parts cannot be
 * trusted to meet at the seam. Method B may only ever be an
 * explicit, same-device / same-version choice guarded by the
 * seam-hash check in mergeBakeJobParts.
 */

export const STATE_CACHE_FORMAT_V2 = 'statecache-manifest-v2';
export const STATE_CACHE_VERSION_V2 = 2;
export const STATE_CACHE_V1_FORMAT = 'statecache-manifest-v1';
export const ORIENTATION_ENCODING = 'quat-f32x4' as const;
/** Operational guideline for oriented bakes (design §2-4):
 *  at most this many STORED points (validCount when the
 *  manifest declares it, else count) — the stored count is
 *  what decides the file size since valid-count thinning.
 *  At 44 bytes per stored point per frame (one attribute
 *  column + orientation), the recommended maximum stores
 *  86,507,520 bytes of binary over 240 frames (measured,
 *  round11). Guideline only — not a format cap. */
export const STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_POINTS = 8192;
export const STATE_CACHE_V2_ORIENTED_RECOMMENDED_MAX_FRAMES = 240;

/** How a bake was split. 'checkpoint-chain' (method A) is the
 *  default; 'independent-recompute' (method B) is never the
 *  default — see the header. */
export const BAKE_SPLIT_DEFAULT_METHOD = 'checkpoint-chain' as const;
export type BakeSplitMethod = 'checkpoint-chain' | 'independent-recompute';

export interface StateCacheAttributeDecl {
  name: string;
  /** Only single-component columns exist in this format. */
  components: 1;
  /** Where the column came from: a sim attribute slot, a
   *  script bake (C1), age, a constitutive channel, ... The
   *  vocabulary is open; the declaration is mandatory. */
  source: string;
}

export interface StateCacheProvenance {
  /** Hash of the settings snapshot the bake was made from. */
  settingsHash: string;
  /** Scene seed. Must be identical across split jobs. */
  seed: number;
  /** Generator identity, e.g. 'monosphere' or 'pyodide'. */
  generator: string;
  /** Version of that generator (app version / Pyodide version). */
  generatorVersion: string;
}

export interface StateCacheOrientationDecl {
  encoding: typeof ORIENTATION_ENCODING;
}

export interface StateCacheManifestV2 {
  format: string;
  version: number;
  fps: number;
  count: number;
  /** Stored particles per frame and channel (A-5 thinning).
   *  Absent = count (the whole pool is stored, the legacy
   *  shape). When present it is < count: only the leading
   *  validCount particles of each channel are in the binary,
   *  and the frame hashes cover those stored prefixes. On
   *  decode the arrays are restored to count-wide with the
   *  parked tail convention (see the header). Never present
   *  on a manifest read as v1. */
  validCount?: number;
  texSize: number;
  frameCount: number;
  startFrame: number;
  loop: boolean;
  interpolation: 'linear' | 'nearest';
  coordinates: { up: string; unit: string };
  attributes: StateCacheAttributeDecl[];
  /** null = the file declares it has no orientation channel. */
  orientation: StateCacheOrientationDecl | null;
  /** null only for files read as v1 (v1 has no provenance). */
  provenance: StateCacheProvenance | null;
  frameHashes: string[];
  /** 1 when this manifest was read from a v1 file, else 2. */
  sourceVersion: 1 | 2;
}

export interface StateCacheDataV2 {
  manifest: StateCacheManifestV2;
  positions: Float32Array[];
  velocities: Float32Array[];
  attrFrames: Float32Array[][];
  /** Per frame count x 4 (x, y, z, w); null when the manifest
   *  declares no orientation channel. */
  orientations: Float32Array[] | null;
}

export interface StateCacheFrameInputV2 {
  positions: Float32Array;
  velocities: Float32Array;
  attributes?: Record<string, Float32Array>;
  /** count x 4 readback-shaped orientation is NOT used: the
   *  orientation input is the stored shape, count x 4 quats. */
  orientations?: Float32Array;
}

export type StateCacheResultV2 =
  | { ok: true; cache: StateCacheDataV2 }
  | { ok: false; error: string };

const fail = (error: string): StateCacheResultV2 => ({ ok: false, error });

/* ---------------- hashing ---------------- */

function fnv1aOver(buffers: Float32Array[]): string {
  let h = 0x811c9dc5;
  for (const buf of buffers) {
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/** FNV-1a over the whole stored v2 frame, in binary layout
 *  order (positions, velocities, attributes, orientation). */
export function hashStateCacheFrameV2(
  positions: Float32Array,
  velocities: Float32Array,
  attrColumns: Float32Array[],
  orientations?: Float32Array | null,
): string {
  const bufs = [positions, velocities, ...attrColumns];
  if (orientations) bufs.push(orientations);
  return fnv1aOver(bufs);
}

/* ---------------- valid-count thinning ------------------- */

/** The parked position the sim's own position pass writes
 *  for an inactive particle (0, -99999, 0); the velocity
 *  pass zeroes its velocity under the same test. Decoding a
 *  thinned file fills the unstored tail with this convention
 *  (see the header). */
export const STATE_CACHE_PARKED_POSITION = [0, -99999, 0] as const;

/** Particles actually stored per frame and channel: the
 *  manifest's validCount when declared, else the whole pool. */
export function stateCacheStoredCountV2(manifest: StateCacheManifestV2): number {
  return manifest.validCount ?? manifest.count;
}

function storedPrefix(buf: Float32Array, perParticle: number, stored: number): Float32Array {
  return buf.subarray(0, stored * perParticle);
}

/** Frame hash over the STORED prefixes of count-wide
 *  in-memory channels — the hash a thinned manifest carries.
 *  With stored = count this is hashStateCacheFrameV2 itself. */
function hashStoredFrameV2(
  stored: number,
  positions: Float32Array,
  velocities: Float32Array,
  attrColumns: Float32Array[],
  orientations?: Float32Array | null,
): string {
  return hashStateCacheFrameV2(
    storedPrefix(positions, 3, stored),
    storedPrefix(velocities, 3, stored),
    attrColumns.map((c) => storedPrefix(c, 1, stored)),
    orientations ? storedPrefix(orientations, 4, stored) : orientations,
  );
}

/** Restore one stored channel to count-wide: the stored
 *  prefix verbatim, the tail filled per particle by `fill`
 *  (the parked convention; a no-op fill leaves zeros). */
function expandStoredChannel(
  storedBuf: Float32Array,
  perParticle: number,
  stored: number,
  count: number,
  fill?: (out: Float32Array, i: number) => void,
): Float32Array {
  if (stored === count) return storedBuf;
  const out = new Float32Array(count * perParticle);
  out.set(storedBuf);
  if (fill) {
    for (let i = stored; i < count; i++) fill(out, i);
  }
  return out;
}

/* ---------------- shared validation helpers ---------------- */

function validateAttributeDecls(decls: StateCacheAttributeDecl[]): string | null {
  if (decls.length > STATE_CACHE_MAX_ATTRIBUTE_COLUMNS) {
    return `上限超過のため保存できません: 属性が ${decls.length} 列あり、上限 ${STATE_CACHE_MAX_ATTRIBUTE_COLUMNS} 列を超えています。`;
  }
  const seen = new Set<string>();
  for (const d of decls) {
    if (!d || typeof d.name !== 'string' || d.name.length === 0) return '属性宣言の name が不正です。';
    if (d.components !== 1) return `属性 "${d.name}" の components は 1 が必要です（現在: ${String(d.components)}）。この形式は単成分列のみを扱います。`;
    if (typeof d.source !== 'string' || d.source.length === 0) return `属性 "${d.name}" の source（由来）が宣言されていません。由来が不明な属性は補完せず拒否します。`;
    const lowered = d.name.trim().toLowerCase();
    if (lowered === 'x' || lowered === 'y' || lowered === 'z') return `属性名 "${d.name}" は位置の列と重なります。`;
    if (seen.has(lowered)) return `属性名 "${d.name}" が重複しています。`;
    seen.add(lowered);
  }
  return null;
}

function validateProvenance(p: StateCacheProvenance | null | undefined): string | null {
  if (!p) return '来歴（provenance）が宣言されていません。v2 形式では設定ハッシュ・シード・生成器の版が必須です。';
  if (typeof p.settingsHash !== 'string' || p.settingsHash.length === 0) return '来歴の settingsHash が不正です。';
  if (!Number.isInteger(p.seed)) return '来歴の seed は整数が必要です。';
  if (typeof p.generator !== 'string' || p.generator.length === 0) return '来歴の generator が不正です。';
  if (typeof p.generatorVersion !== 'string' || p.generatorVersion.length === 0) return '来歴の generatorVersion が不正です。';
  return null;
}

function checkQuaternionBuffer(q: Float32Array, count: number, frame: number): string | null {
  if (q.length !== count * 4) return `フレーム ${frame} の姿勢バッファ長が粒子数と一致しません（${q.length}、期待 ${count * 4}）。`;
  for (let i = 0; i < count; i++) {
    const x = q[i * 4]; const y = q[i * 4 + 1]; const z = q[i * 4 + 2]; const w = q[i * 4 + 3];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) {
      return `フレーム ${frame} の姿勢 ${i} に有限でない成分があります。`;
    }
    const n = Math.hypot(x, y, z, w);
    if (Math.abs(n - 1) > 1e-2) return `フレーム ${frame} の姿勢 ${i} は正規化済みクォータニオンではありません（ノルム ${n}）。正規化は読み手が勝手に行わず、書き出し側の責務とします。`;
  }
  return null;
}

/* ---------------- assembly ---------------- */

export function assembleStateCacheV2(args: {
  fps: number;
  texSize: number;
  frames: StateCacheFrameInputV2[];
  attributeDecls?: StateCacheAttributeDecl[];
  /** Per-frame orientation buffers (count x 4). Either give
   *  one for EVERY frame, or none at all (no channel). */
  orientations?: Float32Array[] | null;
  provenance: StateCacheProvenance;
  startFrame?: number;
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
  /** Valid-count thinning (A-5 b): store only the leading
   *  validCount particles per frame and channel. Omit (or
   *  pass count) to store the whole pool — the manifest
   *  then carries no validCount field and the file is the
   *  legacy shape byte for byte. */
  validCount?: number;
}): StateCacheResultV2 {
  const { fps, texSize, frames } = args;
  const attributeDecls = args.attributeDecls ?? [];
  if (!Number.isFinite(fps) || fps <= 0) return fail('キャッシュの fps は 0 より大きい数値が必要です。');
  if (!Number.isInteger(texSize) || texSize <= 0) return fail('キャッシュの texSize は 1 以上の整数が必要です。');
  const count = texSize * texSize;
  if (count > STATE_CACHE_MAX_POINTS) {
    return fail(`上限超過のため保存できません: 点数 ${count.toLocaleString()} が上限 ${STATE_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。`);
  }
  let stored = count;
  if (args.validCount !== undefined) {
    if (!Number.isInteger(args.validCount) || args.validCount < 1) {
      return fail(`保存粒子数（validCount）は 1 以上の整数が必要です（${String(args.validCount)}）。`);
    }
    if (args.validCount > count) {
      return fail(`保存粒子数（validCount）${args.validCount.toLocaleString()} が粒子数 ${count.toLocaleString()} を超えています。プールより多い保存はできません。`);
    }
    stored = args.validCount;
  }
  if (frames.length === 0) return fail('キャッシュするフレームがありません。');
  if (frames.length > STATE_CACHE_MAX_FRAMES) {
    return fail(`上限超過のため保存できません: フレーム数 ${frames.length} が上限 ${STATE_CACHE_MAX_FRAMES} フレームを超えています。`);
  }
  const declError = validateAttributeDecls(attributeDecls);
  if (declError) return fail(declError);
  const provError = validateProvenance(args.provenance);
  if (provError) return fail(provError);
  const hasOrientation = args.orientations !== undefined && args.orientations !== null;
  if (hasOrientation && args.orientations!.length !== frames.length) {
    return fail(`姿勢チャンネルは全フレーム分が必要です（${args.orientations!.length} フレーム分、期待 ${frames.length}）。一部のフレームだけ姿勢がある状態は補完しません。`);
  }
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = attributeDecls.map(() => []);
  const orientations: Float32Array[] | null = hasOrientation ? [] : null;
  const frameHashes: string[] = [];
  for (let f = 0; f < frames.length; f++) {
    const frame = frames[f];
    if (frame.positions.length !== count * 4 || frame.velocities.length !== count * 4) {
      return fail(`フレーム ${f} の読み戻しバッファ長が粒子数と一致しません（位置 ${frame.positions.length}／速度 ${frame.velocities.length}、期待 ${count * 4}）。`);
    }
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = frame.positions[i * 4];
      pos[i * 3 + 1] = frame.positions[i * 4 + 1];
      pos[i * 3 + 2] = frame.positions[i * 4 + 2];
      vel[i * 3] = frame.velocities[i * 4];
      vel[i * 3 + 1] = frame.velocities[i * 4 + 1];
      vel[i * 3 + 2] = frame.velocities[i * 4 + 2];
    }
    positions.push(pos);
    velocities.push(vel);
    const cols: Float32Array[] = [];
    for (let a = 0; a < attributeDecls.length; a++) {
      const values = frame.attributes?.[attributeDecls[a].name];
      if (!values || values.length !== count) {
        return fail(`フレーム ${f} の属性 "${attributeDecls[a].name}" が無いか、長さが粒子数と一致しません。宣言された属性は補完しません。`);
      }
      const col = new Float32Array(values);
      attrFrames[a].push(col);
      cols.push(col);
    }
    let orient: Float32Array | null = null;
    if (hasOrientation) {
      const src = args.orientations![f];
      const qErr = checkQuaternionBuffer(src, count, f);
      if (qErr) return fail(qErr);
      orient = new Float32Array(src);
      orientations!.push(orient);
    }
    frameHashes.push(hashStoredFrameV2(stored, pos, vel, cols, orient));
  }
  const manifest: StateCacheManifestV2 = {
    format: STATE_CACHE_FORMAT_V2,
    version: STATE_CACHE_VERSION_V2,
    fps,
    count,
    ...(stored < count ? { validCount: stored } : {}),
    texSize,
    frameCount: frames.length,
    startFrame: args.startFrame ?? 0,
    loop: args.loop ?? true,
    interpolation: args.interpolation ?? 'linear',
    coordinates: { up: 'y', unit: 'm' },
    attributes: attributeDecls.map((d) => ({ ...d })),
    orientation: hasOrientation ? { encoding: ORIENTATION_ENCODING } : null,
    provenance: { ...args.provenance },
    frameHashes,
    sourceVersion: 2,
  };
  return { ok: true, cache: { manifest, positions, velocities, attrFrames, orientations } };
}

/* ---------------- manifest ---------------- */

export function serializeStateCacheManifestV2(cache: StateCacheDataV2): string {
  const { sourceVersion, ...rest } = cache.manifest;
  void sourceVersion;
  return JSON.stringify(rest);
}

export function parseStateCacheManifestV2(
  text: string,
): { manifest: StateCacheManifestV2 } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { error: 'マニフェストを JSON として読めませんでした。' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'マニフェストが JSON オブジェクトではありません。' };
  const m = raw as Record<string, unknown>;
  const isV2 = m.format === STATE_CACHE_FORMAT_V2;
  const isV1 = m.format === STATE_CACHE_V1_FORMAT;
  if (!isV2 && !isV1) {
    return { error: `マニフェストの format が "${STATE_CACHE_FORMAT_V2}" でも "${STATE_CACHE_V1_FORMAT}" でもありません（"${String(m.format)}"）。` };
  }
  if (isV2 && m.version !== STATE_CACHE_VERSION_V2) {
    return { error: `マニフェストの version は ${STATE_CACHE_VERSION_V2} が必要です（"${String(m.version)}"）。` };
  }
  if (isV1 && m.version !== 1) {
    return { error: `v1 マニフェストの version は 1 が必要です（"${String(m.version)}"）。` };
  }
  const fps = m.fps;
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return { error: 'マニフェストの fps は 0 より大きい数値が必要です。' };
  }
  const count = m.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return { error: 'マニフェストの count は 1 以上の整数が必要です。' };
  }
  if (count > STATE_CACHE_MAX_POINTS) {
    return { error: `上限超過のため読み込めません: 点数 ${count.toLocaleString()} が上限 ${STATE_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。` };
  }
  const texSize = m.texSize;
  if (typeof texSize !== 'number' || !Number.isInteger(texSize) || texSize <= 0 || texSize * texSize !== count) {
    return { error: 'マニフェストの texSize が count と一致しません。' };
  }
  // validCount (A-5 thinning): a v2-only declaration. Absent
  // = the whole pool is stored. validCount == count is the
  // same statement written out, so it is accepted and
  // normalised away; anything outside 1..count, or a
  // non-integer, is malformed and refused with the reason.
  let validCount: number | undefined;
  if (isV2 && m.validCount !== undefined) {
    if (typeof m.validCount !== 'number' || !Number.isInteger(m.validCount) || m.validCount < 1) {
      return { error: `マニフェストの validCount（保存粒子数）は 1 以上の整数が必要です（${String(m.validCount)}）。` };
    }
    if (m.validCount > count) {
      return { error: `マニフェストの validCount（保存粒子数）${m.validCount.toLocaleString()} が count ${count.toLocaleString()} を超えています。` };
    }
    if (m.validCount < count) validCount = m.validCount;
  }
  const frameCount = m.frameCount;
  if (typeof frameCount !== 'number' || !Number.isInteger(frameCount) || frameCount <= 0) {
    return { error: 'マニフェストの frameCount は 1 以上の整数が必要です。' };
  }
  if (frameCount > STATE_CACHE_MAX_FRAMES) {
    return { error: `上限超過のため読み込めません: フレーム数 ${frameCount} が上限 ${STATE_CACHE_MAX_FRAMES} フレームを超えています。` };
  }
  const startFrame = m.startFrame === undefined ? 0 : m.startFrame;
  if (typeof startFrame !== 'number' || !Number.isInteger(startFrame) || startFrame < 0) {
    return { error: 'マニフェストの startFrame は 0 以上の整数が必要です。' };
  }
  const loop = m.loop === undefined ? true : m.loop;
  if (typeof loop !== 'boolean') return { error: 'マニフェストの loop は真偽値が必要です。' };
  const interpolation = m.interpolation === undefined ? 'linear' : m.interpolation;
  if (interpolation !== 'linear' && interpolation !== 'nearest') {
    return { error: 'マニフェストの interpolation は "linear" か "nearest" が必要です。' };
  }
  let coordinates = { up: 'y', unit: 'm' };
  if (m.coordinates !== undefined) {
    if (!m.coordinates || typeof m.coordinates !== 'object') return { error: 'マニフェストの coordinates が不正です。' };
    const c = m.coordinates as Record<string, unknown>;
    const up = c.up === undefined ? 'y' : c.up;
    const unit = c.unit === undefined ? 'm' : c.unit;
    if (up !== 'y' && up !== 'z') return { error: 'マニフェストの coordinates.up は "y" か "z" が必要です。' };
    if (typeof unit !== 'string' || unit.length === 0) return { error: 'マニフェストの coordinates.unit が不正です。' };
    coordinates = { up, unit };
  }
  // attributes: v2 = declarations {name, components, source};
  // v1 = bare names, upgraded with source 'legacy-v1' (their
  // origin was never recorded; the upgrade names that fact
  // instead of inventing an origin).
  const attributes: StateCacheAttributeDecl[] = [];
  if (m.attributes !== undefined) {
    if (!Array.isArray(m.attributes)) return { error: 'マニフェストの attributes は配列が必要です。' };
    for (const a of m.attributes as unknown[]) {
      if (isV1) {
        if (typeof a !== 'string' || a.length === 0) return { error: 'v1 マニフェストの attributes は属性名の配列が必要です。' };
        attributes.push({ name: a, components: 1, source: 'legacy-v1' });
      } else {
        if (!a || typeof a !== 'object') return { error: 'v2 マニフェストの attributes は {name, components, source} の配列が必要です。' };
        const d = a as Record<string, unknown>;
        attributes.push({ name: d.name as string, components: d.components as 1, source: d.source as string });
      }
    }
  }
  const declError = validateAttributeDecls(attributes);
  if (declError) return { error: declError };
  let orientation: StateCacheOrientationDecl | null = null;
  if (isV2 && m.orientation !== undefined && m.orientation !== null) {
    if (typeof m.orientation !== 'object') return { error: 'マニフェストの orientation が不正です。' };
    const enc = (m.orientation as Record<string, unknown>).encoding;
    if (enc !== ORIENTATION_ENCODING) {
      return { error: `マニフェストの orientation.encoding は "${ORIENTATION_ENCODING}" が必要です（"${String(enc)}"）。未知の符号化は補完せず拒否します。` };
    }
    orientation = { encoding: ORIENTATION_ENCODING };
  }
  let provenance: StateCacheProvenance | null = null;
  if (isV2) {
    if (!m.provenance || typeof m.provenance !== 'object') {
      return { error: 'v2 マニフェストには来歴（provenance）が必須です。来歴のない v2 ファイルは受理しません。' };
    }
    const p = m.provenance as Record<string, unknown>;
    provenance = {
      settingsHash: p.settingsHash as string,
      seed: p.seed as number,
      generator: p.generator as string,
      generatorVersion: p.generatorVersion as string,
    };
    const provError = validateProvenance(provenance);
    if (provError) return { error: provError };
  }
  const frameHashes = m.frameHashes;
  if (!Array.isArray(frameHashes) || frameHashes.length !== frameCount || frameHashes.some((h) => typeof h !== 'string')) {
    return { error: 'マニフェストの frameHashes が frameCount と一致しません。' };
  }
  return {
    manifest: {
      format: isV2 ? STATE_CACHE_FORMAT_V2 : STATE_CACHE_V1_FORMAT,
      version: isV2 ? STATE_CACHE_VERSION_V2 : 1,
      fps, count, ...(validCount !== undefined ? { validCount } : {}), texSize, frameCount, startFrame, loop, interpolation, coordinates,
      attributes, orientation, provenance,
      frameHashes: frameHashes as string[],
      sourceVersion: isV2 ? 2 : 1,
    },
  };
}

/* ---------------- binary frames ---------------- */

/** Floats per STORED frame — the binary layout's frame
 *  size. With validCount declared this is the thinned size
 *  (stored particles per channel); the in-memory channels
 *  stay count-wide regardless. */
export function stateCacheFrameFloatCountV2(manifest: StateCacheManifestV2): number {
  return stateCacheStoredCountV2(manifest) * (6 + manifest.attributes.length + (manifest.orientation ? 4 : 0));
}

/** Exact stored binary size in bytes for a manifest — the
 *  capacity figure of the two-layer limit discipline (see
 *  the header). Stored points are validCount-based, so a
 *  thinned file reports its thinned size: the A-5 scene
 *  (16,384 pool / 8,192 stored / 240 frames / 1 attribute /
 *  orientation) is 86,507,520 bytes here, exactly half of
 *  the 173,015,040 bytes the same manifest reports without
 *  validCount. The manifest JSON itself is not included. */
export function stateCacheStoredBinaryBytesV2(manifest: StateCacheManifestV2): number {
  return stateCacheFrameFloatCountV2(manifest) * 4 * manifest.frameCount;
}

export function encodeStateCacheFramesV2(cache: StateCacheDataV2): ArrayBuffer {
  const { manifest } = cache;
  const stored = stateCacheStoredCountV2(manifest);
  const perFrame = stateCacheFrameFloatCountV2(manifest);
  const out = new Float32Array(perFrame * manifest.frameCount);
  for (let f = 0; f < manifest.frameCount; f++) {
    let o = f * perFrame;
    out.set(storedPrefix(cache.positions[f], 3, stored), o); o += stored * 3;
    out.set(storedPrefix(cache.velocities[f], 3, stored), o); o += stored * 3;
    for (let a = 0; a < manifest.attributes.length; a++) {
      out.set(storedPrefix(cache.attrFrames[a][f], 1, stored), o); o += stored;
    }
    if (manifest.orientation) {
      if (!cache.orientations) throw new Error('orientation declared but no orientation data');
      out.set(storedPrefix(cache.orientations[f], 4, stored), o); o += stored * 4;
    }
  }
  return out.buffer;
}

export function decodeStateCacheFramesV2(manifest: StateCacheManifestV2, buffer: ArrayBuffer): StateCacheResultV2 {
  const perFrame = stateCacheFrameFloatCountV2(manifest);
  const expectedBytes = perFrame * manifest.frameCount * 4;
  if (buffer.byteLength !== expectedBytes) {
    return fail(`フレームデータのバイト長が一致しません（${buffer.byteLength} バイト、期待 ${expectedBytes} バイト）。`);
  }
  const { count } = manifest;
  const stored = stateCacheStoredCountV2(manifest);
  const all = new Float32Array(buffer);
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = manifest.attributes.map(() => []);
  const orientations: Float32Array[] | null = manifest.orientation ? [] : null;
  for (let f = 0; f < manifest.frameCount; f++) {
    let o = f * perFrame;
    const posStored = all.slice(o, o + stored * 3); o += stored * 3;
    const velStored = all.slice(o, o + stored * 3); o += stored * 3;
    const colsStored: Float32Array[] = [];
    for (let a = 0; a < manifest.attributes.length; a++) {
      colsStored.push(all.slice(o, o + stored)); o += stored;
    }
    let orientStored: Float32Array | null = null;
    if (manifest.orientation) {
      orientStored = all.slice(o, o + stored * 4); o += stored * 4;
    }
    // The hash verifies the STORED frame exactly as written
    // (for v1-read files the v1 hash definition over the
    // whole pool, which is what their manifests carry).
    const hash = manifest.sourceVersion === 1
      ? hashStateCacheFrame(posStored, velStored)
      : hashStateCacheFrameV2(posStored, velStored, colsStored, orientStored);
    if (hash !== manifest.frameHashes[f]) {
      return fail(`フレーム ${f} のハッシュが一致しません（データが壊れているか、マニフェストと対応していません）。`);
    }
    // Restore count-wide channels: stored prefix verbatim,
    // tail in the parked convention (positions parked at
    // (0, -99999, 0), velocities and attribute columns zero,
    // orientations identity). Unthinned files skip this —
    // expandStoredChannel returns the stored buffer itself.
    positions.push(expandStoredChannel(posStored, 3, stored, count, (out, i) => {
      out[i * 3] = STATE_CACHE_PARKED_POSITION[0];
      out[i * 3 + 1] = STATE_CACHE_PARKED_POSITION[1];
      out[i * 3 + 2] = STATE_CACHE_PARKED_POSITION[2];
    }));
    velocities.push(expandStoredChannel(velStored, 3, stored, count));
    for (let a = 0; a < manifest.attributes.length; a++) {
      attrFrames[a].push(expandStoredChannel(colsStored[a], 1, stored, count));
    }
    if (orientations && orientStored) {
      orientations.push(expandStoredChannel(orientStored, 4, stored, count, (out, i) => {
        out[i * 4 + 3] = 1;
      }));
    }
  }
  return { ok: true, cache: { manifest, positions, velocities, attrFrames, orientations } };
}

/* ---------------- sampling (incl. orientation slerp) -------- */

/** Spherical linear interpolation between unit quaternions
 *  (x, y, z, w). Takes the short arc (negates b when the dot
 *  product is negative); near-parallel inputs fall back to
 *  normalized lerp. */
export function quatSlerp(a: readonly number[], b: readonly number[], t: number): [number, number, number, number] {
  let bx = b[0]; let by = b[1]; let bz = b[2]; let bw = b[3];
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {
    const x = a[0] + (bx - a[0]) * t; const y = a[1] + (by - a[1]) * t;
    const z = a[2] + (bz - a[2]) * t; const w = a[3] + (bw - a[3]) * t;
    const n = Math.hypot(x, y, z, w) || 1;
    return [x / n, y / n, z / n, w / n];
  }
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;
  return [
    a[0] * wa + bx * wb, a[1] * wa + by * wb,
    a[2] * wa + bz * wb, a[3] * wa + bw * wb,
  ];
}

export function stateCacheFrameFloatV2(cache: StateCacheDataV2, timeSeconds: number, loop: boolean): number {
  const { frameCount, fps } = cache.manifest;
  if (frameCount <= 1) return 0;
  const raw = Math.max(0, timeSeconds) * fps;
  if (loop) {
    const wrapped = raw % frameCount;
    return wrapped < 0 ? wrapped + frameCount : wrapped;
  }
  return Math.min(raw, frameCount - 1);
}

function sampleLinear(frames: Float32Array[], frameFloat: number, interpolation: 'linear' | 'nearest', out: Float32Array): void {
  const last = frames.length - 1;
  if (interpolation === 'nearest' || last === 0) {
    out.set(frames[Math.min(last, Math.max(0, Math.round(frameFloat)))]);
    return;
  }
  const lo = Math.min(last, Math.floor(frameFloat));
  const hi = Math.min(last, lo + 1);
  const t = Math.min(1, Math.max(0, frameFloat - lo));
  const a = frames[lo]; const b = frames[hi];
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

export interface StateCacheSampleV2 {
  positions: Float32Array;
  velocities: Float32Array;
  /** count x 4. When the cache declares no orientation
   *  channel this is the identity quaternion for every
   *  particle — filled BY DECLARATION (v1 files have no
   *  orientation), not as a repair of missing data. */
  orientations: Float32Array;
  hasOrientation: boolean;
}

/**
 * Sample one clock time through the single mapping the
 * retimer grammar shares (time -> fractional frame, then
 * per-channel interpolation). Positions / velocities /
 * attributes interpolate linearly; orientation interpolates
 * by slerp. Reverse playback is a property of the frame
 * mapping the caller feeds in — orientation simply follows
 * the interpolation direction; no angular-velocity sign
 * convention is stored in the format (design §2-5).
 */
export function sampleStateCacheV2(cache: StateCacheDataV2, timeSeconds: number, loop: boolean): StateCacheSampleV2 {
  return sampleStateCacheV2AtFrame(cache, stateCacheFrameFloatV2(cache, timeSeconds, loop));
}

export function sampleStateCacheV2AtFrame(cache: StateCacheDataV2, frameFloat: number): StateCacheSampleV2 {
  const { manifest } = cache;
  const positions = new Float32Array(manifest.count * 3);
  const velocities = new Float32Array(manifest.count * 3);
  sampleLinear(cache.positions, frameFloat, manifest.interpolation, positions);
  sampleLinear(cache.velocities, frameFloat, manifest.interpolation, velocities);
  const orientations = new Float32Array(manifest.count * 4);
  if (!manifest.orientation || !cache.orientations) {
    for (let i = 0; i < manifest.count; i++) orientations[i * 4 + 3] = 1;
    return { positions, velocities, orientations, hasOrientation: false };
  }
  const last = cache.orientations.length - 1;
  if (manifest.interpolation === 'nearest' || last === 0) {
    orientations.set(cache.orientations[Math.min(last, Math.max(0, Math.round(frameFloat)))]);
    return { positions, velocities, orientations, hasOrientation: true };
  }
  const lo = Math.min(last, Math.floor(frameFloat));
  const hi = Math.min(last, lo + 1);
  const t = Math.min(1, Math.max(0, frameFloat - lo));
  const qa = cache.orientations[lo]; const qb = cache.orientations[hi];
  for (let i = 0; i < manifest.count; i++) {
    const q = quatSlerp(
      [qa[i * 4], qa[i * 4 + 1], qa[i * 4 + 2], qa[i * 4 + 3]],
      [qb[i * 4], qb[i * 4 + 1], qb[i * 4 + 2], qb[i * 4 + 3]],
      t,
    );
    orientations.set(q, i * 4);
  }
  return { positions, velocities, orientations, hasOrientation: true };
}

/* ---------------- point-cache conversion ------------------- */

/**
 * Convert to the point-cache playback shape via the v1
 * converter. Orientation has no place in the point-cache
 * format, so it is dropped — and the drop is REPORTED in the
 * result (design §2-5: never drop silently). Oriented
 * playback belongs to the state-cache-native consumer that
 * feeds an orient texture.
 */
export function stateCacheV2ToPointCacheData(cache: StateCacheDataV2):
  | { ok: true; data: import('./pointCache').PointCacheData; droppedOrientation: boolean; note: string }
  | { ok: false; error: string } {
  const v1Shape: StateCacheData = {
    manifest: {
      format: 'statecache-manifest-v1', version: 1,
      fps: cache.manifest.fps, count: cache.manifest.count, texSize: cache.manifest.texSize,
      frameCount: cache.manifest.frameCount, startFrame: cache.manifest.startFrame,
      loop: cache.manifest.loop, interpolation: cache.manifest.interpolation,
      coordinates: cache.manifest.coordinates,
      attributes: cache.manifest.attributes.map((d) => d.name),
      frameHashes: cache.manifest.frameHashes,
    },
    positions: cache.positions,
    velocities: cache.velocities,
    attrFrames: cache.attrFrames,
  };
  const conv = stateCacheToPointCacheData(v1Shape);
  if (!conv.ok) return conv;
  const dropped = !!cache.manifest.orientation;
  return {
    ok: true,
    data: conv.data,
    droppedOrientation: dropped,
    note: dropped
      ? '姿勢チャンネルは pointCache 形式に載らないため変換で落としました。姿勢を使う再生は状態キャッシュ専用の再生路でのみ行えます。'
      : '姿勢チャンネルは宣言されていないため、落としたデータはありません。',
  };
}

/* ---------------- single-frame checkpoint ------------------ */

/** Cut one frame out as a single-frame v2 cache — the
 *  checkpoint of method A (design §3-3). */
export function extractStateCacheFrameV2(cache: StateCacheDataV2, frameIndex: number): StateCacheResultV2 {
  const { manifest } = cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return fail(`フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。`);
  }
  const pick = <T,>(arr: T[] | null): T[] | null => (arr ? [arr[frameIndex]] : null);
  return {
    ok: true,
    cache: {
      manifest: {
        ...manifest,
        attributes: manifest.attributes.map((d) => ({ ...d })),
        orientation: manifest.orientation ? { ...manifest.orientation } : null,
        provenance: manifest.provenance ? { ...manifest.provenance } : null,
        frameCount: 1,
        startFrame: manifest.startFrame + frameIndex,
        frameHashes: [manifest.frameHashes[frameIndex]],
      },
      positions: [cache.positions[frameIndex].slice()],
      velocities: [cache.velocities[frameIndex].slice()],
      attrFrames: cache.attrFrames.map((per) => [per[frameIndex].slice()]),
      orientations: pick(cache.orientations) as Float32Array[] | null,
    },
  };
}

export interface CheckpointRef {
  ref: string;
  /** Frame hash of the checkpoint frame. */
  hash: string;
  /** Global frame index of the checkpoint frame. */
  frameIndex: number;
}

export function buildCheckpointRef(cache: StateCacheDataV2, frameIndex: number, ref: string): CheckpointRef {
  return { ref, hash: cache.manifest.frameHashes[frameIndex], frameIndex: cache.manifest.startFrame + frameIndex };
}

/**
 * Data-level verification that a checkpoint can seed the
 * next job: the checkpoint must be a single frame whose
 * position / velocity / age arrays feed the stage-3 S1
 * initial-state conversion (buildGpgpuInitialDataFromStateFrame)
 * and come back in the bake-shaped lanes unchanged. This is
 * the CPU-side half of the S1 resume path; whether the LIVE
 * sim resumes bit-identically from it is a real-GPU gate
 * item and remains unverified (see the record).
 */
export function verifyCheckpointCanSeedInitialState(checkpoint: StateCacheDataV2):
  | { ok: true; positions: Float32Array; velocities: Float32Array; ages: Float32Array }
  | { ok: false; error: string } {
  const { manifest } = checkpoint;
  if (manifest.frameCount !== 1) {
    return { ok: false, error: `チェックポイントは単一フレームでなければなりません（${manifest.frameCount} フレーム）。` };
  }
  const ageIndex = manifest.attributes.findIndex((d) => d.name.trim().toLowerCase() === 'age');
  if (ageIndex < 0) {
    return { ok: false, error: 'チェックポイントに age 属性が無いため、S1 の初期状態復元（位置テクスチャの w レーン＝年齢）に使えません。無い状態は作りません。' };
  }
  const ages = checkpoint.attrFrames[ageIndex][0];
  const initial = buildGpgpuInitialDataFromStateFrame({
    count: manifest.count,
    positions: checkpoint.positions[0],
    velocities: checkpoint.velocities[0],
    ages,
  });
  if (!initial) return { ok: false, error: 'チェックポイントのバッファ長が粒子数と一致しません。' };
  for (let i = 0; i < manifest.count; i++) {
    if (initial.posData[i * 4] !== checkpoint.positions[0][i * 3]
      || initial.posData[i * 4 + 1] !== checkpoint.positions[0][i * 3 + 1]
      || initial.posData[i * 4 + 2] !== checkpoint.positions[0][i * 3 + 2]
      || initial.posData[i * 4 + 3] !== ages[i]
      || initial.velData[i * 4] !== checkpoint.velocities[0][i * 3]
      || initial.velData[i * 4 + 1] !== checkpoint.velocities[0][i * 3 + 1]
      || initial.velData[i * 4 + 2] !== checkpoint.velocities[0][i * 3 + 2]) {
      return { ok: false, error: `チェックポイントの粒子 ${i} が S1 変換で一致しません。` };
    }
  }
  return { ok: true, positions: checkpoint.positions[0], velocities: checkpoint.velocities[0], ages };
}

/* ---------------- bake jobs: split & merge ----------------- */

export interface BakeJobDescriptor {
  jobId: string;
  sceneRef: { ref: string; hash: string };
  /** [start, end) in global frame indices. */
  frameRange: [number, number];
  startMode: 'fromInitial' | 'fromCheckpoint';
  checkpointRef?: CheckpointRef;
  /** Attribute names to capture (same vocabulary as the
   *  manifest declarations). */
  attributes: string[];
  includeOrientation: boolean;
  seed: number;
  outputRef: string;
  /** Defaults to BAKE_SPLIT_DEFAULT_METHOD when omitted. */
  method?: BakeSplitMethod;
}

export type BakeJobResult = { ok: true; job: BakeJobDescriptor } | { ok: false; error: string };

export function validateBakeJobDescriptor(job: BakeJobDescriptor): BakeJobResult {
  if (!job || typeof job.jobId !== 'string' || job.jobId.length === 0) return { ok: false, error: 'ジョブ記述の jobId が不正です。' };
  if (!job.sceneRef || typeof job.sceneRef.hash !== 'string' || job.sceneRef.hash.length === 0) {
    return { ok: false, error: `ジョブ "${job.jobId}" の sceneRef.hash がありません。設定ハッシュが一致しない場面では実行しません。` };
  }
  const [s, e] = job.frameRange ?? [];
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s) {
    return { ok: false, error: `ジョブ "${job.jobId}" の frameRange は [開始, 終了) で開始 < 終了の整数が必要です（[${String(s)}, ${String(e)})）。` };
  }
  if (job.startMode !== 'fromInitial' && job.startMode !== 'fromCheckpoint') {
    return { ok: false, error: `ジョブ "${job.jobId}" の startMode が不正です。` };
  }
  if (job.startMode === 'fromCheckpoint') {
    if (!job.checkpointRef || typeof job.checkpointRef.hash !== 'string' || job.checkpointRef.hash.length === 0) {
      return { ok: false, error: `ジョブ "${job.jobId}" は fromCheckpoint ですが checkpointRef（境界フレームの参照とハッシュ）がありません。` };
    }
    if (job.checkpointRef.frameIndex !== s - 1 && job.checkpointRef.frameIndex !== s) {
      return { ok: false, error: `ジョブ "${job.jobId}" の checkpointRef.frameIndex (${job.checkpointRef.frameIndex}) が担当範囲の境界（${s - 1} または ${s}）と一致しません。` };
    }
  }
  if (!Number.isInteger(job.seed)) return { ok: false, error: `ジョブ "${job.jobId}" の seed は整数が必要です。ジョブ間で同一でなければなりません。` };
  if (!Array.isArray(job.attributes) || job.attributes.some((a) => typeof a !== 'string' || a.length === 0)) {
    return { ok: false, error: `ジョブ "${job.jobId}" の attributes が不正です。` };
  }
  if (new Set(job.attributes).size !== job.attributes.length) {
    return { ok: false, error: `ジョブ "${job.jobId}" の attributes が重複しています。` };
  }
  if (typeof job.outputRef !== 'string' || job.outputRef.length === 0) {
    return { ok: false, error: `ジョブ "${job.jobId}" の outputRef が不正です。` };
  }
  const method = job.method ?? BAKE_SPLIT_DEFAULT_METHOD;
  if (method !== 'checkpoint-chain' && method !== 'independent-recompute') {
    return { ok: false, error: `ジョブ "${job.jobId}" の method が不正です。` };
  }
  if (method === 'independent-recompute' && job.startMode !== 'fromInitial') {
    return { ok: false, error: `ジョブ "${job.jobId}": 方式B（独立再計算）は fromInitial でのみ意味を持ちます。方式Bは既定ではなく、同一端末・同一版での再実行に限ります。` };
  }
  return { ok: true, job };
}

/** Split a whole cache into per-range part caches, following
 *  contiguous ranges that cover the whole cache exactly.
 *  Gaps / overlaps / partial coverage are refused — a part
 *  set that does not cover everything is a different call
 *  (extractStateCacheFrameV2 / range extraction by hand). */
export function splitStateCacheV2(
  cache: StateCacheDataV2,
  ranges: [number, number][],
): { ok: true; parts: StateCacheDataV2[] } | { ok: false; error: string } {
  const { manifest } = cache;
  if (ranges.length === 0) return { ok: false, error: '分割範囲が空です。' };
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [s, e] of sorted) {
    if (!Number.isInteger(s) || !Number.isInteger(e) || e <= s) {
      return { ok: false, error: `分割範囲 [${s}, ${e}) が不正です。` };
    }
    if (s !== cursor) {
      return { ok: false, error: s > cursor
        ? `分割範囲に欠けがあります（フレーム ${cursor} から ${s} の手前までがどの範囲にも含まれません）。欠けは補完しません。`
        : `分割範囲が重なっています（フレーム ${s} は前の範囲と重なります）。` };
    }
    cursor = e;
  }
  if (cursor !== manifest.frameCount) {
    return { ok: false, error: `分割範囲の終端 ${cursor} がキャッシュのフレーム数 ${manifest.frameCount} と一致しません。` };
  }
  const parts: StateCacheDataV2[] = sorted.map(([s, e]) => ({
    manifest: {
      ...manifest,
      attributes: manifest.attributes.map((d) => ({ ...d })),
      orientation: manifest.orientation ? { ...manifest.orientation } : null,
      provenance: manifest.provenance ? { ...manifest.provenance } : null,
      frameCount: e - s,
      startFrame: manifest.startFrame + s,
      frameHashes: manifest.frameHashes.slice(s, e),
    },
    positions: cache.positions.slice(s, e).map((a) => a.slice()),
    velocities: cache.velocities.slice(s, e).map((a) => a.slice()),
    attrFrames: cache.attrFrames.map((per) => per.slice(s, e).map((a) => a.slice())),
    orientations: cache.orientations ? cache.orientations.slice(s, e).map((a) => a.slice()) : null,
  }));
  return { ok: true, parts };
}

export interface BakeJobPart {
  job: BakeJobDescriptor;
  cache: StateCacheDataV2;
}

/**
 * Merge job parts back into one whole cache (design §3-4).
 * Verifications, all refusing with the reason:
 * (1) every job's sceneRef.hash equals every other job's and
 *     the parts' provenance settingsHash, and every seed
 *     (job + provenance) is identical;
 * (2) frame ranges are continuous — no gap, no overlap — and
 *     each part cache matches its job's range exactly;
 * (3) seams: for checkpoint-chain parts after the first, the
 *     job's checkpointRef.hash must equal the previous part's
 *     last frame hash; for independent-recompute parts the
 *     same seam-hash equality is the mandatory guard (and
 *     such parts must have been produced on one device /
 *     version — the hash is the only evidence accepted);
 * (4) after concatenation every frame hash is recomputed
 *     over the merged buffers.
 * Format-level agreement (fps, count, texSize, attributes,
 * orientation, interpolation, coordinates) is also required.
 */
export function mergeBakeJobParts(parts: BakeJobPart[]): StateCacheResultV2 {
  if (parts.length === 0) return fail('統合する部分キャッシュがありません。');
  for (const p of parts) {
    const v = validateBakeJobDescriptor(p.job);
    if (!v.ok) return fail(v.error);
  }
  const sorted = [...parts].sort((a, b) => a.job.frameRange[0] - b.job.frameRange[0]);
  const first = sorted[0];
  const sceneHash = first.job.sceneRef.hash;
  const seed = first.job.seed;
  const m0 = first.cache.manifest;
  if (m0.sourceVersion !== 2 || !m0.provenance) {
    return fail('統合できるのは v2 形式（来歴つき）の部分キャッシュだけです。');
  }
  if (m0.provenance.settingsHash !== sceneHash || m0.provenance.seed !== seed) {
    return fail(`ジョブ "${first.job.jobId}" の来歴（設定ハッシュ／シード）がジョブ記述と一致しません。`);
  }
  let cursor = first.job.frameRange[0];
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = m0.attributes.map(() => []);
  const orientations: Float32Array[] | null = m0.orientation ? [] : null;
  const frameHashes: string[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const { job, cache } = sorted[idx];
    const m = cache.manifest;
    if (job.sceneRef.hash !== sceneHash) {
      return fail(`ジョブ "${job.jobId}" の sceneRef ハッシュが他のジョブと一致しません。設定が違うジョブの結果は統合しません。`);
    }
    if (job.seed !== seed) {
      return fail(`ジョブ "${job.jobId}" の seed が他のジョブと一致しません（${job.seed} ≠ ${seed}）。`);
    }
    if (!m.provenance || m.provenance.settingsHash !== sceneHash || m.provenance.seed !== seed) {
      return fail(`ジョブ "${job.jobId}" の部分キャッシュの来歴が統合条件（設定ハッシュ／シード）と一致しません。`);
    }
    if (m.fps !== m0.fps || m.count !== m0.count || m.texSize !== m0.texSize
      || (m.validCount ?? null) !== (m0.validCount ?? null)
      || m.interpolation !== m0.interpolation
      || JSON.stringify(m.coordinates) !== JSON.stringify(m0.coordinates)
      || JSON.stringify(m.attributes) !== JSON.stringify(m0.attributes)
      || JSON.stringify(m.orientation) !== JSON.stringify(m0.orientation)
      || !!m.orientation !== !!cache.orientations) {
      return fail(`ジョブ "${job.jobId}" の部分キャッシュの形式（fps／粒子数／属性／姿勢）が他の部分と一致しません。`);
    }
    if (job.includeOrientation !== !!m.orientation) {
      return fail(`ジョブ "${job.jobId}" の includeOrientation が部分キャッシュの姿勢宣言と一致しません。`);
    }
    if (JSON.stringify(job.attributes) !== JSON.stringify(m0.attributes.map((d) => d.name))) {
      return fail(`ジョブ "${job.jobId}" の attributes が部分キャッシュの属性宣言と一致しません。`);
    }
    const [s, e] = job.frameRange;
    if (s !== cursor) {
      return fail(s > cursor
        ? `フレーム範囲に欠けがあります（${cursor} から ${s} の手前までが未完です）。未完の範囲は補完せず、揃った範囲までだけが有効です。`
        : `フレーム範囲が重なっています（ジョブ "${job.jobId}" は ${s} から始まりますが、前のジョブは ${cursor} まで終わっています）。`);
    }
    if (m.frameCount !== e - s || m.startFrame !== (m0.startFrame + s - sorted[0].job.frameRange[0])) {
      // startFrame of a part is the global frame index of its first frame.
      if (m.frameCount !== e - s) {
        return fail(`ジョブ "${job.jobId}" の部分キャッシュのフレーム数 ${m.frameCount} が担当範囲 ${e - s} と一致しません。`);
      }
    }
    if (m.startFrame !== m0.startFrame + (s - sorted[0].job.frameRange[0])) {
      return fail(`ジョブ "${job.jobId}" の部分キャッシュの startFrame ${m.startFrame} が担当範囲の開始 ${s} と対応しません。`);
    }
    if (idx > 0) {
      const prevHash = frameHashes[frameHashes.length - 1];
      const method = job.method ?? BAKE_SPLIT_DEFAULT_METHOD;
      if (method === 'checkpoint-chain') {
        if (job.startMode !== 'fromCheckpoint' || !job.checkpointRef) {
          return fail(`ジョブ "${job.jobId}": チェックポイント連結（方式A）では2件目以降は fromCheckpoint でなければなりません。`);
        }
        if (job.checkpointRef.hash !== prevHash) {
          return fail(`ジョブ "${job.jobId}" のチェックポイントのハッシュが前のジョブの最終フレームと一致しません。連結の継ぎ目が壊れているため統合しません。`);
        }
      } else if (job.checkpointRef && job.checkpointRef.hash !== prevHash) {
        return fail(`ジョブ "${job.jobId}": 方式Bでも継ぎ目フレームのハッシュ一致が必須検証です。一致しないため統合しません。`);
      }
    }
    positions.push(...cache.positions);
    velocities.push(...cache.velocities);
    cache.attrFrames.forEach((per, a) => attrFrames[a].push(...per));
    if (orientations && cache.orientations) orientations.push(...cache.orientations);
    frameHashes.push(...m.frameHashes);
    cursor = e;
  }
  const merged: StateCacheDataV2 = {
    manifest: {
      ...m0,
      attributes: m0.attributes.map((d) => ({ ...d })),
      orientation: m0.orientation ? { ...m0.orientation } : null,
      provenance: { ...m0.provenance },
      frameCount: positions.length,
      startFrame: m0.startFrame,
      frameHashes: [...frameHashes],
    },
    positions, velocities, attrFrames, orientations,
  };
  // (4) recompute every hash over the merged buffers — over
  // the STORED prefixes when the parts are thinned (the
  // merged in-memory tail is the parked restore, which no
  // hash covers; the stored prefixes are the parts' own
  // bytes carried through verbatim).
  const mergedStored = stateCacheStoredCountV2(merged.manifest);
  for (let f = 0; f < merged.manifest.frameCount; f++) {
    const cols = merged.attrFrames.map((per) => per[f]);
    const h = hashStoredFrameV2(
      mergedStored,
      merged.positions[f], merged.velocities[f], cols,
      merged.orientations ? merged.orientations[f] : null,
    );
    if (h !== merged.manifest.frameHashes[f]) {
      return fail(`統合後のフレーム ${f} のハッシュ再計算が一致しません。部分キャッシュのいずれかが壊れています。`);
    }
  }
  return { ok: true, cache: merged };
}

/**
 * Replace one part with a re-run of the SAME frame range
 * (design §3-4: a failed range can be re-executed and swapped
 * in on its own — range-level idempotence). A replacement
 * covering a different range is refused.
 */
export function replaceBakeJobPart(
  parts: BakeJobPart[],
  jobId: string,
  replacement: BakeJobPart,
): { ok: true; parts: BakeJobPart[] } | { ok: false; error: string } {
  const idx = parts.findIndex((p) => p.job.jobId === jobId);
  if (idx < 0) return { ok: false, error: `差し替えるジョブ "${jobId}" が部分集合にありません。` };
  const old = parts[idx];
  if (replacement.job.frameRange[0] !== old.job.frameRange[0] || replacement.job.frameRange[1] !== old.job.frameRange[1]) {
    return { ok: false, error: `差し替えは同じフレーム範囲 [${old.job.frameRange[0]}, ${old.job.frameRange[1]}) の再実行だけが可能です（受け取った範囲は [${replacement.job.frameRange[0]}, ${replacement.job.frameRange[1]})）。` };
  }
  if (replacement.job.sceneRef.hash !== old.job.sceneRef.hash || replacement.job.seed !== old.job.seed) {
    return { ok: false, error: '差し替えジョブの設定ハッシュ／シードが元のジョブと一致しません。' };
  }
  const next = [...parts];
  next[idx] = replacement;
  return { ok: true, parts: next };
}
