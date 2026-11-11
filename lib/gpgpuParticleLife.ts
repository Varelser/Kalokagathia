// Particle Life (GPGPU force subsystem): species interaction matrices.
//
// Each particle belongs to a FIXED species derived deterministically from
// its texel index (see the GLSL `plSpecies` helper duplicated in the
// velocity sim and the points readout — the CPU side never needs the
// per-particle species, only the matrix). The matrix entry
// matrix[self][other] in [-1, 1] is the attraction (positive) or repulsion
// (negative) a particle of species `self` feels toward species `other`
// in the mid-range band of the classic Particle Life force law
// (short-range universal repulsion for r < beta is handled in the shader).
//
// Matrices are computed here on CPU and uploaded to the velocity shader as
// a flat uniform float array of 36 entries (max 6x6, row-major with a fixed
// stride of 6 so the shader index is self*6+other regardless of the active
// species count).

export type ParticleLifePreset = 'cells' | 'snakes' | 'community' | 'random';

export const PARTICLE_LIFE_MAX_SPECIES = 6;

/** Monochrome readout ladders (mirrored in gpgpuShaderPoints.ts GLSL). */
export const PARTICLE_LIFE_BRIGHTNESS: readonly number[] = [0.45, 0.65, 0.85, 1.0, 0.55, 0.75];
export const PARTICLE_LIFE_SIZE: readonly number[] = [1.3, 1.0, 0.8, 1.15, 0.9, 1.05];

/** Deterministic PRNG (mulberry32) for the 'random' matrix preset. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampSpecies(species: number): number {
  return Math.max(2, Math.min(PARTICLE_LIFE_MAX_SPECIES, Math.round(species) || 4));
}

/** 'cells': strong self-attraction, mild cross repulsion -> separated clusters. */
export function cellsMatrix(species: number): number[][] {
  const n = clampSpecies(species);
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0.85 : -0.35)),
  );
}

/** 'snakes': asymmetric cyclic chase (i is attracted to (i+1)%n, flees (i-1+n)%n) -> trains. */
export function snakesMatrix(species: number): number[][] {
  const n = clampSpecies(species);
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (j === (i + 1) % n) return 0.95;
      if (j === (i - 1 + n) % n) return -0.35;
      if (i === j) return 0.05;
      return -0.1;
    }),
  );
}

/** 'community': broad mutual attraction with repelling pairs (0,2) and (1,3) -> mixed aggregates with boundaries. */
export function communityMatrix(species: number): number[][] {
  const n = clampSpecies(species);
  const repelling = new Set(['0-2', '2-0', '1-3', '3-1']);
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (repelling.has(`${i}-${j}`)) return -0.65;
      if (i === j) return 0.6;
      return 0.45;
    }),
  );
}

/** 'random': deterministic matrix in [-1, 1] from the seed. */
export function randomMatrix(species: number, seed: number): number[][] {
  const n = clampSpecies(species);
  const rng = mulberry32(Math.max(0, Math.floor(seed) || 0));
  return Array.from({ length: n }, () =>
    Array.from({ length: n }, () => Math.round((rng() * 2 - 1) * 1000) / 1000),
  );
}

export function particleLifeMatrix(
  preset: ParticleLifePreset,
  species: number,
  seed: number,
): number[][] {
  switch (preset) {
    case 'snakes':
      return snakesMatrix(species);
    case 'community':
      return communityMatrix(species);
    case 'random':
      return randomMatrix(species, seed);
    case 'cells':
    default:
      return cellsMatrix(species);
  }
}

/** Flatten an NxN matrix into the 36-entry uniform array (stride 6, zero-padded). */
export function flattenParticleLifeMatrix(matrix: number[][]): Float32Array {
  const out = new Float32Array(PARTICLE_LIFE_MAX_SPECIES * PARTICLE_LIFE_MAX_SPECIES);
  for (let i = 0; i < Math.min(matrix.length, PARTICLE_LIFE_MAX_SPECIES); i++) {
    for (let j = 0; j < Math.min(matrix[i].length, PARTICLE_LIFE_MAX_SPECIES); j++) {
      out[i * PARTICLE_LIFE_MAX_SPECIES + j] = matrix[i][j];
    }
  }
  return out;
}

export function particleLifeUniformArray(
  preset: ParticleLifePreset,
  species: number,
  seed: number,
): Float32Array {
  return flattenParticleLifeMatrix(particleLifeMatrix(preset, species, seed));
}
