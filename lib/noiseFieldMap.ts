// Noise field as a map source (Phase AY): the engine's scalar
// noise field — the same Perlin gradient noise (hash3 / vnoise)
// the velocity pass builds its curl force from — exposed as a
// data source for the points draw, so a particle's colour (the
// gradient ramp input), size and radial displacement can be
// decided by the field value at the particle's own position
// instead of by age or a per-particle random seed.
//
// The field is a pure function of (position, time): the sample
// point is worldPos * scale plus an evolution offset
// (direction * evolve * time). Evolve 0 is a static field; the
// deterministic render clock drives the same time uniform as
// the gradient's uGradTime, so an evolving field reproduces
// frame-for-frame in the deterministic render.
//
// GLSL twin: NOISE_MAP_GLSL in components/gpgpuShaderPoints.ts
// (kaloNoiseMap01) — same hash constants, same trilinear blend,
// same offset rule, so this reference and the shader agree on
// the field's shape (float32 GPU rounding aside).
//
// Identity: every consumer is gated on its amount (0 = the
// legacy path, the evaluation is skipped), and the colour path
// is a new gradient driver value — the default configuration
// ('life' driver, amounts 0, evolve 0) never samples the field.
//
// Phase BJ generalises the field itself: a KIND (perlin /
// turbulence / ridge — the octave value read as-is, as an
// absolute value, or as one-minus-absolute) and an OCTAVE count
// (fBm: frequency ×2, amplitude ×0.5 per octave, normalised by
// the amplitude sum). The vocabulary mirrors the tile side
// (lib/texturePack.ts) but the definition is independent — a
// different noise family (3D gradient vs 2D value) and the tile
// side is never touched. The default (perlin, 1 octave) is
// bit-identical to the Phase AY field: the fBm sum is the single
// octave value times amplitude 1 over an amplitude sum of 1,
// and the perlin transform is the identity. The same field also
// supplies map / mask sources as a static slice (Phase BJ,
// lib/mapSourceSupply.ts 'noise-field').

/** Evolution direction of the field sample offset (unit-ish,
 *  fixed so the field drifts diagonally through all three axes
 *  instead of sliding along one). */
export const NOISE_FIELD_EVOLVE_DIR: readonly [number, number, number] = [0.31, 0.47, 0.19];

const fract = (v: number): number => v - Math.floor(v);

/** Gradient hash at a lattice point — the velocity pass's
 *  hash3, component for component. Returns values in [-1, 1). */
export function noiseFieldHash3(x: number, y: number, z: number): [number, number, number] {
  const component = (dx: number, dy: number, dz: number): number =>
    -1 + 2 * fract(Math.sin(x * dx + y * dy + z * dz) * 43758.5453123);
  return [
    component(127.1, 311.7, 74.7),
    component(269.5, 183.3, 246.1),
    component(113.5, 271.9, 124.6),
  ];
}

/** Perlin gradient noise — the velocity pass's vnoise. Range is
 *  roughly [-1, 1]; exactly 0 at every integer lattice point. */
export function noiseFieldValue(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const corner = (cx: number, cy: number, cz: number): number => {
    const g = noiseFieldHash3(ix + cx, iy + cy, iz + cz);
    return g[0] * (fx - cx) + g[1] * (fy - cy) + g[2] * (fz - cz);
  };
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  return mix(
    mix(
      mix(corner(0, 0, 0), corner(1, 0, 0), ux),
      mix(corner(0, 1, 0), corner(1, 1, 0), ux),
      uy,
    ),
    mix(
      mix(corner(0, 0, 1), corner(1, 0, 1), ux),
      mix(corner(0, 1, 1), corner(1, 1, 1), ux),
      uy,
    ),
    uz,
  );
}

/** The evolution offset at a field time: direction * evolve *
 *  time. Evolve 0 (the default) is exactly the zero offset at
 *  every time — a static field. */
export function noiseFieldOffset(
  timeSeconds: number,
  evolve: number,
): [number, number, number] {
  const t = Math.max(0, timeSeconds) * evolve;
  return [
    NOISE_FIELD_EVOLVE_DIR[0] * t,
    NOISE_FIELD_EVOLVE_DIR[1] * t,
    NOISE_FIELD_EVOLVE_DIR[2] * t,
  ];
}

/** Field kinds (Phase BJ): how one octave's gradient-noise
 *  value is read before the fBm sum. 'perlin' is the raw value,
 *  'turbulence' its absolute value, 'ridge' one minus the
 *  absolute value — the same three readings the tile side's
 *  textureNoiseKind names, over this field's own noise. */
export type NoiseMapKind = 'perlin' | 'ridge' | 'turbulence';

export const NOISE_MAP_KINDS: readonly NoiseMapKind[] = ['perlin', 'ridge', 'turbulence'];

/** Coerce an arbitrary config value into a field kind
 *  (anything unrecognised is the legacy 'perlin'). */
export function normalizeNoiseMapKind(value: unknown): NoiseMapKind {
  return value === 'ridge' || value === 'turbulence' ? value : 'perlin';
}

/** The kind as the GLSL uniform float (the NOISE_MAP_GLSL
 *  branch thresholds): perlin 0, turbulence 1, ridge 2. */
export function noiseMapKindIndex(kind: NoiseMapKind): number {
  return kind === 'turbulence' ? 1 : kind === 'ridge' ? 2 : 0;
}

/** One octave's reading under a kind (the transform the fBm
 *  sum accumulates). 'perlin' is the identity. */
export function noiseFieldOctaveValue(value: number, kind: NoiseMapKind): number {
  if (kind === 'turbulence') return Math.abs(value);
  if (kind === 'ridge') return 1 - Math.abs(value);
  return value;
}

/** The map value of the field at a world position: sampled at
 *  worldPos * scale + evolution offset, accumulated as fBm
 *  over `octaves` octaves (frequency ×2, amplitude ×0.5,
 *  normalised by the amplitude sum) of the kind-transformed
 *  gradient noise, then mapped to [0, 1] — perlin through
 *  0.5 + 0.5 * v, turbulence / ridge as the (already
 *  non-negative) sum itself — and clamped. Deterministic in
 *  (position, scale, evolve, time, kind, octaves). The default
 *  kind / octaves ('perlin', 1) reproduce the Phase AY sample
 *  bit-for-bit. */
export function sampleNoiseField01(
  x: number,
  y: number,
  z: number,
  scale: number,
  evolve: number,
  timeSeconds: number,
  kind: NoiseMapKind = 'perlin',
  octaves = 1,
): number {
  const k = normalizeNoiseMapKind(kind);
  const oct = clampNoiseMapOctaves(octaves);
  const o = noiseFieldOffset(timeSeconds, evolve);
  const px = x * scale + o[0];
  const py = y * scale + o[1];
  const pz = z * scale + o[2];
  let sum = 0;
  let ampSum = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * noiseFieldOctaveValue(noiseFieldValue(px * freq, py * freq, pz * freq), k);
    ampSum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  const v = sum / ampSum;
  const mapped = k === 'perlin' ? 0.5 + 0.5 * v : v;
  return Math.min(1, Math.max(0, mapped));
}

/** Config clamps (the uniform site resolves through these, so
 *  the values the shader sees are the values the tests pin). */
export function clampNoiseMapScale(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.01;
  return Math.min(0.1, Math.max(0.0005, value));
}

export function clampNoiseMapEvolve(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(4, Math.max(0, value));
}

export function clampNoiseMapAmount(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Octave count of the field's fBm (Phase BJ): an integer in
 *  [1, 5]; anything non-finite is the legacy single octave. */
export function clampNoiseMapOctaves(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}
