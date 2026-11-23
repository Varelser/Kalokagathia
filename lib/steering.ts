// Phase 18 stage 4 — steering preparation (seek / arrive / path
// following / two-state switching), as pure functions.
//
// The crowd vocabulary already existed in pieces — pursue / evade
// in lib/particleLifeBehavior.ts, obstacle avoidance against the
// SDF collider — but there was no seek/arrive pair, no path
// following, and no state switching. This module adds those as a
// CPU-side preparation ONLY: nothing here is wired into the GPU
// passes or the shaders in this stage, so no existing path can
// change behaviour. The formulas follow the classic Reynolds
// steering form (desired velocity minus current velocity, clamped
// to a max force), so a later GPU twin has an exact specification
// to mirror, the same discipline lib/particleLifeBehavior.ts uses.

import type { Vec3Like } from './particleLifeBehavior';

export type { Vec3Like };

function vec(x = 0, y = 0, z = 0): Vec3Like {
  return { x, y, z };
}

function length(v: Vec3Like): number {
  return Math.hypot(v.x, v.y, v.z);
}

function clampForce(force: Vec3Like, maxForce: number): Vec3Like {
  if (!(maxForce > 0)) return force;
  const len = length(force);
  if (len <= maxForce || len === 0) return force;
  const k = maxForce / len;
  return { x: force.x * k, y: force.y * k, z: force.z * k };
}

function finiteSpeed(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * Seek: steering force toward `target` at full `maxSpeed`.
 * desired = normalize(target - pos) * maxSpeed; steer = desired -
 * vel, clamped to maxForce when maxForce > 0. At the target the
 * desired velocity is zero, so the steer is simply -vel.
 */
export function seekForce(
  pos: Vec3Like,
  vel: Vec3Like,
  target: Vec3Like,
  maxSpeed: number,
  maxForce = 0,
): Vec3Like {
  const speed = finiteSpeed(maxSpeed, 0);
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const d = Math.hypot(dx, dy, dz);
  const desired = d > 0
    ? vec((dx / d) * speed, (dy / d) * speed, (dz / d) * speed)
    : vec();
  return clampForce(vec(desired.x - vel.x, desired.y - vel.y, desired.z - vel.z), maxForce);
}

/**
 * Arrive: like seek, but the desired speed ramps down linearly
 * inside `slowingRadius` (speed * distance / slowingRadius), so
 * the particle settles on the target instead of orbiting it. At
 * or beyond the radius it is exactly seek. A non-positive radius
 * also degrades to seek.
 */
export function arriveForce(
  pos: Vec3Like,
  vel: Vec3Like,
  target: Vec3Like,
  maxSpeed: number,
  slowingRadius: number,
  maxForce = 0,
): Vec3Like {
  const speed = finiteSpeed(maxSpeed, 0);
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dz = target.z - pos.z;
  const d = Math.hypot(dx, dy, dz);
  if (d === 0) return clampForce(vec(-vel.x, -vel.y, -vel.z), maxForce);
  const effective = slowingRadius > 0 && d < slowingRadius ? (speed * d) / slowingRadius : speed;
  const desired = vec((dx / d) * effective, (dy / d) * effective, (dz / d) * effective);
  return clampForce(vec(desired.x - vel.x, desired.y - vel.y, desired.z - vel.z), maxForce);
}

// ---------------------------------------------------------------------------
// Path following over a point list (lib/pathGeometry.ts PathPt shape)

export interface PathPointLike {
  x: number;
  y: number;
  z?: number;
}

/**
 * The path-following target: the point on the polyline closest to
 * `pos`, advanced `lookAhead` of arc length along the path
 * (clamped at the final point). Points are PathPt-shaped ({x, y},
 * z defaults to the first point's z / 0); the closest point is the
 * true segment projection, not just the nearest vertex, so a
 * particle beside a long segment aims at the point beside it —
 * shifted ahead — rather than at a distant vertex. An empty point
 * list returns `pos` itself (no target, no force downstream).
 */
export function pathFollowTarget(
  points: readonly PathPointLike[],
  pos: Vec3Like,
  lookAhead = 0,
): Vec3Like {
  if (points.length === 0) return { ...pos };
  const pt = (p: PathPointLike): Vec3Like => vec(p.x, p.y, p.z ?? 0);
  if (points.length === 1) return pt(points[0]);
  // Closest projection over all segments, tracking arc position.
  let bestDistSq = Infinity;
  let bestArc = 0;
  let arcBefore = 0;
  const segLens: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = pt(points[i]);
    const b = pt(points[i + 1]);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const segLen = Math.hypot(abx, aby, abz);
    segLens.push(segLen);
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (lenSq > 0) {
      t = ((pos.x - a.x) * abx + (pos.y - a.y) * aby + (pos.z - a.z) * abz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const qz = a.z + abz * t;
    const distSq = (pos.x - qx) ** 2 + (pos.y - qy) ** 2 + (pos.z - qz) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestArc = arcBefore + segLen * t;
    }
    arcBefore += segLen;
  }
  const total = arcBefore;
  const targetArc = Math.max(0, Math.min(total, bestArc + Math.max(0, lookAhead)));
  // Walk to targetArc.
  let arc = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const segLen = segLens[i];
    if (targetArc <= arc + segLen || i === points.length - 2) {
      const a = pt(points[i]);
      const b = pt(points[i + 1]);
      const t = segLen > 0 ? Math.max(0, Math.min(1, (targetArc - arc) / segLen)) : 0;
      return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    arc += segLen;
  }
  return pt(points[points.length - 1]);
}

/** Seek force toward the path-following target. */
export function pathFollowForce(
  points: readonly PathPointLike[],
  pos: Vec3Like,
  vel: Vec3Like,
  maxSpeed: number,
  lookAhead = 0,
  maxForce = 0,
): Vec3Like {
  return seekForce(pos, vel, pathFollowTarget(points, pos, lookAhead), maxSpeed, maxForce);
}

// ---------------------------------------------------------------------------
// Two-state minimum: a particle's state read off an attribute slot

export type SlotState = 0 | 1;

/**
 * Interpret an attribute slot value as two states: below the
 * threshold is state 0, at or above it is state 1. The threshold
 * defaults to 0.5 (slot values live in 0..1 after the bake clamp).
 * Non-finite values read as state 0.
 */
export function stateFromSlot(value: number, threshold = 0.5): SlotState {
  if (!Number.isFinite(value)) return 0;
  const t = Number.isFinite(threshold) ? threshold : 0.5;
  return value >= t ? 1 : 0;
}

export interface SteeringStateTargets {
  /** Target while in state 0. */
  target0: Vec3Like;
  /** Target while in state 1. */
  target1: Vec3Like;
  maxSpeed: number;
  /** Slowing radius for the arrive state (default 0 = pure seek). */
  slowingRadius?: number;
  maxForce?: number;
  /** Slot threshold for stateFromSlot (default 0.5). */
  threshold?: number;
  /** Behaviour per state; defaults: state 0 seeks, state 1 arrives
   *  (when a slowing radius is given; otherwise it also seeks). */
  mode0?: 'seek' | 'arrive';
  mode1?: 'seek' | 'arrive';
}

/**
 * Steering force for the particle's current two-state reading:
 * pick the state's target and behaviour, then seek / arrive.
 */
export function steeringForState(
  pos: Vec3Like,
  vel: Vec3Like,
  slotValue: number,
  opts: SteeringStateTargets,
): Vec3Like {
  const state = stateFromSlot(slotValue, opts.threshold);
  const target = state === 0 ? opts.target0 : opts.target1;
  const mode = state === 0 ? (opts.mode0 ?? 'seek') : (opts.mode1 ?? 'arrive');
  const maxForce = opts.maxForce ?? 0;
  if (mode === 'arrive') {
    return arriveForce(pos, vel, target, opts.maxSpeed, opts.slowingRadius ?? 0, maxForce);
  }
  return seekForce(pos, vel, target, opts.maxSpeed, maxForce);
}
