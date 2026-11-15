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

// JSZip is loaded lazily inside renderDeterministicSequence: it is only
// needed when the user actually exports, so it stays out of the initial bundle.
import { encodeFramesToVideo, type VideoFormat } from './videoEncode';

export interface DeterministicRenderJob {
  fps: number;
  frames: number;
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

export interface DeterministicRenderResult {
  /** Captured frames; empty when the job streamed them via onFrame. */
  frames: Blob[];
  /** Canvas width in pixels (0 when no frame was captured). */
  width: number;
  /** Canvas height in pixels (0 when no frame was captured). */
  height: number;
  /** Warmup frames actually stepped (after defaulting / clamping). */
  warmupFrames: number;
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

export interface DeterministicRenderManifest {
  app: 'Kalokagathia';
  appVersion: string;
  format: string;
  fps: number;
  frames: number;
  timestepSeconds: number;
  width: number;
  height: number;
  warmupFrames: number;
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
}): DeterministicRenderManifest {
  return {
    app: 'Kalokagathia',
    appVersion: args.job.appVersion ?? 'unknown',
    format: args.format,
    fps: args.job.fps,
    frames: args.totalFrames,
    timestepSeconds: 1 / args.job.fps,
    width: args.width,
    height: args.height,
    warmupFrames: args.warmupFrames,
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
export async function renderDeterministicSequence(
  job: DeterministicRenderJob,
  onProgress: DeterministicRenderProgress,
  onPart?: DeterministicSequencePartHandler,
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
        if (partFrameCount >= ZIP_PART_FRAMES) {
          await flushPart();
        }
      },
    },
    onProgress,
  );
  await flushPart();
  // When onPart consumed the parts they were not retained, so this
  // resolves to an empty array; callers that need the blobs afterwards
  // must omit onPart. `result` itself carries no frames on this path
  // because the manager streamed them into the callback above.
  void result;
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
): Promise<Blob> {
  if (!handler) {
    throw new Error('deterministic renderer is not ready');
  }
  if (job.frames > MAX_DETERMINISTIC_VIDEO_FRAMES) {
    throw new Error(
      `deterministic video is limited to ${MAX_DETERMINISTIC_VIDEO_FRAMES} frames (got ${job.frames}); use the PNG sequence (ZIP) export for longer renders`,
    );
  }
  const result = await handler({ ...job, warmupFrames: resolveWarmupFrames(job) }, onProgress);
  return encodeFramesToVideo(result.frames, job.fps, format, onProgress);
}
