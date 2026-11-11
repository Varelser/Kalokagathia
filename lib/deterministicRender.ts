// Deterministic render export: the scene is stepped with a fixed timestep
// (frameloop 'never' + manual clock control inside the canvas) and every
// stepped frame is captured as a PNG, delivered as a ZIP sequence. Because
// the in-scene clock is reset to zero and advanced by exactly 1/fps per
// frame, the same config produces the same frames regardless of how fast
// the machine is — unlike the realtime MediaRecorder video export, whose
// timing depends on the live frame rate.
//
// Boundaries (stated in the UI as well): CPU layouts are hash-deterministic
// functions of the config, GPGPU initial states are seed-determined, and
// shader motion is a function of the controlled clock. State accumulated
// by the GPGPU simulation while running live before the export, and
// wall-clock-driven overlays (temporal profiles, modulation, live audio
// reactivity), are outside the deterministic envelope — apply the preset
// fresh and keep those off for a byte-identical take.

// JSZip is loaded lazily inside renderDeterministicSequence: it is only
// needed when the user actually exports, so it stays out of the initial bundle.
import { encodeFramesToVideo, type VideoFormat } from './videoEncode';

export interface DeterministicRenderJob {
  fps: number;
  frames: number;
  /**
   * Optional per-frame hook, called with the frame's timestamp in seconds
   * before it is rendered (used to drive a recorded performance take:
   * the panel applies the take's config at that exact time). The manager
   * waits briefly after each call so React state can flush.
   */
  applyAt?: (tSeconds: number) => void;
}

export type DeterministicRenderProgress = (done: number, total: number) => void;

export type DeterministicRenderHandler = (
  job: DeterministicRenderJob,
  onProgress: DeterministicRenderProgress,
) => Promise<Blob[]>;

let handler: DeterministicRenderHandler | null = null;

export function registerDeterministicRenderHandler(next: DeterministicRenderHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export const MAX_DETERMINISTIC_FRAMES = 240;

export async function renderDeterministicSequence(
  job: DeterministicRenderJob,
  onProgress: DeterministicRenderProgress,
): Promise<Blob> {
  if (!handler) {
    throw new Error('deterministic renderer is not ready');
  }
  const frames = await handler(job, onProgress);
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  frames.forEach((blob, index) => {
    // PNG frames are already compressed; STORE keeps zipping near-instant
    // even on a loaded machine (DEFLATE would re-compress megabytes).
    zip.file(`frame-${String(index).padStart(4, '0')}.png`, blob, { compression: 'STORE' });
  });
  zip.file(
    'render.json',
    JSON.stringify(
      {
        fps: job.fps,
        frames: frames.length,
        timestepSeconds: 1 / job.fps,
        note: 'Fixed-timestep render: frame i shows the scene at (i+1)/fps seconds on the reset in-scene clock.',
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/**
 * Same stepped capture as renderDeterministicSequence, but the frames go
 * straight into a WebCodecs encoder and come back as one video file
 * (WebM/VP9 or MP4/H.264) — frame timing stays exact because each frame
 * is stamped i/fps by the encoder path. Throws VideoEncodeUnsupportedError
 * (from lib/videoEncode) when the browser cannot encode the format.
 */
export async function renderDeterministicVideo(
  job: DeterministicRenderJob,
  format: VideoFormat,
  onProgress: DeterministicRenderProgress,
): Promise<Blob> {
  if (!handler) {
    throw new Error('deterministic renderer is not ready');
  }
  const frames = await handler(job, onProgress);
  return encodeFramesToVideo(frames, job.fps, format, onProgress);
}
