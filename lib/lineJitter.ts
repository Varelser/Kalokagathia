/**
 * Hand-drawn line jitter (Phase AH).
 *
 * The Layer line shaders (Classic / Brush) displace each line
 * endpoint by a deterministic hash of the endpoint's own particle
 * attributes (phase / random), so a line wobbles like a hand-drawn
 * stroke without any time evolution — the offset is a pure
 * function of the particle, never of the frame, so it cannot
 * boil or crawl. This module is the TS twin of `lineJitterOffset`
 * in components/sceneShaderParticleLineClassic.ts and
 * sceneShaderParticleLineBrush.ts (same hash constants; GPU float
 * precision may differ in the last bits, which is fine for a
 * static offset). Amount 0 returns the exact zero vector — and
 * the shaders early-out on 0 — so the default render is
 * bit-identical.
 */

export function clampLineJitter(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(10, v));
}

function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/**
 * Deterministic offset for one endpoint. `phase` / `random` are
 * the particle's aPhase / aRandom attributes; `radius` is the
 * layer's global radius (uGlobalRadius), so the wobble scales
 * with the scene like every other line quantity. The offset is
 * bounded by amount * radius * 0.02 per axis (centred on 0).
 */
export function lineJitterOffset(
  phase: number,
  random: number,
  amount: number,
  radius: number,
): { x: number; y: number; z: number } {
  const a = clampLineJitter(amount);
  if (a <= 0) return { x: 0, y: 0, z: 0 };
  const scale = a * Math.max(1, radius) * 0.02;
  return {
    x: (dmHash11(phase * 12.9898 + random * 78.233) - 0.5) * 2 * scale,
    y: (dmHash11(phase * 26.651 + random * 41.317 + 19.19) - 0.5) * 2 * scale,
    z: (dmHash11(phase * 7.233 + random * 12.9898 + 43.71) - 0.5) * 2 * scale,
  };
}
