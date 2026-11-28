/**
 * Seeded initial state for the GPGPU particle system.
 *
 * The position/velocity arrays used to seed both the WebGL and the
 * WebGPU backends are built here, as a pure function of
 * (texSize, bounceRadius, emitShape, seed) — plus, for the 'light'
 * emit shape only, the light position. Before this module
 * existed the runtime filled the arrays with Math.random(), so the
 * same preset produced a different initial cloud on every load.
 * With a seed stored in the config (gpgpuSeed), the same preset now
 * starts from exactly the same cloud on every load and machine.
 *
 * The distribution math is the original runtime code verbatim —
 * only the random source changed (Math.random -> mulberry32).
 */

/** The emit-shape union lives with the shared shape law
 * (lib/gpgpuEmitShapes.ts, stage 2 E1) and is re-exported
 * here for existing importers. */
import type { GpgpuEmitShape } from './gpgpuEmitShapes';
import { sampleEmitShape } from './gpgpuEmitShapes';
import type { GpgpuEmitterTransform } from './gpgpuEmitter';
import { applyEmitterTransform, emitterRotScaleElements, emitterTransformIsIdentity } from './gpgpuEmitter';
import { samplePathAt } from './gpgpuEmissionSource';
import type { DistOp } from './gpgpuDistribution';
import { applyDistributionOps } from './gpgpuDistribution';
import type { EmissionPathResolved } from './gpgpuEmissionSource';
export type { GpgpuEmitShape };

/** mulberry32: small, fast, seedable PRNG with a uniform [0, 1) output.
 * The implementation lives in lib/seededRng.ts (2026-11-14 perf stage-2
 * split) and is re-exported here for existing importers. */
import { createSeededRng } from './seededRng';
import { directedInitialVelocity } from './gpgpuLifecycle';
export { createSeededRng };

export interface GpgpuInitialData {
  posData: Float32Array;
  velData: Float32Array;
}

export interface GpgpuAgePhaseOptions {
  /** Replica count the age phase is keyed to (<= 1 disables). */
  count: number;
  /** Per-copy lifecycle phase offset, as a fraction of ageMax. */
  step: number;
}

export interface GpgpuEmitOptions {
  /** Emitter position for the 'light' shape (Phase T): the 3D
   *  light's world position. Ignored by every other shape, so the
   *  legacy shapes' output stays byte-identical whether or not the
   *  caller passes it. */
  lightPos?: { x: number; y: number; z: number };
  /** Emitter transform (stage 2, E0): applied to the sampled
   *  positions — never to the velocities — so the baked cloud
   *  sits in the same transformed emitter frame the runtime
   *  respawn places into. Null / absent / identity leaves every
   *  array byte-identical to the legacy output. */
  transform?: GpgpuEmitterTransform | null;
  /** Directed initial velocity (stage 2, E2): the emitter's
   *  authored base direction (already normalised) + speed /
   *  spread of directedInitialVelocity in lib/gpgpuLifecycle.ts.
   *  The three velocity draws are still consumed from the
   *  seeded RNG (and discarded), so the positions and ages are
   *  bit-identical to the cube bake — only the velocities
   *  differ. Null / absent = the legacy cube scatter. */
  initialVelocity?: { dir: { x: number; y: number; z: number }; speed: number; spread: number } | null;
  /** Emission cloud (stage 2, E3): a baked sample cloud in
   *  the morph layout (texSize² × RGBA, world units) — the
   *  morph target's cloud or the bitmap cloud of
   *  lib/gpgpuEmissionSource.ts. While present, particle i is
   *  placed at cloud point i (the cloud IS the initial
   *  scatter, exactly like the morph target assignment). The
   *  shape law's draws are still consumed (and discarded) per
   *  particle, so ages and velocities stay bit-identical to
   *  the shape bake of the same seed. Null / absent = the
   *  shape placement. */
  /** Distribution operator layer (stage 2, B5): the resolved
   *  operators of lib/gpgpuDistribution.ts, applied to each
   *  shape sample right after the shape law draws it — before
   *  the path / cloud override (those sources replace the
   *  sample wholesale, layer included) and before the emitter
   *  transform, exactly where the respawn applies its twin.
   *  The layer consumes NO draws, so ages and velocities stay
   *  bit-identical; only shape placements move. Null / absent
   *  / empty = the legacy placement, bit-identical. */
  distribution?: readonly DistOp[] | null;
  cloud?: Float32Array | null;
  /** Path emission (stage 2, E3): the resolved steering-path
   *  asset (lib/gpgpuEmissionSource.ts resolveEmissionPath).
   *  While present, each particle is placed on the polyline
   *  at a seeded arc parameter, and — while the asset's speed
   *  is above 0 — its initial velocity is the segment tangent
   *  times that speed (the velocity draws are consumed and
   *  discarded, as in the directed mode). Null / absent = the
   *  shape placement. Takes precedence over `cloud` when both
   *  are somehow present (the runtime resolves one source). */
  path?: EmissionPathResolved | null;
  /** Emission mask predicate (stage 2, E3): the bake-side
   *  raster-mask gate over normalized [-1, 1] XY (built by
   *  buildEmissionMaskPredicate in lib/gpgpuEmissionSource.ts
   *  from the Phase X mask grid). While present, a placement
   *  that fails the predicate is re-drawn (up to 12 attempts,
   *  the CPU sampler's discipline); the last candidate stands
   *  when none passes. The predicate receives the placed
   *  world position normalised by the bounce radius and a
   *  roll from the seeded stream. Null / absent = no gating,
   *  and the placement consumes exactly the legacy draws. */
  maskAccept?: ((nx: number, ny: number, roll: number) => boolean) | null;
}

export function buildGpgpuInitialData(
  texSize: number,
  bounceRadius: number,
  emitShape: GpgpuEmitShape,
  seed: number,
  ageMax = 8,
  agePhase?: GpgpuAgePhaseOptions | null,
  emitOptions?: GpgpuEmitOptions | null,
): GpgpuInitialData {
  // Replica age phase (Phase M): particle i belongs to replica
  // block r = floor(i * count / total) — the same contiguous blocks
  // the morph bake uses (lib/gpgpuMorphTargets.ts) — and its
  // initial age is shifted by r * step of the lifecycle, wrapping
  // inside [0, ageMax). The shift is a pure function of the index:
  // it consumes NO random draws, so with step 0 / count <= 1 (or no
  // options at all) every array is bit-identical to the legacy
  // output, positions and velocities included.
  const agePhaseCount = agePhase ? Math.max(1, Math.min(8, Math.floor(agePhase.count) || 1)) : 1;
  const agePhaseStep = agePhase ? Math.max(0, Math.min(1, agePhase.step)) : 0;
  const agePhaseActive = agePhaseCount > 1 && agePhaseStep > 0;
  const random = createSeededRng(seed);
  const count = texSize * texSize;
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  const r = bounceRadius;
  const shape = emitShape;
  // Emitter transform (stage 2, E0): resolved once; the
  // identity transform never enters the loop, so the legacy
  // arrays stay bit-identical by construction.
  const transform = emitOptions?.transform ?? null;
  const transformActive = transform !== null && !emitterTransformIsIdentity(transform);
  // Emission sources (stage 2, E3): resolved once. With none
  // of them present the placement below is exactly the legacy
  // shape sample (one attempt, no extra draws).
  const emitDistribution = emitOptions?.distribution && emitOptions.distribution.length > 0
    ? emitOptions.distribution
    : null;
  const emitCloud = emitOptions?.cloud ?? null;
  const emitPath = emitOptions?.path ?? null;
  const emitMaskAccept = emitOptions?.maskAccept ?? null;
  for (let i = 0; i < count; i++) {
    // Shape sampling (stage 2, E1): the shared law in
    // lib/gpgpuEmitShapes.ts consumes the draws in the legacy
    // order and counts and evaluates the legacy expressions
    // verbatim, so the seeded positions are unchanged; the
    // runtime respawn now samples the same law's GLSL twin.
    //
    // Emission sources (E3): the shape sample is ALWAYS drawn
    // first, so the cloud mode — which consumes no draws of
    // its own — keeps the age and velocity streams bit-
    // identical to the shape bake of the same seed. The path
    // mode draws one extra value per attempt (the arc
    // parameter). While the emission mask gates, a rejected
    // candidate is re-drawn up to 12 attempts (the CPU
    // sampler's discipline) and the last candidate stands; a
    // rejected CLOUD point degrades to the following attempts'
    // shape samples (the cloud index is the particle's
    // identity and cannot be re-drawn), while path candidates
    // re-draw their arc parameter.
    let px = 0;
    let py = 0;
    let pz = 0;
    let pathTangent: [number, number, number] | null = null;
    let cloudForParticle = emitCloud;
    const attempts = emitMaskAccept ? 12 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let [cx, cy, cz] = sampleEmitShape(shape, random, r, emitOptions?.lightPos);
      // Distribution layer (stage 2, B5): transforms the shape
      // sample in emitter space; consumes no draws.
      if (emitDistribution) {
        [cx, cy, cz] = applyDistributionOps(emitDistribution, cx, cy, cz, r);
      }
      let tangent: [number, number, number] | null = null;
      if (emitPath) {
        const s = samplePathAt(emitPath.points, emitPath.cum, emitPath.total, random());
        cx = s.pos.x;
        cy = s.pos.y;
        cz = s.pos.z;
        tangent = [s.tangent.x, s.tangent.y, s.tangent.z];
      } else if (cloudForParticle) {
        cx = cloudForParticle[i * 4];
        cy = cloudForParticle[i * 4 + 1];
        cz = cloudForParticle[i * 4 + 2];
      }
      if (transformActive && transform) {
        [cx, cy, cz] = applyEmitterTransform(transform, cx, cy, cz);
        if (tangent) {
          const e = emitterRotScaleElements(transform);
          tangent = [
            e[0] * tangent[0] + e[3] * tangent[1] + e[6] * tangent[2],
            e[1] * tangent[0] + e[4] * tangent[1] + e[7] * tangent[2],
            e[2] * tangent[0] + e[5] * tangent[1] + e[8] * tangent[2],
          ];
        }
      }
      px = cx;
      py = cy;
      pz = cz;
      pathTangent = tangent;
      if (!emitMaskAccept) break;
      if (emitMaskAccept(r > 0 ? px / r : 0, r > 0 ? py / r : 0, random())) break;
      // Rejected: a cloud point cannot be re-drawn, so the
      // remaining attempts fall back to shape samples.
      cloudForParticle = null;
    }
    posData[i * 4] = px;
    posData[i * 4 + 1] = py;
    posData[i * 4 + 2] = pz;
    // Age scatter (2026-11-16, iMac gate case 6): the initial age used to
    // be a constant 1 for every particle, so the whole pool respawned on
    // the same frame and vNormAge was identical across the field — any
    // age-driven look (age colour/size, the B2 blackbody gradient) pulsed
    // in sync with period ageMax. Seeding age uniformly in [0, ageMax)
    // gives each particle its own lifecycle phase while staying a pure
    // function of the seed, so determinism is preserved.
    const baseAge = random() * ageMax;
    posData[i * 4 + 3] = agePhaseActive
      ? (baseAge + Math.floor((i * agePhaseCount) / count) * agePhaseStep * ageMax) % ageMax
      : baseAge;
    // The three velocity draws are consumed in BOTH modes, so
    // the seeded stream (and therefore every position and age)
    // is identical between them; the directed mode discards
    // the draws and evaluates the hash-based law instead.
    const drawX = (random() - 0.5) * 4;
    const drawY = (random() - 0.5) * 4;
    const drawZ = (random() - 0.5) * 4;
    const directed = emitOptions?.initialVelocity ?? null;
    if (directed) {
      const u = ((i % texSize) + 0.5) / texSize;
      const v = (Math.floor(i / texSize) + 0.5) / texSize;
      const vel = directedInitialVelocity(directed.dir, u, v, directed.speed, directed.spread);
      velData[i * 4] = vel.x;
      velData[i * 4 + 1] = vel.y;
      velData[i * 4 + 2] = vel.z;
    } else {
      velData[i * 4] = drawX;
      velData[i * 4 + 1] = drawY;
      velData[i * 4 + 2] = drawZ;
    }
    // Path emission velocity (stage 2, E3): the initial
    // velocity runs along the path tangent at the authored
    // speed ("emit along the path"). The cube draws above
    // were still consumed, so the stream discipline matches
    // the directed mode's. The directed mode (E2) wins when
    // both are authored — it is the explicit velocity law;
    // the path speed is the source's own default motion.
    if (!directed && emitPath && emitPath.speed > 0 && pathTangent) {
      velData[i * 4] = pathTangent[0] * emitPath.speed;
      velData[i * 4 + 1] = pathTangent[1] * emitPath.speed;
      velData[i * 4 + 2] = pathTangent[2] * emitPath.speed;
    }
  }
  return { posData, velData };
}

/**
 * Initial State (Grammar 2.0 stage 3, slice S1): build the
 * SAME GpgpuInitialData shape from one solved frame instead
 * of the seeded bake — the extension of this module's
 * texturization path that lets a state-cache frame
 * (lib/gpgpuStateCache.ts) seed the pool so the sim resumes
 * from the solved state. The output contract is the bake's,
 * byte for byte in layout: posData is xyz + age in w (the
 * age column the cache frame carries), velData is xyz + 0
 * in w — the velocity w lane is the Kuramoto phase, the
 * state-cache format stores velocities as triplets (the
 * phase is not in the format), and 0 is exactly the phase
 * the bake seeds, so a restored pool starts phase-coherent
 * just like a fresh bake. Returns null when any input
 * length disagrees with count (the caller refuses with the
 * reason; nothing is padded or decimated here either).
 */
export function buildGpgpuInitialDataFromStateFrame(args: {
  count: number;
  /** Frame positions, count x 3 (the cache's stored triplets). */
  positions: Float32Array;
  /** Frame velocities, count x 3. */
  velocities: Float32Array;
  /** Per-particle age, count wide (the cache's 'age' column). */
  ages: Float32Array;
}): GpgpuInitialData | null {
  const { count, positions, velocities, ages } = args;
  if (!Number.isInteger(count) || count <= 0) return null;
  if (positions.length !== count * 3 || velocities.length !== count * 3 || ages.length !== count) {
    return null;
  }
  const posData = new Float32Array(count * 4);
  const velData = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    posData[i * 4] = positions[i * 3];
    posData[i * 4 + 1] = positions[i * 3 + 1];
    posData[i * 4 + 2] = positions[i * 3 + 2];
    posData[i * 4 + 3] = ages[i];
    velData[i * 4] = velocities[i * 3];
    velData[i * 4 + 1] = velocities[i * 3 + 1];
    velData[i * 4 + 2] = velocities[i * 3 + 2];
    // velData w (Kuramoto phase) stays 0 — the bake's seed
    // value, see the header note.
  }
  return { posData, velData };
}
