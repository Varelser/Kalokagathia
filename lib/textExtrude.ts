// Phase 17 stage 3: text extrusion — turn a string set in an
// uploaded font into a holed solid through the stage-2
// CrossSection path (lib/csg.ts runCrossSectionExtrude).
//
// Pipeline (this module owns everything up to the worker):
//   font bytes (opentype.js) -> per-glyph outline paths
//   -> glyphs laid out by advance width + kerning, in em units
//      (lines split on \n, fixed line height)
//   -> outlines flattened to polylines with an adaptive
//      subdivision whose tolerance is the flatness parameter
//   -> the polylines are written as one SVG document and parsed
//      back through the stage-2 svgTextToContours, so the
//      contours land in the same normalised morph space
//      ([-1, 1]^2, y up, span = max(w, h)) as every other vector
//      consumer, and classifyContours normalises island / hole
//      winding in the single place that normalisation lives.
// The worker then extrudes the classified contours through
// CrossSection (EvenOdd), with its acceptance re-verification —
// the existing simple-polygon Manifold.extrude path and its
// validation are untouched, exactly as spike 2 prescribed.
//
// Determinism: the font byte stream is the input that fixes the
// outlines (an OS font name would make the shape depend on the
// machine). The font bytes are held in session memory ONLY —
// they are never written to the config, so a preset that names
// a text-extrude string reproduces its shape only after the
// same font file is loaded again (the UI states this).
//
// Nothing here imports the CSG client or three, so the module
// runs under the plain-node test loader unchanged.

import opentype, { type Font, type Glyph, type PathCommand } from 'opentype.js';
import { PATH_ARC_EPSILON } from './pathGeometry';
import {
  classifyContours,
  svgTextToContours,
  type VectorContour,
} from './vectorBoolean';

/** Default curve flattening tolerance. The number is the
 *  existing flattening default of the path pipeline
 *  (PATH_ARC_EPSILON in lib/pathGeometry.ts); here it is
 *  interpreted in glyph space (em units, 1 = unitsPerEm),
 *  because the subdivision runs on glyph outlines before the
 *  SVG normalisation, not on document coordinates. */
export const TEXT_EXTRUDE_DEFAULT_FLATNESS = PATH_ARC_EPSILON;

/** Fixed line height for multi-line text, in em. A fixed model
 *  (not the font's line metrics) keeps the layout a pure
 *  function of the string and the glyph advances. */
export const TEXT_EXTRUDE_LINE_HEIGHT_EM = 1.2;

/** Upper bound on the total flattened contour vertices handed
 *  to the worker. Past this the 5 s CSG timeout and the morph
 *  OBJ text size both become unrealistic; the layout refuses
 *  with a reason instead of timing out downstream. */
export const TEXT_EXTRUDE_MAX_CONTOUR_POINTS = 250_000;

export interface TextExtrudeFontInfo {
  familyName: string;
  styleName: string;
  unitsPerEm: number;
}

export type ParseTextExtrudeFontResult =
  | { ok: true; font: Font; info: TextExtrudeFontInfo }
  | { ok: false; reason: string };

function nameOf(font: Font, key: string): string {
  // opentype.js v2: names are stored per platform; the
  // supported accessor is getEnglishName. (The v1-style
  // font.names[key].en record no longer exists.)
  try {
    return font.getEnglishName(key) ?? '';
  } catch {
    return '';
  }
}

/** Parse font bytes (TTF / OTF) with opentype.js. Any failure —
 *  not a font, a font collection, a format opentype.js does not
 *  support (e.g. WOFF2) — is refused with a reason; nothing is
 *  repaired or substituted. */
export function parseTextExtrudeFont(buffer: ArrayBuffer): ParseTextExtrudeFontResult {
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, reason: 'フォントファイルが空です。' };
  }
  let font: Font;
  try {
    font = opentype.parse(buffer);
  } catch {
    return {
      ok: false,
      reason: 'フォントとして読み取れませんでした。対応形式は TTF / OTF です（WOFF2 やフォントコレクション（.ttc）は読み込めません）。',
    };
  }
  if (!font || !(font.unitsPerEm > 0)) {
    return { ok: false, reason: 'フォントの基本情報（unitsPerEm）が取得できませんでした。' };
  }
  return {
    ok: true,
    font,
    info: {
      familyName: nameOf(font, 'fontFamily'),
      styleName: nameOf(font, 'fontSubfamily'),
      unitsPerEm: font.unitsPerEm,
    },
  };
}

/** File-name gate for the UI: only .ttf / .otf are offered to
 *  the parser. */
export function isTextExtrudeFontFileName(name: string): boolean {
  return /\.(ttf|otf)$/i.test(name);
}

// ---------------------------------------------------------------------------
// Outline flattening (adaptive subdivision, pathGeometry's metric)
// ---------------------------------------------------------------------------

type Pt = [number, number];

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

const FLATTEN_MAX_DEPTH = 12;

function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function quadPoint(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

function flattenCubic(out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, depth: number): void {
  let maxDev = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const q = cubicPoint(p0, p1, p2, p3, t);
    const d = distToSegment(q[0], q[1], p0, p3);
    if (d > maxDev) maxDev = d;
  }
  if (maxDev <= tol || depth >= FLATTEN_MAX_DEPTH) {
    out.push(p3);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const m23: Pt = [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2];
  const m012: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  const m123: Pt = [(m12[0] + m23[0]) / 2, (m12[1] + m23[1]) / 2];
  const mid: Pt = [(m012[0] + m123[0]) / 2, (m012[1] + m123[1]) / 2];
  flattenCubic(out, p0, m01, m012, mid, tol, depth + 1);
  flattenCubic(out, mid, m123, m23, p3, tol, depth + 1);
}

function flattenQuad(out: Pt[], p0: Pt, p1: Pt, p2: Pt, tol: number, depth: number): void {
  let maxDev = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const q = quadPoint(p0, p1, p2, t);
    const d = distToSegment(q[0], q[1], p0, p2);
    if (d > maxDev) maxDev = d;
  }
  if (maxDev <= tol || depth >= FLATTEN_MAX_DEPTH) {
    out.push(p2);
    return;
  }
  const m01: Pt = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const m12: Pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const mid: Pt = [(m01[0] + m12[0]) / 2, (m01[1] + m12[1]) / 2];
  flattenQuad(out, p0, m01, mid, tol, depth + 1);
  flattenQuad(out, mid, m12, p2, tol, depth + 1);
}

/** Flatten one glyph's path commands into closed subpaths
 *  (polylines, in the glyph's y-down em coordinates). Open
 *  subpaths (no Z) are kept as-is minus the closing point —
 *  the downstream closed-contour filter drops them. */
export function flattenGlyphCommands(commands: readonly PathCommand[], flatness: number): Pt[][] {
  const subpaths: Pt[][] = [];
  let current: Pt[] | null = null;
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  const flush = () => {
    if (current && current.length > 0) subpaths.push(current);
    current = null;
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M': {
        flush();
        cur = [cmd.x ?? 0, cmd.y ?? 0];
        start = cur;
        current = [cur];
        break;
      }
      case 'L': {
        if (!current) { current = [cur]; start = cur; }
        cur = [cmd.x ?? 0, cmd.y ?? 0];
        current.push(cur);
        break;
      }
      case 'C': {
        if (!current) { current = [cur]; start = cur; }
        const p1: Pt = [cmd.x1 ?? 0, cmd.y1 ?? 0];
        const p2: Pt = [cmd.x2 ?? 0, cmd.y2 ?? 0];
        const p3: Pt = [cmd.x ?? 0, cmd.y ?? 0];
        flattenCubic(current, cur, p1, p2, p3, flatness, 0);
        cur = p3;
        break;
      }
      case 'Q': {
        if (!current) { current = [cur]; start = cur; }
        const p1: Pt = [cmd.x1 ?? 0, cmd.y1 ?? 0];
        const p2: Pt = [cmd.x ?? 0, cmd.y ?? 0];
        flattenQuad(current, cur, p1, p2, flatness, 0);
        cur = p2;
        break;
      }
      case 'Z': {
        cur = start;
        break;
      }
    }
  }
  flush();
  return subpaths;
}

// ---------------------------------------------------------------------------
// Layout: string -> classified contours in normalised morph space
// ---------------------------------------------------------------------------

export interface TextExtrudeLayout {
  /** Classified contours (islands CCW, holes CW) in normalised
   *  morph space — ready for runCrossSectionExtrude. */
  contours: VectorContour[];
  islandCount: number;
  holeCount: number;
  /** Net area (islands − holes) in normalised units. */
  netArea: number;
  /** Glyphs that produced at least one closed outline. */
  glyphCount: number;
  lineCount: number;
  /** Widest line advance, in em (before normalisation). */
  advanceEm: number;
  /** The generated SVG document (the exact text the contours
   *  were parsed from; kept for determinism checks). */
  svgText: string;
  /** Total flattened contour vertices. */
  pointCount: number;
}

export type TextExtrudeLayoutResult =
  | { ok: true; layout: TextExtrudeLayout }
  | { ok: false; reason: string };

function fmtNum(v: number): string {
  // Shortest round-trip form: reparsing reproduces the exact
  // double, so the contour set is a pure function of the input.
  return String(v);
}

/**
 * Lay out a string in the given font and return its classified
 * contours. Advances and kerning come from the font itself (in
 * em units); lines are split on \n and stacked with the fixed
 * line height. The outlines are written as one SVG document
 * (no viewBox, so the parser's box is the text's own outline
 * box) and read back through svgTextToContours +
 * classifyContours — the same normalisation every stage-2
 * vector consumer gets.
 */
export function layoutTextExtrudeContours(
  font: Font,
  text: string,
  flatness: number = TEXT_EXTRUDE_DEFAULT_FLATNESS,
): TextExtrudeLayoutResult {
  if (!text || !text.trim()) {
    return { ok: false, reason: '押し出すテキストが空です。' };
  }
  const tol = Number.isFinite(flatness) && flatness > 0 ? flatness : TEXT_EXTRUDE_DEFAULT_FLATNESS;
  const upm = font.unitsPerEm;
  const lines = text.split(/\r\n|\r|\n/);
  const subpaths: Pt[][] = [];
  let glyphCount = 0;
  let advanceEm = 0;
  try {
    for (let li = 0; li < lines.length; li++) {
      const baseline = li * TEXT_EXTRUDE_LINE_HEIGHT_EM; // y-down em space
      let x = 0;
      let prev: Glyph | null = null;
      for (const ch of Array.from(lines[li])) {
        const glyph = font.charToGlyph(ch);
        if (prev) x += font.getKerningValue(prev, glyph) / upm;
        const path = glyph.getPath(x, baseline, 1);
        const subs = flattenGlyphCommands(path.commands, tol);
        let added = false;
        for (const sub of subs) {
          if (sub.length >= 3) {
            subpaths.push(sub);
            added = true;
          }
        }
        if (added) glyphCount += 1;
        x += glyph.advanceWidth / upm;
        prev = glyph;
      }
      if (x > advanceEm) advanceEm = x;
    }
  } catch {
    return { ok: false, reason: 'フォントから字形の輪郭を取得できませんでした。別のフォントで試してください。' };
  }
  if (subpaths.length === 0) {
    return { ok: false, reason: '押し出せる字形の輪郭がありません（空白だけのテキストや、輪郭を持たない文字だけでは押し出せません）。' };
  }
  let pointCount = 0;
  for (const sub of subpaths) pointCount += sub.length;
  if (pointCount > TEXT_EXTRUDE_MAX_CONTOUR_POINTS) {
    return {
      ok: false,
      reason: `輪郭の点が多すぎます（${pointCount.toLocaleString()} 点、上限 ${TEXT_EXTRUDE_MAX_CONTOUR_POINTS.toLocaleString()} 点）。平坦化公差を大きくするか、文字数を減らしてください。`,
    };
  }
  const d = subpaths
    .map((pts) => 'M' + pts.map((p) => `${fmtNum(p[0])} ${fmtNum(p[1])}`).join(' L') + ' Z')
    .join(' ');
  const svgText = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`;
  const raw = svgTextToContours(svgText);
  if (!raw) {
    return { ok: false, reason: '字形の輪郭を閉じた図形として読み取れませんでした。' };
  }
  const classified = classifyContours(raw);
  if (classified.contours.length === 0 || !(classified.netArea > 0)) {
    return { ok: false, reason: '字形の輪郭の面積が 0 です。別の文字列で試してください。' };
  }
  let normPoints = 0;
  for (const c of classified.contours) normPoints += c.length;
  return {
    ok: true,
    layout: {
      contours: classified.contours,
      islandCount: classified.islandCount,
      holeCount: classified.holeCount,
      netArea: classified.netArea,
      glyphCount,
      lineCount: lines.length,
      advanceEm,
      svgText,
      pointCount: normPoints,
    },
  };
}

// ---------------------------------------------------------------------------
// Session font holder — the ONLY place the font bytes live.
// Session memory only: nothing here is serialised into the
// config, a preset, or storage, so reloading the page (or
// applying a preset elsewhere) requires loading the font file
// again before a text extrusion can run.
// ---------------------------------------------------------------------------

export interface TextExtrudeSessionFont {
  font: Font;
  info: TextExtrudeFontInfo;
  fileName: string;
}

let sessionFont: TextExtrudeSessionFont | null = null;

export function setTextExtrudeSessionFont(entry: TextExtrudeSessionFont): void {
  sessionFont = entry;
}

export function getTextExtrudeSessionFont(): TextExtrudeSessionFont | null {
  return sessionFont;
}

export function clearTextExtrudeSessionFont(): void {
  sessionFont = null;
}
