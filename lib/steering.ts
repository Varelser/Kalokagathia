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
//
// Phase 20 stage 2: the GPU twin now exists — the 'steer-seek'
// force chunk in the velocity pass (GLSL in
// components/gpgpuShaderSimulationVelocityMainForces.ts, WGSL in
// lib/webgpuCompute.ts), spliced in only by the Phase 20 shader
// variant while gpgpuSteerSeekEnabled is on, so the OFF path is
// still byte-identical. The pure functions above remain the exact
// specification the twins mirror; resolveSteeringSeek below is
// the single resolution point both passes read.

import type { Vec3Like } from './particleLifeBehavior';
import type { ParticleConfig } from '../types';

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
// ---------------------------------------------------------------------------
// Phase 20 stage 2 — GPU wiring resolution (config -> uniform set)

/** Max path points the GPU twins carry (uniform array size). */
export const STEERING_PATH_MAX = 8;

/** Mode ids shared by the GLSL / WGSL twins and the passes. */
export const STEER_SEEK_MODE_IDS = { seek: 0, arrive: 1, path: 2, state: 3 } as const;

/**
 * Parse the gpgpuSteerSeekPath key: semicolon-separated "x,y,z"
 * triples (y may be omitted, PathPt-style, defaulting z to 0 —
 * a two-component entry reads as x,y with z = 0). Malformed
 * entries are skipped, non-finite numbers reject the entry, and
 * the result is capped at STEERING_PATH_MAX points.
 */
export function parseSteeringPath(text?: string | null): Vec3Like[] {
  if (!text) return [];
  const points: Vec3Like[] = [];
  for (const entry of String(text).split(';')) {
    const parts = entry.split(',').map((s) => Number(s.trim()));
    if (parts.length < 2 || parts.length > 3) continue;
    if (parts.some((n) => !Number.isFinite(n))) continue;
    points.push(vec(parts[0], parts[1], parts.length === 3 ? parts[2] : 0));
    if (points.length >= STEERING_PATH_MAX) break;
  }
  return points;
}

/** Pack path points into the uniform array layout (xyz per point). */
export function packSteeringPath(points: readonly Vec3Like[]): Float32Array {
  const out = new Float32Array(STEERING_PATH_MAX * 3);
  const n = Math.min(points.length, STEERING_PATH_MAX);
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = points[i].x;
    out[i * 3 + 1] = points[i].y;
    out[i * 3 + 2] = points[i].z;
  }
  return out;
}

export interface SteeringSeekResolved {
  active: boolean;
  modeId: number;
  strength: number;
  maxSpeed: number;
  maxForce: number;
  target: Vec3Like;
  target1: Vec3Like;
  slowingRadius: number;
  stateSlot: number;
  stateThreshold: number;
  path: Vec3Like[];
  pathPacked: Float32Array;
  pathLookAhead: number;
  pathRadius: number;
}

const clampNum = (v: number, lo: number, hi: number, fallback: number): number =>
  (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

/**
 * The single resolution point for the steer-seek keys. Every
 * consumer (variant selection, WebGL uniforms, WebGPU force
 * params) reads through here so the clamps can never drift.
 */
export function resolveSteeringSeek(config: ParticleConfig): SteeringSeekResolved {
  const path = parseSteeringPath(config.gpgpuSteerSeekPath);
  return {
    active: !!config.gpgpuSteerSeekEnabled,
    modeId: STEER_SEEK_MODE_IDS[config.gpgpuSteerSeekMode] ?? 0,
    strength: clampNum(config.gpgpuSteerSeekStrength, 0, 100, 0),
    maxSpeed: clampNum(config.gpgpuSteerSeekMaxSpeed, 0, 1e6, 0),
    maxForce: clampNum(config.gpgpuSteerSeekMaxForce, 0, 1e6, 0),
    target: vec(
      clampNum(config.gpgpuSteerSeekTargetX, -1e6, 1e6, 0),
      clampNum(config.gpgpuSteerSeekTargetY, -1e6, 1e6, 0),
      clampNum(config.gpgpuSteerSeekTargetZ, -1e6, 1e6, 0),
    ),
    target1: vec(
      clampNum(config.gpgpuSteerSeekTarget1X, -1e6, 1e6, 0),
      clampNum(config.gpgpuSteerSeekTarget1Y, -1e6, 1e6, 0),
      clampNum(config.gpgpuSteerSeekTarget1Z, -1e6, 1e6, 0),
    ),
    slowingRadius: clampNum(config.gpgpuSteerSeekSlowingRadius, 0, 1e6, 0),
    stateSlot: Math.round(clampNum(config.gpgpuSteerSeekStateSlot, 0, 3, 0)),
    stateThreshold: clampNum(config.gpgpuSteerSeekStateThreshold, 0, 1, 0.5),
    path,
    pathPacked: packSteeringPath(path),
    pathLookAhead: clampNum(config.gpgpuSteerSeekPathLookAhead, 0, 1e6, 0),
    pathRadius: clampNum(config.gpgpuSteerSeekPathRadius, 0, 1e6, 0),
  };
}

// ---------------------------------------------------------------------------
// Crowd state machine + lanes (Round 84 gap 2, stage 1: design
// R83-02 #8 dbgame, numeric spec R84-02 #2 staff). A three-state
// machine — IDLE / MOVE / AVOID — evaluated as a MEMORYLESS pure
// function of the current frame's inputs (position-derived SDF
// distance, velocity, target distance), plus lane grammar on top
// of the path mode. The GPU twins (the crowd variant of the
// GLSL steer chunk, the WGSL steer block) mirror these formulas
// exactly, the same discipline as the steering twins above.
// Stage 1 limits, by design: no per-particle memory exists
// (pos.w is age, vel.w is the Kuramoto phase, the velocity
// fragment is at 16/16 samplers, the WGSL velocity stage at
// 8/8 storage buffers), so hysteresis is approximated by using
// the current velocity as the previous state's proxy — inside
// the hysteresis band a state persists only while the velocity
// still points the way that state would push it.

/** Crowd state ids shared by the CPU spec and the GPU twins. */
export const CROWD_STATE_IDS = { idle: 0, move: 1, avoid: 2 } as const;

/** The AVOID entry range: the key value, or the Phase 15
 *  fallback (1.5 * the SDF size, at least 1) while it is 0. */
export function crowdAvoidRangeResolved(range: number, sdfSize: number): number {
  return range > 0 ? range : Math.max(sdfSize * 1.5, 1.0);
}

export interface CrowdStateInputs {
  /** Whether the SDF collider is enabled (sd/normal valid). */
  sdfEnabled: boolean;
  /** Signed distance to the SDF collider surface. */
  sd: number;
  /** Velocity component along the SDF normal (>0 = leaving). */
  velNormal: number;
  /** Speed magnitude. */
  speed: number;
  /** Distance to the current steering target. */
  distToTarget: number;
  /** Velocity component toward the target (>0 = approaching). */
  towardTarget: number;
}

export interface CrowdStateParams {
  /** Resolved AVOID entry range (crowdAvoidRangeResolved). */
  avoidRange: number;
  /** AVOID exit range = avoidRange * (1 + hysteresis). */
  avoidHysteresis: number;
  idleSpeed: number;
  idleSpeedOut: number;
  /** Resolved arrival radius (key, or the slowing radius). */
  idleRadius: number;
}

/**
 * The stage-1 transition table (spec R84-02 §1.2, P1-P5) as a
 * pure function. Priority order:
 * - P1: sd < Rin -> AVOID (avoidance beats everything).
 * - P2 (band): Rin <= sd < Rout and still moving away from the
 *   surface (velNormal > 0) -> AVOID persists; otherwise the
 *   band does not capture the particle.
 * - P3: distToTarget < idleRadius and speed < idleSpeed ->
 *   IDLE. In the speed band [idleSpeed, idleSpeedOut) IDLE
 *   persists only while not approaching the target
 *   (towardTarget <= 0) — the velocity-as-proxy hysteresis.
 * - P4/P5: everything else -> MOVE.
 */
export function crowdStateFor(input: CrowdStateInputs, params: CrowdStateParams): number {
  if (input.sdfEnabled) {
    const rOut = params.avoidRange * (1 + params.avoidHysteresis);
    if (input.sd < params.avoidRange) return CROWD_STATE_IDS.avoid;
    if (input.sd < rOut && input.velNormal > 0) return CROWD_STATE_IDS.avoid;
  }
  if (input.distToTarget < params.idleRadius) {
    if (input.speed < params.idleSpeed) return CROWD_STATE_IDS.idle;
    if (input.speed < params.idleSpeedOut && input.towardTarget <= 0) return CROWD_STATE_IDS.idle;
  }
  return CROWD_STATE_IDS.move;
}

// ---------------------------------------------------------------------------
// Multi-obstacle crowd avoidance (crowd multi-obstacle stage).
// Gate 43's M8 finding limited the crowd's obstacle to the ONE
// analytic SDF primitive. The scene's other colliders are the
// mesh SDF bodies (Phase 41: up to 4 atlas bodies, or the single
// mesh body), whose distance queries already live in the GLSL
// velocity pass (meshSdfBodyDistance / meshSdfDistance in the
// velocity helpers, over the already-bound uMeshSdfTex — no new
// sampler). The composition mirrors the position pass's
// multi-body min synthesis: every obstacle is evaluated, the
// SMALLEST sd wins, and that one body drives the state machine
// and the AVOID normal (the position pass pushes out once,
// along the deepest body; the crowd steers once, away from the
// nearest body). Obstacle order is fixed — analytic primitive
// first, then mesh bodies by index, then the single mesh body —
// and ties keep the earlier obstacle (strict <), exactly as the
// position pass's best-body scan does. The obstacle cap is
// therefore 1 + 4 = 5, set by the multi-body atlas cap.
//
// The WGSL route has no mesh SDF subsystem at all (the mesh
// colliders themselves are WebGL-only, like the rigid bodies),
// so the WGSL crowd keeps evaluating the analytic obstacle
// only; the composition below is the CPU spec of the selection
// both routes share for that obstacle.

/** One obstacle's crowd sample for a particle: its signed
 *  distance and the velocity component along its outward
 *  normal (>0 = leaving that obstacle). */
export interface CrowdObstacleSample {
  sd: number;
  velNormal: number;
}

/** The most imminent obstacle: the index of the smallest sd in
 *  `samples` (ties keep the lowest index), or -1 when the list
 *  is empty or every sd is non-finite (a NaN distance never
 *  wins, mirroring the shaders' +1e6 "no collision" answer for
 *  out-of-domain mesh queries). */
export function crowdSelectObstacle(samples: readonly CrowdObstacleSample[]): number {
  let best = -1;
  let bestSd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const sd = samples[i].sd;
    if (Number.isFinite(sd) && sd < bestSd) {
      bestSd = sd;
      best = i;
    }
  }
  return best;
}

/** The rest of the crowd inputs, without the obstacle fields
 *  (CrowdStateInputs minus sdfEnabled / sd / velNormal). */
export type CrowdStateRestInputs = Omit<CrowdStateInputs, 'sdfEnabled' | 'sd' | 'velNormal'>;

/**
 * The multi-obstacle transition law: select the most imminent
 * obstacle (crowdSelectObstacle) and run the stage-1 table
 * (crowdStateFor) on that obstacle alone. With zero obstacles
 * the machine sees sdfEnabled = false; with exactly one
 * obstacle the result is crowdStateFor's, bit for bit — the
 * single-obstacle scene is the Gate 43 special case.
 */
export function crowdStateForObstacles(
  samples: readonly CrowdObstacleSample[],
  rest: CrowdStateRestInputs,
  params: CrowdStateParams,
): number {
  const winner = crowdSelectObstacle(samples);
  if (winner < 0) {
    return crowdStateFor({ ...rest, sdfEnabled: false, sd: 0, velNormal: 0 }, params);
  }
  const w = samples[winner];
  return crowdStateFor({ ...rest, sdfEnabled: true, sd: w.sd, velNormal: w.velNormal }, params);
}

/**
 * Lane assignment (spec R84-02 §2, option (a) fixed): the baked
 * attribute slot value picks the lane deterministically —
 * lane = min(floor(slot * laneCount), laneCount - 1), with the
 * slot clamped to 0..1 (non-finite reads as 0).
 */
export function crowdLaneIndex(slotValue: number, laneCount: number): number {
  const c = Math.max(1, Math.min(4, Math.round(laneCount)));
  const s = Number.isFinite(slotValue) ? Math.max(0, Math.min(1, slotValue)) : 0;
  return Math.min(Math.floor(s * c), c - 1);
}

/** Lane centre offset from the centre path: lanes are spaced
 *  two widths apart, centred on the path, shifted by the base
 *  offset (spec R84-02 §2). */
export function crowdLaneCenterOffset(lane: number, laneCount: number, laneWidth: number, laneOffset: number): number {
  return laneOffset + (lane - (laneCount - 1) / 2) * (laneWidth * 2);
}

/** Per-lane look-ahead: faster lanes look further ahead
 *  (spec R84-02 §2). */
export function crowdLaneLookAhead(baseLookAhead: number, lane: number, scale: number): number {
  return baseLookAhead * (1 + 0.25 * lane) * scale;
}

/**
 * The lateral direction of a path tangent: normalize(cross(+Y,
 * tangent)). When the tangent is (near-)parallel to +Y the
 * cross degenerates; the fallback is cross(+Z, tangent), and
 * for a zero tangent +X (spec R84-02 §2 / design U9, decided
 * here and mirrored by the GPU twins).
 */
export function crowdLateralDir(tangent: Vec3Like): Vec3Like {
  let lx = tangent.z; let ly = 0; let lz = -tangent.x;
  let len = Math.hypot(lx, ly, lz);
  if (len < 1e-4) {
    lx = -tangent.y; ly = tangent.x; lz = 0;
    len = Math.hypot(lx, ly, lz);
    if (len < 1e-4) return vec(1, 0, 0);
  }
  return vec(lx / len, ly / len, lz / len);
}

/**
 * The AVOID state's push strength: the Phase 15 steer-avoid
 * strength while the user set one; otherwise 1, so the state
 * machine can avoid on its own (the crowd keys alone enable a
 * working machine; the avoid strength key still scales it
 * whenever it is positive).
 */
export function crowdAvoidStrength(steerAvoid: number): number {
  return steerAvoid > 0 ? steerAvoid : 1;
}

export interface CrowdResolved {
  enabled: boolean;
  /** Raw key value: 0 = the Phase 15 fallback at shader time. */
  avoidRange: number;
  avoidHysteresis: number;
  idleSpeed: number;
  idleSpeedOut: number;
  /** Raw key value: 0 = the steer slowing radius at shader time. */
  idleRadius: number;
  idleDamping: number;
  laneCount: number;
  laneWidth: number;
  laneOffset: number;
  laneLateralGain: number;
  laneLookAheadScale: number;
  /** Multi-obstacle stage: the mesh SDF colliders also count
   *  as crowd obstacles (GLSL route; see the multi-obstacle
   *  section above). Default false = Gate 43 behaviour. */
  multiObstacleEnabled: boolean;
}

/**
 * The single resolution point for the crowd keys (Round 84
 * gap 2). Every consumer (GLSL variant selection + uniforms,
 * WebGPU force params) reads through here so the clamps can
 * never drift — the resolveSteeringSeek discipline.
 */
export function resolveCrowd(config: ParticleConfig): CrowdResolved {
  return {
    enabled: !!config.gpgpuCrowdEnabled,
    avoidRange: clampNum(config.gpgpuCrowdAvoidRange, 0, 1e6, 0),
    avoidHysteresis: clampNum(config.gpgpuCrowdAvoidHysteresis, 0, 1, 0.2),
    idleSpeed: clampNum(config.gpgpuCrowdIdleSpeed, 0, 1e6, 0.05),
    idleSpeedOut: clampNum(config.gpgpuCrowdIdleSpeedOut, 0, 1e6, 0.1),
    idleRadius: clampNum(config.gpgpuCrowdIdleRadius, 0, 1e6, 0),
    idleDamping: clampNum(config.gpgpuCrowdIdleDamping, 0, 1, 0.9),
    laneCount: Math.round(clampNum(config.gpgpuCrowdLaneCount, 1, 4, 1)),
    laneWidth: clampNum(config.gpgpuCrowdLaneWidth, 0, 1e6, 20),
    laneOffset: clampNum(config.gpgpuCrowdLaneOffset, -1e6, 1e6, 0),
    laneLateralGain: clampNum(config.gpgpuCrowdLaneLateralGain, 0, 100, 1),
    laneLookAheadScale: clampNum(config.gpgpuCrowdLaneLookAheadScale, 0, 10, 1),
    multiObstacleEnabled: !!config.gpgpuCrowdMultiObstacleEnabled,
  };
}

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

// ---------------------------------------------------------------------------
// Layer 1 WP6 B3 — declarative crowd state grammar + flow generation.
//
// The stage-1 crowd machine above (crowdStateFor) hard-codes its
// three states and the P1-P5 priority table in code: a product
// surface that wants a different state set (TP §4-19 / XP §4-19
// style state transitions) or different transition conditions
// has nowhere to declare them. This section adds that declaration
// layer as pure functions, in the module's usual discipline:
//
// - A machine is DATA: named states, an ordered rule list, and a
//   fallback state. Each rule is a conjunction of comparisons
//   over a fixed signal vocabulary — the signals are exactly the
//   read ports the stage-1 machine already consumes
//   (CrowdStateInputs) plus neighbour density, which callers may
//   supply when they have it (NaN = unknown, and a comparison
//   against an unknown signal never holds).
// - A condition bound is either a literal number or a named
//   threshold ({ param }) resolved against a thresholds record,
//   so derived lines like the AVOID exit range
//   (avoidRange * (1 + hysteresis)) stay expressible without an
//   expression language.
// - Rules run in declaration order; the first whose conditions
//   all hold wins. A rule may require the SDF collider
//   (requiresSdf), mirroring the stage-1 guard.
// - The stage-1 machine is re-expressed as the preset
//   (crowdStateMachinePreset); crowdStateForDeclared evaluates
//   the preset and is pinned to crowdStateFor by test, so the
//   existing behaviour is the grammar's first citizen, unchanged.
//
// Nothing here is wired into the GPU passes: the twins keep
// mirroring crowdStateFor, and a future variant can mirror the
// declared machine instead. No config keys are added.

/** Signals a transition condition may read. */
export type CrowdSignalId =
  | 'sd'
  | 'velNormal'
  | 'speed'
  | 'distToTarget'
  | 'towardTarget'
  | 'density';

export const CROWD_SIGNAL_IDS: readonly CrowdSignalId[] = [
  'sd', 'velNormal', 'speed', 'distToTarget', 'towardTarget', 'density',
];

/** Comparison operators for a transition condition. */
export type CrowdCompareOp = 'lt' | 'le' | 'gt' | 'ge';

export const CROWD_COMPARE_OPS: readonly CrowdCompareOp[] = ['lt', 'le', 'gt', 'ge'];

/** A condition bound: a literal, or a named threshold resolved
 *  against the thresholds record at evaluation time. */
export type CrowdConditionBound = number | { param: string };

export interface CrowdCondition {
  signal: CrowdSignalId;
  op: CrowdCompareOp;
  bound: CrowdConditionBound;
}

export interface CrowdStateRule {
  /** State id (index into the machine's states) entered when
   *  every condition holds. */
  state: number;
  /** When true the rule is skipped unless the SDF collider is
   *  enabled (the stage-1 AVOID guard). */
  requiresSdf?: boolean;
  /** Conjunction: all conditions must hold. An empty list
   *  always holds. */
  conditions: readonly CrowdCondition[];
}

export interface CrowdStateMachineDecl {
  /** State names by id. */
  states: readonly string[];
  /** Priority order: the first matching rule wins. */
  rules: readonly CrowdStateRule[];
  /** State id used when no rule matches. */
  fallback: number;
}

/** The signal values one evaluation reads. density is NaN when
 *  the caller has no neighbour-density read port. */
export interface CrowdSignalValues {
  sd: number;
  velNormal: number;
  speed: number;
  distToTarget: number;
  towardTarget: number;
  density: number;
}

/** Build the signal record from the stage-1 inputs, with an
 *  optional neighbour density (default NaN = unknown). */
export function crowdSignalsFromInputs(input: CrowdStateInputs, density = NaN): CrowdSignalValues {
  return {
    sd: input.sd,
    velNormal: input.velNormal,
    speed: input.speed,
    distToTarget: input.distToTarget,
    towardTarget: input.towardTarget,
    density: Number.isFinite(density) ? density : NaN,
  };
}

/** Resolve a condition bound against the thresholds record.
 *  A missing or non-finite threshold resolves to NaN, which
 *  makes the comparison never hold (fail closed). */
export function resolveCrowdBound(
  bound: CrowdConditionBound,
  thresholds: Readonly<Record<string, number>>,
): number {
  if (typeof bound === 'number') return Number.isFinite(bound) ? bound : NaN;
  if (bound && typeof bound.param === 'string') {
    const v = thresholds[bound.param];
    return Number.isFinite(v) ? v : NaN;
  }
  return NaN;
}

/** One condition against the signal record. A non-finite signal
 *  or bound never holds, so unknown inputs fail closed instead
 *  of capturing a state. */
export function crowdConditionHolds(
  cond: CrowdCondition,
  signals: CrowdSignalValues,
  thresholds: Readonly<Record<string, number>>,
): boolean {
  const lhs = signals[cond.signal];
  const rhs = resolveCrowdBound(cond.bound, thresholds);
  if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) return false;
  switch (cond.op) {
    case 'lt': return lhs < rhs;
    case 'le': return lhs <= rhs;
    case 'gt': return lhs > rhs;
    case 'ge': return lhs >= rhs;
    default: return false;
  }
}

/**
 * Evaluate a declared machine: rules in declaration order, the
 * first whose conditions all hold wins; otherwise the fallback.
 * Pure and memoryless, like crowdStateFor.
 */
export function evaluateCrowdStateMachine(
  machine: CrowdStateMachineDecl,
  sdfEnabled: boolean,
  signals: CrowdSignalValues,
  thresholds: Readonly<Record<string, number>>,
): number {
  for (const rule of machine.rules) {
    if (rule.requiresSdf && !sdfEnabled) continue;
    let holds = true;
    for (const cond of rule.conditions) {
      if (!crowdConditionHolds(cond, signals, thresholds)) { holds = false; break; }
    }
    if (holds) return rule.state;
  }
  return machine.fallback;
}

const CROWD_MACHINE_MAX_STATES = 16;
const CROWD_MACHINE_MAX_RULES = 64;
const CROWD_MACHINE_MAX_CONDITIONS = 8;

function isCrowdCondition(raw: unknown): raw is CrowdCondition {
  if (!raw || typeof raw !== 'object') return false;
  const c = raw as CrowdCondition;
  if (!CROWD_SIGNAL_IDS.includes(c.signal)) return false;
  if (!CROWD_COMPARE_OPS.includes(c.op)) return false;
  if (typeof c.bound === 'number') return Number.isFinite(c.bound);
  return !!c.bound && typeof c.bound === 'object'
    && typeof (c.bound as { param: unknown }).param === 'string'
    && (c.bound as { param: string }).param.length > 0;
}

/**
 * Sanitize an authored machine declaration (the parseSteeringPath
 * discipline: tolerate malformed input, never invent behaviour).
 * States keep only non-empty names (capped); rules with an
 * out-of-range state or any malformed condition are dropped;
 * the fallback is clamped into the state range (default 0).
 * Returns null when no usable state name remains.
 */
export function normalizeCrowdStateMachine(
  decl: CrowdStateMachineDecl | null | undefined,
): CrowdStateMachineDecl | null {
  if (!decl || !Array.isArray(decl.states)) return null;
  const states = decl.states
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .slice(0, CROWD_MACHINE_MAX_STATES);
  if (states.length === 0) return null;
  const rules: CrowdStateRule[] = [];
  if (Array.isArray(decl.rules)) {
    for (const raw of decl.rules) {
      if (rules.length >= CROWD_MACHINE_MAX_RULES) break;
      if (!raw || typeof raw !== 'object') continue;
      const state = (raw as CrowdStateRule).state;
      if (!Number.isInteger(state) || state < 0 || state >= states.length) continue;
      const conds = (raw as CrowdStateRule).conditions;
      if (!Array.isArray(conds) || conds.length > CROWD_MACHINE_MAX_CONDITIONS) continue;
      if (!conds.every(isCrowdCondition)) continue;
      rules.push({
        state,
        requiresSdf: !!(raw as CrowdStateRule).requiresSdf,
        conditions: conds.map((c) => ({ signal: c.signal, op: c.op, bound: c.bound })),
      });
    }
  }
  const fb = decl.fallback;
  const fallback = Number.isInteger(fb) && fb >= 0 && fb < states.length ? fb : 0;
  return { states, rules, fallback };
}

/** State names of the stage-1 preset, by CROWD_STATE_IDS. */
export const CROWD_STATE_MACHINE_STATES = ['idle', 'move', 'avoid'] as const;

/**
 * The stage-1 machine (crowdStateFor, P1-P5) re-expressed as a
 * declaration plus its thresholds record. The rule order IS the
 * priority order: AVOID entry, AVOID band persistence, IDLE
 * entry, IDLE band persistence, fallback MOVE. The derived
 * AVOID exit range is computed here, exactly as crowdStateFor
 * computes it, and referenced by name from the rule.
 */
export function crowdStateMachinePreset(params: CrowdStateParams): {
  machine: CrowdStateMachineDecl;
  thresholds: Record<string, number>;
} {
  const thresholds: Record<string, number> = {
    crowdAvoidRangeIn: params.avoidRange,
    crowdAvoidRangeOut: params.avoidRange * (1 + params.avoidHysteresis),
    crowdIdleRadius: params.idleRadius,
    crowdIdleSpeed: params.idleSpeed,
    crowdIdleSpeedOut: params.idleSpeedOut,
  };
  const machine: CrowdStateMachineDecl = {
    states: [...CROWD_STATE_MACHINE_STATES],
    rules: [
      {
        state: CROWD_STATE_IDS.avoid,
        requiresSdf: true,
        conditions: [{ signal: 'sd', op: 'lt', bound: { param: 'crowdAvoidRangeIn' } }],
      },
      {
        state: CROWD_STATE_IDS.avoid,
        requiresSdf: true,
        conditions: [
          { signal: 'sd', op: 'lt', bound: { param: 'crowdAvoidRangeOut' } },
          { signal: 'velNormal', op: 'gt', bound: 0 },
        ],
      },
      {
        state: CROWD_STATE_IDS.idle,
        conditions: [
          { signal: 'distToTarget', op: 'lt', bound: { param: 'crowdIdleRadius' } },
          { signal: 'speed', op: 'lt', bound: { param: 'crowdIdleSpeed' } },
        ],
      },
      {
        state: CROWD_STATE_IDS.idle,
        conditions: [
          { signal: 'distToTarget', op: 'lt', bound: { param: 'crowdIdleRadius' } },
          { signal: 'speed', op: 'lt', bound: { param: 'crowdIdleSpeedOut' } },
          { signal: 'towardTarget', op: 'le', bound: 0 },
        ],
      },
    ],
    fallback: CROWD_STATE_IDS.move,
  };
  return { machine, thresholds };
}

/**
 * The declared-grammar evaluation of the stage-1 preset. Pinned
 * to crowdStateFor by test over the full input grid: the two
 * must agree on every input, so existing behaviour is exactly
 * the preset's behaviour.
 */
export function crowdStateForDeclared(
  input: CrowdStateInputs,
  params: CrowdStateParams,
  density = NaN,
): number {
  const { machine, thresholds } = crowdStateMachinePreset(params);
  return evaluateCrowdStateMachine(
    machine,
    input.sdfEnabled,
    crowdSignalsFromInputs(input, density),
    thresholds,
  );
}

// ---------------------------------------------------------------------------
// Crowd flow generation (3ds Max Populate's grammar surface):
// a flow is DECLARED as a path plus a standing density and an
// inflow rate, and the twin evaluation answers the questions a
// generator needs — how many agents the path holds, how often
// one enters, and where agent k is at time t. Agents enter at
// the path start (agent k at t = k / inflowRate, agent 0 at
// t = 0), travel at the declared cruise speed, and stay at the
// path end once they arrive. Pure functions only: no GPU wiring
// in this layer, the same preparation discipline as the rest of
// this module.

export interface CrowdFlowDecl {
  /** Route polyline (PathPt shape, z defaults to 0). */
  path: readonly PathPointLike[];
  /** Standing density: agents per unit of path arc length. */
  density: number;
  /** Inflow: agents entering at the path start per second. */
  inflowRate: number;
  /** Cruise speed along the path, arc length per second
   *  (default 0: entered agents wait at the start). */
  speed?: number;
  /** Lanes the flow splits into, 1..4 (the crowdLaneIndex
   *  range; default 1). */
  laneCount?: number;
}

export interface CrowdFlowResolved {
  path: Vec3Like[];
  /** Total arc length of the path. */
  length: number;
  density: number;
  inflowRate: number;
  speed: number;
  laneCount: number;
  /** Standing population the density implies over the path:
   *  round(density * length). */
  capacity: number;
  /** Seconds between successive entries (Infinity when the
   *  inflow rate is 0). */
  spawnInterval: number;
  /** Density carried by each lane: density / laneCount. */
  laneDensity: number;
}

/** Total arc length of a PathPt polyline (z defaults to 0). */
export function pathArcLength(points: readonly PathPointLike[]): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    total += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
      (points[i + 1].z ?? 0) - (points[i].z ?? 0),
    );
  }
  return total;
}

/**
 * The point at arc length `arc` along a PathPt polyline,
 * clamped to the path ends. An empty point list returns the
 * origin (no path, no position); a single point returns it.
 */
export function pathPointAtArc(points: readonly PathPointLike[], arc: number): Vec3Like {
  if (points.length === 0) return vec();
  const pt = (p: PathPointLike): Vec3Like => vec(p.x, p.y, p.z ?? 0);
  if (points.length === 1 || !(arc > 0)) return pt(points[0]);
  let walked = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = pt(points[i]);
    const b = pt(points[i + 1]);
    const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (arc <= walked + segLen || i === points.length - 2) {
      const t = segLen > 0 ? Math.max(0, Math.min(1, (arc - walked) / segLen)) : 0;
      return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    }
    walked += segLen;
  }
  return pt(points[points.length - 1]);
}

/**
 * The single resolution point for a flow declaration: points
 * with non-finite coordinates are dropped, numbers are clamped
 * (the resolveCrowd discipline), and the derived quantities
 * (length / capacity / spawn interval / per-lane density) are
 * computed once here so consumers can never drift.
 */
export function resolveCrowdFlow(decl: CrowdFlowDecl): CrowdFlowResolved {
  const path = (decl.path ?? [])
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0))
    .map((p) => vec(p.x, p.y, p.z ?? 0));
  const length = pathArcLength(path);
  const density = clampNum(decl.density, 0, 1e6, 0);
  const inflowRate = clampNum(decl.inflowRate, 0, 1e6, 0);
  const speed = clampNum(decl.speed ?? 0, 0, 1e6, 0);
  const laneCount = Math.round(clampNum(decl.laneCount ?? 1, 1, 4, 1));
  return {
    path,
    length,
    density,
    inflowRate,
    speed,
    laneCount,
    capacity: Math.round(density * length),
    spawnInterval: inflowRate > 0 ? 1 / inflowRate : Infinity,
    laneDensity: density / laneCount,
  };
}

/**
 * How many agents have entered by `elapsed` seconds: agent 0
 * enters at t = 0 and one more every spawn interval, capped at
 * the path's capacity. Zero before t = 0, at zero inflow, or on
 * a zero-capacity path.
 */
export function crowdFlowEnteredBy(flow: CrowdFlowResolved, elapsed: number): number {
  if (!(elapsed >= 0) || flow.inflowRate <= 0 || flow.capacity <= 0) return 0;
  return Math.min(flow.capacity, Math.floor(elapsed * flow.inflowRate) + 1);
}

/**
 * Arc position of agent `agentIndex` at `elapsed` seconds, or
 * -1 while the agent has not entered (or the index is invalid).
 * The agent enters at agentIndex / inflowRate and travels at
 * the cruise speed; past the path end it stays at the end.
 */
export function crowdFlowAgentArc(
  flow: CrowdFlowResolved,
  agentIndex: number,
  elapsed: number,
): number {
  if (!Number.isInteger(agentIndex) || agentIndex < 0) return -1;
  if (agentIndex >= crowdFlowEnteredBy(flow, elapsed)) return -1;
  const enteredAt = agentIndex / flow.inflowRate;
  return Math.min(flow.speed * (elapsed - enteredAt), flow.length);
}

/** Point of agent `agentIndex` at `elapsed` seconds along the
 *  flow path, or null while the agent has not entered. */
export function crowdFlowAgentPoint(
  flow: CrowdFlowResolved,
  agentIndex: number,
  elapsed: number,
): Vec3Like | null {
  const arc = crowdFlowAgentArc(flow, agentIndex, elapsed);
  return arc < 0 ? null : pathPointAtArc(flow.path, arc);
}
