/**
 * Escape-time fractal field (Phase AL).
 *
 * The reference implementation for the post stage in
 * components/fractalPass.ts: the GLSL twin iterates the same
 * recurrence (z -> z^2 + c) with the same smooth escape value
 * (nu = iter + 1 - log2(log|z|)), and the unit tests pin both the
 * classification (interior vs escaped) and the smooth values.
 *
 * Mapping to luminance is monochrome by design: the interior is
 * white (1), escaped points darken smoothly toward 0 as the escape
 * count falls — the same white/grey discipline as the rest of the
 * post stack.
 */

export type FractalKind = 'mandelbrot' | 'julia';

export interface FractalParams {
  kind: FractalKind;
  /** View centre in the complex plane. */
  centerX: number;
  centerY: number;
  /** Half-height of the view in complex units is 1.5 / zoom. */
  zoom: number;
  /** Iteration cap (clamped to 1..256). */
  iterations: number;
  /** Julia constant (only used for kind 'julia'). */
  juliaX: number;
  juliaY: number;
}

export const DEFAULT_FRACTAL_PARAMS: FractalParams = {
  kind: 'mandelbrot',
  centerX: -0.5,
  centerY: 0,
  zoom: 1,
  iterations: 64,
  juliaX: -0.8,
  juliaY: 0.156,
};

export function clampFractalIterations(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FRACTAL_PARAMS.iterations;
  return Math.max(1, Math.min(256, Math.floor(v)));
}

export function clampFractalZoom(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_FRACTAL_PARAMS.zoom;
  return Math.min(1000, Math.max(0.05, v));
}

/**
 * Smooth escape value for one point. Returns -1 for interior
 * points (never escaped within the iteration cap); otherwise the
 * fractional escape count nu in [0, iterations].
 *
 * For 'mandelbrot', (x, y) is the constant c and z starts at 0.
 * For 'julia', (x, y) is the starting z and c is the Julia
 * constant from the params.
 */
export function fractalEscape(x: number, y: number, params: FractalParams): number {
  const maxIter = clampFractalIterations(params.iterations);
  let zx: number;
  let zy: number;
  let cx: number;
  let cy: number;
  if (params.kind === 'julia') {
    zx = x; zy = y;
    cx = params.juliaX; cy = params.juliaY;
  } else {
    zx = 0; zy = 0;
    cx = x; cy = y;
  }
  for (let i = 0; i < maxIter; i++) {
    const nx = zx * zx - zy * zy + cx;
    const ny = 2 * zx * zy + cy;
    zx = nx; zy = ny;
    const r2 = zx * zx + zy * zy;
    if (r2 > 65536) {
      // |z| > 256: nu = i + 1 - log2(log|z|), the standard smooth
      // escape count (log|z| taken on the natural log, matching
      // the GLSL twin's log()).
      const nu = i + 1 - Math.log2(Math.log(Math.sqrt(r2)));
      return Math.max(0, nu);
    }
  }
  return -1;
}

/** Luminance for a smooth escape value: interior is 1 (white);
 *  escaped points fall off as sqrt(nu / iterations) so the first
 *  bands stay readable instead of crushing to black. */
export function fractalLuminance(nu: number, iterations: number): number {
  if (nu < 0) return 1;
  const t = Math.min(1, Math.max(0, nu / Math.max(1, iterations)));
  return 1 - Math.sqrt(t);
}

/**
 * Complex-plane coordinate for a frame UV (aspect-corrected: the
 * vertical half-extent is 1.5 / zoom, horizontal follows aspect).
 */
export function fractalPointForUv(
  u: number,
  v: number,
  aspect: number,
  params: FractalParams,
): [number, number] {
  const zoom = clampFractalZoom(params.zoom);
  const halfH = 1.5 / zoom;
  const halfW = halfH * (Number.isFinite(aspect) && aspect > 0 ? aspect : 1);
  return [
    params.centerX + (u - 0.5) * 2 * halfW,
    params.centerY + (v - 0.5) * 2 * halfH,
  ];
}
