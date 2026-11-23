// Phase 17 stage 2: vector Boolean (2D) — the pure, main-thread
// half of the vector composition feature. The actual boolean
// engine is manifold-3d's CrossSection inside the CSG worker
// (decision of the stage-0 spike 1: no new dependency, the result
// is intersection-free by construction and connects directly to
// the extrusion path). This module owns everything that does NOT
// need the WASM:
//
//   - the contour vocabulary: a shape is a list of closed
//     contours (simple polygons) in normalised morph space
//     ([-1, 1]^2, y up — the space parseSvgPathGeometry returns);
//   - island / hole classification by containment parity, with
//     winding normalisation (islands CCW / positive signed area,
//     holes CW / negative) — the single place this normalisation
//     lives, per the spike-1 conclusion;
//   - SVG text <-> contours conversion. The A operand reuses the
//     morph SVG source (gpgpuMorphSvgSource) and the B operand
//     is a second SVG text key, both parsed by the existing
//     parseSvgPathGeometry so the flattening precision and the
//     normalisation match every other path consumer;
//   - area computation and validation (degenerate contours and
//     self-intersection are refused here, before the worker is
//     ever touched — the same gate discipline as CSG gate (a));
//   - contours -> PathGeometry, so a boolean result can flow
//     into the existing path consumers (raster supply, morph).
//
// Nothing here imports manifold-3d or three, so the module runs
// under the plain-node test loader unchanged.

import {
  buildChordLengthTable,
  hashSvgSource,
  parseSvgPathGeometry,
  type PathGeometry,
  type PathSubpath,
} from './pathGeometry';

export type VectorBoolOp = 'union' | 'difference' | 'intersection' | 'xor';
export const VECTOR_BOOL_OPS: readonly VectorBoolOp[] = [
  'union', 'difference', 'intersection', 'xor',
];
export function isVectorBoolOp(v: unknown): v is VectorBoolOp {
  return typeof v === 'string' && (VECTOR_BOOL_OPS as readonly string[]).includes(v);
}
export function normalizeVectorBoolOp(v: unknown): VectorBoolOp {
  return isVectorBoolOp(v) ? v : 'union';
}

/** One closed contour: [x, y] vertices in order, no repeated
 *  closing vertex. Winding carries the role after
 *  normalisation: CCW (positive signed area) = island,
 *  CW (negative) = hole. */
export type VectorContour = [number, number][];

/** What the worker returns for a 'vectorBoolean' request. */
export interface VectorBooleanResultData {
  contours: VectorContour[];
  /** Net area (islands − holes) as measured by CrossSection. */
  area: number;
  islandCount: number;
  holeCount: number;
}

/** What the worker returns for a 'crossSectionExtrude' request
 *  (the stage-3 text-extrude foundation). */
export interface CrossSectionExtrudeResultData {
  positions: Float32Array;
  indices: Uint32Array;
  volume: number;
  triangles: number;
  /** Net cross-section area the solid was extruded from. */
  area: number;
}

export interface CrossSectionExtrudeRequest {
  contours: VectorContour[];
  height: number;
  divisions: number;
  twistDegrees: number;
  scaleTop: number;
}

// ---------------------------------------------------------------------------
// Area / classification / normalisation
// ---------------------------------------------------------------------------

/** Signed area of one contour (shoelace). Positive = CCW. */
export function signedContourArea(contour: readonly (readonly [number, number])[]): number {
  let a = 0;
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Even-odd point-in-polygon test (ray cast). Points exactly on
 *  an edge are reported as inside-or-outside by the crossing
 *  count alone; callers only use this for classification of
 *  well-separated contours. */
export function pointInContour(
  px: number,
  py: number,
  contour: readonly (readonly [number, number])[],
): boolean {
  let inside = false;
  const n = contour.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = contour[i];
    const [xj, yj] = contour[j];
    if ((yi > py) !== (yj > py)) {
      const xCross = xi + ((py - yi) / (yj - yi)) * (xj - xi);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

export interface ClassifiedContours {
  /** Normalised contours: islands CCW, holes CW, in the
   *  original order. Degenerate contours are dropped. */
  contours: VectorContour[];
  islandCount: number;
  holeCount: number;
  /** Net area: sum of island areas − sum of hole areas. */
  netArea: number;
}

/**
 * Classify contours into islands and holes by containment
 * parity (a contour contained in an even number of others is an
 * island, in an odd number a hole) and normalise winding:
 * islands are forced CCW, holes CW. Classification is by parity,
 * NOT by the input winding, so a source that draws its holes
 * CCW (the spike-2 trap: Positive/NonZero fill silently fills
 * such holes) is repaired here instead of being misread.
 */
export function classifyContours(
  input: readonly (readonly (readonly [number, number])[])[],
): ClassifiedContours {
  const kept: { pts: VectorContour; absArea: number }[] = [];
  for (const raw of input) {
    const pts = cleanContour(raw);
    if (!pts) continue;
    const absArea = Math.abs(signedContourArea(pts));
    if (!(absArea > 1e-12)) continue;
    kept.push({ pts, absArea });
  }
  const contours: VectorContour[] = [];
  let islandCount = 0;
  let holeCount = 0;
  let netArea = 0;
  for (let i = 0; i < kept.length; i++) {
    let depth = 0;
    const [px, py] = kept[i].pts[0];
    for (let j = 0; j < kept.length; j++) {
      if (i === j) continue;
      // A contour can only contain another if its area is larger.
      if (kept[j].absArea <= kept[i].absArea) continue;
      if (pointInContour(px, py, kept[j].pts)) depth += 1;
    }
    const isHole = depth % 2 === 1;
    const signed = signedContourArea(kept[i].pts);
    const wantPositive = !isHole;
    const pts = (signed > 0) === wantPositive ? kept[i].pts : [...kept[i].pts].reverse();
    contours.push(pts);
    if (isHole) {
      holeCount += 1;
      netArea -= kept[i].absArea;
    } else {
      islandCount += 1;
      netArea += kept[i].absArea;
    }
  }
  return { contours, islandCount, holeCount, netArea };
}

/** Net area of a contour set (islands − holes), after
 *  classification. */
export function contoursNetArea(
  input: readonly (readonly (readonly [number, number])[])[],
): number {
  return classifyContours(input).netArea;
}

/** Drop consecutive duplicate vertices and a repeated closing
 *  vertex; returns null when fewer than 3 distinct vertices
 *  remain or any coordinate is non-finite. */
export function cleanContour(
  raw: readonly (readonly [number, number])[],
): VectorContour | null {
  const pts: VectorContour = [];
  for (const [x, y] of raw) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const last = pts[pts.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    pts.push([x, y]);
  }
  if (pts.length > 1) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
}

// ---------------------------------------------------------------------------
// Validation (self-intersection)
// ---------------------------------------------------------------------------

function orient(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsProperlyIntersect(
  a: readonly [number, number], b: readonly [number, number],
  c: readonly [number, number], d: readonly [number, number],
): boolean {
  const d1 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Above this vertex count the O(n^2) self-intersection scan is
 *  skipped (the worker's CrossSection construction still
 *  guarantees an intersection-free result; the scan is a
 *  pre-flight courtesy, not the correctness gate). */
export const VECTOR_BOOL_SELF_INTERSECT_SCAN_LIMIT = 1500;

export interface ContourValidation {
  ok: boolean;
  reason: string;
}

/**
 * Pre-flight validation of one operand: every contour must be a
 * simple (non-self-intersecting) closed polygon with positive
 * area. Cross-contour intersections are NOT refused — the
 * EvenOdd construction in the worker resolves overlapping
 * contours of one operand into the filled region they describe.
 */
export function validateContours(
  input: readonly (readonly (readonly [number, number])[])[],
  label: string,
): ContourValidation {
  if (input.length === 0) {
    return { ok: false, reason: `${label} に閉じた図形がありません。` };
  }
  let usable = 0;
  for (const raw of input) {
    const pts = cleanContour(raw);
    if (!pts) continue;
    if (!(Math.abs(signedContourArea(pts)) > 1e-12)) continue;
    usable += 1;
    if (pts.length <= VECTOR_BOOL_SELF_INTERSECT_SCAN_LIMIT) {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue; // adjacent via wrap
          const c = pts[j];
          const d = pts[(j + 1) % n];
          if (segmentsProperlyIntersect(a, b, c, d)) {
            return {
              ok: false,
              reason: `${label} の輪郭が自己交差しています。交差のない単純な閉図形に直してから合成してください。`,
            };
          }
        }
      }
    }
  }
  if (usable === 0) {
    return { ok: false, reason: `${label} に面積のある閉じた図形がありません。` };
  }
  return { ok: true, reason: '' };
}

// ---------------------------------------------------------------------------
// SVG text <-> contours
// ---------------------------------------------------------------------------

/**
 * Parse SVG text into normalised contours. The text may be a
 * full SVG document or a bare path `d` string (wrapped into a
 * document here). Parsing goes through parseSvgPathGeometry, so
 * coordinates land in normalised morph space ([-1, 1]^2, y up),
 * centred on the source's own box — A and B therefore meet in
 * the same normalised frame, exactly like the raster Boolean's
 * resample-to-A convention. Only closed subpaths are taken
 * (open strokes have no filled region to compose). Returns null
 * when the text carries no closed geometry.
 */
export function svgTextToContours(svgText: string): VectorContour[] | null {
  if (!svgText || !svgText.trim()) return null;
  const doc = svgText.indexOf('<') === -1
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${svgText}"/></svg>`
    : svgText;
  const geom = parseSvgPathGeometry(doc);
  if (!geom) return null;
  const contours: VectorContour[] = [];
  for (const sub of geom.subpaths) {
    if (!sub.closed) continue;
    const pts: VectorContour = [];
    const count = Math.floor(sub.points.length / 2);
    for (let k = 0; k < count; k++) {
      pts.push([sub.points[k * 2], sub.points[k * 2 + 1]]);
    }
    const cleaned = cleanContour(pts);
    if (cleaned && Math.abs(signedContourArea(cleaned)) > 1e-12) contours.push(cleaned);
  }
  return contours.length > 0 ? contours : null;
}

function fmtCoord(v: number): string {
  // Shortest round-trip form keeps result keys compact while
  // staying bit-exact through a reparse.
  return String(Math.round(v * 1e6) / 1e6);
}

/**
 * Serialise contours as an SVG document. The contours live in
 * y-up normalised space; SVG is y-down, so the written y is
 * negated — which also makes a reparse through
 * parseSvgPathGeometry (it flips y back) reproduce the input
 * contours. viewBox is the normalised frame itself, so the
 * reparse centring/scale is the identity.
 */
export function contoursToSvgText(contours: readonly (readonly (readonly [number, number])[])[]): string {
  const subs: string[] = [];
  for (const contour of contours) {
    if (contour.length < 3) continue;
    const parts: string[] = [];
    for (let i = 0; i < contour.length; i++) {
      const [x, y] = contour[i];
      parts.push(`${i === 0 ? 'M' : 'L'}${fmtCoord(x)} ${fmtCoord(-y)}`);
    }
    subs.push(parts.join(' ') + ' Z');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 2 2"><path d="${subs.join(' ')}" fill-rule="evenodd"/></svg>`;
}

/** Canonical serialization of a contour set (for hashing /
 *  determinism checks in tests). */
export function serializeContours(
  contours: readonly (readonly (readonly [number, number])[])[],
): string {
  return contours
    .map((c) => c.map(([x, y]) => `${x},${y}`).join(';'))
    .join('|');
}

// ---------------------------------------------------------------------------
// Contours -> PathGeometry
// ---------------------------------------------------------------------------

/**
 * Build a PathGeometry from contours (all subpaths closed), in
 * the same normalised space. This is the bridge that lets a
 * boolean result flow into the existing path consumers
 * (rasterizePathGeometryLuma for the mask supply, the morph
 * path placement) without going back through SVG text.
 */
export function contoursToPathGeometry(
  input: readonly (readonly (readonly [number, number])[])[],
): PathGeometry | null {
  const subpaths: PathSubpath[] = [];
  const offsets: number[] = [];
  let totalLength = 0;
  for (const raw of input) {
    const pts = cleanContour(raw);
    if (!pts) continue;
    const flat = new Float64Array(pts.length * 2);
    for (let k = 0; k < pts.length; k++) {
      flat[k * 2] = pts[k][0];
      flat[k * 2 + 1] = pts[k][1];
    }
    const table = buildChordLengthTable(flat);
    offsets.push(totalLength);
    totalLength += table.length;
    subpaths.push({ points: flat, cumLen: table.cumLen, length: table.length, closed: true });
  }
  if (subpaths.length === 0) return null;
  return {
    subpaths,
    totalLength,
    subpathOffsets: Float64Array.from(offsets),
    viewBox: { x: -1, y: -1, width: 2, height: 2 },
    sourceHash: hashSvgSource(serializeContours(subpaths.map((s) => {
      const pts: VectorContour = [];
      for (let k = 0; k + 1 < s.points.length; k += 2) pts.push([s.points[k], s.points[k + 1]]);
      return pts;
    }))),
  };
}
