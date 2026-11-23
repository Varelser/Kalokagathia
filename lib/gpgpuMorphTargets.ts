/**
 * Morph target point clouds for the GPGPU system (Kinetix integration B1a).
 *
 * Kinetix's morph is a "shape point cloud attraction": every particle owns
 * one target point on a parametric shape and a spring pulls it there
 * (k = morphStrength * dt, with a stability-guarded snap branch at large
 * k). Kalokagathia has no CPU per-frame loop to hang that on, so the
 * target cloud is baked once into a float texture with the same texel
 * layout as the position texture, and the velocity shader samples it by
 * the particle's own uv (see gpgpuShaderSimulationVelocity.ts). The orbit
 * phase is applied in the shader as a Y rotation, matching how Kinetix
 * rotates its sampled clouds by morphPhase = time * morphOrbitSpeed.
 *
 * The shape mathematics (curve/surface formulas and constants) follows
 * the same parametric definitions Kinetix uses — trefoil and torus-knot
 * curves, Fibonacci-sphere distributions for geodesic/cymatic/mandelbulb,
 * the figure-8 Klein immersion, the gyroid TPMS projection, the
 * tesseract edge set with perspective projection, the logarithmic
 * nautilus shell — re-implemented here against Kalokagathia's seeded
 * RNG so generation is a pure, deterministic function of
 * (texSize, target, scale, jitter, seed, media map). Deterministic
 * rendering therefore keeps its premise: same config, same cloud.
 *
 * lorenz / aizawa / halvorsen are intentionally absent: the existing
 * strange-attractor force converges to the same pictures (integration
 * map section 4, judgement (2)).
 *
 * mandelbulb note: this is a point-cloud *sampling* approximation
 * (Fibonacci directions folded by the power-8 spherical map). The
 * precise solid Mandelbulb remains the layer raymarch system's job;
 * the morph target exists so particles can gather into a bulb-like
 * mass, not to render the fractal surface.
 *
 * terrain note (Phase L): the 'terrain' target is a Mir-style
 * fractal height field (seeded value-noise fBm, terrainHeightAt
 * below) sampled on the bake grid — particles become the surface of
 * a landscape instead of a closed shape. It is a point sampling of
 * the field, not a polygon mesh: the terrain "reads" through point
 * density and the gradient 'height' driver (world-Y colour), the
 * same trade the mandelbulb target makes for its fractal.
 */

import type { ParticleConfig } from '../types';
import { createSeededRng } from './seededRng';
import { evaluatePcgGraph, pcgAcceptance, pcgStepStrength, resolvePcgGraph, type PcgPlan } from './pcgGraph';
import { pathJitterOffset } from './pathJitter';
import { applyVoronoiFracture, buildFractureCellData, type FractureCellData } from './voronoiFracture';
import {
  maskAcceptsAt,
  resolveActiveMask,
  sampleMaskShapePoint,
  type GpgpuMaskMode,
} from './layerMask';
import {
  PATH_TAPER_MAX_WIDTH,
  offsetPathGeometry,
  resolvePathPoint,
  taperWidthAt,
  type MorphPathOptions,
  type PathGeometry,
} from './pathGeometry';
import {
  applyFormDeformation,
  formTwistAngleAt,
  isFormDeformationActive,
  rotateAroundAxis,
  type FormDeformationOptions,
} from './formDeformation';
import {
  clampStampSize,
  placeStampPoint,
  stampCenterS,
  stampCountForSpacing,
  stampLocalPoint,
} from './stampPlacement';
import {
  deformGlyphPoint,
  sampleTextGlyphPoint,
  textGlyphDeform,
  textOnPathGlyphS,
  textOnPathSlotAt,
  type TextGlyphRaster,
} from './gpgpuTextOnPath';

export type GpgpuMorphTargetKind = ParticleConfig['gpgpuMorphTarget'];

export const GPGPU_MORPH_TARGETS: readonly GpgpuMorphTargetKind[] = [
  'trefoil',
  'torusKnot',
  'galaxy',
  'mobius',
  'geodesic',
  'crown',
  'blackhole',
  'klein',
  'cymatic',
  'gyroid',
  'dnaRibbon',
  'hypercube',
  'mandelbulb',
  'shell',
  'text',
  'image',
  // 'svg' (Pro-2) stays after the built-ins: the target index feeds
  // the bake seed, so appending keeps every existing target's cloud
  // bit-identical.
  'svg',
  // 'obj' (Phase J) appends after 'svg' for the same reason.
  'obj',
  // 'terrain' (Phase L) appends after 'obj' for the same reason.
  'terrain',
  // 'data' (Phase AK) appends after 'terrain' for the same reason:
  // the attribute point cloud (lib/attrPointCloud.ts) as a morph
  // target — positions only; the columns ride the attribute
  // texture, not the bake.
  'data',
  // 'contour' (Phase AM) appends after 'data' for the same
  // reason: the traced outline of a luma source
  // (lib/contourTrace.ts) as a path-style placement.
  'contour',
  // 'polygon' (Phase AW) appends after 'contour' for the same
  // reason: a regular-polygon plate (lib polygon radius grammar).
  'polygon',
] as const;

export interface MorphMediaMap {
  map: ArrayLike<number>;
  width: number;
  height: number;
}

/**
 * Replica grammar (Phase K): the baked cloud is split into `count`
 * contiguous blocks; block r (0-based) is a copy of the base cloud
 * transformed by the r-th cumulative step — geometric scale
 * (scaleStep^r), Y rotation (rotationDeg * r, same convention as the
 * shader's orbit), and a translation of spacing * r along `axis`.
 * The per-copy orbit phase offset (phaseStepDeg * r) is stored in the
 * texel alpha as radians; the velocity shader adds it to the orbit
 * angle (gated by uMorphReplicaPhaseGain), which makes each copy run
 * the same orbit motion time-shifted — an Echospace-style offset
 * chain. Total point count is unchanged (the copies share the fixed
 * texSize^2 budget). With count <= 1 (or no replica options) the bake
 * is byte-identical to the pre-Phase-K output, alpha = 1 included.
 */
export interface GpgpuMorphReplicaOptions {
  /** Number of chained copies (clamped to 1..8; <= 1 disables). */
  count: number;
  /** Per-step translation along `axis`, normalized cloud units. */
  spacing: number;
  /** Translation axis of the chain. */
  axis: 'x' | 'y' | 'z';
  /** Per-step rotation increment around Y, degrees. */
  rotationDeg: number;
  /** Per-step geometric scale ratio (applied as scaleStep^r). */
  scaleStep: number;
  /** Per-step orbit phase offset, degrees (time-offset chain). */
  phaseStepDeg: number;
}

/**
 * Terrain field parameters (Phase L, Mir-style): a seeded value-noise
 * fBm height field. `amplitude` is the elevation range in normalized
 * cloud units (heights land roughly within ±amplitude), `frequency`
 * scales the field's feature size over the cloud domain, `octaves`
 * (1..6) adds finer detail octaves, and `seed` offsets the field so
 * the same (amplitude, frequency, octaves) can grow a different
 * landscape; the bake's main seed is mixed in as well.
 */
/**
 * Terrain generation recipes (Phase AI): how the height field is
 * synthesised from the lattice hashes. 'fbm' is the Phase L field
 * (the default — every pre-AI config means fbm); 'ridge' folds the
 * value noise into sharp crests; 'terrace' quantises the fBm height
 * into smoothed steps; 'cellular' sums Worley F1 cells instead of
 * value noise. All recipes keep the Phase L invariants: pure,
 * deterministic, and bounded by ±amplitude.
 */
export type GpgpuMorphTerrainKind = 'fbm' | 'ridge' | 'terrace' | 'cellular';

export interface GpgpuMorphTerrainOptions {
  amplitude: number;
  frequency: number;
  octaves: number;
  seed: number;
  /**
   * Generation recipe (Phase AI); absent = 'fbm', which runs the
   * Phase L body verbatim, so existing landscapes stay
   * bit-identical.
   */
  kind?: GpgpuMorphTerrainKind;
  /** Terrace step count (Phase AI); only read by the 'terrace'
   *  recipe. Absent = 6, clamped to 2..32. */
  terraceSteps?: number;
  /**
   * Erosion grammar (Phase AP); absent / null, or both strengths
   * at 0, resolves to null in resolveTerrainErosion and every
   * consumer reads the analytic field verbatim.
   */
  erosion?: GpgpuMorphTerrainErosionOptions | null;
}

/**
 * Terrain scatter grammar (Phase AI): a dedicated placement grammar
 * for the terrain target, in the foliage sense — the bake's point
 * distribution, companion normals and species classes are driven by
 * terrain conditions (height band / slope / density) instead of the
 * plain one-point-per-grid-cell tiling. All fields are resolved
 * through resolveTerrainScatter: an all-default scatter resolves to
 * null, in which case the terrain branch runs the legacy tiling
 * verbatim (no extra RNG draws), so identity holds not only with
 * the grammar off but with it on at defaults.
 */
export interface GpgpuMorphTerrainScatterOptions {
  /** Overall acceptance density 0..1 (1 = no thinning). */
  density: number;
  /** Height band, normalised t = h / amplitude * 0.5 + 0.5. */
  heightMin: number;
  heightMax: number;
  /** Slope cap 0..1, relative to the bake grid's own maximum
   *  gradient (the AE slope map's normalisation). 1 = no cap. */
  slopeMax: number;
  /** Companion-normal alignment 0..1: 0 keeps the legacy zero
   *  normals; 1 writes the full terrain normal (scaled by the
   *  species class below). */
  alignNormal: number;
  /** Species zones 1..4 across the height band: a particle's zone
   *  is chosen by its final height, and the zone scales its
   *  aligned normal's magnitude (the engine's per-particle class
   *  channel — the normal magnitude drives the Phase O emission
   *  kick speed). 1 = a single species. */
  species: number;
  /** Scatter finishing (Phase AX): per-particle scale
   *  randomisation of the species magnitude (factor in [1−r, 1+r]
   *  by a deterministic index hash). 0 = off. Only acts on the
   *  aligned / bent normal — with alignment 0 and bend 0 it is
   *  inert and does not keep the grammar alive on its own. */
  scaleRandom?: number;
  /** Scatter finishing (Phase AX): azimuth randomisation of the
   *  companion normal (rotation around Y by up to ±r·π, same
   *  hash family). 0 = off; inert without alignment / bend. */
  rotRandom?: number;
  /** PCG rule graph (Phase 18 stage 3, lib/pcgGraph.ts): while
   *  pcgGraphEnabled is true, the scatter pipeline below runs
   *  through the graph evaluator (node order / enabled flags /
   *  params from pcgGraphData, '' = the default graph). Absent /
   *  false = the legacy fixed-order code path verbatim, consuming
   *  exactly the historical RNG draws. The default graph evaluated
   *  through the plan is bit-identical to the legacy path (proven
   *  by scripts/phase18-pcg-graph.test.mjs). */
  pcgGraphEnabled?: boolean;
  pcgGraphData?: string;
  /** Scatter finishing (Phase AX): posture bend — the companion
   *  normal leans toward downhill by up to 0.6·bend of the way
   *  to the horizontal downhill direction; at alignment 0 the
   *  bend alone writes a leaning normal of magnitude 0.6·bend.
   *  This is an orientation finish on a point cloud, NOT a mesh
   *  bend. (Per-species mesh swap arrived later, in Phase 16
   *  stage 5, via the speciesData channel below.) 0 = off. */
  bend?: number;
}

export interface GpgpuMorphTargetBuildOptions {
  texSize: number;
  target: GpgpuMorphTargetKind;
  /** World-units multiplier applied to the normalized (~unit) cloud. */
  worldScale: number;
  /** Normalized-space jitter amplitude (Kinetix morphJitter). */
  jitter: number;
  /** Base seed (config gpgpuSeed); mixed with the target index. */
  seed: number;
  /** Replica grammar (Phase K); null/absent = single copy (legacy). */
  replica?: GpgpuMorphReplicaOptions | null;
  /** Luma map for the text/image targets; null falls back to a shell. */
  mediaMap?: MorphMediaMap | null;
  /**
   * Normalised point cloud for the svg target (flat xy pairs in
   * centred y-up space, from lib/svgMorph.ts); null falls back to a
   * shell, like a missing media map.
   */
  svgPoints?: ArrayLike<number> | null;
  /**
   * Normalised surface point cloud for the obj target (flat xyz
   * triples, centred with bounding-sphere radius 1, from
   * lib/objMorph.ts); null falls back to a shell, like a missing
   * media map.
   */
  objPoints?: ArrayLike<number> | null;
  /**
   * Per-sample unit normals for the obj target (Phase O), flat xyz
   * triples parallel to objPoints (same sample index). Consumed only
   * by buildGpgpuMorphTargetDataWithNormals; absent leaves the
   * normal cloud zero (radial for the shell fallback).
   */
  objNormals?: ArrayLike<number> | null;
  /**
   * Terrain field parameters for the terrain target; absent uses the
   * defaults in DEFAULT_TERRAIN. Ignored by every other target.
   */
  terrain?: GpgpuMorphTerrainOptions | null;
  /**
   * Attribute point cloud positions for the data target (Phase AK,
   * lib/attrPointCloud.ts): flat xyz triples in the unit-sphere
   * convention (centred, bounding radius 1), the same convention
   * as objPoints. Null (no cloud registered) falls back to a
   * shell, like a missing media map.
   */
  dataPoints?: ArrayLike<number> | null;
  /**
   * Path geometry for the svg target (Phase S, lib/pathGeometry.ts):
   * the same SVG document viewed as ordered subpaths with true
   * arc-length tables. Only consulted when `path` is also given and
   * its mode is not 'off'; null keeps the legacy random pick.
   */
  pathGeometry?: PathGeometry | null;
  /**
   * Path placement options for the svg target (Phase S). Absent /
   * null / mode 'off' = the legacy seeded random pick over
   * `svgPoints`, byte-identical to v1.20.0: the path branch is
   * entered only when this and `pathGeometry` are both present, and
   * it consumes no RNG draws of its own (the taper offset reuses the
   * per-particle h2 draw), so the RNG consumption order never
   * changes.
   */
  path?: MorphPathOptions | null;
  /**
   * Text on path (Phase AF2, lib/gpgpuTextOnPath.ts): per-glyph
   * luma rasters of the TextMap string. Only consulted when the
   * path branch is active with mode 'along' or 'writeOn'; null
   * (the default) keeps the plain path placement bit-identical.
   * Glyph particles sample their glyph raster with the bake RNG
   * (the media grammar), so an enabled bake is deterministic for
   * a given seed but does not share the plain branch's draw
   * pattern — identity is only promised with the feature off.
   */
  textOnPath?: {
    glyphs: TextGlyphRaster[];
    delay: number;
    size: number;
    /**
     * Vertical text on path (Phase 17, lib/gpgpuTextOnPath.ts):
     * the glyphs are the cells of the vertical column plan, in
     * column reading order. While true, a sampled glyph point
     * maps its vertical fraction onto the path parameter and its
     * horizontal fraction onto the normal offset (the glyph's
     * vertical axis along the tangent, its top against the
     * direction of travel). Absent / false = the AF2 mapping
     * verbatim.
     */
    vertical?: boolean;
    /**
     * Per-glyph deformation (Phase AM): scale / rotation /
     * fade variation amounts. Absent / null = the AF2 placement
     * verbatim (the shared builder only sets this while at
     * least one amount is non-zero).
     */
    deform?: {
      scaleVar: number;
      rotateDeg: number;
      fadeVar: number;
    } | null;
  } | null;
  /**
   * Contour geometry for the contour target (Phase AM,
   * lib/contourTrace.ts): the traced outline of the selected
   * luma source as ordered subpaths. Only consulted when the
   * target is 'contour'; null (no contour at the threshold)
   * falls back to a shell, like a missing media map.
   */
  contourGeometry?: PathGeometry | null;
  /**
   * Raster mask (Phase X, lib/layerMask.ts): a luminance map plus
   * its mode. 'shape' replaces the placement sampling with the
   * mask's own shape (seeded acceptance sampling, probability =
   * luminance); 'clip' relocates any baked point whose normalized
   * XY falls in a rejected region into the mask via the same
   * sampler (the draw shader additionally discards fragments in
   * rejected regions, so live positions are clipped too). Absent /
   * null / mode 'off' / unusable map = the legacy bake exactly:
   * the mask branches are entered only for an active mask, so the
   * RNG consumption order of every existing target is unchanged.
   */
  mask?: {
    map: MorphMediaMap | null;
    mode: GpgpuMaskMode;
    threshold: number;
    invert: boolean;
  } | null;
  /**
   * Form-dedicated deformation (Phase AA2, lib/formDeformation.ts):
   * Disperse / Twist / Fractal Field over the baked base point,
   * applied after placement (and mask clip) and before the replica
   * grammar, in normalised space. Absent / null / all amounts 0 =
   * the legacy bake exactly (the branch is skipped entirely).
   */
  form?: FormDeformationOptions | null;
  /**
   * Voronoi fracture (Phase AG, lib/voronoiFracture.ts): a
   * post-pass over the finished bake — the cloud is partitioned
   * into seeded Voronoi cells and each cell is shrunk toward its
   * centroid and pushed away from the shape centre by `gap`.
   * Applied inside this shared builder, so the WebGPU, WebGL and
   * CPU routings all consume the same fractured cloud. Absent /
   * null = the legacy bake exactly (the pass is skipped).
   */
  fracture?: {
    cells: number;
    seed: number;
    gap: number;
  } | null;
  /**
   * Rigid body cell data (Phase AU, lib/rigidBodies.ts): when
   * present, the bake additionally returns the fracture cell
   * table (assignment / local offsets / body table) computed from
   * the pre-transform cloud with these options — the CPU rigid
   * body solver's material. The options carry the fracture keys'
   * cells / seed and the gap the bake's own fracture pass will
   * apply (0 while the fracture is disabled), so the cell data
   * matches the produced cloud point for point. Absent / null =
   * no cell data is computed and the bake is untouched.
   */
  rigidFracture?: {
    cells: number;
    seed: number;
    gap: number;
  } | null;
  /**
   * Terrain scatter grammar (Phase AI, see
   * GpgpuMorphTerrainScatterOptions): only consulted by the
   * terrain target. Absent / null / all-default values = the
   * legacy grid tiling exactly (the resolver returns null and the
   * branch is skipped, consuming no extra RNG draws). A
   * non-default scatter consumes extra draws for its resampling,
   * so an enabled bake is deterministic for a given seed but does
   * not share the plain branch's draw pattern — the Phase X mask
   * precedent.
   */
  scatter?: GpgpuMorphTerrainScatterOptions | null;
  /**
   * Polygon side count for the polygon target (Phase AW): 3..12,
   * absent / out of range resolves to the default 6. Only
   * consulted by the polygon target; it consumes no RNG draws
   * beyond the shared per-particle draws, like every analytic
   * target.
   */
  polygonSides?: number;
  /**
   * Path jitter amount (Phase AW, lib/pathJitter.ts): when > 0
   * AND the bake places particles along paths (the svg path
   * branch or the contour target), each finished point is
   * displaced by the position-hashed path jitter before the
   * world scale is applied. Absent / 0 = the legacy bake exactly
   * (the branch is skipped, no extra draws).
   */
  pathJitter?: number;
}

/**
 * Field-seed mixing shared by the morph bake and the Phase P terrain
 * mesh: the bake seed (config gpgpuSeed) XOR-mixed with the terrain
 * seed offset. Extracted as a pure helper so the mesh system
 * (lib/terrainMesh.ts) grows exactly the same landscape as the point
 * terrain for the same config. The mixing itself is unchanged from
 * Phase L, so existing bakes stay bit-identical.
 */
export function terrainFieldSeedFor(seed: number, terrainSeed: number): number {
  return ((seed ^ Math.imul((terrainSeed | 0) + 1, 0x9e3779b1)) | 0);
}

/**
 * Polygon target grammar (Phase AW): resolve the side count —
 * an integer in [3, 12]; anything else (absent, fractional-only,
 * out of range, non-finite) resolves to the default 6.
 */
export function resolvePolygonSides(sides?: number): number {
  if (typeof sides !== 'number' || !Number.isFinite(sides)) return 6;
  const n = Math.floor(sides);
  return n >= 3 && n <= 12 ? n : 6;
}

/**
 * The boundary radius of a regular polygon at angle `theta`:
 * r(θ) = cos(π/n) / cos((θ mod 2π/n) − π/n) — the polygon
 * inscribed in the unit circle, so r = 1 at the vertices and
 * r = cos(π/n) at the edge midpoints. Pure and periodic with
 * period 2π/n.
 */
export function polygonRadiusAt(theta: number, sides: number): number {
  const n = resolvePolygonSides(sides);
  const sector = (Math.PI * 2) / n;
  const local = ((theta % sector) + sector) % sector;
  return Math.cos(Math.PI / n) / Math.cos(local - Math.PI / n);
}

export const DEFAULT_TERRAIN: GpgpuMorphTerrainOptions = {
  amplitude: 0.55,
  frequency: 1.6,
  octaves: 4,
  seed: 0,
};

/**
 * Integer lattice hash for the terrain value noise: pure integer
 * math (Math.imul), so the field is identical on every platform and
 * every run. Returns a value in [-1, 1).
 */
function terrainLattice(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

/**
 * One smoothstep-interpolated value-noise sample in [-1, 1) at
 * lattice-scaled coordinates (sx, sz). This is the per-octave body
 * the Phase L fBm loop always ran, extracted verbatim — the fBm
 * sum below performs the identical operations in the identical
 * order, so fBm heights are bit-identical to Phase L.
 */
function terrainValueNoiseAt(sx: number, sz: number, seed: number): number {
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  const fx = sx - ix;
  const fz = sz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const v00 = terrainLattice(ix, iz, seed);
  const v10 = terrainLattice(ix + 1, iz, seed);
  const v01 = terrainLattice(ix, iz + 1, seed);
  const v11 = terrainLattice(ix + 1, iz + 1, seed);
  const top = v00 + (v10 - v00) * ux;
  const bottom = v01 + (v11 - v01) * ux;
  return top + (bottom - top) * uz;
}

/**
 * The Phase L field: value noise summed over `octaves` fBm octaves
 * (lacunarity 2, gain 0.5, gain-normalized, so the result stays
 * within ±amplitude for amplitude >= 0).
 */
function terrainFbmHeight(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  const octaves = Math.max(1, Math.min(6, Math.floor(terrain.octaves) || 1));
  const baseFreq = Math.max(0.05, terrain.frequency);
  const amplitude = Math.max(0, terrain.amplitude);
  let sum = 0;
  let norm = 0;
  let gain = 0.5;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += terrainValueNoiseAt(x * freq, z * freq, fieldSeed + o * 101) * gain;
    norm += gain;
    gain *= 0.5;
    freq *= 2;
  }
  return (sum / norm) * amplitude;
}

/**
 * Ridged recipe (Phase AI): each octave folds the value noise
 * through r = (1 − |n|)², so the zero lines of the noise become
 * sharp crests. The gain-normalised sum lies in [0, 1] and is
 * remapped to [−1, 1] before the amplitude scale, keeping the
 * ±amplitude bound.
 */
function terrainRidgedHeight(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  const octaves = Math.max(1, Math.min(6, Math.floor(terrain.octaves) || 1));
  const baseFreq = Math.max(0.05, terrain.frequency);
  const amplitude = Math.max(0, terrain.amplitude);
  let sum = 0;
  let norm = 0;
  let gain = 0.5;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = terrainValueNoiseAt(x * freq, z * freq, fieldSeed + o * 101);
    const r = 1 - Math.abs(n);
    sum += r * r * gain;
    norm += gain;
    gain *= 0.5;
    freq *= 2;
  }
  return ((sum / norm) * 2 - 1) * amplitude;
}

/** Terrace step count, clamped to the recipe's defined range. */
export function clampTerrainTerraceSteps(steps: number | undefined): number {
  const s = Math.floor(steps ?? 6);
  return Number.isFinite(s) ? Math.max(2, Math.min(32, s)) : 6;
}

function smoothstep01(edge0: number, edge1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - edge0) / Math.max(edge1 - edge0, 1e-9)));
  return t * t * (3 - 2 * t);
}

/**
 * Terraced recipe (Phase AI): the fBm height quantised into
 * `terraceSteps` plateaus. Each step's top 28% is a smoothstep
 * riser into the next plateau, so the landscape reads as flat
 * shelves with smooth cliffs rather than a staircase of hard
 * discontinuities. The transform is a pure remap of the fBm
 * height, so the ±amplitude bound is inherited.
 */
function terrainTerracedHeight(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  const amplitude = Math.max(0, terrain.amplitude);
  if (amplitude <= 0) return 0;
  const h = terrainFbmHeight(x, z, terrain, fieldSeed);
  const steps = clampTerrainTerraceSteps(terrain.terraceSteps);
  const u = Math.max(0, Math.min(1, h / amplitude * 0.5 + 0.5));
  const su = u * steps;
  const base = Math.floor(su);
  const f = su - base;
  const stepped = (base + smoothstep01(0.72, 1, f)) / steps;
  return (stepped * 2 - 1) * amplitude;
}

/**
 * One Worley F1 cellular sample mapped to [-1, 1]: feature points
 * are the integer lattice hashes jittered inside their cells
 * (two independent lattice hashes per cell), F1 is the distance
 * to the nearest feature over the 3×3 neighbourhood, and the
 * sample is clamp(1 − F1, 0, 1) × 2 − 1 — bumps over the feature
 * points, flat basins far from all of them.
 */
function terrainCellularNoiseAt(sx: number, sz: number, seed: number): number {
  const ix = Math.floor(sx);
  const iz = Math.floor(sz);
  let f1 = Infinity;
  for (let j = iz - 1; j <= iz + 1; j++) {
    for (let i = ix - 1; i <= ix + 1; i++) {
      const px = i + (terrainLattice(i, j, seed) * 0.5 + 0.5);
      const pz = j + (terrainLattice(i, j, seed + 7919) * 0.5 + 0.5);
      const dx = px - sx;
      const dz = pz - sz;
      const d2 = dx * dx + dz * dz;
      if (d2 < f1) f1 = d2;
    }
  }
  const d = Math.sqrt(f1);
  return Math.max(0, Math.min(1, 1 - d)) * 2 - 1;
}

/**
 * Cellular recipe (Phase AI): Worley F1 octaves summed with the
 * same gain ladder as the fBm, so the result stays within
 * ±amplitude. A different noise species for the same terrain
 * grammar (Houdini §10's ノイズ種).
 */
function terrainCellularHeight(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  const octaves = Math.max(1, Math.min(6, Math.floor(terrain.octaves) || 1));
  const baseFreq = Math.max(0.05, terrain.frequency);
  const amplitude = Math.max(0, terrain.amplitude);
  let sum = 0;
  let norm = 0;
  let gain = 0.5;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += terrainCellularNoiseAt(x * freq, z * freq, fieldSeed + o * 101) * gain;
    norm += gain;
    gain *= 0.5;
    freq *= 2;
  }
  return (sum / norm) * amplitude;
}

/**
 * Height of the terrain field at normalized (x, z), under the
 * recipe selected by `terrain.kind` (Phase AI; absent = 'fbm').
 * Pure and deterministic: same (x, z, params, fieldSeed) always
 * yields the same height, and every recipe stays within
 * ±amplitude for amplitude >= 0. `fieldSeed` is the already-mixed
 * seed (bake seed + terrain seed). Every consumer of the field
 * (morph bake, terrain mesh, derived maps, shadow occlusion,
 * collider bake) goes through this one function, so a recipe
 * change reshapes all of them identically — one landscape.
 */
export function terrainHeightAt(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  switch (terrain.kind ?? 'fbm') {
    case 'ridge': return terrainRidgedHeight(x, z, terrain, fieldSeed);
    case 'terrace': return terrainTerracedHeight(x, z, terrain, fieldSeed);
    case 'cellular': return terrainCellularHeight(x, z, terrain, fieldSeed);
    default: return terrainFbmHeight(x, z, terrain, fieldSeed);
  }
}

// ---------------------------------------------------------------------------
// Terrain scatter grammar (Phase AI)

/** Finite-difference step for terrain gradients inside the bake —
 *  the AE derived grid's own step ((2 × 1.05) / 128), so the
 *  scatter's slope reads the same surface the slope map shows. */
export const TERRAIN_GRADIENT_EPS = (1.05 * 2) / 128;

/** Terrain gradient (dh/dx, dh/dz) at a field point, by central
 *  differences of terrainHeightAt. Field units throughout: the
 *  world gradient is identical because height and XZ share the
 *  world scale. */
export function terrainGradientAt(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
  eps: number = TERRAIN_GRADIENT_EPS,
): { gx: number; gz: number } {
  const gx = (terrainHeightAt(x + eps, z, terrain, fieldSeed) - terrainHeightAt(x - eps, z, terrain, fieldSeed)) / (2 * eps);
  const gz = (terrainHeightAt(x, z + eps, terrain, fieldSeed) - terrainHeightAt(x, z - eps, terrain, fieldSeed)) / (2 * eps);
  return { gx, gz };
}

/**
 * The slope normalisation reference for one bake: the maximum
 * gradient magnitude over a coarse grid of the field domain (the
 * AE slope map normalises by its own grid maximum the same way).
 * Returns 0 for a flat field (every slope then reads 0).
 */
export function terrainScatterGradientRef(
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
  gridSize: number = 48,
): number {
  const n = Math.max(4, Math.floor(gridSize));
  const extent = 1.05;
  let max = 0;
  for (let j = 0; j < n; j++) {
    const fz = -extent + (j / (n - 1)) * extent * 2;
    for (let i = 0; i < n; i++) {
      const fx = -extent + (i / (n - 1)) * extent * 2;
      const { gx, gz } = terrainGradientAt(fx, fz, terrain, fieldSeed);
      const g = Math.hypot(gx, gz);
      if (g > max) max = g;
    }
  }
  return max;
}

function clampScatter01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/**
 * Resolve scatter options to their clamped runtime form, or null
 * when the grammar cannot change anything (absent options, or
 * every parameter at its identity value: full density, full
 * height band, no slope cap, no normal alignment). Null is the
 * identity guarantee: the bake then runs the legacy terrain
 * tiling verbatim and consumes no extra RNG draws.
 */
export function resolveTerrainScatter(
  scatter: GpgpuMorphTerrainScatterOptions | null | undefined,
): GpgpuMorphTerrainScatterOptions | null {
  if (!scatter) return null;
  const density = clampScatter01(scatter.density, 1);
  let heightMin = clampScatter01(scatter.heightMin, 0);
  let heightMax = clampScatter01(scatter.heightMax, 1);
  if (heightMax < heightMin) { const t = heightMin; heightMin = heightMax; heightMax = t; }
  const slopeMax = clampScatter01(scatter.slopeMax, 1);
  const alignNormal = clampScatter01(scatter.alignNormal, 0);
  const speciesRaw = Math.floor(scatter.species);
  const species = Number.isFinite(speciesRaw) ? Math.max(1, Math.min(4, speciesRaw)) : 1;
  // Phase AX finishing: scale / rotation randomisation only
  // modify the aligned (or bent) normal, so like `species` they
  // do not keep the grammar alive on their own; bend does (it
  // writes a leaning normal even at alignment 0).
  const scaleRandom = clampScatter01(scatter.scaleRandom ?? 0, 0);
  const rotRandom = clampScatter01(scatter.rotRandom ?? 0, 0);
  const bend = clampScatter01(scatter.bend ?? 0, 0);
  if (density >= 1 && heightMin <= 0 && heightMax >= 1 && slopeMax >= 1 && alignNormal <= 0 && bend <= 0) {
    return null;
  }
  return { density, heightMin, heightMax, slopeMax, alignNormal, species, scaleRandom, rotRandom, bend };
}

/**
 * Acceptance probability of one scatter candidate: the product of
 * the density, a height-band factor (1 inside the band, falling
 * linearly to 0 over a 0.05 skirt outside it) and a slope factor
 * (1 at or under the cap, falling to 0 over 0.15 of normalised
 * slope above it). `t` is the normalised height, `slopeNorm` the
 * gradient magnitude relative to the bake's reference maximum.
 */
export function terrainScatterAcceptance(
  scatter: GpgpuMorphTerrainScatterOptions,
  t: number,
  slopeNorm: number,
): number {
  const skirt = 0.05;
  let band = 1;
  if (t < scatter.heightMin) band = clampScatter01((t - (scatter.heightMin - skirt)) / skirt, 0);
  else if (t > scatter.heightMax) band = clampScatter01(((scatter.heightMax + skirt) - t) / skirt, 0);
  let slope = 1;
  if (scatter.slopeMax < 1) {
    slope = slopeNorm <= scatter.slopeMax
      ? 1
      : clampScatter01(1 - (slopeNorm - scatter.slopeMax) / 0.15, 0);
  }
  return scatter.density * band * slope;
}

/**
 * Species zone of a normalised height and the normal-magnitude
 * class it carries: zones split the [0, 1] height range evenly;
 * the class scale runs 0.55 (lowest zone) to 1.0 (highest), and a
 * single species is always exactly 1.
 */
/**
 * Species zone index of a normalised height (Phase 16 stage 5):
 * the single assignment the bake uses both for the normal-
 * magnitude class below and for the speciesData channel, so the
 * two can never drift apart. Species <= 1 is always zone 0.
 */
export function terrainScatterSpeciesZone(
  scatter: GpgpuMorphTerrainScatterOptions,
  t: number,
): number {
  if (scatter.species <= 1) return 0;
  return Math.min(scatter.species - 1, Math.max(0, Math.floor(t * scatter.species)));
}

export function terrainScatterSpeciesScale(
  scatter: GpgpuMorphTerrainScatterOptions,
  t: number,
): number {
  if (scatter.species <= 1) return 1;
  const zone = terrainScatterSpeciesZone(scatter, t);
  return 0.55 + 0.45 * (zone / (scatter.species - 1));
}

/** Resampling attempts per particle in the scatter branch
 *  (the first attempt is the particle's own grid cell). */
export const TERRAIN_SCATTER_ATTEMPTS = 5;

/** Deterministic per-particle hash in [0, 1) for the Phase AX
 *  scatter finishing (the shared hash1 family on (index, salt)).
 *  Index-based — never an RNG draw — so enabling the finishing
 *  cannot shift the bake's draw sequence. */
function dmHash11(n: number): number {
  const fract = (v: number): number => v - Math.floor(v);
  let x = fract(n * 0.1031);
  let y = fract(n * 0.1030);
  let z = fract(n * 0.0973);
  const d = x * (y + 33.33) + y * (x + 33.33) + z * (z + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

export function terrainScatterHash01(index: number, salt: number): number {
  return dmHash11(index * 3.71 + salt * 17.17 + 3.13);
}

/** The per-particle scale factor of the finishing: [1−r, 1+r]. */
export function terrainScatterScaleFactor(scatter: GpgpuMorphTerrainScatterOptions, hash: number): number {
  const r = clampScatter01(scatter.scaleRandom ?? 0, 0);
  const h = Number.isFinite(hash) ? Math.max(0, Math.min(1, hash)) : 0.5;
  return 1 + (h * 2 - 1) * r;
}

/**
 * Scatter finishing (Phase AX): the companion normal after the
 * scale randomisation, the azimuth randomisation and the bend
 * are applied to the Phase AI aligned normal. With scaleRandom /
 * rotRandom / bend all 0 this returns exactly the Phase AI
 * statement (terrain normal × align × species scale), and with
 * alignment 0 and bend 0 it returns the zero vector (the legacy
 * terrain normals), whatever the randomisation keys say.
 */
export function terrainScatterFinishNormal(
  scatter: GpgpuMorphTerrainScatterOptions,
  gx: number,
  gz: number,
  t: number,
  hashScale: number,
  hashRot: number,
): { x: number; y: number; z: number } {
  const scaleF = terrainScatterScaleFactor(scatter, hashScale);
  const invLen = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
  let nx = -gx * invLen;
  let ny = invLen;
  let nz = -gz * invLen;
  let mag = scatter.alignNormal * terrainScatterSpeciesScale(scatter, t) * scaleF;
  const bend = clampScatter01(scatter.bend ?? 0, 0);
  const gl = Math.hypot(gx, gz);
  if (bend > 0 && gl > 1e-6) {
    const dhx = -gx / gl;
    const dhz = -gz / gl;
    if (mag <= 0) {
      nx = dhx;
      ny = 0;
      nz = dhz;
      mag = bend * 0.6 * scaleF;
    } else {
      const mixAmt = Math.min(1, bend * 0.6);
      const mx = nx + (dhx - nx) * mixAmt;
      const my = ny + (0 - ny) * mixAmt;
      const mz = nz + (dhz - nz) * mixAmt;
      const ml = Math.hypot(mx, my, mz) || 1;
      nx = mx / ml;
      ny = my / ml;
      nz = mz / ml;
    }
  }
  const rot = clampScatter01(scatter.rotRandom ?? 0, 0);
  if (rot > 0 && mag > 0) {
    const h = Number.isFinite(hashRot) ? Math.max(0, Math.min(1, hashRot)) : 0.5;
    const ang = (h * 2 - 1) * rot * Math.PI;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rx = nx * c - nz * s;
    const rz = nx * s + nz * c;
    nx = rx;
    nz = rz;
  }
  return { x: nx * mag, y: ny * mag, z: nz * mag };
}

// ---------------------------------------------------------------------------
// Terrain erosion (Phase AP)

/**
 * Terrain erosion grammar (Phase AP): the generated height field
 * re-carved by an iterative simulation — seeded droplet hydraulic
 * erosion plus thermal talus relaxation — run ONCE at bake time
 * on the field's own grid (129×129 over [-1.05, 1.05]^2, the
 * derived-maps grid). This is the solver side of the terrain,
 * distinct from the Phase AI generation recipes: the recipes
 * shape the field analytically, erosion then wears it down.
 *
 * The simulation output is a single eroded-field object with a
 * bilinear sampler. While erosion is active, every consumer of
 * the landscape reads the eroded field — the morph bake, the
 * terrain mesh, the derived maps (and with them the collider and
 * the slope force), the shadow occlusion and the scatter grammar
 * — so there is still exactly one landscape. Identity: Water 0
 * and Thermal 0 (the defaults) resolve the grammar to null, no
 * grid is ever built, and every consumer runs the analytic
 * terrainHeightAt verbatim. The sim is a pure function of
 * (terrain params, field seed, erosion params): the droplet RNG
 * is the shared seeded mulberry, so the same config always grows
 * the same eroded landscape. Per-frame cost is zero — the field
 * is baked, like the derived maps.
 */
export interface GpgpuMorphTerrainErosionOptions {
  /** Hydraulic (droplet) erosion strength 0..1. 0 = off. */
  water: number;
  /** Droplet count multiplier 0..2 over the base count. */
  droplets: number;
  /** Deposition rate 0..1 of the sediment a droplet carries. */
  deposit: number;
  /** Thermal (talus) relaxation strength 0..1. 0 = off. */
  thermal: number;
  /** Talus (angle of repose) 0..1, mapped to a max slope. */
  talus: number;
  /** Thermal relaxation passes, clamped to 1..80. */
  thermalPasses: number;
  /** Erosion seed offset (droplet placement). */
  seed: number;
}

export interface ResolvedTerrainErosion {
  water: number;
  dropletCount: number;
  deposit: number;
  thermal: number;
  /** Steepest neighbour slope (height per field unit) the
   *  thermal pass lets stand. */
  talusSlope: number;
  thermalPasses: number;
  seed: number;
}

/** Side length of the erosion grid: the derived-maps grid
 *  (TERRAIN_MESH_RESOLUTION + 1), so the grid the derived maps
 *  differentiate and the field the bake samples are the same
 *  grid, cell for cell. The Phase AP budget cap is 257. */
export const TERRAIN_EROSION_GRID_SIZE = 129;
/** Base droplet count at multiplier 1 (Phase AP budget). */
export const TERRAIN_EROSION_BASE_DROPLETS = 30000;
/** Hard droplet budget (Phase AP budget). */
export const TERRAIN_EROSION_MAX_DROPLETS = 60000;
/** Hard thermal-pass budget (Phase AP budget). */
export const TERRAIN_EROSION_MAX_THERMAL_PASSES = 80;

function clampErosion01(v: number, fallback: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/**
 * Resolve erosion options to their clamped runtime form, or
 * null when the grammar cannot change anything (absent options,
 * or both strengths at 0). Null is the identity guarantee, the
 * same shape as resolveTerrainScatter.
 */
export function resolveTerrainErosion(
  erosion: GpgpuMorphTerrainErosionOptions | null | undefined,
): ResolvedTerrainErosion | null {
  if (!erosion) return null;
  const water = clampErosion01(erosion.water, 0);
  const thermal = clampErosion01(erosion.thermal, 0);
  if (water <= 0 && thermal <= 0) return null;
  const dropletsMult = Number.isFinite(erosion.droplets)
    ? Math.max(0, Math.min(2, erosion.droplets))
    : 1;
  const dropletCount = Math.min(
    TERRAIN_EROSION_MAX_DROPLETS,
    Math.round(TERRAIN_EROSION_BASE_DROPLETS * dropletsMult),
  );
  const deposit = clampErosion01(erosion.deposit, 0.3);
  const talus = clampErosion01(erosion.talus, 0.5);
  const passesRaw = Math.floor(erosion.thermalPasses);
  const thermalPasses = Number.isFinite(passesRaw)
    ? Math.max(1, Math.min(TERRAIN_EROSION_MAX_THERMAL_PASSES, passesRaw))
    : 24;
  const seedRaw = Math.floor(erosion.seed);
  const seed = Number.isFinite(seedRaw) ? seedRaw : 0;
  return {
    water,
    dropletCount,
    deposit,
    thermal,
    talusSlope: 0.15 + talus * 2.35,
    thermalPasses,
    seed,
  };
}

/** RNG seed of the droplet sim: the field seed mixed with the
 *  erosion seed offset (the terrainFieldSeedFor mixing shape). */
export function erosionRngSeedFor(fieldSeed: number, erosionSeed: number): number {
  return ((fieldSeed ^ Math.imul((erosionSeed | 0) + 1, 0x85ebca6b)) | 0);
}

/**
 * Droplet hydraulic erosion on a height grid (the classic
 * seeded-droplet model): each droplet runs downhill under
 * inertia, carrying sediment up to a capacity set by its speed,
 * water volume and the local drop; it deposits on climbs and
 * when over capacity, and erodes otherwise. Positions are grid
 * cells, heights are field units, so the carving scales with
 * the terrain amplitude itself. All randomness comes from the
 * seeded RNG — the result is a pure function of the inputs.
 */
function erodeDropletsInPlace(
  heights: Float32Array,
  n: number,
  resolved: ResolvedTerrainErosion,
  rngSeed: number,
): void {
  const count = resolved.dropletCount;
  if (count <= 0 || resolved.water <= 0) return;
  const rng = createSeededRng(rngSeed >>> 0);
  const inertia = 0.3;
  const capacityFactor = 4;
  const minCapacity = 0.01;
  const erodeRate = 0.3 * resolved.water;
  const depositRate = resolved.deposit;
  const evaporateRate = 0.01;
  const gravity = -4;
  const maxLifetime = 30;
  const sampleAt = (px: number, pz: number): number => {
    const ix = Math.max(0, Math.min(n - 2, Math.floor(px)));
    const iz = Math.max(0, Math.min(n - 2, Math.floor(pz)));
    const fx = Math.max(0, Math.min(1, px - ix));
    const fz = Math.max(0, Math.min(1, pz - iz));
    const h00 = heights[iz * n + ix];
    const h10 = heights[iz * n + ix + 1];
    const h01 = heights[(iz + 1) * n + ix];
    const h11 = heights[(iz + 1) * n + ix + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  };
  const addAt = (px: number, pz: number, amount: number): void => {
    const ix = Math.max(0, Math.min(n - 2, Math.floor(px)));
    const iz = Math.max(0, Math.min(n - 2, Math.floor(pz)));
    const fx = Math.max(0, Math.min(1, px - ix));
    const fz = Math.max(0, Math.min(1, pz - iz));
    heights[iz * n + ix] += amount * (1 - fx) * (1 - fz);
    heights[iz * n + ix + 1] += amount * fx * (1 - fz);
    heights[(iz + 1) * n + ix] += amount * (1 - fx) * fz;
    heights[(iz + 1) * n + ix + 1] += amount * fx * fz;
  };
  for (let d = 0; d < count; d++) {
    let px = rng() * (n - 1);
    let pz = rng() * (n - 1);
    let dirX = 0;
    let dirZ = 0;
    let speed = 1;
    let waterVol = 1;
    let sediment = 0;
    let prevH = sampleAt(px, pz);
    for (let step = 0; step < maxLifetime; step++) {
      const ix = Math.floor(px);
      const iz = Math.floor(pz);
      if (ix < 0 || iz < 0 || ix >= n - 1 || iz >= n - 1) break;
      const fx = px - ix;
      const fz = pz - iz;
      const h00 = heights[iz * n + ix];
      const h10 = heights[iz * n + ix + 1];
      const h01 = heights[(iz + 1) * n + ix];
      const h11 = heights[(iz + 1) * n + ix + 1];
      // Gradient in height-per-cell at the droplet position.
      const gx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
      const gz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
      dirX = dirX * inertia - gx * (1 - inertia);
      dirZ = dirZ * inertia - gz * (1 - inertia);
      const len = Math.hypot(dirX, dirZ);
      if (len < 1e-9) {
        const a = rng() * (Math.PI * 2);
        dirX = Math.cos(a);
        dirZ = Math.sin(a);
      } else {
        dirX /= len;
        dirZ /= len;
      }
      const oldX = px;
      const oldZ = pz;
      px += dirX;
      pz += dirZ;
      if (px < 0 || pz < 0 || px > n - 1 || pz > n - 1) break;
      const newH = sampleAt(px, pz);
      const dh = newH - prevH;
      const capacity = Math.max(-dh * speed * waterVol * capacityFactor, minCapacity);
      if (sediment > capacity || dh > 0) {
        const amount = dh > 0 ? Math.min(dh, sediment) : sediment * depositRate;
        sediment -= amount;
        addAt(oldX, oldZ, amount);
      } else {
        const amount = Math.min((capacity - sediment) * erodeRate, -dh);
        sediment += amount;
        addAt(oldX, oldZ, -amount);
      }
      prevH = newH;
      speed = Math.sqrt(Math.max(0, speed * speed + dh * gravity));
      waterVol *= 1 - evaporateRate;
    }
  }
}

/**
 * Thermal talus relaxation on a height grid: any neighbour pair
 * steeper than the talus slope sheds half the excess downhill,
 * per pass. Jacobi-style (all transfers are computed from the
 * pass-start heights into a delta buffer), so the result does
 * not depend on the scan order and stays deterministic.
 */
function relaxThermalInPlace(
  heights: Float32Array,
  n: number,
  step: number,
  resolved: ResolvedTerrainErosion,
): void {
  if (resolved.thermal <= 0) return;
  const maxDiff = resolved.talusSlope * step;
  const rate = 0.5 * resolved.thermal;
  const delta = new Float32Array(n * n);
  for (let pass = 0; pass < resolved.thermalPasses; pass++) {
    delta.fill(0);
    let moved = false;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const h = heights[idx];
        if (i + 1 < n) {
          const diff = h - heights[idx + 1];
          if (diff > maxDiff) {
            const m = (diff - maxDiff) * rate * 0.5;
            delta[idx] -= m; delta[idx + 1] += m; moved = true;
          } else if (diff < -maxDiff) {
            const m = (-diff - maxDiff) * rate * 0.5;
            delta[idx] += m; delta[idx + 1] -= m; moved = true;
          }
        }
        if (j + 1 < n) {
          const diff = h - heights[idx + n];
          if (diff > maxDiff) {
            const m = (diff - maxDiff) * rate * 0.5;
            delta[idx] -= m; delta[idx + n] += m; moved = true;
          } else if (diff < -maxDiff) {
            const m = (-diff - maxDiff) * rate * 0.5;
            delta[idx] += m; delta[idx + n] -= m; moved = true;
          }
        }
      }
    }
    if (!moved) break;
    for (let k = 0; k < heights.length; k++) heights[k] += delta[k];
  }
}

/**
 * Run the erosion sim on a height grid in place (droplets first,
 * then talus relaxation, so the water cuts the channels and the
 * thermal pass settles their banks). Shared by the eroded-field
 * builder below and the derived maps, which differentiate their
 * own grid — both feed the same base grid through this same sim,
 * so their landscapes agree cell for cell.
 */
export function erodeHeightGridInPlace(
  heights: Float32Array,
  size: number,
  step: number,
  resolved: ResolvedTerrainErosion,
  rngSeed: number,
): void {
  erodeDropletsInPlace(heights, size, resolved, rngSeed);
  relaxThermalInPlace(heights, size, step, resolved);
}

/** The eroded height field: one baked grid + a bilinear sampler. */
export interface ErodedTerrainField {
  size: number;
  extent: number;
  step: number;
  heights: Float32Array;
}

let erodedFieldCache: { key: string; field: ErodedTerrainField } | null = null;

function erodedFieldCacheKey(terrain: GpgpuMorphTerrainOptions, fieldSeed: number): string {
  const e = terrain.erosion;
  return [
    terrain.amplitude, terrain.frequency, terrain.octaves, terrain.seed,
    terrain.kind ?? 'fbm', terrain.terraceSteps ?? 6,
    e?.water ?? 0, e?.droplets ?? 1, e?.deposit ?? 0.3,
    e?.thermal ?? 0, e?.talus ?? 0.5, e?.thermalPasses ?? 24, e?.seed ?? 0,
    fieldSeed,
  ].join('|');
}

/**
 * The eroded field for one (terrain, field seed), or null when
 * the erosion grammar resolves to null. Single-entry cache (the
 * derived-maps discipline): a parameter change replaces the
 * field wholesale. The base grid samples the analytic field on
 * the derived-maps grid exactly like buildTerrainHeightGrid, so
 * the derived maps — which erode their own copy of that grid
 * through erodeHeightGridInPlace — stay in agreement.
 */
export function getErodedTerrainField(
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): ErodedTerrainField | null {
  const resolved = resolveTerrainErosion(terrain.erosion);
  if (!resolved) return null;
  const key = erodedFieldCacheKey(terrain, fieldSeed);
  if (erodedFieldCache && erodedFieldCache.key === key) return erodedFieldCache.field;
  const n = TERRAIN_EROSION_GRID_SIZE;
  const extent = 1.05;
  const step = (extent * 2) / (n - 1);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const fz = -extent + j * step;
    for (let i = 0; i < n; i++) {
      const fx = -extent + i * step;
      heights[j * n + i] = terrainHeightAt(fx, fz, terrain, fieldSeed);
    }
  }
  erodeHeightGridInPlace(heights, n, step, resolved, erosionRngSeedFor(fieldSeed, resolved.seed));
  const field: ErodedTerrainField = { size: n, extent, step, heights };
  erodedFieldCache = { key, field };
  return field;
}

/** Bilinear sample of the eroded field at a field point
 *  (clamped to the field domain, like the derived bakes). */
export function sampleErodedField(field: ErodedTerrainField, x: number, z: number): number {
  const n = field.size;
  const gx = Math.max(0, Math.min(n - 1, (x + field.extent) / field.step));
  const gz = Math.max(0, Math.min(n - 1, (z + field.extent) / field.step));
  const ix = Math.min(n - 2, Math.floor(gx));
  const iz = Math.min(n - 2, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const h = field.heights;
  const h00 = h[iz * n + ix];
  const h10 = h[iz * n + ix + 1];
  const h01 = h[(iz + 1) * n + ix];
  const h11 = h[(iz + 1) * n + ix + 1];
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

/** Gradient of the eroded field by central differences of the
 *  sampler, with the same step as terrainGradientAt. */
export function erodedFieldGradient(
  field: ErodedTerrainField,
  x: number,
  z: number,
): { gx: number; gz: number } {
  const eps = TERRAIN_GRADIENT_EPS;
  const gx = (sampleErodedField(field, x + eps, z) - sampleErodedField(field, x - eps, z)) / (2 * eps);
  const gz = (sampleErodedField(field, x, z + eps) - sampleErodedField(field, x, z - eps)) / (2 * eps);
  return { gx, gz };
}

/** The scatter slope reference over the eroded field (the
 *  terrainScatterGradientRef computation on the sampler). */
export function erodedFieldScatterGradientRef(
  field: ErodedTerrainField,
  gridSize: number = 48,
): number {
  const n = Math.max(4, Math.floor(gridSize));
  const extent = 1.05;
  let max = 0;
  for (let j = 0; j < n; j++) {
    const fz = -extent + (j / (n - 1)) * extent * 2;
    for (let i = 0; i < n; i++) {
      const fx = -extent + (i / (n - 1)) * extent * 2;
      const { gx, gz } = erodedFieldGradient(field, fx, fz);
      const g = Math.hypot(gx, gz);
      if (g > max) max = g;
    }
  }
  return max;
}

/**
 * Height of the landscape at (x, z): the eroded field while
 * erosion is active, the analytic terrainHeightAt verbatim
 * otherwise. Loop consumers resolve the field once through
 * getErodedTerrainField and sample it directly; this is the
 * one-shot form.
 */
export function terrainHeightAtEroded(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): number {
  const field = getErodedTerrainField(terrain, fieldSeed);
  return field ? sampleErodedField(field, x, z) : terrainHeightAt(x, z, terrain, fieldSeed);
}

/** Gradient of the landscape: eroded while active, analytic
 *  verbatim otherwise (see terrainHeightAtEroded). */
export function terrainGradientAtEroded(
  x: number,
  z: number,
  terrain: GpgpuMorphTerrainOptions,
  fieldSeed: number,
): { gx: number; gz: number } {
  const field = getErodedTerrainField(terrain, fieldSeed);
  return field ? erodedFieldGradient(field, x, z) : terrainGradientAt(x, z, terrain, fieldSeed);
}

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Tesseract edges: pairs of 4D vertices differing in exactly one bit. */
const TESSERACT_EDGES: ReadonlyArray<readonly [number, number, number, number, number, number, number, number]> = (() => {
  const edges: Array<readonly [number, number, number, number, number, number, number, number]> = [];
  for (let v = 0; v < 16; v++) {
    const a: [number, number, number, number] = [v & 1 ? 1 : -1, v & 2 ? 1 : -1, v & 4 ? 1 : -1, v & 8 ? 1 : -1];
    for (let bit = 0; bit < 4; bit++) {
      if ((v & (1 << bit)) === 0) {
        const w = v | (1 << bit);
        edges.push([a[0], a[1], a[2], a[3], w & 1 ? 1 : -1, w & 2 ? 1 : -1, w & 4 ? 1 : -1, w & 8 ? 1 : -1]);
      }
    }
  }
  return edges;
})();

/**
 * Sample one point of a luma map into normalized morph space. The image
 * lies in the XY plane (facing the default camera, as in Kinetix's text
 * cloud) and luma becomes a shallow Z relief. Returns false when the
 * sampled pixel is below the luma threshold.
 */
function sampleMediaPoint(
  media: MorphMediaMap,
  rng: () => number,
  out: { x: number; y: number; z: number },
): boolean {
  const { map, width, height } = media;
  if (width <= 0 || height <= 0 || map.length < width * height) return false;
  const px = Math.min(width - 1, Math.floor(rng() * width));
  const py = Math.min(height - 1, Math.floor(rng() * height));
  const luma = map[py * width + px] ?? 0;
  if (luma < 0.3) return false;
  out.x = ((px + 0.5) / width) * 2 - 1;
  out.x *= 1.15;
  out.y = (1 - ((py + 0.5) / height) * 2) * 1.15 * (height / width);
  out.z = (luma - 0.5) * 0.35;
  return true;
}

/**
 * Build the RGBA float array (texSize^2 * 4) of morph target points in
 * world units. Pure and deterministic for a given options set.
 */
export function buildGpgpuMorphTargetData(options: GpgpuMorphTargetBuildOptions): Float32Array {
  return buildGpgpuMorphTargetDataWithNormals(options).data;
}

/**
 * The morph bake plus its companion normal cloud (Phase O). `data` is
 * exactly what buildGpgpuMorphTargetData returns (the normal path
 * consumes no RNG draws, so the points stay bit-identical).
 * `normalData` is a parallel RGBA float array whose xyz is the
 * per-particle target normal as a pure direction: replica Y-rotation
 * is applied (normals rotate with their copy) but neither the world
 * scale nor the jitter is — the velocity shader scales it by the
 * normal-speed key itself. Non-obj targets get zero normals, except
 * the obj shell fallback, whose normals are the radial direction.
 */
export function buildGpgpuMorphTargetDataWithNormals(options: GpgpuMorphTargetBuildOptions): {
  data: Float32Array;
  normalData: Float32Array;
  fractureCells: FractureCellData | null;
  /** Species zone per texel (Phase 16 stage 5): the same zone
   *  assignment that drives the normal-magnitude class, kept as
   *  its own channel so the draw can split per species. All 0
   *  when the scatter grammar is inactive or species is 1. */
  speciesData: Uint8Array;
} {
  const { texSize, target, worldScale, jitter, seed, mediaMap, svgPoints, objPoints, objNormals, replica, terrain, dataPoints, pathGeometry, path, mask, form, textOnPath, fracture, rigidFracture, scatter, contourGeometry, polygonSides, pathJitter } = options;
  const formActive = isFormDeformationActive(form);
  // Raster mask (Phase X): resolved once; null unless the mode is
  // on and the map is usable, in which case the placement branches
  // below consult it. Null keeps the legacy bake bit-identical.
  const activeMask = mask ? resolveActiveMask(mask.map, mask) : null;
  const count = texSize * texSize;
  const replicaCount = replica ? Math.max(1, Math.min(8, Math.floor(replica.count) || 1)) : 1;
  const replicaActive = replicaCount > 1 && replica != null;
  const DEG_TO_RAD = Math.PI / 180;
  const data = new Float32Array(count * 4);
  const normalData = new Float32Array(count * 4);
  // Species channel (Phase 16 stage 5): zero-filled, so every
  // non-scatter path (and scatter at species 1) yields all-zero —
  // the identity the draw side checks before splitting.
  const speciesData = new Uint8Array(count);
  const targetIndex = GPGPU_MORPH_TARGETS.indexOf(target);
  const rng = createSeededRng(((seed * 1000003 + targetIndex * 7919 + 12345) >>> 0) || 1);
  const isMedia = target === 'text' || target === 'image';
  const media = isMedia && mediaMap && mediaMap.map.length > 0 ? mediaMap : null;
  const svgPointCount = target === 'svg' && svgPoints ? Math.floor(svgPoints.length / 2) : 0;
  const objPointCount = target === 'obj' && objPoints ? Math.floor(objPoints.length / 3) : 0;
  // Attribute point cloud (Phase AK): the data target's placement
  // cloud, counted like the obj cloud; 0 (no cloud registered)
  // takes the shell fallback below, exactly like obj.
  const dataPointCount = target === 'data' && dataPoints ? Math.floor(dataPoints.length / 3) : 0;
  // Stamp 'obj' shape (Phase AA3): on the svg target the OBJ cloud
  // is a stamp PATTERN source, not the placement itself, so it is
  // counted separately (the obj placement branch above stays gated
  // on target === 'obj' via objPointCount).
  const stampObjPointCount = target === 'svg' && objPoints ? Math.floor(objPoints.length / 3) : 0;
  // Terrain (Phase L): the field seed mixes the bake seed with the
  // terrain seed offset, so gpgpuSeed still reshapes the landscape
  // while the terrain seed can vary it independently.
  const terrainOpts = target === 'terrain' ? (terrain ?? DEFAULT_TERRAIN) : null;
  const terrainFieldSeed = terrainOpts
    ? terrainFieldSeedFor(seed, terrainOpts.seed)
    : 0;
  // Terrain scatter grammar (Phase AI): resolved once for the
  // whole bake. Null (absent / all-default options) keeps the
  // legacy grid tiling bit-identical. The gradient reference is
  // only needed when the slope cap or the normal alignment can
  // bite; the reference grid costs ~48² gradient evaluations,
  // negligible next to the bake itself.
  const terrainScatter = target === 'terrain' ? resolveTerrainScatter(scatter) : null;
  // PCG rule graph (Phase 18 stage 3): the evaluated plan, only
  // while the scatter grammar is live AND the graph is enabled.
  // Null = the legacy scatter code path below, untouched.
  const pcgPlan: PcgPlan | null = terrainScatter && scatter?.pcgGraphEnabled
    ? evaluatePcgGraph(resolvePcgGraph(scatter.pcgGraphData))
    : null;
  // Terrain erosion (Phase AP): the eroded field for this bake,
  // resolved once. Null (grammar off / both strengths 0) keeps
  // every terrain sample below on the analytic path verbatim.
  const terrainErosionField = terrainOpts
    ? getErodedTerrainField(terrainOpts, terrainFieldSeed)
    : null;
  const terrainScatterGradRef = terrainScatter && terrainOpts
    && (terrainScatter.slopeMax < 1 || terrainScatter.alignNormal > 0 || (terrainScatter.bend ?? 0) > 0)
    ? (terrainErosionField
      ? erodedFieldScatterGradientRef(terrainErosionField)
      : terrainScatterGradientRef(terrainOpts, terrainFieldSeed))
    : 0;
  const mediaPoint = { x: 0, y: 0, z: 0 };
  // Path placement (Phase S): active only for the svg target with a
  // usable path geometry and a non-'off' mode. Window validation
  // follows S-1 §4.2: clamp to [0, 1]; start > end collapses to
  // end = start (a zero-width window gathers every particle at the
  // window start — a defined behaviour, never a fallback). The taper
  // strength is clamped to [0, 1] as well.
  const pathActive =
    target === 'svg' && path != null && pathGeometry != null && path.mode !== 'off' && pathGeometry.totalLength > 0;
  const pathMode = pathActive && path ? path.mode : 'off';
  const pathWinStart = path ? Math.max(0, Math.min(1, path.writeOnStart)) : 0;
  const pathWinEnd = path ? Math.max(pathWinStart, Math.max(0, Math.min(1, path.writeOnEnd))) : 1;
  const pathTaper = path ? Math.max(0, Math.min(1, path.taper)) : 0;
  const pathTaperShape = path ? path.taperShape : 'linear';
  const pathSubpathMode = path ? path.subpathMode : 'proportional';
  // Shape stamping (Phase AA3): active only in 'stamp' path mode
  // with a usable path geometry. The stamp count derives from the
  // spacing key; each replica block stamps the full path with its
  // own share of the point budget (perStamp points per stamp).
  const stampActive = pathActive && pathMode === 'stamp';
  const stampCount = stampActive && path ? stampCountForSpacing(path.stampSpacing ?? 0.125) : 0;
  const stampSize = path ? clampStampSize(path.stampSize ?? 0.18) : 0.18;
  const stampShape = path?.stampShape ?? 'disc';
  const stampAlign = path?.stampAlign !== false;
  // Text on path (Phase AF2): active only with a usable glyph set
  // on the along / writeOn path modes (stamp keeps its own
  // grammar). Glyph count 0 (empty string) disables it.
  const textOnPathActive =
    pathActive && textOnPath != null && textOnPath.glyphs.length > 0
    && (pathMode === 'along' || pathMode === 'writeOn');
  const topGlyphs = textOnPathActive && textOnPath ? textOnPath.glyphs : [];
  const topGlyphCount = topGlyphs.length;
  const topDelay = textOnPath ? textOnPath.delay : 0;
  const topSize = textOnPath ? textOnPath.size : 1;
  // Path offset (Phase AM): a single geometry transform before
  // the loop. offsetPathGeometry returns the input reference at
  // distance 0, so with the key at its default every path branch
  // below runs the authored geometry verbatim.
  const pathGeom = pathActive && pathGeometry
    ? offsetPathGeometry(pathGeometry, path?.offset ?? 0)
    : pathGeometry;
  // Per-glyph deformation (Phase AM): present only while the
  // shared builder resolved a non-zero variation set.
  const topDeform = textOnPathActive && textOnPath ? (textOnPath.deform ?? null) : null;
  // Vertical text on path (Phase 17): resolved once, like the
  // deform set above; false keeps the AF2 mapping verbatim.
  const topVertical = textOnPathActive && textOnPath ? textOnPath.vertical === true : false;
  // Contour target (Phase AM): the traced outline geometry,
  // placed with the same no-draw ordered parameter as the path
  // branch.
  const contourActive =
    target === 'contour' && contourGeometry != null && contourGeometry.totalLength > 0;
  // Polygon target (Phase AW): the side count, resolved once.
  const polygonSideCount = resolvePolygonSides(polygonSides);
  // Path jitter (Phase AW): only path-placed points move (the
  // svg path branch and the contour target place the whole cloud
  // along paths). Amount 0 / absent skips the branch entirely.
  const pathJitterAmount = typeof pathJitter === 'number' && pathJitter > 0 ? pathJitter : 0;
  const pathJitterActive = pathJitterAmount > 0 && (pathActive || contourActive);

  for (let i = 0; i < count; i++) {
    const s = rng();
    const h1 = rng();
    const h2 = rng();
    let tx = 0;
    let ty = 0;
    let tz = 0;
    // Companion normal (Phase O): only the obj target defines one.
    let nnx = 0;
    let nny = 0;
    let nnz = 0;

    // Raster mask shape (Phase X): in 'shape' mode the mask image
    // itself is the placement grammar — points are drawn from the
    // mask by seeded acceptance sampling, whatever the selected
    // target would otherwise produce (including the media targets:
    // the same rule governs morph placement and media placement).
    // A null sample (blank mask) falls through to the target's own
    // generation, exactly like a missing media map.
    const maskShapePoint = activeMask && activeMask.mode === 'shape'
      ? sampleMaskShapePoint(activeMask, rng)
      : null;

    if (maskShapePoint) {
      tx = maskShapePoint.x;
      ty = maskShapePoint.y;
      tz = maskShapePoint.z;
    } else if (objPointCount > 0 && objPoints) {
      // Imported OBJ surface cloud (Phase J): the samples are already
      // area-uniform over the mesh surface, so a seeded uniform pick
      // distributes particles evenly over the model. True 3D (xyz),
      // unlike the flat svg cloud; the shader's Y orbit supplies the
      // motion.
      const pick = Math.floor(rng() * objPointCount) * 3;
      tx = objPoints[pick] ?? 0;
      ty = objPoints[pick + 1] ?? 0;
      tz = objPoints[pick + 2] ?? 0;
      if (objNormals) {
        nnx = objNormals[pick] ?? 0;
        nny = objNormals[pick + 1] ?? 0;
        nnz = objNormals[pick + 2] ?? 0;
      }
    } else if (target === 'obj') {
      // obj requested but no usable cloud: shell fallback (as media).
      const phi = Math.acos(2 * s - 1);
      tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
      ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
      tz = 0.9 * Math.cos(phi);
      // Shell fallback normal: the radial direction of the point.
      const shellLen = Math.hypot(tx, ty, tz);
      if (shellLen > 1e-9) {
        nnx = tx / shellLen;
        nny = ty / shellLen;
        nnz = tz / shellLen;
      }
    } else if (dataPointCount > 0 && dataPoints) {
      // Attribute point cloud (Phase AK): the registered cloud's
      // positions, already in the unit-sphere convention — a
      // seeded uniform pick, the obj branch's exact form (one
      // extra RNG draw). The cloud's columns do NOT enter the
      // bake: they reach the particles through the attribute
      // texture (lib/gpgpuAttributes.ts, source 'data').
      const pick = Math.floor(rng() * dataPointCount) * 3;
      tx = dataPoints[pick] ?? 0;
      ty = dataPoints[pick + 1] ?? 0;
      tz = dataPoints[pick + 2] ?? 0;
    } else if (target === 'data') {
      // data requested but no cloud registered: shell fallback
      // (as obj / media).
      const phi = Math.acos(2 * s - 1);
      tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
      ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
      tz = 0.9 * Math.cos(phi);
      const shellLen = Math.hypot(tx, ty, tz);
      if (shellLen > 1e-9) {
        nnx = tx / shellLen;
        nny = ty / shellLen;
        nnz = tz / shellLen;
      }
    } else if (contourActive && contourGeometry) {
      // Contour target (Phase AM, lib/contourTrace.ts): the
      // traced outline of the selected luma source, placed like
      // the authored path — particle i owns the ordered contour
      // parameter p = (i + 0.5) / count over the concatenated
      // arc length (proportional across subpaths). No RNG draws,
      // exactly like the Phase S branch; the replica grammar
      // below still applies its per-copy transform afterwards.
      const p = (i + 0.5) / count;
      const resolved = resolvePathPoint(contourGeometry, p, 'proportional');
      tx = resolved.x;
      ty = resolved.y;
      tz = 0;
    } else if (target === 'contour') {
      // contour requested but no usable outline (blank or
      // saturated source at the threshold): shell fallback
      // (as media / obj / data).
      const phi = Math.acos(2 * s - 1);
      tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
      ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
      tz = 0.9 * Math.cos(phi);
    } else if (stampActive && pathGeom) {
      // Shape stamping (Phase AA3, Tao-style): the block's points
      // are grouped into `stampCount` consecutive stamps along the
      // path. Stamp k sits at equal arc-length parameter
      // (k + 0.5) / stampCount (resolved through the path geometry,
      // honouring the subpath mode); its points form the selected
      // shape in the path plane, rotated onto the tangent when
      // alignment is on. 'obj' stamps sample the imported OBJ cloud
      // (scaled into the stamp, z kept for depth) and fall back to
      // the disc pattern without a usable cloud. This branch
      // consumes no RNG draws, like the Phase S branch.
      const r = Math.min(replicaCount - 1, Math.floor((i * replicaCount) / count));
      const blockStart = Math.ceil((r * count) / replicaCount);
      const blockEnd = Math.ceil(((r + 1) * count) / replicaCount);
      const blockSize = Math.max(1, blockEnd - blockStart);
      const perStamp = Math.max(1, Math.ceil(blockSize / stampCount));
      const localIdx = i - blockStart;
      const k = Math.min(stampCount - 1, Math.floor(localIdx / perStamp));
      const j = localIdx - k * perStamp;
      const resolved = resolvePathPoint(pathGeom!, stampCenterS(k, stampCount), pathSubpathMode);
      if (stampShape === 'obj' && stampObjPointCount > 0 && objPoints) {
        const pick = ((j * 37 + k * 131) % stampObjPointCount) * 3;
        const lx = (objPoints[pick] ?? 0) * stampSize;
        const ly = (objPoints[pick + 1] ?? 0) * stampSize;
        const placed = placeStampPoint(
          { x: lx, y: ly },
          { x: resolved.x, y: resolved.y },
          { x: resolved.tangentX, y: resolved.tangentY },
          stampAlign,
        );
        tx = placed.x;
        ty = placed.y;
        tz = (objPoints[pick + 2] ?? 0) * stampSize;
      } else {
        const local = stampLocalPoint(stampShape === 'obj' ? 'disc' : stampShape, j, perStamp, stampSize);
        const placed = placeStampPoint(
          local,
          { x: resolved.x, y: resolved.y },
          { x: resolved.tangentX, y: resolved.tangentY },
          stampAlign,
        );
        tx = placed.x;
        ty = placed.y;
        tz = 0;
      }
    } else if (textOnPathActive && pathGeom) {
      // Text on path (Phase AF2, lib/gpgpuTextOnPath.ts): the
      // particle's ordered path parameter p (the same replica
      // block mapping as the plain path branch) selects a virtual
      // slot. A glyph slot places the particle inside that
      // glyph's luma raster — sampled with the bake RNG under the
      // media grammar — centred on the path point at the sampled
      // horizontal fraction, offset along the path normal by the
      // sampled vertical fraction (glyph top toward +normal). A
      // delay gap, or a glyph without ink (a space), keeps the
      // plain path placement below, taper included.
      const r = Math.min(replicaCount - 1, Math.floor((i * replicaCount) / count));
      const blockStart = Math.ceil((r * count) / replicaCount);
      const blockEnd = Math.ceil(((r + 1) * count) / replicaCount);
      const f = (i - blockStart + 0.5) / Math.max(1, blockEnd - blockStart);
      const p = (r + f) / replicaCount;
      const hit = textOnPathSlotAt(p, topGlyphCount, topDelay);
      // Per-glyph deformation (Phase AM): the fade test draws
      // h1 AFTER the glyph sampler's draws, so the legacy bake
      // (no deform set) consumes exactly the AF2 draw order.
      // A faded particle keeps the plain path placement below —
      // the fade is a density expression, not an alpha.
      let glyphPoint = hit.glyph >= 0 ? sampleTextGlyphPoint(topGlyphs[hit.glyph], rng) : null;
      let deformPt: { lx: number; ly: number } | null = null;
      if (hit.glyph >= 0 && glyphPoint && topDeform) {
        const deform = textGlyphDeform(hit.glyph, topDeform.scaleVar, topDeform.rotateDeg, topDeform.fadeVar);
        if (deform.fade > 0 && h1 < deform.fade) {
          glyphPoint = null;
        } else {
          deformPt = deformGlyphPoint(glyphPoint.lx, glyphPoint.ly, deform);
        }
      }
      if (hit.glyph >= 0 && glyphPoint) {
        const pt = deformPt ?? glyphPoint;
        const cellH = (pathGeom!.totalLength / topGlyphCount) * topSize;
        if (topVertical) {
          // Vertical text on path (Phase 17): the glyph's
          // vertical axis lies along the path tangent — the
          // sampled vertical fraction (ly, 0 = the glyph's top)
          // drives the path parameter, so the top sits at the
          // slot's start (against the direction of travel) and
          // the bottom at its end; the horizontal fraction (lx)
          // drives the normal offset, the glyph's right edge
          // toward +normal. The slot layout, RNG draws and
          // deform handling above are the AF2 ones unchanged.
          const sRaw = textOnPathGlyphS(hit.glyph, pt.ly, topGlyphCount, topDelay);
          const s01 = pathMode === 'writeOn' ? pathWinStart + (pathWinEnd - pathWinStart) * sRaw : sRaw;
          const resolved = resolvePathPoint(pathGeom!, s01, pathSubpathMode);
          const off = (pt.lx - 0.5) * cellH;
          tx = resolved.x + -resolved.tangentY * off;
          ty = resolved.y + resolved.tangentX * off;
          tz = 0;
        } else {
          const sRaw = textOnPathGlyphS(hit.glyph, pt.lx, topGlyphCount, topDelay);
          const s01 = pathMode === 'writeOn' ? pathWinStart + (pathWinEnd - pathWinStart) * sRaw : sRaw;
          const resolved = resolvePathPoint(pathGeom!, s01, pathSubpathMode);
          const off = (0.5 - pt.ly) * cellH;
          tx = resolved.x + -resolved.tangentY * off;
          ty = resolved.y + resolved.tangentX * off;
          tz = 0;
        }
      } else {
        const s01 = pathMode === 'writeOn' ? pathWinStart + (pathWinEnd - pathWinStart) * p : p;
        const resolved = resolvePathPoint(pathGeom!, s01, pathSubpathMode);
        tx = resolved.x;
        ty = resolved.y;
        tz = 0;
        if (pathTaper > 0) {
          const w = taperWidthAt(p, pathTaper, pathTaperShape) * PATH_TAPER_MAX_WIDTH;
          if (w > 0) {
            const off = (h2 - 0.5) * w;
            tx += -resolved.tangentY * off;
            ty += resolved.tangentX * off;
          }
        }
      }
    } else if (pathActive && pathGeom) {
      // Authored path placement (Phase S): particle i owns the path
      // position p = (r + f) / replicaCount, where r is its replica
      // block (the same contiguous block mapping the replica grammar
      // below applies) and f its position inside the block — so each
      // replica copy receives one contiguous segment of the path
      // (brief §0-3), never a repetition of the whole path. 'along'
      // maps p onto the full path; 'writeOn' maps it into the
      // [writeOnStart, writeOnEnd] window. The taper offsets the
      // point along the path normal by (h2 - 0.5) * w(u), reusing
      // the existing h2 draw — this branch consumes no RNG draws, so
      // 'off' keeps the legacy consumption order exactly.
      const r = Math.min(replicaCount - 1, Math.floor((i * replicaCount) / count));
      const blockStart = Math.ceil((r * count) / replicaCount);
      const blockEnd = Math.ceil(((r + 1) * count) / replicaCount);
      const f = (i - blockStart + 0.5) / Math.max(1, blockEnd - blockStart);
      const p = (r + f) / replicaCount;
      const s01 = pathMode === 'writeOn' ? pathWinStart + (pathWinEnd - pathWinStart) * p : p;
      const resolved = resolvePathPoint(pathGeom!, s01, pathSubpathMode);
      tx = resolved.x;
      ty = resolved.y;
      tz = 0;
      if (pathTaper > 0) {
        const w = taperWidthAt(p, pathTaper, pathTaperShape) * PATH_TAPER_MAX_WIDTH;
        if (w > 0) {
          const off = (h2 - 0.5) * w;
          tx += -resolved.tangentY * off;
          ty += resolved.tangentX * off;
        }
      }
    } else if (svgPointCount > 0 && svgPoints) {
      // Imported SVG outline cloud (Pro-2): the samples are already
      // arc-length uniform, so a seeded uniform pick distributes
      // particles evenly over the logo outline. Flat in Z, like the
      // text cloud; the shader's Y orbit supplies the motion.
      const pick = Math.floor(rng() * svgPointCount) * 2;
      tx = svgPoints[pick] ?? 0;
      ty = svgPoints[pick + 1] ?? 0;
      tz = 0;
    } else if (target === 'svg') {
      // svg requested but no usable cloud: shell fallback (as media).
      const phi = Math.acos(2 * s - 1);
      tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
      ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
      tz = 0.9 * Math.cos(phi);
    } else if (media) {
      let placed = false;
      for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        placed = sampleMediaPoint(media, rng, mediaPoint);
      }
      if (placed) {
        tx = mediaPoint.x;
        ty = mediaPoint.y;
        tz = mediaPoint.z;
      } else {
        // No lit pixel found (blank map): fall back to a thin shell so
        // the force still gathers particles into a visible form.
        const phi = Math.acos(2 * s - 1);
        tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
        ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
        tz = 0.9 * Math.cos(phi);
      }
    } else if (isMedia) {
      // text/image requested but no media map is available: shell fallback.
      const phi = Math.acos(2 * s - 1);
      tx = 0.9 * Math.sin(phi) * Math.cos(h1 * TAU);
      ty = 0.9 * Math.sin(phi) * Math.sin(h1 * TAU);
      tz = 0.9 * Math.cos(phi);
    } else {
      switch (target) {
        case 'trefoil': {
          // Trefoil knot curve with a small tube cross-section.
          const t = s * TAU;
          const tubeR = 0.22 + 0.14 * h1;
          const tubeA = h2 * TAU;
          tx = (Math.sin(t) + 2 * Math.sin(2 * t)) * 0.36 + Math.cos(tubeA) * tubeR * 0.45;
          ty = (Math.cos(t) - 2 * Math.cos(2 * t)) * 0.36 + Math.sin(tubeA) * tubeR * 0.45;
          tz = -Math.sin(3 * t) * 0.45;
          break;
        }
        case 'torusKnot': {
          const p = 3;
          const q = 5;
          const t = s * TAU;
          const r = 0.65 + 0.28 * Math.cos(q * t);
          tx = r * Math.cos(p * t) * 0.95;
          ty = Math.sin(q * t) * 0.42;
          tz = r * Math.sin(p * t) * 0.95;
          break;
        }
        case 'galaxy': {
          const arms = 3;
          const arm = i % arms;
          const rad = Math.pow(s, 0.72) * 1.15;
          const spin = rad * 4.4 + (arm * TAU) / arms;
          const scatter = (1 - rad * 0.45) * 0.18;
          tx = Math.cos(spin) * rad + (h1 - 0.5) * scatter;
          tz = Math.sin(spin) * rad + (h2 - 0.5) * scatter;
          ty = (h1 - 0.5) * 0.14 * Math.exp(-rad * 1.6);
          break;
        }
        case 'mobius': {
          const u = s * TAU;
          const v = (h1 - 0.5) * 0.55;
          const r = 0.85 + v * Math.cos(u * 0.5);
          tx = r * Math.cos(u);
          tz = r * Math.sin(u);
          ty = v * Math.sin(u * 0.5) * 1.4;
          break;
        }
        case 'geodesic': {
          // Fibonacci sphere (geodesic-style even distribution).
          const n = 512;
          const k = i % n;
          const y = 1 - (k / (n - 1)) * 2;
          const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
          const theta = GOLDEN_ANGLE * k;
          const pulse = 0.92 + 0.12 * Math.sin(y * 3.0);
          tx = Math.cos(theta) * radiusAtY * pulse;
          ty = y * pulse;
          tz = Math.sin(theta) * radiusAtY * pulse;
          break;
        }
        case 'crown': {
          const t = s * TAU;
          const lobes = 7;
          const r = 0.88 + 0.16 * Math.cos(lobes * t);
          tx = Math.cos(t) * r;
          tz = Math.sin(t) * r;
          ty = Math.sin(lobes * t) * 0.28 + (h1 - 0.5) * 0.12;
          break;
        }
        case 'blackhole': {
          if (i % 6 === 0) {
            // Polar jets.
            const dir = i % 12 === 0 ? 1 : -1;
            const h = Math.pow(h1, 0.8) * 1.35;
            const coneR = 0.05 + h * 0.16;
            const a = s * TAU;
            tx = Math.cos(a) * coneR;
            tz = Math.sin(a) * coneR;
            ty = dir * (0.15 + h);
          } else {
            // Accretion disc.
            const rad = 0.34 + Math.pow(s, 0.65) * 0.95;
            const angle = h2 * TAU;
            tx = Math.cos(angle) * rad;
            tz = Math.sin(angle) * rad;
            ty = (h1 - 0.5) * 0.08 * Math.exp(-rad * 0.8);
          }
          break;
        }
        case 'klein': {
          // Figure-8 immersion of the Klein bottle.
          const u = s * TAU;
          const v = h1 * TAU;
          const r = 0.42;
          const halfU = u * 0.5;
          const base = 0.85 + (Math.cos(halfU) * Math.sin(v) - Math.sin(halfU) * Math.sin(2 * v) * 0.5) * r;
          tx = base * Math.cos(u);
          tz = base * Math.sin(u);
          ty = (Math.sin(halfU) * Math.sin(v) + Math.cos(halfU) * Math.sin(2 * v) * 0.5) * r * 1.4;
          break;
        }
        case 'cymatic': {
          // Spherical-harmonic resonance shell over a Fibonacci sphere.
          const n = 720;
          const k = i % n;
          const y = 1 - (k / (n - 1)) * 2;
          const phi = Math.acos(Math.max(-1, Math.min(1, y)));
          const theta = GOLDEN_ANGLE * k;
          const harmonic = 1.0 + 0.26 * Math.sin(6 * phi) * Math.cos(5 * theta);
          const sinPhi = Math.sin(phi);
          tx = sinPhi * Math.cos(theta) * harmonic;
          ty = y * harmonic;
          tz = sinPhi * Math.sin(theta) * harmonic;
          break;
        }
        case 'gyroid': {
          // Gyroid TPMS harmonic projection.
          const u = s * TAU;
          const v = (h1 - 0.5) * TAU;
          const w = (h2 - 0.5) * 1.4;
          const f = Math.sin(u) * Math.cos(v) + Math.sin(v) * Math.cos(w) + Math.sin(w) * Math.cos(u);
          const r = 0.85 - f * 0.26;
          tx = r * Math.cos(u) * Math.cos(v * 0.5);
          ty = Math.sin(v) * 0.85 + Math.cos(u * 2.0) * 0.14;
          tz = r * Math.sin(u) * Math.cos(v * 0.5);
          break;
        }
        case 'dnaRibbon': {
          const t = (s - 0.5) * 2.0;
          const ang = t * Math.PI * 3.5;
          const r = 0.62;
          if (i % 5 === 0) {
            const rungT = h1 * 2 - 1;
            tx = Math.cos(ang) * r * rungT;
            tz = Math.sin(ang) * r * rungT;
            ty = t * 1.25;
          } else {
            const strand = i % 2 === 0 ? 0 : Math.PI;
            tx = Math.cos(ang + strand) * r + (h1 - 0.5) * 0.08;
            tz = Math.sin(ang + strand) * r + (h2 - 0.5) * 0.08;
            ty = t * 1.25;
          }
          break;
        }
        case 'hypercube': {
          // Points along tesseract edges, perspective-projected from 4D
          // at phase 0; the shader's Y orbit supplies the motion (the
          // true XW/YW 4D rotation is not reproduced — see header note
          // in the B1a report).
          const edge = TESSERACT_EDGES[i % TESSERACT_EDGES.length];
          const u = ((s * 7.31 + h1 * 0.37) % 1 + 1) % 1;
          const vx = edge[0] + (edge[4] - edge[0]) * u;
          const vy = edge[1] + (edge[5] - edge[1]) * u;
          const vz = edge[2] + (edge[6] - edge[2]) * u;
          const vw = edge[3] + (edge[7] - edge[3]) * u;
          const proj = 1.65 / (2.75 - vw);
          tx = vx * proj * 0.72;
          ty = vy * proj * 0.72;
          tz = vz * proj * 0.72;
          break;
        }
        case 'mandelbulb': {
          // Fibonacci directions folded by the power-8 spherical map:
          // a bulb-like point mass, not the raymarched surface.
          const n = 1024;
          const k = i % n;
          const yBase = 1 - (k / (n - 1)) * 2;
          const phi = Math.acos(Math.max(-1, Math.min(1, yBase)));
          const theta = GOLDEN_ANGLE * k;
          const sinP = Math.sin(phi);
          const dx = sinP * Math.cos(theta);
          const dy = yBase;
          const dz = sinP * Math.sin(theta);
          let mx = dx;
          let my = dy;
          let mz = dz;
          let mRad = 1.0;
          for (let it = 0; it < 3; it++) {
            const r = Math.hypot(mx, my, mz) || 1.0;
            const th = Math.acos(Math.max(-1, Math.min(1, my / r))) * 8.0;
            const ph = Math.atan2(mz, mx) * 8.0;
            const sTh = Math.sin(th);
            mx = sTh * Math.cos(ph) + dx * 0.55;
            my = Math.cos(th) + dy * 0.55;
            mz = sTh * Math.sin(ph) + dz * 0.55;
            mRad = 0.72 + 0.34 * Math.tanh((Math.hypot(mx, my, mz) - 1.1) * 1.4);
          }
          const shellR = mRad * (0.9 + 0.14 * h1);
          tx = dx * shellR;
          ty = dy * shellR;
          tz = dz * shellR;
          break;
        }
        case 'terrain': {
          // Seeded height field (Phase L, Mir-style): particles
          // tile the XZ domain on the bake grid — one particle per
          // grid cell, jittered inside the cell by the shared rng
          // draws (s, h1) — and take the field height as Y. The
          // field is a pure function (terrainHeightAt), so the same
          // config always grows the same landscape. Height-driven
          // colour is the gradient 'height' driver's job.
          const extent = 1.05;
          const cellX = i % texSize;
          const cellZ = Math.floor(i / texSize);
          if (terrainScatter && terrainOpts) {
            // Scatter grammar (Phase AI): candidates are drawn
            // (the particle's own cell first, then fresh random
            // cells) and accepted with the probability the terrain
            // conditions give them (density × height band × slope
            // cap), so the point distribution concentrates where
            // the conditions allow — the foliage reading of the
            // fixed pool. If no candidate is accepted, the
            // highest-probability candidate seen is used, so the
            // pool size and the surface coverage survive any
            // condition set. Extra RNG draws are consumed only
            // inside this branch.
            let accX = 0;
            let accY = 0;
            let accZ = 0;
            let accGx = 0;
            let accGz = 0;
            let accT = 0.5;
            let bestP = -1;
            let placed = false;
            // PCG plan: a disabled sampler places the particle's
            // own cell directly (1 attempt, no acceptance draw);
            // otherwise the sampler node's attempts apply.
            const scatterAttempts = pcgPlan
              ? (pcgPlan.samplerEnabled ? pcgPlan.attempts : 1)
              : TERRAIN_SCATTER_ATTEMPTS;
            for (let attempt = 0; attempt < scatterAttempts && !placed; attempt++) {
              let cx: number;
              let cz: number;
              if (attempt === 0) {
                cx = (((cellX + s) / texSize) * 2 - 1) * extent;
                cz = (((cellZ + h1) / texSize) * 2 - 1) * extent;
              } else {
                const rcx = Math.floor(rng() * texSize);
                const rcz = Math.floor(rng() * texSize);
                cx = (((rcx + rng()) / texSize) * 2 - 1) * extent;
                cz = (((rcz + rng()) / texSize) * 2 - 1) * extent;
              }
              const h = terrainErosionField
                ? sampleErodedField(terrainErosionField, cx, cz)
                : terrainHeightAt(cx, cz, terrainOpts, terrainFieldSeed);
              const t = terrainOpts.amplitude > 0
                ? Math.max(0, Math.min(1, h / terrainOpts.amplitude * 0.5 + 0.5))
                : 0.5;
              let gx = 0;
              let gz = 0;
              let slopeNorm = 0;
              if (terrainScatterGradRef > 0) {
                const g = terrainErosionField
                  ? erodedFieldGradient(terrainErosionField, cx, cz)
                  : terrainGradientAt(cx, cz, terrainOpts, terrainFieldSeed);
                gx = g.gx;
                gz = g.gz;
                slopeNorm = Math.min(1, Math.hypot(gx, gz) / terrainScatterGradRef);
              }
              const p = pcgPlan
                ? (pcgPlan.samplerEnabled ? pcgAcceptance(pcgPlan, terrainScatter, t, slopeNorm) : 1)
                : terrainScatterAcceptance(terrainScatter, t, slopeNorm);
              if (p > bestP) {
                bestP = p;
                accX = cx; accY = h; accZ = cz; accGx = gx; accGz = gz; accT = t;
              }
              if (p >= 1 || (p > 0 && rng() < p)) {
                // The accepted candidate itself is placed (not an
                // earlier, luckier one); the best-seen record above
                // is only the no-acceptance fallback.
                accX = cx; accY = h; accZ = cz; accGx = gx; accGz = gz; accT = t;
                placed = true;
              }
            }
            tx = accX;
            ty = accY;
            tz = accZ;
            if (pcgPlan) {
              // PCG transformers run in graph order over a shared
              // register: 'species' sets the zone + magnitude class
              // register, 'align-normal' writes the companion
              // normal using the class register AS IT STANDS — so
              // align before species (or species disabled) writes
              // the class-1 normal, exactly the preceding-register
              // semantics. With the default order this reproduces
              // the legacy statements below verbatim.
              let speciesApplied = false;
              for (const op of pcgPlan.transformerOps) {
                if (op === 'species') {
                  if (terrainScatter.species > 1) {
                    speciesData[i] = terrainScatterSpeciesZone(terrainScatter, accT);
                  }
                  speciesApplied = true;
                } else if (op === 'align-normal') {
                  const strength = pcgStepStrength(pcgPlan, 'align-normal');
                  const baseScatter = speciesApplied ? terrainScatter : { ...terrainScatter, species: 1 };
                  const effScatter = strength >= 1
                    ? baseScatter
                    : { ...baseScatter, alignNormal: baseScatter.alignNormal * strength, bend: (baseScatter.bend ?? 0) * strength };
                  if (effScatter.alignNormal > 0 || (effScatter.bend ?? 0) > 0) {
                    const fin = terrainScatterFinishNormal(
                      effScatter, accGx, accGz, accT,
                      terrainScatterHash01(i, 11.31), terrainScatterHash01(i, 47.97),
                    );
                    nnx = fin.x;
                    nny = fin.y;
                    nnz = fin.z;
                  }
                }
              }
            } else {
              // Species channel (Phase 16 stage 5): the placed
              // candidate's zone, from the same accT the species
              // class below is computed from.
              if (terrainScatter.species > 1) {
                speciesData[i] = terrainScatterSpeciesZone(terrainScatter, accT);
              }
              // Posture (法線整列): the companion normal becomes the
              // terrain normal, its magnitude carrying the species
              // class of the particle's height zone. With alignment
              // 0 the normals stay zero, exactly like the legacy
              // terrain bake.
              if (terrainScatter.alignNormal > 0 || (terrainScatter.bend ?? 0) > 0) {
                // Phase AX: the finishing (scale / rotation
                // randomisation + bend) wraps the Phase AI aligned
                // normal; at its defaults the helper returns the
                // Phase AI statement verbatim.
                const fin = terrainScatterFinishNormal(
                  terrainScatter, accGx, accGz, accT,
                  terrainScatterHash01(i, 11.31), terrainScatterHash01(i, 47.97),
                );
                nnx = fin.x;
                nny = fin.y;
                nnz = fin.z;
              }
            }
          } else {
            tx = (((cellX + s) / texSize) * 2 - 1) * extent;
            tz = (((cellZ + h1) / texSize) * 2 - 1) * extent;
            ty = terrainOpts
              ? (terrainErosionField
                ? sampleErodedField(terrainErosionField, tx, tz)
                : terrainHeightAt(tx, tz, terrainOpts, terrainFieldSeed))
              : 0;
          }
          break;
        }
        case 'polygon': {
          // Regular-polygon plate (Phase AW): points fill the
          // polygon's disc in the XZ plane — the angle is the
          // shared s draw, the radius sqrt(h1) (area-uniform)
          // scaled by the polygon boundary radius at that angle,
          // so the density stays even out to the vertices. The
          // plate is thin: ty is a small h2 jitter slab.
          const theta = s * TAU;
          const rad = Math.sqrt(h1) * polygonRadiusAt(theta, polygonSideCount) * 0.95;
          tx = Math.cos(theta) * rad;
          tz = Math.sin(theta) * rad;
          ty = (h2 - 0.5) * 0.08;
          break;
        }
        case 'shell': {
          // Logarithmic Fibonacci nautilus shell.
          const t = s * Math.PI * 5.2;
          const u = h1 * TAU;
          const growth = Math.exp(0.145 * t);
          const tubeR = 0.055 * growth * (1.0 + 0.08 * Math.sin(t * 6.0));
          const mainR = 0.12 * growth;
          tx = (mainR + tubeR * Math.cos(u)) * Math.cos(t) * 0.42;
          tz = (mainR + tubeR * Math.cos(u)) * Math.sin(t) * 0.42;
          ty = (tubeR * Math.sin(u) + (s - 0.5) * 0.25 * growth * 0.12) * 0.42;
          break;
        }
        default:
          break;
      }
    }

    // Raster mask clip (Phase X): a baked point in a rejected
    // region is relocated into the mask by the same deterministic
    // acceptance sampler the 'shape' mode uses, so the target
    // density survives inside the mask instead of piling up or
    // vanishing at bake time; the draw shader's fragment clip then
    // enforces the mask on live positions. If the sampler finds no
    // accepted pixel the point is kept (the fragment clip still
    // applies). The obj normal is dropped for relocated points.
    if (activeMask && activeMask.mode === 'clip' && !maskAcceptsAt(activeMask, tx, ty)) {
      const relocated = sampleMaskShapePoint(activeMask, rng);
      if (relocated) {
        tx = relocated.x;
        ty = relocated.y;
        tz = relocated.z;
        nnx = 0;
        nny = 0;
        nnz = 0;
      }
    }

    // Form-dedicated deformation (Phase AA2): Disperse / Twist /
    // Fractal Field over the base point, in normalised space,
    // before the replica grammar so every copy inherits the same
    // deformed form. Skipped entirely when inactive (the legacy
    // bake is then bit-identical). The twist also rotates the
    // companion normal by the same angle around the same axis;
    // disperse / fractal leave normals as-is (documented
    // approximation — normals only feed the OBJ initial velocity).
    if (formActive && form) {
      const twistAngle = formTwistAngleAt({ x: tx, y: ty, z: tz }, form);
      const deformed = applyFormDeformation({ x: tx, y: ty, z: tz }, i, form);
      tx = deformed.x;
      ty = deformed.y;
      tz = deformed.z;
      if (twistAngle !== 0 && (nnx !== 0 || nny !== 0 || nnz !== 0)) {
        const rn = rotateAroundAxis({ x: nnx, y: nny, z: nnz }, form.twistAxis, twistAngle);
        nnx = rn.x;
        nny = rn.y;
        nnz = rn.z;
      }
    }

    // Replica grammar (Phase K): contiguous blocks of the particle
    // range form the copies, so i-patterned targets (galaxy arms,
    // DNA strands) keep every sub-pattern inside each copy. The base
    // point of particle i is untouched — only its copy's cumulative
    // transform is applied — and the copy's orbit phase offset rides
    // in the alpha channel for the velocity shader.
    let alpha = 1;
    if (replicaActive && replica) {
      const r = Math.min(replicaCount - 1, Math.floor((i * replicaCount) / count));
      if (r > 0) {
        const sc = Math.pow(replica.scaleStep, r);
        tx *= sc;
        ty *= sc;
        tz *= sc;
        const ang = replica.rotationDeg * r * DEG_TO_RAD;
        if (ang !== 0) {
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const nx = tx * ca - tz * sa;
          const nz = tx * sa + tz * ca;
          tx = nx;
          tz = nz;
          // Normals rotate with their copy (no scale / translation).
          const gnx = nnx * ca - nnz * sa;
          const gnz = nnx * sa + nnz * ca;
          nnx = gnx;
          nnz = gnz;
        }
        if (replica.axis === 'x') tx += replica.spacing * r;
        else if (replica.axis === 'y') ty += replica.spacing * r;
        else tz += replica.spacing * r;
      }
      alpha = replica.phaseStepDeg * r * DEG_TO_RAD;
    }

    // Path jitter (Phase AW): displace the finished point by
    // its position hash (lib/pathJitter.ts), so points sharing a
    // path joint move together and the polyline never tears.
    // Only entered for path placements with a positive amount.
    if (pathJitterActive) {
      const pj = pathJitterOffset(tx, ty, tz, pathJitterAmount);
      tx += pj.x;
      ty += pj.y;
      tz += pj.z;
    }

    const jx = (h1 - 0.5) * jitter;
    const jy = (h2 - 0.5) * jitter;
    const jz = (((h1 + h2) % 1) - 0.5) * jitter;
    const o = i * 4;
    data[o] = (tx + jx) * worldScale;
    data[o + 1] = (ty + jy) * worldScale;
    data[o + 2] = (tz + jz) * worldScale;
    data[o + 3] = alpha;
    normalData[o] = nnx;
    normalData[o + 1] = nny;
    normalData[o + 2] = nnz;
    normalData[o + 3] = 0;
  }
  // Rigid body cell data (Phase AU): computed from the finished
  // cloud BEFORE the fracture transform below mutates it, with
  // the same division options, so the solver's initial placement
  // reproduces the (possibly fractured) cloud exactly. Read-only
  // over the data — the bake itself is untouched by the request.
  const fractureCells = rigidFracture
    ? buildFractureCellData(data, count, rigidFracture)
    : null;
  // Voronoi fracture (Phase AG): post-pass over the finished
  // cloud. Skipped entirely unless the option is present, so the
  // default bake stays bit-identical.
  if (fracture) {
    applyVoronoiFracture(data, count, fracture);
  }
  return { data, normalData, fractureCells, speciesData };
}
