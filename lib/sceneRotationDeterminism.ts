// Scene rotation determinism frame feed (Phase X1).
//
// SceneGroup (components/sceneGroup.tsx) auto-rotates the scene by
// ACCUMULATING config.rotationSpeedX/Y into a ref on every useFrame
// call while playing - a per-frame count, not a function of time.
// A deterministic render job remounts the scene (so the count restarts
// from zero) and then steps the frameloop manually, but whether the
// freshly mounted group's useFrame fired on the very first stepped
// frame raced the remount: in some sessions the count ended up exactly
// one frame behind for the whole export, so every captured frame was
// rotated by one frame's worth of rotationSpeed (0.0005 / 0.001 rad
// by default) versus the other sessions - the deterministic-render
// fluctuation Phase X1 chased. The simulation itself was always
// bit-identical; only the view transform differed, by exactly one
// step of the accumulated rotation.
//
// While a job runs, the DeterministicRenderManager publishes the
// job's step index here before every advance(); SceneGroup then
// DERIVES the accumulated rotation (speed x step) instead of counting
// calls, which is immune to a missed or extra useFrame and matches
// the unshifted exports bit for bit. Outside a job the feed is null
// and live behaviour is untouched - the same pattern as
// lib/cameraDeterminism and lib/playbackTime's time-scale lock.

let deterministicRotationFrame: number | null = null;

export function setDeterministicRotationFrame(step: number | null): void {
  deterministicRotationFrame = step;
}

export function getDeterministicRotationFrame(): number | null {
  return deterministicRotationFrame;
}

// Job activity (Phase X1, second mechanism): set by the manager for
// the whole job, from before the scene remount until the finally
// block. The remounted GPGPU system can still receive one stray live
// frame during setup (a pending RAF / the frameloop change landing
// after the new system subscribed); its delta is huge after the
// setup stall but clamps to 0.05 - exactly one job step - so the sim
// started the export one step ahead in roughly one session in six.
// While a job is active the manager feeds a step index before every
// legitimate advance, so a null feed marks any other useFrame call
// as stray; the GPGPU system skips its step then (see
// components/sceneGpgpuSystem.tsx).

let deterministicJobActive = false;

export function setDeterministicJobActive(value: boolean): void {
  deterministicJobActive = value;
}

export function isDeterministicJobActive(): boolean {
  return deterministicJobActive;
}
