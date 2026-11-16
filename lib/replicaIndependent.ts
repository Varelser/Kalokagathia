// Replica independent simulation (Phase W2, method (a): state
// separation). Pure logic shared by the runtime (per-replica stack
// allocation / seeding), the pass runner (per-stack uniforms) and
// the unit tests.
//
// Background: the Phase K replica grammar bakes `count` offset
// copies of a morph cloud into ONE shared position/velocity texture
// pair, so the copies can only differ by their baked transforms and
// phase offsets — they all evolve under the same field realization
// on the same clock. With the independent sim on, each copy gets
// its own simulation stack (its own position/velocity render
// targets, seeded from the same initial data), its own pass with
// replica-private field seed / time offsets, and the per-frame
// results are merged back into the shared layout textures that
// every downstream consumer (points draw, trails, aux pools,
// depth sort, readback) already reads. The shared layout is a
// partition: block r owns exactly the texels the bake assigns to
// copy r, so the merge is a pure relocation, never a blend.
//
// The state textures are per-replica; the limitation that remains
// is documented in the CHANGELOG / phase report: the merged layout
// is still one texture pair downstream, and neighbour-sampling
// forces (N-body / boids / SPH / particle-life) are confined to
// the replica's own stack while the independent sim is on.

/** Spatial span (noise cells) of the per-replica seed offset at
 *  divergence 1 — far beyond the noise correlation length, so the
 *  copies sample effectively independent field realizations. */
export const REPLICA_DIVERGENCE_SEED_SPAN = 61.7;

/** Per-replica clock offset step (seconds of field time) at
 *  divergence 1. */
export const REPLICA_DIVERGENCE_TIME_STEP = 19.19;

export interface ReplicaBlockRange {
  /** First global texel index owned by this copy. */
  start: number;
  /** Number of global texels owned by this copy. */
  size: number;
}

/**
 * Replica index of a global texel — the same mapping the morph
 * bake (lib/gpgpuMorphTargets.ts) and the position pass's age
 * phase use: min(count - 1, floor(i * count / total)).
 */
export function replicaIndexForTexel(texelIndex: number, total: number, count: number): number {
  const c = Math.max(1, Math.floor(count));
  if (c <= 1 || total <= 0) return 0;
  const i = Math.max(0, Math.min(total - 1, Math.floor(texelIndex)));
  return Math.min(c - 1, Math.floor((i * c) / total));
}

/**
 * Contiguous global texel range owned by copy `index` — the
 * inverse of replicaIndexForTexel: start is the smallest i with
 * floor(i * count / total) >= index, i.e. ceil(index * total /
 * count). Blocks differ in size by at most one texel and tile
 * [0, total) without gaps or overlaps.
 */
export function replicaBlockRange(total: number, count: number, index: number): ReplicaBlockRange {
  const c = Math.max(1, Math.floor(count));
  const t = Math.max(0, Math.floor(total));
  const r = Math.max(0, Math.min(c - 1, Math.floor(index)));
  if (c <= 1 || t <= 0) return { start: 0, size: t };
  const start = Math.ceil((r * t) / c);
  const end = Math.ceil(((r + 1) * t) / c);
  return { start, size: Math.max(0, end - start) };
}

/**
 * Side of the square stack texture for a block of `size` texels:
 * the smallest square that holds the block (ceil(sqrt(size)),
 * at least 2). Padding texels (side^2 - size) are seeded inert
 * and are never merged or drawn.
 */
export function replicaStackSide(size: number): number {
  const s = Math.max(0, Math.floor(size));
  return Math.max(2, Math.ceil(Math.sqrt(s)));
}

/** Divergence is a 0..1 continuous parameter; NaN reads as 0. */
export function clampReplicaDivergence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Whether the independent sim engages for a config: the key on,
 *  morph on (replicas only exist as a morph grammar), count > 1. */
export function resolveReplicaIndependentActive(config: {
  gpgpuMorphReplicaIndependent: boolean;
  gpgpuMorphEnabled: boolean;
  gpgpuMorphReplicaCount: number;
}): boolean {
  return Boolean(
    config.gpgpuMorphReplicaIndependent
    && config.gpgpuMorphEnabled
    && Math.round(config.gpgpuMorphReplicaCount) > 1,
  );
}

// JS mirror of the velocity shader's hash3, used to derive the
// per-replica seed offsets on the CPU (they reach the shader as
// uniforms, so this mirror only needs to be deterministic and
// well-spread — not bit-equal to the GPU's float32 evaluation).
function hash3Mirror(x: number, y: number, z: number): [number, number, number] {
  const fract = (v: number) => v - Math.floor(v);
  const dot1 = x * 127.1 + y * 311.7 + z * 74.7;
  const dot2 = x * 269.5 + y * 183.3 + z * 246.1;
  const dot3 = x * 113.5 + y * 271.9 + z * 124.6;
  return [
    -1 + 2 * fract(Math.sin(dot1) * 43758.5453123),
    -1 + 2 * fract(Math.sin(dot2) * 43758.5453123),
    -1 + 2 * fract(Math.sin(dot3) * 43758.5453123),
  ];
}

/**
 * Per-replica field seed offset (velocity-shader uniform). Copy 0
 * is the reference copy and keeps an exact zero offset at every
 * divergence; other copies get a hash-spread offset scaled by
 * divergence * SEED_SPAN. At divergence 0 every copy's offset is
 * exactly zero, so a stack's evolution reduces to the shared
 * evolution (modulo neighbour confinement).
 */
export function replicaSeedOffset(index: number, divergence: number): [number, number, number] {
  const r = Math.max(0, Math.floor(index));
  const d = clampReplicaDivergence(divergence);
  if (r === 0 || d === 0) return [0, 0, 0];
  const h = hash3Mirror(r * 37.71 + 11.13, r * 17.37 + 5.71, r * 91.73 + 3.17);
  const s = d * REPLICA_DIVERGENCE_SEED_SPAN;
  return [h[0] * s, h[1] * s, h[2] * s];
}

/** Per-replica field clock offset (seconds), linear in the copy
 *  index and in divergence; copy 0 runs on the global clock. */
export function replicaTimeOffset(index: number, divergence: number): number {
  const r = Math.max(0, Math.floor(index));
  return r * clampReplicaDivergence(divergence) * REPLICA_DIVERGENCE_TIME_STEP;
}

/**
 * Respawn restart age for copy `index` under the Phase M age
 * phase: in the shared layout the position pass computes
 * replicaIdx * step * ageMax per texel; inside a stack every
 * texel belongs to the same copy, so the same value is supplied
 * as a constant base. Mirrors the shader formula (step clamped
 * to 0..1 exactly as the pass clamps it).
 */
export function replicaAgeBase(index: number, ageStep: number, ageMax: number): number {
  const r = Math.max(0, Math.floor(index));
  const step = Number.isFinite(ageStep) ? Math.max(0, Math.min(1, ageStep)) : 0;
  const max = Number.isFinite(ageMax) ? ageMax : 0;
  return r * step * max;
}
