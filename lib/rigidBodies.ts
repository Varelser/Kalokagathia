/**
 * Rigid body solver (Phase AU) — CPU solver for ≤64 bodies.
 *
 * Method B of the phase brief: the fracture bake's Voronoi cell
 * assignment (Phase AG) becomes the body material — every
 * non-empty cell is one persistent rigid body with a position, a
 * quaternion orientation, linear / angular velocity, a mass
 * (proportional to its point count) and a sphere-approximated
 * inertia. The solver integrates the bodies on the CPU in fixed
 * substeps; the per-frame body state is written into a small
 * DataTexture (64×4 RGBA float) and the position / velocity
 * passes compose every particle's world transform from it, so
 * every consumer of the position texture (points, geometry
 * instances, trails, replicas) follows with no extra wiring.
 *
 * Determinism (PHASE_AU_DETERMINISM.md, conclusion (a)): the
 * solver is stepped from sceneGpgpuSystem's useFrame with the
 * same processed dt the GPU passes consume (clamped, time-scale
 * locked), accumulates it into fixed 1/120 s substeps, and is
 * initialised purely from the bake's cell table — no Math.random,
 * no wall clock anywhere. Identical input series → identical
 * body states.
 *
 * Honest scope (do not oversell): this is NOT Houdini RBD /
 * Chaos. Collision shapes are spheres only — the bounding sphere
 * of each cell — and because the cells tile a shape, neighbour
 * spheres start deeply overlapped; pair collision therefore
 * respects a per-pair REST distance (bodies may not approach
 * closer than they started, but are never pushed further apart
 * than the bounding spheres demand), which keeps the assembled
 * shape stable without an initial explosion. Inertia is the
 * isotropic sphere tensor. There are no convex / mesh shapes, no
 * constraint joints beyond the glue weld below and the opt-in
 * centre-distance XPBD joints of Phase 20 stage 1, no friction
 * stacking solver. Glue is a position-level weld between bodies
 * that start adjacent; it breaks on impact (a collision changing
 * a body's velocity by more than the strength key) or on extreme
 * strain. Sleeping bodies wake on impact, on a bond breaking, or
 * when their whole contact component loses floor support.
 *
 * Phase 20 stage 1 additions (both strictly opt-in, defaults
 * keep every legacy path verbatim): XPBD distance joints
 * between adjacent body centres (the xpbdConstraints
 * 'joint-distance' socket, CPU side only), and stress-based
 * bond breaking with propagation — each bond carries an
 * instantaneous stress and a break hands a fraction of it to
 * its neighbours, processed as a queue in bond-index order so
 * failures cascade stepwise instead of all at once. The third
 * addition is OBB shape collision: while the Convex key is on,
 * each body carries the OBB fitted to its cell points
 * (lib/rigidObb.ts) and the pair narrow phase / floor test use
 * the box instead of the bounding sphere; inertia stays the
 * sphere tensor, and with the key off no shape is built and
 * every legacy path runs verbatim.
 *
 * Terrain floor (Phase BA): while the Floor Terrain key is on
 * AND a published heightfield is supplied (the publication
 * point is lib/terrainHeightfield.ts — the erosion bake's field
 * in world units), the floor
 * is that heightfield instead of the flat plane: ground height
 * is the bilinear sample at the body's XZ, the contact normal is
 * the field's gradient normal, and the positional correction
 * stays vertical (centre lifted to ground + radius), exactly
 * like the plane path. With no field supplied — erosion off,
 * tunnel mode, key off — the floor is the flat plane at floorY,
 * verbatim. Sphere approximation is unchanged: a body rests on
 * the sampled height under its CENTRE, so a large body can
 * visually intersect a steep slope beside its centre.
 */

import type { ParticleConfig } from '../types';
import type { FractureCellData } from './voronoiFracture';
import { xpbdAlphaTilde, xpbdBreakExceeded, xpbdDeltaLambda } from './xpbdConstraints';
import { buildObbsForCells, obbBoxInertia, obbInertiaFactor, obbInertiaResponse, obbQuatRotate, obbSatContact, obbSupportPoint, placeObb, sphereObbContact } from './rigidObb';
import type { RigidObb } from './rigidObb';
import { sampleCurlFieldFast } from './fieldGlyphSampling';
import type { CurlFieldParams } from './fieldGlyphSampling';

/** Hard body budget: the fracture clamp caps cells at this count.
 * Raised 64 → 256 in UE5 #35 G-B stage 2 (the B1 broadphase made
 * the pair pass sub-quadratic, so the budget no longer costs
 * O(n²)). The GLSL body-texture divisors in
 * gpgpuShaderSimulationPosition / gpgpuShaderSimulationVelocityMainForces
 * hardcode this width — keep them in step. */
export const RIGID_BODY_MAX = 256;
/** Fixed solver substep (seconds). Divides 1/12, 1/24, 1/30, 1/60. */
export const RIGID_SUBSTEP = 1 / 120;
/** Max substeps consumed per frame; excess time is dropped, never spiralled. */
export const RIGID_SUBSTEP_MAX_PER_FRAME = 8;
/** Body texture layout: RIGID_BODY_MAX wide × 4 rows. */
export const RIGID_BODY_TEX_WIDTH = RIGID_BODY_MAX;
export const RIGID_BODY_TEX_HEIGHT = 4;

/** A collision changing a sleeping body's velocity by more than this wakes it. */
const WAKE_DELTA_V = 2.5;
/** Sleep thresholds: sustained below these speeds for SLEEP_DELAY seconds. */
const SLEEP_LIN_SPEED = 2.5;
const SLEEP_ANG_SPEED = 0.2;
const SLEEP_DELAY = 0.5;
/** A glue bond stretched past this strain (relative) breaks regardless of impacts. */
const GLUE_STRAIN_BREAK = 0.5;
/** Bond adjacency: centroid distance ≤ (coreI + coreJ) × this factor. */
const GLUE_DISTANCE_FACTOR = 1.35;

export interface RigidBody {
  pos: [number, number, number];
  quat: [number, number, number, number];
  vel: [number, number, number];
  angVel: [number, number, number];
  /** Bounding-sphere radius (collision). */
  radius: number;
  /** RMS radius (bond adjacency only). */
  coreRadius: number;
  mass: number;
  invMass: number;
  /** Isotropic sphere inertia inverse: 1 / (0.4 · m · r²). */
  invInertia: number;
  sleeping: boolean;
  sleepTimer: number;
  /** Largest velocity change any collision dealt this body in the current substep. */
  impactDeltaV: number;
  /** OBB collision shape (Phase 20 stage 1): the box fitted to
   *  the body's cell points in the bake frame, present ONLY
   *  when the solver was built with the Convex key on (null
   *  for an empty cell). Absent/null keeps every collision on
   *  the legacy bounding-sphere paths. */
  shape?: RigidObb | null;
  /** Per-axis inverse inertia of the fitted box (Round 84
   *  gap 6, stage 1), in the shape's axis frame: present only
   *  alongside `shape`. The step reads it ONLY while the
   *  Convex Inertia step option is on; otherwise the isotropic
   *  sphere `invInertia` answers every angular response. */
  invInertiaAxis?: [number, number, number] | null;
}

export interface RigidBond {
  a: number;
  b: number;
  /** Rest offset of b's centre in a's local frame (build-time). */
  restOffsetLocal: [number, number, number];
  /** Rest relative orientation: qB = qA · restRelQuat (build-time). */
  restRelQuat: [number, number, number, number];
  restLength: number;
  alive: boolean;
  /** Instantaneous stress (Phase 20 stage 1): strain plus the
   *  endpoints' impact Δv normalised by the glue strength,
   *  refreshed every substep ONLY while the stress-break key is
   *  on; propagation adds onto it during the break processing.
   *  While the key is off the field stays 0 and is never read —
   *  the legacy two break conditions run verbatim. */
  stress: number;
}

/**
 * XPBD distance joint between two body centres (Phase 20
 * stage 1 — the CPU-side realisation of the 'joint-distance'
 * receiving socket in lib/xpbdConstraints.ts). Anchors are the
 * body centres (the XpbdJointSpec anchor fields at [0,0,0]), so
 * the constraint is C = |posB − posA| − restLength with unit
 * gradients and the bodies' inverse masses as the weights;
 * Δλ comes from the shared xpbdDeltaLambda and breaking follows
 * xpbdBreakExceeded (threshold 0 = unbreakable, metric = the
 * strain |C| / restLength). Joints exist only when built with
 * the Joint Enabled key on — the array is empty otherwise and
 * no code path reads it.
 *
 * Anchored form (UE5 #35 G-C): built only while the Joint
 * Anchor key is also on, a joint instead carries the
 * XpbdJointSpec anchor fields (the shared face midpoint in
 * each body's local frame) and binds the anchor POINTS with
 * rotational coupling, plus an optional swing angle limit
 * against the build-time relative orientation. The break
 * metric stays the centre strain above for both forms.
 */
export interface RigidJoint {
  a: number;
  b: number;
  restLength: number;
  /** XPBD compliance α (physical units, α = 0 is rigid). */
  compliance: number;
  /** xpbdBreakExceeded semantics: 0 = unbreakable. */
  breakThreshold: number;
  /** Accumulated λ of the current substep (reset per substep). */
  lambda: number;
  alive: boolean;
  /** Anchor point in body A's local frame (UE5 #35 G-C): the
   *  XpbdJointSpec anchor fields, realised. Present only on
   *  joints built with the Joint Anchor key on; the constraint
   *  then binds the two anchor POINTS (a ball joint at the
   *  shared face midpoint) with full rotational coupling
   *  instead of the body centres. Absent keeps the centre-
   *  distance path verbatim. */
  anchorA?: [number, number, number];
  /** Anchor point in body B's local frame (see anchorA). */
  anchorB?: [number, number, number];
  /** Distance between the anchor points at build time (0 for
   *  the shared-midpoint anchors the builder emits). Read only
   *  alongside anchorA/anchorB. */
  anchorRest?: number;
  /** Relative orientation qA⁻¹·qB at build time (UE5 #35 G-C):
   *  the reference the angle limit measures against. Present
   *  only alongside the anchors. */
  restRelQuat?: [number, number, number, number];
  /** Swing angle limit in radians (UE5 #35 G-C): the largest
   *  angle the pair's relative orientation may deviate from
   *  restRelQuat. 0 / absent = no limit. Read only alongside
   *  restRelQuat. */
  angleLimitRad?: number;
}

/**
 * A NEW contact that began during stepping (Phase 21 stage 3).
 * `b` is the other body's index, or -1 for the environment
 * (floor / heightfield). `impact` is the largest impact Δv the
 * involved bodies recorded in that substep. Events are pure
 * bookkeeping: collecting them never alters a body's state.
 */
export interface RigidContactEvent {
  a: number;
  b: number;
  impact: number;
}

export interface RigidSolverState {
  bodies: RigidBody[];
  bonds: RigidBond[];
  /** XPBD joints (Phase 20 stage 1): empty unless built with
   *  the Joint Enabled key on. */
  joints: RigidJoint[];
  /** Per-pair rest distance (i·64+j): min(initial distance, ri + rj). */
  restDist: Float32Array;
  accumulator: number;
  /** Total simulated seconds since creation (diagnostics / tests). */
  time: number;
  /** Contact keys (a·65+b, floor = a·65+64) touching at the end of
   *  the last substep — the rising-edge memory for contact events
   *  (Phase 21 stage 3). */
  contactKeys: Set<number>;
  /** New-contact events not yet drained by the caller. Capped;
   *  see RIGID_CONTACT_EVENT_CAP. */
  pendingContactEvents: RigidContactEvent[];
}

/** Cap on undrained contact events: a solver nobody drains (every
 *  legacy caller) must not accumulate without bound. */
export const RIGID_CONTACT_EVENT_CAP = 256;

/** Drain the pending new-contact events (Phase 21 stage 3). */
export function drainRigidContactEvents(state: RigidSolverState): RigidContactEvent[] {
  if (!state.pendingContactEvents || state.pendingContactEvents.length === 0) return [];
  const out = state.pendingContactEvents;
  state.pendingContactEvents = [];
  return out;
}

/**
 * A published heightfield the floor can stand on (Phase BA),
 * structurally typed so this solver stays free of the terrain
 * modules: lib/terrainHeightfield.ts's TerrainHeightfield
 * satisfies this shape. All units are world units; heights are
 * row-major with row 0 = z = -extent, col along +X.
 */
export interface RigidHeightfieldSource {
  size: number;
  extent: number;
  step: number;
  heights: Float32Array;
}

/** Bilinear sample of a heightfield source at (x, z), clamped
 *  to the domain edge (the sampleErodedField rule). */
export function sampleRigidHeightfield(field: RigidHeightfieldSource, x: number, z: number): number {
  const n = field.size;
  const gx = Math.max(0, Math.min(n - 1, (x + field.extent) / field.step));
  const gz = Math.max(0, Math.min(n - 1, (z + field.extent) / field.step));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const h = field.heights;
  const h00 = h[iz * n + ix];
  const h10 = h[iz * n + ix + 1];
  const h01 = h[(iz + 1) * n + ix];
  const h11 = h[(iz + 1) * n + ix + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Surface normal of a heightfield source at (x, z):
 *  normalize(-dh/dx, 1, -dh/dz), central differences of the
 *  sampler with one grid step. A flat field gives (0, 1, 0)
 *  exactly. */
export function rigidHeightfieldNormal(
  field: RigidHeightfieldSource,
  x: number,
  z: number,
): [number, number, number] {
  const eps = field.step;
  const gx = (sampleRigidHeightfield(field, x + eps, z) - sampleRigidHeightfield(field, x - eps, z)) / (2 * eps);
  const gz = (sampleRigidHeightfield(field, x, z + eps) - sampleRigidHeightfield(field, x, z - eps)) / (2 * eps);
  const inv = 1 / Math.hypot(gx, 1, gz);
  return [-gx * inv, inv, -gz * inv];
}

/** Ground height under (x, z) for one step: the heightfield
 *  sample while a field is supplied, the flat floorY otherwise
 *  (the Phase BA fallback rule). */
function floorSurfaceYAt(options: RigidStepOptions, x: number, z: number): number {
  return options.heightfield
    ? sampleRigidHeightfield(options.heightfield, x, z)
    : options.floorY;
}

/** Multi-sample ground height (UE5 #35 G-D stage D1): the
 *  highest heightfield sample under a body's disc — the centre
 *  plus four ring points at 0.7·radius on the axes. On a flat
 *  field every sample is equal, so the result is the centre
 *  sample bit-for-bit. */
function floorMultiSampleY(field: RigidHeightfieldSource, x: number, z: number, radius: number): number {
  const o = radius * 0.7;
  let y = sampleRigidHeightfield(field, x, z);
  const e = sampleRigidHeightfield(field, x + o, z); if (e > y) y = e;
  const w = sampleRigidHeightfield(field, x - o, z); if (w > y) y = w;
  const s = sampleRigidHeightfield(field, x, z + o); if (s > y) y = s;
  const n = sampleRigidHeightfield(field, x, z - o); if (n > y) y = n;
  return y;
}

export interface RigidStepOptions {
  /** Signed gravity acceleration on Y, world units / s² (already includes the gravity key). */
  gravityY: number;
  floorEnabled: boolean;
  floorY: number;
  /** Published terrain heightfield (Phase BA): while non-null
   *  the floor stands on it; null keeps the flat plane at
   *  floorY verbatim. The caller resolves it (key + field
   *  availability), the solver only consumes it. */
  heightfield?: RigidHeightfieldSource | null;
  /** Multi-sample sphere floor (UE5 #35 G-D stage D1): while
   *  true (AND a heightfield is supplied), the sphere floor
   *  path rests each body on the highest of the centre + four
   *  ring samples under its disc instead of the centre sample
   *  alone. Absent/false keeps the centre rule verbatim; on a
   *  flat field the two are bit-identical. */
  floorMultiSample?: boolean;
  /** Static boxes (UE5 #35 G-D stage D2): infinite-mass OBBs in
   *  world space, resolved by the caller from the
   *  gpgpuRigidStaticBoxes key. Absent / null / empty runs no
   *  static pass at all — the identity guarantee. While present,
   *  each awake body is tested against every box after the floor
   *  pass: shaped bodies (convex on) through the SAT narrow
   *  phase, the rest through the sphere-vs-OBB test, with the
   *  full-depth correction and the environment contact impulse. */
  staticBoxes?: readonly RigidObb[] | null;
  /** Containment sphere radius (the scene bounce radius). */
  bounceRadius: number;
  restitution: number;
  friction: number;
  glueEnabled: boolean;
  /** Impact Δv (world / s) above which a body's bonds break. */
  glueStrength: number;
  /** Stress break (Phase 20 stage 1): while true, bond breaking
   *  is decided by the per-bond stress (strain + normalised
   *  impact) with propagation to neighbouring bonds, replacing
   *  the legacy strain / impact conditions. Absent or false
   *  keeps the legacy conditions verbatim. */
  stressBreakEnabled?: boolean;
  /** Fraction of a broken bond's stress added onto each
   *  neighbouring bond (0..1, Phase 20 stage 1). Read only
   *  while stressBreakEnabled is true. */
  stressPropagation?: number;
  /** OBB shape collision (Phase 20 stage 1): while true, pairs
   *  where BOTH bodies carry a fitted shape resolve through
   *  the SAT narrow phase and the floor test measures the
   *  shape's support point; pairs with a missing shape, and
   *  every pair while this is absent/false, run the legacy
   *  sphere paths verbatim. */
  convexEnabled?: boolean;
  /** Broad phase (UE5 #35 G-B stage B1): while true (the
   *  default), the pair-collision pass visits only the pairs a
   *  spatial hash admits — a superset of the pairs that can
   *  interact, in the legacy (i, j) order, so trajectories stay
   *  bit-identical. False runs the legacy all-pairs double loop
   *  verbatim (kept as the reference path for the identity
   *  tests). */
  broadphase?: boolean;
  /** OBB box inertia (Round 84 gap 6, stage 1): while true
   *  (AND convexEnabled), bodies with a fitted shape answer
   *  angular responses with the box inertia tensor instead of
   *  the isotropic sphere scalar. Absent/false keeps the sphere
   *  path verbatim. */
  convexInertiaEnabled?: boolean;
  /** External per-body acceleration (Round 84 gap 3, stage 1):
   *  world units / s², 3 floats per body in state.bodies order,
   *  sampled by the caller ONCE per frame from a pure field
   *  function of (body position, solver time) and applied right
   *  after gravity in the integrator, identically in every
   *  substep of that frame. Sleeping bodies are not integrated
   *  and the force never wakes a body (wake-by-force is stage
   *  1b). Absent / null keeps the legacy path verbatim. */
  externalAccel?: Float32Array | null;
  /** External per-body ANGULAR acceleration (coupling stage
   *  1b): world units / s², 3 floats per body, filled by the
   *  caller from the same field sample as externalAccel (the
   *  torque of the surface-point force, divided by the body's
   *  inertia — see fillRigidCurlAngAccel). Applied to angVel
   *  right after the linear acceleration in the integrator.
   *  Absent / null keeps stage 1 verbatim. */
  externalAngAccel?: Float32Array | null;
  /** Wake-by-force threshold (coupling stage 1b): while > 0, a
   *  sleeping body whose sampled |externalAccel| reaches the
   *  threshold (world / s²) is woken at the start of the
   *  substep, so the force integrates it in that same substep.
   *  0 / absent = stage 1 behaviour (force never wakes). */
  externalWakeThreshold?: number;
}

/** Per-axis inverse inertia of a fitted box (Round 84 gap 6). */
function invAxisOf(obb: RigidObb, mass: number): [number, number, number] {
  const I = obbBoxInertia(obb, mass);
  return [1 / I[0], 1 / I[1], 1 / I[2]];
}

/** True while the step should answer angular responses with
 *  the box tensor for this body (both Convex keys on + a fitted
 *  shape with axis data). Every other case keeps the isotropic
 *  sphere scalar verbatim. */
function tensorActive(body: RigidBody, options: RigidStepOptions): boolean {
  return !!(options.convexEnabled && options.convexInertiaEnabled && body.shape && body.invInertiaAxis);
}

/** (r × n)ᵀ I⁻¹ (r × n) for the body's active inertia. */
function inertiaFactor(body: RigidBody, options: RigidStepOptions, rn: [number, number, number]): number {
  if (tensorActive(body, options)) {
    return obbInertiaFactor(body.shape as RigidObb, body.quat, body.invInertiaAxis as [number, number, number], rn);
  }
  return (rn[0] * rn[0] + rn[1] * rn[1] + rn[2] * rn[2]) * body.invInertia;
}

// ── Quaternion helpers (plain arrays, allocation-free in the hot loop) ──

function quatMultiply(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatConjugate(q: [number, number, number, number]): [number, number, number, number] {
  return [-q[0], -q[1], -q[2], q[3]];
}

function quatNormalize(q: [number, number, number, number]): [number, number, number, number] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate vector v by quaternion q. */
export function quatRotate(
  q: [number, number, number, number],
  v: [number, number, number],
): [number, number, number] {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

// ── Construction ──

/**
 * Build the solver state from a bake's cell table. Initial
 * placement is the cell table itself (centroids, identity
 * orientation, zero velocity, no randomness), so a rebuild is a
 * pure function of the bake. Glue bonds form between bodies
 * whose centroids start within (coreI + coreJ) × 1.35 — the
 * adjacency of the original tiling.
 */
export function createRigidSolver(
  cells: FractureCellData,
  options: {
    glueEnabled: boolean;
    startSleeping: boolean;
    /** XPBD joints (Phase 20 stage 1): while true, a joint is
     *  built for every pair the glue adjacency rule joins,
     *  independent of the glue switch itself. Absent/false
     *  builds no joints at all (legacy state shape). */
    jointEnabled?: boolean;
    jointCompliance?: number;
    jointBreakThreshold?: number;
    /** Anchored joints (UE5 #35 G-C): while true, each joint
     *  binds the shared face-midpoint anchor points (the
     *  XpbdJointSpec anchor fields) instead of the body
     *  centres, with rotational coupling. Absent/false builds
     *  centre joints verbatim. */
    jointAnchors?: boolean;
    /** Angle limit in radians for anchored joints (UE5 #35
     *  G-C): the largest swing of the pair's relative
     *  orientation from its build-time value. 0 / absent =
     *  no limit. Read only while jointAnchors is true. */
    jointAngleLimitRad?: number;
    /** OBB shapes (Phase 20 stage 1): while true, each body
     *  carries the OBB fitted to its cell points. Absent/false
     *  builds no shapes at all (legacy state shape). */
    convexEnabled?: boolean;
  },
): RigidSolverState {
  const n = Math.min(cells.bodyCount, RIGID_BODY_MAX);
  const bodies: RigidBody[] = [];
  // OBB fits (Phase 20 stage 1): computed once here, only while
  // the Convex key is on — the fit is a pure function of the
  // cell table (lib/rigidObb.ts), so a rebuild reproduces the
  // same shapes bit for bit.
  const obbs = options.convexEnabled ? buildObbsForCells(cells) : null;
  for (let i = 0; i < n; i++) {
    const radius = Math.max(0.001, cells.radii[i] ?? 0.001);
    const mass = Math.max(1, cells.cellCounts[i] ?? 1);
    bodies.push({
      pos: [cells.centroids[i * 3] ?? 0, cells.centroids[i * 3 + 1] ?? 0, cells.centroids[i * 3 + 2] ?? 0],
      quat: [0, 0, 0, 1],
      vel: [0, 0, 0],
      angVel: [0, 0, 0],
      radius,
      coreRadius: Math.max(0.001, cells.coreRadii[i] ?? radius),
      mass,
      invMass: 1 / mass,
      invInertia: 1 / (0.4 * mass * radius * radius),
      sleeping: !!options.startSleeping,
      sleepTimer: 0,
      impactDeltaV: 0,
      ...(obbs ? { shape: obbs[i] ?? null } : {}),
      // Box inertia (Round 84 gap 6, stage 1): derived from the
      // same fit, stored alongside the shape. Inert data until
      // the Convex Inertia step option reads it.
      ...(obbs && obbs[i] ? { invInertiaAxis: invAxisOf(obbs[i] as RigidObb, mass) } : {}),
    });
  }
  const restDist = new Float32Array(RIGID_BODY_MAX * RIGID_BODY_MAX);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) { restDist[i * RIGID_BODY_MAX + j] = 0; continue; }
      const dx = bodies[j].pos[0] - bodies[i].pos[0];
      const dy = bodies[j].pos[1] - bodies[i].pos[1];
      const dz = bodies[j].pos[2] - bodies[i].pos[2];
      const d = Math.hypot(dx, dy, dz);
      restDist[i * RIGID_BODY_MAX + j] = Math.min(d, bodies[i].radius + bodies[j].radius);
    }
  }
  const bonds: RigidBond[] = [];
  if (options.glueEnabled) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = bodies[j].pos[0] - bodies[i].pos[0];
        const dy = bodies[j].pos[1] - bodies[i].pos[1];
        const dz = bodies[j].pos[2] - bodies[i].pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d <= (bodies[i].coreRadius + bodies[j].coreRadius) * GLUE_DISTANCE_FACTOR) {
          bonds.push({
            a: i,
            b: j,
            // Build-time orientations are identity, so the world
            // offset IS the local offset, and the relative
            // orientation is the identity quaternion.
            restOffsetLocal: [dx, dy, dz],
            restRelQuat: [0, 0, 0, 1],
            restLength: Math.max(d, 0.001),
            alive: true,
            stress: 0,
          });
        }
      }
    }
  }
  // XPBD joints (Phase 20 stage 1): the SAME adjacency rule as
  // the glue bonds above (centroid distance within
  // (coreI + coreJ) × GLUE_DISTANCE_FACTOR), built only while
  // the Joint Enabled key is on. Centre anchors: the rest
  // length is the centroid distance at build time.
  const joints: RigidJoint[] = [];
  if (options.jointEnabled) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = bodies[j].pos[0] - bodies[i].pos[0];
        const dy = bodies[j].pos[1] - bodies[i].pos[1];
        const dz = bodies[j].pos[2] - bodies[i].pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d <= (bodies[i].coreRadius + bodies[j].coreRadius) * GLUE_DISTANCE_FACTOR) {
          joints.push({
            a: i,
            b: j,
            restLength: Math.max(d, 0.001),
            compliance: Math.max(0, options.jointCompliance ?? 0),
            breakThreshold: Math.max(0, options.jointBreakThreshold ?? 0),
            lambda: 0,
            alive: true,
            // Anchored form (UE5 #35 G-C): the anchor is the
            // midpoint between the two centroids — the shared
            // face's proxy for adjacent Voronoi cells — in each
            // body's local frame. Build-time orientations are
            // identity, so the local anchors are ±half the
            // centroid offset, the anchor points coincide
            // (anchorRest 0) and the rest relative orientation
            // is the identity quaternion.
            ...(options.jointAnchors ? {
              anchorA: [dx / 2, dy / 2, dz / 2] as [number, number, number],
              anchorB: [-dx / 2, -dy / 2, -dz / 2] as [number, number, number],
              anchorRest: 0,
              restRelQuat: [0, 0, 0, 1] as [number, number, number, number],
              angleLimitRad: Math.max(0, options.jointAngleLimitRad ?? 0),
            } : {}),
          });
        }
      }
    }
  }
  return { bodies, bonds, joints, restDist, accumulator: 0, time: 0, contactKeys: new Set(), pendingContactEvents: [] };
}

// ── Stepping ──

function wakeBody(state: RigidSolverState, index: number): void {
  const body = state.bodies[index];
  if (!body.sleeping) return;
  body.sleeping = false;
  body.sleepTimer = 0;
}

/** Break every live bond of a body; partners wake (activation path (c)). */
function breakBondsOf(state: RigidSolverState, index: number): void {
  for (const bond of state.bonds) {
    if (!bond.alive) continue;
    if (bond.a === index || bond.b === index) {
      bond.alive = false;
      wakeBody(state, bond.a);
      wakeBody(state, bond.b);
    }
  }
}

/**
 * Stress-break processing (Phase 20 stage 1): break every live
 * bond whose instantaneous stress exceeds the strain-break
 * threshold, as a queue in bond-index order. Each break adds
 * `propagationRate × (the broken bond's stress)` onto every
 * still-live bond sharing an endpoint; a neighbour pushed over
 * the threshold joins the queue, so a failure cascades stepwise
 * along the bond graph instead of taking the whole component at
 * once. A rate of 0 adds nothing and nothing spreads. Returns
 * the number of bonds broken. Exported for the unit tests; the
 * substep calls it after refreshing the stress field.
 */
export function propagateRigidBondBreaks(state: RigidSolverState, propagationRate: number): number {
  const rate = Math.max(0, Math.min(1, propagationRate));
  const queued = new Set<number>();
  const queue: number[] = [];
  const enqueue = (i: number) => {
    if (!queued.has(i)) {
      queued.add(i);
      queue.push(i);
    }
  };
  state.bonds.forEach((bond, i) => {
    if (bond.alive && bond.stress > GLUE_STRAIN_BREAK) enqueue(i);
  });
  let broken = 0;
  while (queue.length > 0) {
    // Bond-index order: always take the smallest queued index.
    let minPos = 0;
    for (let k = 1; k < queue.length; k++) if (queue[k] < queue[minPos]) minPos = k;
    const i = queue.splice(minPos, 1)[0];
    const bond = state.bonds[i];
    if (!bond.alive) continue;
    bond.alive = false;
    broken += 1;
    wakeBody(state, bond.a);
    wakeBody(state, bond.b);
    if (rate > 0) {
      state.bonds.forEach((other, j) => {
        if (!other.alive || j === i) return;
        if (other.a === bond.a || other.a === bond.b || other.b === bond.a || other.b === bond.b) {
          other.stress += rate * bond.stress;
          if (other.stress > GLUE_STRAIN_BREAK) enqueue(j);
        }
      });
    }
  }
  return broken;
}

/**
 * Advance the solver by dt seconds of scene time. dt is consumed
 * through the fixed-substep accumulator; the caller passes the
 * frame's processed dt (clamped, time-scale locked), so a
 * deterministic render's fixed dt series reproduces the exact
 * same substep series. Returns the number of substeps run.
 */
export function stepRigidBodies(
  state: RigidSolverState,
  dt: number,
  options: RigidStepOptions,
): number {
  if (!Number.isFinite(dt) || dt <= 0 || state.bodies.length === 0) return 0;
  state.accumulator = Math.min(state.accumulator + dt, RIGID_SUBSTEP * RIGID_SUBSTEP_MAX_PER_FRAME);
  let steps = 0;
  while (state.accumulator >= RIGID_SUBSTEP - 1e-9 && steps < RIGID_SUBSTEP_MAX_PER_FRAME) {
    substep(state, RIGID_SUBSTEP, options);
    state.accumulator -= RIGID_SUBSTEP;
    state.time += RIGID_SUBSTEP;
    steps += 1;
  }
  if (state.accumulator < 0) state.accumulator = 0;
  return steps;
}

/** Every (i, j) pair key in legacy visit order. */
function allPairKeys(n: number): number[] {
  const keys: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) keys.push(i * RIGID_BODY_MAX + j);
  }
  return keys;
}

/**
 * Broad phase (UE5 #35 G-B stage B1): the candidate pair keys
 * for one pair-collision pass, in the legacy (i, j) visit order.
 *
 * A pair can change state only when its centre distance is
 * under rA + rB: the sphere path needs d < restDist and
 * restDist ≤ rA + rB by construction; the OBB path needs
 * d < restDist or d < rA + rB. Pairs beyond that bound are
 * skipped by the legacy loop without any state change, so a
 * candidate set that contains every pair under the bound —
 * plus a safety margin — reproduces the legacy pass exactly.
 * The margin is the scene's largest radius: within one pass a
 * body moves only through pair corrections, each smaller than
 * that pair's overlap (< rA + rB), and the margin keeps the
 * set a superset of the pairs the legacy loop could touch
 * after earlier corrections in the same pass. The identity is
 * pinned by scripts/phase46-rigid-broadphase.test.mjs.
 *
 * The grid is a spatial hash with cell size 3·maxR (≥ the
 * largest possible cutoff, 2·maxR + margin), so the 27
 * neighbouring cells cover every candidate; hash collisions
 * only cost a distance test, never correctness. (Each body
 * sits in exactly one bucket, but two scanned neighbour cells
 * can hash to that same bucket — the per-i seen set keeps a
 * pair from being emitted twice; a duplicate visit would
 * re-run the narrow phase on already-corrected positions and
 * break the identity, as the phase46 test caught.)
 */
function broadphasePairKeys(bodies: RigidBody[]): number[] {
  const n = bodies.length;
  if (n < 2) return [];
  let maxR = 0;
  for (const b of bodies) if (b.radius > maxR) maxR = b.radius;
  if (!(maxR > 0)) return allPairKeys(n);
  const cell = 3 * maxR;
  const cellOf = (v: number) => Math.floor(v / cell);
  const hash = (cx: number, cy: number, cz: number) => ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const p = bodies[i].pos;
    const key = hash(cellOf(p[0]), cellOf(p[1]), cellOf(p[2]));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  const keys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = bodies[i];
    const cx = cellOf(a.pos[0]);
    const cy = cellOf(a.pos[1]);
    const cz = cellOf(a.pos[2]);
    const js: number[] = [];
    const seen = new Set<number>();
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = buckets.get(hash(cx + ox, cy + oy, cz + oz));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i || seen.has(j)) continue;
            seen.add(j);
            const b = bodies[j];
            const cutoff = a.radius + b.radius + maxR;
            const dx = b.pos[0] - a.pos[0];
            const dy = b.pos[1] - a.pos[1];
            const dz = b.pos[2] - a.pos[2];
            if (dx * dx + dy * dy + dz * dz < cutoff * cutoff) js.push(j);
          }
        }
      }
    }
    js.sort((x, y) => x - y);
    for (const j of js) keys.push(i * RIGID_BODY_MAX + j);
  }
  return keys;
}

/**
 * Post-pass verification for the broad phase: true when some
 * dropped pair could have interacted in the legacy loop. A
 * legacy interaction needs the pair's centre distance, at its
 * turn in the pass, under rA + rB (the interaction bound; see
 * broadphasePairKeys). During the pass a pair's distance can
 * shrink by at most the two bodies' correction path lengths,
 * so when startDistance − (pathA + pathB) ≥ rA + rB for every
 * dropped pair, no dropped pair interacted in the legacy loop
 * either, and the candidate pass — same order, same code — is
 * bit-identical to it. Any doubt returns true and the caller
 * redoes the pass with the legacy loop from the snapshot.
 */
function broadphasePassSuspect(
  bodies: RigidBody[],
  startPos: Float64Array,
  path: Float64Array,
  candidateSet: Set<number>,
): boolean {
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (candidateSet.has(i * RIGID_BODY_MAX + j)) continue;
      const travel = path[i] + path[j];
      if (travel === 0) continue;
      const dx = startPos[j * 3] - startPos[i * 3];
      const dy = startPos[j * 3 + 1] - startPos[i * 3 + 1];
      const dz = startPos[j * 3 + 2] - startPos[i * 3 + 2];
      const bound = bodies[i].radius + bodies[j].radius;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) - travel < bound) return true;
    }
  }
  return false;
}

function substep(state: RigidSolverState, h: number, options: RigidStepOptions): void {
  const bodies = state.bodies;
  const n = bodies.length;
  for (const body of bodies) body.impactDeltaV = 0;
  // Phase 21 stage 3: contacts touched during THIS substep, keyed
  // a·(MAX+1)+b with b = MAX for the environment. Compared against
  // the previous substep's set at the end to emit rising-edge
  // contact events. Bookkeeping only — no physics reads this.
  const touching = new Set<number>();
  const CONTACT_STRIDE = RIGID_BODY_MAX + 1;

  // 1. Integrate forces + positions for awake bodies.
  const ext = options.externalAccel ?? null;
  const extAng = options.externalAngAccel ?? null;
  // Stage 1b wake-by-force: a sleeping body whose sampled
  // acceleration reaches the threshold wakes BEFORE the
  // integrator, so the force acts on it in this same substep.
  // The threshold is inert at 0 / absent (stage 1 verbatim).
  const wakeThreshold = options.externalWakeThreshold ?? 0;
  if (ext && wakeThreshold > 0) {
    for (let bi = 0; bi < n; bi++) {
      if (!bodies[bi].sleeping) continue;
      const ax = ext[bi * 3]; const ay = ext[bi * 3 + 1]; const az = ext[bi * 3 + 2];
      if (Math.sqrt(ax * ax + ay * ay + az * az) >= wakeThreshold) wakeBody(state, bi);
    }
  }
  for (let bi = 0; bi < n; bi++) {
    const body = bodies[bi];
    if (body.sleeping) continue;
    body.vel[1] += options.gravityY * h;
    if (ext) {
      body.vel[0] += ext[bi * 3] * h;
      body.vel[1] += ext[bi * 3 + 1] * h;
      body.vel[2] += ext[bi * 3 + 2] * h;
    }
    if (extAng) {
      body.angVel[0] += extAng[bi * 3] * h;
      body.angVel[1] += extAng[bi * 3 + 1] * h;
      body.angVel[2] += extAng[bi * 3 + 2] * h;
    }
    body.pos[0] += body.vel[0] * h;
    body.pos[1] += body.vel[1] * h;
    body.pos[2] += body.vel[2] * h;
    const w = body.angVel;
    if (w[0] !== 0 || w[1] !== 0 || w[2] !== 0) {
      const dq = quatMultiply([w[0], w[1], w[2], 0], body.quat);
      body.quat = quatNormalize([
        body.quat[0] + 0.5 * h * dq[0],
        body.quat[1] + 0.5 * h * dq[1],
        body.quat[2] + 0.5 * h * dq[2],
        body.quat[3] + 0.5 * h * dq[3],
      ]);
    }
  }

  // 2. Environment collisions (floor + containment sphere).
  for (let i = 0; i < n; i++) {
    const body = bodies[i];
    if (body.sleeping) continue;
    if (options.floorEnabled) {
      // Phase BA: the ground under the body's centre — the
      // heightfield sample while a field is supplied (contact
      // normal = the field's gradient normal), the flat plane
      // otherwise (normal +Y, the legacy statement verbatim).
      const hf = options.heightfield ?? null;
      const groundY = hf
        ? sampleRigidHeightfield(hf, body.pos[0], body.pos[2])
        : options.floorY;
      if (options.convexEnabled && body.shape) {
        // OBB floor (Phase 20 stage 1): penetration is measured
        // at the shape's support point along the floor normal
        // instead of centre − radius; the correction stays
        // vertical (the legacy rule), and the contact point is
        // the support point dropped onto the ground plane. The
        // ground height is still sampled under the body's
        // CENTRE (the Phase BA approximation), so a large body
        // can intersect a steep slope beside its centre exactly
        // like the sphere path.
        const normal: [number, number, number] = hf
          ? rigidHeightfieldNormal(hf, body.pos[0], body.pos[2])
          : [0, 1, 0];
        const placed = placeObb(body.shape, body.pos, body.quat);
        const support = obbSupportPoint(placed, [-normal[0], -normal[1], -normal[2]]);
        const floorDist = support[1] - groundY;
        if (floorDist < 0) {
          body.pos[1] -= floorDist;
          applyContactImpulse(state, i, -1, normal, [support[0], groundY, support[2]], options);
          touching.add(i * CONTACT_STRIDE + RIGID_BODY_MAX);
        }
      } else {
        // Sphere floor: the ground under the centre — or, with
        // the multi-sample step option (UE5 #35 G-D stage D1),
        // the highest sample under the body's disc, so a large
        // body rests on the terrain beside its centre instead
        // of sinking its rim into a slope. The normal and the
        // correction rule stay the legacy centre ones; only
        // the height changes, and on a flat field the option
        // is bit-identical (every sample equal).
        const sphereGroundY = options.floorMultiSample && hf
          ? floorMultiSampleY(hf, body.pos[0], body.pos[2], body.radius)
          : groundY;
        const floorDist = body.pos[1] - body.radius - sphereGroundY;
        if (floorDist < 0) {
          body.pos[1] -= floorDist;
          const normal: [number, number, number] = hf
            ? rigidHeightfieldNormal(hf, body.pos[0], body.pos[2])
            : [0, 1, 0];
          applyContactImpulse(state, i, -1, normal, [body.pos[0], sphereGroundY, body.pos[2]], options);
          touching.add(i * CONTACT_STRIDE + RIGID_BODY_MAX);
        }
      }
    }
    const limit = Math.max(0, options.bounceRadius * 1.05 - body.radius);
    const d = Math.hypot(body.pos[0], body.pos[1], body.pos[2]);
    if (d > limit && d > 1e-9) {
      const nx = body.pos[0] / d; const ny = body.pos[1] / d; const nz = body.pos[2] / d;
      body.pos[0] = nx * limit; body.pos[1] = ny * limit; body.pos[2] = nz * limit;
      const vn = body.vel[0] * nx + body.vel[1] * ny + body.vel[2] * nz;
      if (vn > 0) {
        const rest = vn < 1 ? 0 : options.restitution;
        body.vel[0] -= nx * vn * (1 + rest);
        body.vel[1] -= ny * vn * (1 + rest);
        body.vel[2] -= nz * vn * (1 + rest);
        body.impactDeltaV = Math.max(body.impactDeltaV, Math.abs(vn * (1 + rest)));
      }
    }
  }

  // 2b. Static boxes (UE5 #35 G-D stage D2): infinite-mass OBBs
  // from the step options. The correction is the full depth
  // (nothing splits with an infinite mass) and the impulse rides
  // the environment contact path (other = -1), so restitution,
  // friction, impact bookkeeping and contact events behave
  // exactly as for the floor. Sleeping bodies are skipped, as in
  // the floor pass — statics never move, so nothing can knock a
  // sleeper off its support.
  const statics = options.staticBoxes ?? null;
  const runStaticPass = (): void => {
    if (!statics || statics.length === 0) return;
    for (let i = 0; i < n; i++) {
      const body = bodies[i];
      if (body.sleeping) continue;
      for (const box of statics) {
        if (options.convexEnabled && body.shape) {
          const placed = placeObb(body.shape, body.pos, body.quat);
          const contact = obbSatContact(placed, box);
          if (!contact.hit) continue;
          // The SAT normal runs body -> box; the push-out is its
          // negation (the direction the body must move).
          body.pos[0] -= contact.normal[0] * contact.depth;
          body.pos[1] -= contact.normal[1] * contact.depth;
          body.pos[2] -= contact.normal[2] * contact.depth;
          // The impulse acts at the body's own support point
          // along the SAT normal — the floor pass's treatment —
          // NOT at the SAT midpoint: against a large static the
          // midpoint sits halfway toward the static's far
          // support corner, and the lever arm of that point
          // spins a resting body up instead of settling it
          // (measured in the phase49 diagnosis).
          applyContactImpulse(state, i, -1,
            [-contact.normal[0], -contact.normal[1], -contact.normal[2]] as [number, number, number],
            obbSupportPoint(placed, contact.normal), options);
          touching.add(i * CONTACT_STRIDE + RIGID_BODY_MAX);
        } else {
          const contact = sphereObbContact(body.pos, body.radius, box);
          if (!contact.hit) continue;
          body.pos[0] += contact.normal[0] * contact.depth;
          body.pos[1] += contact.normal[1] * contact.depth;
          body.pos[2] += contact.normal[2] * contact.depth;
          applyContactImpulse(state, i, -1, contact.normal, contact.point, options);
          touching.add(i * CONTACT_STRIDE + RIGID_BODY_MAX);
        }
      }
    }
  };
  runStaticPass();

  // 3. Pair collisions (sequential impulses, rest-distance aware).
  // The visit order is the legacy (i, j) order in both modes. With
  // the broad phase on (the default), the pass visits only the
  // candidate pairs while tracking each body's correction path
  // length; afterwards a conservative check compares every
  // dropped pair's start-of-pass distance against the distance
  // its two bodies actually travelled during the pass. If a
  // dropped pair could have come into interaction range
  // mid-pass, the pass is redone from the pre-pass snapshot with
  // the legacy all-pairs loop — so the broad phase is
  // bit-identical to the legacy loop by construction, not by
  // margin luck (identity pinned by the phase46 test).
  const runPairPass = (keys: number[], path: Float64Array | null): void => {
    for (const pairKey of keys) {
      const i = Math.floor(pairKey / RIGID_BODY_MAX);
      const j = pairKey - i * RIGID_BODY_MAX;
      const a = bodies[i];
      const b = bodies[j];
      if (a.sleeping && b.sleeping) continue;
      if (hasLiveBond(state, i, j)) continue; // the weld replaces the contact
      const dx = b.pos[0] - a.pos[0];
      const dy = b.pos[1] - a.pos[1];
      const dz = b.pos[2] - a.pos[2];
      const target = state.restDist[i * RIGID_BODY_MAX + j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (options.convexEnabled && a.shape && b.shape) {
        // OBB narrow phase (Phase 20 stage 1; broad phase
        // widened in Round 84 gap 6 stage 2): a pair reaches
        // the SAT test when it has approached closer than it
        // started (centre distance < rest distance) OR its
        // bounding spheres overlap (centre distance < rA + rB)
        // — the second arm admits rotated elongated bodies
        // whose corners interpenetrate while their centres are
        // still at or beyond the rest distance, which the
        // rest-distance gate alone could not see. The tiling
        // stability rule is preserved on the correction side:
        // a hit corrects by exactly the SAT depth — never more
        // than the shapes themselves demand, the same cap the
        // sphere path states as "never pushed further apart
        // than the bounding spheres demand" — and boxes that do
        // not touch pass through untouched. The correction is
        // split by inverse mass, through the same impulse call
        // as the sphere path (friction / restitution / impact
        // bookkeeping / waking all ride the existing code).
        // Pairs where either body lacks a shape stay on the
        // sphere path below, deliberately: a null shape means
        // the OBB fit failed for that cell (its point cloud
        // always exists), and the sphere is its documented
        // fallback.
        const sphereSum = a.radius + b.radius;
        if (d2 === 0 || (d2 >= target * target && d2 >= sphereSum * sphereSum)) continue;
        const contact = obbSatContact(
          placeObb(a.shape, a.pos, a.quat),
          placeObb(b.shape, b.pos, b.quat),
        );
        if (!contact.hit) continue;
        const invSum = (a.sleeping ? 0 : a.invMass) + (b.sleeping ? 0 : b.invMass);
        if (invSum <= 0) continue;
        const corrA = a.sleeping ? 0 : (a.invMass / invSum) * contact.depth;
        const corrB = b.sleeping ? 0 : (b.invMass / invSum) * contact.depth;
        a.pos[0] -= contact.normal[0] * corrA; a.pos[1] -= contact.normal[1] * corrA; a.pos[2] -= contact.normal[2] * corrA;
        b.pos[0] += contact.normal[0] * corrB; b.pos[1] += contact.normal[1] * corrB; b.pos[2] += contact.normal[2] * corrB;
        if (path) { path[i] += corrA; path[j] += corrB; }
        applyPairImpulse(state, i, j, contact.normal, contact.point, options);
        touching.add(i * CONTACT_STRIDE + j);
        continue;
      }
      if (d2 >= target * target || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d; const ny = dy / d; const nz = dz / d;
      const overlap = target - d;
      const invSum = (a.sleeping ? 0 : a.invMass) + (b.sleeping ? 0 : b.invMass);
      if (invSum <= 0) continue;
      // Positional correction, split by inverse mass.
      const corrA = a.sleeping ? 0 : (a.invMass / invSum) * overlap;
      const corrB = b.sleeping ? 0 : (b.invMass / invSum) * overlap;
      a.pos[0] -= nx * corrA; a.pos[1] -= ny * corrA; a.pos[2] -= nz * corrA;
      b.pos[0] += nx * corrB; b.pos[1] += ny * corrB; b.pos[2] += nz * corrB;
      if (path) { path[i] += corrA; path[j] += corrB; }
      const px = (a.pos[0] + b.pos[0]) / 2;
      const py = (a.pos[1] + b.pos[1]) / 2;
      const pz = (a.pos[2] + b.pos[2]) / 2;
      applyPairImpulse(state, i, j, [nx, ny, nz], [px, py, pz], options);
      touching.add(i * CONTACT_STRIDE + j);
    }
  };
  if (options.broadphase === false) {
    runPairPass(allPairKeys(n), null);
  } else {
    const candidateKeys = broadphasePairKeys(bodies);
    const startPos = new Float64Array(n * 3);
    const snapshot = bodies.map((body, bi) => {
      startPos[bi * 3] = body.pos[0];
      startPos[bi * 3 + 1] = body.pos[1];
      startPos[bi * 3 + 2] = body.pos[2];
      return {
        pos: [...body.pos] as [number, number, number],
        quat: [...body.quat] as [number, number, number, number],
        vel: [...body.vel] as [number, number, number],
        angVel: [...body.angVel] as [number, number, number],
        sleeping: body.sleeping,
        sleepTimer: body.sleepTimer,
        impactDeltaV: body.impactDeltaV,
      };
    });
    const touchingBefore = new Set(touching);
    const path = new Float64Array(n);
    runPairPass(candidateKeys, path);
    if (broadphasePassSuspect(bodies, startPos, path, new Set(candidateKeys))) {
      bodies.forEach((body, bi) => {
        const s = snapshot[bi];
        body.pos[0] = s.pos[0]; body.pos[1] = s.pos[1]; body.pos[2] = s.pos[2];
        body.quat[0] = s.quat[0]; body.quat[1] = s.quat[1]; body.quat[2] = s.quat[2]; body.quat[3] = s.quat[3];
        body.vel[0] = s.vel[0]; body.vel[1] = s.vel[1]; body.vel[2] = s.vel[2];
        body.angVel[0] = s.angVel[0]; body.angVel[1] = s.angVel[1]; body.angVel[2] = s.angVel[2];
        body.sleeping = s.sleeping;
        body.sleepTimer = s.sleepTimer;
        body.impactDeltaV = s.impactDeltaV;
      });
      touching.clear();
      for (const key of touchingBefore) touching.add(key);
      runPairPass(allPairKeys(n), null);
    }
  }

  // 4. Glue welds (position level, two iterations) + strain breaking.
  if (options.glueEnabled) {
    for (let iter = 0; iter < 2; iter++) {
      for (const bond of state.bonds) {
        if (!bond.alive) continue;
        solveBond(state, bond);
      }
    }
    if (options.stressBreakEnabled) {
      // Stress breaking (Phase 20 stage 1): refresh each live
      // bond's instantaneous stress — the same strain the legacy
      // check measures, plus the endpoints' impact Δv
      // normalised by the glue strength (so an impact that
      // would trip the legacy condition contributes stress > 1)
      // — then let the breaks cascade through the propagation
      // queue instead of firing the legacy conditions.
      for (const bond of state.bonds) {
        if (!bond.alive) continue;
        const a = bodies[bond.a];
        const b = bodies[bond.b];
        const desired = quatRotate(a.quat, bond.restOffsetLocal);
        const ex = (b.pos[0] - a.pos[0]) - desired[0];
        const ey = (b.pos[1] - a.pos[1]) - desired[1];
        const ez = (b.pos[2] - a.pos[2]) - desired[2];
        const strain = Math.hypot(ex, ey, ez) / bond.restLength;
        const impactNorm = options.glueStrength > 0
          ? Math.max(a.impactDeltaV, b.impactDeltaV) / options.glueStrength
          : 0;
        bond.stress = strain + impactNorm;
      }
      propagateRigidBondBreaks(state, options.stressPropagation ?? 0.5);
    } else {
      for (const bond of state.bonds) {
        if (!bond.alive) continue;
        const a = bodies[bond.a];
        const b = bodies[bond.b];
        const desired = quatRotate(a.quat, bond.restOffsetLocal);
        const ex = (b.pos[0] - a.pos[0]) - desired[0];
        const ey = (b.pos[1] - a.pos[1]) - desired[1];
        const ez = (b.pos[2] - a.pos[2]) - desired[2];
        const strain = Math.hypot(ex, ey, ez) / bond.restLength;
        if (strain > GLUE_STRAIN_BREAK) {
          bond.alive = false;
          wakeBody(state, bond.a);
          wakeBody(state, bond.b);
        }
      }
      // Impact breaking: a hard collision breaks the body's bonds.
      for (let i = 0; i < n; i++) {
        if (bodies[i].impactDeltaV > options.glueStrength) breakBondsOf(state, i);
      }
    }
  }

  // 4b. XPBD joints (Phase 20 stage 1): solved at the glue
  // position of the substep, independent of the glue switch —
  // the array is empty unless the solver was built with the
  // Joint Enabled key on, so legacy states never enter here.
  if (state.joints.length > 0) {
    // Breaking is judged on the strain the joint actually
    // carries this substep — measured BEFORE the solve, since
    // a rigid (α = 0) solve would erase the strain it is meant
    // to judge. Threshold 0 = unbreakable (xpbdBreakExceeded).
    for (const joint of state.joints) {
      if (!joint.alive) continue;
      const a = bodies[joint.a];
      const b = bodies[joint.b];
      const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]);
      const strain = Math.abs(d - joint.restLength) / joint.restLength;
      if (xpbdBreakExceeded(strain, joint.breakThreshold)) {
        joint.alive = false;
        wakeBody(state, joint.a);
        wakeBody(state, joint.b);
      }
    }
    for (const joint of state.joints) joint.lambda = 0;
    for (let iter = 0; iter < 2; iter++) {
      for (const joint of state.joints) {
        if (!joint.alive) continue;
        solveJoint(state, joint, h, options);
        // Angle limit (UE5 #35 G-C): anchored joints only —
        // the field is absent on centre joints, so this call
        // returns at once there.
        solveJointAngleLimit(state, joint, options);
      }
    }
  }

  // 4b. Static boxes again (UE5 #35 G-D stage D2): the pair and
  // joint passes run after the environment pass and can push a
  // body into a static within the same substep; this repeat —
  // the same pass — restores the no-penetration invariant before
  // the state is observed at frame end and before sleep reads
  // it. Its impulses are no-ops for contacts the first pass
  // already resolved (vn >= 0 returns early in
  // applyContactImpulse, and its friction clamps to μ·jn = 0),
  // so it only corrects what the later passes disturbed.
  runStaticPass();

  // 4c. Contact events (Phase 21 stage 3): keys touched now that
  // were not touching at the previous substep are NEW contacts.
  // States built before this stage (no contactKeys field) start
  // from an empty set. Events never feed back into the physics.
  if (!state.contactKeys) state.contactKeys = new Set();
  if (!state.pendingContactEvents) state.pendingContactEvents = [];
  for (const key of touching) {
    if (state.contactKeys.has(key)) continue;
    const a = Math.floor(key / CONTACT_STRIDE);
    const bRaw = key - a * CONTACT_STRIDE;
    const b = bRaw >= RIGID_BODY_MAX ? -1 : bRaw;
    const impact = b >= 0
      ? Math.max(bodies[a]?.impactDeltaV ?? 0, bodies[b]?.impactDeltaV ?? 0)
      : (bodies[a]?.impactDeltaV ?? 0);
    if (state.pendingContactEvents.length < RIGID_CONTACT_EVENT_CAP) {
      state.pendingContactEvents.push({ a, b, impact });
    }
  }
  state.contactKeys = touching;

  // 5. Sleep bookkeeping + support-loss waking.
  updateSleep(state, h, options);
}

function hasLiveBond(state: RigidSolverState, i: number, j: number): boolean {
  for (const bond of state.bonds) {
    if (bond.alive && ((bond.a === i && bond.b === j) || (bond.a === j && bond.b === i))) return true;
  }
  return false;
}

/**
 * Contact impulse of body i against a static surface (bodyIndex
 * -1 = the environment): normal restitution + Coulomb friction,
 * with torque from the contact point. Records impactDeltaV.
 */
function applyContactImpulse(
  state: RigidSolverState,
  i: number,
  _other: number,
  normal: [number, number, number],
  point: [number, number, number],
  options: RigidStepOptions,
): void {
  const body = state.bodies[i];
  const rx = point[0] - body.pos[0];
  const ry = point[1] - body.pos[1];
  const rz = point[2] - body.pos[2];
  const vx = body.vel[0] + (body.angVel[1] * rz - body.angVel[2] * ry);
  const vy = body.vel[1] + (body.angVel[2] * rx - body.angVel[0] * rz);
  const vz = body.vel[2] + (body.angVel[0] * ry - body.angVel[1] * rx);
  const vn = vx * normal[0] + vy * normal[1] + vz * normal[2];
  if (vn >= 0) return;
  const rest = -vn < 1 ? 0 : options.restitution;
  // Effective mass along the normal at the contact point
  // (sphere inertia, or the box tensor while Convex Inertia
  // is on — inertiaFactor picks).
  const rnX = ry * normal[2] - rz * normal[1];
  const rnY = rz * normal[0] - rx * normal[2];
  const rnZ = rx * normal[1] - ry * normal[0];
  const angFactor = inertiaFactor(body, options, [rnX, rnY, rnZ]);
  const jn = -(1 + rest) * vn / (body.invMass + angFactor);
  applyImpulse(body, normal, jn, [rx, ry, rz], options);
  // Friction: oppose the tangential contact velocity, clamped to μ·jn.
  const tx = vx - vn * normal[0];
  const ty = vy - vn * normal[1];
  const tz = vz - vn * normal[2];
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-9) {
    const jt = Math.min(tLen / (body.invMass + angFactor), options.friction * jn);
    applyImpulse(body, [tx / tLen, ty / tLen, tz / tLen], -jt, [rx, ry, rz], options);
  }
  body.impactDeltaV = Math.max(body.impactDeltaV, Math.abs(jn * body.invMass));
}

function applyPairImpulse(
  state: RigidSolverState,
  i: number,
  j: number,
  normal: [number, number, number],
  point: [number, number, number],
  options: RigidStepOptions,
): void {
  const a = state.bodies[i];
  const b = state.bodies[j];
  const rax = point[0] - a.pos[0]; const ray = point[1] - a.pos[1]; const raz = point[2] - a.pos[2];
  const rbx = point[0] - b.pos[0]; const rby = point[1] - b.pos[1]; const rbz = point[2] - b.pos[2];
  const vax = a.vel[0] + (a.angVel[1] * raz - a.angVel[2] * ray);
  const vay = a.vel[1] + (a.angVel[2] * rax - a.angVel[0] * raz);
  const vaz = a.vel[2] + (a.angVel[0] * ray - a.angVel[1] * rax);
  const vbx = b.vel[0] + (b.angVel[1] * rbz - b.angVel[2] * rby);
  const vby = b.vel[1] + (b.angVel[2] * rbx - b.angVel[0] * rbz);
  const vbz = b.vel[2] + (b.angVel[0] * rby - b.angVel[1] * rbx);
  const rvx = vbx - vax; const rvy = vby - vay; const rvz = vbz - vaz;
  const vn = rvx * normal[0] + rvy * normal[1] + rvz * normal[2];
  if (vn >= 0) return;
  const invA = a.sleeping ? 0 : a.invMass;
  const invB = b.sleeping ? 0 : b.invMass;
  const ranX = ray * normal[2] - raz * normal[1];
  const ranY = raz * normal[0] - rax * normal[2];
  const ranZ = rax * normal[1] - ray * normal[0];
  const rbnX = rby * normal[2] - rbz * normal[1];
  const rbnY = rbz * normal[0] - rbx * normal[2];
  const rbnZ = rbx * normal[1] - rby * normal[0];
  // A sleeping body is infinite mass: its factor contributes 0
  // (inertiaFactor would return its tensor form, so gate here).
  const angFactor = (a.sleeping ? 0 : inertiaFactor(a, options, [ranX, ranY, ranZ]))
    + (b.sleeping ? 0 : inertiaFactor(b, options, [rbnX, rbnY, rbnZ]));
  const invSum = invA + invB + angFactor;
  if (invSum <= 0) return;
  const rest = -vn < 1 ? 0 : options.restitution;
  const jn = -(1 + rest) * vn / invSum;
  if (!a.sleeping) applyImpulse(a, normal, -jn, [rax, ray, raz], options);
  if (!b.sleeping) applyImpulse(b, normal, jn, [rbx, rby, rbz], options);
  // Friction along the tangential relative velocity.
  const tx = rvx - vn * normal[0];
  const ty = rvy - vn * normal[1];
  const tz = rvz - vn * normal[2];
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-9) {
    const jt = Math.min(tLen / invSum, options.friction * jn);
    if (!a.sleeping) applyImpulse(a, [tx / tLen, ty / tLen, tz / tLen], jt, [rax, ray, raz], options);
    if (!b.sleeping) applyImpulse(b, [tx / tLen, ty / tLen, tz / tLen], -jt, [rbx, rby, rbz], options);
  }
  // Impact bookkeeping uses the REAL inverse masses even for a
  // sleeping body: the Δv it WOULD receive is what the wake test
  // and the glue-break test measure (its applied share above was
  // zero — a sleeper is infinite mass until it wakes).
  const dvA = Math.abs(jn * a.invMass);
  const dvB = Math.abs(jn * b.invMass);
  a.impactDeltaV = Math.max(a.impactDeltaV, dvA);
  b.impactDeltaV = Math.max(b.impactDeltaV, dvB);
  // Activation path (b): an awake body's hard impact wakes the sleeper.
  if (a.sleeping && !b.sleeping && dvA > WAKE_DELTA_V) wakeBody(state, i);
  if (b.sleeping && !a.sleeping && dvB > WAKE_DELTA_V) wakeBody(state, j);
}

/** Apply impulse J·dir at offset r from the centre: Δv and Δω.
 *  Δω uses the box tensor while Convex Inertia is on for this
 *  body (tensorActive), the sphere scalar otherwise. */
function applyImpulse(
  body: RigidBody,
  dir: [number, number, number],
  magnitude: number,
  r: [number, number, number],
  options: RigidStepOptions,
): void {
  body.vel[0] += dir[0] * magnitude * body.invMass;
  body.vel[1] += dir[1] * magnitude * body.invMass;
  body.vel[2] += dir[2] * magnitude * body.invMass;
  const jx = dir[0] * magnitude; const jy = dir[1] * magnitude; const jz = dir[2] * magnitude;
  const tx = r[1] * jz - r[2] * jy;
  const ty = r[2] * jx - r[0] * jz;
  const tz = r[0] * jy - r[1] * jx;
  if (tensorActive(body, options)) {
    const dw = obbInertiaResponse(body.shape as RigidObb, body.quat, body.invInertiaAxis as [number, number, number], [tx, ty, tz]);
    body.angVel[0] += dw[0];
    body.angVel[1] += dw[1];
    body.angVel[2] += dw[2];
    return;
  }
  body.angVel[0] += tx * body.invInertia;
  body.angVel[1] += ty * body.invInertia;
  body.angVel[2] += tz * body.invInertia;
}

/**
 * One weld iteration for a bond: pull the pair's relative
 * position toward the rest offset (in a's current frame) and
 * nudge both orientations toward the rest relative orientation.
 * Corrections split by inverse mass / inertia; a sleeping body
 * counts as infinite mass unless both are awake.
 */
function solveBond(state: RigidSolverState, bond: RigidBond): void {
  const a = state.bodies[bond.a];
  const b = state.bodies[bond.b];
  const invA = a.sleeping ? 0 : a.invMass;
  const invB = b.sleeping ? 0 : b.invMass;
  const invSum = invA + invB;
  if (invSum <= 0) return;
  const desired = quatRotate(a.quat, bond.restOffsetLocal);
  const ex = (b.pos[0] - a.pos[0]) - desired[0];
  const ey = (b.pos[1] - a.pos[1]) - desired[1];
  const ez = (b.pos[2] - a.pos[2]) - desired[2];
  const shareA = invA / invSum;
  const shareB = invB / invSum;
  a.pos[0] += ex * shareA; a.pos[1] += ey * shareA; a.pos[2] += ez * shareA;
  b.pos[0] -= ex * shareB; b.pos[1] -= ey * shareB; b.pos[2] -= ez * shareB;
  // Orientation: desired qB = qA · restRelQuat. Nudge both toward
  // agreement (nlerp by half the share — a bounded small step).
  const desiredB = quatMultiply(a.quat, bond.restRelQuat);
  const dotB = b.quat[0] * desiredB[0] + b.quat[1] * desiredB[1] + b.quat[2] * desiredB[2] + b.quat[3] * desiredB[3];
  const signB = dotB < 0 ? -1 : 1;
  if (!b.sleeping) {
    const t = 0.5 * shareB + 0.25 * shareA;
    b.quat = quatNormalize([
      b.quat[0] + (signB * desiredB[0] - b.quat[0]) * t,
      b.quat[1] + (signB * desiredB[1] - b.quat[1]) * t,
      b.quat[2] + (signB * desiredB[2] - b.quat[2]) * t,
      b.quat[3] + (signB * desiredB[3] - b.quat[3]) * t,
    ]);
  }
  const desiredA = quatMultiply(b.quat, quatConjugate(bond.restRelQuat));
  const dotA = a.quat[0] * desiredA[0] + a.quat[1] * desiredA[1] + a.quat[2] * desiredA[2] + a.quat[3] * desiredA[3];
  const signA = dotA < 0 ? -1 : 1;
  if (!a.sleeping) {
    const t = 0.5 * shareA + 0.25 * shareB;
    a.quat = quatNormalize([
      a.quat[0] + (signA * desiredA[0] - a.quat[0]) * t,
      a.quat[1] + (signA * desiredA[1] - a.quat[1]) * t,
      a.quat[2] + (signA * desiredA[2] - a.quat[2]) * t,
      a.quat[3] + (signA * desiredA[3] - a.quat[3]) * t,
    ]);
  }
}

/**
 * One XPBD iteration for a centre-distance joint: C is the
 * current centre distance minus the rest length, the gradients
 * are the unit axis (a toward b), the weights are the bodies'
 * inverse masses (a sleeping body counts as infinite mass, the
 * solveBond rule), and Δλ comes from the shared xpbdDeltaLambda
 * with α̃ from the joint's compliance. Position-level only,
 * like the glue weld — velocities are not reconstructed.
 */
function solveJoint(state: RigidSolverState, joint: RigidJoint, h: number, options: RigidStepOptions): void {
  // Anchored joints (UE5 #35 G-C) take the anchor-point path;
  // centre joints run the legacy body below verbatim.
  if (joint.anchorA && joint.anchorB) {
    solveJointAnchored(state, joint, h, options);
    return;
  }
  const a = state.bodies[joint.a];
  const b = state.bodies[joint.b];
  const invA = a.sleeping ? 0 : a.invMass;
  const invB = b.sleeping ? 0 : b.invMass;
  const invSum = invA + invB;
  if (invSum <= 0) return;
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dz = b.pos[2] - a.pos[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) return;
  const nx = dx / d; const ny = dy / d; const nz = dz / d;
  const c = d - joint.restLength;
  const alphaTilde = xpbdAlphaTilde(joint.compliance, h);
  const dl = xpbdDeltaLambda(c, joint.lambda, alphaTilde, invSum);
  joint.lambda += dl;
  // Δx_a = Δλ · w_a · ∇C_a with ∇C_a = −n̂; Δx_b likewise +n̂.
  a.pos[0] -= dl * invA * nx; a.pos[1] -= dl * invA * ny; a.pos[2] -= dl * invA * nz;
  b.pos[0] += dl * invB * nx; b.pos[1] += dl * invB * ny; b.pos[2] += dl * invB * nz;
}

/** I⁻¹ · v for the body's active inertia (box tensor while
 *  Convex Inertia is on for this body, the sphere scalar
 *  otherwise) — the rotational twin of applyImpulse's angular
 *  part, for position-level corrections. */
function angularResponse(
  body: RigidBody,
  options: RigidStepOptions,
  v: [number, number, number],
): [number, number, number] {
  if (tensorActive(body, options)) {
    return obbInertiaResponse(body.shape as RigidObb, body.quat, body.invInertiaAxis as [number, number, number], v);
  }
  return [v[0] * body.invInertia, v[1] * body.invInertia, v[2] * body.invInertia];
}

/** vᵀ · I⁻¹ · v for the body's active inertia (0 while the
 *  body sleeps — a sleeping body counts as infinite mass, the
 *  solveBond rule). */
function rotationalWeight(
  body: RigidBody,
  options: RigidStepOptions,
  v: [number, number, number],
): number {
  if (body.sleeping) return 0;
  if (tensorActive(body, options)) {
    return obbInertiaFactor(body.shape as RigidObb, body.quat, body.invInertiaAxis as [number, number, number], v);
  }
  return (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) * body.invInertia;
}

/** Rotate a body's orientation by the world-frame rotation
 *  vector Δθ (position level, the integrator's quaternion
 *  update with the step length folded into Δθ). */
function applyRotationDelta(body: RigidBody, dTheta: [number, number, number]): void {
  if (dTheta[0] === 0 && dTheta[1] === 0 && dTheta[2] === 0) return;
  const dq = quatMultiply([dTheta[0], dTheta[1], dTheta[2], 0], body.quat);
  body.quat = quatNormalize([
    body.quat[0] + 0.5 * dq[0],
    body.quat[1] + 0.5 * dq[1],
    body.quat[2] + 0.5 * dq[2],
    body.quat[3] + 0.5 * dq[3],
  ]);
}

/**
 * One XPBD iteration for an ANCHORED joint (UE5 #35 G-C — the
 * implementation side of the XpbdJointSpec socket): the
 * constraint binds the two anchor points,
 *   C = |pB − pA| − anchorRest,  p = pos + R · anchorLocal,
 * with the full rigid-body gradients: the linear weight is the
 * inverse mass, the rotational weight is (r × n̂)ᵀ I⁻¹ (r × n̂)
 * per body (r = the anchor's offset from the centre), and the
 * correction moves both the position and the orientation of
 * each body (Δθ = ∓Δλ · I⁻¹(r × n̂)). Δλ comes from the same
 * shared xpbdDeltaLambda as the centre path, with α̃ from the
 * joint's compliance. Position-level only, like the centre
 * path — velocities are not reconstructed.
 */
function solveJointAnchored(state: RigidSolverState, joint: RigidJoint, h: number, options: RigidStepOptions): void {
  const a = state.bodies[joint.a];
  const b = state.bodies[joint.b];
  const invA = a.sleeping ? 0 : a.invMass;
  const invB = b.sleeping ? 0 : b.invMass;
  if (invA + invB <= 0) return;
  const rA = quatRotate(a.quat, joint.anchorA as [number, number, number]);
  const rB = quatRotate(b.quat, joint.anchorB as [number, number, number]);
  const pAx = a.pos[0] + rA[0]; const pAy = a.pos[1] + rA[1]; const pAz = a.pos[2] + rA[2];
  const pBx = b.pos[0] + rB[0]; const pBy = b.pos[1] + rB[1]; const pBz = b.pos[2] + rB[2];
  const dx = pBx - pAx; const dy = pBy - pAy; const dz = pBz - pAz;
  const d = Math.hypot(dx, dy, dz);
  const rest = joint.anchorRest ?? 0;
  if (d < 1e-9) {
    // Coincident anchors: at rest when rest is 0; with a
    // positive rest the axis is undefined — leave the pair to
    // the contact / centre paths for this substep.
    return;
  }
  const n: [number, number, number] = [dx / d, dy / d, dz / d];
  const c = d - rest;
  if (c === 0) return;
  const rnA: [number, number, number] = [
    rA[1] * n[2] - rA[2] * n[1],
    rA[2] * n[0] - rA[0] * n[2],
    rA[0] * n[1] - rA[1] * n[0],
  ];
  const rnB: [number, number, number] = [
    rB[1] * n[2] - rB[2] * n[1],
    rB[2] * n[0] - rB[0] * n[2],
    rB[0] * n[1] - rB[1] * n[0],
  ];
  const wA = invA + rotationalWeight(a, options, rnA);
  const wB = invB + rotationalWeight(b, options, rnB);
  const wSum = wA + wB;
  if (wSum <= 0) return;
  const alphaTilde = xpbdAlphaTilde(joint.compliance, h);
  const dl = xpbdDeltaLambda(c, joint.lambda, alphaTilde, wSum);
  joint.lambda += dl;
  if (dl === 0) return;
  // Linear parts: Δx_a = −Δλ · w_a^lin · n̂, Δx_b = +Δλ · w_b^lin · n̂.
  a.pos[0] -= dl * invA * n[0]; a.pos[1] -= dl * invA * n[1]; a.pos[2] -= dl * invA * n[2];
  b.pos[0] += dl * invB * n[0]; b.pos[1] += dl * invB * n[1]; b.pos[2] += dl * invB * n[2];
  // Rotational parts: Δθ_a = −Δλ · I⁻¹(rA × n̂), Δθ_b = +Δλ · I⁻¹(rB × n̂).
  if (!a.sleeping) {
    const dw = angularResponse(a, options, rnA);
    applyRotationDelta(a, [-dl * dw[0], -dl * dw[1], -dl * dw[2]]);
  }
  if (!b.sleeping) {
    const dw = angularResponse(b, options, rnB);
    applyRotationDelta(b, [dl * dw[0], dl * dw[1], dl * dw[2]]);
  }
}

/**
 * The angle limit of an anchored joint (UE5 #35 G-C): the
 * pair's relative orientation qA⁻¹·qB may deviate from its
 * build-time value (restRelQuat) by at most angleLimitRad.
 * The excess rotation is removed positionally, split between
 * the two bodies by their rotational weights about the error
 * axis (the solveBond split rule, with the active inertia) —
 * A turns forward along the axis, B turns back, so the
 * relative angle closes by exactly the excess. No limit
 * (absent / 0) or no anchors: returns at once, so centre
 * joints never enter here in effect.
 */
function solveJointAngleLimit(state: RigidSolverState, joint: RigidJoint, options: RigidStepOptions): void {
  const limit = joint.angleLimitRad ?? 0;
  if (!(limit > 0) || !joint.restRelQuat) return;
  const a = state.bodies[joint.a];
  const b = state.bodies[joint.b];
  if (a.sleeping && b.sleeping) return;
  const qRel = quatMultiply(quatConjugate(a.quat), b.quat);
  let qErr = quatMultiply(qRel, quatConjugate(joint.restRelQuat));
  // Shortest arc: keep w ≥ 0 so the angle lands in [0, π].
  if (qErr[3] < 0) qErr = [-qErr[0], -qErr[1], -qErr[2], -qErr[3]];
  const w = Math.max(-1, Math.min(1, qErr[3]));
  const angle = 2 * Math.acos(w);
  if (angle <= limit) return;
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  if (sinHalf < 1e-9) return;
  // Error axis in A's local frame → world frame.
  const axisWorld = quatRotate(a.quat, [qErr[0] / sinHalf, qErr[1] / sinHalf, qErr[2] / sinHalf]);
  const excess = angle - limit;
  const wA = rotationalWeight(a, options, axisWorld);
  const wB = rotationalWeight(b, options, axisWorld);
  const wSum = wA + wB;
  if (wSum <= 0) return;
  if (!a.sleeping) {
    const t = excess * (wA / wSum);
    applyRotationDelta(a, [axisWorld[0] * t, axisWorld[1] * t, axisWorld[2] * t]);
  }
  if (!b.sleeping) {
    const t = excess * (wB / wSum);
    applyRotationDelta(b, [-axisWorld[0] * t, -axisWorld[1] * t, -axisWorld[2] * t]);
  }
}

function updateSleep(state: RigidSolverState, h: number, options: RigidStepOptions): void {
  const bodies = state.bodies;
  const n = bodies.length;
  let anySleeping = false;
  for (const body of bodies) {
    if (body.sleeping) { anySleeping = true; continue; }
    const lin = Math.hypot(body.vel[0], body.vel[1], body.vel[2]);
    const ang = Math.hypot(body.angVel[0], body.angVel[1], body.angVel[2]);
    if (lin < SLEEP_LIN_SPEED && ang < SLEEP_ANG_SPEED) {
      body.sleepTimer += h;
      if (body.sleepTimer >= SLEEP_DELAY) {
        body.sleeping = true;
        body.vel = [0, 0, 0];
        body.angVel = [0, 0, 0];
        anySleeping = true;
      }
    } else {
      body.sleepTimer = 0;
    }
  }
  if (!anySleeping) return;
  // Support-loss waking: a connected component of sleeping
  // bodies with no member touching the floor wakes as a whole
  // (a floating assembly cannot hang in the air asleep). Contact
  // = pair distance at (or under) the pair's rest distance, or a
  // live bond.
  const comp = new Int32Array(n).fill(-1);
  let compCount = 0;
  for (let s = 0; s < n; s++) {
    if (!bodies[s].sleeping || comp[s] !== -1) continue;
    const stack = [s];
    comp[s] = compCount;
    let supported = false;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const bi = bodies[i];
      if (options.floorEnabled && bi.pos[1] - bi.radius <= floorSurfaceYAt(options, bi.pos[0], bi.pos[2]) + 0.25) supported = true;
      if (!supported && options.staticBoxes) {
        // Static boxes (UE5 #35 G-D stage D2) also support sleep:
        // the body's bounding sphere within 0.25 of a box surface
        // whose push-out normal points up counts as resting on
        // it (the sphere test serves both shape paths here — a
        // documented approximation; side contacts are excluded
        // by the normal's Y component).
        for (const box of options.staticBoxes) {
          const c = sphereObbContact(bi.pos, bi.radius + 0.25, box);
          if (c.hit && c.normal[1] > 0.5) { supported = true; break; }
        }
      }
      for (let j = 0; j < n; j++) {
        if (j === i || !bodies[j].sleeping || comp[j] !== -1) continue;
        const dx = bodies[j].pos[0] - bi.pos[0];
        const dy = bodies[j].pos[1] - bi.pos[1];
        const dz = bodies[j].pos[2] - bi.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d <= state.restDist[i * RIGID_BODY_MAX + j] + 0.25 || hasLiveBond(state, i, j)) {
          comp[j] = compCount;
          stack.push(j);
        }
      }
    }
    if (!supported) {
      for (let i = 0; i < n; i++) if (comp[i] === compCount) wakeBody(state, i);
    }
    compCount += 1;
  }
}

// ── GPU supply ──

/**
 * Pack the body state into the RIGID_BODY_MAX×4 RGBA float backing array of
 * the supply DataTexture. Row 0: position xyz + bounding radius.
 * Row 1: quaternion xyzw. Row 2: linear velocity xyz + sleeping
 * flag. Row 3: angular velocity xyz + 0. Bodies past the count
 * stay zeroed (identity position at the origin with radius 0 —
 * never sampled, since cell indices only name real bodies).
 */
export function writeRigidBodyTexture(state: RigidSolverState, out: Float32Array): void {
  const n = Math.min(state.bodies.length, RIGID_BODY_MAX);
  for (let i = 0; i < n; i++) {
    const body = state.bodies[i];
    const row0 = i * 4;
    out[row0] = body.pos[0]; out[row0 + 1] = body.pos[1]; out[row0 + 2] = body.pos[2]; out[row0 + 3] = body.radius;
    const row1 = (RIGID_BODY_MAX + i) * 4;
    out[row1] = body.quat[0]; out[row1 + 1] = body.quat[1]; out[row1 + 2] = body.quat[2]; out[row1 + 3] = body.quat[3];
    const row2 = (2 * RIGID_BODY_MAX + i) * 4;
    out[row2] = body.vel[0]; out[row2 + 1] = body.vel[1]; out[row2 + 2] = body.vel[2]; out[row2 + 3] = body.sleeping ? 1 : 0;
    const row3 = (3 * RIGID_BODY_MAX + i) * 4;
    out[row3] = body.angVel[0]; out[row3 + 1] = body.angVel[1]; out[row3 + 2] = body.angVel[2]; out[row3 + 3] = 0;
  }
}

// ── Config resolution ──

/** Euler angles in degrees (XYZ order, the three.js convention:
 *  R = Rx·Ry·Rz) to a quaternion [x, y, z, w]. */
function quatFromEulerDeg(e: [number, number, number]): [number, number, number, number] {
  const hx = (e[0] * Math.PI / 180) / 2;
  const hy = (e[1] * Math.PI / 180) / 2;
  const hz = (e[2] * Math.PI / 180) / 2;
  const qx: [number, number, number, number] = [Math.sin(hx), 0, 0, Math.cos(hx)];
  const qy: [number, number, number, number] = [0, Math.sin(hy), 0, Math.cos(hy)];
  const qz: [number, number, number, number] = [0, 0, Math.sin(hz), Math.cos(hz)];
  return quatMultiply(qx, quatMultiply(qy, qz));
}

/** Max static boxes a scene may carry (UE5 #35 G-D stage D2). */
export const RIGID_STATIC_BOX_MAX = 16;

/**
 * Parse the gpgpuRigidStaticBoxes key (UE5 #35 G-D stage D2): a
 * JSON array of `{ c: [x,y,z], h: [hx,hy,hz], e: [rx,ry,rz] }`
 * (centre, half extents, Euler degrees; `e` may be omitted for
 * an axis-aligned box) into world-space OBBs. Sanitising, in the
 * established JSON-key style: a non-string / empty / unparsable /
 * non-array value yields [], each entry is validated on its own
 * (a bad entry is dropped, never the whole list), centres must
 * be finite within ±2000, half extents are clamped to
 * 0.05..1000, and at most RIGID_STATIC_BOX_MAX boxes are kept.
 */
export function parseRigidStaticBoxes(json: unknown): RigidObb[] {
  if (typeof json !== 'string' || json === '') return [];
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const vec = (v: unknown): [number, number, number] | null =>
    Array.isArray(v) && v.length === 3
    && v.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? [v[0] as number, v[1] as number, v[2] as number]
      : null;
  const out: RigidObb[] = [];
  for (const entry of raw) {
    if (out.length >= RIGID_STATIC_BOX_MAX) break;
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const c = vec(rec.c);
    const h = vec(rec.h);
    const e = rec.e === undefined ? [0, 0, 0] as [number, number, number] : vec(rec.e);
    if (!c || !h || !e) continue;
    if (Math.abs(c[0]) > 2000 || Math.abs(c[1]) > 2000 || Math.abs(c[2]) > 2000) continue;
    const q = quatFromEulerDeg(e);
    out.push({
      center: c,
      axes: [
        obbQuatRotate(q, [1, 0, 0]),
        obbQuatRotate(q, [0, 1, 0]),
        obbQuatRotate(q, [0, 0, 1]),
      ],
      halfExtents: [
        Math.max(0.05, Math.min(1000, h[0])),
        Math.max(0.05, Math.min(1000, h[1])),
        Math.max(0.05, Math.min(1000, h[2])),
      ],
    });
  }
  return out;
}

export interface RigidResolved {
  /** Master switch: the Enabled key. Everything else is inert while false. */
  active: boolean;
  restitution: number;
  friction: number;
  glueEnabled: boolean;
  glueStrength: number;
  startSleeping: boolean;
  /** Floor Terrain key (Phase BA): while true the step is
   *  supplied the published heightfield (when one exists) and
   *  the floor stands on the terrain; false — or no field —
   *  keeps the flat plane. */
  floorTerrain: boolean;
  /** Multi-sample sphere floor (UE5 #35 G-D stage D1): while
   *  true, the step's sphere floor path samples the terrain
   *  under each body's whole disc. Read only while a
   *  heightfield is supplied (the Floor Terrain key). */
  floorMultiSample: boolean;
  /** Static boxes (UE5 #35 G-D stage D2): the parsed
   *  gpgpuRigidStaticBoxes key as world-space OBBs. Empty keeps
   *  every step verbatim (the step option is only supplied
   *  while the list is non-empty). */
  staticBoxes: RigidObb[];
  /** XPBD joints (Phase 20 stage 1): built only while true. */
  jointEnabled: boolean;
  /** Joint compliance α (0 = rigid). */
  jointCompliance: number;
  /** Joint break threshold (strain; 0 = unbreakable). */
  jointBreakThreshold: number;
  /** Anchored joints (UE5 #35 G-C): built only while true
   *  (AND jointEnabled) — the joints bind anchor points with
   *  rotational coupling instead of the body centres. */
  jointAnchors: boolean;
  /** Angle limit for anchored joints, radians (UE5 #35 G-C):
   *  0 = no limit. */
  jointAngleLimitRad: number;
  /** Stress break (Phase 20 stage 1): while true the step runs
   *  the stress / propagation breaking instead of the legacy
   *  strain / impact conditions. */
  stressBreakEnabled: boolean;
  /** Stress propagation rate (0..1). */
  stressPropagation: number;
  /** OBB shape collision (Phase 20 stage 1): bodies are built
   *  with fitted OBB shapes and the step uses them while true. */
  convexEnabled: boolean;
  /** OBB box inertia (Round 84 gap 6, stage 1): while true
   *  (AND convexEnabled), shaped bodies answer angular
   *  responses with the box inertia tensor. */
  convexInertia: boolean;
  /** Field force coupling (Round 84 gap 3, stage 1): while true
   *  the caller fills RigidStepOptions.externalAccel from the
   *  curl field twin once per frame. Inert while false. */
  forceEnabled: boolean;
  /** Force source: only 'curl' is wired in stage 1. */
  forceSource: string;
  /** Force scale (the calibration ladder picks the working
   *  value; 1.0 = the raw GPU-equivalent conversion, which is
   *  10-30x gravity — see fillRigidCurlAccel). */
  forceScale: number;
  /** Torque (coupling stage 1b): while true the caller also
   *  fills RigidStepOptions.externalAngAccel from the surface
   *  point sample. Inert while false (stage 1 verbatim). */
  forceTorque: boolean;
  /** Wake-by-force threshold (coupling stage 1b), world / s²:
   *  a sleeping body wakes when its sampled |accel| reaches
   *  this. 0 = force never wakes (stage 1 behaviour). */
  forceWakeThreshold: number;
  /** Free particles (coupling stage 2): while true (AND the
   *  solver active), a hash-split subset of the pool runs as
   *  free particles that collide with the body spheres instead
   *  of being kinematically attached. Inert while false. */
  freeEnabled: boolean;
  /** Free subset fraction (0..0.95) for stage 2. */
  freeFraction: number;
}

/**
 * The single resolution point for the RBD keys. Every consumer
 * (runtime build, pass uniforms, solver step options, capability
 * registry) reads the solver through here so the clamps can never
 * drift apart. Note the solver only BINDS while a fracture cell
 * table exists (morph bake present); the passes additionally gate
 * on the supply textures, so enabling the key without a morph
 * cloud is inert rather than broken.
 */
export function resolveRigid(config: ParticleConfig): RigidResolved {
  return {
    active: !!config.gpgpuRigidEnabled,
    restitution: Math.max(0, Math.min(1, config.gpgpuRigidRestitution ?? 0.2)),
    friction: Math.max(0, Math.min(1, config.gpgpuRigidFriction ?? 0.5)),
    glueEnabled: config.gpgpuRigidGlueEnabled !== false,
    glueStrength: Math.max(0, Math.min(1000, config.gpgpuRigidGlueStrength ?? 45)),
    startSleeping: !!config.gpgpuRigidStartSleeping,
    floorTerrain: !!config.gpgpuRigidFloorTerrain,
    floorMultiSample: !!config.gpgpuRigidFloorMultiSample,
    staticBoxes: parseRigidStaticBoxes(config.gpgpuRigidStaticBoxes),
    jointEnabled: !!config.gpgpuRigidJointEnabled,
    jointCompliance: Math.max(0, config.gpgpuRigidJointCompliance ?? 0),
    jointBreakThreshold: Math.max(0, config.gpgpuRigidJointBreakThreshold ?? 0),
    jointAnchors: !!config.gpgpuRigidJointAnchorEnabled,
    jointAngleLimitRad: (Number.isFinite(config.gpgpuRigidJointAngleLimitDeg)
      ? Math.max(0, Math.min(180, config.gpgpuRigidJointAngleLimitDeg as number))
      : 0) * (Math.PI / 180),
    stressBreakEnabled: !!config.gpgpuRigidStressBreakEnabled,
    stressPropagation: Math.max(0, Math.min(1, config.gpgpuRigidStressPropagation ?? 0.5)),
    convexEnabled: !!config.gpgpuRigidConvexEnabled,
    convexInertia: !!config.gpgpuRigidConvexInertia,
    forceEnabled: !!config.gpgpuRigidForceEnabled,
    forceSource: typeof config.gpgpuRigidForceSource === 'string' ? config.gpgpuRigidForceSource : 'curl',
    forceScale: Number.isFinite(config.gpgpuRigidForceScale) ? Math.max(0, Math.min(4, config.gpgpuRigidForceScale as number)) : 1,
    forceTorque: !!config.gpgpuRigidForceTorque,
    forceWakeThreshold: Number.isFinite(config.gpgpuRigidForceWakeThreshold) ? Math.max(0, Math.min(4000, config.gpgpuRigidForceWakeThreshold as number)) : 0,
    freeEnabled: !!config.gpgpuRigidFreeEnabled,
    freeFraction: Number.isFinite(config.gpgpuRigidFreeFraction) ? Math.max(0, Math.min(0.95, config.gpgpuRigidFreeFraction as number)) : 0.25,
  };
}

/** Curl field params for the rigid force coupling, from the
 *  config's curl keys (the gpgpuSimulationPasses mapping: mode /
 *  symmetry string tables, octaves clamped 1..3, speed clamped
 *  0..4). The clock is the SOLVER's own time, so the sample is a
 *  pure function of the stepped substep count. Replica 0's seed
 *  offset is (0,0,0) (the main stack). */
export function rigidCurlParamsFromConfig(config: ParticleConfig, time: number): CurlFieldParams {
  const modeMap: Record<string, number> = { curl: 0, ridged: 1, vortex: 2 };
  const symMap: Record<string, number> = { none: 0, mirrorX: 1, radial4: 2, radial6: 3, octahedral: 4 };
  return {
    enabled: !!config.gpgpuCurlEnabled,
    scale: config.gpgpuCurlScale,
    speed: Math.max(0, Math.min(4, config.gpgpuCurlSpeed)),
    mode: modeMap[config.gpgpuCurlMode] ?? 0,
    octaves: Math.max(1, Math.min(3, Math.round(config.gpgpuCurlOctaves))),
    symmetry: symMap[config.gpgpuCurlSymmetry] ?? 0,
    seedOffset: [0, 0, 0],
    time,
  };
}

/**
 * Fill `out` (3 floats per body) with the curl coupling
 * acceleration for every body, sampled at the body's centre of
 * mass (Round 84 gap 3, stage 1). The conversion follows the
 * particle gravity precedent in sceneGpgpuSystem: the GPU curl
 * branch adds curl * uCurlStrength * 20.0 * uDelta * grpCurl to
 * a velocity that positions integrate at vel * dt * 60, so the
 * world-space acceleration is
 *   a = sampleCurlField(pos, params) * uCurlStrength * 20.0 * 60.0 * grpCurl(=1) * forceScale.
 * At the default keys this is 10-30x gravity — forceScale is
 * the calibration dial (the prototype ladder is
 * {0.01, 0.03, 0.1, 0.3, 1.0}). Pure: same (positions, params)
 * in, same accelerations out.
 */
export function fillRigidCurlAccel(
  state: RigidSolverState,
  params: CurlFieldParams,
  curlStrength: number,
  forceScale: number,
  out: Float32Array,
): Float32Array {
  const k = curlStrength * 20.0 * 60.0 * forceScale;
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i++) {
    // The fast sampler returns a shared scratch — consumed
    // immediately here, before the next call.
    const s = sampleCurlFieldFast(bodies[i].pos, params);
    out[i * 3] = s[0] * k;
    out[i * 3 + 1] = s[1] * k;
    out[i * 3 + 2] = s[2] * k;
  }
  return out;
}

/**
 * Fill `out` (3 floats per body) with the ANGULAR acceleration
 * of the stage 1b torque (coupling stage 1b). The field force
 * is sampled at a body-fixed surface point — the local +X pole,
 * r = quatRotate(quat, (radius, 0, 0)) — and the torque about
 * the centre is τ = r × F with F = a_surface · mass; the
 * angular acceleration is α = τ · invInertia (the isotropic
 * sphere scalar; the OBB tensor path is not used for the
 * field torque in this stage). Same conversion constant as
 * fillRigidCurlAccel. Pure in (positions, orientations,
 * params), like the linear filler.
 */
export function fillRigidCurlAngAccel(
  state: RigidSolverState,
  params: CurlFieldParams,
  curlStrength: number,
  forceScale: number,
  out: Float32Array,
): Float32Array {
  const k = curlStrength * 20.0 * 60.0 * forceScale;
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const r = quatRotate(body.quat, [body.radius, 0, 0]);
    const ps: [number, number, number] = [body.pos[0] + r[0], body.pos[1] + r[1], body.pos[2] + r[2]];
    const s = sampleCurlFieldFast(ps, params);
    const fx = s[0] * k * body.mass;
    const fy = s[1] * k * body.mass;
    const fz = s[2] * k * body.mass;
    out[i * 3] = (r[1] * fz - r[2] * fy) * body.invInertia;
    out[i * 3 + 1] = (r[2] * fx - r[0] * fz) * body.invInertia;
    out[i * 3 + 2] = (r[0] * fy - r[1] * fx) * body.invInertia;
  }
  return out;
}

/**
 * CPU twin of the stage 2 free-particle body-sphere collision
 * (coupling stage 2): push a free particle out of every body
 * sphere it penetrates and reflect its velocity about the
 * contact normal with `bounce` restitution — the exact law
 * the GLSL position/velocity passes apply (position pass:
 * push-out along the normal; velocity pass: vn reflection
 * while approaching). Bodies are visited in index order and
 * corrections apply sequentially, mirroring the shader loops.
 * Pure: (pos, vel, bodies) in, corrected (pos, vel) out.
 */
export function collideFreeParticleWithBodies(
  pos: [number, number, number],
  vel: [number, number, number],
  bodies: readonly { pos: [number, number, number]; radius: number }[],
  bounce: number,
): { pos: [number, number, number]; vel: [number, number, number]; contacts: number } {
  const p: [number, number, number] = [pos[0], pos[1], pos[2]];
  const v: [number, number, number] = [vel[0], vel[1], vel[2]];
  let contacts = 0;
  for (let b = 0; b < bodies.length; b++) {
    const c = bodies[b].pos;
    const dx = p[0] - c[0]; const dy = p[1] - c[1]; const dz = p[2] - c[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const r = bodies[b].radius;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2);
    // Degenerate centre hit: exit along +Y (the shader adds the
    // same epsilon offset before normalising).
    const nx = d > 1e-6 ? dx / d : 0;
    const ny = d > 1e-6 ? dy / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    p[0] = c[0] + nx * r; p[1] = c[1] + ny * r; p[2] = c[2] + nz * r;
    const vn = v[0] * nx + v[1] * ny + v[2] * nz;
    if (vn < 0) {
      v[0] -= nx * vn * (1 + bounce);
      v[1] -= ny * vn * (1 + bounce);
      v[2] -= nz * vn * (1 + bounce);
    }
    contacts++;
  }
  return { pos: p, vel: v, contacts };
}

/**
 * The fracture division the rigid bodies bind to: the AG fracture
 * keys (cells / seed), with the gap taken from the fracture key
 * only while the fracture itself is enabled — the local offsets
 * must match the cloud the bake actually produced.
 */
export function rigidFractureOptionFromConfig(config: ParticleConfig): { cells: number; seed: number; gap: number } {
  return {
    cells: Number.isFinite(config.gpgpuMorphFractureCells) ? (config.gpgpuMorphFractureCells as number) : 12,
    seed: Number.isFinite(config.gpgpuMorphFractureSeed) ? (config.gpgpuMorphFractureSeed as number) : 1,
    gap: config.gpgpuMorphFractureEnabled
      ? (Number.isFinite(config.gpgpuMorphFractureGap) ? (config.gpgpuMorphFractureGap as number) : 0.25)
      : 0,
  };
}
