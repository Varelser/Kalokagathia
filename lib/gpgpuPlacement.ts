// Placement grammar (Layer 1 WP8, phase C).
//
// Design: the placement rules the WP8 survey found missing.
// The distribution layer (lib/gpgpuDistribution.ts) TRANSFORMS
// points a source already placed; nothing in the tree authored
// WHERE points go as a general rule — placement lived inside
// each source (the E1 shape law's samplers, the morph bake's
// scatter grammar, the PCG graph) with no shared grammar for
// the MASH / Grasshopper family of rules: regular arrays,
// rings, points along a path, scatter over a surface, and the
// finishing grammar of deterministic randomisation, point IDs
// and species assignment. This module is that grammar, as one
// layer of pure functions in the operator layers' style
// (tolerant parse, resolution toward identity, no RNG stream
// anywhere — every stochastic value comes from the named-
// channel deterministic hash in lib/gpgpuRandom.ts, so a
// placement is a pure function of its description and supply).
//
// Operators (one authored description names ONE operator;
// placement generates positions, it does not transform them):
//   grid    {spacing, nx, ny, nz}
//           a regular 3D array (the Grasshopper array /
//           paneling rule), centred on the origin, spacing
//           between neighbours. With all of nx / ny / nz
//           authored the array IS the point set (count =
//           nx·ny·nz, the supply count is not consulted);
//           with any dimension unauthored the dimensions are
//           derived from the supply count (near-cubic) and
//           exactly `count` points resolve. Index order is
//           x fastest, then y, then z.
//   ring    {radius, y, phase, arc}
//           points on a circle in the XZ plane at height y,
//           at the equidistant angles phase + arc·2π·(i+0.5)/n
//           — the (i + 0.5) / n midpoint convention of the
//           path pipeline. arc 1 is the full circle.
//   path    {svg, subpathMode}
//           points along an authored SVG path at the same
//           equidistant arc parameters the shape stack's path
//           source uses (lib/gpgpuShapeStack.ts calls the same
//           lib/pathGeometry.ts resolver the same way, and the
//           tests pin the two to agree point for point).
//   surface {radius, y}
//           scatter over a sphere of the given radius centred
//           at height y, by the Fibonacci lattice: y_i =
//           1 − 2(i+0.5)/n, azimuth advancing by the golden
//           angle. Deterministic, seed-free, and every point
//           sits exactly on the sphere.
//
// Randomisation and IDs (the MASH finishing grammar):
//   placementHash(seed, index, channel) is the one hash entry
//   point — channelHash from lib/gpgpuRandom.ts (the named-
//   channel supply for new code) over index + seed·7919.31, so
//   the same (seed, index) reproduces and a different seed
//   decorrelates. randomizePlacementPoints jitters each point
//   by (2h − 1)·amplitude per axis from three channels;
//   amplitude 0 is the identity. IDs are placementSequentialIds
//   (start + i, strictly monotonic) and placementGroupIds
//   (floor(i / groupSize), non-decreasing).
//
// Species assignment — three rules, each pinned to the
// existing resolution it generalises (the existing modules
// are NOT modified; the tests compare values directly):
//   band    placementSpeciesBand(u, count) is the terrain
//           scatter's zone rule (lib/gpgpuMorphTargets.ts
//           terrainScatterSpeciesZone): count ≤ 1 → 0, else
//           min(count − 1, max(0, floor(u · count))).
//   hash    placementSpeciesHash(index, count) is the
//           attribute species derivation (lib/gpgpuAttributes
//           .ts attrSpeciesValue): the count clamped to
//           [2, 6] (default 4), species = min(floor(attrHash(
//           index + 17.17) · count), count − 1), returned as
//           the integer zone instead of the normalised value.
//   weights placementSpeciesByWeights(u, weights) walks the
//           cumulative weight bands; placementSpeciesCounts
//           resolves exact per-species counts for a point
//           total through the foliage split's proportional
//           allocation (lib/speciesAllocation.ts
//           allocateSpeciesCounts, fed the weights scaled by
//           1e6 so its integer totals carry the ratios).
//   assignPlacementSpecies applies one rule over a point set:
//   band reads u = (i + 0.5) / count, hash reads the point
//   index, weights reads placementHash(seed, i, species
//   channel) — a statistical ratio, reproducible per seed.
//
// Identity discipline: an unusable description (non-JSON,
// non-object, unknown kind, a path with no SVG text) parses
// to null and resolves to null rather than substituting a
// different placement silently; an empty finishing grammar
// (amplitude 0, species count 1) changes nothing.

import {
  parseSvgPathGeometry,
  resolvePathPoint,
  type MorphPathSubpathMode,
} from './pathGeometry';
import { channelHash } from './gpgpuRandom';
import { attrHash } from './gpgpuAttributes';
import { allocateSpeciesCounts } from './speciesAllocation';

export type PlacementKind = 'grid' | 'ring' | 'path' | 'surface';

/**
 * One placement description, in the fat-interface style of
 * the operator layers: every family's parameters live on the
 * one interface and only the fields of the named `kind` are
 * read.
 */
export interface PlacementSpec {
  kind: PlacementKind;
  /** grid: neighbour spacing (world units). */
  spacing: number;
  /** grid: authored dimensions; 0 = derive from the count.
   *  All three > 0 makes the array the point set. */
  nx: number;
  ny: number;
  nz: number;
  /** ring / surface: the circle / sphere radius. */
  radius: number;
  /** ring: the plane height. surface: the centre height. */
  y: number;
  /** ring: start angle (radians). */
  phase: number;
  /** ring: arc fraction of the full circle, (0, 1]. */
  arc: number;
  /** path: the SVG document text. */
  svg: string;
  /** path: how the arc parameter walks the subpaths. */
  subpathMode: MorphPathSubpathMode;
}

/** What the caller supplies at resolve time. */
export interface PlacementSupply {
  /** Number of points to resolve (integer >= 1). Ignored
   *  by a grid whose three dimensions are all authored. */
  count: number;
  /** Seed for the finishing grammar (randomisation and the
   *  weights species rule). The operators themselves are
   *  seed-free. Default 0. */
  seed?: number;
}

/** The resolved point set, in the bake lanes' conventions. */
export interface PlacementPoints {
  count: number;
  /** Flat xyz triples, count * 3. */
  positions: Float32Array;
}

const PLACEMENT_KINDS: ReadonlySet<string> = new Set(['grid', 'ring', 'path', 'surface']);
const SUBPATH_MODES: ReadonlySet<string> = new Set(['proportional', 'even', 'first']);

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: unknown, fallback: number): number {
  const v = finiteOr(value, NaN);
  return v > 0 ? v : fallback;
}

function dimOr(value: unknown): number {
  const v = Math.floor(finiteOr(value, 0));
  return v > 0 ? Math.min(v, 4096) : 0;
}

function baseSpec(kind: PlacementKind): PlacementSpec {
  return {
    kind,
    spacing: 1,
    nx: 0,
    ny: 0,
    nz: 0,
    radius: 1,
    y: 0,
    phase: 0,
    arc: 1,
    svg: '',
    subpathMode: 'proportional',
  };
}

/**
 * Parse and sanitise the authored JSON description. Returns
 * null when the description names no generatable placement:
 * non-JSON, non-object, a missing / unknown kind, or a path
 * operator with no SVG text. Numeric parameters fall back
 * per family exactly as the sibling grammars sanitise.
 */
export function parsePlacementSpec(raw: string | null | undefined): PlacementSpec | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  const kind = root.kind;
  if (typeof kind !== 'string' || !PLACEMENT_KINDS.has(kind)) return null;
  const spec = baseSpec(kind as PlacementKind);
  if (kind === 'grid') {
    spec.spacing = positiveOr(root.spacing, 1);
    spec.nx = dimOr(root.nx);
    spec.ny = dimOr(root.ny);
    spec.nz = dimOr(root.nz);
  } else if (kind === 'ring') {
    spec.radius = positiveOr(root.radius, 1);
    spec.y = finiteOr(root.y, 0);
    spec.phase = finiteOr(root.phase, 0);
    const arc = finiteOr(root.arc, NaN);
    spec.arc = Number.isFinite(arc) && arc > 0 ? Math.min(arc, 1) : 1;
  } else if (kind === 'path') {
    if (typeof root.svg !== 'string' || root.svg.length === 0) return null;
    spec.svg = root.svg;
    const mode = root.subpathMode;
    if (typeof mode === 'string' && SUBPATH_MODES.has(mode)) {
      spec.subpathMode = mode as MorphPathSubpathMode;
    }
  } else {
    // surface
    spec.radius = positiveOr(root.radius, 1);
    spec.y = finiteOr(root.y, 0);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Operators (each a pure generator of the point set)
// ---------------------------------------------------------------------------

/**
 * The grid's dimensions for a resolve: the authored triple
 * when all three are given, else the near-cubic derivation
 * from the count (nx = ⌈count^⅓⌉, ny = ⌈√(count/nx)⌉,
 * nz = ⌈count/(nx·ny)⌉, so nx·ny·nz >= count and the walk
 * stops at exactly `count` points).
 */
export function placementGridDims(
  spec: PlacementSpec,
  count: number,
): { nx: number; ny: number; nz: number; total: number } {
  if (spec.nx > 0 && spec.ny > 0 && spec.nz > 0) {
    return { nx: spec.nx, ny: spec.ny, nz: spec.nz, total: spec.nx * spec.ny * spec.nz };
  }
  const nx = Math.max(1, Math.ceil(Math.cbrt(count)));
  const ny = Math.max(1, Math.ceil(Math.sqrt(count / nx)));
  const nz = Math.max(1, Math.ceil(count / (nx * ny)));
  return { nx, ny, nz, total: count };
}

/** Grid operator: centred array, x fastest, then y, then z. */
export function generateGridPlacement(spec: PlacementSpec, count: number): PlacementPoints {
  const { nx, ny, nz, total } = placementGridDims(spec, count);
  const out = new Float32Array(total * 3);
  const cx = ((nx - 1) / 2) * spec.spacing;
  const cy = ((ny - 1) / 2) * spec.spacing;
  const cz = ((nz - 1) / 2) * spec.spacing;
  for (let i = 0; i < total; i++) {
    const ix = i % nx;
    const iy = Math.floor(i / nx) % ny;
    const iz = Math.floor(i / (nx * ny));
    out[i * 3] = ix * spec.spacing - cx;
    out[i * 3 + 1] = iy * spec.spacing - cy;
    out[i * 3 + 2] = iz * spec.spacing - cz;
  }
  return { count: total, positions: out };
}

/** Ring operator: equidistant angles over the authored arc. */
export function generateRingPlacement(spec: PlacementSpec, count: number): PlacementPoints {
  const out = new Float32Array(count * 3);
  const span = spec.arc * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const theta = spec.phase + (span * (i + 0.5)) / count;
    out[i * 3] = spec.radius * Math.cos(theta);
    out[i * 3 + 1] = spec.y;
    out[i * 3 + 2] = spec.radius * Math.sin(theta);
  }
  return { count, positions: out };
}

/**
 * Path operator: equidistant arc parameters (i + 0.5) / count
 * resolved through lib/pathGeometry.ts, z = 0 — the same
 * walk the shape stack's path source performs. Returns null
 * when the SVG carries no geometry.
 */
export function generatePathPlacement(spec: PlacementSpec, count: number): PlacementPoints | null {
  const geom = parseSvgPathGeometry(spec.svg);
  if (!geom) return null;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = resolvePathPoint(geom, (i + 0.5) / count, spec.subpathMode);
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = 0;
  }
  return { count, positions: out };
}

/** The Fibonacci lattice's golden angle, π·(3 − √5). */
export const PLACEMENT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Surface operator: Fibonacci-lattice scatter on a sphere. */
export function generateSurfacePlacement(spec: PlacementSpec, count: number): PlacementPoints {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const yNorm = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
    const theta = i * PLACEMENT_GOLDEN_ANGLE;
    out[i * 3] = spec.radius * r * Math.cos(theta);
    out[i * 3 + 1] = spec.y + spec.radius * yNorm;
    out[i * 3 + 2] = spec.radius * r * Math.sin(theta);
  }
  return { count, positions: out };
}

/**
 * Resolve a parsed placement to its point set. Returns null
 * when the supply count is unusable or the operator cannot
 * generate (a path whose SVG carries no geometry).
 */
export function resolvePlacementPoints(
  spec: PlacementSpec,
  supply: PlacementSupply,
): PlacementPoints | null {
  const count = supply.count;
  if (!Number.isInteger(count) || count < 1) return null;
  if (spec.kind === 'grid') return generateGridPlacement(spec, count);
  if (spec.kind === 'ring') return generateRingPlacement(spec, count);
  if (spec.kind === 'path') return generatePathPlacement(spec, count);
  return generateSurfacePlacement(spec, count);
}

/** Parse + resolve in one call. */
export function resolvePlacement(
  raw: string | null | undefined,
  supply: PlacementSupply,
): PlacementPoints | null {
  const spec = parsePlacementSpec(raw);
  if (!spec) return null;
  return resolvePlacementPoints(spec, supply);
}

// ---------------------------------------------------------------------------
// Randomisation and IDs (deterministic finishing grammar)
// ---------------------------------------------------------------------------

/** Hash channels of the finishing grammar (the named-channel
 *  supply in lib/gpgpuRandom.ts; new code takes a channel
 *  number instead of negotiating magic offsets). */
export const PLACEMENT_CHANNEL_JITTER_X = 11;
export const PLACEMENT_CHANNEL_JITTER_Y = 12;
export const PLACEMENT_CHANNEL_JITTER_Z = 13;
export const PLACEMENT_CHANNEL_SPECIES = 14;

/**
 * The one deterministic hash entry point of the finishing
 * grammar: channelHash over index + seed·7919.31. The same
 * (seed, index, channel) always reproduces; a different seed
 * decorrelates. Output in [0, 1).
 */
export function placementHash(seed: number, index: number, channel: number): number {
  const s = Number.isFinite(seed) ? seed : 0;
  return channelHash(channel, index + s * 7919.31);
}

/**
 * Jitter a point set: each axis of point i moves by
 * (2·hash − 1)·amplitude from its own channel, so the offset
 * is bounded by ±amplitude per axis and reproducible per
 * seed. Pure — the input is not mutated; amplitude <= 0
 * returns an unchanged copy (the identity).
 */
export function randomizePlacementPoints(
  positions: Float32Array,
  amplitude: number,
  seed: number,
): Float32Array {
  const out = new Float32Array(positions);
  if (!(amplitude > 0)) return out;
  const count = Math.floor(positions.length / 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] += (placementHash(seed, i, PLACEMENT_CHANNEL_JITTER_X) * 2 - 1) * amplitude;
    out[i * 3 + 1] += (placementHash(seed, i, PLACEMENT_CHANNEL_JITTER_Y) * 2 - 1) * amplitude;
    out[i * 3 + 2] += (placementHash(seed, i, PLACEMENT_CHANNEL_JITTER_Z) * 2 - 1) * amplitude;
  }
  return out;
}

/** Sequential IDs: start + i (strictly monotonic). */
export function placementSequentialIds(count: number, start = 0): Uint32Array {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const base = Number.isFinite(start) ? Math.floor(start) : 0;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = base + i;
  return out;
}

/** Group IDs: floor(i / groupSize) (non-decreasing);
 *  groupSize clamps to >= 1. */
export function placementGroupIds(count: number, groupSize: number): Uint32Array {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const size = Number.isFinite(groupSize) ? Math.max(1, Math.floor(groupSize)) : 1;
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(i / size);
  return out;
}

// ---------------------------------------------------------------------------
// Species assignment (rules pinned to the existing resolutions)
// ---------------------------------------------------------------------------

/**
 * Band rule (ID-range assignment): the terrain scatter's
 * zone rule, term for term — count <= 1 is always zone 0,
 * else min(count − 1, max(0, floor(u · count))) over the
 * normalised driver u. Agrees with terrainScatterSpeciesZone
 * for every (u, count) the bake can produce.
 */
export function placementSpeciesBand(u: number, speciesCount: number): number {
  const count = Math.floor(speciesCount);
  if (!Number.isFinite(count) || count <= 1) return 0;
  const t = Number.isFinite(u) ? u : 0;
  return Math.min(count - 1, Math.max(0, Math.floor(t * count)));
}

/**
 * Hash rule: the attribute species derivation, returned as
 * the integer zone — the count clamped to [2, 6] with the
 * same `|| 4` default, species = min(floor(attrHash(index +
 * 17.17) · count), count − 1). attrSpeciesValue returns this
 * zone divided by (count − 1); the tests pin the two to
 * agree over index grids.
 */
export function placementSpeciesHash(index: number, speciesCount: number): number {
  const count = Math.max(2, Math.min(6, Math.round(speciesCount) || 4));
  return Math.min(Math.floor(attrHash(index + 17.17) * count), count - 1);
}

/**
 * Ratio rule over one normalised draw: walk the cumulative
 * weight bands (non-positive weights carry no band). All
 * weights unusable resolves to species 0.
 */
export function placementSpeciesByWeights(u: number, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Number.isFinite(w) && w > 0 ? w : 0;
  if (!(total > 0) || weights.length === 0) return 0;
  const target = (Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0) * total;
  let acc = 0;
  for (let k = 0; k < weights.length; k++) {
    const w = Number.isFinite(weights[k]) && weights[k] > 0 ? weights[k] : 0;
    acc += w;
    if (target < acc) return k;
  }
  return weights.length - 1;
}

/**
 * Exact per-species counts for a point total under ratio
 * weights: the foliage split's proportional allocation
 * (allocateSpeciesCounts) fed the weights scaled by 1e6, so
 * its integer totals carry the ratios and its largest-
 * remainder discipline decides the counts. Σ result =
 * min(count, Σ scaled weights) — the full count whenever the
 * weights are usable.
 */
export function placementSpeciesCounts(count: number, weights: readonly number[]): number[] {
  const totals = weights.map((w) => Math.round((Number.isFinite(w) && w > 0 ? w : 0) * 1e6));
  return allocateSpeciesCounts(totals, count);
}

export type PlacementSpeciesRule = 'band' | 'hash' | 'weights';

/** Options of assignPlacementSpecies (per-rule fields). */
export interface PlacementSpeciesOptions {
  /** band / hash: the species count. */
  speciesCount?: number;
  /** weights: the ratio weights. */
  weights?: readonly number[];
  /** weights: the seed of the per-point draws. Default 0. */
  seed?: number;
}

/**
 * Assign a species to every point of a set under one rule:
 * band reads the point's normalised position (i + 0.5) /
 * count, hash reads the point index, weights draws
 * placementHash(seed, i, PLACEMENT_CHANNEL_SPECIES) through
 * the cumulative bands (a statistical ratio, reproducible
 * per seed). An unknown rule resolves to all-zero.
 */
export function assignPlacementSpecies(
  count: number,
  rule: PlacementSpeciesRule,
  options: PlacementSpeciesOptions = {},
): Uint8Array {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const out = new Uint8Array(n);
  if (rule === 'band') {
    const species = options.speciesCount ?? 1;
    for (let i = 0; i < n; i++) out[i] = placementSpeciesBand((i + 0.5) / n, species);
  } else if (rule === 'hash') {
    const species = options.speciesCount ?? 4;
    for (let i = 0; i < n; i++) out[i] = placementSpeciesHash(i, species);
  } else if (rule === 'weights') {
    const weights = options.weights ?? [];
    const seed = options.seed ?? 0;
    for (let i = 0; i < n; i++) {
      out[i] = placementSpeciesByWeights(placementHash(seed, i, PLACEMENT_CHANNEL_SPECIES), weights);
    }
  }
  return out;
}
