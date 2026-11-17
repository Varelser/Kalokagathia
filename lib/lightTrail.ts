/**
 * Light trail ribbon (Phase Y, Tao light-trajectory path).
 *
 * The Phase T light object moves — its position keys are animated
 * by sequences / UI / external control — but until now that
 * movement left no shape behind: Tao's "light trajectory path"
 * row stayed at △ because no generator turned the trajectory
 * into geometry. This module is that generator.
 *
 * The path is the light's position history (sampled once per
 * rendered frame by components/LightVolume.tsx, in frame order —
 * never from the wall clock, so a deterministic render job that
 * drives the light deterministically reproduces the same path
 * bit-for-bit). The pure builder below turns a point list into a
 * camera-facing ribbon using the Phase S path basis
 * (lib/pathGeometry.ts): arc lengths come from its chord-length
 * table over the XY projection, the width profile from its
 * taper function, and resampling is equidistant by arc length —
 * the same "authored path" grammar as the morph paths, applied
 * to the light's trajectory. No new path basis is created.
 *
 * Ribbon orientation: the scene camera looks down -Z, so the
 * ribbon is built in the XY plane (offsets along the 2D path
 * normal, z carried by linear interpolation). Brightness is
 * carried as vertex colour under additive blending: colour =
 * white * alpha(u), alpha(u) = u^fade with u = 0 at the oldest
 * point and 1 at the light's current position.
 *
 * Everything here is a pure function of its inputs: same history
 * in, bit-identical ribbon out (pinned by the unit tests).
 */

import { buildChordLengthTable, taperWidthAt } from './pathGeometry';

export interface TrailVec3 {
  x: number;
  y: number;
  z: number;
}

export interface LightTrailParams {
  /** Full ribbon width in world units at the head (u = 1). */
  width: number;
  /** Fade exponent: alpha(u) = u^fade, clamped to [0, 4]. */
  fade: number;
  /** Resampled ribbon stations (clamped to [2, 128]). */
  segments?: number;
}

export interface LightTrailRibbon {
  /** Triangle-strip vertex positions, 2 per station (left, right). */
  positions: Float32Array;
  /** Per-vertex brightness in [0, 1] (matches the positions order). */
  brightness: Float32Array;
  /** Triangle indices into the strip vertices. */
  indices: Uint32Array;
  /** Total arc length of the resampled path (XY projection). */
  totalLength: number;
  /** Number of ribbon stations. */
  stations: number;
}

export const LIGHT_TRAIL_MAX_POINTS = 96;
export const LIGHT_TRAIL_MIN_MOVE = 0.5;

/** Append a position to a history, honouring the movement epsilon and cap. */
export function appendTrailPoint(
  history: readonly TrailVec3[],
  point: TrailVec3,
  minMove: number = LIGHT_TRAIL_MIN_MOVE,
  maxPoints: number = LIGHT_TRAIL_MAX_POINTS,
): TrailVec3[] {
  const last = history[history.length - 1];
  if (last) {
    const d = Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z);
    if (!(d >= minMove)) return history as TrailVec3[];
  }
  const next = [...history, { x: point.x, y: point.y, z: point.z }];
  return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
}

export function clampTrailFade(fade: number): number {
  if (!Number.isFinite(fade)) return 1.5;
  return Math.max(0, Math.min(4, fade));
}

/** Brightness at path parameter u (0 = oldest, 1 = head). */
export function trailBrightnessAt(u: number, fade: number): number {
  const uu = Math.max(0, Math.min(1, u));
  return Math.pow(uu, clampTrailFade(fade));
}

/** Width factor at u: the Phase S linear taper, read head-first. */
export function trailWidthFactorAt(u: number): number {
  const uu = Math.max(0, Math.min(1, u));
  // taperWidthAt(1 - u, 1, 'linear') === u exactly; the 0.05 floor
  // keeps the tail from collapsing to a degenerate zero width.
  return 0.05 + 0.95 * taperWidthAt(1 - uu, 1, 'linear');
}

/**
 * Build the ribbon for a history of >= 2 points. Returns null when
 * there is nothing to draw (fewer than 2 points, zero XY arc
 * length, or a non-positive width).
 */
export function buildLightTrailRibbon(
  history: readonly TrailVec3[],
  params: LightTrailParams,
): LightTrailRibbon | null {
  if (history.length < 2 || !(params.width > 0)) return null;
  const segments = Math.max(2, Math.min(128, Math.round(params.segments ?? 48)));
  // Arc-length basis from the Phase S chord table (XY projection —
  // the ribbon's own plane). Z is interpolated by the same segment
  // parameter, so a purely-vertical (XY-degenerate) history draws
  // nothing; that is the documented planar limit of the ribbon.
  const xy = new Float64Array(history.length * 2);
  for (let i = 0; i < history.length; i++) {
    xy[i * 2] = history[i].x;
    xy[i * 2 + 1] = history[i].y;
  }
  const table = buildChordLengthTable(xy);
  if (!(table.length > 0)) return null;

  const stations = segments + 1;
  const positions = new Float32Array(stations * 2 * 3);
  const brightness = new Float32Array(stations * 2);
  const indices = new Uint32Array(segments * 6);

  // Walk the table once, emitting equidistant stations.
  let seg = 0;
  for (let k = 0; k < stations; k++) {
    const u = k / segments;
    const target = u * table.length;
    while (seg < history.length - 2 && table.cumLen[seg + 1] < target) seg++;
    const segLen = table.cumLen[seg + 1] - table.cumLen[seg];
    const t = segLen > 0 ? (target - table.cumLen[seg]) / segLen : 0;
    const a = history[seg];
    const b = history[seg + 1];
    const cx = a.x + (b.x - a.x) * t;
    const cy = a.y + (b.y - a.y) * t;
    const cz = a.z + (b.z - a.z) * t;
    // Tangent from the segment direction (fall back to neighbours
    // at degenerate joints, then to +X).
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const tl = Math.hypot(tx, ty);
    if (tl > 0) {
      tx /= tl;
      ty /= tl;
    } else {
      tx = 1;
      ty = 0;
    }
    const nx = -ty;
    const ny = tx;
    const half = (params.width / 2) * trailWidthFactorAt(u);
    const o = k * 6;
    positions[o] = cx + nx * half;
    positions[o + 1] = cy + ny * half;
    positions[o + 2] = cz;
    positions[o + 3] = cx - nx * half;
    positions[o + 4] = cy - ny * half;
    positions[o + 5] = cz;
    const bright = trailBrightnessAt(u, params.fade);
    brightness[k * 2] = bright;
    brightness[k * 2 + 1] = bright;
    if (k < segments) {
      const v = k * 2;
      const io = k * 6;
      indices[io] = v;
      indices[io + 1] = v + 1;
      indices[io + 2] = v + 2;
      indices[io + 3] = v + 1;
      indices[io + 4] = v + 3;
      indices[io + 5] = v + 2;
    }
  }
  return { positions, brightness, indices, totalLength: table.length, stations };
}
