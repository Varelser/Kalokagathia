// WebGPU diagnostic snapshot (Stage 0 S7, plan A1) — the pure
// half of the route-aware captureState support.
//
// Background (STAGE0_S7_CROWD_DIAG_ANALYSIS): the ?diag=1 hook's
// captureState() unconditionally read the WebGL ping-pong render
// targets. On the WebGPU route those targets are never written
// by the simulation, while the published posOut/velOut still
// alternate A/B every frame — so the hook returned two frozen
// pre-WebGPU snapshots alternately and gate measurements (crowd
// M2/M4) read them as live state.
//
// The fix keeps captureState() synchronous: the WebGPU compute
// state maintains a latest-completed diagnostic snapshot (a
// position + velocity pair read back from the same simulation
// step, see refreshWebGPUDiagSnapshot in lib/webgpuCompute.ts),
// and captureState() returns that snapshot together with the
// freshness metadata described here. When no snapshot exists
// yet, captureState() reports not-ready instead of returning
// the frozen WebGL targets.
//
// This module is deliberately free of GPU / DOM dependencies so
// the freshness contract can be pinned by unit tests.

/** One completed position+velocity readback pair. */
export interface WebGPUDiagSnapshot {
  /** RGBA per particle: (x, y, z, age), texSize*texSize*4. */
  positions: Float32Array;
  /** RGBA per particle: (vx, vy, vz, phase), texSize*texSize*4. */
  velocities: Float32Array;
  /** stepWebGPUCompute frame counter value of the step this
   * pair was read back from (1-based; -1 never appears here). */
  frame: number;
  /** performance.now() at the moment the readback completed. */
  capturedAtMs: number;
}

/** Freshness metadata captureState() returns on the WebGPU route. */
export interface WebGPUDiagSnapshotMeta {
  route: 'webgpu';
  /** True when a completed snapshot exists at all. */
  available: boolean;
  /** True when there is no snapshot, or the snapshot lags the
   * latest stepped frame / wall clock beyond the bounds below. */
  stale: boolean;
  /** Frame the snapshot was read back from (null if none). */
  frame: number | null;
  /** Readback completion time (null if none). */
  capturedAtMs: number | null;
  /** Latest frame stepped by stepWebGPUCompute so far. */
  latestFrame: number;
}

/** A snapshot at most this many stepped frames behind the
 * latest frame still counts as fresh (the readback pair is
 * queued from a step's staging copies and completes
 * asynchronously, so a small lag is the normal case). */
export const WEBGPU_DIAG_STALE_FRAME_LAG = 2;
/** A snapshot older than this (wall clock) counts as stale
 * regardless of frame lag — e.g. the tab was paused. */
export const WEBGPU_DIAG_STALE_AGE_MS = 500;

export function describeWebGPUDiagSnapshot(
  snapshot: WebGPUDiagSnapshot | null,
  latestFrame: number,
  nowMs: number,
): WebGPUDiagSnapshotMeta {
  if (!snapshot) {
    return {
      route: 'webgpu',
      available: false,
      stale: true,
      frame: null,
      capturedAtMs: null,
      latestFrame,
    };
  }
  const stale =
    latestFrame - snapshot.frame > WEBGPU_DIAG_STALE_FRAME_LAG ||
    nowMs - snapshot.capturedAtMs > WEBGPU_DIAG_STALE_AGE_MS;
  return {
    route: 'webgpu',
    available: true,
    stale,
    frame: snapshot.frame,
    capturedAtMs: snapshot.capturedAtMs,
    latestFrame,
  };
}
