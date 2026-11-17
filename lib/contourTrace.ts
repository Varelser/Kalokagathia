// ── Contour tracing (Phase AM) ─────────────────────────────────
// Vectorise the outline of a luma image: marching squares over
// the grid at a threshold, segment chaining by shared grid
// edges, and a PathGeometry in the same normalised morph space
// the media targets use (sampleMediaPoint's mapping: x × 1.15,
// y flipped × 1.15 × (h / w)), so the traced contours overlay
// the source image's own point cloud. Pure functions only — the
// morph bake consumes the geometry exactly like the authored
// SVG path geometry (lib/pathGeometry.ts), which is what turns
// "an edge mask exists" into "particles can be placed ON the
// outline as a path" (2D audit §1).
//
// Edge points are computed from a canonical per-edge formula
// (each grid edge has exactly one definition, shared by the two
// adjacent cells), so the two cells that share an edge produce
// bit-identical endpoints and chaining by edge id is exact.

import {
  buildChordLengthTable,
  type PathGeometry,
  type PathSubpath,
} from './pathGeometry';

/** One traced polyline in continuous grid coordinates
 *  (pixel centres sit at +0.5). */
export interface ContourPolyline {
  points: Array<{ x: number; y: number }>;
  closed: boolean;
}

type EdgeKey = string;

interface Segment {
  aKey: EdgeKey;
  bKey: EdgeKey;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  used: boolean;
}

/**
 * Marching squares over `map` (row 0 = top, values 0..1) at
 * `threshold`. Returns the contour polylines in grid
 * coordinates, chained from the raw cell segments. A blank or
 * saturated grid yields an empty array.
 */
export function traceContourPolylines(
  map: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): ContourPolyline[] {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w < 2 || h < 2 || map.length < w * h) return [];
  const t = Number.isFinite(threshold) ? threshold : 0.3;
  const v = (x: number, y: number): number => map[y * w + x] ?? 0;

  // Canonical edge points. H(x, y): the horizontal grid edge
  // from corner (x, y) to (x + 1, y). V(x, y): the vertical edge
  // from (x, y) to (x, y + 1). Each returns null when the edge
  // does not cross the threshold.
  const hEdge = (x: number, y: number): { x: number; y: number } | null => {
    const va = v(x, y);
    const vb = v(x + 1, y);
    if ((va >= t) === (vb >= t)) return null;
    const f = (t - va) / (vb - va);
    return { x: x + Math.max(0, Math.min(1, f)), y };
  };
  const vEdge = (x: number, y: number): { x: number; y: number } | null => {
    const va = v(x, y);
    const vb = v(x, y + 1);
    if ((va >= t) === (vb >= t)) return null;
    const f = (t - va) / (vb - va);
    return { x, y: y + Math.max(0, Math.min(1, f)) };
  };

  const segments: Segment[] = [];
  const push = (
    aKey: EdgeKey, a: { x: number; y: number } | null,
    bKey: EdgeKey, b: { x: number; y: number } | null,
  ) => {
    if (!a || !b) return;
    segments.push({ aKey, bKey, ax: a.x, ay: a.y, bx: b.x, by: b.y, used: false });
  };

  for (let y = 0; y + 1 < h; y++) {
    for (let x = 0; x + 1 < w; x++) {
      const a = v(x, y) >= t ? 8 : 0;
      const b = v(x + 1, y) >= t ? 4 : 0;
      const c = v(x + 1, y + 1) >= t ? 2 : 0;
      const d = v(x, y + 1) >= t ? 1 : 0;
      const idx = a | b | c | d;
      if (idx === 0 || idx === 15) continue;
      const top = () => hEdge(x, y);
      const right = () => vEdge(x + 1, y);
      const bottom = () => hEdge(x, y + 1);
      const left = () => vEdge(x, y);
      const kT = `H:${x}:${y}`;
      const kR = `V:${x + 1}:${y}`;
      const kB = `H:${x}:${y + 1}`;
      const kL = `V:${x}:${y}`;
      switch (idx) {
        case 1: push(kL, left(), kB, bottom()); break;
        case 2: push(kB, bottom(), kR, right()); break;
        case 3: push(kL, left(), kR, right()); break;
        case 4: push(kT, top(), kR, right()); break;
        case 6: push(kT, top(), kB, bottom()); break;
        case 7: push(kT, top(), kL, left()); break;
        case 8: push(kT, top(), kL, left()); break;
        case 9: push(kT, top(), kB, bottom()); break;
        case 11: push(kT, top(), kR, right()); break;
        case 12: push(kL, left(), kR, right()); break;
        case 13: push(kB, bottom(), kR, right()); break;
        case 14: push(kL, left(), kB, bottom()); break;
        case 5:
        case 10: {
          // Saddle: decide by the centre average (asymptotic
          // decider lite) — the centre reads as inside when its
          // value reaches the threshold.
          const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4;
          const centreIn = centre >= t;
          if ((idx === 5) === centreIn) {
            push(kT, top(), kR, right());
            push(kL, left(), kB, bottom());
          } else {
            push(kT, top(), kL, left());
            push(kR, right(), kB, bottom());
          }
          break;
        }
        default:
          break;
      }
    }
  }
  if (segments.length === 0) return [];

  // Chain segments into polylines through shared edge ids.
  const byEdge = new Map<EdgeKey, number[]>();
  segments.forEach((seg, i) => {
    for (const key of [seg.aKey, seg.bKey]) {
      const list = byEdge.get(key);
      if (list) list.push(i);
      else byEdge.set(key, [i]);
    }
  });
  const takeNext = (edgeKey: EdgeKey, from: number): number => {
    const list = byEdge.get(edgeKey) ?? [];
    for (const i of list) {
      if (i !== from && !segments[i].used) return i;
    }
    return -1;
  };

  const polylines: ContourPolyline[] = [];
  for (let s = 0; s < segments.length; s++) {
    if (segments[s].used) continue;
    segments[s].used = true;
    const pts: Array<{ x: number; y: number }> = [
      { x: segments[s].ax, y: segments[s].ay },
      { x: segments[s].bx, y: segments[s].by },
    ];
    let headKey = segments[s].aKey;
    let tailKey = segments[s].bKey;
    let headSeg = s;
    let tailSeg = s;
    // Extend the tail.
    for (;;) {
      const next = takeNext(tailKey, tailSeg);
      if (next < 0) break;
      const seg = segments[next];
      seg.used = true;
      if (seg.aKey === tailKey) {
        pts.push({ x: seg.bx, y: seg.by });
        tailKey = seg.bKey;
      } else {
        pts.push({ x: seg.ax, y: seg.ay });
        tailKey = seg.aKey;
      }
      tailSeg = next;
    }
    // Extend the head.
    for (;;) {
      const next = takeNext(headKey, headSeg);
      if (next < 0) break;
      const seg = segments[next];
      seg.used = true;
      if (seg.aKey === headKey) {
        pts.unshift({ x: seg.bx, y: seg.by });
        headKey = seg.bKey;
      } else {
        pts.unshift({ x: seg.ax, y: seg.ay });
        headKey = seg.aKey;
      }
      headSeg = next;
    }
    const closed = headKey === tailKey && pts.length > 2;
    if (closed) {
      // The walk returned to its start edge: the last point is
      // the first point reached from the other side — drop the
      // duplicate and record the loop as closed (the chord
      // table's final point convention keeps s = 1 == s = 0).
      pts.pop();
      pts.push({ ...pts[0] });
    }
    if (pts.length >= 2) polylines.push({ points: pts, closed });
  }
  return polylines;
}

/**
 * Trace a luma grid's contours straight into a PathGeometry in
 * normalised morph space (the media mapping), ready for the
 * morph bake's path-style placement. Returns null when the grid
 * has no contour at the threshold.
 */
export function traceContourGeometry(
  map: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): PathGeometry | null {
  const w = Math.floor(width);
  const h = Math.floor(height);
  const polylines = traceContourPolylines(map, w, h, threshold);
  if (polylines.length === 0) return null;
  const subpaths: PathSubpath[] = [];
  const offsets: number[] = [];
  let totalLength = 0;
  for (const line of polylines) {
    const flat = new Float64Array(line.points.length * 2);
    for (let k = 0; k < line.points.length; k++) {
      flat[k * 2] = ((line.points[k].x / w) * 2 - 1) * 1.15;
      flat[k * 2 + 1] = (1 - (line.points[k].y / h) * 2) * 1.15 * (h / w);
    }
    const table = buildChordLengthTable(flat);
    if (table.length <= 0 || table.points.length < 4) continue;
    offsets.push(totalLength);
    totalLength += table.length;
    subpaths.push({ ...table, closed: line.closed });
  }
  if (subpaths.length === 0 || totalLength <= 0) return null;
  return {
    subpaths,
    totalLength,
    subpathOffsets: Float64Array.from(offsets),
    viewBox: null,
    sourceHash: `contour:${w}x${h}:${threshold}`,
  };
}
