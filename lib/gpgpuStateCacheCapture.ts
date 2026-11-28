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
import {
  assembleStateCacheV2,
  decodeStateCacheFramesV2,
  encodeStateCacheFramesV2,
  parseStateCacheManifestV2,
  serializeStateCacheManifestV2,
  STATE_CACHE_FORMAT_V2,
  STATE_CACHE_V1_FORMAT,
  type StateCacheAttributeDecl,
  type StateCacheDataV2,
  type StateCacheProvenance,
  type StateCacheResultV2,
} from './gpgpuStateCacheV2';
import {
  getLastAppliedInitialState,
  getStateCacheInitialStateApplier,
  reapplyLastAppliedInitialState,
} from './gpgpuInitialState';

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
 * - The v2 save wiring (bake layer v2): when the provider
 *   snapshots carry the Orient pass's accumulated posture
 *   (snapshot.orientations, read from the pass's published
 *   current target — the same target the diag hook's
 *   captureOrientStats reads), the session collects the
 *   channel whole and finishStateCacheCaptureV2 assembles
 *   the v2 format (lib/gpgpuStateCacheV2.ts) with declared
 *   attribute sources and provenance. The v1 path above is
 *   unchanged: a capture whose snapshots carry no posture
 *   assembles and saves exactly as before, and the panel
 *   chooses the v2 job only while the Orient channel is
 *   enabled in the config. A channel that appears or
 *   vanishes mid-capture is refused — the v2 format accepts
 *   an orientation channel only whole, and nothing is
 *   filled in here either.
 * - The v2 valid-count thinning (A-5 follow-up b): the job
 *   args may carry validCount — the scene's authored particle
 *   count (the panel passes min(gpgpuCount, texSize^2), the
 *   applyLodPolicy draw count) — which the session hands to
 *   the v2 assembly so the saved file stores only the valid
 *   leading particles per channel. The v1 finish ignores it:
 *   the v1 format has no thinning and its path is unchanged.
 * - The initial-state carry-over (bake A-2 premise fix):
 *   when an initial state was applied to the live sim
 *   before the job (lib/gpgpuInitialState.ts records it),
 *   the job re-applies it into its own fresh mount via the
 *   job's onSceneReady hook, so a resume capture starts
 *   from the applied state instead of the config-seed bake
 *   the remount produced. Without a record the job is the
 *   exact legacy take.
 * - The file pair: manifest JSON + one binary blob, named
 *   after this module's constants, loadable through
 *   loadStateCacheFromFiles with the format's refusal
 *   discipline (nothing is filled in or decimated). The
 *   v2 pair loads through loadStateCacheFromFilesV2; the
 *   panel dispatches on detectStateCacheFormat so each
 *   format reaches its own loader (the v1 loader still
 *   refuses a v2 pair itself — no forward compatibility
 *   inside either loader).
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
  /** count x 4 accumulated posture (quaternion x, y, z, w —
   *  the Orient render target's shape verbatim, the order
   *  the v2 format stores). Present only while the Orient
   *  channel stands; the v1 finish ignores it, the v2
   *  finish requires it on EVERY frame or on none. */
  orientations?: Float32Array;
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
  /** Per-frame posture buffers (count x 4), parallel to
   *  frames; filled only while orientationChannel is true. */
  orientations: Float32Array[];
  /** null until the first pushed frame decides the take's
   *  shape: true = every frame carries posture, false =
   *  none does. A change mid-capture is refused in push —
   *  the v2 format takes the channel whole or not at all. */
  orientationChannel: boolean | null;
  /** Valid-count thinning for the v2 finish (A-5 b): store
   *  only this many leading particles per channel. Undefined
   *  = store the whole pool. Validated by the v2 assembly
   *  against the take's texSize; the v1 finish ignores it. */
  validCount?: number;
}

export function createStateCacheCaptureSession(args: {
  fps: number;
  attributeNames?: string[];
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
  validCount?: number;
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
    orientations: [],
    orientationChannel: null,
    validCount: args.validCount,
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
  // Orientation channel (bake v2 wiring): the channel's
  // presence is fixed by the first frame of the take. A
  // posture buffer of the wrong length, a channel appearing
  // after an un-oriented start, or a channel vanishing
  // mid-take all refuse the frame with the reason — the
  // v2 assembly accepts posture only as a whole channel,
  // and a partial channel is never padded into one here.
  let orientation: Float32Array | null = null;
  if (snapshot.orientations !== undefined && snapshot.orientations !== null) {
    if (snapshot.orientations.length !== count * 4) {
      return { ok: false, error: `フレーム ${frameIndex} の姿勢バッファ長が粒子数と一致しません（${snapshot.orientations.length}、期待 ${count * 4}）。` };
    }
    if (session.orientationChannel === false) {
      return { ok: false, error: `フレーム ${frameIndex} で姿勢チャンネルが現れました（撮影開始時は無し）。チャンネルの有無は撮影を通して固定です。` };
    }
    session.orientationChannel = true;
    orientation = new Float32Array(snapshot.orientations);
  } else {
    if (session.orientationChannel === true) {
      return { ok: false, error: `フレーム ${frameIndex} で姿勢チャンネルが消えました。姿勢は全フレーム分が揃って初めてチャンネルとして保存できます（補完はしません）。` };
    }
    session.orientationChannel = false;
  }
  session.frames.push({
    positions: new Float32Array(snapshot.positions),
    velocities: new Float32Array(snapshot.velocities),
    attributes,
  });
  if (orientation) session.orientations.push(orientation);
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

/**
 * The v2 finish: assemble the SAME collected session as a
 * v2 cache (assembleStateCacheV2). Attribute declarations
 * are derived from the session's attribute names with their
 * capture-side origins: 'age' is the sim's age lane
 * ('sim-age', the v2 test vocabulary), any other declared
 * attribute is a column the provider read back from the
 * sim ('sim-attribute'). The posture channel is passed
 * only when the take carried it whole; a take without
 * posture assembles as a v2 file that declares no
 * orientation channel. Provenance is mandatory in v2, so
 * the caller supplies it (buildStateCacheCaptureProvenance
 * is the panel-side builder). The session's validCount (when
 * the job carried one) is handed to the assembly for the
 * A-5 thinning; the assembly validates it against the
 * take's pool size and refuses with the reason.
 */
export function finishStateCacheCaptureV2(
  session: StateCacheCaptureSession,
  provenance: StateCacheProvenance,
): StateCacheResultV2 {
  if (session.frames.length === 0 || session.texSize === 0) {
    return { ok: false, error: 'キャッシュするフレームがありません。' };
  }
  const attributeDecls: StateCacheAttributeDecl[] = session.attributeNames.map((name) => ({
    name,
    components: 1,
    source: name.trim().toLowerCase() === 'age' ? 'sim-age' : 'sim-attribute',
  }));
  return assembleStateCacheV2({
    fps: session.fps,
    texSize: session.texSize,
    frames: session.frames,
    attributeDecls,
    orientations: session.orientationChannel ? session.orientations : null,
    provenance,
    loop: session.loop,
    interpolation: session.interpolation,
    validCount: session.validCount,
  });
}

/* ---------------- provenance (v2 save) ---------------- */

/** JSON with recursively sorted object keys, so two equal
 *  settings snapshots hash identically regardless of key
 *  insertion order. Arrays keep their order (it is data). */
function stableStringifyForHash(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringifyForHash(v)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringifyForHash(v)}`).join(',')}}`;
}

function fnv1aHex(text: string): string {
  let h = 0x811c9dc5;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/**
 * Build the provenance a v2 capture is stamped with. The
 * settings hash is FNV-1a over the stable serialization
 * of the settings snapshot the panel hands in (its config
 * object at capture time): any settings change changes
 * the hash, which is exactly what the bake-job merge
 * compares across split parts. The seed is the scene seed
 * the same snapshot carries; the generator is this app.
 */
export function buildStateCacheCaptureProvenance(args: {
  settingsSnapshot: unknown;
  seed: number;
  generatorVersion: string;
}): StateCacheProvenance {
  return {
    settingsHash: fnv1aHex(stableStringifyForHash(args.settingsSnapshot)),
    seed: args.seed,
    generator: 'monosphere',
    generatorVersion: args.generatorVersion,
  };
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
  /** Valid-count thinning for the v2 driver (A-5 b): the
   *  scene's authored particle count, stored as the v2
   *  manifest's validCount. The v1 driver ignores it. */
  validCount?: number;
}

export interface StateCacheCaptureDeps {
  runSequence?: typeof renderDeterministicSequence;
  getProvider?: () => StateCacheFrameProvider | null;
}

type CaptureSessionRun =
  | { ok: true; session: StateCacheCaptureSession }
  | { ok: false; error: string };

/**
 * The shared take: a deterministic render job whose
 * per-step hook snapshots the sim state once per captured
 * frame into a session. Refusals (bad plan, public
 * edition, no provider, a provider error mid-job, a short
 * take) all return { ok: false, error } with the reason —
 * the job never silently delivers a partial cache. The
 * two public drivers below differ only in how the
 * finished session is assembled (v1 / v2).
 */
async function runCaptureSession(
  args: StateCacheCaptureJobArgs,
  onProgress?: DeterministicRenderProgress,
  deps?: StateCacheCaptureDeps,
): Promise<CaptureSessionRun> {
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
    validCount: args.validCount,
  });
  const job: DeterministicRenderJob = {
    fps: plan.fps,
    frames: plan.frames,
    warmupFrames: plan.warmupFrames,
    // Initial-state carry-over (bake A-2 premise fix): when
    // an initial state was applied to the live sim before
    // this job, the job's remount discards it (fresh runtime,
    // pool re-baked from the config seed). Re-apply the
    // recorded state into the fresh mount — through the
    // CURRENT applier, resolved here after the remount, the
    // same discipline as the per-frame provider below — so
    // the capture actually starts from the applied state.
    // A failed re-apply aborts the job with the reason
    // (runCaptureSession's catch turns it into the refusal);
    // the job never silently photographs a fresh run and
    // calls it a resume. No record = no hook effect at all.
    onSceneReady: async () => {
      if (!getLastAppliedInitialState()) return;
      const reapplied = reapplyLastAppliedInitialState(getStateCacheInitialStateApplier());
      if (!reapplied.ok) {
        throw new Error(`適用済み初期状態の撮影ジョブへの引き継ぎに失敗しました: ${reapplied.error}`);
      }
    },
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
  return { ok: true, session };
}

/** Run one capture and assemble it as a v1 cache — the
 *  original driver, behaviour unchanged (a posture channel
 *  in the snapshots is collected by the session but not
 *  part of the v1 format, exactly as before this wiring). */
export async function runStateCacheCaptureJob(
  args: StateCacheCaptureJobArgs,
  onProgress?: DeterministicRenderProgress,
  deps?: StateCacheCaptureDeps,
): Promise<StateCacheResult> {
  const run = await runCaptureSession(args, onProgress, deps);
  if (!run.ok) return run;
  return finishStateCacheCapture(run.session);
}

/** Run one capture and assemble it as a v2 cache
 *  (assembleStateCacheV2): posture channel when the take
 *  carried it whole, declared attribute sources, and the
 *  caller-supplied provenance the v2 format mandates. */
export async function runStateCacheCaptureJobV2(
  args: StateCacheCaptureJobArgs & { provenance: StateCacheProvenance },
  onProgress?: DeterministicRenderProgress,
  deps?: StateCacheCaptureDeps,
): Promise<StateCacheResultV2> {
  const run = await runCaptureSession(args, onProgress, deps);
  if (!run.ok) return run;
  return finishStateCacheCaptureV2(run.session, args.provenance);
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

/** The v2 file pair: same file names as v1 (the manifest's
 *  format field is what distinguishes them), serialized
 *  through the v2 writer. The v1 loader refuses a v2 pair
 *  with its format-mismatch reason — the format's designed
 *  no-forward-compatibility, unchanged by this wiring; the
 *  panel dispatches on detectStateCacheFormat below so a
 *  v2 pair reaches loadStateCacheFromFilesV2 instead. */
export function buildStateCacheFilesV2(cache: StateCacheDataV2): StateCacheFiles {
  return {
    manifestFileName: STATE_CACHE_MANIFEST_FILENAME,
    manifestText: serializeStateCacheManifestV2(cache),
    framesFileName: STATE_CACHE_FRAMES_FILENAME,
    framesBuffer: encodeStateCacheFramesV2(cache),
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

/* ---------------- v2 load (panel v2 wiring) ---------------- */

/**
 * Which format a file set carries, read from the manifest's
 * format field alone (no full parse, no validation): the
 * panel dispatches on this so a v2 pair reaches the v2
 * loader and everything else reaches the v1 loader, whose
 * refusal reasons for a missing / unreadable / unknown
 * manifest are unchanged. Returns null when there is no
 * .json entry, it is not a JSON object, or its format is
 * neither known value.
 */
export function detectStateCacheFormat(
  files: Map<string, ArrayBuffer>,
): 'v1' | 'v2' | null {
  const names = [...files.keys()];
  const manifestFile = names.find((n) => n.toLowerCase().endsWith('.json'));
  if (!manifestFile) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(files.get(manifestFile)!));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const format = (parsed as Record<string, unknown>).format;
  if (format === STATE_CACHE_FORMAT_V2) return 'v2';
  if (format === STATE_CACHE_V1_FORMAT) return 'v1';
  return null;
}

/**
 * Load a v2 state cache from an in-memory file set — the
 * v1 loader's twin for the posture-carrying format (panel
 * v2 wiring). The file disambiguation mirrors
 * loadStateCacheFromFiles exactly; parsing and decoding go
 * through the v2 reader (parseStateCacheManifestV2 +
 * decodeStateCacheFramesV2, the latter re-verifying every
 * frame hash). A v1 pair is refused here with the reason —
 * the v2 parser would upgrade it, but each loader owns
 * exactly one format, so the panel's dispatch stays the
 * only place the two meet.
 */
export function loadStateCacheFromFilesV2(files: Map<string, ArrayBuffer>): StateCacheResultV2 {
  const names = [...files.keys()];
  const manifestFile = names.find((n) => n.toLowerCase().endsWith('.json'));
  if (!manifestFile) {
    return { ok: false, error: 'マニフェスト（.json）が選択に含まれていません。バイナリ（.bin）と一緒に選んでください。' };
  }
  const parsed = parseStateCacheManifestV2(new TextDecoder().decode(files.get(manifestFile)!));
  if ('error' in parsed) return { ok: false, error: parsed.error };
  if (parsed.manifest.format !== STATE_CACHE_FORMAT_V2) {
    return {
      ok: false,
      error: `マニフェストの format が "${STATE_CACHE_FORMAT_V2}" ではありません（"${parsed.manifest.format}"）。v1 形式は通常の状態キャッシュ読み込みで扱ってください。`,
    };
  }
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
  return decodeStateCacheFramesV2(parsed.manifest, files.get(framesFile)!);
}
