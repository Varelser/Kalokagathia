/**
 * XPBD rigid bake stepper + runner (layer-2 bake solver,
 * slice S2).
 *
 * Form follows the sweep decisions (BAKE_SR1_RESULT_RECORD):
 * XPBD with substeps won over the sequential-impulse
 * approximation (which failed the penetration line), friction
 * is required for a resting stack to settle, and joint chains
 * need substep-10-class resolution (stretch error 0.007 at
 * sub10 vs 1.21 at sub1 in the Colab measurement). The live
 * solver in rigidBodies.ts is an impulse solver for fracture
 * cells (<= 64 bodies); the bake path is a separate XPBD
 * solver for sphere bodies at bake scale, per the design.
 *
 * Scope, stated plainly: bodies are spheres. Orientation is
 * integrated from angular velocity but contacts do not exert
 * torque, so orientation is authoring data here, not a
 * collision response. Box/OBB rigid bake is out of scope for
 * this slice.
 *
 * Resume property (the S2 gate): XPBD contacts and friction
 * here are positional corrections computed from the current
 * substep's positions and previous positions only — no contact
 * history is kept across frames. A checkpoint therefore needs
 * exactly position / orientation / linear velocity / angular
 * velocity, and resuming from it must reproduce the
 * uninterrupted run bit for bit. The test pins that.
 */
import {
  assembleStateCacheV2,
  buildCheckpointRef,
  validateBakeJobDescriptor,
  type BakeJobDescriptor,
  type CheckpointRef,
  type StateCacheDataV2,
  type StateCacheResultV2,
} from './gpgpuStateCacheV2';
import { xpbdAlphaTilde, xpbdDeltaLambda } from './xpbdConstraints';

export interface RigidBakeState {
  count: number;
  /** count x 3, world units on the unit domain [0, 1]^3. */
  positions: Float32Array;
  /** count x 3 */
  velocities: Float32Array;
  /** count x 4 (x, y, z, w) */
  quats: Float32Array;
  /** count x 3 */
  angVels: Float32Array;
  /** count x 1 */
  radii: Float32Array;
  /** count x 1 (0 = static) */
  invMasses: Float32Array;
  /** count x 1, carried for the cache age attribute. */
  ages: Float32Array;
}

export interface RigidJointSpec {
  a: number;
  b: number;
  restLength: number;
  /** XPBD compliance alpha (0 = rigid). */
  compliance: number;
}

export interface RigidBakeOptions {
  fps: number;
  /** Substeps per frame. Chains need ~10; stacks settle at 5. */
  substeps: number;
  gravity?: number;
  /** Coulomb friction coefficient. */
  friction?: number;
  joints?: RigidJointSpec[];
}

function solveContact(
  state: RigidBakeState, prev: Float32Array,
  i: number, j: number, nx: number, ny: number, nz: number, pen: number,
  friction: number,
): void {
  const wi = state.invMasses[i];
  const wj = j >= 0 ? state.invMasses[j] : 0;
  const wSum = wi + wj;
  if (wSum <= 0 || pen <= 0) return;
  const p = state.positions;
  // Normal correction.
  const ci = pen * (wi / wSum);
  p[i * 3] += nx * ci; p[i * 3 + 1] += ny * ci; p[i * 3 + 2] += nz * ci;
  if (j >= 0) {
    const cj = pen * (wj / wSum);
    p[j * 3] -= nx * cj; p[j * 3 + 1] -= ny * cj; p[j * 3 + 2] -= nz * cj;
  }
  if (friction <= 0) return;
  // XPBD friction: cancel the tangential relative displacement
  // of this substep, clamped to mu * normal correction.
  let dx = (p[i * 3] - prev[i * 3]) - (j >= 0 ? p[j * 3] - prev[j * 3] : 0);
  let dy = (p[i * 3 + 1] - prev[i * 3 + 1]) - (j >= 0 ? p[j * 3 + 1] - prev[j * 3 + 1] : 0);
  let dz = (p[i * 3 + 2] - prev[i * 3 + 2]) - (j >= 0 ? p[j * 3 + 2] - prev[j * 3 + 2] : 0);
  const dn = dx * nx + dy * ny + dz * nz;
  dx -= dn * nx; dy -= dn * ny; dz -= dn * nz;
  const tLen = Math.hypot(dx, dy, dz);
  if (tLen < 1e-12) return;
  const maxCorr = friction * pen;
  const scale = Math.min(tLen, maxCorr) / tLen;
  const fi = scale * (wi / wSum);
  p[i * 3] -= dx * fi; p[i * 3 + 1] -= dy * fi; p[i * 3 + 2] -= dz * fi;
  if (j >= 0) {
    const fj = scale * (wj / wSum);
    p[j * 3] += dx * fj; p[j * 3 + 1] += dy * fj; p[j * 3 + 2] += dz * fj;
  }
}

/** Advance one frame (substeps x XPBD solve). Mutates state. */
export function stepRigidBake(state: RigidBakeState, opts: RigidBakeOptions): void {
  const { count } = state;
  const dt = 1 / opts.fps;
  const h = dt / opts.substeps;
  const gravity = opts.gravity ?? 9.8;
  const friction = opts.friction ?? 0.5;
  const joints = opts.joints ?? [];
  const p = state.positions;
  const v = state.velocities;
  const prev = new Float32Array(p);
  const lambdas = new Float64Array(joints.length);

  for (let sub = 0; sub < opts.substeps; sub++) {
    lambdas.fill(0);
    for (let i = 0; i < count; i++) {
      if (state.invMasses[i] <= 0) continue;
      v[i * 3 + 1] -= gravity * h;
      prev[i * 3] = p[i * 3]; prev[i * 3 + 1] = p[i * 3 + 1]; prev[i * 3 + 2] = p[i * 3 + 2];
      p[i * 3] += v[i * 3] * h; p[i * 3 + 1] += v[i * 3 + 1] * h; p[i * 3 + 2] += v[i * 3 + 2] * h;
    }
    // Domain walls (unit cube): six half-space contacts.
    for (let i = 0; i < count; i++) {
      if (state.invMasses[i] <= 0) continue;
      const r = state.radii[i];
      if (p[i * 3 + 1] < r) solveContact(state, prev, i, -1, 0, 1, 0, r - p[i * 3 + 1], friction);
      if (p[i * 3 + 1] > 1 - r) solveContact(state, prev, i, -1, 0, -1, 0, p[i * 3 + 1] - (1 - r), friction);
      if (p[i * 3] < r) solveContact(state, prev, i, -1, 1, 0, 0, r - p[i * 3], friction);
      if (p[i * 3] > 1 - r) solveContact(state, prev, i, -1, -1, 0, 0, p[i * 3] - (1 - r), friction);
      if (p[i * 3 + 2] < r) solveContact(state, prev, i, -1, 0, 0, 1, r - p[i * 3 + 2], friction);
      if (p[i * 3 + 2] > 1 - r) solveContact(state, prev, i, -1, 0, 0, -1, p[i * 3 + 2] - (1 - r), friction);
    }
    // Pair contacts (O(n^2); bake scale here is hundreds of
    // bodies — a spatial hash is a later optimisation, not a
    // correctness item).
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = p[j * 3] - p[i * 3];
        const dy = p[j * 3 + 1] - p[i * 3 + 1];
        const dz = p[j * 3 + 2] - p[i * 3 + 2];
        const minD = state.radii[i] + state.radii[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        // solveContact's normal is the direction body i is
        // pushed along, so for a pair it points from j to i
        // (dx/dy/dz above run from i to j — hence the negation).
        solveContact(state, prev, i, j, -dx / d, -dy / d, -dz / d, minD - d, friction);
      }
    }
    // Distance joints (XPBD, lambda accumulated per substep).
    for (let ji = 0; ji < joints.length; ji++) {
      const joint = joints[ji];
      const a = joint.a; const b = joint.b;
      const dx = p[b * 3] - p[a * 3];
      const dy = p[b * 3 + 1] - p[a * 3 + 1];
      const dz = p[b * 3 + 2] - p[a * 3 + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-12) continue;
      const C = d - joint.restLength;
      const alphaTilde = xpbdAlphaTilde(joint.compliance, h);
      const dl = xpbdDeltaLambda(C, lambdas[ji], alphaTilde, state.invMasses[a] + state.invMasses[b]);
      lambdas[ji] += dl;
      const nx = dx / d; const ny = dy / d; const nz = dz / d;
      // Gradients: dC/dxa = -n, dC/dxb = +n.
      p[a * 3] -= nx * dl * state.invMasses[a];
      p[a * 3 + 1] -= ny * dl * state.invMasses[a];
      p[a * 3 + 2] -= nz * dl * state.invMasses[a];
      p[b * 3] += nx * dl * state.invMasses[b];
      p[b * 3 + 1] += ny * dl * state.invMasses[b];
      p[b * 3 + 2] += nz * dl * state.invMasses[b];
    }
    // Velocity update from positions; orientation from angVel.
    for (let i = 0; i < count; i++) {
      if (state.invMasses[i] <= 0) continue;
      v[i * 3] = (p[i * 3] - prev[i * 3]) / h;
      v[i * 3 + 1] = (p[i * 3 + 1] - prev[i * 3 + 1]) / h;
      v[i * 3 + 2] = (p[i * 3 + 2] - prev[i * 3 + 2]) / h;
      const w = state.angVels;
      const wx = w[i * 3]; const wy = w[i * 3 + 1]; const wz = w[i * 3 + 2];
      if (wx !== 0 || wy !== 0 || wz !== 0) {
        const q = state.quats;
        const qx = q[i * 4]; const qy = q[i * 4 + 1]; const qz = q[i * 4 + 2]; const qw = q[i * 4 + 3];
        const dqx = 0.5 * h * (wx * qw + wy * qz - wz * qy);
        const dqy = 0.5 * h * (wy * qw + wz * qx - wx * qz);
        const dqz = 0.5 * h * (wz * qw + wx * qy - wy * qx);
        const dqw = 0.5 * h * (-wx * qx - wy * qy - wz * qz);
        let nx2 = qx + dqx; let ny2 = qy + dqy; let nz2 = qz + dqz; let nw2 = qw + dqw;
        const il = 1 / Math.hypot(nx2, ny2, nz2, nw2);
        q[i * 4] = nx2 * il; q[i * 4 + 1] = ny2 * il; q[i * 4 + 2] = nz2 * il; q[i * 4 + 3] = nw2 * il;
      }
    }
  }
  for (let i = 0; i < count; i++) state.ages[i] += dt;
}

/* ---------------- runner (checkpoint-chained) ---------------- */

export interface RigidBakeRunResult {
  cache: StateCacheDataV2;
  lastCheckpoint: CheckpointRef;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function cloneRigid(s: RigidBakeState): RigidBakeState {
  return {
    count: s.count,
    positions: new Float32Array(s.positions),
    velocities: new Float32Array(s.velocities),
    quats: new Float32Array(s.quats),
    angVels: new Float32Array(s.angVels),
    radii: new Float32Array(s.radii),
    invMasses: new Float32Array(s.invMasses),
    ages: new Float32Array(s.ages),
  };
}

const ANGVEL_ATTRS = ['angVelX', 'angVelY', 'angVelZ'] as const;

/** Rebuild a rigid state from a single-frame checkpoint cache
 *  produced by runRigidBakeJob (radii / inverse masses are
 *  scene data, supplied by the caller, not cached). */
export function rigidStateFromCheckpoint(
  checkpoint: StateCacheDataV2,
  radii: Float32Array, invMasses: Float32Array,
): { ok: true; state: RigidBakeState } | { ok: false; error: string } {
  const m = checkpoint.manifest;
  if (m.frameCount !== 1) return fail(`チェックポイントは単一フレームでなければなりません（${m.frameCount} フレーム）。`);
  if (!checkpoint.orientations) return fail('チェックポイントに姿勢チャンネルがありません。剛体ベイクの再開には姿勢が必要です。');
  const count = m.count;
  const ang: Float32Array[] = [];
  for (const name of ANGVEL_ATTRS) {
    const idx = m.attributes.findIndex((d) => d.name === name);
    if (idx < 0) return fail(`チェックポイントに属性 "${name}" がありません。剛体ベイクの再開には角速度が必要です。無い状態は作りません。`);
    ang.push(checkpoint.attrFrames[idx][0]);
  }
  const ageIdx = m.attributes.findIndex((d) => d.name === 'age');
  if (ageIdx < 0) return fail('チェックポイントに age 属性がありません。');
  return {
    ok: true,
    state: {
      count,
      positions: new Float32Array(checkpoint.positions[0]),
      velocities: new Float32Array(checkpoint.velocities[0]),
      quats: new Float32Array(checkpoint.orientations[0]),
      angVels: (() => { const a = new Float32Array(count * 3); for (let i = 0; i < count; i++) { a[i * 3] = ang[0][i]; a[i * 3 + 1] = ang[1][i]; a[i * 3 + 2] = ang[2][i]; } return a; })(),
      radii: new Float32Array(radii),
      invMasses: new Float32Array(invMasses),
      ages: new Float32Array(checkpoint.attrFrames[ageIdx][0]),
    },
  };
}

export function runRigidBakeJob(args: {
  job: BakeJobDescriptor;
  texSize: number;
  generator: string;
  generatorVersion: string;
  initial?: RigidBakeState;
  checkpoint?: StateCacheDataV2;
  radii?: Float32Array;
  invMasses?: Float32Array;
  stepOptions: RigidBakeOptions;
}): { ok: true; result: RigidBakeRunResult } | { ok: false; error: string } {
  const v = validateBakeJobDescriptor(args.job);
  if (!v.ok) return fail(v.error);
  const job = args.job;
  const count = args.texSize * args.texSize;
  const [s, e] = job.frameRange;

  let state: RigidBakeState;
  let stepBeforeFirstCapture = false;
  if (job.startMode === 'fromInitial') {
    if (!args.initial) return fail(`ジョブ "${job.jobId}" は fromInitial ですが初期状態が渡されていません。`);
    if (args.initial.count !== count) return fail(`ジョブ "${job.jobId}" の剛体数 ${args.initial.count} がテクスチャ粒子数 ${count} と一致しません。`);
    state = cloneRigid(args.initial);
    for (let t = 0; t < s; t++) stepRigidBake(state, args.stepOptions);
  } else {
    if (!args.checkpoint || !args.radii || !args.invMasses) return fail(`ジョブ "${job.jobId}" は fromCheckpoint ですがチェックポイント／半径／逆質量が渡されていません。`);
    const cp = args.checkpoint;
    if (cp.manifest.startFrame !== job.checkpointRef!.frameIndex) {
      return fail(`ジョブ "${job.jobId}" のチェックポイントのフレーム番号 (${cp.manifest.startFrame}) が checkpointRef (${job.checkpointRef!.frameIndex}) と一致しません。`);
    }
    if (cp.manifest.frameHashes[0] !== job.checkpointRef!.hash) {
      return fail(`ジョブ "${job.jobId}" のチェックポイントのハッシュが checkpointRef と一致しません。異なる状態からは再開しません。`);
    }
    const seed = rigidStateFromCheckpoint(cp, args.radii, args.invMasses);
    if (!seed.ok) return fail(seed.error);
    state = seed.state;
    stepBeforeFirstCapture = cp.manifest.startFrame === s - 1;
  }

  const frames = [];
  const orientations: Float32Array[] = [];
  for (let t = s; t < e; t++) {
    if (t > s || stepBeforeFirstCapture) stepRigidBake(state, args.stepOptions);
    const pos4 = new Float32Array(count * 4);
    const vel4 = new Float32Array(count * 4);
    const attrs: Record<string, Float32Array> = {
      age: new Float32Array(state.ages),
      angVelX: new Float32Array(count), angVelY: new Float32Array(count), angVelZ: new Float32Array(count),
    };
    for (let i = 0; i < count; i++) {
      pos4[i * 4] = state.positions[i * 3]; pos4[i * 4 + 1] = state.positions[i * 3 + 1]; pos4[i * 4 + 2] = state.positions[i * 3 + 2]; pos4[i * 4 + 3] = state.ages[i];
      vel4[i * 4] = state.velocities[i * 3]; vel4[i * 4 + 1] = state.velocities[i * 3 + 1]; vel4[i * 4 + 2] = state.velocities[i * 3 + 2]; vel4[i * 4 + 3] = 0;
      attrs.angVelX[i] = state.angVels[i * 3]; attrs.angVelY[i] = state.angVels[i * 3 + 1]; attrs.angVelZ[i] = state.angVels[i * 3 + 2];
    }
    frames.push({ positions: pos4, velocities: vel4, attributes: attrs });
    orientations.push(new Float32Array(state.quats));
  }

  const assembled: StateCacheResultV2 = assembleStateCacheV2({
    fps: args.stepOptions.fps,
    texSize: args.texSize,
    frames,
    attributeDecls: [
      { name: 'age', components: 1, source: 'age' },
      { name: 'angVelX', components: 1, source: 'rigid-angvel' },
      { name: 'angVelY', components: 1, source: 'rigid-angvel' },
      { name: 'angVelZ', components: 1, source: 'rigid-angvel' },
    ],
    orientations,
    provenance: {
      settingsHash: job.sceneRef.hash,
      seed: job.seed,
      generator: args.generator,
      generatorVersion: args.generatorVersion,
    },
    startFrame: s,
    loop: false,
  });
  if (!assembled.ok) return fail(assembled.error);
  return { ok: true, result: { cache: assembled.cache, lastCheckpoint: buildCheckpointRef(assembled.cache, frames.length - 1, job.outputRef) } };
}
