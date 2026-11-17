// ── Text on path (Phase AF2) ───────────────────────────────────
// The layer-2 TextMap string laid out glyph by glyph along the
// authored morph path: each character's luma raster becomes a
// block of particles centred on the path, in reading order — the
// After Effects "text on a path" grammar expressed in this app's
// particle bake. Pure helpers live here; the bake branch in
// lib/gpgpuMorphTargets.ts and the per-glyph raster extraction
// in components/useGpgpuRuntime.ts build on them.
//
// Layout model (deterministic, no RNG in the slot assignment):
// the path is divided into VIRTUAL SLOTS. With G glyphs and a
// per-glyph delay d, the slot count is V = G + d·(G − 1): glyph g
// owns virtual slot [g·(1 + d), g·(1 + d) + 1), and the slots in
// between are gaps. A particle whose path parameter p lands in a
// glyph slot is placed inside that glyph's raster; a particle in
// a gap keeps the plain path placement (the path line shows
// through between separated glyphs). At d = 0 there are no gaps
// and the string tiles the whole path evenly. Because a writeOn
// window sweep reaches later slots later, the delay reads as a
// per-character stagger when the window is animated.
//
// Glyph rasters are square luma grids (row 0 = top, values 0..1),
// one per character, extracted with the same TextMap settings the
// 'text' morph target uses — each character is centred in its own
// cell, so advance widths are uniform (a monospace-style layout).

/** One character's luma raster: square grid, row 0 = top. */
export interface TextGlyphRaster {
  map: ArrayLike<number>;
  size: number;
}

/** Split a string into layout characters (code points, so
 *  surrogate pairs stay intact). Newlines become spaces — the
 *  layout is a single line along the path. */
export function splitTextOnPathGlyphs(text: string): string[] {
  return Array.from(text ?? '').map((ch) => (ch === '\n' || ch === '\r' ? ' ' : ch));
}

export function clampTextOnPathDelay(delay: number): number {
  if (!Number.isFinite(delay)) return 0;
  return Math.max(0, Math.min(3, delay));
}

/** Total virtual slots for G glyphs at the given delay. */
export function textOnPathVirtualSlots(glyphCount: number, delay: number): number {
  const g = Math.max(1, Math.floor(glyphCount));
  return g + clampTextOnPathDelay(delay) * (g - 1);
}

export interface TextOnPathSlotHit {
  /** Glyph index, or -1 when p falls in a delay gap. */
  glyph: number;
  /** Position inside the glyph slot, 0..1 (glyph hits only). */
  u: number;
}

/**
 * Map a path parameter p ∈ [0, 1] onto the virtual slot layout.
 * Glyph hits report the glyph index and the intra-slot fraction;
 * gap hits report glyph −1.
 */
export function textOnPathSlotAt(p: number, glyphCount: number, delay: number): TextOnPathSlotHit {
  const g = Math.max(1, Math.floor(glyphCount));
  const d = clampTextOnPathDelay(delay);
  const v = Math.max(0, Math.min(1, p)) * textOnPathVirtualSlots(g, d);
  const stride = 1 + d;
  const glyph = Math.min(g - 1, Math.floor(v / stride));
  const u = v - glyph * stride;
  if (u > 1) return { glyph: -1, u: 0 };
  return { glyph, u };
}

/** The path parameter at the START of glyph g's slot. */
export function textOnPathGlyphStart(glyph: number, glyphCount: number, delay: number): number {
  const g = Math.max(1, Math.floor(glyphCount));
  const d = clampTextOnPathDelay(delay);
  return (glyph * (1 + d)) / textOnPathVirtualSlots(g, d);
}

/** The path parameter of a point inside glyph g at the glyph's
 *  own horizontal fraction lx (0 = the glyph's left edge). */
export function textOnPathGlyphS(
  glyph: number,
  lx: number,
  glyphCount: number,
  delay: number,
): number {
  const g = Math.max(1, Math.floor(glyphCount));
  const d = clampTextOnPathDelay(delay);
  const u = Math.max(0, Math.min(1, lx));
  return (glyph * (1 + d) + u) / textOnPathVirtualSlots(g, d);
}

/** Luma threshold of the media grammar (sampleMediaPoint). */
export const TEXT_GLYPH_LUMA_THRESHOLD = 0.3;

/**
 * Sample one lit point of a glyph raster with the media grammar:
 * uniform cell picks accepted at the luma threshold, up to 24
 * attempts. Returns the cell-centre fractions (lx right, ly
 * DOWN from the top row), or null when the glyph has no lit cell
 * (a space, or an uninked character).
 */
export function sampleTextGlyphPoint(
  glyph: TextGlyphRaster,
  rng: () => number,
): { lx: number; ly: number } | null {
  const size = Math.floor(glyph.size);
  if (size <= 0 || glyph.map.length < size * size) return null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const px = Math.min(size - 1, Math.floor(rng() * size));
    const py = Math.min(size - 1, Math.floor(rng() * size));
    const luma = glyph.map[py * size + px] ?? 0;
    if (luma >= TEXT_GLYPH_LUMA_THRESHOLD) {
      return { lx: (px + 0.5) / size, ly: (py + 0.5) / size };
    }
  }
  return null;
}

/** Does the glyph raster have any lit cell at all? */
export function textGlyphHasInk(glyph: TextGlyphRaster): boolean {
  const size = Math.floor(glyph.size);
  if (size <= 0 || glyph.map.length < size * size) return false;
  for (let i = 0; i < size * size; i++) {
    if ((glyph.map[i] ?? 0) >= TEXT_GLYPH_LUMA_THRESHOLD) return true;
  }
  return false;
}
