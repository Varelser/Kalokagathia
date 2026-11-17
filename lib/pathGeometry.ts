/**
 * Path geometry for the GPGPU morph system (Phase S: authored paths).
 *
 * The legacy SVG morph cloud (lib/svgMorph.ts `sampleSvgPointCloud`)
 * distributes particles by seeded random pick over an arc-length
 * uniform *resampling* of the outline — the particle order carries no
 * meaning. This module adds the missing authored-path view of the same
 * SVG document: subpaths in document order, each with a true
 * arc-length table, so the morph bake can assign particle i to path
 * position s_i in order ('along'), or inside a [start, end] window
 * ('writeOn', 3D-Stroke style), with an optional taper that widens the
 * placement band perpendicular to the path (Tao-style ribbon width).
 *
 * Design (Phase S brief §0, building on the S-1 design study):
 *  - Parallel addition only. `flatten*` / `parseSvgGeometry` /
 *    `sampleSvgPointCloud` in lib/svgMorph.ts are untouched, and the
 *    bake's legacy branch is untouched: with the path mode 'off' (the
 *    default) the bake output is byte-identical to v1.20.0.
 *  - The arc-length table is built by M2 adaptive subdivision
 *    (brief §0-1): each curve segment is split recursively until the
 *    maximum deviation of 16 interior sample points from the chord is
 *    <= PATH_ARC_EPSILON (0.001, document coordinates). A midpoint-only
 *    flatness test is NOT used — on an S-curve the midpoint lies on
 *    the chord and subdivision would stop after one leaf (S-1 §5.1).
 *    The legacy flatten is deliberately NOT reused for the table: its
 *    arc rule (pi/16 steps) carries a -1.6e-03 relative arc-length
 *    error on an ellipse half (S-1 §2.3, curve C5), which the path
 *    basis must not inherit.
 *  - Because adaptive subdivision needs the curve segments themselves
 *    (a flattened polyline's segments are already straight), this
 *    module carries its own segment-level parser that mirrors
 *    lib/svgMorph.ts's document scan (same tag set, group transform
 *    stack, endpoint->center arc conversion). The two parsers agree
 *    on which geometry a document contains; only the representation
 *    differs. Subdivision happens in each element's local coordinates
 *    (as the legacy flatten does), then leaf points are mapped by the
 *    element's effective matrix.
 *  - Normalisation mirrors `sampleSvgPointCloud` exactly: box =
 *    viewBox ?? geometry bounding box, span = max(w, h), scale =
 *    2 / span, centred, y flipped. PathGeometry therefore lives in the
 *    same normalised space as the legacy cloud, and arc lengths scale
 *    by the same uniform factor (ratios — and every s — are invariant).
 *  - Everything here is a pure function of its inputs: no DOM, no RNG,
 *    no clock. Same SVG text in, bit-identical geometry out.
 */

export interface PathPt {
  x: number;
  y: number;
}

/** Arc-length table construction method (brief §0-1): M2 adaptive. */
export const PATH_ARC_METHOD = 'adaptive' as const;
/** Flatness epsilon for M2 subdivision, in document coordinates. */
export const PATH_ARC_EPSILON = 0.001;
/** Interior sample points per flatness evaluation (S-1 §2: 16). */
const PATH_FLATNESS_SAMPLES = 16;
/** Recursion cap for M2 subdivision (pathological curves stay finite). */
const PATH_SUBDIVISION_MAX_DEPTH = 20;
/** Leaf budget per segment; beyond it the leaf is accepted as-is. */
const PATH_SEGMENT_MAX_LEAVES = 65536;
/**
 * Taper maximum width W0 in normalised cloud units (brief §0-2):
 * fixed at 0.1 — the same order as the default morph jitter (0.12) —
 * and deliberately not a config key.
 */
export const PATH_TAPER_MAX_WIDTH = 0.1;

export type MorphPathMode = 'off' | 'along' | 'writeOn' | 'stamp';
export type MorphPathTaperShape = 'linear' | 'smooth' | 'bell';
export type MorphPathSubpathMode = 'proportional' | 'even' | 'first';

/** Path placement options consumed by the morph bake (Phase S). */
export interface MorphPathOptions {
  mode: MorphPathMode;
  /** Write-on window start, as a fraction of the path (clamped 0..1). */
  writeOnStart: number;
  /** Write-on window end; start > end collapses to end = start. */
  writeOnEnd: number;
  /** Taper strength 0..1; 0 = no offset (points stay on the path). */
  taper: number;
  taperShape: MorphPathTaperShape;
  subpathMode: MorphPathSubpathMode;
  /** Shape stamping (Phase AA3, lib/stampPlacement.ts): only read
   *  when mode is 'stamp'. Spacing = path fraction per stamp,
   *  size = shape radius in normalised units, align = rotate each
   *  stamp onto the path tangent. */
  stampSpacing?: number;
  stampSize?: number;
  stampShape?: 'disc' | 'ring' | 'star' | 'diamond' | 'obj';
  stampAlign?: boolean;
  /** Parallel offset (Phase AM): the geometry is shifted
   *  sideways by this distance (see offsetPathGeometry) before
   *  any mode places points. Absent / 0 = the authored geometry
   *  itself. Applies to every mode, text-on-path included. */
  offset?: number;
}

// ---------------------------------------------------------------------------
// Curve segments (document/local coordinates, pre-normalisation)
// ---------------------------------------------------------------------------

export type PathSegment =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'cubic'; x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { kind: 'quad'; x0: number; y0: number; x1: number; y1: number; x2: number; y2: number }
  | {
      kind: 'arc';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      cosPhi: number;
      sinPhi: number;
      startAngle: number;
      deltaAngle: number;
    };

/** Evaluate a segment at parameter t in [0, 1]. */
export function segmentPointAt(seg: PathSegment, t: number): PathPt {
  switch (seg.kind) {
    case 'line':
      return { x: seg.x0 + (seg.x1 - seg.x0) * t, y: seg.y0 + (seg.y1 - seg.y0) * t };
    case 'cubic': {
      const u = 1 - t;
      return {
        x: u * u * u * seg.x0 + 3 * u * u * t * seg.x1 + 3 * u * t * t * seg.x2 + t * t * t * seg.x3,
        y: u * u * u * seg.y0 + 3 * u * u * t * seg.y1 + 3 * u * t * t * seg.y2 + t * t * t * seg.y3,
      };
    }
    case 'quad': {
      const u = 1 - t;
      return {
        x: u * u * seg.x0 + 2 * u * t * seg.x1 + t * t * seg.x2,
        y: u * u * seg.y0 + 2 * u * t * seg.y1 + t * t * seg.y2,
      };
    }
    case 'arc': {
      const a = seg.startAngle + seg.deltaAngle * t;
      const ex = seg.rx * Math.cos(a);
      const ey = seg.ry * Math.sin(a);
      return {
        x: seg.cx + seg.cosPhi * ex - seg.sinPhi * ey,
        y: seg.cy + seg.sinPhi * ex + seg.cosPhi * ey,
      };
    }
    default:
      return { x: 0, y: 0 };
  }
}

/** Distance from point p to the chord segment a-b (flatness metric). */
function pointToChordDistance(p: PathPt, a: PathPt, b: PathPt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const qx = a.x + dx * t;
  const qy = a.y + dy * t;
  return Math.hypot(p.x - qx, p.y - qy);
}

/**
 * M2 adaptive subdivision of one segment: recursively split at t=0.5
 * until the maximum deviation of PATH_FLATNESS_SAMPLES interior points
 * from the chord is <= epsilon. Returns the leaf polyline (including
 * the segment start point) and the cumulative chord lengths of the
 * leaves — the arc-length estimate whose relative error at eps=0.001
 * is <= 6.3e-06 on the S-1 reference curves C1-C5.
 */
export function subdivideSegment(
  seg: PathSegment,
  epsilon: number = PATH_ARC_EPSILON,
): { points: PathPt[]; cumLen: Float64Array; length: number } {
  const points: PathPt[] = [segmentPointAt(seg, 0)];
  const cumLen: number[] = [0];
  let leaves = 0;
  const visit = (t0: number, t1: number, p0: PathPt, p1: PathPt, depth: number): void => {
    let maxDev = 0;
    if (depth < PATH_SUBDIVISION_MAX_DEPTH && leaves < PATH_SEGMENT_MAX_LEAVES) {
      for (let k = 1; k <= PATH_FLATNESS_SAMPLES; k++) {
        const t = t0 + ((t1 - t0) * k) / (PATH_FLATNESS_SAMPLES + 1);
        const dev = pointToChordDistance(segmentPointAt(seg, t), p0, p1);
        if (dev > maxDev) maxDev = dev;
      }
    }
    if (maxDev <= epsilon || depth >= PATH_SUBDIVISION_MAX_DEPTH || leaves >= PATH_SEGMENT_MAX_LEAVES) {
      points.push(p1);
      cumLen.push(cumLen[cumLen.length - 1] + Math.hypot(p1.x - p0.x, p1.y - p0.y));
      leaves += 1;
      return;
    }
    const tm = (t0 + t1) / 2;
    const pm = segmentPointAt(seg, tm);
    visit(t0, tm, p0, pm, depth + 1);
    visit(tm, t1, pm, p1, depth + 1);
  };
  visit(0, 1, points[0], segmentPointAt(seg, 1), 0);
  return { points, cumLen: Float64Array.from(cumLen), length: cumLen[cumLen.length - 1] };
}

// ---------------------------------------------------------------------------
// Arc-length tables (F2 / F3 / F4 / F6)
// ---------------------------------------------------------------------------

/** A polyline with its cumulative arc-length table (parallel arrays). */
export interface ArcLengthTable {
  /** Flat xy pairs. */
  points: Float64Array;
  /** Cumulative arc length per point; cumLen[0] = 0, same point count. */
  cumLen: Float64Array;
  /** Total arc length (= last cumLen entry). */
  length: number;
}

/**
 * F2: build an arc-length table over curve segments by M2 adaptive
 * subdivision (epsilon in the segments' coordinate units). Segment
 * joint points are emitted once. (S-1's draft signature took a
 * polyline; a polyline's straight segments cannot be adaptively
 * subdivided, so the table builder takes the segments themselves —
 * the chord-only counterpart for plain polylines is
 * buildChordLengthTable below.)
 */
export function buildArcLengthTable(segments: readonly PathSegment[], epsilon: number = PATH_ARC_EPSILON): ArcLengthTable {
  const pts: number[] = [];
  const cum: number[] = [];
  let total = 0;
  for (const seg of segments) {
    const sub = subdivideSegment(seg, epsilon);
    for (let k = 0; k < sub.points.length; k++) {
      if (k === 0 && pts.length > 0) continue; // joint point already emitted
      pts.push(sub.points[k].x, sub.points[k].y);
      cum.push(total + sub.cumLen[k]);
    }
    total += sub.length;
  }
  if (pts.length === 0) {
    return { points: new Float64Array(0), cumLen: new Float64Array(0), length: 0 };
  }
  return { points: Float64Array.from(pts), cumLen: Float64Array.from(cum), length: total };
}

/** Chord-length table over an existing polyline (the legacy M0 view). */
export function buildChordLengthTable(points: Float64Array): ArcLengthTable {
  const n = Math.floor(points.length / 2);
  const cum = new Float64Array(n);
  let total = 0;
  for (let k = 1; k < n; k++) {
    total += Math.hypot(points[k * 2] - points[(k - 1) * 2], points[k * 2 + 1] - points[(k - 1) * 2 + 1]);
    cum[k] = total;
  }
  return { points, cumLen: cum, length: total };
}

/** Index of the table segment containing arc length s (binary search). */
function tableSegmentIndex(table: ArcLengthTable, s: number): number {
  const { cumLen } = table;
  const n = cumLen.length;
  if (n <= 1) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumLen[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, n - 2);
}

/**
 * F3: point at arc length s along the table (binary search + linear
 * interpolation). s is clamped to [0, length]; s = length returns the
 * final point (for a closed subpath that is the start point, so
 * s = 1.0 coincides with s = 0.0 as specified in S-1 §1.2).
 */
export function pointAtArcLength(table: ArcLengthTable, s: number): PathPt {
  const n = Math.floor(table.points.length / 2);
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: table.points[0], y: table.points[1] };
  const target = Math.max(0, Math.min(table.length, s));
  const k = tableSegmentIndex(table, target);
  const segLen = table.cumLen[k + 1] - table.cumLen[k];
  const t = segLen > 0 ? (target - table.cumLen[k]) / segLen : 0;
  const ax = table.points[k * 2];
  const ay = table.points[k * 2 + 1];
  return {
    x: ax + (table.points[(k + 1) * 2] - ax) * t,
    y: ay + (table.points[(k + 1) * 2 + 1] - ay) * t,
  };
}

/**
 * F6: unit tangent at arc length s. Endpoints use the adjacent
 * segment's direction; zero-length segments are skipped. A fully
 * degenerate table yields the defined fallback (1, 0).
 */
export function pathTangentAt(table: ArcLengthTable, s: number): PathPt {
  const n = Math.floor(table.points.length / 2);
  if (n <= 1 || table.length <= 0) return { x: 1, y: 0 };
  const target = Math.max(0, Math.min(table.length, s));
  let k = tableSegmentIndex(table, target);
  const dirAt = (j: number): PathPt | null => {
    const dx = table.points[(j + 1) * 2] - table.points[j * 2];
    const dy = table.points[(j + 1) * 2 + 1] - table.points[j * 2 + 1];
    const len = Math.hypot(dx, dy);
    return len > 0 ? { x: dx / len, y: dy / len } : null;
  };
  let dir = dirAt(k);
  if (!dir) {
    for (let j = k + 1; j < n - 1 && !dir; j++) dir = dirAt(j);
    for (let j = k - 1; j >= 0 && !dir; j--) dir = dirAt(j);
  }
  return dir ?? { x: 1, y: 0 };
}

/**
 * F4: resample the table equidistantly by arc length inside the
 * window [startS, endS] (defaults: the whole table), using the same
 * midpoint convention as `sampleSvgPointCloud` (sample k sits at
 * (k + 0.5) / count of the window). Returns flat xy pairs.
 */
export function resampleEquidistant(
  table: ArcLengthTable,
  count: number,
  startS: number = 0,
  endS: number = table.length,
): Float32Array {
  const out = new Float32Array(Math.max(0, count) * 2);
  if (count <= 0) return out;
  const lo = Math.max(0, Math.min(table.length, startS));
  const hi = Math.max(lo, Math.min(table.length, endS));
  for (let k = 0; k < count; k++) {
    const p = pointAtArcLength(table, lo + ((hi - lo) * (k + 0.5)) / count);
    out[k * 2] = p.x;
    out[k * 2 + 1] = p.y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Taper (F5)
// ---------------------------------------------------------------------------

/**
 * F5: taper width at window-normalised position u, as a relative
 * value (W0 = 1; the bake multiplies by PATH_TAPER_MAX_WIDTH).
 * 'linear': (1 - u); 'smooth': 1 - smoothstep(u); 'bell':
 * 1 - (2u - 1)^2 — all scaled by strength. u and strength are
 * clamped to [0, 1]; strength 0 always yields 0 (no offset).
 */
export function taperWidthAt(u: number, strength: number, shape: MorphPathTaperShape): number {
  const uu = Math.max(0, Math.min(1, u));
  const st = Math.max(0, Math.min(1, strength));
  if (st <= 0) return 0;
  switch (shape) {
    case 'smooth': {
      const ss = uu * uu * (3 - 2 * uu);
      return (1 - ss) * st;
    }
    case 'bell': {
      const d = 2 * uu - 1;
      return (1 - d * d) * st;
    }
    case 'linear':
    default:
      return (1 - uu) * st;
  }
}

// ---------------------------------------------------------------------------
// Subpath distribution (F7) and source hash (F8)
// ---------------------------------------------------------------------------

/**
 * F7: distribute `count` particles across subpaths. Deterministic
 * remainder rule (S-1 §5): floors first, then +1 per subpath in
 * document order until the remainder is exhausted. 'proportional'
 * distributes the remainder only among subpaths with length > 0 (a
 * zero-length subpath has no arc to host a proportional share); if
 * every subpath is degenerate the first one takes all.
 */
export function distributeParticlesAcrossSubpaths(
  subpaths: readonly { length: number }[],
  count: number,
  mode: MorphPathSubpathMode,
): number[] {
  const n = subpaths.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || count <= 0) return out;
  if (mode === 'first') {
    out[0] = count;
    return out;
  }
  if (mode === 'even') {
    const base = Math.floor(count / n);
    let rem = count - base * n;
    for (let k = 0; k < n; k++) out[k] = base;
    for (let k = 0; k < n && rem > 0; k++) {
      out[k] += 1;
      rem -= 1;
    }
    return out;
  }
  // proportional
  const total = subpaths.reduce((acc, sp) => acc + Math.max(0, sp.length), 0);
  if (!(total > 0)) {
    out[0] = count;
    return out;
  }
  let assigned = 0;
  for (let k = 0; k < n; k++) {
    out[k] = Math.floor((count * Math.max(0, subpaths[k].length)) / total);
    assigned += out[k];
  }
  let rem = count - assigned;
  for (let k = 0; k < n && rem > 0; k++) {
    if (subpaths[k].length > 0) {
      out[k] += 1;
      rem -= 1;
    }
  }
  return out;
}

/** F8: FNV-1a 32-bit hash of the source text, as 8 hex characters. */
export function hashSvgSource(svgText: string): string {
  const s = svgText || '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Segment-level SVG parsing (F1)
// ---------------------------------------------------------------------------
//
// The helpers below mirror lib/svgMorph.ts (matMul / matApply /
// parseTransform / getAttr / numAttr and the document scan) so the
// segment parser finds exactly the same geometry; they are copies,
// not shared code, because svgMorph.ts's helpers are module-private
// and that file must stay untouched (Phase S brief: existing flatten*
// and sampleSvgPointCloud unchanged).

type Mat = [number, number, number, number, number, number]; // a b c d e f

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function matMul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function matApply(m: Mat, p: PathPt): PathPt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function parseTransform(attr: string | null): Mat {
  if (!attr) return IDENTITY;
  let result: Mat = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attr)) !== null) {
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((v) => !Number.isFinite(v))) continue;
    let m: Mat = IDENTITY;
    switch (match[1]) {
      case 'matrix':
        if (args.length === 6) m = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case 'translate':
        m = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case 'scale':
        m = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Mat = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          m = matMul(matMul([1, 0, 0, 1, args[1], args[2]], rot), [1, 0, 0, 1, -args[1], -args[2]]);
        } else {
          m = rot;
        }
        break;
      }
      case 'skewX':
        m = [1, 0, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        m = [1, Math.tan(((args[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    result = matMul(result, m);
  }
  return result;
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"|${name}\\s*=\\s*'([^']*)'`);
  const match = re.exec(tag);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function numAttr(tag: string, name: string, fallback = 0): number {
  const raw = getAttr(tag, name);
  const value = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Endpoint -> center conversion for an SVG elliptical arc (SVG 1.1
 * appendix F.6.5), the same math as svgMorph.ts's flattenArc, but
 * returning the center-parameterised arc segment instead of points.
 * Returns null for the degenerate cases flattenArc collapses to a
 * straight jump to the end point.
 */
function arcSegmentFromEndpoints(
  from: PathPt,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: PathPt,
): Extract<PathSegment, { kind: 'arc' }> | null {
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0 || (from.x === to.x && from.y === to.y)) return null;
  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let co = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) co = -co;
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const startAngle = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy) % (Math.PI * 2);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  return { kind: 'arc', cx, cy, rx, ry, cosPhi, sinPhi, startAngle, deltaAngle: delta };
}

interface SegmentSubpath {
  segments: PathSegment[];
  closed: boolean;
}

/**
 * Parse one path `d` attribute into segment subpaths. Mirrors
 * svgMorph.ts's parsePathData command-for-command (same tokenizer,
 * same relative/absolute and S/T reflection handling); the only
 * difference is that curve commands emit segments instead of
 * flattened points, and Z records `closed` (plus the closing line
 * segment the legacy code materialises as the repeated start point).
 */
function parsePathDataSegments(d: string): SegmentSubpath[] {
  const tokens: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) tokens.push(match[1]);
    else if (match[2]) tokens.push(parseFloat(match[2]));
  }

  const subpaths: SegmentSubpath[] = [];
  let current: PathSegment[] = [];
  let started = false;
  let closed = false;
  let cur: PathPt = { x: 0, y: 0 };
  let start: PathPt = { x: 0, y: 0 };
  let prevCubicCtrl: PathPt | null = null;
  let prevQuadCtrl: PathPt | null = null;
  let cmd = '';
  let i = 0;

  const flush = () => {
    if (current.length > 0) subpaths.push({ segments: current, closed });
    current = [];
    started = false;
    closed = false;
  };
  const nums = (n: number): number[] | null => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const v = tokens[i + k];
      if (typeof v !== 'number') return null;
      out.push(v);
    }
    i += n;
    return out;
  };
  const lineTo = (to: PathPt) => {
    current.push({ kind: 'line', x0: cur.x, y0: cur.y, x1: to.x, y1: to.y });
    cur = { ...to };
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (typeof token === 'string') {
      cmd = token;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        if (started) {
          // Legacy pushes the start point, materialising the closing
          // edge; emit it as a (possibly zero-length) line segment.
          current.push({ kind: 'line', x0: cur.x, y0: cur.y, x1: start.x, y1: start.y });
          cur = { ...start };
          closed = true;
        }
        flush();
        prevCubicCtrl = null;
        prevQuadCtrl = null;
      }
      continue;
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        flush();
        cur = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        start = { ...cur };
        started = true;
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        lineTo(rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'H': {
        const v = nums(1);
        if (!v) { i = tokens.length; break; }
        lineTo({ x: rel ? cur.x + v[0] : v[0], y: cur.y });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'V': {
        const v = nums(1);
        if (!v) { i = tokens.length; break; }
        lineTo({ x: cur.x, y: rel ? cur.y + v[0] : v[0] });
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        break;
      }
      case 'C': {
        const v = nums(6);
        if (!v) { i = tokens.length; break; }
        const p1 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p2 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        const p3 = rel ? { x: cur.x + v[4], y: cur.y + v[5] } : { x: v[4], y: v[5] };
        current.push({ kind: 'cubic', x0: cur.x, y0: cur.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y });
        prevCubicCtrl = p2;
        prevQuadCtrl = null;
        cur = p3;
        break;
      }
      case 'S': {
        const v = nums(4);
        if (!v) { i = tokens.length; break; }
        const p1: PathPt = prevCubicCtrl
          ? { x: 2 * cur.x - prevCubicCtrl.x, y: 2 * cur.y - prevCubicCtrl.y }
          : { ...cur };
        const p2 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p3 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        current.push({ kind: 'cubic', x0: cur.x, y0: cur.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y });
        prevCubicCtrl = p2;
        prevQuadCtrl = null;
        cur = p3;
        break;
      }
      case 'Q': {
        const v = nums(4);
        if (!v) { i = tokens.length; break; }
        const p1 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        const p2 = rel ? { x: cur.x + v[2], y: cur.y + v[3] } : { x: v[2], y: v[3] };
        current.push({ kind: 'quad', x0: cur.x, y0: cur.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        prevQuadCtrl = p1;
        prevCubicCtrl = null;
        cur = p2;
        break;
      }
      case 'T': {
        const v = nums(2);
        if (!v) { i = tokens.length; break; }
        const p1: PathPt = prevQuadCtrl
          ? { x: 2 * cur.x - prevQuadCtrl.x, y: 2 * cur.y - prevQuadCtrl.y }
          : { ...cur };
        const p2 = rel ? { x: cur.x + v[0], y: cur.y + v[1] } : { x: v[0], y: v[1] };
        current.push({ kind: 'quad', x0: cur.x, y0: cur.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        prevQuadCtrl = p1;
        prevCubicCtrl = null;
        cur = p2;
        break;
      }
      case 'A': {
        const v = nums(7);
        if (!v) { i = tokens.length; break; }
        const to = rel ? { x: cur.x + v[5], y: cur.y + v[6] } : { x: v[5], y: v[6] };
        const arc = arcSegmentFromEndpoints(cur, v[0], v[1], v[2], v[3] !== 0, v[4] !== 0, to);
        if (arc) current.push(arc);
        else lineTo(to);
        prevCubicCtrl = null;
        prevQuadCtrl = null;
        cur = to;
        break;
      }
      default:
        i += 1;
        break;
    }
    if (typeof tokens[i] === 'string') continue;
    if (i < tokens.length && typeof tokens[i] === 'number' && !cmd) break;
  }
  flush();
  return subpaths;
}

function parsePointsAttr(raw: string | null): PathPt[] {
  if (!raw) return [];
  const values = raw.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v));
  const out: PathPt[] = [];
  for (let k = 0; k + 1 < values.length; k += 2) out.push({ x: values[k], y: values[k + 1] });
  return out;
}

function pointsToSegments(pts: PathPt[], close: boolean): SegmentSubpath | null {
  if (pts.length < 2) return null;
  const segments: PathSegment[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    segments.push({ kind: 'line', x0: pts[k].x, y0: pts[k].y, x1: pts[k + 1].x, y1: pts[k + 1].y });
  }
  if (close) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    segments.push({ kind: 'line', x0: last.x, y0: last.y, x1: first.x, y1: first.y });
  }
  return { segments, closed: close };
}

// ---------------------------------------------------------------------------
// PathGeometry (F1) and path resolution for the bake
// ---------------------------------------------------------------------------

export interface PathSubpath extends ArcLengthTable {
  /** Closed subpath (Z / polygon / rect / circle / ellipse). */
  closed: boolean;
}

export interface PathGeometry {
  /** Subpaths in document order, in normalised morph space. */
  subpaths: PathSubpath[];
  /** Sum of subpath arc lengths (normalised units). */
  totalLength: number;
  /** Cumulative start offset of each subpath within totalLength. */
  subpathOffsets: Float64Array;
  viewBox: { x: number; y: number; width: number; height: number } | null;
  /** FNV-1a hash of the source text (cache keys). */
  sourceHash: string;
}

/**
 * F1: parse an SVG document into path geometry — subpaths in document
 * order with M2 arc-length tables, normalised exactly like
 * `sampleSvgPointCloud`. Returns null when the document carries no
 * drawable geometry (the same contract as the legacy sampler).
 */
export function parseSvgPathGeometry(svgText: string): PathGeometry | null {
  if (!svgText || svgText.indexOf('<') === -1) return null;
  let viewBox: PathGeometry['viewBox'] = null;
  const svgTag = /<svg\b[^>]*>/i.exec(svgText);
  if (svgTag) {
    const vb = getAttr(svgTag[0], 'viewBox');
    if (vb) {
      const parts = vb.split(/[\s,]+/).filter(Boolean).map(Number);
      if (parts.length === 4 && parts.every((v) => Number.isFinite(v)) && parts[2] > 0 && parts[3] > 0) {
        viewBox = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
      }
    }
  }

  // Document scan mirroring parseSvgGeometry: same tag set, same
  // group transform stack, same shape handling. Each element yields
  // segment subpaths in local coordinates; subdivision runs locally
  // (as the legacy flatten does) and leaf points are then mapped by
  // the element's effective matrix.
  const rawSubpaths: { points: PathPt[]; closed: boolean }[] = [];
  const tagRe = /<(\/?)(g|path|rect|circle|ellipse|line|polyline|polygon)\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  let groupMat: Mat = IDENTITY;
  const groupStack: Mat[] = [];
  while ((tagMatch = tagRe.exec(svgText)) !== null) {
    const tag = tagMatch[0];
    const isClosing = tagMatch[1] === '/';
    const kind = tagMatch[2].toLowerCase();
    if (kind === 'g') {
      if (isClosing) {
        groupMat = groupStack.pop() ?? IDENTITY;
      } else if (!tag.endsWith('/>')) {
        groupStack.push(groupMat);
        groupMat = matMul(groupMat, parseTransform(getAttr(tag, 'transform')));
      }
      continue;
    }
    if (isClosing) continue;
    const mat = matMul(groupMat, parseTransform(getAttr(tag, 'transform')));
    const emit = (sub: SegmentSubpath | null) => {
      if (!sub || sub.segments.length === 0) return;
      const table = buildArcLengthTable(sub.segments, PATH_ARC_EPSILON);
      if (table.points.length < 4) return; // fewer than 2 points
      const pts: PathPt[] = [];
      for (let k = 0; k < table.points.length; k += 2) {
        pts.push(matApply(mat, { x: table.points[k], y: table.points[k + 1] }));
      }
      rawSubpaths.push({ points: pts, closed: sub.closed });
    };
    switch (kind) {
      case 'path': {
        const d = getAttr(tag, 'd');
        if (d) {
          for (const sub of parsePathDataSegments(d)) emit(sub);
        }
        break;
      }
      case 'polygon':
        emit(pointsToSegments(parsePointsAttr(getAttr(tag, 'points')), true));
        break;
      case 'polyline':
        emit(pointsToSegments(parsePointsAttr(getAttr(tag, 'points')), false));
        break;
      case 'line':
        emit(
          pointsToSegments(
            [
              { x: numAttr(tag, 'x1'), y: numAttr(tag, 'y1') },
              { x: numAttr(tag, 'x2'), y: numAttr(tag, 'y2') },
            ],
            false,
          ),
        );
        break;
      case 'rect': {
        const x = numAttr(tag, 'x');
        const y = numAttr(tag, 'y');
        const w = numAttr(tag, 'width');
        const h = numAttr(tag, 'height');
        if (w > 0 && h > 0) {
          emit(
            pointsToSegments(
              [
                { x, y },
                { x: x + w, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
              ],
              true,
            ),
          );
        }
        break;
      }
      case 'circle':
      case 'ellipse': {
        const cx = numAttr(tag, 'cx');
        const cy = numAttr(tag, 'cy');
        const rx = kind === 'circle' ? numAttr(tag, 'r') : numAttr(tag, 'rx');
        const ry = kind === 'circle' ? numAttr(tag, 'r') : numAttr(tag, 'ry');
        if (rx > 0 && ry > 0) {
          emit({
            segments: [
              { kind: 'arc', cx, cy, rx, ry, cosPhi: 1, sinPhi: 0, startAngle: 0, deltaAngle: Math.PI * 2 },
            ],
            closed: true,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  if (rawSubpaths.length === 0) return null;

  // Normalisation, mirroring sampleSvgPointCloud: box = viewBox ??
  // geometry bbox, span = max(w, h), centred, y flipped.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sub of rawSubpaths) {
    for (const p of sub.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const box = viewBox ?? { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const span = Math.max(box.width, box.height);
  if (!(span > 0)) return null;
  const scale = 2 / span;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const subpaths: PathSubpath[] = [];
  const offsets: number[] = [];
  let totalLength = 0;
  for (const sub of rawSubpaths) {
    const flat = new Float64Array(sub.points.length * 2);
    for (let k = 0; k < sub.points.length; k++) {
      flat[k * 2] = (sub.points[k].x - cx) * scale;
      flat[k * 2 + 1] = -(sub.points[k].y - cy) * scale;
    }
    const table = buildChordLengthTable(flat);
    offsets.push(totalLength);
    totalLength += table.length;
    subpaths.push({ points: flat, cumLen: table.cumLen, length: table.length, closed: sub.closed });
  }
  return {
    subpaths,
    totalLength,
    subpathOffsets: Float64Array.from(offsets),
    viewBox,
    sourceHash: hashSvgSource(svgText),
  };
}

export interface ResolvedPathPoint {
  x: number;
  y: number;
  /** Unit tangent at the resolved point (for the taper normal). */
  tangentX: number;
  tangentY: number;
  subpathIndex: number;
}

/**
 * Resolve a global path parameter s01 in [0, 1] to a point + tangent,
 * honouring the subpath distribution mode:
 *  - 'proportional': s01 walks the concatenated arc length of all
 *    subpaths (the legacy cloud's distribution, made sequential).
 *  - 'even': each subpath owns an equal slice of s01.
 *  - 'first': only the first subpath is used.
 * For a closed subpath, local s = length coincides with s = 0 (the
 * table's final point is the start point), per S-1 §1.2.
 */
export function resolvePathPoint(geom: PathGeometry, s01: number, subpathMode: MorphPathSubpathMode): ResolvedPathPoint {
  const subs = geom.subpaths;
  const s = Math.max(0, Math.min(1, s01));
  let index = 0;
  let local = 0;
  if (subpathMode === 'even' && subs.length > 1) {
    index = Math.min(subs.length - 1, Math.floor(s * subs.length));
    local = (s * subs.length - index) * subs[index].length;
  } else if (subpathMode === 'first') {
    index = 0;
    local = s * subs[0].length;
  } else {
    // proportional (also the single-subpath behaviour of every mode)
    const d = s * geom.totalLength;
    index = subs.length - 1;
    for (let k = 0; k < subs.length; k++) {
      if (subs[k].length > 0 && d <= geom.subpathOffsets[k] + subs[k].length) {
        index = k;
        break;
      }
    }
    local = d - geom.subpathOffsets[index];
  }
  const table = subs[index];
  const p = pointAtArcLength(table, local);
  const t = pathTangentAt(table, local);
  return { x: p.x, y: p.y, tangentX: t.x, tangentY: t.y, subpathIndex: index };
}

// ---------------------------------------------------------------------------
// Parallel offset (Phase AM)
// ---------------------------------------------------------------------------
//
// The 2D audit §1 "path offset" generator: shift every subpath
// polyline sideways by a signed distance, producing a NEW
// PathGeometry of parallel contours. Positive distance offsets
// to the LEFT of the direction of travel (the normal (-dy, dx));
// for a closed subpath wound CCW in this y-up space that is the
// outside. Vertices use miter joins with the miter length
// clamped to 3× the distance (beyond the clamp the join falls
// back toward a bevel reading instead of spiking). Distance 0
// returns the input geometry itself (same reference), which is
// the bake's identity guarantee.

/** Miter length cap, as a multiple of the offset distance. */
export const PATH_OFFSET_MITER_MAX = 3;

export function offsetPolylinePoints(
  points: Float64Array,
  closed: boolean,
  distance: number,
): Float64Array {
  const n = Math.floor(points.length / 2);
  const out = new Float64Array(points.length);
  if (n === 0 || distance === 0) {
    out.set(points);
    return out;
  }
  // A closed table repeats its start point as its last point:
  // the offset ring is the unique vertices, and the duplicate
  // inherits the start vertex's offset so the closing edge
  // stays parallel.
  const duplicatesStart = closed && n >= 2
    && points[0] === points[(n - 1) * 2]
    && points[1] === points[(n - 1) * 2 + 1];
  const ring = duplicatesStart ? n - 1 : n;
  const dirAt = (i: number, j: number): { x: number; y: number } => {
    const dx = points[j * 2] - points[i * 2];
    const dy = points[j * 2 + 1] - points[i * 2 + 1];
    const len = Math.hypot(dx, dy);
    return len > 1e-12 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
  };
  for (let i = 0; i < ring; i++) {
    const prev = closed ? (i - 1 + ring) % ring : Math.max(0, i - 1);
    const next = closed ? (i + 1) % ring : Math.min(ring - 1, i + 1);
    const dIn = dirAt(prev, i);
    const dOut = dirAt(i, next);
    let nx = -dIn.y + -dOut.y;
    let ny = dIn.x + dOut.x;
    const nLen = Math.hypot(nx, ny);
    let mx: number;
    let my: number;
    let scale: number;
    if (nLen < 1e-9) {
      // Hairpin: fall back to the incoming segment's normal.
      mx = -dIn.y;
      my = dIn.x;
      scale = distance;
    } else {
      mx = nx / nLen;
      my = ny / nLen;
      // cos of the half angle between the miter direction and
      // either segment normal.
      const cosHalf = Math.max(0.34, mx * -dOut.y + my * dOut.x);
      scale = distance / cosHalf;
      const maxLen = Math.abs(distance) * PATH_OFFSET_MITER_MAX;
      if (Math.abs(scale) > maxLen) scale = Math.sign(scale) * maxLen;
    }
    out[i * 2] = points[i * 2] + mx * scale;
    out[i * 2 + 1] = points[i * 2 + 1] + my * scale;
  }
  if (duplicatesStart) {
    out[(n - 1) * 2] = out[0];
    out[(n - 1) * 2 + 1] = out[1];
  }
  return out;
}

/**
 * Offset every subpath of a geometry by `distance` (normalised
 * morph units). Returns the input unchanged (same reference)
 * when the distance is 0 or not finite.
 */
export function offsetPathGeometry(geom: PathGeometry, distance: number): PathGeometry {
  if (!Number.isFinite(distance) || distance === 0) return geom;
  const subpaths: PathSubpath[] = [];
  const offsets: number[] = [];
  let totalLength = 0;
  for (const sub of geom.subpaths) {
    const shifted = offsetPolylinePoints(sub.points, sub.closed, distance);
    const table = buildChordLengthTable(shifted);
    offsets.push(totalLength);
    totalLength += table.length;
    subpaths.push({ ...table, closed: sub.closed });
  }
  return {
    subpaths,
    totalLength,
    subpathOffsets: Float64Array.from(offsets),
    viewBox: geom.viewBox,
    sourceHash: `${geom.sourceHash}:off${distance}`,
  };
}
