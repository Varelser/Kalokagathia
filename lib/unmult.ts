// UnMult conversion for delivery exports (Pro-1.1, Method B — see
// ~/workspace/kalokagathia-pro/ALPHA_POSTFX_VERDICT.md).
//
// The scene is rendered exactly as usual — black background, the full
// PostFx chain — and only the captured frame is converted: the alpha
// channel is derived from the brightest colour channel through a
// smoothstep threshold curve, and the colour is stored
// non-premultiplied (straight), i.e. each channel is divided by the
// derived alpha. Compositing the result over black therefore
// reproduces the rendered frame (up to the threshold curve's cut and
// 8-bit clamping), while the glow around a particle becomes a soft,
// low-alpha halo instead of a hard-edged opaque blob — the delivery
// form an After Effects artist gets from Particular + UnMult.
//
// The threshold curve exists so that near-black noise and the faintest
// Bloom tails do not turn into alpha: anything at or below
// UNMULT_SMOOTHSTEP_LOW (in max-channel, 0..1 terms) becomes fully
// transparent, and the alpha reaches 1 at UNMULT_SMOOTHSTEP_HIGH.
// These two constants are the single place the curve is tuned; they
// are also recorded in the deterministic render manifest.

/** Max-channel value (0..1) at and below which alpha is 0. */
export const UNMULT_SMOOTHSTEP_LOW = 0.05;
/** Max-channel value (0..1) at and above which alpha is 1. */
export const UNMULT_SMOOTHSTEP_HIGH = 0.3;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** GLSL-style smoothstep between two edges, for a 0..1 input. */
export function smoothstep01(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Alpha (0..1) for one pixel whose channels are 0..255 bytes:
 * smoothstep applied to max(r, g, b).
 */
export function unmultAlpha01(red: number, green: number, blue: number): number {
  const maxChannel = Math.max(red, green, blue) / 255;
  return smoothstep01(UNMULT_SMOOTHSTEP_LOW, UNMULT_SMOOTHSTEP_HIGH, maxChannel);
}

/**
 * Convert a captured frame to UnMult form in place: alpha comes from
 * unmultAlpha01 and the colour channels are un-premultiplied by that
 * alpha (clamped to 255). Pixels whose derived alpha is 0 are written
 * as transparent black so no hidden colour leaks into compositors
 * that ignore alpha.
 */
export function applyUnmultToImageData(imageData: ImageData): ImageData {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = unmultAlpha01(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = Math.round(alpha * 255);
    if (alpha <= 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    } else {
      data[i] = Math.min(255, Math.round(data[i] / alpha));
      data[i + 1] = Math.min(255, Math.round(data[i + 1] / alpha));
      data[i + 2] = Math.min(255, Math.round(data[i + 2] / alpha));
    }
  }
  return imageData;
}
