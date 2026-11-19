// Phase CF: CSG extrusion (second release, U1) — profile
// generation, the implementation-side pre-checks, and the
// Manifold.extrude construction. The worker drives this
// through buildCsgOperand (lib/csgPrimitive.ts); the client
// runs the same pre-checks before transfer (lib/csg.ts).
//
// Why the pre-checks live here (final CSG brief, phase 7, as
// rewritten after the round-8/round-11 spikes): the library
// does NOT reject bad 2D input —
//   * overlapping polygons are silently unioned (two 2x2
//     squares offset by (1,1) return volume 7, NoError),
//   * a self-intersecting polygon silently returns a partial
//     solid (the bowtie returns one leaf, volume 0.25),
//   * an empty polygon list throws a bare TypeError, which
//     the worker classifies as UNKNOWN and recreates itself.
// So overlap / self-intersection / emptiness are rejected
// here, before the call, with user-facing reasons. The
// checks are pure 2D geometry with no manifold-3d or three
// dependency, so the plain-node tests exercise them directly.
//
// scaleTop trap (measured): Manifold.extrude accepts
// scaleTop as Vec2 | number, but the number form silently
// rescales (1 -> volume x0.5, 2 -> x0.667). The builder
// below always converts the spec's uniform scale to the
// Vec2 pair [s, s]; nothing in this file passes the bare
// number.

import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { CsgErrorCode, CsgExtrudeSpec } from './csgCore';

export type ExtrudePolygon = readonly (readonly [number, number])[];

export interface ExtrudePreCheck {
  ok: boolean;
  /** User-facing reason when ok is false (Japanese, panel-ready). */
  reason: string;
}

const EPS = 1e-12;

function signedArea(poly: ExtrudePolygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Orientation of c relative to the directed line a->b:
 *  +1 left, -1 right, 0 collinear (within EPS). */
function orient(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > EPS ? 1 : v < -EPS ? -1 : 0;
}

function onSegment(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): boolean {
  // c is collinear with a-b: does it lie between them?
  return (
    Math.min(a[0], b[0]) - EPS <= c[0] && c[0] <= Math.max(a[0], b[0]) + EPS &&
    Math.min(a[1], b[1]) - EPS <= c[1] && c[1] <= Math.max(a[1], b[1]) + EPS
  );
}

/** True when segments p1p2 and p3p4 intersect at all —
 *  proper crossings and mere touching both count. For the
 *  pre-checks, touching is not a safe input either: the
 *  library would union or partially drop the shape without
 *  telling anyone. */
function segmentsIntersect(
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  p4: readonly [number, number],
): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (d1 !== 0 && d2 !== 0 && d1 !== d2 && d3 !== 0 && d4 !== 0 && d3 !== d4) return true;
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

function pointInPolygon(
  pt: readonly [number, number],
  poly: ExtrudePolygon,
): boolean {
  // Ray casting; boundary points are caught earlier by the
  // segment-intersection pass, so a strict inside test is fine.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** The implementation-side pre-check for extrusion input.
 *  Rejects (with reasons): empty input, fewer than 3 points,
 *  non-finite coordinates, zero-length edges, degenerate
 *  (zero-area) polygons, self-intersecting polygons, and
 *  polygons that overlap or contain one another. Valid input
 *  passes unchanged — winding is normalised by the builder,
 *  not rejected here. */
export function validateExtrudePolygons(
  polygons: readonly ExtrudePolygon[],
): ExtrudePreCheck {
  if (polygons.length === 0) {
    return { ok: false, reason: '押し出しの断面（多角形）が空です。断面を指定してください。' };
  }
  for (const poly of polygons) {
    if (poly.length < 3) {
      return { ok: false, reason: '押し出しの断面は3点以上の多角形が必要です。' };
    }
    for (const [x, y] of poly) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, reason: '押し出しの断面に有限でない座標が含まれています。' };
      }
    }
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (dx * dx + dy * dy < EPS) {
        return { ok: false, reason: '押し出しの断面に長さゼロの辺（重なった点）があります。' };
      }
    }
    // Self-intersection BEFORE the area check: a symmetric
    // bowtie has zero signed area, and "self-intersecting"
    // is the accurate reason (the library silently returns
    // one leaf of it, so this is a hard reject).
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a1 = poly[i];
      const a2 = poly[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1) continue; // adjacent: shares a vertex
        if (i === 0 && j === n - 1) continue; // wrap-adjacent
        const b1 = poly[j];
        const b2 = poly[(j + 1) % n];
        if (segmentsIntersect(a1, a2, b1, b2)) {
          return {
            ok: false,
            reason: '押し出しの断面が自己交差しています。交差する多角形はそのままでは押し出せません。',
          };
        }
      }
    }
    if (Math.abs(signedArea(poly)) < 1e-12) {
      return { ok: false, reason: '押し出しの断面の面積がゼロです（点が一直線に並んでいます）。' };
    }
  }
  // Overlap between distinct polygons: any edge contact, or
  // one polygon inside another. The library would silently
  // union them; the brief requires the reject to be ours.
  for (let p = 0; p < polygons.length; p++) {
    for (let q = p + 1; q < polygons.length; q++) {
      const A = polygons[p];
      const B = polygons[q];
      let touching = false;
      for (let i = 0; i < A.length && !touching; i++) {
        for (let j = 0; j < B.length; j++) {
          if (
            segmentsIntersect(
              A[i], A[(i + 1) % A.length],
              B[j], B[(j + 1) % B.length],
            )
          ) {
            touching = true;
            break;
          }
        }
      }
      if (
        touching ||
        pointInPolygon(A[0], B) ||
        pointInPolygon(B[0], A)
      ) {
        return {
          ok: false,
          reason: '押し出しの断面同士が重なっています。重なる多角形は呼び出し前に弾く決まりです（ライブラリは黙って union してしまいます）。',
        };
      }
    }
  }
  return { ok: true, reason: '' };
}

/** Deterministic CCW profile for a spec. Square is centred
 *  on the origin; circle and polygon are centred rings with
 *  the first vertex on +X. */
export function generateExtrudeProfile(
  spec: CsgExtrudeSpec,
): [number, number][] {
  const s = Math.max(0.01, spec.size);
  if (spec.profile === 'square') {
    const h = s / 2;
    return [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
  }
  const r = s / 2;
  const n =
    spec.profile === 'circle'
      ? Math.min(256, Math.max(8, Math.floor(spec.segments) || 32))
      : Math.min(64, Math.max(3, Math.floor(spec.segments) || 6));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

export interface ExtrudeBuildOptions {
  height: number;
  divisions: number;
  twistDegrees: number;
  /** Uniform top scale; converted to Vec2 in the builder. */
  scaleTop: number;
}

/** Raw-polygon construction (the brief's own acceptance
 *  numbers run through this). Validates first, normalises
 *  winding to CCW, then calls Manifold.extrude with the
 *  scaleTop as a Vec2 — never as a bare number. The result
 *  is centred on z (center = true). Throws a tagged
 *  NOT_MANIFOLD error on a pre-check refusal, in the
 *  worker's classification discipline. */
export function buildExtrudeFromPolygons(
  wasm: ManifoldToplevel,
  polygons: readonly ExtrudePolygon[],
  opts: ExtrudeBuildOptions,
): Manifold {
  const check = validateExtrudePolygons(polygons);
  if (!check.ok) {
    throw Object.assign(new Error(check.reason), {
      csgCode: 'NOT_MANIFOLD' as CsgErrorCode,
    });
  }
  const ccw = polygons.map((poly) =>
    signedArea(poly) < 0 ? [...poly].reverse() : poly,
  );
  const height = Math.min(100, Math.max(0.01, opts.height));
  const divisions = Math.min(64, Math.max(0, Math.floor(opts.divisions) || 0));
  const twist = Math.min(3600, Math.max(-3600, opts.twistDegrees || 0));
  const scale = Math.min(4, Math.max(0, opts.scaleTop));
  return wasm.Manifold.extrude(
    ccw as [number, number][][],
    height,
    divisions,
    twist,
    // Vec2 pair form. The bare-number form is the trap: it
    // silently rescales (1 -> volume x0.5). Both the pair and
    // the {x, y} object forms are runtime-valid (verified
    // against 3.5.4 in Node); the pair matches the .d.ts.
    [scale, scale],
    true,
  );
}

export function buildCsgExtrude(wasm: ManifoldToplevel, spec: CsgExtrudeSpec): Manifold {
  const profile = generateExtrudeProfile(spec);
  const m = buildExtrudeFromPolygons(wasm, [profile], {
    height: spec.height,
    divisions: spec.divisions,
    twistDegrees: spec.twistDegrees,
    scaleTop: spec.scaleTop,
  });
  const [ox, oy, oz] = spec.offset;
  if (ox !== 0 || oy !== 0 || oz !== 0) return m.translate([ox, oy, oz]);
  return m;
}
