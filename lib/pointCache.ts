import React from 'react';
import type { AttrPointCloud } from './attrPointCloud';
import type { DataTable } from './dataTable';

/**
 * Point cache import (Phase BZ): an animated point cloud baked by
 * an external tool, brought in as a numbered sequence of binary
 * PLY frames plus a JSON manifest (format v2, designed in the
 * foundation rounds by #4 db — 台帳 2026-11-19-kalokagathia-
 * pointcache.md §8 spike / §9.1 manifest draft; cross-checked by
 * #5 ランザルザー and #11 白丸）.
 *
 * Contract (杉's decisions, 2026-11-19):
 * - Caps: at most 8,192 points x 240 frames, held fully in memory
 *   (retention plan A). Anything larger is REFUSED at load with a
 *   stated reason — never silently decimated or padded.
 * - Positions only in this first round. The manifest's
 *   `attributes` declaration is part of the format (and validated
 *   against every PLY header), but attribute values are not held
 *   per frame yet.
 * - Validation never fills gaps: a point-count mismatch, a missing
 *   frame file, a declaration mismatch or a cap overflow rejects
 *   the whole cache and names the offending file / field.
 *
 * Playback (design A): the shared sequence clock is the single
 * time source (lib/usePointCachePlayback.ts drives the frame
 * swaps); the mapping time -> frame -> positions in this module
 * is a pure function, so the same clock time always yields the
 * same frame and the same interpolated positions.
 *
 * The loaded cache feeds the EXISTING attribute point cloud store
 * (lib/attrPointCloud.ts): each frame swap publishes a fresh cloud
 * through the transient (non-persisting) setter, so the morph
 * 'data' target and the attribute 'data' source consume the moving
 * cloud with no new consumer wiring.
 */

export const POINT_CACHE_FORMAT = 'pointcache-manifest-v2';
export const POINT_CACHE_MAX_POINTS = 8192;
export const POINT_CACHE_MAX_FRAMES = 240;

export interface PointCacheAttributeDecl {
  name: string;
  type: 'float';
  perFrame: boolean;
}

export interface PointCacheManifest {
  format: string;
  version: number;
  fps: number;
  count: number;
  startFrame: number;
  frameCount: number;
  loop: boolean;
  interpolation: 'linear' | 'nearest';
  coordinates: { up: string; unit: string };
  attributes: PointCacheAttributeDecl[];
  files: string[];
}

export interface PointCacheData {
  manifest: PointCacheManifest;
  /** Raw positions per frame, each count x 3. */
  frames: Float32Array[];
  /** Frame-0 unit-sphere convention (attrPointCloud): centre is
   *  frame 0's range midpoint, scale puts frame 0's farthest point
   *  at radius 1 (0 when frame 0 is a single point). */
  center: [number, number, number];
  scale: number;
  /** Per-axis min / max over ALL frames (the normalised columns'
   *  ranges, matching buildCloud's column-range convention). */
  mins: [number, number, number];
  maxs: [number, number, number];
  /** True for the procedurally generated bundled sample. */
  bundled: boolean;
}

export type PointCacheLoadResult =
  | { ok: true; cache: PointCacheData }
  | { ok: false; error: string };

const fail = (error: string): PointCacheLoadResult => ({ ok: false, error });

/* ---------------- manifest ---------------- */

export function parsePointCacheManifest(text: string): { manifest: PointCacheManifest } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return { error: 'マニフェストを JSON として読めませんでした。' };
  }
  if (!raw || typeof raw !== 'object') return { error: 'マニフェストが JSON オブジェクトではありません。' };
  const m = raw as Record<string, unknown>;
  if (m.format !== POINT_CACHE_FORMAT) {
    return { error: `マニフェストの format が "${POINT_CACHE_FORMAT}" ではありません（"${String(m.format)}"）。` };
  }
  if (m.version !== 2) {
    return { error: `マニフェストの version は 2 が必要です（"${String(m.version)}"）。` };
  }
  const fps = m.fps;
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    return { error: 'マニフェストの fps は 0 より大きい数値が必要です。' };
  }
  const count = m.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return { error: 'マニフェストの count は 1 以上の整数が必要です。' };
  }
  if (count > POINT_CACHE_MAX_POINTS) {
    return {
      error: `上限超過のため読み込めません: 点数 ${count.toLocaleString()} が上限 ${POINT_CACHE_MAX_POINTS.toLocaleString()} 点を超えています。`,
    };
  }
  const frameCount = m.frameCount;
  if (typeof frameCount !== 'number' || !Number.isInteger(frameCount) || frameCount <= 0) {
    return { error: 'マニフェストの frameCount は 1 以上の整数が必要です。' };
  }
  if (frameCount > POINT_CACHE_MAX_FRAMES) {
    return {
      error: `上限超過のため読み込めません: フレーム数 ${frameCount} が上限 ${POINT_CACHE_MAX_FRAMES} フレームを超えています。`,
    };
  }
  const files = m.files;
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string' || f.length === 0)) {
    return { error: 'マニフェストの files はファイル名の配列が必要です。' };
  }
  if (files.length !== frameCount) {
    return {
      error: `マニフェストの files は ${files.length} 件で、frameCount ${frameCount} と一致しません。`,
    };
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
    if (!m.coordinates || typeof m.coordinates !== 'object') {
      return { error: 'マニフェストの coordinates が不正です。' };
    }
    const c = m.coordinates as Record<string, unknown>;
    const up = c.up === undefined ? 'y' : c.up;
    const unit = c.unit === undefined ? 'm' : c.unit;
    if (up !== 'y' && up !== 'z') return { error: 'マニフェストの coordinates.up は "y" か "z" が必要です。' };
    if (typeof unit !== 'string' || unit.length === 0) return { error: 'マニフェストの coordinates.unit が不正です。' };
    coordinates = { up, unit };
  }
  const attributes: PointCacheAttributeDecl[] = [];
  if (m.attributes !== undefined) {
    if (!Array.isArray(m.attributes)) return { error: 'マニフェストの attributes は配列が必要です。' };
    const seen = new Set<string>();
    for (const entry of m.attributes) {
      if (!entry || typeof entry !== 'object') return { error: 'マニフェストの attributes の要素が不正です。' };
      const a = entry as Record<string, unknown>;
      const name = a.name;
      if (typeof name !== 'string' || name.length === 0) return { error: 'マニフェストの attributes の name が不正です。' };
      const lowered = name.trim().toLowerCase();
      if (lowered === 'x' || lowered === 'y' || lowered === 'z') {
        return { error: `属性名 "${name}" は位置の列と重なります。` };
      }
      if (seen.has(lowered)) return { error: `属性名 "${name}" が重複しています。` };
      seen.add(lowered);
      if (a.type !== 'float') return { error: `属性 "${name}" の type は "float" のみ対応しています。` };
      const perFrame = a.perFrame === undefined ? true : a.perFrame;
      if (typeof perFrame !== 'boolean') return { error: `属性 "${name}" の perFrame は真偽値が必要です。` };
      attributes.push({ name, type: 'float', perFrame });
    }
  }
  return {
    manifest: {
      format: POINT_CACHE_FORMAT,
      version: 2,
      fps,
      count,
      startFrame,
      frameCount,
      loop,
      interpolation,
      coordinates,
      attributes,
      files: files as string[],
    },
  };
}

/* ---------------- binary PLY frames ---------------- */

const PLATFORM_LITTLE_ENDIAN = new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

/**
 * Parse one binary little-endian PLY frame into raw positions
 * (count x 3). The header length is NOT guaranteed to be a
 * multiple of 4, so the body is copied into a fresh aligned
 * buffer before any Float32Array view is taken (the trap #4 db
 * and #11 白丸 both reproduced independently).
 */
export function parseBinaryPlyFrame(
  buffer: ArrayBuffer,
  manifest: PointCacheManifest,
  fileName: string,
): { positions: Float32Array } | { error: string } {
  const bytes = new Uint8Array(buffer);
  // The header is ASCII and ends with an "end_header" line.
  let headerEnd = -1;
  const marker = 'end_header';
  outer: for (let i = 0; i + marker.length <= Math.min(bytes.length, 65536); i++) {
    if (bytes[i] === 0x65 /* e */) {
      for (let j = 0; j < marker.length; j++) {
        if (bytes[i + j] !== marker.charCodeAt(j)) continue outer;
      }
      // Skip to the end of that line.
      let k = i + marker.length;
      while (k < bytes.length && bytes[k] !== 0x0a) k++;
      headerEnd = k + 1;
      break;
    }
  }
  if (headerEnd < 0) return { error: `${fileName}: PLY ヘッダ（end_header）が見つかりません。` };
  let header = '';
  for (let i = 0; i < headerEnd; i++) header += String.fromCharCode(bytes[i]);
  const lines = header.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines[0] !== 'ply') return { error: `${fileName}: PLY ファイルではありません。` };
  const formatLine = lines.find((l) => l.startsWith('format '));
  if (formatLine !== 'format binary_little_endian 1.0') {
    return { error: `${fileName}: format は binary_little_endian 1.0 のみ対応しています（"${formatLine ?? 'なし'}"）。` };
  }
  // Walk the elements: v2 frames carry a single vertex element.
  let vertexCount = -1;
  const vertexProps: string[] = [];
  let currentElement: string | null = null;
  for (const line of lines) {
    if (line.startsWith('element ')) {
      const parts = line.split(/\s+/);
      currentElement = parts[1] ?? '';
      if (currentElement !== 'vertex') {
        return { error: `${fileName}: element "${currentElement}" はポイントキャッシュ v2 の対象外です（vertex のみ）。` };
      }
      const n = Number(parts[2]);
      if (!Number.isInteger(n) || n < 0) return { error: `${fileName}: element vertex の個数が不正です。` };
      vertexCount = n;
    } else if (line.startsWith('property ')) {
      if (currentElement !== 'vertex') continue;
      const parts = line.split(/\s+/);
      if (parts[1] === 'list') {
        return { error: `${fileName}: property list はポイントキャッシュ v2 の対象外です。` };
      }
      vertexProps.push(`${parts[1]} ${parts[2]}`);
    }
  }
  if (vertexCount < 0) return { error: `${fileName}: element vertex がありません。` };
  if (vertexCount !== manifest.count) {
    return {
      error: `点数が一致しません: ${fileName} は ${vertexCount.toLocaleString()} 点で、マニフェストの ${manifest.count.toLocaleString()} 点と異なります。`,
    };
  }
  const expectedProps = ['float x', 'float y', 'float z', ...manifest.attributes.map((a) => `float ${a.name}`)];
  const propsMatch = vertexProps.length === expectedProps.length
    && vertexProps.every((p, i) => p === expectedProps[i]);
  if (!propsMatch) {
    return {
      error: `${fileName}: property の並びがマニフェストの宣言と一致しません（実際: ${vertexProps.join(', ') || 'なし'} / 宣言: ${expectedProps.join(', ')}）。`,
    };
  }
  const strideFloats = expectedProps.length;
  const bodyBytes = vertexCount * strideFloats * 4;
  if (bytes.length - headerEnd < bodyBytes) {
    return { error: `${fileName}: データ本体が不足しています（${vertexCount} 点分のバイト数がありません）。` };
  }
  // Copy the body into an aligned buffer first (header length is
  // arbitrary), then view it as floats.
  const aligned = new ArrayBuffer(bodyBytes);
  new Uint8Array(aligned).set(bytes.subarray(headerEnd, headerEnd + bodyBytes));
  const positions = new Float32Array(manifest.count * 3);
  if (PLATFORM_LITTLE_ENDIAN && strideFloats === 3) {
    positions.set(new Float32Array(aligned));
  } else {
    const view = new DataView(aligned);
    for (let i = 0; i < manifest.count; i++) {
      const base = i * strideFloats * 4;
      positions[i * 3] = view.getFloat32(base, true);
      positions[i * 3 + 1] = view.getFloat32(base + 4, true);
      positions[i * 3 + 2] = view.getFloat32(base + 8, true);
    }
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return { error: `${fileName}: 位置に有限でない値が含まれています。` };
    }
  }
  return { positions };
}

/* ---------------- assembly ---------------- */

export function buildPointCache(manifest: PointCacheManifest, frames: Float32Array[], bundled = false): PointCacheData {
  const first = frames[0];
  let minX = Infinity; let maxX = -Infinity;
  let minY = Infinity; let maxY = -Infinity;
  let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < first.length; i += 3) {
    const x = first[i]; const y = first[i + 1]; const z = first[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (let i = 0; i < first.length; i += 3) {
    const dx = first[i] - center[0];
    const dy = first[i + 1] - center[1];
    const dz = first[i + 2] - center[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) radius = d;
  }
  const scale = radius > 0 ? 1 / radius : 0;
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const v = frame[i + axis];
        if (v < mins[axis]) mins[axis] = v;
        if (v > maxs[axis]) maxs[axis] = v;
      }
    }
  }
  return { manifest, frames, center, scale, mins, maxs, bundled };
}

/**
 * Load a full cache from an in-memory file set (file name ->
 * bytes). The manifest file is the entry whose name ends in
 * ".json" (or `manifestName` when given). Every validation rule
 * from the v2 draft applies; the first failure rejects the whole
 * cache with its reason.
 */
export function loadPointCacheFromFiles(
  files: Map<string, ArrayBuffer>,
  manifestName?: string,
): PointCacheLoadResult {
  const names = [...files.keys()];
  const manifestFile = manifestName ?? names.find((n) => n.toLowerCase().endsWith('.json'));
  if (!manifestFile || !files.has(manifestFile)) {
    return fail('マニフェスト（.json）が選択に含まれていません。PLY ファイルと一緒に選んでください。');
  }
  const manifestText = new TextDecoder().decode(files.get(manifestFile)!);
  const parsed = parsePointCacheManifest(manifestText);
  if ('error' in parsed) return fail(parsed.error);
  const { manifest } = parsed;
  const byBaseName = new Map<string, ArrayBuffer>();
  for (const [name, data] of files) {
    const base = name.split(/[\\/]/).pop() ?? name;
    if (!byBaseName.has(base)) byBaseName.set(base, data);
  }
  const frames: Float32Array[] = [];
  for (const entry of manifest.files) {
    const base = entry.split(/[\\/]/).pop() ?? entry;
    const data = byBaseName.get(base);
    if (!data) {
      return fail(`ファイルが不足しています: ${entry}（最初に欠けたファイル）が選択に含まれていません。欠番を飛ばしての再生はしません。`);
    }
    const frame = parseBinaryPlyFrame(data, manifest, entry);
    if ('error' in frame) return fail(frame.error);
    frames.push(frame.positions);
  }
  return { ok: true, cache: buildPointCache(manifest, frames) };
}

/* ---------------- pure time -> frame mapping ---------------- */

/**
 * The fractional frame position for a clock time. Pure: the same
 * (cache, time, loop) always yields the same value. With loop the
 * position wraps into [0, frameCount); without, it clamps to the
 * last frame.
 */
export function pointCacheFrameFloat(cache: PointCacheData, timeSeconds: number, loop: boolean): number {
  const { frameCount, fps } = cache.manifest;
  if (frameCount <= 1) return 0;
  const raw = Math.max(0, timeSeconds) * fps;
  if (loop) {
    const wrapped = raw % frameCount;
    return wrapped < 0 ? wrapped + frameCount : wrapped;
  }
  return Math.min(raw, frameCount - 1);
}

/**
 * Build the attribute point cloud for one clock time. Positions
 * are interpolated between the bracketing frames (or snapped for
 * 'nearest'); unit positions use the frame-0 convention; the
 * normalised columns use the all-frames ranges. The synthetic
 * table carries exactly the x / y / z columns — phase 1 holds
 * positions only.
 */
export function buildPointCacheCloud(cache: PointCacheData, timeSeconds: number, loop: boolean): AttrPointCloud {
  const { count, frameCount, interpolation } = cache.manifest;
  const frameFloat = pointCacheFrameFloat(cache, timeSeconds, loop);
  let i0 = Math.floor(frameFloat);
  let frac = frameFloat - i0;
  if (interpolation === 'nearest') {
    i0 = Math.round(frameFloat);
    frac = 0;
    if (loop) i0 = ((i0 % frameCount) + frameCount) % frameCount;
    else i0 = Math.min(Math.max(i0, 0), frameCount - 1);
  }
  const i1 = loop ? (i0 + 1) % frameCount : Math.min(i0 + 1, frameCount - 1);
  const a = cache.frames[i0];
  const b = cache.frames[i1];
  const positions = new Float32Array(count * 3);
  if (frac === 0 || i0 === i1) {
    positions.set(a);
  } else {
    for (let i = 0; i < positions.length; i++) {
      positions[i] = a[i] + (b[i] - a[i]) * frac;
    }
  }
  const [cx, cy, cz] = cache.center;
  const scale = cache.scale;
  const unitPositions = new Float32Array(count * 3);
  for (let i = 0; i < positions.length; i += 3) {
    unitPositions[i] = (positions[i] - cx) * scale;
    unitPositions[i + 1] = (positions[i + 1] - cy) * scale;
    unitPositions[i + 2] = (positions[i + 2] - cz) * scale;
  }
  const normalized = new Float32Array(count * 3);
  for (let axis = 0; axis < 3; axis++) {
    const min = cache.mins[axis];
    const span = cache.maxs[axis] - min;
    for (let i = 0; i < count; i++) {
      const v = positions[i * 3 + axis];
      normalized[i * 3 + axis] = span > 0 ? Math.min(1, Math.max(0, (v - min) / span)) : 0.5;
    }
  }
  const rows: (number | null)[][] = new Array(count);
  for (let i = 0; i < count; i++) {
    rows[i] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  }
  const table: DataTable = {
    columns: ['x', 'y', 'z'],
    rows,
    mins: [...cache.mins],
    maxs: [...cache.maxs],
  };
  return {
    table,
    xCol: 0,
    yCol: 1,
    zCol: 2,
    positions,
    normalized,
    unitPositions,
    version: 0,
  };
}

/* ---------------- bundled sample ---------------- */

export const BUNDLED_SAMPLE_POINTS = 512;
export const BUNDLED_SAMPLE_FRAMES = 48;
export const BUNDLED_SAMPLE_FPS = 24;

/**
 * The bundled sample cache: 512 points, one loop of 48 frames at
 * 24 fps. A dense blob (384 points) whose centre makes exactly
 * one revolution over the loop, plus a static reference ring
 * (128 points). Fully deterministic; the integer revolution
 * makes the loop close exactly — frame 48 is frame 0. (An
 * earlier per-point-orbits design filled the same disc at every
 * frame, so the frame advance was invisible on screen; the
 * travelling blob makes it plain.)
 */
export function buildBundledSamplePointCache(): PointCacheData {
  const count = BUNDLED_SAMPLE_POINTS;
  const frameCount = BUNDLED_SAMPLE_FRAMES;
  const blobCount = 384;
  const blobOffset = new Float32Array(blobCount * 3);
  for (let i = 0; i < blobCount; i++) {
    const theta = i * 2.39996322972865332;
    const z = 2 * ((i * 0.7548776662466927) % 1) - 1;
    const radius = 0.2 * Math.cbrt((i * 0.6180339887498949) % 1);
    const xy = Math.sqrt(Math.max(0, 1 - z * z));
    blobOffset[i * 3] = radius * xy * Math.cos(theta);
    blobOffset[i * 3 + 1] = radius * z;
    blobOffset[i * 3 + 2] = radius * xy * Math.sin(theta);
  }
  const frames: Float32Array[] = [];
  for (let f = 0; f < frameCount; f++) {
    const positions = new Float32Array(count * 3);
    const ang = (f / frameCount) * Math.PI * 2;
    const cx = Math.cos(ang) * 0.5;
    const cy = 0.15 * Math.sin(ang * 2);
    const cz = Math.sin(ang) * 0.5;
    for (let i = 0; i < blobCount; i++) {
      positions[i * 3] = cx + blobOffset[i * 3];
      positions[i * 3 + 1] = cy + blobOffset[i * 3 + 1];
      positions[i * 3 + 2] = cz + blobOffset[i * 3 + 2];
    }
    for (let i = blobCount; i < count; i++) {
      const a = ((i - blobCount) / (count - blobCount)) * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * 0.85;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = Math.sin(a) * 0.85;
    }
    frames.push(positions);
  }
  const manifest: PointCacheManifest = {
    format: POINT_CACHE_FORMAT,
    version: 2,
    fps: BUNDLED_SAMPLE_FPS,
    count,
    startFrame: 0,
    frameCount,
    loop: true,
    interpolation: 'linear',
    coordinates: { up: 'y', unit: 'm' },
    attributes: [],
    files: [],
  };
  return buildPointCache(manifest, frames, true);
}

/* ---------------- shared store (loaded cache + status) ---------------- */

export type PointCacheStatus =
  | { kind: 'empty' }
  | { kind: 'ready'; sourceName: string; count: number; frameCount: number; fps: number; bundled: boolean }
  | { kind: 'error'; message: string };

let currentCache: PointCacheData | null = null;
let currentStatus: PointCacheStatus = { kind: 'empty' };
const cacheListeners = new Set<() => void>();

function emitCache(): void {
  cacheListeners.forEach((listener) => listener());
}

export function getPointCache(): PointCacheData | null {
  return currentCache;
}

export function getPointCacheStatus(): PointCacheStatus {
  return currentStatus;
}

export function setPointCache(cache: PointCacheData | null, sourceName = ''): void {
  currentCache = cache;
  if (!cache) {
    currentStatus = { kind: 'empty' };
  } else {
    currentStatus = {
      kind: 'ready',
      sourceName,
      count: cache.manifest.count,
      frameCount: cache.manifest.frameCount,
      fps: cache.manifest.fps,
      bundled: cache.bundled,
    };
  }
  emitCache();
}

/** Record a failed load. A previously loaded cache stays live. */
export function setPointCacheError(message: string): void {
  currentStatus = { kind: 'error', message };
  emitCache();
}

export function subscribePointCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

export function usePointCache(): PointCacheData | null {
  return React.useSyncExternalStore(subscribePointCache, getPointCache, getPointCache);
}

export function usePointCacheStatus(): PointCacheStatus {
  return React.useSyncExternalStore(subscribePointCache, getPointCacheStatus, getPointCacheStatus);
}

/* ---------------- playback state (driver -> UI) ---------------- */

export interface PointCachePlaybackState {
  frameFloat: number;
  running: boolean;
  suspended: boolean;
}

let playbackState: PointCachePlaybackState = { frameFloat: 0, running: false, suspended: false };
const playbackListeners = new Set<() => void>();

export function getPointCachePlaybackState(): PointCachePlaybackState {
  return playbackState;
}

export function setPointCachePlaybackState(next: PointCachePlaybackState): void {
  if (
    next.frameFloat === playbackState.frameFloat
    && next.running === playbackState.running
    && next.suspended === playbackState.suspended
  ) {
    return;
  }
  playbackState = next;
  playbackListeners.forEach((listener) => listener());
}

export function subscribePointCachePlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function usePointCachePlaybackState(): PointCachePlaybackState {
  return React.useSyncExternalStore(
    subscribePointCachePlayback,
    getPointCachePlaybackState,
    getPointCachePlaybackState,
  );
}
