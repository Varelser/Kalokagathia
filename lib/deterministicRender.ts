// Deterministic render export: the scene is stepped with a fixed timestep
// (frameloop 'never' + manual clock control inside the canvas) and every
// stepped frame is captured as a PNG, delivered as ZIP part(s). Because
// the in-scene clock is reset to zero and advanced by exactly 1/fps per
// frame, the same config produces the same frames regardless of how fast
// the machine is — unlike the realtime MediaRecorder video export, whose
// timing depends on the live frame rate.
//
// Pro-1 v1 (2026-11-15): the frame cap is 3600 and long renders no longer
// hold every frame in memory. The manager streams each captured frame to
// the job's onFrame callback as it is produced; the ZIP path packs frames
// into parts of at most ZIP_PART_FRAMES frames and hands each finished
// part to onPart (the UI downloads it immediately), so peak memory is one
// part instead of the whole take. The video path still collects frames
// (the WebCodecs encoder helper takes an array) and is therefore capped
// separately at MAX_DETERMINISTIC_VIDEO_FRAMES — the UI states this.
//
// Warmup: a job may step warmupFrames frames (default
// DEFAULT_WARMUP_FRAMES) before the first captured frame. Those steps are
// never captured and exist to move past the ignition transient, whose
// run-to-run jitter (the first 1-2 frames igniting a frame or two early or
// late) was the largest known source of divergence between two renders of
// the same config. With warmupFrames = 0 the manager performs exactly the
// old sequence — scene remount, clock reset, advance((i+1)*dt), capture —
// so a zero-warmup job produces the identical frame sequence to the
// pre-Pro-1 renderer (see PRO1_IMPL_REPORT.md).
//
// Boundaries (stated in the UI as well): CPU layouts are hash-deterministic
// functions of the config, GPGPU initial states are seed-determined, and
// shader motion is a function of the controlled clock. State accumulated
// by the GPGPU simulation while running live before the export, and
// wall-clock-driven overlays (temporal profiles, modulation, live audio
// reactivity), are outside the deterministic envelope — apply the preset
// fresh and keep those off for a byte-identical take. Warmup reduces the
// ignition-transient jitter inside that envelope; it does not widen it.

// Phase C (2026-11-16): a job may also request a capture resolution
// (width/height in pixels; the manager resizes the renderer with the
// pixel ratio pinned to 1 for the duration of the job and restores it
// afterwards) and a loop measurement (loopMode). The loop measurement
// is deliberately a measurement, not a guarantee: after the last
// captured frame the manager steps one probe frame at exactly one
// period after frame 0 and diffs it pixel by pixel against frame 0
// (the drift) and against the last captured frame (the visible jump
// when the sequence wraps). Time-driven elements whose period divides
// the loop length measure ~0 drift; stateful simulations (GPGPU etc.)
// accumulate, so their seam is reported numerically in the manifest
// and the UI instead of being promised away. See LOOP_BOUNDARY_NOTE.
//
// Pro-1.1 (2026-11-16): a job may also choose its background mode.
// 'opaque' is the legacy behaviour exactly (the scene as configured,
// PostFx included, alpha untouched). 'transparent' is the conventional
// matte: the manager re-renders each stepped frame directly to an
// offscreen target with no scene background and no PostFx. 'unmult'
// keeps the normal black-background PostFx render and derives a
// straight-alpha matte from the captured pixels at capture time only
// (Method B in ALPHA_POSTFX_VERDICT.md; see lib/unmult.ts). The video
// path rejects both transparent modes — the in-app WebCodecs encoder
// cannot carry alpha — rather than silently falling back to opaque.
//
// JSZip is loaded lazily inside renderDeterministicSequence: it is only
// needed when the user actually exports, so it stays out of the initial bundle.
import type { VideoFormat } from './videoEncode';
import { UNMULT_SMOOTHSTEP_HIGH, UNMULT_SMOOTHSTEP_LOW } from './unmult';

/**
 * Background handling for a deterministic render. 'opaque' (the
 * default everywhere) reproduces the pre-Pro-1.1 export pixel for
 * pixel; the other two modes only take effect when a job — or the
 * deterministicBackgroundMode config key behind the UI — asks for
 * them explicitly.
 */
export type DeterministicBackgroundMode = 'opaque' | 'transparent' | 'unmult';

export const DEFAULT_DETERMINISTIC_BACKGROUND_MODE: DeterministicBackgroundMode = 'opaque';

export function resolveDeterministicBackgroundMode(
  job: DeterministicRenderJob,
): DeterministicBackgroundMode {
  return job.backgroundMode === 'transparent' || job.backgroundMode === 'unmult'
    ? job.backgroundMode
    : DEFAULT_DETERMINISTIC_BACKGROUND_MODE;
}

export interface DeterministicRenderJob {
  fps: number;
  frames: number;
  /**
   * Capture size in pixels (Phase C resolution presets). Both must be
   * present and positive for the manager to resize; omitted means the
   * canvas is captured at its current size — the exact legacy
   * behaviour. The frames (and the manifest) always record the size
   * actually captured.
   */
  width?: number;
  height?: number;
  /**
   * Label of the UI resolution preset the size came from (e.g.
   * '3840x2160'), recorded in the manifest as resolutionPreset. Null /
   * omitted means the canvas size was used.
   */
  resolutionLabel?: string;
  /**
   * Loop measurement (Phase C). When true, the manager keeps frame 0
   * and the last frame's pixels, steps one probe frame at exactly one
   * period after frame 0, and reports the seam differences (see
   * DeterministicLoopMeasurement). The probe is measured, never
   * emitted as a frame. Default false = no probe, no extra step.
   */
  loopMode?: boolean;
  /**
   * Background mode for the captured frames. Omitted (or an unknown
   * value) means 'opaque', the exact legacy behaviour. Transparent
   * modes are PNG-sequence only; renderDeterministicVideo throws for
   * them instead of falling back.
   */
  backgroundMode?: DeterministicBackgroundMode;
  /**
   * Frames stepped (but not captured) after the clock reset, before the
   * first captured frame. Defaults to DEFAULT_WARMUP_FRAMES when omitted.
   * Pass 0 to reproduce the pre-Pro-1 frame sequence exactly.
   */
  warmupFrames?: number;
  /** App version string for the render manifest, supplied by the UI. */
  appVersion?: string;
  /**
   * Optional per-frame hook, called with the stepped clock's timestamp in
   * seconds before that step is rendered (used to drive a recorded
   * performance take). The manager waits briefly after each call so React
   * state can flush. The timestamp includes warmup: warmup steps call the
   * hook at 1/fps … warmupFrames/fps, and captured frame i calls it at
   * (warmupFrames + i + 1)/fps. A caller driving its own timeline from
   * zero (the take export) must subtract warmupFrames/fps so its frame i
   * still lands on its own (i+1)/fps — during warmup that yields t <= 0,
   * i.e. the timeline's initial config, which is exactly the base state
   * the scene should warm up in.
   */
  applyAt?: (tSeconds: number) => void;
  /**
   * Optional hook awaited once, after the job's scene remount has
   * settled and before the clock reset and the first step. The
   * remount rebuilds every system from the config, so this is the
   * one point where a job can put state the remount discarded
   * back into the fresh mount — the state-cache capture driver
   * uses it to re-apply the last applied initial state (bake A-2
   * premise fix, lib/gpgpuInitialState.ts). Throwing aborts the
   * job with that reason. Jobs that do not set it run the exact
   * legacy sequence.
   */
  onSceneReady?: () => void | Promise<void>;
  /**
   * Optional per-captured-frame hook, awaited after that frame has
   * been stepped and captured (never for warmup steps). The stepped
   * simulation state is still current when this runs — the next
   * advance happens only after it resolves — so a hook may read the
   * frame's sim state back through the state-cache frame provider
   * (lib/gpgpuStateCacheCapture.ts). Jobs that do not set it run the
   * exact legacy sequence.
   */
  onSimFrame?: (frame: { index: number; timeSeconds: number }) => void | Promise<void>;
  /**
   * Optional streaming sink, awaited once per captured frame in order.
   * When present, the manager does not retain captured frames in memory
   * (its returned frames array is empty); consumers that need the frames
   * afterwards (the video encoder) must omit this and use the returned
   * array instead.
   */
  onFrame?: (frame: DeterministicCapturedFrame) => void | Promise<void>;
}

export interface DeterministicCapturedFrame {
  /** 0-based index within the captured sequence (warmup not counted). */
  index: number;
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Seam measurement for a loopMode job (Phase C). All differences are
 * computed over the captured RGBA pixels after background processing,
 * so they describe the frames actually delivered.
 */
export interface DeterministicLoopMeasurement {
  /** Captured frames in one loop period. */
  periodFrames: number;
  /** Loop duration in seconds (periodFrames / fps). */
  periodSeconds: number;
  /**
   * Mean absolute per-channel difference (0–255) between the probe
   * frame — stepped at exactly one period after frame 0 — and frame 0.
   * ~0 means the scene returned to its starting state after one
   * period, i.e. the loop is seamless for this take.
   */
  seamDriftMeanAbsDiff: number;
  /** Fraction of pixels whose largest channel drift exceeds 8/255. */
  seamDriftMismatchRatio: number;
  /**
   * Mean absolute per-channel difference between the last captured
   * frame and frame 0 — the visible jump when playback wraps. This
   * includes one frame of ordinary motion, so it is ~0 only for
   * near-still endings; the drift figure above is the periodicity
   * measure.
   */
  seamJumpMeanAbsDiff: number;
  /** Fraction of pixels whose largest channel jump exceeds 8/255. */
  seamJumpMismatchRatio: number;
  /** Largest single-channel drift observed anywhere in the frame. */
  seamMaxAbsDiff: number;
}

export const LOOP_BOUNDARY_NOTE =
  'Loop seam is measured, not guaranteed: the probe frame one period after frame 0 is diffed against frame 0 (drift) and the last frame against frame 0 (jump). '
  + 'Time-driven elements whose motion period divides the loop length return to the same phase and measure ~0 drift. '
  + 'Stateful simulations (GPGPU, feedback, accumulated phases) do not repeat exactly; their seam is the measured value, and a crossfade in an editor is the remedy when it is visible.';

export interface DeterministicRenderResult {
  /** Captured frames; empty when the job streamed them via onFrame. */
  frames: Blob[];
  /** Canvas width in pixels (0 when no frame was captured). */
  width: number;
  /** Canvas height in pixels (0 when no frame was captured). */
  height: number;
  /** Warmup frames actually stepped (after defaulting / clamping). */
  warmupFrames: number;
  /** Loop seam measurement; null unless the job set loopMode. */
  loop?: DeterministicLoopMeasurement | null;
}

export type DeterministicRenderProgress = (done: number, total: number) => void;

export type DeterministicRenderHandler = (
  job: DeterministicRenderJob,
  onProgress: DeterministicRenderProgress,
) => Promise<DeterministicRenderResult>;

let handler: DeterministicRenderHandler | null = null;

export function registerDeterministicRenderHandler(next: DeterministicRenderHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/** Hard cap for any deterministic job (ZIP or video), in captured frames. */
export const MAX_DETERMINISTIC_FRAMES = 3600;
/** The video path collects every frame in memory, so it keeps a lower cap. */
export const MAX_DETERMINISTIC_VIDEO_FRAMES = 1800;
/** Frames per ZIP part; a finished part is delivered before the next begins. */
export const ZIP_PART_FRAMES = 600;
/** Warmup frames stepped before capture when a job does not specify any. */
export const DEFAULT_WARMUP_FRAMES = 30;

export function resolveWarmupFrames(job: DeterministicRenderJob): number {
  if (job.warmupFrames === undefined) return DEFAULT_WARMUP_FRAMES;
  if (!Number.isFinite(job.warmupFrames)) return DEFAULT_WARMUP_FRAMES;
  return Math.max(0, Math.floor(job.warmupFrames));
}

export const DETERMINISM_BOUNDARY_NOTE =
  'Fixed-timestep render: captured frame i shows the scene at (warmupFrames + i + 1)/fps seconds on the reset in-scene clock. '
  + 'Deterministic envelope: CPU layouts are hash functions of the config, GPGPU initial states are seed-determined, and shader motion follows the controlled clock. '
  + 'Outside the envelope: state accumulated by the GPGPU simulation while running live before the export, and wall-clock-driven overlays (temporal profiles, modulation, live audio reactivity). '
  + 'GPU floating-point determinism also applies: on software-GL environments particle-level results can differ by a few percent even when shape, count and timing match.';

/** Loop block recorded in render.json (Phase C). */
export interface DeterministicLoopManifest {
  enabled: true;
  periodFrames: number;
  periodSeconds: number;
  /**
   * True only in the final part's manifest: parts are streamed out
   * while the render is still running, but the seam can only be
   * measured once the probe frame has been stepped at the very end.
   * Earlier parts carry measured: false and null figures.
   */
  measured: boolean;
  seamDriftMeanAbsDiff: number | null;
  seamDriftMismatchRatio: number | null;
  seamJumpMeanAbsDiff: number | null;
  seamJumpMismatchRatio: number | null;
  seamMaxAbsDiff: number | null;
  boundary: string;
}

export interface DeterministicRenderManifest {
  app: 'Kalokagathia';
  appVersion: string;
  format: string;
  fps: number;
  frames: number;
  timestepSeconds: number;
  width: number;
  height: number;
  /** UI resolution preset label the job requested, or null when the
   *  canvas size was captured as-is (Phase C). width/height above are
   *  always the size actually captured. */
  resolutionPreset: string | null;
  warmupFrames: number;
  /** Loop measurement block, or null for a non-loop job (Phase C). */
  loop: DeterministicLoopManifest | null;
  /** Background mode the frames were captured with (Pro-1.1). */
  backgroundMode: DeterministicBackgroundMode;
  /** True only for the UnMult mode; kept alongside backgroundMode so
   *  a manifest can be checked without knowing the mode vocabulary. */
  unmult: boolean;
  /** The UnMult threshold curve used, or null for the other modes. */
  unmultSmoothstep: { low: number; high: number } | null;
  createdAt: string;
  part: number;
  partCount: number;
  /** Global 0-based index of this part's first frame. */
  partFirstFrame: number;
  /** Number of frames inside this part. */
  partFrames: number;
  note: string;
  determinismBoundary: string;
}

export function buildDeterministicLoopManifest(
  job: DeterministicRenderJob,
  measurement: DeterministicLoopMeasurement | null,
): DeterministicLoopManifest | null {
  if (job.loopMode !== true) return null;
  return {
    enabled: true,
    periodFrames: job.frames,
    periodSeconds: job.frames / job.fps,
    measured: measurement !== null,
    seamDriftMeanAbsDiff: measurement ? measurement.seamDriftMeanAbsDiff : null,
    seamDriftMismatchRatio: measurement ? measurement.seamDriftMismatchRatio : null,
    seamJumpMeanAbsDiff: measurement ? measurement.seamJumpMeanAbsDiff : null,
    seamJumpMismatchRatio: measurement ? measurement.seamJumpMismatchRatio : null,
    seamMaxAbsDiff: measurement ? measurement.seamMaxAbsDiff : null,
    boundary: LOOP_BOUNDARY_NOTE,
  };
}

export function buildDeterministicRenderManifest(args: {
  job: DeterministicRenderJob;
  format: string;
  totalFrames: number;
  width: number;
  height: number;
  warmupFrames: number;
  createdAt: string;
  part: number;
  partCount: number;
  partFirstFrame: number;
  partFrames: number;
  /** Loop measurement, available only once the handler has finished
   *  (i.e. for the final part); omit for parts flushed mid-render. */
  loopMeasurement?: DeterministicLoopMeasurement | null;
}): DeterministicRenderManifest {
  const backgroundMode = resolveDeterministicBackgroundMode(args.job);
  return {
    app: 'Kalokagathia',
    appVersion: args.job.appVersion ?? 'unknown',
    format: args.format,
    fps: args.job.fps,
    frames: args.totalFrames,
    timestepSeconds: 1 / args.job.fps,
    width: args.width,
    height: args.height,
    resolutionPreset: args.job.resolutionLabel ?? null,
    loop: buildDeterministicLoopManifest(args.job, args.loopMeasurement ?? null),
    warmupFrames: args.warmupFrames,
    backgroundMode,
    unmult: backgroundMode === 'unmult',
    unmultSmoothstep: backgroundMode === 'unmult'
      ? { low: UNMULT_SMOOTHSTEP_LOW, high: UNMULT_SMOOTHSTEP_HIGH }
      : null,
    createdAt: args.createdAt,
    part: args.part,
    partCount: args.partCount,
    partFirstFrame: args.partFirstFrame,
    partFrames: args.partFrames,
    note: 'Fixed-timestep render: frame i shows the scene at (i+1)/fps seconds on the reset in-scene clock (plus warmupFrames stepped before capture).',
    determinismBoundary: DETERMINISM_BOUNDARY_NOTE,
  };
}

export interface DeterministicSequencePart {
  /** Finished ZIP blob for this part. */
  blob: Blob;
  /** 1-based part number. */
  part: number;
  partCount: number;
  /** Global 0-based index of this part's first frame. */
  firstFrame: number;
  /** Number of frames inside this part. */
  frames: number;
  manifest: DeterministicRenderManifest;
}

export type DeterministicSequencePartHandler = (
  part: DeterministicSequencePart,
) => void | Promise<void>;

/**
 * Stepped capture packed into ZIP part(s) of at most ZIP_PART_FRAMES
 * frames each. When onPart is given, each part is handed over (and
 * awaited) as soon as it is finished and is not retained; the returned
 * array then only lists the parts' metadata-sized info via the resolved
 * manifests. Without onPart, all part blobs are returned — fine for short
 * takes, but callers rendering long sequences should pass onPart and
 * download each part as it arrives.
 */
export type DeterministicLoopMeasuredHandler = (
  measurement: DeterministicLoopMeasurement,
) => void;

export async function renderDeterministicSequence(
  job: DeterministicRenderJob,
  onProgress: DeterministicRenderProgress,
  onPart?: DeterministicSequencePartHandler,
  onLoopMeasured?: DeterministicLoopMeasuredHandler,
): Promise<DeterministicSequencePart[]> {
  if (!handler) {
    throw new Error('deterministic renderer is not ready');
  }
  const activeHandler = handler;
  const { default: JSZip } = await import('jszip');
  const createdAt = new Date().toISOString();
  const partCount = Math.max(1, Math.ceil(job.frames / ZIP_PART_FRAMES));
  const warmupFrames = resolveWarmupFrames(job);
  const parts: DeterministicSequencePart[] = [];
  let width = 0;
  let height = 0;
  // The loop seam is measured by the manager after the last frame, so
  // it only exists once the handler resolves; the final part's flush
  // is deferred until then (see the onFrame flush condition) so its
  // manifest can carry the figures.
  let loopMeasurement: DeterministicLoopMeasurement | null = null;

  let zip: InstanceType<typeof JSZip> | null = null;
  let partFirstFrame = 0;
  let partFrameCount = 0;
  let partNumber = 1;

  const flushPart = async (): Promise<void> => {
    if (!zip || partFrameCount === 0) return;
    const manifest = buildDeterministicRenderManifest({
      job,
      format: 'png-sequence-zip',
      totalFrames: job.frames,
      width,
      height,
      warmupFrames,
      createdAt,
      part: partNumber,
      partCount,
      partFirstFrame,
      partFrames: partFrameCount,
      loopMeasurement,
    });
    zip.file('render.json', JSON.stringify(manifest, null, 2));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const part: DeterministicSequencePart = {
      blob,
      part: partNumber,
      partCount,
      firstFrame: partFirstFrame,
      frames: partFrameCount,
      manifest,
    };
    if (onPart) {
      await onPart(part);
    } else {
      parts.push(part);
    }
    zip = null;
    partFrameCount = 0;
    partNumber += 1;
  };

  const result = await activeHandler(
    {
      ...job,
      warmupFrames,
      onFrame: async (frame) => {
        width = frame.width;
        height = frame.height;
        if (!zip) {
          zip = new JSZip();
          partFirstFrame = frame.index;
        }
        // PNG frames are already compressed; STORE keeps zipping
        // near-instant even on a loaded machine (DEFLATE would
        // re-compress megabytes). Frame names keep the global index so
        // parts concatenate into one sequence.
        zip.file(`frame-${String(frame.index).padStart(4, '0')}.png`, frame.blob, { compression: 'STORE' });
        partFrameCount += 1;
        // The final part is flushed after the handler resolves (below)
        // even when it fills exactly on the last frame, so its
        // manifest can carry the loop measurement.
        if (partFrameCount >= ZIP_PART_FRAMES && frame.index < job.frames - 1) {
          await flushPart();
        }
      },
    },
    onProgress,
  );
  loopMeasurement = result.loop ?? null;
  if (onLoopMeasured && loopMeasurement) {
    onLoopMeasured(loopMeasurement);
  }
  await flushPart();
  // When onPart consumed the parts they were not retained, so this
  // resolves to an empty array; callers that need the blobs afterwards
  // must omit onPart. `result` itself carries no frames on this path
  // because the manager streamed them into the callback above.
  return parts;
}

/**
 * Same stepped capture as renderDeterministicSequence, but the frames go
 * straight into a WebCodecs encoder and come back as one video file
 * (WebM/VP9 or MP4/H.264) — frame timing stays exact because each frame
 * is stamped i/fps by the encoder path. Throws VideoEncodeUnsupportedError
 * (from lib/videoEncode) when the browser cannot encode the format.
 * Capped at MAX_DETERMINISTIC_VIDEO_FRAMES because every frame is held in
 * memory for the encoder; use the ZIP path beyond that.
 */
export async function renderDeterministicVideo(
  job: DeterministicRenderJob,
  format: VideoFormat,
  onProgress: DeterministicRenderProgress,
  onLoopMeasured?: DeterministicLoopMeasuredHandler,
): Promise<Blob> {
  if (!handler) {
    throw new Error('deterministic renderer is not ready');
  }
  if (job.frames > MAX_DETERMINISTIC_VIDEO_FRAMES) {
    throw new Error(
      `deterministic video is limited to ${MAX_DETERMINISTIC_VIDEO_FRAMES} frames (got ${job.frames}); use the PNG sequence (ZIP) export for longer renders`,
    );
  }
  // The WebCodecs encoder path cannot carry an alpha channel, so a
  // transparent background mode must fail loudly here — falling back
  // to an opaque render would silently deliver the wrong matte.
  const backgroundMode = resolveDeterministicBackgroundMode(job);
  if (backgroundMode !== 'opaque') {
    throw new Error(
      `deterministic video does not support the '${backgroundMode}' background mode (the video encoder has no alpha channel); use the PNG sequence (ZIP) export`,
    );
  }
  const result = await handler({ ...job, warmupFrames: resolveWarmupFrames(job) }, onProgress);
  if (onLoopMeasured && result.loop) {
    onLoopMeasured(result.loop);
  }
  // Phase DK step D: the encoder is only needed on the video path, so it
  // is loaded on demand instead of riding along with this module.
  const { encodeFramesToVideo } = await import('./videoEncode');
  return encodeFramesToVideo(result.frames, job.fps, format, onProgress);
}
