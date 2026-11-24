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
import { buildObbsForCells, obbSatContact, obbSupportPoint, placeObb } from './rigidObb';
import type { RigidObb } from './rigidObb';

/** Hard body budget: the fracture clamp (Phase AG) caps cells at 64. */
export const RIGID_BODY_MAX = 64;
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
  for (const body of bodies) {
    if (body.sleeping) continue;
    body.vel[1] += options.gravityY * h;
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
        const floorDist = body.pos[1] - body.radius - groundY;
        if (floorDist < 0) {
          body.pos[1] -= floorDist;
          const normal: [number, number, number] = hf
            ? rigidHeightfieldNormal(hf, body.pos[0], body.pos[2])
            : [0, 1, 0];
          applyContactImpulse(state, i, -1, normal, [body.pos[0], groundY, body.pos[2]], options);
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

  // 3. Pair collisions (sequential impulses, rest-distance aware).
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
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
        // OBB narrow phase (Phase 20 stage 1): the legacy rest
        // distance stays the broad phase — a pair that has not
        // approached closer than it started is never pushed
        // apart (the tiling stability rule). Inside it the SAT
        // test decides: boxes whose bounding spheres overlap
        // but which do not touch pass through untouched, and a
        // hit corrects along the SAT normal by the SAT depth,
        // split by inverse mass, through the same impulse call
        // as the sphere path (friction / restitution / impact
        // bookkeeping / waking all ride the existing code).
        if (d2 >= target * target || d2 === 0) continue;
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
      const px = (a.pos[0] + b.pos[0]) / 2;
      const py = (a.pos[1] + b.pos[1]) / 2;
      const pz = (a.pos[2] + b.pos[2]) / 2;
      applyPairImpulse(state, i, j, [nx, ny, nz], [px, py, pz], options);
      touching.add(i * CONTACT_STRIDE + j);
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
        solveJoint(state, joint, h);
      }
    }
  }

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
  // Effective mass along the normal at the contact point (sphere inertia).
  const rnX = ry * normal[2] - rz * normal[1];
  const rnY = rz * normal[0] - rx * normal[2];
  const rnZ = rx * normal[1] - ry * normal[0];
  const angFactor = (rnX * rnX + rnY * rnY + rnZ * rnZ) * body.invInertia;
  const jn = -(1 + rest) * vn / (body.invMass + angFactor);
  applyImpulse(body, normal, jn, [rx, ry, rz]);
  // Friction: oppose the tangential contact velocity, clamped to μ·jn.
  const tx = vx - vn * normal[0];
  const ty = vy - vn * normal[1];
  const tz = vz - vn * normal[2];
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-9) {
    const jt = Math.min(tLen / (body.invMass + angFactor), options.friction * jn);
    applyImpulse(body, [tx / tLen, ty / tLen, tz / tLen], -jt, [rx, ry, rz]);
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
  const inertA = a.sleeping ? 0 : a.invInertia;
  const inertB = b.sleeping ? 0 : b.invInertia;
  const ranX = ray * normal[2] - raz * normal[1];
  const ranY = raz * normal[0] - rax * normal[2];
  const ranZ = rax * normal[1] - ray * normal[0];
  const rbnX = rby * normal[2] - rbz * normal[1];
  const rbnY = rbz * normal[0] - rbx * normal[2];
  const rbnZ = rbx * normal[1] - rby * normal[0];
  const angFactor = (ranX * ranX + ranY * ranY + ranZ * ranZ) * inertA
    + (rbnX * rbnX + rbnY * rbnY + rbnZ * rbnZ) * inertB;
  const invSum = invA + invB + angFactor;
  if (invSum <= 0) return;
  const rest = -vn < 1 ? 0 : options.restitution;
  const jn = -(1 + rest) * vn / invSum;
  if (!a.sleeping) applyImpulse(a, normal, -jn, [rax, ray, raz]);
  if (!b.sleeping) applyImpulse(b, normal, jn, [rbx, rby, rbz]);
  // Friction along the tangential relative velocity.
  const tx = rvx - vn * normal[0];
  const ty = rvy - vn * normal[1];
  const tz = rvz - vn * normal[2];
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-9) {
    const jt = Math.min(tLen / invSum, options.friction * jn);
    if (!a.sleeping) applyImpulse(a, [tx / tLen, ty / tLen, tz / tLen], jt, [rax, ray, raz]);
    if (!b.sleeping) applyImpulse(b, [tx / tLen, ty / tLen, tz / tLen], -jt, [rbx, rby, rbz]);
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

/** Apply impulse J·dir at offset r from the centre: Δv and Δω. */
function applyImpulse(
  body: RigidBody,
  dir: [number, number, number],
  magnitude: number,
  r: [number, number, number],
): void {
  body.vel[0] += dir[0] * magnitude * body.invMass;
  body.vel[1] += dir[1] * magnitude * body.invMass;
  body.vel[2] += dir[2] * magnitude * body.invMass;
  const jx = dir[0] * magnitude; const jy = dir[1] * magnitude; const jz = dir[2] * magnitude;
  body.angVel[0] += (r[1] * jz - r[2] * jy) * body.invInertia;
  body.angVel[1] += (r[2] * jx - r[0] * jz) * body.invInertia;
  body.angVel[2] += (r[0] * jy - r[1] * jx) * body.invInertia;
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
function solveJoint(state: RigidSolverState, joint: RigidJoint, h: number): void {
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
 * Pack the body state into the 64×4 RGBA float backing array of
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
  /** XPBD joints (Phase 20 stage 1): built only while true. */
  jointEnabled: boolean;
  /** Joint compliance α (0 = rigid). */
  jointCompliance: number;
  /** Joint break threshold (strain; 0 = unbreakable). */
  jointBreakThreshold: number;
  /** Stress break (Phase 20 stage 1): while true the step runs
   *  the stress / propagation breaking instead of the legacy
   *  strain / impact conditions. */
  stressBreakEnabled: boolean;
  /** Stress propagation rate (0..1). */
  stressPropagation: number;
  /** OBB shape collision (Phase 20 stage 1): bodies are built
   *  with fitted OBB shapes and the step uses them while true. */
  convexEnabled: boolean;
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
    jointEnabled: !!config.gpgpuRigidJointEnabled,
    jointCompliance: Math.max(0, config.gpgpuRigidJointCompliance ?? 0),
    jointBreakThreshold: Math.max(0, config.gpgpuRigidJointBreakThreshold ?? 0),
    stressBreakEnabled: !!config.gpgpuRigidStressBreakEnabled,
    stressPropagation: Math.max(0, Math.min(1, config.gpgpuRigidStressPropagation ?? 0.5)),
    convexEnabled: !!config.gpgpuRigidConvexEnabled,
  };
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
