// Global playback time scale (Kinetix integration B3).
//
// config.timeScale multiplies the frame delta of the realtime systems
// that accumulate their own clocks (the layer particle systems and the
// GPGPU simulation). 1 is the legacy behaviour; values in (0, 1) slow
// time down, values above 1 speed it up, and negative values run the
// affected systems backwards.
//
// Deterministic renders must stay inside their fixed-timestep envelope
// ("captured frame i shows the scene at (warmup + i + 1) / fps"), so
// the DeterministicRenderManager locks the scale to 1 for the duration
// of a job via setTimeScaleLocked — the same suppression pattern as
// lib/positionFeedback's setPositionFeedbackSuppressed. While locked,
// resolveTimeScale returns 1 regardless of the config value, which
// means a negative or fractional timeScale can never leak into an
// export. This is the safe-side handling chosen for B3: deterministic
// renders always advance exactly as before.

import type { ParticleConfig } from '../types';

let timeScaleLocked = false;

export function setTimeScaleLocked(value: boolean): void {
  timeScaleLocked = value;
}

export function isTimeScaleLocked(): boolean {
  return timeScaleLocked;
}

export function resolveTimeScale(config: Pick<ParticleConfig, 'timeScale'>): number {
  if (timeScaleLocked) return 1;
  const raw = config.timeScale;
  if (!Number.isFinite(raw)) return 1;
  // Clamp to the catalogued range so a hand-edited project file cannot
  // destabilise the integrators.
  return Math.max(-2, Math.min(3, raw));
}

/** Frame delta for a clock-accumulating realtime system. */
export function scaleFrameDelta(delta: number, config: Pick<ParticleConfig, 'timeScale'>): number {
  return delta * resolveTimeScale(config);
}
