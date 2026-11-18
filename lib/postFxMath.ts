/**
 * Post grade math (Phase AD): the pure CPU twins of the tone /
 * edge / displace post passes. Every function here is mirrored
 * expression-for-expression by the GLSL in components/toneGrade
 * Passes.ts, components/edgeDetectPass.ts and
 * components/displacePass.ts, so the unit tests that pin these
 * formulas also pin the shaders (plus the source-level wiring
 * checks). All functions are pure and position-explicit, which is
 * what makes the passes resolution- and export-independent: the
 * same pixel coordinates give the same result in the live view,
 * the deterministic render and the PNG export.
 */

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Posterize levels are clamped to a sane print range. */
export function normalizePosterizeLevels(levels: number): number {
  if (!Number.isFinite(levels)) return 8;
  return Math.min(64, Math.max(2, Math.round(levels)));
}

/**
 * Posterize quantization: floor(v * levels) / (levels - 1),
 * clamped to 1. With levels = 256 this is (visually) a pass-
 * through; the stage is only inserted while enabled, so the
 * default-off state never runs it at all.
 */
export function posterizeValue(value: number, levels: number): number {
  const l = normalizePosterizeLevels(levels);
  return clamp01(Math.floor(clamp01(value) * l) / Math.max(1, l - 1));
}

/** Bayer 4x4 ordered-dither matrix (values 0..15). */
export const BAYER_4X4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

export function bayerThreshold(x: number, y: number): number {
  const ix = ((Math.floor(x) % 4) + 4) % 4;
  const iy = ((Math.floor(y) % 4) + 4) % 4;
  return (BAYER_4X4[iy * 4 + ix] + 0.5) / 16;
}

/** Fixed internal step count for the dither quantizer. */
export const DITHER_STEPS = 7;

/**
 * Ordered dither: quantize to DITHER_STEPS with the Bayer
 * threshold shifting the rounding point by up to half a step
 * (scaled by strength). Strength 0 is a plain round-to-nearest
 * quantization; strength 1 is the classic ordered pattern.
 */
export function ditherValue(value: number, x: number, y: number, strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  const t = bayerThreshold(x, y);
  return clamp01(Math.floor(clamp01(value) * DITHER_STEPS + 0.5 + (t - 0.5) * s) / DITHER_STEPS);
}

/** Dither modes (Phase AW): the Phase AD ordered dither and the
 *  error-diffusion approximation below. */
export type DitherMode = 'bayer' | 'diffusion';

export function resolveDitherMode(mode: string | undefined): DitherMode {
  return mode === 'diffusion' ? 'diffusion' : 'bayer';
}

/**
 * Floyd–Steinberg weights for the already-scanned neighbours —
 * the error a true sequential diffusion would have pushed INTO
 * the current pixel from those neighbours. The scan runs
 * top-to-bottom in texture space, so the neighbours are, in
 * weight order: (-1, +1), (-1, 0), (0, +1), (+1, +1) — the same
 * offsets the shader samples.
 */
export const FS_NEIGHBOR_WEIGHTS: readonly number[] = [7 / 16, 3 / 16, 5 / 16, 1 / 16];

/** Quantization error of one value at the dither step count. */
export function quantizationError(value: number): number {
  const v = clamp01(value);
  return v - Math.round(v * DITHER_STEPS) / DITHER_STEPS;
}

/**
 * Error-diffusion APPROXIMATION (Phase AW): a fragment shader
 * cannot run the sequential Floyd–Steinberg scan (each pixel
 * depends on the accumulated error of its predecessors), so the
 * pass estimates the incoming error from the already-scanned
 * neighbours' own quantization errors, weighted by the FS
 * kernel, one tap deep:
 *
 *   estErr = Σ wᵢ · quantizationError(neighbourᵢ)
 *   out    = quantize(value + estErr · strength)
 *
 * This reproduces the diffusion look (error pushed into flat
 * areas breaks them into the characteristic worm patterns) but
 * it is NOT a true sequential diffusion: the estimate does not
 * chain (a neighbour's own incoming error is not included), so
 * long-range error transport differs. `neighborErrors` are the
 * four FS neighbours' quantization errors in the weight order
 * above; missing neighbours (frame edges) contribute 0.
 */
export function errorDiffusionValue(
  value: number,
  neighborErrors: readonly number[],
  strength: number,
): number {
  const s = Math.min(1, Math.max(0, strength));
  let est = 0;
  for (let i = 0; i < FS_NEIGHBOR_WEIGHTS.length; i++) {
    est += FS_NEIGHBOR_WEIGHTS[i] * (neighborErrors[i] ?? 0);
  }
  const v = clamp01(value) + est * s;
  return clamp01(Math.floor(v * DITHER_STEPS + 0.5) / DITHER_STEPS);
}

/** Mode-dispatching twin of the dither pass: 'bayer' delegates
 *  to ditherValue verbatim; 'diffusion' uses the approximation
 *  (the caller supplies the neighbour errors). */
export function ditherValueMode(
  mode: DitherMode,
  value: number,
  x: number,
  y: number,
  strength: number,
  neighborErrors: readonly number[] = [],
): number {
  if (mode === 'diffusion') return errorDiffusionValue(value, neighborErrors, strength);
  return ditherValue(value, x, y, strength);
}

export function normalizeHalftoneCellSize(cellSize: number): number {
  if (!Number.isFinite(cellSize)) return 8;
  return Math.min(64, Math.max(3, cellSize));
}

/**
 * Halftone screen: rotate the pixel position by the screen
 * angle, take the distance to the current cell centre, and emit
 * a dot whose radius grows with luminance (bright areas become
 * large white dots — the frame is mostly dark, so the screen
 * reads as print dots of light). One cell of soft edge keeps the
 * dots anti-aliased. Returns the dot mask in [0, 1].
 *
 * The `luma` fed in here is the CELL's tone (the pass averages
 * taps around the cell centre), never the pixel's own luma:
 * a screen sizes one dot per cell, and per-pixel luma would let
 * sparse content draw its own shape instead of a lattice dot.
 */
export function halftoneDot(luma: number, x: number, y: number, cellSize: number, angleDeg: number): number {
  const size = normalizeHalftoneCellSize(cellSize);
  const angle = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = x * cos - y * sin;
  const ry = x * sin + y * cos;
  const cx = (Math.floor(rx / size) + 0.5) * size;
  const cy = (Math.floor(ry / size) + 0.5) * size;
  const dist = Math.hypot(rx - cx, ry - cy);
  const radius = clamp01(luma) * size * Math.SQRT1_2;
  const t = Math.min(1, Math.max(0, (radius + 0.75 - dist) / 1.5));
  const dot = t * t * (3 - 2 * t);
  // The symmetric AA band around the dot edge would leave a
  // half-lit centre pixel even at radius 0 (pure black would
  // grow faint dots), so sub-pixel dots fade out with radius.
  return dot * Math.min(1, Math.max(0, radius * 2));
}

/**
 * Sobel gradient magnitude over a 3x3 luminance neighbourhood
 * (row-major, centre at index 4). The pass thresholds this
 * value; the TS twin exists so the kernel weights are pinned
 * by tests, not just by the shader text.
 */
export function sobelMagnitude(n: readonly number[]): number {
  const gx =
    -n[0] - 2 * n[3] - n[6] +
    n[2] + 2 * n[5] + n[8];
  const gy =
    -n[0] - 2 * n[1] - n[2] +
    n[6] + 2 * n[7] + n[8];
  return Math.hypot(gx, gy) / 4;
}

export type DisplaceChannel = 'red-green' | 'luma' | 'red' | 'green' | 'blue';

export const DISPLACE_CHANNELS: readonly DisplaceChannel[] = ['red-green', 'luma', 'red', 'green', 'blue'];

/**
 * Pick the (x, y) displacement pair from a source texel. The
 * default 'red-green' mirrors TouchDesigner Displace (R drives
 * X, G drives Y); a single channel drives both axes diagonally.
 * The pass subtracts 0.5, so mid-grey means "no shift".
 */
export function pickDisplacePair(r: number, g: number, b: number, channel: DisplaceChannel): [number, number] {
  switch (channel) {
    case 'red':
      return [r, r];
    case 'green':
      return [g, g];
    case 'blue':
      return [b, b];
    case 'luma': {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return [l, l];
    }
    case 'red-green':
    default:
      return [r, g];
  }
}

export function displaceChannelIndex(channel: DisplaceChannel): number {
  const idx = DISPLACE_CHANNELS.indexOf(channel);
  return idx >= 0 ? idx : 0;
}
