// Deform operator stack (Layer 1 WP8, phase A).
//
// Design: the general deformation grammar the WP8 survey found
// missing. Until this module, deformation lived in three
// dedicated places — lib/formDeformation.ts (Disperse / Twist /
// Fractal Field over Form's morph bake), lib/objMeshDeform.ts
// (wave / twist / bend injected into OBJ mesh materials) and the
// CSG extrusion's twist — each closed inside its own consumer,
// with no way to stack deformation operators onto a shape
// source or a particle placement as authored grammar.
//
// This module is that grammar, in the authoring style of the
// distribution layer (lib/gpgpuDistribution.ts): operators are
// authored as a JSON list, parsed tolerantly (unknown operators
// dropped, parameters fall back per operator), resolved toward
// identity (identity operators are removed), and applied in
// list order as pure functions of the point. Phase A is the
// lib + bake side only: the two bakes consume it through
// optional arguments (lib/gpgpuInitialData.ts and
// lib/gpgpuMorphTargets.ts); the runtime (shader) wiring is
// phase D's work and no GLSL twin lives here yet.
//
// Operators:
//   bend  {axis, dir, amount, center}
//         parabolic bend: the coordinate along `dir` gains
//         amount * t^2, where t is the coordinate along `axis`
//         relative to `center`. This is the formula family of
//         objMeshDeform's bend (transformed.y += 0.3 * amount *
//         freq * x^2): the two coincide with axis 'x', dir 'y',
//         center 0 and stack amount = 0.3 * objAmount * objFreq.
//   twist {axis, amount, center}
//         rotation around `axis` by angle = amount * (the
//         coordinate along `axis` relative to `center`). Term
//         for term the Form twist (lib/formDeformation.ts:
//         angle = amount * coord, rotateAroundAxis) and, with
//         amount = objAmount * PI * objFreq, the static case of
//         objMeshDeform's twist. Inside a stack the angle keys
//         off the point as the previous operators left it; a
//         lone twist coincides with the Form twist exactly
//         (Form captures its angle before its own disperse,
//         which a lone stack twist has no equivalent of).
//   taper {axis, amount, center, range}
//         the two coordinates perpendicular to `axis` scale by
//         1 + amount * t, t = (coordinate along `axis` relative
//         to `center`) / range. The factor is clamped at 0, so
//         a strong negative amount pinches to the axis instead
//         of mirroring through it.
//   noise {amount, frequency, evolution}
//         the Form Fractal Field as a stack operator: each axis
//         is offset by an independent channel of the seeded
//         value-noise fBm (lib/formDeformation.ts
//         formFractalNoise, channels 11 / 47 / 83, sampled at
//         point * frequency + evolution), scaled by amount *
//         0.5. Evaluated at the point's absolute coordinates,
//         like the Form field; `center` does not apply. With
//         equal amount / frequency / evolution the operator
//         coincides with the Form fractal field alone.
//   ffd   {divisions, min, max, points}
//         free-form deformation over an axis-aligned box: the
//         point's offset is the Bernstein (trilinear at
//         divisions 1) blend of the authored control-point
//         offsets. `points` is a flat xyz list, one offset per
//         control point, ordered x slowest then y then z
//         (index ((i * (d+1) + j) * (d+1) + k) * 3). The
//         normalised coordinates are clamped into the box, so
//         points outside ride the nearest face's blend.
//
// Identity discipline: resolution drops identity operators
// (bend / twist / taper / noise at amount 0, an ffd whose
// offsets are all 0), so a stack that resolves to nothing is
// skipped entirely by both bakes — their arrays stay
// bit-identical to the legacy ones. The stack consumes no RNG
// draws anywhere, so ages, velocities and draw streams are
// untouched; only placements move.

import {
  clampFractalFrequency,
  clampTwistAmount,
  formFractalNoise,
  rotateAroundAxis,
  type FormTwistAxis,
} from './formDeformation';

export type DeformAxis = FormTwistAxis;
export type DeformOpKind = 'bend' | 'twist' | 'taper' | 'noise' | 'ffd';

export interface DeformOp {
  op: DeformOpKind;
  /** bend: progress axis. twist / taper: the axis. */
  axis: DeformAxis;
  /** bend only: the axis the displacement lands on. */
  dir: DeformAxis;
  /** bend / twist / taper / noise amount (ffd ignores it). */
  amount: number;
  /** bend / twist / taper centre (noise / ffd ignore it). */
  center: readonly [number, number, number];
  /** noise only: sample frequency (Form fractal clamping). */
  frequency: number;
  /** noise only: sample offset (a config value, never a clock). */
  evolution: number;
  /** taper only: length over which t runs 0..1 from the centre. */
  range: number;
  /** ffd only: segments per axis, 1..3. */
  ffdDivisions: number;
  /** ffd only: the lattice box. */
  ffdMin: readonly [number, number, number];
  ffdMax: readonly [number, number, number];
  /** ffd only: flat xyz offsets, 3 * (ffdDivisions + 1)^3. */
  ffdPoints: readonly number[];
}

/** The stack is capped at 8 operators (the distribution cap). */
export const DEFORM_MAX_OPS = 8;

const DEFORM_KINDS: ReadonlySet<string> = new Set(['bend', 'twist', 'taper', 'noise', 'ffd']);
const AXES: readonly DeformAxis[] = ['x', 'y', 'z'];
const AXIS_INDEX: Record<DeformAxis, number> = { x: 0, y: 1, z: 2 };

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function parseAxis(value: unknown, fallback: DeformAxis): DeformAxis {
  return value === 'x' || value === 'y' || value === 'z' ? value : fallback;
}

/** The axis after `axis` in x -> y -> z -> x order. */
function nextAxis(axis: DeformAxis): DeformAxis {
  return AXES[(AXIS_INDEX[axis] + 1) % 3];
}

function parseVec3(value: unknown, fallback: readonly [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return [fallback[0], fallback[1], fallback[2]];
  const x = finiteOr(value[0], NaN);
  const y = finiteOr(value[1], NaN);
  const z = finiteOr(value[2], NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  return [x, y, z];
}

const ZERO3: readonly [number, number, number] = [0, 0, 0];
const UNIT_BOX_MIN: readonly [number, number, number] = [-1, -1, -1];
const UNIT_BOX_MAX: readonly [number, number, number] = [1, 1, 1];

function baseOp(op: DeformOpKind): DeformOp {
  return {
    op,
    axis: 'y',
    dir: 'y',
    amount: 0,
    center: ZERO3,
    frequency: 1.5,
    evolution: 0,
    range: 1,
    ffdDivisions: 1,
    ffdMin: UNIT_BOX_MIN,
    ffdMax: UNIT_BOX_MAX,
    ffdPoints: [],
  };
}

/**
 * Parse and sanitise the authored JSON list. Anything unusable
 * (non-JSON, non-array, unknown op, malformed ffd payload)
 * resolves toward identity: unknown entries are dropped,
 * parameters are clamped, identity operators are removed. The
 * result is the stack both bakes consume.
 */
export function parseDeformOps(raw: string | null | undefined): DeformOp[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ops: DeformOp[] = [];
  for (const entry of parsed) {
    if (ops.length >= DEFORM_MAX_OPS) break;
    if (!entry || typeof entry !== 'object') continue;
    const kind = (entry as { op?: unknown }).op;
    if (typeof kind !== 'string' || !DEFORM_KINDS.has(kind)) continue;
    const e = entry as Record<string, unknown>;
    if (kind === 'bend') {
      const amount = clamp(finiteOr(e.amount, 0), -8, 8);
      if (amount === 0) continue;
      const op = baseOp('bend');
      op.axis = parseAxis(e.axis, 'x');
      op.dir = parseAxis(e.dir, nextAxis(op.axis));
      if (op.dir === op.axis) op.dir = nextAxis(op.axis);
      op.amount = amount;
      op.center = parseVec3(e.center, ZERO3);
      ops.push(op);
    } else if (kind === 'twist') {
      const amount = clampTwistAmount(finiteOr(e.amount, 0));
      if (amount === 0) continue;
      const op = baseOp('twist');
      op.axis = parseAxis(e.axis, 'y');
      op.amount = amount;
      op.center = parseVec3(e.center, ZERO3);
      ops.push(op);
    } else if (kind === 'taper') {
      const amount = clamp(finiteOr(e.amount, 0), -4, 4);
      if (amount === 0) continue;
      const op = baseOp('taper');
      op.axis = parseAxis(e.axis, 'y');
      op.amount = amount;
      op.center = parseVec3(e.center, ZERO3);
      const range = finiteOr(e.range, 1);
      op.range = range > 0 ? range : 1;
      ops.push(op);
    } else if (kind === 'noise') {
      const amount = clamp(finiteOr(e.amount, 0), -2, 2);
      if (amount === 0) continue;
      const op = baseOp('noise');
      op.amount = amount;
      op.frequency = clampFractalFrequency(finiteOr(e.frequency, NaN));
      op.evolution = finiteOr(e.evolution, 0);
      ops.push(op);
    } else {
      // ffd
      const divisions = clamp(Math.floor(finiteOr(e.divisions, 1)), 1, 3);
      const perAxis = divisions + 1;
      const expected = 3 * perAxis * perAxis * perAxis;
      const rawPoints = e.points;
      if (!Array.isArray(rawPoints) || rawPoints.length !== expected) continue;
      const points: number[] = [];
      let usable = true;
      let anyNonZero = false;
      for (const v of rawPoints) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          usable = false;
          break;
        }
        points.push(v);
        if (v !== 0) anyNonZero = true;
      }
      if (!usable || !anyNonZero) continue;
      const op = baseOp('ffd');
      op.ffdDivisions = divisions;
      op.ffdMin = parseVec3(e.min, UNIT_BOX_MIN);
      op.ffdMax = parseVec3(e.max, UNIT_BOX_MAX);
      op.ffdPoints = points;
      ops.push(op);
    }
  }
  return ops;
}

/** The resolved stack for an authored JSON string. */
export function resolveDeformOps(raw: string | null | undefined): DeformOp[] {
  return parseDeformOps(raw);
}

/** True while a resolved stack has any effective operator. */
export function deformStackActive(ops: readonly DeformOp[] | null | undefined): boolean {
  return !!ops && ops.length > 0;
}

function bernstein(degree: number, i: number, u: number): number {
  // Binomial coefficient for degree <= 3, written out.
  const c = degree === 1 ? 1 : degree === 2 ? (i === 1 ? 2 : 1) : i === 0 || i === 3 ? 1 : 3;
  return c * Math.pow(u, i) * Math.pow(1 - u, degree - i);
}

function applyFfd(op: DeformOp, x: number, y: number, z: number): [number, number, number] {
  const d = op.ffdDivisions;
  const perAxis = d + 1;
  const p: [number, number, number] = [x, y, z];
  const u: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const span = op.ffdMax[a] - op.ffdMin[a];
    u[a] = span > 0 ? clamp((p[a] - op.ffdMin[a]) / span, 0, 1) : 0;
  }
  const bx: number[] = [];
  const by: number[] = [];
  const bz: number[] = [];
  for (let i = 0; i < perAxis; i++) {
    bx.push(bernstein(d, i, u[0]));
    by.push(bernstein(d, i, u[1]));
    bz.push(bernstein(d, i, u[2]));
  }
  let ox = 0;
  let oy = 0;
  let oz = 0;
  for (let i = 0; i < perAxis; i++) {
    for (let j = 0; j < perAxis; j++) {
      for (let k = 0; k < perAxis; k++) {
        const w = bx[i] * by[j] * bz[k];
        if (w === 0) continue;
        const o = ((i * perAxis + j) * perAxis + k) * 3;
        ox += w * op.ffdPoints[o];
        oy += w * op.ffdPoints[o + 1];
        oz += w * op.ffdPoints[o + 2];
      }
    }
  }
  return [x + ox, y + oy, z + oz];
}

// ── Runtime (shader) wiring (Layer 1 WP8, phase D) ────────
//
// Phase A landed the grammar and the two CPU bakes; this
// section is the respawn side. The authored stack rides the
// config key gpgpuEmitDeform (a JSON string, the
// gpgpuEmitDistribution precedent) and the position pass
// evaluates DEFORM_GLSL — the term-for-term GLSL twin of
// applyDeformOps below — over the final placed point, at the
// same pipeline position the bake uses (after the source,
// the distribution layer, the emitter transform and the
// mask gate). While the key resolves to no effective
// operator the variant never stands and the position
// fragment is the shipped string byte for byte.
//
// Supply follows the distribution layer's discipline
// (lib/gpgpuDistribution.ts): the operator list rides a
// uniform vec4 array (uDeformOps, three vec4s per operator,
// packDeformOps) plus a count — no sampler is spent on the
// operators themselves. The one payload that cannot fit a
// uniform array is the FFD control-point list (up to 64
// points per operator): it rides the shared column texture
// in an append-only 'deformFfd' section
// (lib/gpgpuPathAssets.ts, the WP5 phase D fieldExt
// precedent), read through the uDeformColTex uniforms the
// position variant declares only while an FFD operator
// stands (deformColumnActive).
//
// The noise operator's lattice hash is integer math by
// design (lib/formDeformation.ts: platform independence), so
// its GLSL twin is integer arithmetic too — the hash itself
// is exact; only the final normalisation to [0, 1) rounds
// through float, the same precision class as every other
// float twin in the tree. The compiled form is WebGL2 GLSL
// (the tree's shader floor); its on-device compilation is a
// gate-side check, like every variant this phase produces.

/** Config slice the runtime wiring reads. */
export interface DeformConfig {
  gpgpuEmitDeform?: string;
}

/** The resolved stack for a config (memo-free pure read). */
export function resolveConfigDeformOps(config: DeformConfig): DeformOp[] {
  return parseDeformOps(config.gpgpuEmitDeform ?? '');
}

/** True while a config's stack has any effective operator —
 *  the position fragment's deform variant stands. */
export function deformVariantActive(config: DeformConfig): boolean {
  return resolveConfigDeformOps(config).length > 0;
}

/** True while a config's stack carries an FFD operator —
 *  the column texture's deformFfd section (and the position
 *  variant's column uniforms) stand. */
export function deformColumnActive(config: DeformConfig): boolean {
  return resolveConfigDeformOps(config).some((op) => op.op === 'ffd');
}

/** Operator ids as consumed by the shader's uDeformOps. */
export const DEFORM_OP_IDS: Record<DeformOpKind, number> = {
  bend: 0,
  twist: 1,
  taper: 2,
  noise: 3,
  ffd: 4,
};

/** vec4 uniforms per operator in uDeformOps. */
export const DEFORM_VEC4_PER_OP = 3;

/** Total vec4s of the uDeformOps uniform array. */
export const DEFORM_UNIFORM_VEC4S = DEFORM_MAX_OPS * DEFORM_VEC4_PER_OP;

/** Column texels reserved for FFD control points: every
 *  operator of a full stack at the maximum lattice. */
export const DEFORM_FFD_MAX_TEXELS = DEFORM_MAX_OPS * 64;

/** FFD control-point count of one operator. */
export function deformFfdPointCount(op: DeformOp): number {
  const perAxis = op.ffdDivisions + 1;
  return perAxis * perAxis * perAxis;
}

/** Total FFD control points over a resolved stack. */
export function deformFfdTexelCount(ops: readonly DeformOp[]): number {
  let total = 0;
  for (const op of ops) {
    if (op.op === 'ffd') total += deformFfdPointCount(op);
  }
  return total;
}

/**
 * Pack the stack into the uDeformOps uniform layout:
 * DEFORM_MAX_OPS × 3 vec4s as flat numbers.
 *   A = (kindId, axisIndex, dirIndex, amount)
 *   B = (center.x, center.y, center.z, range)
 *       — ffd: (min.x, min.y, min.z, max.x)
 *   C = (frequency, evolution, ffdOffset, ffdDivisions)
 *       — ffd: (max.y, max.z, ffdOffset, divisions)
 * ffdOffset is the operator's control-point offset within
 * the column texture's deformFfd section (texels, cumulative
 * over the stack's FFD operators in list order); -1 while
 * the operator is not an FFD operator.
 */
export function packDeformOps(ops: readonly DeformOp[]): number[] {
  const out: number[] = [];
  let ffdCursor = 0;
  const offsets = ops.map((op) => {
    if (op.op !== 'ffd') return -1;
    const offset = ffdCursor;
    ffdCursor += deformFfdPointCount(op);
    return offset;
  });
  for (let i = 0; i < DEFORM_MAX_OPS; i++) {
    const op = ops[i];
    if (!op) {
      out.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      continue;
    }
    out.push(DEFORM_OP_IDS[op.op], AXIS_INDEX[op.axis], AXIS_INDEX[op.dir], op.amount);
    if (op.op === 'ffd') {
      out.push(op.ffdMin[0], op.ffdMin[1], op.ffdMin[2], op.ffdMax[0]);
      out.push(op.ffdMax[1], op.ffdMax[2], offsets[i], op.ffdDivisions);
    } else {
      out.push(op.center[0], op.center[1], op.center[2], op.range);
      out.push(op.frequency, op.evolution, -1, 0);
    }
  }
  return out;
}

/**
 * The deformFfd column section's payload: every FFD
 * operator's control points in list order, one texel per
 * point as (x, y, z, 0) — the layout kaloDeformFfd reads
 * through the packed ffdOffset values.
 */
export function packDeformFfdPoints(ops: readonly DeformOp[]): Float32Array {
  const data = new Float32Array(deformFfdTexelCount(ops) * 4);
  let cursor = 0;
  for (const op of ops) {
    if (op.op !== 'ffd') continue;
    const count = deformFfdPointCount(op);
    for (let j = 0; j < count; j++) {
      data[(cursor + j) * 4] = op.ffdPoints[j * 3];
      data[(cursor + j) * 4 + 1] = op.ffdPoints[j * 3 + 1];
      data[(cursor + j) * 4 + 2] = op.ffdPoints[j * 3 + 2];
    }
    cursor += count;
  }
  return data;
}

/**
 * GLSL twin of applyDeformOps. Reads the operator list from
 * the uDeformOps / uDeformOpCount uniforms the position
 * variant declares alongside it (POS_FRAG_DEFORM_UNIFORMS in
 * components/gpgpuShaderSimulationPosition.ts). While
 * `withFfd` holds, the chunk also reads the FFD control
 * points through the uDeformColTex / uDeformColWidth /
 * uDeformColHeight / uDeformFfdBase uniforms of the FFD
 * sub-variant; without it the kind-4 branch is omitted (the
 * sub-variant resolution guarantees no FFD operator is
 * packed then). The formulas mirror the JS twin term for
 * term.
 */
export function deformGlsl(withFfd: boolean): string {
  const ffdFetch = withFfd
    ? /* glsl */ `
  vec4 kaloDeformColFetch(float idx) {
    float cx = mod(idx, uDeformColWidth);
    float cy = floor(idx / uDeformColWidth);
    return texture2D(uDeformColTex, vec2((cx + 0.5) / uDeformColWidth, (cy + 0.5) / uDeformColHeight));
  }
`
    : '';
  const ffdBranch = withFfd
    ? /* glsl */ `      if (kind == 4) {
      // ffd: Bernstein blend of the authored control-point
      // offsets over the lattice box (applyFfd).
      float div = c.w;
      float per = div + 1.0;
      vec3 mn = vec3(b.x, b.y, b.z);
      vec3 mx = vec3(b.w, c.x, c.y);
      vec3 span = mx - mn;
      vec3 u = vec3(
        span.x > 0.0 ? clamp((p.x - mn.x) / span.x, 0.0, 1.0) : 0.0,
        span.y > 0.0 ? clamp((p.y - mn.y) / span.y, 0.0, 1.0) : 0.0,
        span.z > 0.0 ? clamp((p.z - mn.z) / span.z, 0.0, 1.0) : 0.0);
      vec3 off = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        if (float(i) > div) break;
        float bx = kaloDeformBernstein(div, float(i), u.x);
        if (bx == 0.0) continue;
        for (int j = 0; j < 4; j++) {
          if (float(j) > div) break;
          float by = kaloDeformBernstein(div, float(j), u.y);
          if (by == 0.0) continue;
          for (int k = 0; k < 4; k++) {
            if (float(k) > div) break;
            float bz = kaloDeformBernstein(div, float(k), u.z);
            float w = bx * by * bz;
            if (w == 0.0) continue;
            float pointIdx = (float(i) * per + float(j)) * per + float(k);
            off += w * kaloDeformColFetch(uDeformFfdBase + c.z + pointIdx).xyz;
          }
        }
      }
      p += off;
        continue;
      }
`
    : '';
  return /* glsl */ `
  // Deform stack (Layer 1 WP8, phase D): GLSL twins of
  // applyDeformOps in lib/gpgpuDeformStack.ts — keep the two
  // term for term.
  float kaloDeformCoord(vec3 v, int axis) {
    if (axis == 0) return v.x;
    if (axis == 2) return v.z;
    return v.y;
  }
  vec3 kaloDeformRotateAxis(vec3 q, int axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    if (axis == 0) return vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
    if (axis == 2) return vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z);
    return vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  }
  uint kaloDeformLatticeHash(int ix, int iy, int iz, int seed) {
    uint h = (uint(ix) * 0x27d4eb2du)
      ^ (uint(iy) * 0x165667b1u)
      ^ (uint(iz) * 0x1b56c4e9u)
      ^ (uint(seed) * 0x9e3779b1u);
    h = (h ^ (h >> 15)) * 0x85ebca6bu;
    h ^= h >> 13;
    return h;
  }
  float kaloDeformLattice(int ix, int iy, int iz, int seed) {
    return float(kaloDeformLatticeHash(ix, iy, iz, seed)) / 4294967296.0 * 2.0 - 1.0;
  }
  float kaloDeformSmooth(float t) {
    return t * t * (3.0 - 2.0 * t);
  }
  float kaloDeformNoise3(vec3 p, int seed) {
    int ix = int(floor(p.x));
    int iy = int(floor(p.y));
    int iz = int(floor(p.z));
    float fx = kaloDeformSmooth(p.x - float(ix));
    float fy = kaloDeformSmooth(p.y - float(iy));
    float fz = kaloDeformSmooth(p.z - float(iz));
    float c000 = kaloDeformLattice(ix, iy, iz, seed);
    float c100 = kaloDeformLattice(ix + 1, iy, iz, seed);
    float c010 = kaloDeformLattice(ix, iy + 1, iz, seed);
    float c110 = kaloDeformLattice(ix + 1, iy + 1, iz, seed);
    float c001 = kaloDeformLattice(ix, iy, iz + 1, seed);
    float c101 = kaloDeformLattice(ix + 1, iy, iz + 1, seed);
    float c011 = kaloDeformLattice(ix, iy + 1, iz + 1, seed);
    float c111 = kaloDeformLattice(ix + 1, iy + 1, iz + 1, seed);
    float x00 = c000 + (c100 - c000) * fx;
    float x10 = c010 + (c110 - c010) * fx;
    float x01 = c001 + (c101 - c001) * fx;
    float x11 = c011 + (c111 - c011) * fx;
    float y0 = x00 + (x10 - x00) * fy;
    float y1 = x01 + (x11 - x01) * fy;
    return y0 + (y1 - y0) * fz;
  }
  float kaloDeformFractal(vec3 p, int seed) {
    float a = kaloDeformNoise3(p, seed);
    float b = kaloDeformNoise3(p * 2.13 + vec3(5.2, 1.3, 2.8), seed + 77);
    return a * 0.667 + b * 0.333;
  }
  float kaloDeformBernstein(float degree, float i, float u) {
    float c = degree == 1.0 ? 1.0 : degree == 2.0 ? (i == 1.0 ? 2.0 : 1.0) : (i == 0.0 || i == 3.0 ? 1.0 : 3.0);
    return c * pow(u, i) * pow(1.0 - u, degree - i);
  }
${ffdFetch}  vec3 kaloDeformApply(vec3 p) {
    for (int i = 0; i < ${DEFORM_MAX_OPS}; i++) {
      if (i >= uDeformOpCount) break;
      vec4 a = uDeformOps[i * ${DEFORM_VEC4_PER_OP}];
      vec4 b = uDeformOps[i * ${DEFORM_VEC4_PER_OP} + 1];
      vec4 c = uDeformOps[i * ${DEFORM_VEC4_PER_OP} + 2];
      int kind = int(a.x + 0.5);
      int axis = int(a.y + 0.5);
      if (kind == 3) {
        // noise: the Form Fractal Field at the point's
        // current coordinates (the TS twin's sample form).
        vec3 np = p * c.x + vec3(c.y, c.y * 0.7, -c.y * 0.4);
        p += vec3(
          kaloDeformFractal(np, 11),
          kaloDeformFractal(np, 47),
          kaloDeformFractal(np, 83)) * a.w * 0.5;
        continue;
      }
${ffdBranch}      vec3 center = b.xyz;
      vec3 q = p - center;
      if (kind == 0) {
        // bend
        float t = kaloDeformCoord(q, axis);
        float add = a.w * t * t;
        int dir = int(a.z + 0.5);
        if (dir == 0) q.x += add;
        else if (dir == 2) q.z += add;
        else q.y += add;
      } else if (kind == 1) {
        // twist
        float angle = a.w * kaloDeformCoord(q, axis);
        if (angle != 0.0) q = kaloDeformRotateAxis(q, axis, angle);
      } else if (kind == 2) {
        // taper
        float t = kaloDeformCoord(q, axis) / b.w;
        float factor = max(0.0, 1.0 + a.w * t);
        if (factor != 1.0) {
          if (axis == 0) q = vec3(q.x, q.y * factor, q.z * factor);
          else if (axis == 2) q = vec3(q.x * factor, q.y * factor, q.z);
          else q = vec3(q.x * factor, q.y, q.z * factor);
        }
      }
      p = q + center;
    }
    return p;
  }
`;
}

/**
 * Apply the resolved stack to one point, in list order. Pure:
 * no RNG, no state. An empty stack returns the point exactly.
 */
export function applyDeformOps(
  ops: readonly DeformOp[],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  let px = x;
  let py = y;
  let pz = z;
  for (const op of ops) {
    if (op.op === 'ffd') {
      [px, py, pz] = applyFfd(op, px, py, pz);
      continue;
    }
    if (op.op === 'noise') {
      const freq = op.frequency;
      const evo = op.evolution;
      const nx = px * freq + evo;
      const ny = py * freq + evo * 0.7;
      const nz = pz * freq - evo * 0.4;
      px += formFractalNoise(nx, ny, nz, 11) * op.amount * 0.5;
      py += formFractalNoise(nx, ny, nz, 47) * op.amount * 0.5;
      pz += formFractalNoise(nx, ny, nz, 83) * op.amount * 0.5;
      continue;
    }
    const ai = AXIS_INDEX[op.axis];
    const q: [number, number, number] = [px - op.center[0], py - op.center[1], pz - op.center[2]];
    if (op.op === 'bend') {
      const t = q[ai];
      q[AXIS_INDEX[op.dir]] += op.amount * t * t;
    } else if (op.op === 'twist') {
      const angle = op.amount * q[ai];
      if (angle !== 0) {
        const r = rotateAroundAxis({ x: q[0], y: q[1], z: q[2] }, op.axis, angle);
        q[0] = r.x;
        q[1] = r.y;
        q[2] = r.z;
      }
    } else {
      // taper
      const t = q[ai] / op.range;
      const factor = Math.max(0, 1 + op.amount * t);
      if (factor !== 1) {
        for (let a = 0; a < 3; a++) {
          if (a !== ai) q[a] *= factor;
        }
      }
    }
    px = q[0] + op.center[0];
    py = q[1] + op.center[1];
    pz = q[2] + op.center[2];
  }
  return [px, py, pz];
}
