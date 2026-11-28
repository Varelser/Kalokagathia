/**
 * Path assets (Grammar 2.0 stage 2, slice B2 — design:
 * kalokagathia-pro/STAGE2_DESIGN.md §1 decision 2 and §3 B2).
 *
 * Path Follow used to be a single coordinate string read by
 * the steering chunk through a fixed 8-point uniform array
 * (lib/steering.ts, STEERING_PATH_MAX = 8). This module turns
 * the path into a first-class ASSET: an ordered list of named
 * polylines, each with its own point list (up to 64 points)
 * and an optional closed-loop flag, authored three ways and
 * resolved through this single point:
 *
 *   1. the legacy steering string (gpgpuSteerSeekPath) —
 *      asset path 0, exactly the points parseSteeringPath
 *      returns today, so a legacy-only config resolves to the
 *      same single open path it always had;
 *   2. a JSON list (gpgpuSteerSeekPaths): an array of
 *      { name?, points: [[x,y,z], ...] | "x,y,z;...",
 *        closed?: boolean } — the gpgpuFieldInstances
 *      serialised-list discipline (tolerant parse, malformed
 *      entries skipped, never a throw);
 *   3. an authored SVG document (gpgpuSteerSeekPathSvg):
 *      parsed by lib/pathGeometry.ts (the morph system's
 *      authored-path view of the same document), each subpath
 *      sampled by arc length into a polyline and mapped from
 *      normalised morph space to world space by
 *      gpgpuSteerSeekPathSvgScale (z = 0 plane).
 *
 * Composition order is legacy, then JSON, then SVG, capped at
 * PATH_ASSET_MAX_PATHS paths in total. The asset is EXTENDED
 * whenever it differs from the legacy single open ≤8-point
 * path (a JSON or SVG source contributed, more than one path,
 * any path closed, any path over 8 points). A non-extended
 * asset changes nothing anywhere: steering keeps the uniform
 * array, emission keeps its uniform supply, the WGSL twins
 * keep working. An extended asset is supplied through the
 * shared COLUMN-DATA texture (design decision 2): this module
 * appends two sections after B1's (pathHeaders / pathPoints)
 * in a wider layout — the allocator is append-only, so the
 * fields / layers offsets never move, and the combined supply
 * below packs fields and paths into ONE texture (one sampler
 * serves both variants).
 *
 * Per-particle path selection follows the crowd-lane
 * discipline (lib/steering.ts crowdLaneIndex): while
 * gpgpuSteerSeekPathSlot names an attribute slot (0..3), the
 * particle's slot value picks its path; at -1 (the default)
 * every particle follows path 0. The Path Follow force and
 * the E3 emission source read the same asset (emission uses
 * path 0), so a path authored once drives both.
 *
 * Everything here is inert while the asset is not extended:
 * no variant is built, no texture is created, and every
 * shader string stays byte-identical to the legacy one.
 */
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  parseSteeringPath,
  pathFollowTarget,
  resolveCrowd,
  resolveSteeringSeek,
  STEER_SEEK_MODE_IDS,
  type Vec3Like,
} from './steering';
import { parseSvgPathGeometry, pointAtArcLength } from './pathGeometry';
import {
  buildColumnLayout,
  columnSectionOffset,
  fieldGroupGateActive,
  fieldInstancesExtended,
  packFieldColumnData,
  packFieldExtColumnData,
  resolveFieldInstances,
  COLUMN_TEX_WIDTH,
  FIELD_COLUMN_LAYOUT,
  FIELD_EXT_TEXELS_PER_INSTANCE,
  FIELD_INSTANCE_MAX,
  FIELD_LAYER_EXT_TEXELS,
  FIELD_LAYER_MAX,
  type ColumnLayout,
  type ColumnSectionRequest,
  type FieldInstancesResolution,
} from './gpgpuFieldInstances';
import {
  PATH_ASSET_MAX_PATHS,
  PATH_ASSET_MAX_POINTS,
  PATH_ASSET_COLUMN_LAYOUT,
} from './gpgpuColumnLayout';
import {
  emitterListActive,
  packEmitterColumnData,
  resolveEmitterList,
  EMITTER_COLUMN_LAYOUT,
  EMITTER_COLUMN_REQUESTS,
  type EmitterListConfigSlice,
} from './gpgpuEmitterList';
import {
  deformColumnActive,
  packDeformFfdPoints,
  resolveConfigDeformOps,
  DEFORM_FFD_MAX_TEXELS,
  type DeformConfig,
} from './gpgpuDeformStack';

export {
  PATH_ASSET_MAX_PATHS,
  PATH_ASSET_MAX_POINTS,
  PATH_ASSET_COLUMN_LAYOUT,
  PATH_COLUMN_REQUESTS,
} from './gpgpuColumnLayout';

/** Arc-length samples taken from each SVG subpath. */
export const PATH_ASSET_SVG_SAMPLES = 32;

export interface PathAssetPath {
  name: string;
  points: Vec3Like[];
  closed: boolean;
  /** Cumulative arc length of the OPEN polyline (cum[0] = 0). */
  cum: number[];
  /** Total length of the open polyline. */
  total: number;
}

export interface PathAssetResolution {
  paths: PathAssetPath[];
  /** The resolved selection slot: 0..3, or -1 for path 0. */
  slot: number;
  /** True while the asset differs from the legacy single
   *  open ≤8-point path (see the header note). */
  extended: boolean;
  /** True while at least one usable path exists. */
  active: boolean;
}

export type PathAssetConfigSlice = Pick<ParticleConfig,
  | 'gpgpuSteerSeekPath' | 'gpgpuSteerSeekPaths' | 'gpgpuSteerSeekPathSvg'
  | 'gpgpuSteerSeekPathSvgScale' | 'gpgpuSteerSeekPathSlot'>;

type FieldConfigSlice = Pick<ParticleConfig, 'gpgpuFieldInstances' | 'gpgpuFieldLayers'>;
export type ColumnConfigSlice = PathAssetConfigSlice & FieldConfigSlice & EmitterListConfigSlice
  & { gpgpuGroupsData?: string } & DeformConfig;

const clampNum = (v: number, lo: number, hi: number, fallback: number): number =>
  (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

/** Arc-length table for a point list — the same expressions
 *  as buildPathArcTable in lib/gpgpuEmissionSource.ts (kept
 *  local so this module never imports the emission module;
 *  the emission resolution reads the table from here). */
export function buildAssetArcTable(points: readonly Vec3Like[]): { cum: number[]; total: number } {
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

function makePath(name: string, points: Vec3Like[], closed: boolean): PathAssetPath {
  const { cum, total } = buildAssetArcTable(points);
  return { name, points, closed, cum, total };
}

/**
 * Parse one authored point list WITHOUT the legacy 8-point
 * cap: either an array of [x, y, z] triples (y-only pairs
 * read z = 0) or the steering string form ("x,y,z;...").
 * Non-finite components reject the point; the result is
 * capped at PATH_ASSET_MAX_POINTS.
 */
export function parsePathAssetPoints(raw: unknown): Vec3Like[] {
  const out: Vec3Like[] = [];
  const push = (x: number, y: number, z: number) => {
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      out.push({ x, y, z });
    }
  };
  if (typeof raw === 'string') {
    for (const entry of raw.split(';')) {
      if (out.length >= PATH_ASSET_MAX_POINTS) break;
      const parts = entry.split(',').map((s) => Number(s.trim()));
      if (parts.length < 2 || parts.length > 3) continue;
      push(parts[0], parts[1], parts.length === 3 ? parts[2] : 0);
    }
    return out;
  }
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (out.length >= PATH_ASSET_MAX_POINTS) break;
      if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) continue;
      push(Number(entry[0]), Number(entry[1]), entry.length === 3 ? Number(entry[2]) : 0);
    }
  }
  return out;
}

/** Tolerant parse of the JSON path list key (the field
 *  instances discipline: unknown shapes skipped, bad data
 *  resolves to fewer paths, never a throw). */
export function parsePathAssetDefs(data: string | undefined): PathAssetPath[] {
  if (!data) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: PathAssetPath[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    const points = parsePathAssetPoints(d.points);
    if (points.length === 0) continue;
    out.push(makePath(
      typeof d.name === 'string' && d.name.length > 0 ? d.name.slice(0, 80) : '',
      points,
      d.closed === true,
    ));
  }
  return out;
}

/**
 * The SVG connection: parse the authored document with the
 * morph system's path view and sample each subpath by arc
 * length into a steering polyline. Open subpaths are sampled
 * endpoint-to-endpoint; closed subpaths wrap (the first point
 * is not duplicated). Points land in the z = 0 plane, scaled
 * from normalised morph space by `scale`.
 */
export function pathAssetPathsFromSvg(svgText: string | undefined, scale: number): PathAssetPath[] {
  if (!svgText) return [];
  const geom = parseSvgPathGeometry(svgText);
  if (!geom) return [];
  const s = Number.isFinite(scale) && scale > 0 ? scale : 100;
  const out: PathAssetPath[] = [];
  geom.subpaths.forEach((sub, index) => {
    if (!(sub.length > 0)) return;
    const count = PATH_ASSET_SVG_SAMPLES;
    const points: Vec3Like[] = [];
    for (let k = 0; k < count; k++) {
      const arc = sub.closed
        ? (sub.length * k) / count
        : count > 1 ? (sub.length * k) / (count - 1) : 0;
      const p = pointAtArcLength(sub, arc);
      points.push({ x: p.x * s, y: p.y * s, z: 0 });
    }
    if (points.length >= 2) {
      out.push(makePath(`svg-${index + 1}`, points, sub.closed));
    }
  });
  return out;
}

let pathAssetCache: { signature: string; resolution: PathAssetResolution } | null = null;

/**
 * The single resolution every consumer shares: compose the
 * asset (legacy, then JSON, then SVG; capped), resolve the
 * selection slot, and decide extended-ness. Extended-ness is
 * the variant gate for the whole slice — a legacy-only asset
 * is NOT extended even though it resolves, so every legacy
 * supply path stays in charge. Memoised on the five key
 * strings (the terrain-cache discipline): the SVG parse is
 * the expensive part and consumers resolve per frame.
 */
export function resolvePathAsset(config: PathAssetConfigSlice): PathAssetResolution {
  const signature = [
    config.gpgpuSteerSeekPath ?? '',
    config.gpgpuSteerSeekPaths ?? '',
    config.gpgpuSteerSeekPathSvg ?? '',
    String(config.gpgpuSteerSeekPathSvgScale ?? ''),
    String(config.gpgpuSteerSeekPathSlot ?? ''),
  ].join('\n');
  if (pathAssetCache && pathAssetCache.signature === signature) return pathAssetCache.resolution;
  const resolution = resolvePathAssetUncached(config);
  pathAssetCache = { signature, resolution };
  return resolution;
}

function resolvePathAssetUncached(config: PathAssetConfigSlice): PathAssetResolution {
  // A path is a polyline: fewer than 2 points cannot be
  // followed or emitted from, so such entries never join the
  // asset (the legacy supplies treat them the same way —
  // E3's emission resolution required >= 2 points too).
  const paths: PathAssetPath[] = [];
  const legacy = parseSteeringPath(config.gpgpuSteerSeekPath);
  if (legacy.length >= 2) paths.push(makePath('steer', legacy, false));
  const jsonPaths = parsePathAssetDefs(config.gpgpuSteerSeekPaths)
    .filter((p) => p.points.length >= 2);
  paths.push(...jsonPaths);
  const svgPaths = pathAssetPathsFromSvg(
    config.gpgpuSteerSeekPathSvg,
    clampNum(config.gpgpuSteerSeekPathSvgScale ?? 100, 0.001, 1e6, 100),
  );
  paths.push(...svgPaths);
  const capped = paths.slice(0, PATH_ASSET_MAX_PATHS);
  const contributed = jsonPaths.length > 0 || svgPaths.length > 0;
  const extended = capped.length > 0 && (contributed
    || capped.length > 1
    || capped.some((p) => p.closed || p.points.length > 8));
  const slotRaw = Math.round(clampNum(config.gpgpuSteerSeekPathSlot ?? -1, -1, 3, -1));
  return {
    paths: capped,
    slot: slotRaw >= 0 ? slotRaw : -1,
    extended,
    active: capped.length > 0,
  };
}

/** The variant gate: the asset differs from the legacy path. */
export function pathAssetExtended(config: PathAssetConfigSlice): boolean {
  return resolvePathAsset(config).extended;
}

/**
 * The velocity-variant predicate: steering is on in path
 * mode, the crowd variant is NOT in charge, and the asset
 * is extended.
 */
export function steeringPathAssetActive(config: ParticleConfig): boolean {
  const steer = resolveSteeringSeek(config);
  if (!steer.active || steer.modeId !== STEER_SEEK_MODE_IDS.path) return false;
  if (resolveCrowd(config).enabled) return false;
  return pathAssetExtended(config);
}

/**
 * The crowd-asset variant predicate (B2 crowd follow-up):
 * steering is on in path mode, the crowd variant IS in
 * charge, and the asset is extended — the crowd chunk then
 * walks the asset over the column-data texture with its
 * lane grammar unchanged. The two predicates are disjoint
 * by construction (the crowd flag decides which chunk
 * family assembles).
 */
export function steeringCrowdPathAssetActive(config: ParticleConfig): boolean {
  const steer = resolveSteeringSeek(config);
  if (!steer.active || steer.modeId !== STEER_SEEK_MODE_IDS.path) return false;
  if (!resolveCrowd(config).enabled) return false;
  return pathAssetExtended(config);
}

/**
 * Per-particle path selection — the crowdLaneIndex formula
 * generalised to the asset's path count: the slot value,
 * clamped to 0..1 (non-finite reads as 0), picks the path by
 * equal bands. The GLSL twin sits in the asset variant of
 * the 'steer-seek' chunk.
 */
export function pathAssetIndexForSlot(slotValue: number, pathCount: number): number {
  const c = Math.max(1, Math.round(pathCount));
  const s = Number.isFinite(slotValue) ? Math.max(0, Math.min(1, slotValue)) : 0;
  return Math.min(Math.floor(s * c), c - 1);
}

/**
 * The CPU twin of the asset path-follow walk. Open paths
 * delegate to lib/steering.ts pathFollowTarget verbatim (the
 * legacy specification, so the two can never drift); closed
 * paths walk the cyclic segment list and the look-ahead arc
 * wraps around the loop. The GLSL twin in the asset variant
 * of the 'steer-seek' chunk mirrors both forms.
 */
export function pathAssetFollowTarget(
  path: PathAssetPath,
  pos: Vec3Like,
  lookAhead = 0,
): Vec3Like {
  const points = path.points;
  if (points.length === 0) return { ...pos };
  if (points.length === 1) return { ...points[0] };
  if (!path.closed) return pathFollowTarget(points, pos, lookAhead);
  const n = points.length;
  let bestDistSq = Infinity;
  let bestArc = 0;
  let arcBefore = 0;
  const segLens: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const segLen = Math.hypot(abx, aby, abz);
    segLens.push(segLen);
    const lenSq = abx * abx + aby * aby + abz * abz;
    let t = 0;
    if (lenSq > 0) {
      t = ((pos.x - a.x) * abx + (pos.y - a.y) * aby + (pos.z - a.z) * abz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const qx = a.x + abx * t;
    const qy = a.y + aby * t;
    const qz = a.z + abz * t;
    const distSq = (pos.x - qx) ** 2 + (pos.y - qy) ** 2 + (pos.z - qz) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestArc = arcBefore + segLen * t;
    }
    arcBefore += segLen;
  }
  const total = arcBefore;
  if (!(total > 0)) return { ...points[0] };
  let targetArc = (bestArc + Math.max(0, lookAhead)) % total;
  if (targetArc < 0) targetArc += total;
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const segLen = segLens[i];
    if (targetArc <= arc + segLen || i === n - 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      const t = segLen > 0 ? Math.max(0, Math.min(1, (targetArc - arc) / segLen)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    }
    arc += segLen;
  }
  return { ...points[0] };
}

/**
 * GLSL twin of the emission walk over asset path 0: the same
 * cumulative-table walk as EMIT_PATH_GLSL in
 * lib/gpgpuEmissionSource.ts (whose JS side is samplePathAt
 * over the resolved asset path), with the points and their
 * cumulative lengths read from the column texture instead of
 * the uniform arrays. Declared only in the asset variant of
 * the position fragment; it defines the same kaloEmitPathPos
 * name as the legacy twin — the two variants never coexist.
 * uEmitPathBase is the absolute texel index of path 0's
 * first point; the total length is the last point's cum.
 */
export const EMIT_PATH_ASSET_GLSL = /* glsl */ `
  // Path emission over the path asset (Grammar 2.0 stage 2,
  // B2): the JS twin is samplePathAt in
  // lib/gpgpuEmissionSource.ts over asset path 0 — same
  // table walk, same segment expressions.
  vec4 kaloEmitColFetch(float idx) {
    float cx = mod(idx, uEmitColWidth);
    float cy = floor(idx / uEmitColWidth);
    return texture2D(uEmitColTex, vec2((cx + 0.5) / uEmitColWidth, (cy + 0.5) / uEmitColHeight));
  }
  vec3 kaloEmitPathPos(float u) {
    float total = kaloEmitColFetch(uEmitPathBase + float(uEmitPathTexCount - 1)).w;
    float target = clamp(u, 0.0, 1.0) * total;
    int seg = 0;
    for (int i = 0; i < 63; i++) {
      if (i >= uEmitPathTexCount - 1) break;
      if (kaloEmitColFetch(uEmitPathBase + float(i + 1)).w < target) seg = i + 1;
    }
    vec4 ea = kaloEmitColFetch(uEmitPathBase + float(seg));
    vec4 eb = kaloEmitColFetch(uEmitPathBase + float(seg + 1));
    float segLen = eb.w - ea.w;
    float f = segLen > 0.0 ? (target - ea.w) / segLen : 0.0;
    return ea.xyz + (eb.xyz - ea.xyz) * f;
  }
`;

// The layout constants (PATH_COLUMN_REQUESTS /
// PATH_ASSET_COLUMN_LAYOUT / PATH_ASSET_MAX_*) live in the
// leaf module lib/gpgpuColumnLayout.ts — the emitter list
// appends to the same requests, and the combined supply
// below consumes the emitter list, so neither module may
// sit above the other. They are re-exported here so
// existing import paths keep working.

export interface PathColumnPack {
  headersBase: number;
  pointsBase: number;
  pathCount: number;
  /** Each path's first-point offset inside the points section. */
  pathPointOffsets: number[];
}

/** Pack the resolved paths into an existing column data
 *  array laid out by PATH_ASSET_COLUMN_LAYOUT. */
export function packPathColumnData(
  data: Float32Array,
  layout: ColumnLayout,
  resolution: PathAssetResolution,
): PathColumnPack {
  const headersBase = columnSectionOffset(layout, 'pathHeaders');
  const pointsBase = columnSectionOffset(layout, 'pathPoints');
  const pathPointOffsets: number[] = [];
  let cursor = 0;
  resolution.paths.forEach((path, pi) => {
    const h = (headersBase + pi) * 4;
    data[h] = path.points.length;
    data[h + 1] = path.closed ? 1 : 0;
    data[h + 2] = cursor;
    data[h + 3] = 0;
    pathPointOffsets.push(cursor);
    path.points.forEach((pt, pj) => {
      const a = (pointsBase + cursor + pj) * 4;
      data[a] = pt.x;
      data[a + 1] = pt.y;
      data[a + 2] = pt.z;
      data[a + 3] = path.cum[pj] ?? 0;
    });
    cursor += path.points.length;
  });
  return { headersBase, pointsBase, pathCount: resolution.paths.length, pathPointOffsets };
}

// ── Combined THREE supply ────────────────────────────────────
//
// ONE texture serves fields, paths and the emitter list
// (Layer 1 WP4, phase D2): while no path resolves and no
// emitter list stands, the supply IS B1's (the B1 layout,
// byte-identical pack); while paths resolve, the extended
// layout packs both into the taller texture; while an
// emitter list stands (gpgpuEmitters authored with at least
// one enabled element), the emitter layout APPENDS the
// emitters section after the path sections — every existing
// section offset is unchanged — and packs all three into the
// tallest texture. The passes resolve through this getter
// only. Null while no side has content.

export interface ColumnSupply {
  texture: THREE.DataTexture;
  width: number;
  height: number;
  fieldsBase: number;
  layersBase: number;
  instanceCount: number;
  layerCount: number;
  headersBase: number;
  pointsBase: number;
  pathCount: number;
  pathPointOffsets: number[];
  /** Texel offset of the emitters section (1280 while a list
   *  stands, 0 otherwise — the position shader reads it only
   *  in the emitterList variant). */
  emittersBase: number;
  /** Number of enabled emitter elements packed (0 = no list). */
  emitterCount: number;
  /** Texel offset of the fieldExt section (WP5 phase D;
   *  1536 while the extension stands, 0 otherwise — the
   *  velocity shader reads it only in the fieldExt variant). */
  fieldExtBase: number;
  /** Texel offset of the layerExt section (1792 while the
   *  extension stands, 0 otherwise). */
  layerExtBase: number;
  /** Texel offset of the deformFfd section (Layer 1 WP8
   *  phase D; 2048 while a deform stack with an FFD operator
   *  stands, 0 otherwise — the position shader reads it only
   *  in the deform FFD sub-variant). */
  deformFfdBase: number;
}

// The WP5 phase D extension layout: the emitter layout with
// the two field-grammar extension sections appended after the
// emitters (append-only — fields 0, layers 256, pathHeaders
// 512, pathPoints 768, emitters 1280, fieldExt 1536, layerExt
// 1792). The layout stands only while fieldInstancesExtended
// resolves; every other config keeps its existing layout and
// supply bytes.
export const FIELD_EXT_COLUMN_REQUESTS: readonly ColumnSectionRequest[] = [
  ...EMITTER_COLUMN_REQUESTS,
  { id: 'fieldExt', texels: FIELD_INSTANCE_MAX * FIELD_EXT_TEXELS_PER_INSTANCE },
  { id: 'layerExt', texels: FIELD_LAYER_MAX * FIELD_LAYER_EXT_TEXELS },
];

export const FIELD_EXT_COLUMN_LAYOUT: ColumnLayout = buildColumnLayout(FIELD_EXT_COLUMN_REQUESTS);

// The Layer 1 WP8 phase D extension layout: the fieldExt
// layout with the deform stack's FFD section appended after
// layerExt (append-only — fields 0, layers 256, pathHeaders
// 512, pathPoints 768, emitters 1280, fieldExt 1536,
// layerExt 1792, deformFfd 2048). The layout stands only
// while deformColumnActive resolves (the authored deform
// stack carries an FFD operator); every other config keeps
// its existing layout and supply bytes. The section holds
// the FFD control points of packDeformFfdPoints
// (lib/gpgpuDeformStack.ts), read by the position pass's
// deform variant through the packed per-operator offsets.
export const DEFORM_COLUMN_REQUESTS: readonly ColumnSectionRequest[] = [
  ...FIELD_EXT_COLUMN_REQUESTS,
  { id: 'deformFfd', texels: DEFORM_FFD_MAX_TEXELS },
];

export const DEFORM_COLUMN_LAYOUT: ColumnLayout = buildColumnLayout(DEFORM_COLUMN_REQUESTS);

/**
 * Write the deform stack's FFD payload into the column
 * data at the layout's deformFfd section. Returns the
 * section's base texel offset (0 while the layout carries
 * no deformFfd section).
 */
export function packDeformColumnData(
  data: Float32Array,
  layout: ColumnLayout,
  config: DeformConfig,
): { deformFfdBase: number } {
  if (!layout.sections.some((s) => s.id === 'deformFfd')) return { deformFfdBase: 0 };
  const deformFfdBase = columnSectionOffset(layout, 'deformFfd');
  const payload = packDeformFfdPoints(resolveConfigDeformOps(config));
  data.set(payload, deformFfdBase * 4);
  return { deformFfdBase };
}

export { fieldGroupGateActive, fieldInstancesExtended };

let columnSupplyCache: { signature: string; supply: ColumnSupply } | null = null;

export function getColumnSupply(config: ColumnConfigSlice): ColumnSupply | null {
  const fieldRes: FieldInstancesResolution = resolveFieldInstances(config);
  const pathRes = resolvePathAsset(config);
  const listActive = emitterListActive(config);
  const defActive = deformColumnActive(config);
  if (!fieldRes.active && pathRes.paths.length === 0 && !listActive && !defActive) return null;
  const extActive = fieldInstancesExtended(config);
  const signature = [
    config.gpgpuFieldInstances ?? '',
    config.gpgpuFieldLayers ?? '',
    // WP5 phase D: the extension pack normalises group gates
    // out of the group library, so the cache turns over when
    // the library changes.
    config.gpgpuGroupsData ?? '',
    config.gpgpuSteerSeekPath ?? '',
    config.gpgpuSteerSeekPaths ?? '',
    config.gpgpuSteerSeekPathSvg ?? '',
    String(config.gpgpuSteerSeekPathSvgScale ?? ''),
    // The emitter pack derives per-element light weights and
    // positions from the light unit keys, so the cache must
    // turn over when any of them (or the list, or the chosen
    // light unit) changes.
    config.gpgpuEmitters ?? '',
    // WP8 phase D: the deform pack derives from the authored
    // deform stack, so the cache turns over when it changes.
    config.gpgpuEmitDeform ?? '',
    config.gpgpuEmitLightUnit ?? '',
    String(config.gpgpuLightEnabled ?? ''),
    String(config.gpgpuLightPosX ?? ''),
    String(config.gpgpuLightPosY ?? ''),
    String(config.gpgpuLightPosZ ?? ''),
    String(config.gpgpuLightIntensity ?? ''),
    String(config.gpgpuLight2Enabled ?? ''),
    String(config.gpgpuLight2PosX ?? ''),
    String(config.gpgpuLight2PosY ?? ''),
    String(config.gpgpuLight2PosZ ?? ''),
    String(config.gpgpuLight2Intensity ?? ''),
    String(config.gpgpuLight3Enabled ?? ''),
    String(config.gpgpuLight3PosX ?? ''),
    String(config.gpgpuLight3PosY ?? ''),
    String(config.gpgpuLight3PosZ ?? ''),
    String(config.gpgpuLight3Intensity ?? ''),
    String(config.gpgpuLight4Enabled ?? ''),
    String(config.gpgpuLight4PosX ?? ''),
    String(config.gpgpuLight4PosY ?? ''),
    String(config.gpgpuLight4PosZ ?? ''),
    String(config.gpgpuLight4Intensity ?? ''),
  ].join('\n');
  if (columnSupplyCache && columnSupplyCache.signature === signature) return columnSupplyCache.supply;
  let supply: ColumnSupply;
  if (extActive || defActive) {
    // WP5 phase D: the extension layout — every earlier
    // section at its existing offset, the fieldExt / layerExt
    // sections appended after the emitters. This branch
    // subsumes the emitter and path compositions below (the
    // same packs write into the same array).
    // WP8 phase D: while a deform stack with an FFD operator
    // stands, the layout grows the deformFfd section after
    // layerExt (same composition, one more appended pack).
    const layout = defActive ? DEFORM_COLUMN_LAYOUT : FIELD_EXT_COLUMN_LAYOUT;
    const fieldPack = packFieldColumnData(fieldRes, layout);
    const pathPack = pathRes.paths.length > 0
      ? packPathColumnData(fieldPack.data, layout, pathRes)
      : { headersBase: 0, pointsBase: 0, pathCount: 0, pathPointOffsets: [] as number[] };
    const emitterPack = listActive
      ? packEmitterColumnData(fieldPack.data, layout, resolveEmitterList(config))
      : { emittersBase: 0, emitterCount: 0 };
    const extPack = packFieldExtColumnData(fieldPack.data, layout, config);
    const deformPack = defActive
      ? packDeformColumnData(fieldPack.data, layout, config)
      : { deformFfdBase: 0 };
    const texture = new THREE.DataTexture(fieldPack.data, layout.width, layout.height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    supply = {
      texture,
      width: layout.width,
      height: layout.height,
      fieldsBase: fieldPack.fieldsBase,
      layersBase: fieldPack.layersBase,
      instanceCount: fieldPack.instanceCount,
      layerCount: fieldPack.layerCount,
      headersBase: pathPack.headersBase,
      pointsBase: pathPack.pointsBase,
      pathCount: pathPack.pathCount,
      pathPointOffsets: pathPack.pathPointOffsets,
      emittersBase: emitterPack.emittersBase,
      emitterCount: emitterPack.emitterCount,
      fieldExtBase: extPack.fieldExtBase,
      layerExtBase: extPack.layerExtBase,
      deformFfdBase: deformPack.deformFfdBase,
    };
  } else if (listActive) {
    // The emitter layout: fields / layers / pathHeaders /
    // pathPoints keep their path-layout offsets; the
    // emitters section is appended after them.
    const layout = EMITTER_COLUMN_LAYOUT;
    const fieldPack = packFieldColumnData(fieldRes, layout);
    const pathPack = pathRes.paths.length > 0
      ? packPathColumnData(fieldPack.data, layout, pathRes)
      : { headersBase: 0, pointsBase: 0, pathCount: 0, pathPointOffsets: [] as number[] };
    const emitterPack = packEmitterColumnData(fieldPack.data, layout, resolveEmitterList(config));
    const texture = new THREE.DataTexture(fieldPack.data, layout.width, layout.height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    supply = {
      texture,
      width: layout.width,
      height: layout.height,
      fieldsBase: fieldPack.fieldsBase,
      layersBase: fieldPack.layersBase,
      instanceCount: fieldPack.instanceCount,
      layerCount: fieldPack.layerCount,
      headersBase: pathPack.headersBase,
      pointsBase: pathPack.pointsBase,
      pathCount: pathPack.pathCount,
      pathPointOffsets: pathPack.pathPointOffsets,
      emittersBase: emitterPack.emittersBase,
      emitterCount: emitterPack.emitterCount,
      fieldExtBase: 0,
      layerExtBase: 0,
      deformFfdBase: 0,
    };
  } else if (pathRes.paths.length === 0) {
    // B1's supply, byte for byte.
    const pack = packFieldColumnData(fieldRes);
    const texture = new THREE.DataTexture(pack.data, pack.width, pack.height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    supply = {
      texture,
      width: pack.width,
      height: pack.height,
      fieldsBase: pack.fieldsBase,
      layersBase: pack.layersBase,
      instanceCount: pack.instanceCount,
      layerCount: pack.layerCount,
      headersBase: 0,
      pointsBase: 0,
      pathCount: 0,
      pathPointOffsets: [],
      emittersBase: 0,
      emitterCount: 0,
      fieldExtBase: 0,
      layerExtBase: 0,
      deformFfdBase: 0,
    };
  } else {
    const layout = PATH_ASSET_COLUMN_LAYOUT;
    const fieldPack = packFieldColumnData(fieldRes, layout);
    const pathPack = packPathColumnData(fieldPack.data, layout, pathRes);
    const texture = new THREE.DataTexture(fieldPack.data, layout.width, layout.height, THREE.RGBAFormat, THREE.FloatType);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    supply = {
      texture,
      width: layout.width,
      height: layout.height,
      fieldsBase: fieldPack.fieldsBase,
      layersBase: fieldPack.layersBase,
      instanceCount: fieldPack.instanceCount,
      layerCount: fieldPack.layerCount,
      headersBase: pathPack.headersBase,
      pointsBase: pathPack.pointsBase,
      pathCount: pathPack.pathCount,
      pathPointOffsets: pathPack.pathPointOffsets,
      emittersBase: 0,
      emitterCount: 0,
      fieldExtBase: 0,
      layerExtBase: 0,
      deformFfdBase: 0,
    };
  }
  if (columnSupplyCache) columnSupplyCache.supply.texture.dispose();
  columnSupplyCache = { signature, supply };
  return supply;
}

export { COLUMN_TEX_WIDTH, FIELD_COLUMN_LAYOUT };
