// ── Composite blend (Phase AM) ─────────────────────────────────
// The CPU twin of components/compositePass.ts: the two-layer
// composite grammar (TouchDesigner Composite TOP) — the frame
// (A) blended with a second layer (B, an AF supply texture)
// under a blend-mode group. The pass mixes A toward blend(A, B)
// by the mix amount; with B not ready the pass is a bit-
// identical passthrough, and the stage only exists while the
// feature is enabled with a non-zero mix.

export type CompositeBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'difference'
  | 'add'
  | 'subtract';

export const COMPOSITE_BLEND_MODES: readonly CompositeBlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'difference',
  'add',
  'subtract',
] as const;

/** GLSL mode index of a blend mode (list order). */
export function compositeBlendModeIndex(mode: string): number {
  const idx = (COMPOSITE_BLEND_MODES as readonly string[]).indexOf(mode);
  return idx >= 0 ? idx : 0;
}

export function clampCompositeMix(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

type Rgb = readonly [number, number, number];

function blendChannel(a: number, b: number, mode: CompositeBlendMode): number {
  switch (mode) {
    case 'multiply':
      return a * b;
    case 'screen':
      return 1 - (1 - a) * (1 - b);
    case 'overlay':
      return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
    case 'soft-light': {
      // Pegtop soft light.
      const d = ((2 * b - 1) * (a - a * a) + a);
      return d;
    }
    case 'difference':
      return Math.abs(a - b);
    case 'add':
      return Math.min(1, a + b);
    case 'subtract':
      return Math.max(0, a - b);
    case 'normal':
    default:
      return b;
  }
}

/** blend(A, B) per channel (no mixing). */
export function compositeBlend(a: Rgb, b: Rgb, mode: CompositeBlendMode): [number, number, number] {
  return [
    blendChannel(a[0], b[0], mode),
    blendChannel(a[1], b[1], mode),
    blendChannel(a[2], b[2], mode),
  ];
}

/** The full composite: mix(A, blend(A, B), mix). */
export function compositeApply(
  a: Rgb,
  b: Rgb,
  mode: CompositeBlendMode,
  mix: number,
): [number, number, number] {
  const m = clampCompositeMix(mix);
  const blended = compositeBlend(a, b, mode);
  return [
    a[0] + (blended[0] - a[0]) * m,
    a[1] + (blended[1] - a[1]) * m,
    a[2] + (blended[2] - a[2]) * m,
  ];
}
