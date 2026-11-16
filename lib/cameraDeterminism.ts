// Camera determinism lock (Phase G).
//
// The CameraImpulseRig (components/AppSceneCameraRig.tsx) animates the
// camera from the R3F clock: clock.getElapsedTime() is wall-clock driven
// (THREE.Clock accumulates performance.now() deltas), and its z-drift term
// — sin(t * speed * 0.47) * cameraImpulseDrift * 60 — is not gated by the
// impulse strength, so with the shipped defaults (impulse 0, burst boost
// 0.35, drift 0.2) the camera wanders ±12 units even when every burst /
// impulse source is zero. The DeterministicRenderManager resets the clock
// fields before stepping, but getElapsedTime() re-derives time from the
// wall clock, so the rig's phase during an export depended on real time
// and identical exports rendered from different camera distances run to
// run (the discrepancy Phase E attributed to the layer-2 layout, which is
// in fact fully hash-seeded and deterministic).
//
// While a deterministic job runs, the manager sets this lock — the same
// suppression pattern as lib/positionFeedback's setPositionFeedbackSuppressed
// and lib/playbackTime's setTimeScaleLocked — and the rig then pins the
// camera to the config's canonical position / target (the exact framing a
// fresh load shows) with no impulse, drift or fov terms. Live behaviour
// is untouched: the lock is only ever set inside a render job.

let cameraDeterminismLocked = false;

export function setCameraDeterminismLocked(value: boolean): void {
  cameraDeterminismLocked = value;
}

export function isCameraDeterminismLocked(): boolean {
  return cameraDeterminismLocked;
}
