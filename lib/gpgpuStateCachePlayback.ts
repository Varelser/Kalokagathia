import { buildGpgpuInitialDataFromStateFrame } from './gpgpuInitialData';
import { stateCacheAgeColumnIndexV2 } from './gpgpuInitialState';
import type { StateCacheDataV2 } from './gpgpuStateCacheV2';

/**
 * State-cache dedicated playback path (bake gate A-4
 * premise fix, 2026-11-28): present one frame of a held v2
 * state cache — positions AND posture — on the GPGPU
 * geometry draw, by building textures out of the cache
 * frame and handing them to the draw in place of the live
 * sim's outputs.
 *
 * Why this module exists: the pre-existing playback route
 * for a state cache is the point-cache conversion
 * (stateCacheV2ToPointCacheData → lib/pointCache.ts), which
 * by design drops the orientation channel
 * (droppedOrientation: true) — posture never reaches a
 * renderer there. The geometry draw's posture input
 * (uOrientTex) was fed only by the live Orient pass, so a
 * cached frame's posture could be stored, round-tripped
 * and re-seeded (A-1 / A-2), but never DISPLAYED. Gate
 * registration GATE_BAKE_V2_PREREG §A-4 assumed this
 * dedicated path existed; it did not (gate record
 * GATE_BAKE_V2_RECORD §11). This module is that path.
 *
 * Shape of the wiring, mirroring the S0 capture wiring and
 * the S1 initial-state wiring:
 *
 * - A playback store (this module): the panel points it at
 *   a v2 cache (in practice the held v2 cache), names the
 *   frame to present, and starts / stops the presentation.
 *   One cache at a time; pointing it at a new cache stops
 *   any active presentation (a frame index into the old
 *   cache is never silently reinterpreted against the new
 *   one).
 * - A pure frame builder: one cache frame becomes the two
 *   texture-shaped arrays the draw consumes — positionData
 *   (count x 4, xyz + age in w, the bake's own layout via
 *   buildGpgpuInitialDataFromStateFrame) and
 *   orientationData (count x 4 quaternions, a verbatim
 *   detached copy of the frame's orientation channel).
 * - The scene side (components/sceneGpgpuSystem.tsx) polls
 *   resolveActiveStateCachePlaybackFrame() each frame;
 *   while a frame resolves, it uploads the two arrays to
 *   DataTextures and hands THOSE to syncVisualUniforms
 *   instead of the live outputs. The live sim — including
 *   the Orient pass — keeps running untouched underneath;
 *   only the two published textures are swapped, so
 *   stopping the presentation returns the draw to the live
 *   posture exactly as it evolved. Nothing else reads the
 *   store.
 *
 * Refusal discipline (the v2 initial-state driver's):
 * every refusal states its reason and nothing is padded,
 * decimated or fabricated:
 * - the cache must carry the orientation channel WITH
 *   data. A posture-less cache is refused, never played
 *   back without posture: position-only playback is the
 *   point-cache route's job, and silently dropping posture
 *   here would recreate the §11 premise failure.
 * - the cache must carry the 'age' attribute column (age
 *   is the position texture's w lane; the format keeps it
 *   only as that column).
 * - the frame index must be inside the cache.
 * - a target texSize, when given, must equal the cache's
 *   — a different pool size is refused, never resampled.
 *   The scene side ALSO refuses to engage a frame whose
 *   texSize differs from the live pool's, so a mismatch
 *   can never reach the draw.
 *
 * What is NOT fed by this path (named boundaries):
 * - The velocity texture stays the live sim's (the draw's
 *   velocity-driven colour / streak effects keep following
 *   the live state; the geometry posture — this path's
 *   subject — does not read velocity).
 * - Post effects that read the live position texture
 *   directly (the shine-density splat) keep their live
 *   source.
 * - The geometry shader's posture variant stands only
 *   while the config's Orient channel is enabled
 *   (orientChannelVariantOn) — the same condition as the
 *   live supply. With the channel off, the draw has no
 *   uOrientTex uniform and the supplied texture is simply
 *   not consumed; positions still present.
 *
 * Edition gate: presenting a held cache is not an export
 * / save, so stateCacheExportAllowed does not apply; the
 * caches that can be held at all are gated on the load
 * side exactly as for the initial-state store.
 */

export type StateCachePlaybackResult =
  | { ok: true; frameIndex: number; texSize: number }
  | { ok: false; error: string };

const fail = (error: string): StateCachePlaybackResult => ({ ok: false, error });

/* ---------------- frame builder (pure) ---------------- */

export interface StateCachePlaybackFrameData {
  texSize: number;
  count: number;
  frameIndex: number;
  /** count x 4: xyz + age in w — the position texture's
   *  shape, built by the bake's own texturization path. */
  positionData: Float32Array;
  /** count x 4: quaternions (x, y, z, w), a verbatim
   *  detached copy of the frame's orientation channel —
   *  the Orient target's shape, ready for a DataTexture. */
  orientationData: Float32Array;
}

/**
 * Build the two texture-shaped arrays for one v2 cache
 * frame. Refuses (with the reason) when the frame cannot
 * be presented honestly: out-of-range index, no age
 * column, no orientation channel, a declared channel with
 * missing data, or any buffer length that disagrees with
 * the manifest count.
 */

const failFrame = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function buildStateCachePlaybackFrameData(args: {
  cache: StateCacheDataV2;
  frameIndex: number;
}): { ok: true; frame: StateCachePlaybackFrameData } | { ok: false; error: string } {
  const { cache, frameIndex } = args;
  const { manifest } = cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return failFrame(`フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。`);
  }
  const ageIndex = stateCacheAgeColumnIndexV2(cache);
  if (ageIndex < 0) {
    return failFrame(
      'このキャッシュには年齢（age）属性が無いため、専用再生路では再生できません。年齢は位置テクスチャの w レーンであり、形式側では age 属性列としてのみ保持されます（無い状態を勝手に作ることはしません）。',
    );
  }
  // The orientation channel is whole or absent (the v2
  // format's own discipline), and this path exists FOR the
  // posture: absent — or declared but missing — refuses.
  if (!cache.orientations) {
    if (manifest.orientation) {
      return failFrame('マニフェストは姿勢チャンネルを宣言していますが、姿勢データがありません。姿勢なしで再生することはしません。');
    }
    return failFrame(
      'このキャッシュには姿勢チャンネルが無いため、専用再生路では再生できません（位置だけの再生は Point Cache 変換経由で行ってください。姿勢を黙って落として再生することはしません）。',
    );
  }
  const orientations = cache.orientations[frameIndex];
  if (!orientations) {
    return failFrame(`フレーム ${frameIndex} の姿勢データが姿勢チャンネルにありません。姿勢なしで再生することはしません。`);
  }
  const initialData = buildGpgpuInitialDataFromStateFrame({
    count: manifest.count,
    positions: cache.positions[frameIndex],
    velocities: cache.velocities[frameIndex],
    ages: cache.attrFrames[ageIndex][frameIndex],
    orientations,
  });
  if (!initialData || !initialData.orientData) {
    return failFrame(`フレーム ${frameIndex} のバッファ長が粒子数と一致しません。`);
  }
  return {
    ok: true,
    frame: {
      texSize: manifest.texSize,
      count: manifest.count,
      frameIndex,
      positionData: initialData.posData,
      orientationData: initialData.orientData,
    },
  };
}

/* ---------------- playback store ---------------- */

export interface StateCachePlaybackStore {
  cache: StateCacheDataV2;
  /** Display name of where the cache came from. */
  sourceName: string;
  /** The frame position to present. */
  frameIndex: number;
  active: boolean;
}

let store: StateCachePlaybackStore | null = null;

/**
 * Point the playback store at a cache (the panel calls
 * this whenever it holds a v2 cache). Any active
 * presentation stops and the frame position resets to 0:
 * a position named against the previous cache is never
 * reinterpreted against the new one.
 */
export function setStateCachePlaybackCache(cache: StateCacheDataV2, sourceName = ''): void {
  store = { cache, sourceName, frameIndex: 0, active: false };
}

export function clearStateCachePlaybackCache(): void {
  store = null;
}

export function getStateCachePlayback(): StateCachePlaybackStore | null {
  return store;
}

/** Name the frame position to present. Valid whether or
 *  not the presentation is active, so the position can be
 *  set before starting; the range is the only check (the
 *  channel / age checks run in the builder and at start). */
export function setStateCachePlaybackFrameIndex(frameIndex: number): StateCachePlaybackResult {
  if (!store) {
    return fail('専用再生路に使える状態キャッシュ（v2）が保持されていません。先に v2 形式の状態キャッシュを保持してください。');
  }
  const { manifest } = store.cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return fail(`フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。`);
  }
  store.frameIndex = frameIndex;
  return { ok: true, frameIndex, texSize: manifest.texSize };
}

/**
 * Start presenting the store's frame. Validates the whole
 * frame build (channel, age column, lengths) and, when
 * given, the target pool's texSize — a refusal leaves the
 * presentation stopped and the live draw untouched.
 */
export function startStateCachePlayback(args?: {
  frameIndex?: number;
  targetTexSize?: number;
}): StateCachePlaybackResult {
  if (!store) {
    return fail('専用再生路に使える状態キャッシュ（v2）が保持されていません。先に v2 形式の状態キャッシュを保持してください。');
  }
  if (args?.frameIndex !== undefined) {
    const named = setStateCachePlaybackFrameIndex(args.frameIndex);
    if (!named.ok) return named;
  }
  const { manifest } = store.cache;
  if (args?.targetTexSize !== undefined && args.targetTexSize !== manifest.texSize) {
    return fail(
      `キャッシュの粒子数（texSize ${manifest.texSize}＝${manifest.count.toLocaleString()} 点）が現在のプール（texSize ${args.targetTexSize}）と一致しないため、専用再生路では再生できません。粒子数のリサンプルはしません。`,
    );
  }
  const built = buildStateCachePlaybackFrameData({ cache: store.cache, frameIndex: store.frameIndex });
  if (!built.ok) return built;
  store.active = true;
  return { ok: true, frameIndex: store.frameIndex, texSize: manifest.texSize };
}

/** Stop presenting; the draw returns to the live sim. */
export function stopStateCachePlayback(): void {
  if (store) store.active = false;
}

/* ---------------- scene-side resolution ---------------- */

let resolvedCache: StateCacheDataV2 | null = null;
let resolvedFrameIndex = -1;
let resolvedFrame: StateCachePlaybackFrameData | null = null;

/**
 * The frame the draw should present right now, or null
 * while the presentation is stopped (or cannot be built —
 * a state start() already refused, so a null here after a
 * successful start means the store moved on). Memoized on
 * (cache, frameIndex): the returned object's identity is
 * stable across frames until the position or the cache
 * changes, which is what the scene side keys its texture
 * uploads on.
 */
export function resolveActiveStateCachePlaybackFrame(): StateCachePlaybackFrameData | null {
  if (!store || !store.active) {
    resolvedCache = null;
    resolvedFrameIndex = -1;
    resolvedFrame = null;
    return null;
  }
  if (resolvedFrame && resolvedCache === store.cache && resolvedFrameIndex === store.frameIndex) {
    return resolvedFrame;
  }
  const built = buildStateCachePlaybackFrameData({ cache: store.cache, frameIndex: store.frameIndex });
  if (!built.ok) {
    resolvedCache = null;
    resolvedFrameIndex = -1;
    resolvedFrame = null;
    return null;
  }
  resolvedCache = store.cache;
  resolvedFrameIndex = store.frameIndex;
  resolvedFrame = built.frame;
  return resolvedFrame;
}
