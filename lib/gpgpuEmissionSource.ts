// Emission sources (Grammar 2.0 stage 2, slice E3).
//
// Design: kalokagathia-pro/STAGE2_DESIGN.md §2 E3.
//
// Until this slice, every (re)birth in the main pool was placed
// by the analytic emit-shape law (lib/gpgpuEmitShapes.ts) — the
// shapes were the only emission sources. E3 widens the source
// vocabulary along the design's asset-reuse line: NO new asset
// route is built for emission. Instead, assets that already
// exist for other purposes are drawn at birth:
//
//   'morph'  — the morph target's sample cloud. The cloud the
//              morph force pulls particles TOWARD is sampled
//              as the placement itself; formation and emission
//              become two uses of one cloud ("drawn at birth"
//              vs "drawn as a target"). Object / text / image /
//              svg / terrain morph targets all become emission
//              sources through this one selector.
//   'bitmap' — a sample cloud built from the layer-2 media
//              luma map by the CPU layer sampler's placement
//              law, ported here verbatim (components/
//              particleData.ts sampleFromMediaMap) so the
//              bitmap cloud is a bake asset on par with the
//              morph clouds.
//   'path'   — the steering path polyline (the authored point
//              list of the gpgpuSteerSeekPath key, parsed by
//              lib/steering.ts parseSteeringPath — the SAME
//              asset Path Follow consumes as a force). Births
//              land on the polyline by arc length; the bake's
//              initial velocity runs along the tangent.
//
// 'shape' (the default) is the legacy law; while it holds and
// the emission mask is off, every array and shader string is
// the shipped one. The mask gate (gpgpuEmitMaskEnabled) opens
// the Phase X raster mask supply to emission accept/reject on
// top of any source: at bake time the config mask grid is
// consulted through lib/layerMask.ts (the morph bake's own
// supply — vector sources reach it as a bake-time raster,
// never interpreted at runtime); in the respawn shader the
// mask texture is consulted with the kill mask's UV rule.

import type { ParticleConfig } from '../types';
import { maskAcceptsAt, maskLumaAt, resolveActiveMask } from './layerMask';
import type { RasterMaskMap, RasterMaskOptions } from './layerMask';
import { STEERING_PATH_MAX } from './steering';
import type { Vec3Like } from './steering';
import { pathAssetExtended, resolvePathAsset } from './gpgpuPathAssets';

export type GpgpuEmissionSourceKind = 'shape' | 'morph' | 'bitmap' | 'path';

type EmissionConfig = Pick<ParticleConfig,
  | 'gpgpuEmitSource' | 'gpgpuEmitBitmapThreshold' | 'gpgpuEmitBitmapDepth' | 'gpgpuEmitBitmapInvert'
  | 'gpgpuEmitPathSpeed' | 'gpgpuEmitMaskEnabled'
  | 'gpgpuSteerSeekPath' | 'gpgpuSteerSeekPaths' | 'gpgpuSteerSeekPathSvg'
  | 'gpgpuSteerSeekPathSvgScale' | 'gpgpuSteerSeekPathSlot'
  | 'gpgpuMaskMap' | 'gpgpuMaskMapWidth' | 'gpgpuMaskMapHeight'
  | 'gpgpuMaskMode' | 'gpgpuMaskThreshold' | 'gpgpuMaskInvert'>;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** The config's emission source kind (unknown values = 'shape'). */
export function resolveEmissionSourceKind(config: Pick<ParticleConfig, 'gpgpuEmitSource'>): GpgpuEmissionSourceKind {
  const kind = config.gpgpuEmitSource ?? 'shape';
  return kind === 'morph' || kind === 'bitmap' || kind === 'path' ? kind : 'shape';
}

/** True while any non-legacy emission source is selected. */
export function emissionSourceActive(config: Pick<ParticleConfig, 'gpgpuEmitSource'>): boolean {
  return resolveEmissionSourceKind(config) !== 'shape';
}

/** True while the source draws placements from a sample cloud
 * texture (morph / bitmap) — the respawn variant and the cloud
 * texture supply key off this. */
export function emissionCloudActive(config: Pick<ParticleConfig, 'gpgpuEmitSource'>): boolean {
  const kind = resolveEmissionSourceKind(config);
  return kind === 'morph' || kind === 'bitmap';
}

/** Bitmap cloud parameters, resolved from the keys with the
 * CPU sampler's clamps (threshold [0,1], depth [0,2]). */
export function resolveBitmapEmission(config: Pick<ParticleConfig, 'gpgpuEmitBitmapThreshold' | 'gpgpuEmitBitmapDepth' | 'gpgpuEmitBitmapInvert'>): {
  threshold: number;
  depth: number;
  invert: boolean;
} {
  return {
    threshold: Math.max(0, Math.min(1, finiteOr(config.gpgpuEmitBitmapThreshold ?? 0.45, 0.45))),
    depth: Math.max(0, Math.min(2, finiteOr(config.gpgpuEmitBitmapDepth ?? 0.65, 0.65))),
    invert: !!config.gpgpuEmitBitmapInvert,
  };
}

/** Path emission speed clamp (the emitter velocity range). */
export function clampEmitPathSpeed(v: number): number {
  if (!Number.isFinite(v)) return 6;
  return Math.max(0, Math.min(50, v));
}

// ---------------------------------------------------------------------------
// Path asset (shared with Path Follow): arc-length table + sampler

export interface EmissionPathResolved {
  /** The authored points: asset path 0 of lib/gpgpuPathAssets.ts
   *  (the legacy steering string's points while no extended
   *  source is authored — parseSteeringPath output, ≤ 8). */
  points: Vec3Like[];
  /** Cumulative arc length at each point (cum[0] = 0). */
  cum: number[];
  /** Total polyline length (> 0). */
  total: number;
  /** Bake initial speed along the tangent (0 = legacy velocity). */
  speed: number;
}

/** Arc-length table for a point list: cum[i] is the length of
 * the polyline up to point i. Pure; degenerate (zero-length)
 * segments contribute 0 and are skipped by the sampler. */
export function buildPathArcTable(points: readonly Vec3Like[]): { cum: number[]; total: number } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
      points[i].z - points[i - 1].z,
    );
    cum.push(total);
  }
  return { cum, total };
}

/**
 * Sample the polyline at arc parameter u ∈ [0, 1]: the point at
 * arc length u * total, plus the segment's unit tangent (the
 * last non-degenerate segment's direction at the ends). The
 * GLSL twin (EMIT_PATH_GLSL) walks the same table with the same
 * expressions, so the bake and the respawn place identically
 * for the same u.
 */
export function samplePathAt(
  points: readonly Vec3Like[],
  cum: readonly number[],
  total: number,
  u: number,
): { pos: Vec3Like; tangent: Vec3Like } {
  const first = points[0] ?? { x: 0, y: 0, z: 0 };
  if (points.length < 2 || !(total > 0)) {
    return { pos: { ...first }, tangent: { x: 1, y: 0, z: 0 } };
  }
  const target = Math.max(0, Math.min(1, u)) * total;
  let seg = 0;
  while (seg < points.length - 2 && cum[seg + 1] < target) seg += 1;
  // Skip zero-length segments forward (their interval is empty);
  // the walk above can only land on one at an exact boundary.
  while (seg < points.length - 2 && cum[seg + 1] <= cum[seg]) seg += 1;
  const a = points[seg];
  const b = points[seg + 1];
  const segLen = cum[seg + 1] - cum[seg];
  const f = segLen > 0 ? (target - cum[seg]) / segLen : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  const tangent = len > 0
    ? { x: dx / len, y: dy / len, z: dz / len }
    : { x: 1, y: 0, z: 0 };
  return {
    pos: { x: a.x + dx * f, y: a.y + dy * f, z: a.z + dz * f },
    tangent,
  };
}

/**
 * Resolve the path emission asset for a config: the authored
 * steering path (≥ 2 points, positive total length) plus the
 * speed key. Null while the source is not 'path' or the path
 * cannot emit — every consumer then falls back to the legacy
 * shape placement, so a stale path key can never break a scene.
 */
export function resolveEmissionPath(config: EmissionConfig): EmissionPathResolved | null {
  if (resolveEmissionSourceKind(config) !== 'path') return null;
  // Stage 2, B2: the emission path is asset path 0 of the
  // shared path asset (lib/gpgpuPathAssets.ts) — the legacy
  // steering string while nothing extended is authored, so
  // the legacy resolution is reproduced point for point; an
  // extended asset feeds the bake its full point list.
  const asset = resolvePathAsset(config);
  const first = asset.paths[0];
  if (!first || first.points.length < 2) return null;
  const points = first.points;
  const { cum, total } = buildPathArcTable(points);
  if (!(total > 0)) return null;
  return { points, cum, total, speed: clampEmitPathSpeed(config.gpgpuEmitPathSpeed ?? 6) };
}

/** True while path emission is in play (variant + bake gate). */
export function emissionPathActive(config: EmissionConfig): boolean {
  return resolveEmissionPath(config) !== null;
}

/** True while path emission runs over an EXTENDED path asset
 *  (stage 2, B2): the respawn placement then reads the shared
 *  column-data texture instead of the uniform arrays, which
 *  stay in charge for the legacy asset. */
export function emissionPathAssetActive(config: EmissionConfig): boolean {
  return emissionPathActive(config) && pathAssetExtended(config);
}

/** The cumulative table padded to the uniform array size
 * (entries past the point count repeat the total). */
export function packEmissionPathCum(resolved: EmissionPathResolved): number[] {
  const out: number[] = [];
  for (let i = 0; i < STEERING_PATH_MAX; i++) {
    out.push(i < resolved.cum.length ? resolved.cum[i] : resolved.total);
  }
  return out;
}

/**
 * GLSL twin of samplePathAt's position half: walks the same
 * cumulative table (uEmitPathCum, padded with the total) over
 * the shared point array. Declared only in the path variant of
 * the position fragment; the uniforms ride alongside.
 */
export const EMIT_PATH_GLSL = /* glsl */ `
  // Path emission (Grammar 2.0 stage 2, E3): the JS twin is
  // samplePathAt in lib/gpgpuEmissionSource.ts — same table
  // walk, same segment expressions.
  vec3 kaloEmitPathPos(float u) {
    float target = clamp(u, 0.0, 1.0) * uEmitPathCum[${STEERING_PATH_MAX - 1}];
    int seg = 0;
    for (int i = 0; i < ${STEERING_PATH_MAX - 1}; i++) {
      if (i >= uEmitPathCount - 1) break;
      if (uEmitPathCum[i + 1] < target) seg = i + 1;
    }
    vec3 a = uEmitPath[seg];
    vec3 b = uEmitPath[seg + 1];
    float segLen = uEmitPathCum[seg + 1] - uEmitPathCum[seg];
    float f = segLen > 0.0 ? (target - uEmitPathCum[seg]) / segLen : 0.0;
    return a + (b - a) * f;
  }
`;

// ---------------------------------------------------------------------------
// Bitmap sample cloud: the CPU layer sampler's law, ported

/**
 * The hash of components/particleData.ts, copied verbatim —
 * the bitmap cloud is a port of that sampler, so its draws
 * must be the same function (stage-2 rule: commonising random
 * sources never changes their values).
 */
export function bitmapHash(n: number): number {
  n = Math.imul(n ^ (n >>> 15), 0x5deb38b3);
  n = Math.imul(n ^ (n >>> 15), 0x4a4f9b17);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/**
 * One sample of the CPU media placement law (components/
 * particleData.ts sampleFromMediaMap, verbatim): up to 12
 * rejection attempts over the luma map; a kept pixel returns
 * its normalized position (x right, y up, in [-1, 1]) and its
 * (possibly inverted) luma. Null when no attempt clears the
 * threshold — the caller falls back exactly like the CPU
 * sampler's caller does (a flat random placement).
 */
export function sampleBitmapPoint(
  map: ArrayLike<number> | undefined,
  width: number,
  height: number,
  threshold: number,
  invert: boolean,
  seed: number,
): { x: number; y: number; luma: number } | null {
  if (!map || width <= 0 || height <= 0 || map.length < width * height) return null;
  const attempts = 12;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const ru = bitmapHash(seed + attempt * 11 + 101);
    const rv = bitmapHash(seed + attempt * 11 + 102);
    const x = Math.min(width - 1, Math.floor(ru * width));
    const y = Math.min(height - 1, Math.floor(rv * height));
    const idx = y * width + x;
    const raw = map[idx] ?? 0;
    const luma = invert ? 1 - raw : raw;
    if (luma >= threshold) {
      return {
        x: width <= 1 ? 0 : (x / (width - 1)) * 2 - 1,
        y: height <= 1 ? 0 : 1 - (y / (height - 1)) * 2,
        luma,
      };
    }
  }
  return null;
}

export interface BitmapEmissionCloudOptions {
  map: ArrayLike<number> | undefined;
  width: number;
  height: number;
  threshold: number;
  depth: number;
  invert: boolean;
  /** Cloud size (the pool's texSize²). */
  count: number;
  /** Base seed (config gpgpuSeed); per-particle seeds derive
   * from it in the CPU sampler's style (index * 97 family). */
  seed: number;
  /** World-units multiplier for the normalized cloud — the
   * caller passes the morph media framing (morphScale *
   * bounceRadius * 0.48) so bitmap and morph-image clouds
   * frame alike. */
  worldScale: number;
}

/**
 * Build the bitmap emission cloud: an RGBA float array of
 * `count` points in world units, in the morph cloud's layout
 * (xyz + alpha 1), so the respawn samples it through the same
 * texture contract as the morph cloud. Placement per particle
 * is the CPU law: x = sample.x, z = sample.y (the map's up
 * axis becomes world -z..+z as in particleData's pz), and the
 * relief y = (luma - 0.5) * 2 * depth — all scaled by
 * worldScale. Deterministic for a given options set.
 */
export function buildBitmapEmissionCloud(options: BitmapEmissionCloudOptions): Float32Array {
  const { map, width, height, threshold, depth, invert, count, seed, worldScale } = options;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const pSeed = seed * 1000003 + i * 97 + 12345;
    const sample = sampleBitmapPoint(map, width, height, threshold, invert, pSeed);
    if (sample) {
      out[i * 4] = sample.x * worldScale;
      out[i * 4 + 1] = (sample.luma - 0.5) * 2 * depth * worldScale;
      out[i * 4 + 2] = sample.y * worldScale;
    } else {
      // Blank-map fallback (the CPU sampler's): a flat random
      // placement in the map plane.
      out[i * 4] = (bitmapHash(pSeed + 201) * 2 - 1) * worldScale;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = (bitmapHash(pSeed + 202) * 2 - 1) * worldScale;
    }
    out[i * 4 + 3] = 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Emission mask (bake side): the Phase X raster mask supply

/** The config's raster mask as the bake resolves it (the
 * morph bake's morphMaskOption discipline): null while the
 * mode is off or no usable grid is stored. */
export function resolveEmissionMaskMap(config: EmissionConfig): (RasterMaskMap & RasterMaskOptions) | null {
  if (!config.gpgpuEmitMaskEnabled) return null;
  if (config.gpgpuMaskMode === 'off') return null;
  if (!config.gpgpuMaskMap || config.gpgpuMaskMap.length === 0) return null;
  if (!(config.gpgpuMaskMapWidth > 0) || !(config.gpgpuMaskMapHeight > 0)) return null;
  return resolveActiveMask(
    { map: config.gpgpuMaskMap, width: config.gpgpuMaskMapWidth, height: config.gpgpuMaskMapHeight },
    { mode: config.gpgpuMaskMode, threshold: config.gpgpuMaskThreshold, invert: config.gpgpuMaskInvert },
  );
}

/** True while the emission mask gate is live on the bake side
 * (key on AND a usable mask grid). The shader side resolves
 * its half against the mask texture per frame. */
export function emissionMaskActive(config: EmissionConfig): boolean {
  return resolveEmissionMaskMap(config) !== null;
}

/** True while the respawn shader needs the mask variant: the
 * key is on and a mask source is authored (the texture itself
 * is resolved per frame; without one the uniform stays off). */
export function emissionMaskVariantActive(config: Pick<ParticleConfig, 'gpgpuEmitMaskEnabled' | 'gpgpuMaskSource'>): boolean {
  return !!config.gpgpuEmitMaskEnabled && !!config.gpgpuMaskSource;
}

/**
 * The bake-side mask predicate over normalized [-1, 1] XY,
 * following the CPU sampler's mask filter discipline: 'clip'
 * accepts on the threshold test (maskAcceptsAt); 'shape'
 * accepts with probability equal to the luminance (the caller
 * supplies the roll). Null while no mask is live.
 */
export function buildEmissionMaskPredicate(
  config: EmissionConfig,
): ((x: number, y: number, roll: number) => boolean) | null {
  const mask = resolveEmissionMaskMap(config);
  if (!mask) return null;
  if (mask.mode === 'clip') {
    return (x, y) => maskAcceptsAt(mask, x, y);
  }
  return (x, y, roll) => roll <= maskLumaAt(mask, x, y, mask.invert);
}

/** The morph text font the bake rasterises with (E3): the
 * dedicated key wins; '' falls back to the layer-2 TextMap
 * family — the legacy source. */
export function resolveMorphTextFont(config: Pick<ParticleConfig, 'gpgpuMorphTextFont' | 'layer2TextMapFontFamily'>): string {
  return config.gpgpuMorphTextFont || config.layer2TextMapFontFamily;
}
