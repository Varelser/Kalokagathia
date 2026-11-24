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

import {
  layoutTextColumnsTokenized,
  type TextColumnAdjustments,
} from './textColumnLayout';

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

// ── Vertical text on path (Phase 17) ───────────────────────────
// The vertical counterpart of the single-line layout above: the
// string is planned as COLUMNS by the shared vertical layout
// (lib/textColumnLayout.ts — the same tokeniser the TextMap
// raster uses, so tate-chu-yoko runs fold into one cell and ruby
// markup parses exactly as there; the meaning is not
// re-implemented here). Reading order along the path is column
// by column — column 0 first (the rightmost column of the page
// layout, holding the head of the text), inside a column top →
// bottom. A newline in the source starts a new column, exactly
// as in the page layout.
//
// In the bake, a vertical glyph's LOCAL axes map differently
// from the horizontal layout: the glyph's vertical axis lies
// along the path tangent with the glyph's top toward the START
// of the path (against the direction of travel), so the sampled
// vertical fraction (ly) drives the path parameter and the
// horizontal fraction (lx) drives the normal offset — the glyph
// stands upright relative to the path's progression instead of
// lying across it.

/** One cell of the vertical plan: a single glyph, a whole
 *  tate-chu-yoko run (one cell), or one glyph of a ruby parent
 *  group (its `ruby` annotation rides on the group's first
 *  unit). Ruby glyphs themselves are not separate units — the
 *  annotation is carried in the plan, shared with the TextMap
 *  layout, but the path bake places the parent cells only. */
export interface TextOnPathVerticalUnit {
  /** The cell's text (a run's whole string for tate-chu-yoko). */
  text: string;
  /** Horizontal squeeze of the cell (tate-chu-yoko runs,
   *  Phase 30), if any. */
  squeeze?: number;
  /** Ruby annotation of this unit's parent group, if any. */
  ruby?: string;
  /** Column (段) index, 0 = the head column (rightmost on a page). */
  column: number;
  /** Cell index inside the column, 0 = top. */
  index: number;
}

export interface TextOnPathVerticalPlan {
  units: TextOnPathVerticalUnit[];
  columnCount: number;
}

/**
 * Plan a string for vertical text on a path: tokenise and split
 * it into columns with the shared vertical layout, then flatten
 * the columns in reading order (column 0 first, top → bottom
 * inside a column). `columnLength` and `adjustments` are the
 * TextMap vertical settings (kinsoku adjusts wrap boundaries,
 * tatechuyoko / ruby switch the token grammar on).
 */
export function planVerticalTextOnPath(
  text: string,
  columnLength: number,
  adjustments?: TextColumnAdjustments,
): TextOnPathVerticalPlan {
  const columns = layoutTextColumnsTokenized(text || '', columnLength, adjustments);
  const units: TextOnPathVerticalUnit[] = [];
  columns.forEach((tokens, column) => {
    tokens.forEach((token, index) => {
      const unit: TextOnPathVerticalUnit = { text: token.text, column, index };
      if (token.squeeze !== undefined) unit.squeeze = token.squeeze;
      if (token.ruby !== undefined) unit.ruby = token.ruby;
      units.push(unit);
    });
  });
  return { units, columnCount: columns.length };
}

// ── Per-glyph deformation (Phase AM) ───────────────────────────
// The per-character transform grammar the 2D audit §2 row asked
// for next to the AF2 stagger: each glyph gets a deterministic
// scale / rotation / fade drawn from its INDEX by an integer
// hash — no RNG draws, so the bake's consumption order is
// untouched and the same string always deforms the same way.
// All three amounts at 0 resolve to the identity transform, and
// the bake only consults this while a deform option is present.

export interface TextGlyphDeform {
  /** Local scale multiplier around the glyph centre. */
  scale: number;
  /** Local rotation, radians (raster space: x right, y down). */
  angle: number;
  /** 0..1: probability that a particle of this glyph falls
   *  back to the plain path placement (density fade — the bake
   *  has no per-particle opacity channel; its alpha is the
   *  replica phase's). */
  fade: number;
}

/** Integer hash → three stable uniforms in [0, 1) for a glyph. */
function glyphHash3(index: number): [number, number, number] {
  let h = Math.imul((index | 0) + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  const u1 = (h >>> 0) / 4294967296;
  let h2 = Math.imul(h ^ 0x27d4eb2d, 0x165667b1);
  h2 = Math.imul(h2 ^ (h2 >>> 15), 0x85ebca6b);
  h2 ^= h2 >>> 13;
  const u2 = (h2 >>> 0) / 4294967296;
  let h3 = Math.imul(h2 ^ 0x9e3779b1, 0x27d4eb2d);
  h3 = Math.imul(h3 ^ (h3 >>> 15), 0x85ebca6b);
  h3 ^= h3 >>> 13;
  const u3 = (h3 >>> 0) / 4294967296;
  return [u1, u2, u3];
}

export function clampGlyphScaleVar(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampGlyphRotateDeg(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(180, v));
}

export function clampGlyphFadeVar(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * The deform of one glyph. Scale varies within ±75% of the
 * scale-variation amount, rotation within ±rotateDeg, fade is
 * the variation amount scaled by the glyph's own uniform (so
 * fade only ever thins a glyph, never the whole string at once
 * unless the amount is 1 and the uniform near 1).
 */
export function textGlyphDeform(
  glyphIndex: number,
  scaleVar: number,
  rotateDeg: number,
  fadeVar: number,
): TextGlyphDeform {
  const sv = clampGlyphScaleVar(scaleVar);
  const rd = clampGlyphRotateDeg(rotateDeg);
  const fv = clampGlyphFadeVar(fadeVar);
  if (sv <= 0 && rd <= 0 && fv <= 0) return { scale: 1, angle: 0, fade: 0 };
  const [u1, u2, u3] = glyphHash3(Math.max(0, Math.floor(glyphIndex)));
  return {
    scale: 1 + sv * (u1 * 2 - 1) * 0.75,
    angle: ((rd * Math.PI) / 180) * (u2 * 2 - 1),
    fade: fv * u3,
  };
}

/**
 * Apply a glyph deform to a sampled glyph-local point: rotate
 * and scale (lx, ly) around the cell centre (0.5, 0.5). The
 * identity deform returns the inputs untouched.
 */
export function deformGlyphPoint(
  lx: number,
  ly: number,
  deform: TextGlyphDeform,
): { lx: number; ly: number } {
  if (deform.scale === 1 && deform.angle === 0) return { lx, ly };
  const cx = lx - 0.5;
  const cy = ly - 0.5;
  const cos = Math.cos(deform.angle);
  const sin = Math.sin(deform.angle);
  const rx = (cx * cos - cy * sin) * deform.scale;
  const ry = (cx * sin + cy * cos) * deform.scale;
  return { lx: 0.5 + rx, ly: 0.5 + ry };
}

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
