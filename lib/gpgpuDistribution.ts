// Distribution operator layer (Grammar 2.0 stage 2, slice B5).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §3 B5 — a layer
// of fixed operators that TRANSFORM a distribution, stacked
// on top of the E1 shape law (lib/gpgpuEmitShapes.ts, which
// is not modified). The layer is a pure function of the
// placed point and the emitter radius, so the bake and the
// respawn apply the SAME layer in the SAME position of their
// pipelines:
//
//   bake:    shape sample → distribution → (path / cloud
//            override) → emitter transform → mask gate
//   respawn: placement law → distribution → emitter
//            transform (the mask variant applies it to each
//            shape-law candidate before the transform fold)
//
// Operators (authored as a JSON list in gpgpuEmitDistribution,
// applied in list order):
//   power    {a: exponent}  radial bias: |p| → R·(|p|/R)^a
//   invert   {}             radial inversion: |p| → R − |p|
//   stratify {a: bands}     radial strata: |p| snaps to band
//                           centres over [0, R]
//   cluster  {a: sectors, b: strength}
//                           azimuth snaps toward sector
//                           centres, mixed by strength
//
// Identity discipline: the key defaults to '' (no layer).
// Resolution drops identity operators (power 1, stratify
// ≤ 1 band, cluster strength 0), so a config whose layer
// resolves to nothing takes NO variant anywhere — the bake
// arrays and the position shader string stay bit-identical
// to the legacy ones.
//
// The layer acts on the placed point in emitter space
// (around the origin, over the bounce radius) for every
// shape, including 'light' (whose ball sits around the
// light position): bake and respawn agree by construction,
// which is the shape law's own discipline.

export type DistOpKind = 'power' | 'invert' | 'stratify' | 'cluster';

export interface DistOp {
  op: DistOpKind;
  /** power: exponent. stratify: bands. cluster: sectors. */
  a: number;
  /** cluster: strength 0..1. Unused by the others. */
  b: number;
}

/** Operator ids as consumed by the shader's uDistOps. */
export const DIST_OP_IDS: Record<DistOpKind, number> = {
  power: 0,
  invert: 1,
  stratify: 2,
  cluster: 3,
};

/** The layer is capped at 8 operators (the uniform's size). */
export const DIST_MAX_OPS = 8;

const DIST_KINDS: ReadonlySet<string> = new Set(['power', 'invert', 'stratify', 'cluster']);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Parse and sanitise the authored JSON list. Anything
 * unusable (non-JSON, non-array, unknown op, non-finite
 * parameters) resolves toward identity: unknown entries are
 * dropped, parameters are clamped, identity operators are
 * removed. The result is the layer both routes consume.
 */
export function parseDistributionOps(raw: string | null | undefined): DistOp[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const ops: DistOp[] = [];
  for (const entry of parsed) {
    if (ops.length >= DIST_MAX_OPS) break;
    if (!entry || typeof entry !== 'object') continue;
    const kind = (entry as { op?: unknown }).op;
    if (typeof kind !== 'string' || !DIST_KINDS.has(kind)) continue;
    const aIn = finiteOr((entry as { a?: unknown }).a, NaN);
    const bIn = finiteOr((entry as { b?: unknown }).b, NaN);
    if (kind === 'power') {
      const exponent = clamp(Number.isFinite(aIn) ? aIn : 1, 0.05, 20);
      if (exponent === 1) continue;
      ops.push({ op: 'power', a: exponent, b: 0 });
    } else if (kind === 'invert') {
      ops.push({ op: 'invert', a: 0, b: 0 });
    } else if (kind === 'stratify') {
      const bands = Math.floor(Number.isFinite(aIn) ? aIn : 0);
      if (bands < 2) continue;
      ops.push({ op: 'stratify', a: Math.min(bands, 64), b: 0 });
    } else {
      // cluster
      const sectors = Math.floor(Number.isFinite(aIn) ? aIn : 0);
      const strength = clamp(Number.isFinite(bIn) ? bIn : 0, 0, 1);
      if (sectors < 2 || strength <= 0) continue;
      ops.push({ op: 'cluster', a: Math.min(sectors, 64), b: strength });
    }
  }
  return ops;
}

/** Config slice the layer reads. */
export interface DistributionConfig {
  gpgpuEmitDistribution?: string;
}

/** The resolved layer for a config (memo-free pure read). */
export function resolveDistributionOps(config: DistributionConfig): DistOp[] {
  return parseDistributionOps(config.gpgpuEmitDistribution ?? '');
}

/** True while a config's layer has any effective operator. */
export function distributionActive(config: DistributionConfig): boolean {
  return resolveDistributionOps(config).length > 0;
}

/**
 * JS twin of the GLSL layer. Applies the operators in list
 * order to (x, y, z) around the origin over `radius`.
 * Mirrors DIST_GLSL term for term.
 */
export function applyDistributionOps(
  ops: readonly DistOp[],
  x: number,
  y: number,
  z: number,
  radius: number,
): [number, number, number] {
  if (ops.length === 0 || !(radius > 0)) return [x, y, z];
  let px = x;
  let py = y;
  let pz = z;
  for (const op of ops) {
    if (op.op === 'cluster') {
      // Azimuth snap in the XZ plane.
      const theta = Math.atan2(pz, px);
      const step = (Math.PI * 2) / op.a;
      const snapped = (Math.floor(theta / step + 0.5)) * step;
      const delta = (snapped - theta) * op.b;
      if (delta !== 0) {
        const cos = Math.cos(delta);
        const sin = Math.sin(delta);
        const nx = px * cos - pz * sin;
        const nz = px * sin + pz * cos;
        px = nx;
        pz = nz;
      }
      continue;
    }
    const len = Math.sqrt(px * px + py * py + pz * pz);
    if (!(len > 1e-9)) continue;
    let newLen = len;
    if (op.op === 'power') {
      newLen = radius * Math.pow(len / radius, op.a);
    } else if (op.op === 'invert') {
      newLen = radius - len;
    } else {
      // stratify
      const u = clamp(len / radius, 0, 1);
      newLen = radius * ((Math.floor(u * op.a) + 0.5) / op.a);
    }
    const scale = newLen / len;
    px *= scale;
    py *= scale;
    pz *= scale;
  }
  return [px, py, pz];
}

/** Pack the layer into the uDistOps uniform layout:
 * DIST_MAX_OPS × [opId, a, b, 0] as flat numbers. */
export function packDistributionOps(ops: readonly DistOp[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < DIST_MAX_OPS; i++) {
    const op = ops[i];
    out.push(op ? DIST_OP_IDS[op.op] : 0, op ? op.a : 0, op ? op.b : 0, 0);
  }
  return out;
}

/**
 * GLSL twin of applyDistributionOps. Reads the layer from
 * the uDistOps / uDistOpCount uniforms the position variant
 * declares alongside it (POS_FRAG_DIST_UNIFORMS in
 * components/gpgpuShaderSimulationPosition.ts). The formulas
 * mirror the JS twin term for term.
 */
export const DIST_GLSL = /* glsl */ `
vec3 kaloDistApply(vec3 p, float radius) {
  if (radius <= 0.0) return p;
  for (int i = 0; i < ${DIST_MAX_OPS}; i++) {
    if (i >= uDistOpCount) break;
    vec4 opv = uDistOps[i];
    int kind = int(opv.x + 0.5);
    if (kind == 3) {
      // cluster: azimuth snap in the XZ plane
      float theta = atan(p.z, p.x);
      float step = 6.2831853 / opv.y;
      float snapped = floor(theta / step + 0.5) * step;
      float delta = (snapped - theta) * opv.z;
      if (delta != 0.0) {
        float c = cos(delta);
        float s = sin(delta);
        p = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
      }
      continue;
    }
    float len = length(p);
    if (len <= 1e-9) continue;
    float newLen = len;
    if (kind == 0) {
      // power
      newLen = radius * pow(len / radius, opv.y);
    } else if (kind == 1) {
      // invert
      newLen = radius - len;
    } else {
      // stratify
      float u = clamp(len / radius, 0.0, 1.0);
      newLen = radius * ((floor(u * opv.y) + 0.5) / opv.y);
    }
    p *= newLen / len;
  }
  return p;
}
`;
