/**
 * Bake v2.1 compressed format — standalone Phase 2A/2B unit.
 *
 * Design source: kalokagathia-pro/expanded-ruler/
 * gemini-upgrade-design-4areas-full.md, area 2 (esp. 2.3.3
 * compression spec and the preregistered gate 2 in 2.5).
 * Record: kalokagathia-pro/BAKE_V21_PHASE2AB_RECORD.md.
 *
 * Position in the family: v2.1 is NOT a new format family. It
 * is the v2 manifest (statecache-manifest-v2, version 2) plus
 * an OPTIONAL `encoding` block and `formatVersion: "2.1"`.
 * - A manifest WITHOUT `encoding` is a plain v2 file and must
 *   be read by the v2 reader (lib/gpgpuStateCacheV2.ts),
 *   bit-exact, exactly as before. This module refuses to
 *   decode it as v2.1 and says so (parseBakeV21Manifest
 *   returns kind 'v2-legacy').
 * - A manifest WITH `encoding` stores COMPRESSED frame bytes.
 *   Its frameHashes are FNV-1a over the compressed stored
 *   bytes (the hash domain is the stored frame, the same
 *   discipline v2 uses for validCount thinning). Decoding is
 *   LOSSY by design; the accuracy budget is gate 2 of the
 *   design (see BAKE_V21_GATE2 below), never bit-exactness.
 *
 * validCount thinning (v2 A-5) composes unchanged: every
 * channel stores only the leading `validCount ?? count`
 * particles, and decode restores count-wide arrays with the
 * v2 parked-tail convention (positions (0,-99999,0),
 * velocities / scalar columns zero, orientations identity).
 * The tail is convention, not recovered data — same wording
 * as v2.
 *
 * Channel budget (per stored particle per frame):
 *   position    aabb-u16x3          6 B
 *   orientation smallest-three-u48  6 B  (DEFAULT; u32 = 4 B
 *                                        size-priority option,
 *                                        absent if no channel)
 *   velocity    f16x3               6 B  (absent if omitted)
 *   scalar      u16-normalized or f16, 2 B each
 * Full profile (orientation + velocity + 1 scalar) = 20 B
 * with the default u48 orientation (18 B with u32), vs 44 B
 * in v2. Frame payload layout is channel-block order
 * (all positions, then all orientations, then all
 * velocities, then scalar columns in declaration order) —
 * the same block order as v2, so channel-selective reads
 * stay trivial. Bytes are little-endian, unpadded inside a
 * frame; a frame's byte length is bytesPerParticle * stored,
 * which is even; chunk-level 4-byte alignment is a Phase 2C
 * (OPFS chunk) concern and is padded BETWEEN frames there,
 * never inside a frame.
 *
 * Ordering (design 2.3.3 constraint, mandatory in manifest):
 *   ordering: 'id_preserved' | 'morton_sorted'
 * - id_preserved: stored index i is particle id i in every
 *   frame. Retimer per-index interpolation (linear position /
 *   velocity, slerp orientation, as in v2 sampleStateCacheV2)
 *   remains valid.
 * - morton_sorted: EACH FRAME is independently reordered by
 *   the 30-bit Morton code of its quantized positions.
 *   Cross-frame index correspondence is destroyed, so
 *   per-index Retimer interpolation is INVALID. Manifests
 *   with ordering 'morton_sorted' MUST declare
 *   interpolation 'nearest'; this module refuses the
 *   combination morton_sorted + linear at assemble and at
 *   parse time. Trails and any id-keyed attribute semantics
 *   are likewise invalid under morton_sorted.
 *
 * Reserved profiles (declared in the design, NOT implemented
 * in Phase 2B; a manifest naming one is refused, never
 * silently reinterpreted): position 'aabb-u24x3' (pos_24bit)
 * and 'f32x3', velocity 'vmax-i16x3'.
 *
 * MEASURED FINDING + DECISION (Phase 2B; commander decision
 * 2026-11-28, chat 2c38f08f): the design's orientation
 * accuracy claim (~0.0007 rad max, gate line 0.001 rad) does
 * NOT hold for the 32-bit smallest-three profile under the
 * rotation-angle definition 2*acos(|dot|): measured over
 * 100k uniform random quaternions, max 0.002539 rad / mean
 * 0.001446 rad. The claim conflated the quaternion
 * half-angle with the rotation angle (a correction note has
 * been added to the design document itself).
 *
 * DECISION (案1): the gate line is NOT moved. The 48-bit
 * smallest-three profile (2-bit index + 3 x 15-bit
 * components; measured max 0.0000825 rad) is the DEFAULT for
 * oriented bakes. The 32-bit profile remains available as an
 * optional SIZE-PRIORITY profile only: it does not meet the
 * gate 2 line, and every manifest written with it states
 * that in its encoding block (measuredMaxAngleErrorRad +
 * meetsGate2Line: false) so it can never be mistaken for
 * the gate-compliant default.
 */

export const BAKE_FORMAT_VERSION_V21 = '2.1' as const;
export const BAKE_V21_CODEC_VERSION = 1 as const;
/** Measured max rotation-angle error, 100k uniform random
 *  quaternions, Phase 2B (scripts/gate2-result.json). */
export const BAKE_V21_QUAT_U32_MEASURED_MAX_ANGLE_ERROR_RAD = 0.0025385890984914285;
export const BAKE_V21_QUAT_U48_MEASURED_MAX_ANGLE_ERROR_RAD = 0.00008246141582827246;

/** Preregistered accuracy lines, design 2.5 gate 2. The
 *  position line is read as the max ABSOLUTE COMPONENT error
 *  (L-infinity over axes), which is the quantity per-axis
 *  AABB quantization bounds: per axis, rounding to nearest
 *  gives |err| <= 0.5 * extent_axis / 65535 <=
 *  0.5 * max_extent / 65535. The Euclidean norm is reported
 *  in verification as a reference value only. */
export const BAKE_V21_GATE2 = {
  positionMaxComponentErrorFactor: 0.501,
  orientationMaxAngleErrorRad: 0.001,
  /** Applies on the f16 normal domain |v| >= 2^-14 (the
   *  smallest f16 normal). Below that, f16 is subnormal and
   *  relative error is not bounded by the format; such
   *  velocities decode with absolute error <= 2^-25. */
  velocityMaxRelativeError: 1e-3,
  velocityRelativeErrorDomainMin: 2 ** -14,
} as const;

export type BakeV21Ordering = 'id_preserved' | 'morton_sorted';
export type BakeV21ScalarKind = 'u16-normalized' | 'f16';

export interface BakeV21FrameTableEntry {
  /** Per-frame quantization bounds (stored particles only). */
  aabbMin: [number, number, number];
  aabbMax: [number, number, number];
  /** Per scalar channel [min, max] for u16-normalized
   *  channels, in attribute declaration order. Empty when
   *  no u16-normalized scalar is declared. */
  scalarRanges: [number, number][];
}

export interface BakeV21Encoding {
  codecVersion: typeof BAKE_V21_CODEC_VERSION;
  endian: 'little';
  ordering: BakeV21Ordering;
  position: { kind: 'aabb-u16x3'; bits: 16 };
  orientation:
    | {
        kind: 'smallest-three-u32'; componentBits: 10;
        /** Size-priority profile: measured max angle error.
         *  This profile does NOT meet the gate 2 line. */
        measuredMaxAngleErrorRad: typeof BAKE_V21_QUAT_U32_MEASURED_MAX_ANGLE_ERROR_RAD;
        meetsGate2Line: false;
      }
    | {
        kind: 'smallest-three-u48'; componentBits: 15;
        measuredMaxAngleErrorRad: typeof BAKE_V21_QUAT_U48_MEASURED_MAX_ANGLE_ERROR_RAD;
        meetsGate2Line: true;
      }
    | null;
  velocity: { kind: 'f16x3' } | null;
  scalars: { name: string; kind: BakeV21ScalarKind }[];
  bytesPerParticle: number;
  frameTable: BakeV21FrameTableEntry[];
}

export interface BakeV21Manifest {
  format: 'statecache-manifest-v2';
  version: 2;
  formatVersion: typeof BAKE_FORMAT_VERSION_V21;
  fps: number;
  count: number;
  validCount?: number;
  texSize: number;
  frameCount: number;
  startFrame: number;
  loop: boolean;
  interpolation: 'linear' | 'nearest';
  coordinates: { up: string; unit: string };
  attributes: { name: string; components: 1; source: string }[];
  orientation: { encoding: 'smallest-three-u32' | 'smallest-three-u48' } | null;
  provenance: {
    settingsHash: string;
    seed: number;
    generator: string;
    generatorVersion: string;
  };
  encoding: BakeV21Encoding;
  /** FNV-1a over each frame's compressed stored bytes. */
  frameHashes: string[];
}

export interface BakeV21FrameInput {
  /** count x 3 */
  positions: Float32Array;
  /** count x 3 */
  velocities: Float32Array;
  /** Per declared attribute, count x 1. */
  attributes?: Record<string, Float32Array>;
  /** count x 4 (x, y, z, w), normalized. */
  orientations?: Float32Array;
}

export interface BakeV21Decoded {
  manifest: BakeV21Manifest;
  positions: Float32Array[];
  velocities: Float32Array[];
  attrFrames: Float32Array[][];
  orientations: Float32Array[] | null;
}

export type BakeV21Result =
  | { ok: true; manifest: BakeV21Manifest; binary: ArrayBuffer }
  | { ok: false; error: string };

export type BakeV21DecodeResult =
  | { ok: true; decoded: BakeV21Decoded }
  | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/* ---------------- hashing (same FNV-1a as v1/v2) -------- */

export function fnv1aBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8);
}

/* ---------------- float16 -------------------------------- */

const f32View = new DataView(new ArrayBuffer(4));

/** float32 -> IEEE 754 binary16 bits. Round-to-nearest-even.
 *  Overflow saturates to Inf (same as GPU f16 conversion);
 *  NaN stays NaN. */
export function float32ToFloat16Bits(value: number): number {
  f32View.setFloat32(0, value);
  const x = f32View.getUint32(0);
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 112; // rebiased for half
  const frac = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) {
    // Inf / NaN
    return sign | 0x7c00 | (frac !== 0 ? 0x0200 : 0);
  }
  if (exp >= 31) return sign | 0x7c00; // overflow -> Inf
  if (exp <= 0) {
    // Subnormal half or zero.
    if (exp < -10) return sign; // underflow to zero
    const m = frac | 0x800000;
    const shift = 14 - exp;
    let half = m >> shift;
    const rem = m & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1) === 1)) half += 1;
    return sign | half;
  }
  let half = (exp << 10) | (frac >> 13);
  const rem = frac & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1) === 1)) half += 1;
  return sign | half;
}

/** IEEE 754 binary16 bits -> float32 (exact). */
export function float16BitsToFloat32(bits: number): number {
  const sign = (bits & 0x8000) !== 0 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 2 ** -24; // subnormal / zero
  if (exp === 31) return frac === 0 ? sign * Infinity : NaN;
  return sign * (1 + frac / 1024) * 2 ** (exp - 15);
}

/* ---------------- position: AABB u16 x3 ------------------- */

export interface EncodedPositions {
  aabbMin: [number, number, number];
  aabbMax: [number, number, number];
  data: Uint16Array; // stored x 3
}

export function encodePositionsAabbU16(
  positions: Float32Array,
  stored: number,
): EncodedPositions {
  const aabbMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const aabbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < stored; i++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i * 3 + a];
      if (v < aabbMin[a]) aabbMin[a] = v;
      if (v > aabbMax[a]) aabbMax[a] = v;
    }
  }
  const data = new Uint16Array(stored * 3);
  for (let i = 0; i < stored; i++) {
    for (let a = 0; a < 3; a++) {
      const extent = aabbMax[a] - aabbMin[a];
      const t = extent > 0 ? (positions[i * 3 + a] - aabbMin[a]) / extent : 0;
      data[i * 3 + a] = Math.round(Math.min(1, Math.max(0, t)) * 65535);
    }
  }
  return { aabbMin, aabbMax, data };
}

export function decodePositionsAabbU16(
  enc: EncodedPositions,
  stored: number,
): Float32Array {
  const out = new Float32Array(stored * 3);
  for (let i = 0; i < stored; i++) {
    for (let a = 0; a < 3; a++) {
      const extent = enc.aabbMax[a] - enc.aabbMin[a];
      out[i * 3 + a] = enc.aabbMin[a] + (enc.data[i * 3 + a] / 65535) * extent;
    }
  }
  return out;
}

/* ---------------- orientation: Smallest-Three u32 -------- */

const SQRT1_2 = Math.SQRT1_2; // 0.7071067811865476

function packSmallestThreeComponent(c: number, bits = 10): number {
  const levels = (1 << bits) - 1;
  const t = (c + SQRT1_2) / (2 * SQRT1_2);
  return Math.round(Math.min(1, Math.max(0, t)) * levels);
}
function unpackSmallestThreeComponent(u: number, bits = 10): number {
  const levels = (1 << bits) - 1;
  return (u / levels) * 2 * SQRT1_2 - SQRT1_2;
}

function reconstructQuat(
  maxIndex: number,
  others: [number, number, number],
): [number, number, number, number] {
  const q: [number, number, number, number] = [0, 0, 0, 0];
  let sum = 0;
  let k = 0;
  for (let i = 0; i < 4; i++) {
    if (i === maxIndex) continue;
    q[i] = others[k++];
    sum += q[i] * q[i];
  }
  q[maxIndex] = Math.sqrt(Math.max(0, 1 - sum));
  return q;
}

/**
 * Encode a normalized quaternion (x, y, z, w) into u32.
 *
 * Bit layout follows the detail spec (commander ruling
 * 2026-11-29): the largest-component index sits at the TOP
 * bits, and the three stored components run a, b, c from
 * high to low:
 *   bits [30..31] = index of the largest-|component| (made
 *                   positive by negating the whole quaternion
 *                   when needed)
 *   bits [20..29] = a, bits [10..19] = b, bits [0..9] = c,
 *                   each mapped from [-sqrt(1/2), +sqrt(1/2)]
 *                   to [0, 1023].
 * The 48-bit profile applies the same principle at 15 bits
 * per component: spare bit [47] = 0, index at bits [45..46],
 * a at [30..44], b at [15..29], c at [0..14].
 *
 * The encoder searches the 3^3 neighbourhood of the rounded
 * codes and keeps the candidate with the largest dot product
 * against the source. This is a plain encoder-side
 * optimisation (the bit format is unchanged) and brings the
 * worst-case angle error well under the naive-rounding bound
 * (sqrt(3) * step/2), which by itself could exceed the
 * 0.001 rad gate line.
 */
function encodeSmallestThreeBits(
  bits: number,
  x0: number, y0: number, z0: number, w0: number,
): number {
  const maxCode = (1 << bits) - 1;
  let q: [number, number, number, number] = [x0, y0, z0, w0];
  let maxIndex = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[maxIndex])) maxIndex = i;
  if (q[maxIndex] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
  const others: number[] = [];
  for (let i = 0; i < 4; i++) if (i !== maxIndex) others.push(q[i]);
  const base = others.map((c) => packSmallestThreeComponent(c, bits));
  let best: [number, number, number] = [base[0], base[1], base[2]];
  let bestDot = -Infinity;
  for (let da = -1; da <= 1; da++) {
    for (let db = -1; db <= 1; db++) {
      for (let dc = -1; dc <= 1; dc++) {
        const cand: [number, number, number] = [
          Math.min(maxCode, Math.max(0, base[0] + da)),
          Math.min(maxCode, Math.max(0, base[1] + db)),
          Math.min(maxCode, Math.max(0, base[2] + dc)),
        ];
        const rec = reconstructQuat(maxIndex, [
          unpackSmallestThreeComponent(cand[0], bits),
          unpackSmallestThreeComponent(cand[1], bits),
          unpackSmallestThreeComponent(cand[2], bits),
        ]);
        const dot = rec[0] * q[0] + rec[1] * q[1] + rec[2] * q[2] + rec[3] * q[3];
        if (dot > bestDot) { bestDot = dot; best = cand; }
      }
    }
  }
  // Layout (detail-spec principle): index at the top
  // (bits [3*bits .. 3*bits+1]), then a, b, c descending:
  // a at [2*bits], b at [bits], c at [0]. For bits=15 the
  // value uses 47 bits, which a JS number holds exactly
  // (< 2^53); serialisation writes it as three little-endian
  // u16 words with the top spare bit zero.
  return maxIndex * 2 ** (3 * bits) + best[0] * 2 ** (2 * bits) + best[1] * 2 ** bits + best[2];
}

export function encodeQuatSmallestThree(
  x0: number, y0: number, z0: number, w0: number,
): number {
  return encodeSmallestThreeBits(10, x0, y0, z0, w0);
}

/** 48-bit high-precision profile (the default): spare bit
 *  [47] = 0, index at bits [45..46], then 3 x 15-bit
 *  components a [30..44], b [15..29], c [0..14] — the
 *  detail-spec layout principle applied at 15 bits. */
export function encodeQuatSmallestThree48(
  x0: number, y0: number, z0: number, w0: number,
): number {
  return encodeSmallestThreeBits(15, x0, y0, z0, w0);
}

function decodeSmallestThreeBits(
  bits: number, packed: number,
): [number, number, number, number] {
  const maxCode = (1 << bits) - 1;
  const maxIndex = Math.floor(packed / 2 ** (3 * bits)) % 4;
  const c0 = Math.floor(packed / 2 ** (2 * bits)) % (maxCode + 1);
  const c1 = Math.floor(packed / 2 ** bits) % (maxCode + 1);
  const c2 = packed % (maxCode + 1);
  return reconstructQuat(maxIndex, [
    unpackSmallestThreeComponent(c0, bits),
    unpackSmallestThreeComponent(c1, bits),
    unpackSmallestThreeComponent(c2, bits),
  ]);
}

export function decodeQuatSmallestThree(
  packed: number,
): [number, number, number, number] {
  return decodeSmallestThreeBits(10, packed);
}

export function decodeQuatSmallestThree48(
  packed: number,
): [number, number, number, number] {
  return decodeSmallestThreeBits(15, packed);
}

/** Angle between two unit quaternions, 2*acos(|dot|), rad. */
export function quatAngleBetween(
  a: readonly number[], b: readonly number[],
): number {
  const dot = Math.min(1, Math.abs(
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3],
  ));
  return 2 * Math.acos(dot);
}

/* ---------------- Morton ordering ------------------------- */

/** 30-bit Morton code from the top 10 bits of each quantized
 *  axis (design 2.3.3). */
export function morton30FromQuantized(qx: number, qy: number, qz: number): number {
  const spread = (v: number): number => {
    let x = v & 0x3ff;
    x = (x | (x << 16)) & 0x030000ff;
    x = (x | (x << 8)) & 0x0300f00f;
    x = (x | (x << 4)) & 0x030c30c3;
    x = (x | (x << 2)) & 0x09249249;
    return x;
  };
  return (spread(qx >> 6) | (spread(qy >> 6) << 1) | (spread(qz >> 6) << 2)) >>> 0;
}

/** Permutation that sorts stored particles by Morton code of
 *  their quantized positions (stable for equal codes). */
export function mortonSortPermutation(encPos: EncodedPositions, stored: number): Uint32Array {
  const codes = new Uint32Array(stored);
  for (let i = 0; i < stored; i++) {
    codes[i] = morton30FromQuantized(
      encPos.data[i * 3], encPos.data[i * 3 + 1], encPos.data[i * 3 + 2],
    );
  }
  const perm = new Uint32Array(stored);
  for (let i = 0; i < stored; i++) perm[i] = i;
  perm.sort((a, b) => (codes[a] - codes[b]) || (a - b));
  return perm;
}

/* ---------------- assemble / parse / decode --------------- */

export type BakeV21OrientationProfile = 'smallest-three-u32' | 'smallest-three-u48';

export function bakeV21OrientationBytes(profile: BakeV21OrientationProfile | null | undefined): number {
  if (profile === 'smallest-three-u32') return 4;
  if (profile === 'smallest-three-u48') return 6;
  return 0;
}

export function bakeV21BytesPerParticle(args: {
  orientationBytes: number;
  includeVelocity: boolean;
  scalarCount: number;
}): number {
  return 6 + args.orientationBytes + (args.includeVelocity ? 6 : 0) + 2 * args.scalarCount;
}

export function assembleBakeV21(args: {
  fps: number;
  texSize: number;
  frames: BakeV21FrameInput[];
  attributeDecls?: { name: string; components: 1; source: string }[];
  scalarKinds?: Record<string, BakeV21ScalarKind>;
  orientationProfile?: BakeV21OrientationProfile;
  includeVelocity?: boolean;
  ordering?: BakeV21Ordering;
  provenance: BakeV21Manifest['provenance'];
  validCount?: number;
  startFrame?: number;
  loop?: boolean;
  interpolation?: 'linear' | 'nearest';
}): BakeV21Result {
  const attributeDecls = args.attributeDecls ?? [];
  const ordering = args.ordering ?? 'id_preserved';
  const includeVelocity = args.includeVelocity ?? true;
  const interpolation = args.interpolation ?? 'linear';
  if (ordering === 'morton_sorted' && interpolation !== 'nearest') {
    return fail('ordering "morton_sorted" ではフレーム間の粒子対応が壊れるため、interpolation は "nearest" が必須です。"linear" との組み合わせは受理しません。');
  }
  if (!Number.isFinite(args.fps) || args.fps <= 0) return fail('fps は 0 より大きい数値が必要です。');
  if (!Number.isInteger(args.texSize) || args.texSize <= 0) return fail('texSize は 1 以上の整数が必要です。');
  const count = args.texSize * args.texSize;
  let stored = count;
  if (args.validCount !== undefined) {
    if (!Number.isInteger(args.validCount) || args.validCount < 1 || args.validCount > count) {
      return fail(`validCount は 1..${count} の整数が必要です（${String(args.validCount)}）。`);
    }
    stored = args.validCount;
  }
  if (args.frames.length === 0) return fail('フレームがありません。');
  const hasOrientation = args.frames[0].orientations !== undefined;
  const scalars = attributeDecls.map((d) => ({
    name: d.name,
    kind: (args.scalarKinds?.[d.name] ?? 'f16') as BakeV21ScalarKind,
  }));
  // Default is u48 (commander decision 2026-11-28, 案1): the
  // gate 2 line stays where it was registered, and u48 is
  // the profile that meets it. u32 is opt-in size-priority.
  const orientationProfile: BakeV21OrientationProfile = args.orientationProfile ?? 'smallest-three-u48';
  const orientationBytes = hasOrientation ? bakeV21OrientationBytes(orientationProfile) : 0;
  const bytesPerParticle = bakeV21BytesPerParticle({
    orientationBytes, includeVelocity, scalarCount: scalars.length,
  });
  const frameTable: BakeV21FrameTableEntry[] = [];
  const frameHashes: string[] = [];
  const bytes = new Uint8Array(bytesPerParticle * stored * args.frames.length);
  const view = new DataView(bytes.buffer);

  for (let f = 0; f < args.frames.length; f++) {
    const frame = args.frames[f];
    if (frame.positions.length !== count * 3 || frame.velocities.length !== count * 3) {
      return fail(`フレーム ${f} の位置／速度バッファ長が粒子数と一致しません。`);
    }
    if ((frame.orientations !== undefined) !== hasOrientation) {
      return fail(`フレーム ${f} の姿勢チャンネルの有無がフレーム 0 と一致しません。一部フレームだけの姿勢は補完しません。`);
    }
    if (frame.orientations && frame.orientations.length !== count * 4) {
      return fail(`フレーム ${f} の姿勢バッファ長が粒子数と一致しません。`);
    }
    for (const d of attributeDecls) {
      const col = frame.attributes?.[d.name];
      if (!col || col.length !== count) {
        return fail(`フレーム ${f} の属性 "${d.name}" が無いか長さが一致しません。宣言された属性は補完しません。`);
      }
    }
    // Quantize positions first (Morton codes derive from them).
    const encPos = encodePositionsAabbU16(frame.positions, stored);
    const perm = ordering === 'morton_sorted'
      ? mortonSortPermutation(encPos, stored)
      : null;
    const order = (i: number): number => (perm ? perm[i] : i);

    let o = f * bytesPerParticle * stored;
    // Position block.
    for (let s = 0; s < stored; s++) {
      const i = order(s);
      for (let a = 0; a < 3; a++) {
        view.setUint16(o, encPos.data[i * 3 + a], true); o += 2;
      }
    }
    // Orientation block.
    if (hasOrientation) {
      for (let s = 0; s < stored; s++) {
        const i = order(s);
        const q = frame.orientations!;
        if (orientationProfile === 'smallest-three-u32') {
          view.setUint32(o, encodeQuatSmallestThree(
            q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3],
          ), true); o += 4;
        } else {
          const packed = encodeQuatSmallestThree48(
            q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3],
          );
          view.setUint16(o, packed % 65536, true);
          view.setUint16(o + 2, Math.floor(packed / 65536) % 65536, true);
          view.setUint16(o + 4, Math.floor(packed / 2 ** 32) % 65536, true);
          o += 6;
        }
      }
    }
    // Velocity block.
    if (includeVelocity) {
      for (let s = 0; s < stored; s++) {
        const i = order(s);
        for (let a = 0; a < 3; a++) {
          view.setUint16(o, float32ToFloat16Bits(frame.velocities[i * 3 + a]), true); o += 2;
        }
      }
    }
    // Scalar blocks, with per-frame ranges for u16 channels.
    const scalarRanges: [number, number][] = [];
    for (let c = 0; c < scalars.length; c++) {
      const col = frame.attributes![scalars[c].name];
      if (scalars[c].kind === 'u16-normalized') {
        let mn = Infinity; let mx = -Infinity;
        for (let s = 0; s < stored; s++) {
          const v = col[order(s)];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        scalarRanges.push([mn, mx]);
        for (let s = 0; s < stored; s++) {
          const v = col[order(s)];
          const t = mx > mn ? (v - mn) / (mx - mn) : 0;
          view.setUint16(o, Math.round(Math.min(1, Math.max(0, t)) * 65535), true); o += 2;
        }
      } else {
        for (let s = 0; s < stored; s++) {
          view.setUint16(o, float32ToFloat16Bits(col[order(s)]), true); o += 2;
        }
      }
    }
    frameTable.push({ aabbMin: encPos.aabbMin, aabbMax: encPos.aabbMax, scalarRanges });
    frameHashes.push(fnv1aBytes(bytes.subarray(
      f * bytesPerParticle * stored, (f + 1) * bytesPerParticle * stored,
    )));
  }

  const manifest: BakeV21Manifest = {
    format: 'statecache-manifest-v2',
    version: 2,
    formatVersion: BAKE_FORMAT_VERSION_V21,
    fps: args.fps,
    count,
    ...(stored < count ? { validCount: stored } : {}),
    texSize: args.texSize,
    frameCount: args.frames.length,
    startFrame: args.startFrame ?? 0,
    loop: args.loop ?? true,
    interpolation,
    coordinates: { up: 'y', unit: 'm' },
    attributes: attributeDecls.map((d) => ({ ...d })),
    orientation: hasOrientation ? { encoding: orientationProfile } : null,
    provenance: { ...args.provenance },
    encoding: {
      codecVersion: BAKE_V21_CODEC_VERSION,
      endian: 'little',
      ordering,
      position: { kind: 'aabb-u16x3', bits: 16 },
      orientation: hasOrientation
        ? (orientationProfile === 'smallest-three-u32'
          ? {
              kind: 'smallest-three-u32', componentBits: 10,
              measuredMaxAngleErrorRad: BAKE_V21_QUAT_U32_MEASURED_MAX_ANGLE_ERROR_RAD,
              meetsGate2Line: false,
            }
          : {
              kind: 'smallest-three-u48', componentBits: 15,
              measuredMaxAngleErrorRad: BAKE_V21_QUAT_U48_MEASURED_MAX_ANGLE_ERROR_RAD,
              meetsGate2Line: true,
            })
        : null,
      velocity: includeVelocity ? { kind: 'f16x3' } : null,
      scalars,
      bytesPerParticle,
      frameTable,
    },
    frameHashes,
  };
  return { ok: true, manifest, binary: bytes.buffer as ArrayBuffer };
}

/**
 * Parse a manifest that MIGHT be v2.1. Three outcomes:
 * - { kind: 'v21', manifest }: encoding block present and
 *   valid; decode with decodeBakeV21.
 * - { kind: 'v2-legacy' }: no encoding block — a plain v2 (or
 *   v1) file. The caller MUST hand it to the v2 reader; this
 *   is the Phase 2A backward-compatibility contract.
 * - { kind: 'error', error }: malformed or an unsupported
 *   (reserved) profile. Refused, never reinterpreted.
 */
export function parseBakeV21Manifest(text: string):
  | { kind: 'v21'; manifest: BakeV21Manifest }
  | { kind: 'v2-legacy' }
  | { kind: 'error'; error: string } {
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; } catch {
    return { kind: 'error', error: 'マニフェストを JSON として読めませんでした。' };
  }
  if (!raw || typeof raw !== 'object') {
    return { kind: 'error', error: 'マニフェストが JSON オブジェクトではありません。' };
  }
  const m = raw as Record<string, unknown>;
  if (m.encoding === undefined || m.encoding === null) return { kind: 'v2-legacy' };
  if (m.format !== 'statecache-manifest-v2' || m.version !== 2) {
    return { kind: 'error', error: 'v2.1 は statecache-manifest-v2 / version 2 の拡張です。基底形式が一致しません。' };
  }
  if (m.formatVersion !== BAKE_FORMAT_VERSION_V21) {
    return { kind: 'error', error: `encoding がある場合 formatVersion は "${BAKE_FORMAT_VERSION_V21}" が必要です（"${String(m.formatVersion)}"）。` };
  }
  const enc = m.encoding as Record<string, unknown>;
  if (enc.codecVersion !== BAKE_V21_CODEC_VERSION) {
    return { kind: 'error', error: `未知の codecVersion です（${String(enc.codecVersion)}）。補完せず拒否します。` };
  }
  if (enc.endian !== 'little') {
    return { kind: 'error', error: 'encoding.endian は "little" のみ対応します。' };
  }
  const ordering = enc.ordering;
  if (ordering !== 'id_preserved' && ordering !== 'morton_sorted') {
    return { kind: 'error', error: 'encoding.ordering の明記が必須です（"id_preserved" | "morton_sorted"）。' };
  }
  const interpolation = m.interpolation === undefined ? 'linear' : m.interpolation;
  if (ordering === 'morton_sorted' && interpolation !== 'nearest') {
    return { kind: 'error', error: 'ordering "morton_sorted" と interpolation "linear" の組み合わせは受理しません（フレーム間対応が無いため）。' };
  }
  const pos = enc.position as Record<string, unknown> | undefined;
  if (!pos || pos.kind !== 'aabb-u16x3') {
    return { kind: 'error', error: `position.kind "${String(pos?.kind)}" は Phase 2B では未実装の予約プロファイルです。読み替えず拒否します。` };
  }
  const ori = enc.orientation as Record<string, unknown> | null | undefined;
  if (ori !== null && ori !== undefined
    && ori.kind !== 'smallest-three-u32' && ori.kind !== 'smallest-three-u48') {
    return { kind: 'error', error: `orientation.kind "${String(ori.kind)}" は未実装の予約プロファイルです。拒否します。` };
  }
  // Anti-mislabeling guard: a u32 manifest must not claim to
  // meet the gate 2 line, and the measured error must be the
  // recorded one. A manifest that overstates its accuracy is
  // refused, not reinterpreted.
  if (ori && ori.kind === 'smallest-three-u32') {
    if (ori.meetsGate2Line !== false
      || ori.measuredMaxAngleErrorRad !== BAKE_V21_QUAT_U32_MEASURED_MAX_ANGLE_ERROR_RAD) {
      return { kind: 'error', error: 'u32 姿勢プロファイルのマニフェストには、実測最大誤差（0.002539 rad）と meetsGate2Line: false の明記が必須です。精度を過大に表示するマニフェストは受理しません。' };
    }
  }
  if (ori && ori.kind === 'smallest-three-u48') {
    if (ori.meetsGate2Line !== true
      || ori.measuredMaxAngleErrorRad !== BAKE_V21_QUAT_U48_MEASURED_MAX_ANGLE_ERROR_RAD) {
      return { kind: 'error', error: 'u48 姿勢プロファイルのマニフェストの精度表示が実測記録と一致しません。受理しません。' };
    }
  }
  const vel = enc.velocity as Record<string, unknown> | null | undefined;
  if (vel !== null && vel !== undefined && vel.kind !== 'f16x3') {
    return { kind: 'error', error: `velocity.kind "${String(vel.kind)}" は未実装の予約プロファイルです。拒否します。` };
  }
  const manifest = raw as unknown as BakeV21Manifest;
  const expectBpp = bakeV21BytesPerParticle({
    orientationBytes: bakeV21OrientationBytes(
      ori ? (ori.kind as BakeV21OrientationProfile) : null,
    ),
    includeVelocity: !!enc.velocity,
    scalarCount: Array.isArray(enc.scalars) ? enc.scalars.length : 0,
  });
  if (enc.bytesPerParticle !== expectBpp) {
    return { kind: 'error', error: `encoding.bytesPerParticle (${String(enc.bytesPerParticle)}) がチャンネル構成からの算出値 (${expectBpp}) と一致しません。` };
  }
  if (!Array.isArray(enc.frameTable) || enc.frameTable.length !== manifest.frameCount) {
    return { kind: 'error', error: 'encoding.frameTable が frameCount と一致しません。フレームごとの AABB が無い圧縮フレームは復元できません。' };
  }
  return { kind: 'v21', manifest };
}

const PARKED: [number, number, number] = [0, -99999, 0];

export function decodeBakeV21(manifest: BakeV21Manifest, buffer: ArrayBuffer): BakeV21DecodeResult {
  const enc = manifest.encoding;
  const stored = manifest.validCount ?? manifest.count;
  const { count, frameCount } = manifest;
  const frameBytes = enc.bytesPerParticle * stored;
  if (buffer.byteLength !== frameBytes * frameCount) {
    return fail(`バイナリのバイト長が一致しません（${buffer.byteLength}、期待 ${frameBytes * frameCount}）。`);
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const positions: Float32Array[] = [];
  const velocities: Float32Array[] = [];
  const attrFrames: Float32Array[][] = manifest.attributes.map(() => []);
  const orientations: Float32Array[] | null = manifest.orientation ? [] : null;

  for (let f = 0; f < frameCount; f++) {
    const base = f * frameBytes;
    if (fnv1aBytes(bytes.subarray(base, base + frameBytes)) !== manifest.frameHashes[f]) {
      return fail(`フレーム ${f} のハッシュが一致しません（圧縮バイト列が壊れているか、マニフェストと対応していません）。`);
    }
    const table = enc.frameTable[f];
    let o = base;
    const posStored = new Float32Array(stored * 3);
    for (let s = 0; s < stored; s++) {
      for (let a = 0; a < 3; a++) {
        const q = view.getUint16(o, true); o += 2;
        const extent = table.aabbMax[a] - table.aabbMin[a];
        posStored[s * 3 + a] = table.aabbMin[a] + (q / 65535) * extent;
      }
    }
    let oriStored: Float32Array | null = null;
    if (manifest.orientation) {
      oriStored = new Float32Array(stored * 4);
      const is48 = manifest.orientation.encoding === 'smallest-three-u48';
      for (let s = 0; s < stored; s++) {
        let q: [number, number, number, number];
        if (is48) {
          const packed = view.getUint16(o, true)
            + view.getUint16(o + 2, true) * 65536
            + view.getUint16(o + 4, true) * 2 ** 32;
          q = decodeQuatSmallestThree48(packed); o += 6;
        } else {
          q = decodeQuatSmallestThree(view.getUint32(o, true)); o += 4;
        }
        oriStored.set(q, s * 4);
      }
    }
    const velStored = new Float32Array(stored * 3);
    if (enc.velocity) {
      for (let s = 0; s < stored; s++) {
        for (let a = 0; a < 3; a++) {
          velStored[s * 3 + a] = float16BitsToFloat32(view.getUint16(o, true)); o += 2;
        }
      }
    }
    const colsStored: Float32Array[] = [];
    for (let c = 0; c < enc.scalars.length; c++) {
      const col = new Float32Array(stored);
      const range = table.scalarRanges[c];
      for (let s = 0; s < stored; s++) {
        const rawBits = view.getUint16(o, true); o += 2;
        col[s] = enc.scalars[c].kind === 'u16-normalized'
          ? range[0] + (rawBits / 65535) * (range[1] - range[0])
          : float16BitsToFloat32(rawBits);
      }
      colsStored.push(col);
    }
    // Restore count-wide with the v2 parked-tail convention.
    const expand = (
      src: Float32Array, per: number,
      fill?: (out: Float32Array, i: number) => void,
    ): Float32Array => {
      if (stored === count) return src;
      const out = new Float32Array(count * per);
      out.set(src);
      if (fill) for (let i = stored; i < count; i++) fill(out, i);
      return out;
    };
    positions.push(expand(posStored, 3, (out, i) => {
      out[i * 3] = PARKED[0]; out[i * 3 + 1] = PARKED[1]; out[i * 3 + 2] = PARKED[2];
    }));
    velocities.push(expand(velStored, 3));
    for (let c = 0; c < colsStored.length; c++) {
      attrFrames[c].push(expand(colsStored[c], 1));
    }
    if (orientations && oriStored) {
      orientations.push(expand(oriStored, 4, (out, i) => { out[i * 4 + 3] = 1; }));
    }
  }
  return { ok: true, decoded: { manifest, positions, velocities, attrFrames, orientations } };
}
