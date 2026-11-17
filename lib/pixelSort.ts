// ── Pixel sort (Phase AM) ──────────────────────────────────────
// The CPU twin of components/pixelSortPass.ts: within the
// luminance span [low, high] of the ORIGINAL frame, pixels
// along a row (or column) are rearranged into ascending
// luminance order by odd-even transposition compare-exchange
// passes — the classic pixel-sort streaks. The sort is a pure
// function of the input frame (no state crosses frames), so a
// deterministic render reproduces it exactly. Pixels outside
// the span never move and act as barriers: swaps only happen
// between two in-span neighbours.

export function clampPixelSortThreshold(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

export function clampPixelSortPasses(v: number): number {
  if (!Number.isFinite(v)) return 24;
  return Math.max(1, Math.min(64, Math.round(v)));
}

/** Luminance of one RGB pixel (the post chain's coefficients). */
export function pixelSortLuma(r: number, g: number, b: number): number {
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function pixelSortInSpan(luma: number, low: number, high: number): boolean {
  return luma >= low && luma <= high;
}

export interface PixelSortPixel {
  r: number;
  g: number;
  b: number;
}

/**
 * One odd-even compare-exchange pass over a line of pixels.
 * `parity` 0 pairs (0,1), (2,3), …; parity 1 pairs (1,2),
 * (3,4), …. A pair swaps when both pixels are in the span and
 * their luminance order is descending. Mutates `pixels` (the
 * caller's array of pixel objects) and returns the swap count.
 * `lumas` is the ORIGINAL line luminance (span membership and
 * order are both judged on the frame being sorted; the pass
 * recomputes order from the current arrangement's luminance,
 * which the caller supplies per pass — for the twin, pass the
 * live luminance array and keep it in sync via the swaps).
 */
export function pixelSortPassOnLine(
  pixels: PixelSortPixel[],
  lumas: number[],
  low: number,
  high: number,
  parity: 0 | 1,
): number {
  let swaps = 0;
  for (let x = parity; x + 1 < pixels.length; x += 2) {
    const la = lumas[x];
    const lb = lumas[x + 1];
    if (!pixelSortInSpan(la, low, high) || !pixelSortInSpan(lb, low, high)) continue;
    if (la > lb) {
      const p = pixels[x];
      pixels[x] = pixels[x + 1];
      pixels[x + 1] = p;
      lumas[x] = lb;
      lumas[x + 1] = la;
      swaps += 1;
    }
  }
  return swaps;
}

/**
 * Sort one line fully (enough passes for the longest in-span
 * run): returns a new pixel array. Used by the tests to pin
 * the converged result the GPU iteration approaches.
 */
export function pixelSortLine(
  pixels: readonly PixelSortPixel[],
  low: number,
  high: number,
  passes: number,
): PixelSortPixel[] {
  const out = pixels.map((p) => ({ ...p }));
  const lumas = out.map((p) => pixelSortLuma(p.r, p.g, p.b));
  const n = clampPixelSortPasses(passes);
  for (let k = 0; k < n; k++) {
    pixelSortPassOnLine(out, lumas, low, high, (k % 2) as 0 | 1);
  }
  return out;
}
