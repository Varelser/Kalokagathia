// lib/trailAlpha.ts
// Phase DP: normalised tube layer alphas (rule b2).
//
// The GPGPU tube trails draw one additive mesh per history layer.
// The legacy per-layer alpha was fade^(i+1) * tubeOpacity, whose sum
// over the visible layers is tubeOpacity * Σ fade^(i+1) — for
// coverage-050 (fade ≈ 0.71, 6 layers, opacity 0.6) that is ≈ 1.28,
// so a single particle's tube stack already saturates overlapping
// pixels to white before any cross-particle overlap. Rule b2
// divides by the fade-weight sum S so the stack total equals
// tubeOpacity exactly, preserving the fade profile (newer layers
// brighter) at any trail length. S is computed from the live fade
// and layer count, never baked in as a constant.

/** Σ_{i<layers} fade^(i+1) — the b2 normalisation denominator. */
export function trailFadeLayerSum(fade: number, layers: number): number {
  let s = 0;
  for (let i = 0; i < layers; i++) s += Math.pow(fade, i + 1);
  return s;
}

/**
 * Normalised alpha for tube layer `layerIndex` (0 = newest).
 * Layers at or past `layers` contribute 0. A zero weight sum
 * (fade = 0) yields 0 rather than a division by zero.
 */
export function tubeLayerAlpha(
  fade: number,
  layerIndex: number,
  layers: number,
  opacity: number,
): number {
  if (layerIndex >= layers) return 0;
  const s = trailFadeLayerSum(fade, layers);
  return s > 0 ? (Math.pow(fade, layerIndex + 1) * opacity) / s : 0;
}

/**
 * Draw thinning (Phase DP, shipped form): how many of the active
 * particles get tube/ribbon trail geometry. The trail geometries
 * are laid out in particle order, so a prefix count is a drawRange
 * size. fraction 1 (the default) draws every active particle —
 * the pre-DP behaviour; smaller fractions cut the additive
 * overlap that saturates dense presets to white. The fraction is
 * clamped to [0, 1] and the count floored.
 */
export function trailDrawCount(activeCount: number, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.floor(activeCount * f);
}

/**
 * Rule b1 (Phase DP fallback, measured after b2): the legacy
 * per-layer alpha divided by the visible layer count, so the
 * stack total is tubeOpacity * S / layers (≈0.214 for
 * coverage-050, vs b2's 0.6 and the legacy 1.283).
 */
export function tubeLayerAlphaB1(
  fade: number,
  layerIndex: number,
  layers: number,
  opacity: number,
): number {
  if (layerIndex >= layers || layers <= 0) return 0;
  return (Math.pow(fade, layerIndex + 1) * opacity) / layers;
}
