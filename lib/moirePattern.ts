// Moire pattern grammar (Phase AW): two regular patterns laid
// over each other — the second rotated by an angle and shifted
// by a phase — and multiplied. The product of two near-identical
// regular fields is the classic moire interference: large-scale
// beat bands neither pattern contains alone. Pure functions of
// pixel position, so the field is resolution-independent and
// deterministic (the GLSL twin lives in components/moirePass.ts
// and mirrors these expressions).
//
// Patterns (each in [0, 1], period = spacing px):
//   grid  — a 2D cosine lattice, wave(x) * wave(y)
//   lines — parallel cosine bands, wave(x)
//   rings — concentric cosine rings around the frame centre
// where wave(v) = 0.5 + 0.5 * cos(2π v / spacing).
//
// Honest scope: this is the pattern-product moire (two authored
// fields), not a sampling/aliasing moire — it does not simulate
// sensor or resampling interference.

export type MoirePatternKind = 'grid' | 'rings' | 'lines';

export function resolveMoirePattern(kind: string | undefined): MoirePatternKind {
  return kind === 'rings' || kind === 'lines' ? kind : 'grid';
}

export function resolveMoireSpacing(spacing: number): number {
  if (!Number.isFinite(spacing)) return 6;
  return Math.min(64, Math.max(2, spacing));
}

function wave(v: number, spacing: number, phase: number): number {
  return 0.5 + 0.5 * Math.cos(((Math.PI * 2) / spacing) * v + phase);
}

/** One pattern field at pixel (x, y); centre (cx, cy) is the
 *  rings centre (and the rotation pivot for the second field). */
export function moirePatternValue(
  kind: MoirePatternKind,
  x: number,
  y: number,
  spacing: number,
  phase: number,
  cx: number,
  cy: number,
): number {
  const s = resolveMoireSpacing(spacing);
  if (kind === 'lines') return wave(x, s, phase);
  if (kind === 'rings') {
    const r = Math.hypot(x - cx, y - cy);
    return wave(r, s, phase);
  }
  return wave(x, s, phase) * wave(y, s, 0);
}

/**
 * The moire interference field: pattern(x, y) multiplied by the
 * same pattern rotated by `angleDeg` around the centre and
 * shifted by `phase`. Angle 0 with phase 0 returns the pattern
 * squared (no beat bands — the honest degenerate case).
 */
export function moireValue(
  kind: MoirePatternKind,
  x: number,
  y: number,
  spacing: number,
  angleDeg: number,
  phase: number,
  cx: number,
  cy: number,
): number {
  const a = moirePatternValue(kind, x, y, spacing, 0, cx, cy);
  const rad = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const dx = x - cx;
  const dy = y - cy;
  const rx = cx + dx * ca - dy * sa;
  const ry = cy + dx * sa + dy * ca;
  const b = moirePatternValue(kind, rx, ry, spacing, phase, cx, cy);
  return a * b;
}

/** Modulate one tonal value by the moire field: mix 0 is the
 *  identity, mix 1 is a full multiplication by the field. */
export function moireModulate(
  value: number,
  kind: MoirePatternKind,
  x: number,
  y: number,
  spacing: number,
  angleDeg: number,
  phase: number,
  mix: number,
  cx: number,
  cy: number,
): number {
  const m = Math.min(1, Math.max(0, mix));
  if (m <= 0) return value;
  const f = moireValue(kind, x, y, spacing, angleDeg, phase, cx, cy);
  return value * (1 - m + m * f);
}
