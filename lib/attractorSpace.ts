/**
 * Attractor space modes (Phase DO) — TS twin of the velocity
 * shader's attractor-space branch in
 * components/gpgpuShaderSimulationVelocityMainForces.ts.
 *
 * Legacy mode is the historical behaviour: a constant-magnitude
 * pull along the attractor field's direction
 * (vel += normalize(dv) * strength * dt * 40). On a bounded pool
 * that pull makes every particle slide across the containment
 * sphere's surface until it parks at one of the surface flow's
 * tangent fixed points — for Lorenz two tight clusters, which
 * is why the Star Section Tube starter rendered black (Phase DI
 * diagnosis, refined in Phase DO: the "band" is two clusters).
 *
 * The non-legacy modes instead impose the field itself as the
 * velocity (velocity matching): vel = dv(ap) * scale * RATE *
 * strength. With the position pass stepping pos += vel * dt *
 * speed * 60, RATE = 0.015 advances the attractor's own time by
 * ~0.016 per frame at strength 1 — the classic Lorenz
 * integration step — so particles trace the attractor's actual
 * orbits and trails / tubes draw its structure.
 *
 * spread: the sampling space is recentred on the attractor's
 * own centre (per-type z centre below), so the structure forms
 * around the world origin. The sign matters: ap.z += zc maps
 * world origin to the centre; subtracting instead projects the
 * centre onto the containment sphere and worsens the collapse
 * (measured in the Phase DO spike).
 *
 * frame: the whole flow is rotated — sampling reads
 * ap = (x, z, y + zc) and the velocity is (dv.x, dv.z, dv.y) —
 * so the attractor's two wings stand in the view plane as two
 * medallions with an open centre: the structure as a frame.
 *
 * ring (added after DO shipped, by the user's decision to offer
 * all three forms): the dynamics stay legacy, so the population
 * still settles into the thin band on the containment sphere,
 * and every DRAW path offsets the sampled position by
 * ATTRACTOR_RING_Z_SHIFT in -z (the uRingOffsetZ uniform on the
 * visual materials, plus the CPU readback that feeds SmoothTube
 * and the metaballs), moving the band to the view centre so it
 * reads as a ring / picture frame. The offset is draw-side
 * only: an earlier position-pass version fed the shift back
 * into the velocity pass and the composed system settled at
 * z ≈ -192 instead of 0 (real-GPU gate, 2026-11-22) — the
 * fallback the round-31 design pre-authorised. The shift is
 * the DI-measured band centre for the Star configuration
 * (scale 8.2, bounce radius 150). The CPU fallback treats ring
 * as legacy: its canvas renderer frames positions through its
 * own divisor normalisation, which has no equivalent
 * world-space output stage to shift.
 */
export type AttractorSpaceMode = 'legacy' | 'spread' | 'frame' | 'ring';

/** World-space -z offset applied by ring mode on every draw
 * path (see the header comment). */
export const ATTRACTOR_RING_Z_SHIFT = 70;

/** Per-type z centre of the attractor, in sampling units. Only
 * the z-biased types need one; the rest are centred on 0. */
export const ATTRACTOR_Z_CENTER: Record<string, number> = {
  lorenz: 23,
  chen: 23,
  lu: 23,
  rossler: 1.5,
};

export function attractorZCenter(type: string): number {
  return ATTRACTOR_Z_CENTER[type] ?? 0;
}

/** Velocity-matching rate: attractor-time step per frame at
 * strength 1 and 60 fps (see the header comment). */
export const ATTRACTOR_SPACE_RATE = 0.015;

/**
 * Map a world position into attractor sampling space for the
 * given mode. Legacy returns the plain pos / scale sampling.
 * Pure — the CPU fallback sim uses this twin so its attractor
 * population forms the same structure as the GPU path.
 */
export function attractorSamplePoint(
  mode: AttractorSpaceMode,
  type: string,
  x: number, y: number, z: number,
  scale: number,
): [number, number, number] {
  const s = Math.max(0.1, scale);
  const ax = x / s, ay = y / s, az = z / s;
  if (mode === 'spread') return [ax, ay, az + attractorZCenter(type)];
  if (mode === 'frame') return [ax, az, ay + attractorZCenter(type)];
  return [ax, ay, az];
}

/**
 * Map an attractor-space derivative back to a world-space
 * velocity direction for the given mode. Frame rotates the
 * derivative with the same y/z swap as the sampling.
 */
export function attractorMapDerivative(
  mode: AttractorSpaceMode,
  dvx: number, dvy: number, dvz: number,
): [number, number, number] {
  if (mode === 'frame') return [dvx, dvz, dvy];
  return [dvx, dvy, dvz];
}
