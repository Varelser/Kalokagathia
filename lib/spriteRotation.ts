/**
 * Sprite rotation grammar (Phase AX): the point sprite itself
 * rotates with the particle's age.
 *
 * Until Phase AX the points draw sampled the sprite image / point
 * shapes un-rotated — the only rotation in the pool was the
 * geometry mode's spin (gpgpuGeomSpin*), which never touches the
 * sprite. This module owns the angle law, as pure functions with
 * a GLSL twin in components/gpgpuShaderPoints.ts:
 *
 *   angle(age) = initial + speed · seedMul · ∫₀^age exp(−damping·a) da
 *              = initial + speed · seedMul · (1 − exp(−damping·age)) / damping
 *
 * with the damping → 0 limit reducing to initial + speed · age
 * exactly. `seedMul` spreads the per-particle speed by the
 * particle seed: 1 + (seed·2 − 1) · random, so random 0 keeps
 * every particle at the base speed. All angles are radians here;
 * the config keys are degrees (converted at the uniform site).
 *
 * Identity: initial 0 and speed 0 (the defaults) give angle 0 for
 * every age, and the draw shader only rotates while either is
 * non-zero, so the legacy sampling is bit-identical.
 */

export function clampSpriteRotInitialDeg(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-360, Math.min(360, v));
}

export function clampSpriteRotSpeedDeg(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-720, Math.min(720, v));
}

export function clampSpriteRotDamping(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

export function clampSpriteRotRandom(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Per-particle speed multiplier from the seed: [1−r, 1+r]. */
export function spriteRotSeedMultiplier(seed: number, random: number): number {
  const s = Number.isFinite(seed) ? Math.max(0, Math.min(1, seed)) : 0;
  const r = clampSpriteRotRandom(random);
  return 1 + (s * 2 - 1) * r;
}

/**
 * The damped age integral ∫₀^age exp(−damping·a) da. Damping 0
 * returns the age itself (the exact limit); tiny damping uses
 * the same closed form (the subtraction is stable enough at the
 * scales involved, and the GLSL twin uses the identical form).
 */
export function spriteRotAgeIntegral(age: number, damping: number): number {
  const a = Math.max(0, age);
  const d = clampSpriteRotDamping(damping);
  if (d <= 0) return a;
  return (1 - Math.exp(-d * a)) / d;
}

/**
 * The sprite angle (radians) at a particle age. Inputs are the
 * raw config values (degrees for initial / speed); the clamps
 * above are applied here so every caller agrees.
 */
export function spriteRotationAngle(
  age: number,
  initialDeg: number,
  speedDeg: number,
  damping: number,
  seed: number,
  random: number,
): number {
  const initial = (clampSpriteRotInitialDeg(initialDeg) * Math.PI) / 180;
  const speed = (clampSpriteRotSpeedDeg(speedDeg) * Math.PI) / 180;
  return initial + speed * spriteRotSeedMultiplier(seed, random) * spriteRotAgeIntegral(age, damping);
}

/** Rotate a centred point-coord (gl_PointCoord − 0.5 space) by
 *  the angle. Angle 0 returns the input values unchanged. */
export function rotatePointCoord(x: number, y: number, angle: number): { x: number; y: number } {
  if (angle === 0) return { x, y };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - y * s, y: x * s + y * c };
}
