/**
 * Dashed lines (Phase AM).
 *
 * The 2D audit §1 dash grammar for the Layer line shaders
 * (Classic / Brush): each vertex carries a dash coordinate —
 * arc length along its segment plus a per-segment phase from
 * the segment midpoint's hash — and the fragment discards the
 * parts of the period that fall in the gap. This module is the
 * TS twin of the GLSL in sceneShaderParticleLineClassic.ts and
 * sceneShaderParticleLineBrush.ts (same hash constants, same
 * period test). Dash length 0 (the default) disables the test
 * entirely, so the legacy line render is bit-identical; a gap
 * of 0 makes the period equal the dash, which never discards.
 */

export function clampLineDashLength(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(50, v));
}

export function clampLineDashGap(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(50, v));
}

function hash1(x: number): number {
  const s = Math.sin(x) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Per-segment dash phase: a deterministic offset in world
 * units derived from the segment midpoint, so neighbouring
 * segments do not share one global dash phase (the pattern
 * reads as drawn per stroke, like the jitter's per-particle
 * offsets). Identical at both endpoints because both compute
 * it from the same midpoint.
 */
export function lineDashPhase(midX: number, midY: number, midZ: number): number {
  return hash1(midX * 12.9898 + midY * 78.233 + midZ * 37.719) * 61.7;
}

/** Is the fragment at dash coordinate `coord` inside a dash? */
export function lineDashVisible(coord: number, dashLength: number, gapLength: number): boolean {
  const dash = clampLineDashLength(dashLength);
  if (dash <= 0) return true;
  const period = dash + clampLineDashGap(gapLength);
  if (period <= 0) return true;
  const m = ((coord % period) + period) % period;
  return m < dash;
}
