/**
 * Bake runner (layer-2 bake solver, slice S0 — common base).
 *
 * Executes a BakeJobDescriptor against a solver-agnostic CPU
 * stepper and produces a StateCacheDataV2 part that
 * mergeBakeJobParts (gpgpuStateCacheV2.ts) can stitch back
 * together. The descriptor / validation / split / merge layer
 * already existed; this module is the missing execution half:
 *
 * - fromInitial: the initial state is the scene state at
 *   frame 0. For a range starting after 0 (independent
 *   recompute), the stepper is advanced and the frames before
 *   the range are discarded — never fabricated.
 * - fromCheckpoint: the seed is a single-frame checkpoint
 *   cache. Its hash must match the job's checkpointRef, and
 *   the frame must pass verifyCheckpointCanSeedInitialState
 *   (position / velocity / age lanes feed the S1 initial-state
 *   conversion unchanged). A checkpoint holding frame s seeds
 *   the range [s, e) directly; a checkpoint holding frame
 *   s - 1 is stepped once before the first capture.
 *
 * Determinism is the stepper's contract: same seed state and
 * same frame index must give the same next state. The runner
 * records the job seed in the cache provenance and refuses
 * jobs whose descriptor fails validation.
 */
import {
  assembleStateCacheV2,
  buildCheckpointRef,
  validateBakeJobDescriptor,
  verifyCheckpointCanSeedInitialState,
  type BakeJobDescriptor,
  type CheckpointRef,
  type StateCacheDataV2,
  type StateCacheResultV2,
} from './gpgpuStateCacheV2';

export { mergeBakeJobParts, splitStateCacheV2 } from './gpgpuStateCacheV2';

export interface BakeParticleState {
  /** count x 3 */
  positions: Float32Array;
  /** count x 3 */
  velocities: Float32Array;
  /** count x 1 */
  ages: Float32Array;
}

/** Advance `state` from frame `frameIndex` to `frameIndex + 1`,
 *  mutating it in place. Must be deterministic. */
export type BakeStepper = (state: BakeParticleState, frameIndex: number) => void;

export interface BakeRunResult {
  cache: StateCacheDataV2;
  /** Checkpoint ref pointing at this part's last frame, for
   *  chaining the next job. */
  lastCheckpoint: CheckpointRef;
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function cloneState(s: BakeParticleState): BakeParticleState {
  return {
    positions: new Float32Array(s.positions),
    velocities: new Float32Array(s.velocities),
    ages: new Float32Array(s.ages),
  };
}

function checkStateShape(s: BakeParticleState, count: number): string | null {
  if (s.positions.length !== count * 3 || s.velocities.length !== count * 3 || s.ages.length !== count) {
    return `粒子状態の長さが粒子数 ${count} と一致しません（位置 ${s.positions.length}／速度 ${s.velocities.length}／年齢 ${s.ages.length}）。`;
  }
  return null;
}

export function runBakeJob(args: {
  job: BakeJobDescriptor;
  fps: number;
  texSize: number;
  generator: string;
  generatorVersion: string;
  initial?: BakeParticleState;
  checkpoint?: StateCacheDataV2;
  stepper: BakeStepper;
}): { ok: true; result: BakeRunResult } | { ok: false; error: string } {
  const v = validateBakeJobDescriptor(args.job);
  if (!v.ok) return fail(v.error);
  const job = args.job;
  const count = args.texSize * args.texSize;
  const [s, e] = job.frameRange;

  let state: BakeParticleState;
  let stepBeforeFirstCapture = false;

  if (job.startMode === 'fromInitial') {
    if (!args.initial) return fail(`ジョブ "${job.jobId}" は fromInitial ですが初期状態が渡されていません。`);
    const shapeErr = checkStateShape(args.initial, count);
    if (shapeErr) return fail(shapeErr);
    state = cloneState(args.initial);
    // The initial state is frame 0. Advance (discarding) until
    // the state is frame s.
    for (let t = 0; t < s; t++) args.stepper(state, t);
  } else {
    if (!args.checkpoint) return fail(`ジョブ "${job.jobId}" は fromCheckpoint ですがチェックポイントが渡されていません。`);
    const cp = args.checkpoint;
    if (cp.manifest.frameCount !== 1) return fail(`ジョブ "${job.jobId}" のチェックポイントは単一フレームでなければなりません（${cp.manifest.frameCount} フレーム）。`);
    const cpGlobalFrame = cp.manifest.startFrame;
    if (cpGlobalFrame !== job.checkpointRef!.frameIndex) {
      return fail(`ジョブ "${job.jobId}" のチェックポイントのフレーム番号 (${cpGlobalFrame}) が checkpointRef (${job.checkpointRef!.frameIndex}) と一致しません。`);
    }
    if (cp.manifest.frameHashes[0] !== job.checkpointRef!.hash) {
      return fail(`ジョブ "${job.jobId}" のチェックポイントのハッシュが checkpointRef と一致しません。異なる状態からは再開しません。`);
    }
    const seed = verifyCheckpointCanSeedInitialState(cp);
    if (!seed.ok) return fail(seed.error);
    state = {
      positions: new Float32Array(seed.positions),
      velocities: new Float32Array(seed.velocities),
      ages: new Float32Array(seed.ages),
    };
    const shapeErr = checkStateShape(state, count);
    if (shapeErr) return fail(shapeErr);
    stepBeforeFirstCapture = cpGlobalFrame === s - 1;
  }

  const frames: { positions: Float32Array; velocities: Float32Array; attributes: Record<string, Float32Array> }[] = [];
  for (let t = s; t < e; t++) {
    if (t > s || stepBeforeFirstCapture) args.stepper(state, t - 1);
    const pos4 = new Float32Array(count * 4);
    const vel4 = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos4[i * 4] = state.positions[i * 3];
      pos4[i * 4 + 1] = state.positions[i * 3 + 1];
      pos4[i * 4 + 2] = state.positions[i * 3 + 2];
      pos4[i * 4 + 3] = state.ages[i];
      vel4[i * 4] = state.velocities[i * 3];
      vel4[i * 4 + 1] = state.velocities[i * 3 + 1];
      vel4[i * 4 + 2] = state.velocities[i * 3 + 2];
      vel4[i * 4 + 3] = 0;
    }
    frames.push({ positions: pos4, velocities: vel4, attributes: { age: new Float32Array(state.ages) } });
  }

  const assembled: StateCacheResultV2 = assembleStateCacheV2({
    fps: args.fps,
    texSize: args.texSize,
    frames,
    attributeDecls: [{ name: 'age', components: 1, source: 'age' }],
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
  const lastCheckpoint = buildCheckpointRef(assembled.cache, frames.length - 1, job.outputRef);
  return { ok: true, result: { cache: assembled.cache, lastCheckpoint } };
}

/** Extract a single-frame checkpoint cache from a part cache
 *  at a local frame index, for chaining the next job. */
export function extractCheckpoint(cache: StateCacheDataV2, localFrameIndex: number): StateCacheResultV2 {
  if (!Number.isInteger(localFrameIndex) || localFrameIndex < 0 || localFrameIndex >= cache.manifest.frameCount) {
    return fail(`チェックポイントのフレーム番号 ${localFrameIndex} が範囲外です（0〜${cache.manifest.frameCount - 1}）。`);
  }
  return {
    ok: true,
    cache: {
      manifest: {
        ...cache.manifest,
        attributes: cache.manifest.attributes.map((d) => ({ ...d })),
        orientation: cache.manifest.orientation ? { ...cache.manifest.orientation } : null,
        provenance: cache.manifest.provenance ? { ...cache.manifest.provenance } : null,
        frameCount: 1,
        startFrame: cache.manifest.startFrame + localFrameIndex,
        frameHashes: [cache.manifest.frameHashes[localFrameIndex]],
      },
      positions: [cache.positions[localFrameIndex].slice()],
      velocities: [cache.velocities[localFrameIndex].slice()],
      attrFrames: cache.attrFrames.map((per) => [per[localFrameIndex].slice()]),
      orientations: cache.orientations ? [cache.orientations[localFrameIndex].slice()] : null,
    },
  };
}
