// ── Flow-field glyph sampling (Phase AF2) ──────────────────────
// TS twins of the curl-field GLSL in
// components/gpgpuShaderSimulationVelocity.ts (hash3 / vnoise /
// curlNoise / symmetricCurl / curlField and the velocity main's
// curl branch), plus the pure glyph-segment builder the unit
// tests exercise. The rendered overlay
// (components/sceneGpgpuFieldGlyphs.tsx) does NOT use these
// twins: its vertex shader reuses the GLSL chunk sliced verbatim
// out of SIM_VEL_FRAG (extractCurlGlslChunk below), so the
// picture is the same-expression guarantee by construction. The
// twins exist so the field's mathematical properties
// (determinism, divergence-free curl, branch selection) are
// testable off-GPU. Note the sin-hash in hash3 is evaluated in
// float64 here against the GPU's float32 — values agree in
// structure and statistics, not bit-for-bit.

import { SIM_VEL_FRAG } from '../components/gpgpuShaderSimulationVelocity';

/**
 * Slice the curl GLSL chunk (hash3 through curlField) out of the
 * velocity fragment shader source, verbatim. The chunk depends
 * only on the uCurlSymmetry / uCurlMode / uCurlOctaves uniforms,
 * which the overlay shader declares for itself. Returns '' when
 * the markers are not found (the overlay then renders nothing
 * and the unit test fails loudly).
 */
export function extractCurlGlslChunk(source: string = SIM_VEL_FRAG): string {
  const start = source.indexOf('vec3 hash3(vec3 p)');
  const end = source.indexOf('// Gyroid SDF');
  if (start < 0 || end < 0 || end <= start) return '';
  return source.slice(start, end);
}

export type Vec3 = [number, number, number];

function glslMod(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

export function hash3(p: Vec3): Vec3 {
  const q: Vec3 = [
    dot3(p, [127.1, 311.7, 74.7]),
    dot3(p, [269.5, 183.3, 246.1]),
    dot3(p, [113.5, 271.9, 124.6]),
  ];
  return [
    -1 + 2 * dmHash11(q[0]),
    -1 + 2 * dmHash11(q[1]),
    -1 + 2 * dmHash11(q[2]),
  ];
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function vnoise(p: Vec3): number {
  const i: Vec3 = [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])];
  const f: Vec3 = [p[0] - i[0], p[1] - i[1], p[2] - i[2]];
  const u: Vec3 = [
    f[0] * f[0] * (3 - 2 * f[0]),
    f[1] * f[1] * (3 - 2 * f[1]),
    f[2] * f[2] * (3 - 2 * f[2]),
  ];
  const corner = (ox: number, oy: number, oz: number): number => {
    const h = hash3([i[0] + ox, i[1] + oy, i[2] + oz]);
    return dot3(h, [f[0] - ox, f[1] - oy, f[2] - oz]);
  };
  return mix(
    mix(
      mix(corner(0, 0, 0), corner(1, 0, 0), u[0]),
      mix(corner(0, 1, 0), corner(1, 1, 0), u[0]),
      u[1],
    ),
    mix(
      mix(corner(0, 0, 1), corner(1, 0, 1), u[0]),
      mix(corner(0, 1, 1), corner(1, 1, 1), u[0]),
      u[1],
    ),
    u[2],
  );
}

/** Divergence-free curl noise (12 noise evals), GLSL twin. */
export function curlNoise(p: Vec3): Vec3 {
  const e = 0.1;
  const p1: Vec3 = [p[0] + 31.416, p[1], p[2]];
  const p2: Vec3 = [p[0], p[1] + 43.982, p[2]];
  const dFzDy = vnoise([p2[0], p2[1] + e, p2[2]]) - vnoise([p2[0], p2[1] - e, p2[2]]);
  const dFyDz = vnoise([p1[0], p1[1], p1[2] + e]) - vnoise([p1[0], p1[1], p1[2] - e]);
  const dFxDz = vnoise([p[0], p[1], p[2] + e]) - vnoise([p[0], p[1], p[2] - e]);
  const dFzDx = vnoise([p2[0] + e, p2[1], p2[2]]) - vnoise([p2[0] - e, p2[1], p2[2]]);
  const dFyDx = vnoise([p1[0] + e, p1[1], p1[2]]) - vnoise([p1[0] - e, p1[1], p1[2]]);
  const dFxDy = vnoise([p[0], p[1] + e, p[2]]) - vnoise([p[0], p[1] - e, p[2]]);
  return [
    (dFzDy - dFyDz) / (2 * e),
    (dFxDz - dFzDx) / (2 * e),
    (dFyDx - dFxDy) / (2 * e),
  ];
}

/** Field symmetry fold/unfold, GLSL twin (symmetry: 0 none,
 *  1 mirrorX, 2 radial4, 3 radial6, 4 octahedral). */
export function symmetricCurl(p: Vec3, tOff: Vec3, symmetry: number): Vec3 {
  if (symmetry === 1) {
    const sx = p[0] < 0 ? -1 : 1;
    const c = curlNoise([Math.abs(p[0]) + tOff[0], p[1] + tOff[1], p[2] + tOff[2]]);
    return [c[0] * sx, c[1], c[2]];
  }
  if (symmetry === 4) {
    const s: Vec3 = [p[0] < 0 ? -1 : 1, p[1] < 0 ? -1 : 1, p[2] < 0 ? -1 : 1];
    const c = curlNoise([Math.abs(p[0]) + tOff[0], Math.abs(p[1]) + tOff[1], Math.abs(p[2]) + tOff[2]]);
    return [c[0] * s[0], c[1] * s[1], c[2] * s[2]];
  }
  const k = symmetry === 2 ? 4 : 6;
  const sector = 6.28318530718 / k;
  const r = Math.hypot(p[0], p[2]);
  const theta = Math.atan2(p[2], p[0]);
  const normTheta = glslMod(theta, sector);
  const folded = normTheta > sector * 0.5 ? sector - normTheta : normTheta;
  const c = curlNoise([
    r * Math.cos(folded) + tOff[0],
    p[1] + tOff[1],
    r * Math.sin(folded) + tOff[2],
  ]);
  const rot = theta - folded;
  const rc = Math.cos(rot);
  const rs = Math.sin(rot);
  return [c[0] * rc - c[2] * rs, c[1], c[0] * rs + c[2] * rc];
}

export function curlSampleAt(p: Vec3, tOff: Vec3, symmetry: number): Vec3 {
  return symmetry === 0
    ? curlNoise([p[0] + tOff[0], p[1] + tOff[1], p[2] + tOff[2]])
    : symmetricCurl(p, tOff, symmetry);
}

/** The generalised field path (octaves / ridged / vortex), twin. */
export function curlField(p: Vec3, tOff: Vec3, mode: number, octaves: number, symmetry: number): Vec3 {
  let c = curlSampleAt(p, tOff, symmetry);
  if (octaves >= 2) {
    const o = curlSampleAt(
      [p[0] * 2.13, p[1] * 2.13, p[2] * 2.13],
      [tOff[0] + 17.1, tOff[1] - 9.4, tOff[2] + 5.7],
      symmetry,
    );
    c = [c[0] + 0.45 * o[0], c[1] + 0.45 * o[1], c[2] + 0.45 * o[2]];
  }
  if (octaves >= 3) {
    const o = curlSampleAt(
      [p[0] * 4.27, p[1] * 4.27, p[2] * 4.27],
      [tOff[0] - 11.3, tOff[1] + 21.8, tOff[2] - 14.2],
      symmetry,
    );
    c = [c[0] + 0.22 * o[0], c[1] + 0.22 * o[1], c[2] + 0.22 * o[2]];
  }
  if (mode === 1) {
    // ridged: sign(c) * (1.25 - exp(-|c| * 0.9)) * 2.1 per component
    c = [
      Math.sign(c[0]) * (1.25 - Math.exp(-Math.abs(c[0]) * 0.9)) * 2.1,
      Math.sign(c[1]) * (1.25 - Math.exp(-Math.abs(c[1]) * 0.9)) * 2.1,
      Math.sign(c[2]) * (1.25 - Math.exp(-Math.abs(c[2]) * 0.9)) * 2.1,
    ];
  } else if (mode === 2) {
    // vortex: tangential swirl around Y on the scaled position
    c = [c[0] + -p[2] * 0.49, c[1], c[2] + p[0] * 0.49];
  }
  return c;
}

// ── Allocation-free fast path (Round 84 gap 3) ────────────────
// The rigid force coupling samples the field once per body per
// frame (up to 64/frame); the twin above allocates several
// hundred small arrays per sample (~16us in Node), which made
// the coupling's sampling cost dominate the solver step. The
// functions below repeat the twin's arithmetic with scalar
// locals, in the SAME operation order, so results are
// bit-identical to the twin in float64 (verified by the phase41
// test over thousands of points). Coverage: the legacy path
// (mode 0, octaves <= 1, every symmetry). The generalised path
// (ridged / vortex / multi-octave) falls back to the twin.

function dmHash11Scalar(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

/** vnoise with scalar locals; bit-identical to vnoise(). */
function vnoiseFast(px: number, py: number, pz: number): number {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
  const fx = px - ix, fy = py - iy, fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const corner = (ox: number, oy: number, oz: number): number => {
    const cx = ix + ox, cy = iy + oy, cz = iz + oz;
    const hx = -1 + 2 * dmHash11Scalar(cx * 127.1 + cy * 311.7 + cz * 74.7);
    const hy = -1 + 2 * dmHash11Scalar(cx * 269.5 + cy * 183.3 + cz * 246.1);
    const hz = -1 + 2 * dmHash11Scalar(cx * 113.5 + cy * 271.9 + cz * 124.6);
    return hx * (fx - ox) + hy * (fy - oy) + hz * (fz - oz);
  };
  const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), ux), mix(corner(0, 1, 0), corner(1, 1, 0), ux), uy),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), ux), mix(corner(0, 1, 1), corner(1, 1, 1), ux), uy),
    uz,
  );
}

/** curlNoise with scalar locals; bit-identical to curlNoise(). */
function curlNoiseFast(px: number, py: number, pz: number, out: Vec3): void {
  const e = 0.1;
  const p1x = px + 31.416;
  const p2y = py + 43.982;
  const dFzDy = vnoiseFast(px, p2y + e, pz) - vnoiseFast(px, p2y - e, pz);
  const dFyDz = vnoiseFast(p1x, py, pz + e) - vnoiseFast(p1x, py, pz - e);
  const dFxDz = vnoiseFast(px, py, pz + e) - vnoiseFast(px, py, pz - e);
  const dFzDx = vnoiseFast(px + e, p2y, pz) - vnoiseFast(px - e, p2y, pz);
  const dFyDx = vnoiseFast(p1x + e, py, pz) - vnoiseFast(p1x - e, py, pz);
  const dFxDy = vnoiseFast(px, py + e, pz) - vnoiseFast(px, py - e, pz);
  out[0] = (dFzDy - dFyDz) / (2 * e);
  out[1] = (dFxDz - dFzDx) / (2 * e);
  out[2] = (dFyDx - dFxDy) / (2 * e);
}

const CURL_FAST_SCRATCH: Vec3 = [0, 0, 0];

/**
 * sampleCurlField with an allocation-free legacy path.
 * Bit-identical to sampleCurlField for every parameter set
 * (the generalised path delegates to the twin). NOT reentrant
 * through the shared scratch — callers must consume the result
 * before the next call (fillRigidCurlAccel does).
 */
export function sampleCurlFieldFast(pos: Vec3, params: CurlFieldParams): Vec3 {
  if (!params.enabled) return [0, 0, 0];
  if (!(params.mode === 0 && params.octaves <= 1)) return sampleCurlField(pos, params);
  const curlTime = params.time * 0.15 * params.speed;
  const px = pos[0] * params.scale + params.seedOffset[0];
  const py = pos[1] * params.scale + params.seedOffset[1];
  const pz = pos[2] * params.scale + params.seedOffset[2];
  const out = CURL_FAST_SCRATCH;
  if (params.symmetry === 0) {
    curlNoiseFast(px + curlTime, py + curlTime, pz + curlTime, out);
    return out;
  }
  if (params.symmetry === 1) {
    const sx = px < 0 ? -1 : 1;
    curlNoiseFast(Math.abs(px) + curlTime, py + curlTime, pz + curlTime, out);
    out[0] *= sx;
    return out;
  }
  if (params.symmetry === 4) {
    curlNoiseFast(Math.abs(px) + curlTime, Math.abs(py) + curlTime, Math.abs(pz) + curlTime, out);
    out[0] *= px < 0 ? -1 : 1;
    out[1] *= py < 0 ? -1 : 1;
    out[2] *= pz < 0 ? -1 : 1;
    return out;
  }
  // Radial symmetries (2 / 3): same fold/unfold as the twin.
  const k = params.symmetry === 2 ? 4 : 6;
  const sector = 6.28318530718 / k;
  const r = Math.hypot(px, pz);
  const theta = Math.atan2(pz, px);
  const normTheta = glslMod(theta, sector);
  const folded = normTheta > sector * 0.5 ? sector - normTheta : normTheta;
  curlNoiseFast(r * Math.cos(folded) + curlTime, py + curlTime, r * Math.sin(folded) + curlTime, out);
  const rot = theta - folded;
  const rc = Math.cos(rot);
  const rs = Math.sin(rot);
  const c0 = out[0], c2 = out[2];
  out[0] = c0 * rc - c2 * rs;
  out[2] = c0 * rs + c2 * rc;
  return out;
}

export interface CurlFieldParams {
  enabled: boolean;
  scale: number;
  /** uCurlSpeed equivalent (the shader multiplies time by
   *  0.15 * speed to get curlTime). */
  speed: number;
  mode: number;
  octaves: number;
  symmetry: number;
  /** Replica seed offset of the field being shown (the shared
   *  path's is (0, 0, 0)). */
  seedOffset: Vec3;
  /** Simulation clock (uTime + uReplicaTimeOffset). */
  time: number;
}

/**
 * The velocity shader's curl branch, twin: legacy single-octave
 * path for mode 0 with octaves ≤ 1 (with the symmetry variant),
 * the generalised curlField otherwise. Returns the raw field
 * (before uCurlStrength scaling — direction and relative
 * magnitude are what glyphs draw).
 */
export function sampleCurlField(pos: Vec3, params: CurlFieldParams): Vec3 {
  if (!params.enabled) return [0, 0, 0];
  const curlTime = params.time * 0.15 * params.speed;
  const tOff: Vec3 = [curlTime, curlTime, curlTime];
  const p: Vec3 = [
    pos[0] * params.scale + params.seedOffset[0],
    pos[1] * params.scale + params.seedOffset[1],
    pos[2] * params.scale + params.seedOffset[2],
  ];
  if (params.mode === 0 && params.octaves <= 1) {
    return params.symmetry === 0
      ? curlNoise([p[0] + tOff[0], p[1] + tOff[1], p[2] + tOff[2]])
      : symmetricCurl(p, tOff, params.symmetry);
  }
  return curlField(p, tOff, params.mode, params.octaves, params.symmetry);
}

/** Glyph length rule shared by the overlay shader and this
 *  builder: strength capped at 3, scaled by the length key and
 *  the grid cell size. */
export function fieldGlyphSegmentLength(magnitude: number, lengthKey: number, cell: number): number {
  return Math.min(magnitude, 3) * lengthKey * cell;
}

export interface FieldGlyphGridOptions {
  /** Grid points per side. */
  grid: number;
  /** Half-extent of the grid (the bounce radius). */
  radius: number;
  /** The length key (gpgpuFieldGlyphLength). */
  length: number;
}

/**
 * Build the glyph segments for a z = 0 grid: one segment per
 * grid point, centred on the point, directed along the field,
 * length by fieldGlyphSegmentLength. Returns grid² × 6 floats
 * (two endpoints per segment). Zero field → degenerate
 * (invisible) segments.
 */
export function buildFieldGlyphSegments(
  params: CurlFieldParams,
  options: FieldGlyphGridOptions,
): Float32Array {
  const grid = Math.max(1, Math.floor(options.grid));
  const radius = Math.max(0.01, options.radius);
  const cell = (2 * radius) / grid;
  const out = new Float32Array(grid * grid * 6);
  let o = 0;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const cx = -radius + (gx + 0.5) * cell;
      const cy = -radius + (gy + 0.5) * cell;
      const field = sampleCurlField([cx, cy, 0], params);
      const mag = Math.hypot(field[0], field[1], field[2]);
      const half = fieldGlyphSegmentLength(mag, options.length, cell) / 2;
      const inv = mag > 1e-9 ? 1 / mag : 0;
      const dx = field[0] * inv * half;
      const dy = field[1] * inv * half;
      const dz = field[2] * inv * half;
      out[o++] = cx - dx;
      out[o++] = cy - dy;
      out[o++] = -dz;
      out[o++] = cx + dx;
      out[o++] = cy + dy;
      out[o++] = dz;
    }
  }
  return out;
}
