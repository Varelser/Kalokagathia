/**
 * Raster-mask Boolean composition (Phase BF): soft Boolean ops
 * over two luminance grids — A (the current raster mask map) and
 * B (the stored operand). The ops are the standard fuzzy-logic
 * forms, so on binary inputs they reproduce the exact Boolean
 * truth table, and on grey inputs they keep the antialiasing of
 * the captured grids:
 *
 *   union:        max(a, b)
 *   intersection: min(a, b)
 *   difference:   a * (1 - b)
 *   xor:          |a - b|
 *
 * Composition is a capture-time operation (the mask supplies are
 * capture-time too — Phase X / AE / AF / AF2): the UI stores the
 * operand grid in config and writes the combined grid back into
 * gpgpuMaskMap (+ a data URL into gpgpuMaskSource) when the user
 * presses the combine button. Nothing here runs per frame.
 *
 * Empty-B rule (B is the empty set): union(A, ∅) = A,
 * difference(A, ∅) = A, intersection(A, ∅) = ∅ (all zero),
 * xor(A, ∅) = A. An empty or malformed A yields null — there is
 * nothing to compose into.
 */

export type MaskBoolOp = 'union' | 'difference' | 'intersection' | 'xor';

export const MASK_BOOL_OPS: readonly MaskBoolOp[] = ['union', 'difference', 'intersection', 'xor'];

export function normalizeMaskBoolOp(value: unknown): MaskBoolOp {
  return value === 'difference' || value === 'intersection' || value === 'xor' ? value : 'union';
}

function isValidGrid(map: ArrayLike<number>, width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height)
    && width > 0 && height > 0
    && Math.floor(width) === width && Math.floor(height) === height
    && map.length >= width * height;
}

/**
 * Nearest-neighbour resample of a luminance grid. Returns an
 * empty Float32Array when either side's dimensions are invalid.
 */
export function resampleLumaNearest(
  src: ArrayLike<number>,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Float32Array {
  const dimsOk = (w: number, h: number) => Number.isFinite(w) && Number.isFinite(h)
    && w > 0 && h > 0 && Math.floor(w) === w && Math.floor(h) === h;
  if (!isValidGrid(src, sw, sh) || !dimsOk(dw, dh)) {
    return new Float32Array(0);
  }
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y / dh) * sh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x / dw) * sw));
      out[y * dw + x] = src[sy * sw + sx];
    }
  }
  return out;
}

/**
 * Combine luminance grid A (aw x ah) with operand grid B
 * (bw x bh, resampled to A's dimensions) under a soft Boolean
 * op. Returns null when A is empty or its dimensions are
 * invalid. B empty follows the empty-set rule documented above.
 * Inputs are clamped into [0, 1] defensively; outputs are
 * always within [0, 1] for inputs within [0, 1].
 */
export function combineLumaMaps(
  a: ArrayLike<number>,
  aw: number,
  ah: number,
  b: ArrayLike<number>,
  bw: number,
  bh: number,
  op: MaskBoolOp,
): Float32Array | null {
  if (!isValidGrid(a, aw, ah)) return null;
  const count = aw * ah;
  const out = new Float32Array(count);
  const bValid = isValidGrid(b, bw, bh);
  if (!bValid) {
    // B is the empty set.
    if (op === 'intersection') return out; // all zero
    for (let i = 0; i < count; i++) out[i] = Math.min(1, Math.max(0, a[i] || 0));
    return out;
  }
  const bGrid = bw === aw && bh === ah ? b : resampleLumaNearest(b, bw, bh, aw, ah);
  for (let i = 0; i < count; i++) {
    const av = Math.min(1, Math.max(0, a[i] || 0));
    const bv = Math.min(1, Math.max(0, bGrid[i] || 0));
    switch (op) {
      case 'difference': out[i] = av * (1 - bv); break;
      case 'intersection': out[i] = Math.min(av, bv); break;
      case 'xor': out[i] = Math.abs(av - bv); break;
      case 'union':
      default: out[i] = Math.max(av, bv); break;
    }
  }
  return out;
}
