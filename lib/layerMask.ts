/**
 * Layer Maps per-property resolution + raster mask logic (Phase X).
 *
 * Phase U gave Layer Maps per-property *amounts* over one shared
 * image. Phase X splits the image itself per property and adds a
 * raster mask grammar. This module holds the pure, deterministic
 * logic shared by the morph bake (lib/gpgpuMorphTargets.ts), the
 * layer media placement (components/particleData.ts) and the unit
 * tests; the GPU side (textures / shader discard) lives in
 * lib/mapImageTexture.ts and components/gpgpuShaderPoints.ts.
 *
 * Resolution rule (brief §0-3): a per-property source that is set
 * wins; an unset property falls back to the common map
 * (gpgpuGradImageSource). The legacy single-map configuration
 * therefore keeps exactly its Phase U meaning.
 *
 * Mask UV rule: normalized cloud coordinates [-1, 1] x [-1, 1] map
 * onto the mask image, x right, y up (image row 0 is the top, so
 * the row index runs against y). The draw shader's mask clip uses
 * the same rule through the world-XY map scale (world = normalized
 * * bounceRadius, so uv = world * (1 / (2 * bounceRadius)) + 0.5).
 */

export type GpgpuMaskMode = 'off' | 'clip' | 'shape';

export interface RasterMaskMap {
  map: ArrayLike<number>;
  width: number;
  height: number;
}

export interface RasterMaskOptions {
  mode: GpgpuMaskMode;
  /** Clip threshold on the (possibly inverted) luminance, [0, 1]. */
  threshold: number;
  invert: boolean;
}

/** Per-property source resolution: specific wins, '' falls back. */
export function resolveMapSource(specific: string, common: string): string {
  return specific ? specific : common;
}

export function clampMaskThreshold(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

export function normalizeMaskMode(value: unknown): GpgpuMaskMode {
  return value === 'clip' || value === 'shape' ? value : 'off';
}

/** A mask only acts when its mode is on AND a usable map exists. */
export function resolveActiveMask(
  mask: RasterMaskMap | null | undefined,
  options: RasterMaskOptions,
): (RasterMaskMap & RasterMaskOptions) | null {
  if (!mask || options.mode === 'off') return null;
  if (mask.width <= 0 || mask.height <= 0 || mask.map.length < mask.width * mask.height) return null;
  return {
    map: mask.map,
    width: mask.width,
    height: mask.height,
    mode: options.mode,
    threshold: clampMaskThreshold(options.threshold),
    invert: !!options.invert,
  };
}

/**
 * Luminance of the mask at normalized cloud coordinates (x, y in
 * [-1, 1], y up), with the invert flag applied. Coordinates outside
 * the square clamp to the edge texel. Returns 0 for a degenerate
 * map (callers gate on resolveActiveMask first).
 */
export function maskLumaAt(
  mask: RasterMaskMap,
  x: number,
  y: number,
  invert: boolean,
): number {
  const { map, width, height } = mask;
  if (width <= 0 || height <= 0 || map.length < width * height) return 0;
  const u = Math.max(0, Math.min(1, x * 0.5 + 0.5));
  const vUp = Math.max(0, Math.min(1, y * 0.5 + 0.5));
  const px = Math.min(width - 1, Math.floor(u * width));
  const py = Math.min(height - 1, Math.floor((1 - vUp) * height));
  const raw = map[py * width + px] ?? 0;
  return invert ? 1 - raw : raw;
}

/** Clip acceptance: the (inverted) luminance clears the threshold. */
export function maskAcceptsAt(
  mask: RasterMaskMap & RasterMaskOptions,
  x: number,
  y: number,
): boolean {
  return maskLumaAt(mask, x, y, mask.invert) >= mask.threshold;
}

/**
 * Shape sampling (mode 'shape'): draw one point of the mask shape
 * by seeded acceptance sampling — a uniformly drawn pixel is kept
 * with probability equal to its (inverted) luminance, so bright
 * regions fill densely and dark regions stay empty, exactly like
 * the media sampler's threshold rule but probabilistic. The point
 * lands in the XY plane with the media relief convention
 * (z = (luma - 0.5) * 0.35). Deterministic for a given rng
 * sequence; returns null when no pixel was accepted within
 * `attempts` draws (blank / fully inverted masks).
 */
export function sampleMaskShapePoint(
  mask: RasterMaskMap & RasterMaskOptions,
  rng: () => number,
  attempts = 24,
): { x: number; y: number; z: number; luma: number } | null {
  const { map, width, height } = mask;
  if (width <= 0 || height <= 0 || map.length < width * height) return null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const px = Math.min(width - 1, Math.floor(rng() * width));
    const py = Math.min(height - 1, Math.floor(rng() * height));
    const raw = map[py * width + px] ?? 0;
    const luma = mask.invert ? 1 - raw : raw;
    if (rng() <= luma) {
      return {
        x: (((px + 0.5) / width) * 2 - 1) * 1.15,
        y: (1 - ((py + 0.5) / height) * 2) * 1.15 * (height / width),
        z: (luma - 0.5) * 0.35,
        luma,
      };
    }
  }
  return null;
}
