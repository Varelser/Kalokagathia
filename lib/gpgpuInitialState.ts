import {
  buildGpgpuInitialDataFromStateFrame,
  type GpgpuInitialData,
} from './gpgpuInitialData';
import type { StateCacheData } from './gpgpuStateCache';
import type { StateCacheDataV2 } from './gpgpuStateCacheV2';

/**
 * Initial State (Grammar 2.0 stage 3, slice S1): put one
 * frame of a state cache (lib/gpgpuStateCache.ts) back into
 * the live sim as its initial state, so a solved state can
 * be resumed and re-solved from that frame. Design:
 * kalokagathia-pro/STAGE3_DESIGN.md §2 S1.
 *
 * Shape of the wiring, mirroring the S0 capture wiring
 * (lib/gpgpuStateCacheCapture.ts):
 *
 * - A held-cache store: the panel keeps the cache it just
 *   captured or loaded HERE (as StateCacheData, not only as
 *   the point-cache conversion the playback path consumes),
 *   so a frame of it can be applied without re-reading the
 *   files. One cache at a time; holding a new one replaces
 *   the old.
 * - An applier registry: the GPGPU runtime
 *   (components/useGpgpuRuntime.ts) registers the one live
 *   applier, which writes the restored arrays into the
 *   pool's ping-pong targets through the bake's own
 *   DataTexture copy path. This module never touches WebGL.
 * - The driver below: frame selection + validation +
 *   conversion (buildGpgpuInitialDataFromStateFrame, the
 *   gpgpuInitialData texturization path's S1 extension) +
 *   the applier call. Every refusal states its reason and
 *   nothing is padded, decimated or fabricated:
 *   - the frame index must be inside the cache;
 *   - the cache's texSize must equal the live pool's —
 *     a different pool size is refused, never resampled;
 *   - the cache must carry the 'age' attribute column.
 *     Age IS the position texture's w lane in the sim;
 *     the state-cache format stores positions as triplets
 *     and keeps age only as that column, so a cache
 *     without it cannot restore a state honestly.
 *
 * Bake A-2 premise fixes (2026-11-28):
 * - Carry-over into deterministic capture jobs: a
 *   successful apply is RECORDED here (see
 *   getLastAppliedInitialState below), and the state-cache
 *   capture driver re-applies the record through the
 *   CURRENT applier after the job's scene remount
 *   (DeterministicRenderJob.onSceneReady). Before this, the
 *   deterministic job remounted the scene — new runtime,
 *   pool re-baked from the config seed — and the state
 *   applied to the pre-job live sim was simply gone, so a
 *   "resume" capture photographed a fresh run (gate record
 *   GATE_BAKE_V2_RECORD §7). The record is replaced by each
 *   successful apply and survives until then; a job whose
 *   re-apply fails refuses the whole capture with the
 *   reason instead of silently photographing the wrong
 *   take. Generic deterministic jobs (PNG / video export)
 *   never see the record — their envelope stays
 *   fresh-from-config.
 * - Posture: the v2 driver below
 *   (applyStateCacheFrameV2AsInitialState) feeds a v2
 *   frame's orientation channel into the initial data's
 *   orientData lane, and the live applier seeds the Orient
 *   pass from it (directly while the pass stands, or as a
 *   pending seed the pass consumes on its first run after
 *   construction — the job-remount case). An apply whose
 *   posture cannot be placed (Orient channel off, pool
 *   size mismatch) is refused by the applier with the
 *   reason; posture is never dropped silently.
 *
 * What is restored: positions, velocities and age (via
 * the 'age' column) — plus, through the v2 driver, the
 * accumulated posture. What is NOT, and why:
 * - The Kuramoto phase (velocity w lane): the format
 *   stores velocities as triplets, so the phase is not in
 *   the cache; the restored lane is 0, the bake's own seed
 *   value (see buildGpgpuInitialDataFromStateFrame).
 * - Stage-1 state channels beyond age: the condition
 *   variables (speed, collision, previous-frame bits) are
 *   derived in-shader each frame from pos/vel and the
 *   previous-position texture, which the applier seeds
 *   with the restored positions exactly like the bake —
 *   there is no persistent state-ID texture in the
 *   initialisation path to restore into.
 * - Sibling pools (aux / vellum state / grains): the
 *   state cache never contained them (the S0 provider
 *   reads the main pool only), so there is nothing to
 *   restore them from.
 *
 * Edition gate: applying an initial state is not an
 * export / save, so stateCacheExportAllowed does not
 * apply; the load side keeps the S0 convention (the panel
 * disables cache loading in the public library build,
 * which is also what feeds this store).
 */

export type InitialStateResult =
  | { ok: true; frameIndex: number; texSize: number }
  | { ok: false; error: string };

const fail = (error: string): InitialStateResult => ({ ok: false, error });

/* ---------------- held cache store ---------------- */

export interface HeldStateCache {
  cache: StateCacheData;
  /** Display name of where the cache came from. */
  sourceName: string;
}

let held: HeldStateCache | null = null;

/** Hold a captured / loaded cache for initial-state use. */
export function setHeldStateCache(cache: StateCacheData, sourceName = ''): void {
  held = { cache, sourceName };
}

export function getHeldStateCache(): HeldStateCache | null {
  return held;
}

export function clearHeldStateCache(): void {
  held = null;
}

/* ---------------- applier registry ---------------- */

export interface StateCacheInitialStateRequest {
  texSize: number;
  frameIndex: number;
  /** Bake-shaped arrays (count x 4), ready for the
   *  DataTexture copy path. */
  initialData: GpgpuInitialData;
}

export type StateCacheInitialStateApplier = (
  request: StateCacheInitialStateRequest,
) => { ok: true } | { ok: false; error: string };

let applier: StateCacheInitialStateApplier | null = null;

/** Register the live runtime's applier (mirrors
 *  registerStateCacheFrameProvider). Returns an unregister
 *  function. */
export function registerStateCacheInitialStateApplier(
  next: StateCacheInitialStateApplier,
): () => void {
  applier = next;
  return () => {
    if (applier === next) applier = null;
  };
}

export function getStateCacheInitialStateApplier(): StateCacheInitialStateApplier | null {
  return applier;
}

/* ---------------- applied-state record (job carry-over) ---------------- */

/**
 * The last initial state an apply SUCCESSFULLY wrote into
 * a live sim, kept so a deterministic capture job — which
 * remounts the scene and re-bakes the pool from the config
 * seed — can re-apply the same state into its fresh mount
 * (bake A-2 premise 1). Replaced by every successful apply
 * (v1 or v2 driver); never set by a refused one.
 */
export interface AppliedInitialState {
  texSize: number;
  frameIndex: number;
  initialData: GpgpuInitialData;
}

let lastApplied: AppliedInitialState | null = null;

export function getLastAppliedInitialState(): AppliedInitialState | null {
  return lastApplied;
}

export function clearLastAppliedInitialState(): void {
  lastApplied = null;
}

/**
 * Re-apply the recorded state through the CURRENT applier
 * (the one the remounted runtime registered — resolved by
 * the caller at job time, never captured earlier, the same
 * discipline as the S0 frame provider). Refuses with the
 * reason when nothing is recorded or no applier is
 * connected; the applier's own refusals pass through.
 */
export function reapplyLastAppliedInitialState(
  activeApplier?: StateCacheInitialStateApplier | null,
): InitialStateResult {
  if (!lastApplied) {
    return fail('引き継ぐ適用済み初期状態が記録されていません。');
  }
  const target = activeApplier !== undefined ? activeApplier : getStateCacheInitialStateApplier();
  if (!target) {
    return fail('GPGPU 粒子の初期化チャネルが接続されていません。GPGPU 系の表示が有効な状態でお試しください。');
  }
  const applied = target({
    texSize: lastApplied.texSize,
    frameIndex: lastApplied.frameIndex,
    initialData: lastApplied.initialData,
  });
  if (!applied.ok) return { ok: false, error: applied.error };
  return { ok: true, frameIndex: lastApplied.frameIndex, texSize: lastApplied.texSize };
}

/* ---------------- driver ---------------- */

/** The index of the cache's age column, or -1. The capture
 *  writes 'age' verbatim; a case-insensitive match is
 *  accepted for hand-built manifests. */
export function stateCacheAgeColumnIndex(cache: StateCacheData): number {
  const attrs = cache.manifest.attributes;
  const exact = attrs.indexOf('age');
  if (exact >= 0) return exact;
  return attrs.findIndex((name) => name.trim().toLowerCase() === 'age');
}

/**
 * Apply one cache frame as the sim's initial state.
 * targetTexSize, when given, is the caller's pool size and
 * is checked here; the live applier ALSO checks against
 * the pool it actually writes to, so a mismatch is refused
 * either way — never resampled.
 */
export function applyStateCacheFrameAsInitialState(args: {
  cache: StateCacheData;
  frameIndex: number;
  targetTexSize?: number;
  applier?: StateCacheInitialStateApplier | null;
}): InitialStateResult {
  const { cache, frameIndex } = args;
  const { manifest } = cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return fail(`フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。`);
  }
  if (args.targetTexSize !== undefined && args.targetTexSize !== manifest.texSize) {
    return fail(
      `キャッシュの粒子数（texSize ${manifest.texSize}＝${manifest.count.toLocaleString()} 点）が現在のプール（texSize ${args.targetTexSize}）と一致しないため、初期状態として適用できません。粒子数のリサンプルはしません。`,
    );
  }
  const ageIndex = stateCacheAgeColumnIndex(cache);
  if (ageIndex < 0) {
    return fail(
      'このキャッシュには年齢（age）属性が無いため、初期状態として適用できません。年齢は位置テクスチャの w レーンであり、形式側では age 属性列としてのみ保持されます（無い状態を勝手に作ることはしません）。',
    );
  }
  const initialData = buildGpgpuInitialDataFromStateFrame({
    count: manifest.count,
    positions: cache.positions[frameIndex],
    velocities: cache.velocities[frameIndex],
    ages: cache.attrFrames[ageIndex][frameIndex],
  });
  if (!initialData) {
    return fail(`フレーム ${frameIndex} のバッファ長が粒子数と一致しません。`);
  }
  const activeApplier = args.applier !== undefined ? args.applier : getStateCacheInitialStateApplier();
  if (!activeApplier) {
    return fail('GPGPU 粒子の初期化チャネルが接続されていません。GPGPU 系の表示が有効な状態でお試しください。');
  }
  const applied = activeApplier({ texSize: manifest.texSize, frameIndex, initialData });
  if (!applied.ok) return { ok: false, error: applied.error };
  lastApplied = { texSize: manifest.texSize, frameIndex, initialData };
  return { ok: true, frameIndex, texSize: manifest.texSize };
}

/** Apply a frame of the currently held cache (the panel's
 *  entry point). Refuses when nothing is held. */
export function applyHeldStateCacheFrameAsInitialState(args: {
  frameIndex: number;
  targetTexSize?: number;
  applier?: StateCacheInitialStateApplier | null;
}): InitialStateResult {
  const current = getHeldStateCache();
  if (!current) {
    return fail('初期状態に使える状態キャッシュが保持されていません。先に状態キャッシュを撮影するか、読み込んでください。');
  }
  return applyStateCacheFrameAsInitialState({
    cache: current.cache,
    frameIndex: args.frameIndex,
    targetTexSize: args.targetTexSize,
    applier: args.applier,
  });
}

/* ---------------- v2 driver (posture-carrying frames) ---------------- */

export interface HeldStateCacheV2 {
  cache: StateCacheDataV2;
  /** Display name of where the cache came from. */
  sourceName: string;
}

let heldV2: HeldStateCacheV2 | null = null;

/** Hold a v2 cache for initial-state use. The panel holds
 *  v2 takes / loads here — alongside the v1 store above,
 *  which the derived exporters keep consuming — so a
 *  posture-carrying cache can be held without a lossy
 *  conversion (panel v2 wiring). */
export function setHeldStateCacheV2(cache: StateCacheDataV2, sourceName = ''): void {
  heldV2 = { cache, sourceName };
}

export function getHeldStateCacheV2(): HeldStateCacheV2 | null {
  return heldV2;
}

export function clearHeldStateCacheV2(): void {
  heldV2 = null;
}

/** The index of the v2 cache's age attribute declaration,
 *  or -1 (same matching discipline as the v1 driver). */
export function stateCacheAgeColumnIndexV2(cache: StateCacheDataV2): number {
  const attrs = cache.manifest.attributes;
  const exact = attrs.findIndex((d) => d.name === 'age');
  if (exact >= 0) return exact;
  return attrs.findIndex((d) => d.name.trim().toLowerCase() === 'age');
}

/**
 * Apply one v2 cache frame as the sim's initial state —
 * the v1 driver's twin for the posture-carrying format
 * (bake A-2 premise 2). Positions / velocities / age
 * restore exactly as in v1; when the cache carries the
 * orientation channel, the frame's posture rides into the
 * initial data's orientData lane and the applier seeds the
 * Orient pass from it. A v2 cache WITHOUT the channel
 * applies exactly like a v1 frame (no posture exists to
 * restore, and none is invented). The refusal discipline
 * is the v1 driver's: frame range, pool texSize (never
 * resampled), the mandatory age column.
 */
export function applyStateCacheFrameV2AsInitialState(args: {
  cache: StateCacheDataV2;
  frameIndex: number;
  targetTexSize?: number;
  applier?: StateCacheInitialStateApplier | null;
}): InitialStateResult {
  const { cache, frameIndex } = args;
  const { manifest } = cache;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= manifest.frameCount) {
    return fail(`フレーム ${frameIndex} はキャッシュの範囲外です（0〜${manifest.frameCount - 1}）。`);
  }
  if (args.targetTexSize !== undefined && args.targetTexSize !== manifest.texSize) {
    return fail(
      `キャッシュの粒子数（texSize ${manifest.texSize}＝${manifest.count.toLocaleString()} 点）が現在のプール（texSize ${args.targetTexSize}）と一致しないため、初期状態として適用できません。粒子数のリサンプルはしません。`,
    );
  }
  const ageIndex = stateCacheAgeColumnIndexV2(cache);
  if (ageIndex < 0) {
    return fail(
      'このキャッシュには年齢（age）属性が無いため、初期状態として適用できません。年齢は位置テクスチャの w レーンであり、形式側では age 属性列としてのみ保持されます（無い状態を勝手に作ることはしません）。',
    );
  }
  // The orientation channel is whole or absent (the v2
  // format's own discipline): a manifest that declares it
  // but carries no data — or a frame missing from the
  // channel — refuses instead of applying without posture.
  let orientations: Float32Array | undefined;
  if (cache.orientations) {
    orientations = cache.orientations[frameIndex];
    if (!orientations) {
      return fail(`フレーム ${frameIndex} の姿勢データが姿勢チャンネルにありません。姿勢なしで適用することはしません。`);
    }
  } else if (manifest.orientation) {
    return fail('マニフェストは姿勢チャンネルを宣言していますが、姿勢データがありません。姿勢なしで適用することはしません。');
  }
  const initialData = buildGpgpuInitialDataFromStateFrame({
    count: manifest.count,
    positions: cache.positions[frameIndex],
    velocities: cache.velocities[frameIndex],
    ages: cache.attrFrames[ageIndex][frameIndex],
    orientations,
  });
  if (!initialData) {
    return fail(`フレーム ${frameIndex} のバッファ長が粒子数と一致しません。`);
  }
  const activeApplier = args.applier !== undefined ? args.applier : getStateCacheInitialStateApplier();
  if (!activeApplier) {
    return fail('GPGPU 粒子の初期化チャネルが接続されていません。GPGPU 系の表示が有効な状態でお試しください。');
  }
  const applied = activeApplier({ texSize: manifest.texSize, frameIndex, initialData });
  if (!applied.ok) return { ok: false, error: applied.error };
  lastApplied = { texSize: manifest.texSize, frameIndex, initialData };
  return { ok: true, frameIndex, texSize: manifest.texSize };
}

/** Apply a frame of the currently held v2 cache. Refuses
 *  when nothing is held. */
export function applyHeldStateCacheFrameV2AsInitialState(args: {
  frameIndex: number;
  targetTexSize?: number;
  applier?: StateCacheInitialStateApplier | null;
}): InitialStateResult {
  const current = getHeldStateCacheV2();
  if (!current) {
    return fail('初期状態に使える状態キャッシュ（v2）が保持されていません。先に v2 形式の状態キャッシュを保持してください。');
  }
  return applyStateCacheFrameV2AsInitialState({
    cache: current.cache,
    frameIndex: args.frameIndex,
    targetTexSize: args.targetTexSize,
    applier: args.applier,
  });
}
