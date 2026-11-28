import { buildPointCache, POINT_CACHE_MAX_FRAMES, POINT_CACHE_MAX_POINTS, type PointCacheData } from './pointCache';

/**
 * Simulation state cache (Grammar 2.0 stage 3, slice S0): the
 * canonical frame-sequence form for this app's OWN simulation
 * results — the counterpart to lib/pointCache.ts, which imports
 * caches baked by external tools. Design:
 * kalokagathia-pro/STAGE3_DESIGN.md (判断1: the frame sequence
 * is the one canonical asset form; PRT / Alembic are converters
 * off it, slices S3 / S4).
 *
 * Shape: a JSON manifest (this module's format, versioned) plus
 * ONE binary blob holding every frame back to back. Per frame:
 * positions (count x 3), velocities (count x 3), then one
 * count-wide column per declared attribute, all float32. The
 * capture side feeds the EXISTING readback buffers (the
 * captureState path: readRenderTargetPixels positions +
 * readbackParticleVelocities, both count x 4) — the w lane is
 * dropped at assembly, no new readback route is created
 * (判断2).
 *
 * Discipline, mirroring pointCache: validation never fills
 * gaps. A version mismatch, a cap overflow, a short buffer or
 * a frame-hash mismatch rejects the whole cache with the
 * reason stated. The manifest carries a per-frame FNV-1a hash
 * (the same algorithm as hashSimulationBuffers in
 * components/gpgpuDiagnosticAov.ts, over the stored triplet
 * buffers) so an encode -> decode round trip is verifiable
 * bit-exactly without the live sim.
 *
 * Caps: the format holds the main pool as it is — up to
 * 65,536 points (texSize 256 squared) and 3,600 frames (the
 * deterministic renderer's own maximum). Playback through the
 * point-cache consumer keeps pointCache's smaller caps
 * (8,192 x 240): stateCacheToPointCacheData refuses beyond
 * them with the reason, it never decimates (STAGE3_DESIGN §6:
 * the pool-vs-cap relation is resolved this way — the format
 * is not the constraint, the playback consumer is).
 *
 * Edition gate (杉 decision, STAGE3_DESIGN §4.5-3): export /
 * save features are full-edition features. This tree is the
 * full (mother) side and no edition mechanism exists in the
 * codebase yet, so the gate is a single predicate the future
 * build wiring feeds: 'public' disables, anything else
 * (including unspecified) allows.
 */

export const STATE_CACHE_FORMAT = 'statecache-manifest-v1';
export const STATE_CACHE_VERSION = 1;
export const STATE_CACHE_MAX_POINTS = 65536;
export const STATE_CACHE_MAX_FRAMES = 3600;
export const STATE_CACHE_MAX_ATTRIBUTE_COLUMNS = 8;

export interface StateCacheManifest {
  format: string;
  version: number;
  fps: number;
  count: number;
  texSize: number;
  frameCount: number;
  startFrame: number;
  loop: boolean;
  interpolation: 'linear' | 'nearest';
  coordinates: { up: string; unit: string };
  /** Attribute column names, in binary layout order. */
  attributes: string[];
  /** Per-frame FNV-1a hash over the stored buffers. */
  frameHashes: string[];
}

export interface StateCacheData {
  manifest: StateCacheManifest;
  /** Positions per frame, each count x 3. */
  positions: Float32Array[];
  /** Velocities per frame, each count x 3. */
  velocities: Float32Array[];
  /** Per attribute (manifest order): per frame, count each. */
  attrFrames: Float32Array[][];
}

/** One captured frame, in readback shape (count x 4 buffers). */
export interface StateCacheFrameInput {
  positions: Float32Array;
  velocities: Float32Array;
  attributes?: Record<string, Float32Array>;
}

export type StateCacheResult =
  | { ok: true; cache: StateCacheData }
  | { ok: false; error: string };

const fail = (error: string): StateCacheResult => ({ ok: false, error });

/** Full-edition gate for export / save features (see header). */
export function stateCacheExportAllowed(edition?: string): boolean {
  return edition !== 'public';
}

/* ---------------- hashing ---------------- */

/** FNV-1a over the raw bytes of both buffers — the same
 *  algorithm as hashSimulationBuffers (diagnostic AOV), here
 *  over the stored triplet buffers so a decoded cache can be
 *  verified standalone. */
export function hashStateCacheFrame(positions: Float32Array, velocities: Float32Array): string {
  let h = 0x811c9dc5;
  const mix = (buf: Float32Array) => {
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193);
    }
  };
  mix(positions);
  mix(velocities);
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/* ---------------- assembly (capture side) ---------------- */

export function assembleStateCache(args: {
  fps: number;
  texSize: number;
  frames: StateCacheFrameInput[];
  attributeNames?: string[];
  startFrame?: number;
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
}): StateCacheResult {
  const { fps, texSize, frames } = args;
  const attributeNames = args.attributeNames ?? [];
  if (!Number.isFinite(fps) || fps <= 0) return fail('キャッシュの fps は 0 より大きい数値が必要です。');
  if (!Number.isInteger(texSize) || texSize <= 0) return fail('キャッシュの texSize は 1 以上の整数が必要です。');
  const count = texSize * texSize;
  if (count > STATE_CACHE_MAX_POINTS) {
    return fail(`上限超過のため保存できません: 点数 ${count.toLocaleString()} が上限 ${STATE_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。`);
  }
  if (frames.length === 0) return fail('キャッシュするフレームがありません。');
  if (frames.length > STATE_CACHE_MAX_FRAMES) {
    return fail(`上限超過のため保存できません: フレーム数 ${frames.length} が上限 ${STATE_CACHE_MAX_FRAMES} フレームを超えています。`);
  }
  if (attributeNames.length > STATE_CACHE_MAX_ATTRIBUTE_COLUMNS) {
    return fail(`上限超過のため保存できません: 属性が ${attributeNames.length} 列あり、上限 ${STATE_CACHE_MAX_ATTRIBUTE_COLUMNS} 列を超えています。`);
  }
  const seen = new Set<string>();
  for (const name of attributeNames) {
    if (typeof name !== 'string' || name.length === 0) return fail('属性名が不正です。');
    const lowered = name.trim().toLowerCase();
    if (lowered === 'x' || lowered === 'y' || lowered === 'z') return fail(`属性名 "${name}" は位置の列と重なります。`);
    if (seen.has(lowered)) return fail(`属性名 "${name}" が重複しています。`);
    seen.add(lowered);
  }
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = attributeNames.map(() => []);
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
    frameHashes.push(hashStateCacheFrame(pos, vel));
    for (let a = 0; a < attributeNames.length; a++) {
      const values = frame.attributes?.[attributeNames[a]];
      if (!values || values.length !== count) {
        return fail(`フレーム ${f} の属性 "${attributeNames[a]}" が無いか、長さが粒子数と一致しません。`);
      }
      attrFrames[a].push(new Float32Array(values));
    }
  }
  const manifest: StateCacheManifest = {
    format: STATE_CACHE_FORMAT,
    version: STATE_CACHE_VERSION,
    fps,
    count,
    texSize,
    frameCount: frames.length,
    startFrame: args.startFrame ?? 0,
    loop: args.loop ?? true,
    interpolation: args.interpolation ?? 'linear',
    coordinates: { up: 'y', unit: 'm' },
    attributes: [...attributeNames],
    frameHashes,
  };
  return { ok: true, cache: { manifest, positions, velocities, attrFrames } };
}

/* ---------------- manifest ---------------- */

export function serializeStateCacheManifest(cache: StateCacheData): string {
  return JSON.stringify(cache.manifest);
}

export function parseStateCacheManifest(text: string): { manifest: StateCacheManifest } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { error: 'マニフェストを JSON として読めませんでした。' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'マニフェストが JSON オブジェクトではありません。' };
  const m = raw as Record<string, unknown>;
  if (m.format !== STATE_CACHE_FORMAT) {
    return { error: `マニフェストの format が "${STATE_CACHE_FORMAT}" ではありません（"${String(m.format)}"）。` };
  }
  if (m.version !== STATE_CACHE_VERSION) {
    return { error: `マニフェストの version は ${STATE_CACHE_VERSION} が必要です（"${String(m.version)}"）。` };
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
  const attributes: string[] = [];
  if (m.attributes !== undefined) {
    if (!Array.isArray(m.attributes) || m.attributes.some((a) => typeof a !== 'string' || a.length === 0)) {
      return { error: 'マニフェストの attributes は属性名の配列が必要です。' };
    }
    attributes.push(...(m.attributes as string[]));
  }
  if (attributes.length > STATE_CACHE_MAX_ATTRIBUTE_COLUMNS) {
    return { error: `上限超過のため読み込めません: 属性が ${attributes.length} 列あり、上限 ${STATE_CACHE_MAX_ATTRIBUTE_COLUMNS} 列を超えています。` };
  }
  const frameHashes = m.frameHashes;
  if (!Array.isArray(frameHashes) || frameHashes.length !== frameCount || frameHashes.some((h) => typeof h !== 'string')) {
    return { error: 'マニフェストの frameHashes が frameCount と一致しません。' };
  }
  return {
    manifest: {
      format: STATE_CACHE_FORMAT, version: STATE_CACHE_VERSION, fps, count, texSize, frameCount,
      startFrame, loop, interpolation, coordinates, attributes,
      frameHashes: frameHashes as string[],
    },
  };
}

/* ---------------- binary frames ---------------- */

/** Floats per frame: positions + velocities + one column per attribute. */
export function stateCacheFrameFloatCount(manifest: StateCacheManifest): number {
  return manifest.count * (6 + manifest.attributes.length);
}

export function encodeStateCacheFrames(cache: StateCacheData): ArrayBuffer {
  const { manifest } = cache;
  const perFrame = stateCacheFrameFloatCount(manifest);
  const out = new Float32Array(perFrame * manifest.frameCount);
  for (let f = 0; f < manifest.frameCount; f++) {
    let o = f * perFrame;
    out.set(cache.positions[f], o); o += manifest.count * 3;
    out.set(cache.velocities[f], o); o += manifest.count * 3;
    for (let a = 0; a < manifest.attributes.length; a++) {
      out.set(cache.attrFrames[a][f], o); o += manifest.count;
    }
  }
  return out.buffer;
}

export function decodeStateCacheFrames(manifest: StateCacheManifest, buffer: ArrayBuffer): StateCacheResult {
  const perFrame = stateCacheFrameFloatCount(manifest);
  const expectedBytes = perFrame * manifest.frameCount * 4;
  if (buffer.byteLength !== expectedBytes) {
    return fail(`フレームデータのバイト長が一致しません（${buffer.byteLength} バイト、期待 ${expectedBytes} バイト）。`);
  }
  const all = new Float32Array(buffer);
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = manifest.attributes.map(() => []);
  for (let f = 0; f < manifest.frameCount; f++) {
    let o = f * perFrame;
    const pos = all.slice(o, o + manifest.count * 3); o += manifest.count * 3;
    const vel = all.slice(o, o + manifest.count * 3); o += manifest.count * 3;
    positions.push(pos);
    velocities.push(vel);
    for (let a = 0; a < manifest.attributes.length; a++) {
      attrFrames[a].push(all.slice(o, o + manifest.count)); o += manifest.count;
    }
    const hash = hashStateCacheFrame(pos, vel);
    if (hash !== manifest.frameHashes[f]) {
      return fail(`フレーム ${f} のハッシュが一致しません（データが壊れているか、マニフェストと対応していません）。`);
    }
  }
  return { ok: true, cache: { manifest, positions, velocities, attrFrames } };
}

/* ---------------- playback sampling ---------------- */

/** Fractional frame for a clock time — the same mapping as
 *  pointCacheFrameFloat (pointCache.ts), so the shared
 *  sequence clock reads both cache kinds identically. */
export function stateCacheFrameFloat(cache: StateCacheData, timeSeconds: number, loop: boolean): number {
  const { frameCount, fps } = cache.manifest;
  if (frameCount <= 1) return 0;
  const raw = Math.max(0, timeSeconds) * fps;
  if (loop) {
    const wrapped = raw % frameCount;
    return wrapped < 0 ? wrapped + frameCount : wrapped;
  }
  return Math.min(raw, frameCount - 1);
}

function sampleFrames(frames: Float32Array[], frameFloat: number, interpolation: 'linear' | 'nearest', out: Float32Array): void {
  const last = frames.length - 1;
  if (interpolation === 'nearest' || last === 0) {
    out.set(frames[Math.min(last, Math.max(0, Math.round(frameFloat)))]);
    return;
  }
  const lo = Math.min(last, Math.floor(frameFloat));
  const hi = Math.min(last, lo + 1);
  const t = Math.min(1, Math.max(0, frameFloat - lo));
  const a = frames[lo];
  const b = frames[hi];
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * t;
}

/** Interpolated positions + velocities at a clock time. */
export function sampleStateCache(cache: StateCacheData, timeSeconds: number, loop: boolean): { positions: Float32Array; velocities: Float32Array } {
  const ff = stateCacheFrameFloat(cache, timeSeconds, loop);
  const positions = new Float32Array(cache.manifest.count * 3);
  const velocities = new Float32Array(cache.manifest.count * 3);
  sampleFrames(cache.positions, ff, cache.manifest.interpolation, positions);
  sampleFrames(cache.velocities, ff, cache.manifest.interpolation, velocities);
  return { positions, velocities };
}

/* ---------------- point-cache conversion (playback) ---------------- */

/**
 * Convert to the point-cache data shape so the EXISTING
 * playback consumption (the attribute point cloud store, via
 * buildPointCacheCloud) plays a state cache with no new
 * consumer wiring — including the no-resimulation playback
 * for exhibition / live use (杉 decision, §4.5-2). Refuses
 * beyond pointCache's caps with the reason (never decimates).
 */
export function stateCacheToPointCacheData(cache: StateCacheData): { ok: true; data: PointCacheData } | { ok: false; error: string } {
  const { manifest } = cache;
  if (manifest.count > POINT_CACHE_MAX_POINTS) {
    return { ok: false, error: `再生側の上限超過のため変換できません: 点数 ${manifest.count.toLocaleString()} が再生上限 ${POINT_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。` };
  }
  if (manifest.frameCount > POINT_CACHE_MAX_FRAMES) {
    return { ok: false, error: `再生側の上限超過のため変換できません: フレーム数 ${manifest.frameCount} が再生上限 ${POINT_CACHE_MAX_FRAMES} フレームを超えています。` };
  }
  const data = buildPointCache({
    format: 'pointcache-manifest-v2',
    version: 2,
    fps: manifest.fps,
    count: manifest.count,
    startFrame: manifest.startFrame,
    frameCount: manifest.frameCount,
    loop: manifest.loop,
    interpolation: manifest.interpolation,
    coordinates: manifest.coordinates,
    attributes: manifest.attributes.map((name) => ({ name, type: 'float' as const, perFrame: true })),
    files: [],
  }, cache.positions.map((p) => new Float32Array(p)), false, cache.attrFrames.map((perAttr) => perAttr.map((f) => new Float32Array(f))));
  return { ok: true, data };
}
