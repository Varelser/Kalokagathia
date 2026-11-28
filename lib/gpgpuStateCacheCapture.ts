import {
  renderDeterministicSequence,
  resolveWarmupFrames,
  MAX_DETERMINISTIC_FRAMES,
  type DeterministicRenderJob,
  type DeterministicRenderProgress,
} from './deterministicRender';
import {
  assembleStateCache,
  decodeStateCacheFrames,
  encodeStateCacheFrames,
  parseStateCacheManifest,
  serializeStateCacheManifest,
  stateCacheExportAllowed,
  STATE_CACHE_MAX_FRAMES,
  type StateCacheData,
  type StateCacheFrameInput,
  type StateCacheResult,
} from './gpgpuStateCache';

/**
 * Simulation state cache — the CAPTURE wiring (Grammar 2.0
 * stage 3, slice S0 wiring). lib/gpgpuStateCache.ts is the
 * format (assembly / validation / playback / conversion);
 * this module is everything that connects the format to the
 * live app:
 *
 * - A frame-provider registry. The GPGPU system
 *   (components/sceneGpgpuSystem.tsx) registers a provider
 *   that snapshots the CURRENT frame through the existing
 *   readback plumbing — the same readRenderTargetPixels
 *   positions + readbackParticleVelocities pair the ?diag=1
 *   hook's captureParticlesRaw uses. No new readback route
 *   is created (STAGE3_DESIGN 判断2). Under the WebGPU
 *   backend this is the WebGL-shaped readback, whose
 *   equivalence is the unconfirmed item carried since
 *   stage 2 — the provider does not claim otherwise.
 * - A capture session: the pure collector that validates
 *   each snapshot (consistent texSize, full count x 4
 *   buffers, declared attributes present) and hands the
 *   finished frame list to assembleStateCache. The 'age'
 *   attribute, when declared, is derived from the position
 *   buffer's w lane — the same lane the PLY export reads
 *   as age (lib/pointCloudExport.ts).
 * - The capture job driver: a deterministic render job
 *   (fixed timestep, scene remount, clock reset — the
 *   DeterministicRenderManager's envelope) whose per-step
 *   hook (DeterministicRenderJob.onSimFrame) pulls one
 *   provider snapshot per captured frame. The PNG sequence
 *   the manager also produces is discarded part by part
 *   through onPart; it is the price of reusing the stepped
 *   render, and the UI says so.
 * - The file pair: manifest JSON + one binary blob, named
 *   after this module's constants, loadable through
 *   loadStateCacheFromFiles with the format's refusal
 *   discipline (nothing is filled in or decimated).
 * - The edition gate, in ONE place (杉 decision,
 *   STAGE3_DESIGN §4.5-3): the panel's isPublicLibrary flag
 *   (LIBRARY_SCOPE, lib/appStateLibrary.ts) maps to the
 *   edition string stateCacheExportAllowed consumes, and
 *   the capture driver refuses up front when the edition
 *   disallows export. Loading / playback are not gated
 *   here — they follow the point-cache section's existing
 *   public-build convention in the panel.
 */

/* ---------------- frame provider registry ---------------- */

export interface StateCacheFrameSnapshot {
  texSize: number;
  /** count x 4 readback buffer (xyz + age in w). */
  positions: Float32Array;
  /** count x 4 readback buffer (xyz + phase in w). */
  velocities: Float32Array;
  attributes?: Record<string, Float32Array>;
}

export type StateCacheFrameProvider = () =>
  | StateCacheFrameSnapshot
  | { error: string }
  | null;

let provider: StateCacheFrameProvider | null = null;

/** Register the live system's frame provider (mirrors
 *  registerDeterministicRenderHandler). Returns an
 *  unregister function. */
export function registerStateCacheFrameProvider(
  next: StateCacheFrameProvider,
): () => void {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}

export function getStateCacheFrameProvider(): StateCacheFrameProvider | null {
  return provider;
}

/* ---------------- edition gate (single place) ---------------- */

/** Map the panel's public-library flag onto the edition
 *  vocabulary of stateCacheExportAllowed. */
export function stateCacheEditionForPublicLibrary(isPublicLibrary: boolean): string {
  return isPublicLibrary ? 'public' : 'full';
}

/* ---------------- capture plan ---------------- */

export interface StateCacheCapturePlan {
  fps: number;
  frames: number;
  warmupFrames: number;
}

export type StateCacheCapturePlanResult =
  | { ok: true; plan: StateCacheCapturePlan }
  | { ok: false; error: string };

/** Validate a capture request before any job starts. The
 *  frame cap is the tighter of the format cap and the
 *  deterministic renderer's own cap (both 3,600 today). */
export function planStateCacheCapture(args: {
  fps: number;
  frames: number;
  warmupFrames?: number;
}): StateCacheCapturePlanResult {
  const { fps, frames } = args;
  if (!Number.isFinite(fps) || fps <= 0) {
    return { ok: false, error: '撮影の fps は 0 より大きい数値が必要です。' };
  }
  if (!Number.isInteger(frames) || frames < 1) {
    return { ok: false, error: '撮影のフレーム数は 1 以上の整数が必要です。' };
  }
  const cap = Math.min(STATE_CACHE_MAX_FRAMES, MAX_DETERMINISTIC_FRAMES);
  if (frames > cap) {
    return { ok: false, error: `上限超過のため撮影できません: フレーム数 ${frames} が上限 ${cap} フレームを超えています。` };
  }
  if (args.warmupFrames !== undefined && !Number.isFinite(args.warmupFrames)) {
    return { ok: false, error: 'ウォームアップのフレーム数が不正です。' };
  }
  return {
    ok: true,
    plan: { fps, frames, warmupFrames: resolveWarmupFrames({ fps, frames, warmupFrames: args.warmupFrames }) },
  };
}

/* ---------------- capture session (pure collector) ---------------- */

export interface StateCacheCaptureSession {
  fps: number;
  attributeNames: string[];
  loop: boolean;
  interpolation: 'linear' | 'nearest';
  /** texSize of the first pushed frame; 0 until then. */
  texSize: number;
  frames: StateCacheFrameInput[];
}

export function createStateCacheCaptureSession(args: {
  fps: number;
  attributeNames?: string[];
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
}): StateCacheCaptureSession {
  return {
    fps: args.fps,
    // The position readback's w lane is the particle age
    // (the PLY export's convention), so 'age' is the one
    // attribute every capture can always supply.
    attributeNames: args.attributeNames ?? ['age'],
    loop: args.loop ?? true,
    interpolation: args.interpolation ?? 'linear',
    texSize: 0,
    frames: [],
  };
}

export function pushStateCacheCaptureFrame(
  session: StateCacheCaptureSession,
  snapshot: StateCacheFrameSnapshot,
): { ok: true } | { ok: false; error: string } {
  const frameIndex = session.frames.length;
  if (session.frames.length >= STATE_CACHE_MAX_FRAMES) {
    return { ok: false, error: `上限超過のため撮影を続けられません: フレーム数 ${session.frames.length + 1} が上限 ${STATE_CACHE_MAX_FRAMES} フレームを超えています。` };
  }
  if (!Number.isInteger(snapshot.texSize) || snapshot.texSize <= 0) {
    return { ok: false, error: `フレーム ${frameIndex} の texSize が不正です。` };
  }
  if (session.texSize === 0) {
    session.texSize = snapshot.texSize;
  } else if (snapshot.texSize !== session.texSize) {
    return { ok: false, error: `フレーム ${frameIndex} の texSize (${snapshot.texSize}) が撮影開始時 (${session.texSize}) と変わっています。` };
  }
  const count = session.texSize * session.texSize;
  if (snapshot.positions.length !== count * 4 || snapshot.velocities.length !== count * 4) {
    return { ok: false, error: `フレーム ${frameIndex} の読み戻しバッファ長が粒子数と一致しません（位置 ${snapshot.positions.length}／速度 ${snapshot.velocities.length}、期待 ${count * 4}）。` };
  }
  const attributes: Record<string, Float32Array> = {};
  for (const name of session.attributeNames) {
    const supplied = snapshot.attributes?.[name];
    if (supplied) {
      if (supplied.length !== count) {
        return { ok: false, error: `フレーム ${frameIndex} の属性 "${name}" の長さが粒子数と一致しません。` };
      }
      attributes[name] = new Float32Array(supplied);
    } else if (name === 'age') {
      // Derived from the position buffer's w lane — the
      // same lane buildPlyPointCloud exports as age.
      const age = new Float32Array(count);
      for (let i = 0; i < count; i++) age[i] = snapshot.positions[i * 4 + 3];
      attributes[name] = age;
    } else {
      return { ok: false, error: `フレーム ${frameIndex} に属性 "${name}" がありません。` };
    }
  }
  session.frames.push({
    positions: new Float32Array(snapshot.positions),
    velocities: new Float32Array(snapshot.velocities),
    attributes,
  });
  return { ok: true };
}

export function finishStateCacheCapture(session: StateCacheCaptureSession): StateCacheResult {
  if (session.frames.length === 0 || session.texSize === 0) {
    return { ok: false, error: 'キャッシュするフレームがありません。' };
  }
  return assembleStateCache({
    fps: session.fps,
    texSize: session.texSize,
    frames: session.frames,
    attributeNames: session.attributeNames,
    loop: session.loop,
    interpolation: session.interpolation,
  });
}

/* ---------------- capture job driver ---------------- */

export interface StateCacheCaptureJobArgs {
  fps: number;
  frames: number;
  warmupFrames?: number;
  /** Edition string for the export gate; omit = full. */
  edition?: string;
  attributeNames?: string[];
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
}

export interface StateCacheCaptureDeps {
  runSequence?: typeof renderDeterministicSequence;
  getProvider?: () => StateCacheFrameProvider | null;
}

/**
 * Run one capture: a deterministic render job whose
 * per-step hook snapshots the sim state once per captured
 * frame. Refusals (bad plan, public edition, no provider,
 * a provider error mid-job, a short take) all return
 * { ok: false, error } with the reason — the job never
 * silently delivers a partial cache.
 */
export async function runStateCacheCaptureJob(
  args: StateCacheCaptureJobArgs,
  onProgress?: DeterministicRenderProgress,
  deps?: StateCacheCaptureDeps,
): Promise<StateCacheResult> {
  if (!stateCacheExportAllowed(args.edition)) {
    return { ok: false, error: '公開版では状態キャッシュの撮影・保存はできません（完全版の機能です）。' };
  }
  const planned = planStateCacheCapture(args);
  if (!planned.ok) return { ok: false, error: planned.error };
  const { plan } = planned;
  const getProvider = deps?.getProvider ?? getStateCacheFrameProvider;
  // Existence is checked up front, but the provider itself
  // is NOT captured here: the deterministic job remounts
  // the scene, and the remounted system registers a NEW
  // provider (sceneGpgpuSystem's effect). A provider
  // captured at job start keeps reading the pre-remount
  // system's render targets, which never advance — every
  // captured frame would be the frozen last live frame
  // (stage 5 gate M1 finding). onSimFrame therefore
  // resolves the CURRENT provider per frame below.
  if (!getProvider()) {
    return { ok: false, error: 'GPGPU 粒子の読み戻しチャネルが接続されていません。GPGPU 系の表示が有効な状態でお試しください。' };
  }
  const session = createStateCacheCaptureSession({
    fps: plan.fps,
    attributeNames: args.attributeNames,
    loop: args.loop,
    interpolation: args.interpolation,
  });
  const job: DeterministicRenderJob = {
    fps: plan.fps,
    frames: plan.frames,
    warmupFrames: plan.warmupFrames,
    onSimFrame: async ({ index }) => {
      const currentProvider = getProvider();
      if (!currentProvider) {
        throw new Error(`フレーム ${index} で読み戻しチャネルが接続されていませんでした。`);
      }
      const snapshot = currentProvider();
      if (!snapshot) {
        throw new Error(`フレーム ${index} で読み戻しチャネルが応答しませんでした。`);
      }
      if ('error' in snapshot) {
        throw new Error(`フレーム ${index} の読み戻しに失敗しました (${snapshot.error})。`);
      }
      const pushed = pushStateCacheCaptureFrame(session, snapshot);
      if (!pushed.ok) throw new Error(pushed.error);
    },
  };
  const runSequence = deps?.runSequence ?? renderDeterministicSequence;
  try {
    // The PNG parts the stepped render produces are not
    // the product here; onPart discards each as it lands
    // so a long take stays at one part of memory.
    await runSequence(job, onProgress ?? (() => {}), () => {});
  } catch (error) {
    return { ok: false, error: `撮影に失敗しました: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (session.frames.length !== plan.frames) {
    return { ok: false, error: `撮影フレーム数が一致しません（${session.frames.length} フレーム、期待 ${plan.frames} フレーム）。` };
  }
  return finishStateCacheCapture(session);
}

/* ---------------- file pair (save / load) ---------------- */

export const STATE_CACHE_MANIFEST_FILENAME = 'monosphere-state-cache.json';
export const STATE_CACHE_FRAMES_FILENAME = 'monosphere-state-cache.bin';

export interface StateCacheFiles {
  manifestFileName: string;
  manifestText: string;
  framesFileName: string;
  framesBuffer: ArrayBuffer;
}

export function buildStateCacheFiles(cache: StateCacheData): StateCacheFiles {
  return {
    manifestFileName: STATE_CACHE_MANIFEST_FILENAME,
    manifestText: serializeStateCacheManifest(cache),
    framesFileName: STATE_CACHE_FRAMES_FILENAME,
    framesBuffer: encodeStateCacheFrames(cache),
  };
}

/**
 * Load a state cache from an in-memory file set (file name
 * -> bytes), mirroring loadPointCacheFromFiles: the .json
 * entry is the manifest; the frame binary is the single
 * remaining entry, or — when extra files ride along — the
 * one carrying this module's canonical frames name. Two
 * unnamed candidates are ambiguous and refused. Every
 * failure rejects the whole cache with its reason.
 */
export function loadStateCacheFromFiles(files: Map<string, ArrayBuffer>): StateCacheResult {
  const names = [...files.keys()];
  const manifestFile = names.find((n) => n.toLowerCase().endsWith('.json'));
  if (!manifestFile) {
    return { ok: false, error: 'マニフェスト（.json）が選択に含まれていません。バイナリ（.bin）と一緒に選んでください。' };
  }
  const parsed = parseStateCacheManifest(new TextDecoder().decode(files.get(manifestFile)!));
  if ('error' in parsed) return { ok: false, error: parsed.error };
  const others = names.filter((n) => n !== manifestFile);
  if (others.length === 0) {
    return { ok: false, error: 'フレームデータ（.bin）が選択に含まれていません。マニフェストと一緒に選んでください。' };
  }
  let framesFile: string | undefined;
  if (others.length === 1) {
    framesFile = others[0];
  } else {
    framesFile = others.find(
      (n) => (n.split(/[\\/]/).pop() ?? n) === STATE_CACHE_FRAMES_FILENAME,
    );
    if (!framesFile) {
      return { ok: false, error: 'フレームデータ（.bin）の候補が複数あり、どれか特定できません。マニフェストと .bin の2ファイルだけを選んでください。' };
    }
  }
  return decodeStateCacheFrames(parsed.manifest, files.get(framesFile)!);
}
