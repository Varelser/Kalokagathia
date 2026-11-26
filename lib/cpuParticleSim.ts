// CPU particle simulation for the fallback renderer (2026-11-15).
//
// A deliberately small subset of the full engine, integrated on the CPU
// in normalised space (the layer layout's unit sphere, roughly [-1, 1]):
//   - a spring back to each particle's home position (the CPU layout
//     produced by components/particleData.ts), so the preset's shape
//     stays recognisable;
//   - a cheap analytic curl-ish flow field, plus the GPGPU vortex /
//     wind / gravity terms when those are enabled;
//   - or, when the GPGPU strange attractor is enabled, the attractor's
//     own ODE — the same formulas as the velocity shader
//     (components/gpgpuShaderSimulationVelocity.ts), driven the same
//     way (normalised derivative × strength × dt × 40).
// Everything is seeded (mulberry32 over the config's seed/counts), so
// the degraded picture is stable between reloads. Full config parity
// is explicitly NOT a goal — see CPU_FALLBACK_BRIEF.md.
//
// Phase X2 ports the three leftovers of PHASE_R_REPORT #4 with the
// WebGL semantics: (a) the OBJ normal initial velocity (Phase O kick),
// (b) morph attraction inside attractor mode (the velocity shader
// applies both forces in one pass), and (c) the replica age phase
// (Phase M), which brings the age lifecycle itself — advance, wrap
// with per-replica restart offsets, respawn at the layout home, and
// the fade envelope the scene applies when drawing.

import type { ParticleConfig } from '../types';
import { buildGpgpuMorphTargetDataWithNormals } from './gpgpuMorphTargets';
import type { MorphMediaMap } from './gpgpuMorphTargets';
import type { PathGeometry } from './pathGeometry';
import type { TextGlyphRaster } from './gpgpuTextOnPath';
import { fractureOptionFromConfig } from './voronoiFracture';

export const CPU_PARTICLE_CAP = 4000;
const CPU_PARTICLE_MIN = 240;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(config: ParticleConfig): number {
  let seed = (config.gpgpuSeed || 1) >>> 0;
  seed = Math.imul(seed ^ (config.layer1Count | 0), 0x5deb38b3);
  seed = Math.imul(seed ^ (config.layer2Count | 0), 0x4a4f9b17);
  seed = Math.imul(seed ^ (config.layer3Count | 0), 0x27d4eb2f);
  return seed >>> 0;
}

/** How many particles the CPU renderer simulates for this config. */
export function resolveCpuParticleCount(config: ParticleConfig): number {
  let total = 0;
  if (config.layer1Enabled) total += Math.max(0, config.layer1Count || 0);
  if (config.layer2Enabled) total += Math.max(0, config.layer2Count || 0);
  if (config.layer3Enabled) total += Math.max(0, config.layer3Count || 0);
  if (config.gpgpuEnabled) total += Math.max(0, Math.min(config.gpgpuCount || 0, 20000));
  if (total <= 0) total = 1200;
  return Math.max(CPU_PARTICLE_MIN, Math.min(CPU_PARTICLE_CAP, Math.round(total)));
}

export function isCpuAttractorMode(config: ParticleConfig): boolean {
  return Boolean(config.gpgpuEnabled && config.gpgpuAttractorEnabled);
}

// ---------------------------------------------------------------------
// Morph attraction (Phase R): the GPGPU morph bake is a pure TS
// function, so the CPU sim reuses the very same baked cloud. The bake
// runs at a small fixed texSize (64^2 = 4,096 texels >= the 4,000
// particle cap) and each CPU particle owns texel i — the same 1:1
// assignment the velocity shader uses. The bake's world scale is
// morphScale * bounceRadius * 0.48 in GPGPU world units; the CPU sim
// lives in normalised space (unit sphere), so the targets are baked
// directly at morphScale * 0.48 normalised units.

export const CPU_MORPH_TEX_SIZE = 64;

/** Morph is live on the CPU path exactly when it would be on the GPU
 * path: the GPGPU system on + the morph toggle on. Since Phase X2 the
 * morph force also applies inside attractor mode, mirroring the
 * velocity shader, where both forces compose in a single pass. */
export function isCpuMorphActive(config: ParticleConfig): boolean {
  return Boolean(config.gpgpuEnabled && config.gpgpuMorphEnabled);
}

/** The age (Particle Life) system is live on the CPU path when the
 * GPGPU age toggle is on and a positive lifespan is configured. */
export function isCpuAgeLive(config: ParticleConfig): boolean {
  return Boolean(config.gpgpuEnabled && config.gpgpuAgeEnabled && (config.gpgpuAgeMax || 0) > 0);
}

/** Replica count as every consumer clamps it (bake / initial data). */
export function cpuReplicaCount(config: ParticleConfig): number {
  return Math.max(1, Math.min(8, Math.floor(config.gpgpuMorphReplicaCount || 1)));
}

/**
 * Replica block of bake texel i under the contiguous mapping shared
 * by the morph bake, the initial data and the position shader:
 * r = floor(i * count / total), with total the full bake grid
 * (CPU_MORPH_TEX_SIZE^2) — NOT the CPU particle count, because CPU
 * particle i owns bake texel i.
 */
export function cpuReplicaIndexOf(i: number, replicaCount: number): number {
  const total = CPU_MORPH_TEX_SIZE * CPU_MORPH_TEX_SIZE;
  return Math.min(replicaCount - 1, Math.floor((i * replicaCount) / total));
}

/** Replica age phase (Phase M) gate, mirroring useGpgpuRuntime:
 * morph on, more than one copy, step > 0. */
export function isCpuReplicaAgePhaseActive(config: ParticleConfig): boolean {
  return Boolean(
    isCpuMorphActive(config)
    && cpuReplicaCount(config) > 1
    && (config.gpgpuMorphReplicaAgeStep || 0) > 0,
  );
}

/**
 * The age a particle restarts at when its lifecycle wraps — the
 * position shader's rule: replicaIdx * step * ageMax while the morph
 * replica grammar is in play, else exactly 0.
 */
export function cpuAgeRestartAge(config: ParticleConfig, i: number): number {
  if (!isCpuMorphActive(config) || cpuReplicaCount(config) <= 1) return 0;
  const stepFrac = Math.max(0, Math.min(1, config.gpgpuMorphReplicaAgeStep || 0));
  if (stepFrac <= 0) return 0;
  return cpuReplicaIndexOf(i, cpuReplicaCount(config)) * stepFrac * (config.gpgpuAgeMax || 0);
}

/** Media-dependent bake inputs the sim cannot build itself (they need
 * canvas / source text sampling); CpuFallbackScene supplies them,
 * mirroring components/useGpgpuRuntime.ts. */
export interface CpuMorphBakeExtras {
  mediaMap?: MorphMediaMap | null;
  svgPoints?: ArrayLike<number> | null;
  pathGeometry?: PathGeometry | null;
  /** Text on path (Phase AF2): glyph rasters for the bake's
   *  textOnPath option, assembled by the caller like the GPU
   *  paths assemble theirs. The deform set (Phase AM) rides
   *  along when present. */
  textOnPath?: {
    glyphs: TextGlyphRaster[];
    delay: number;
    size: number;
    deform?: { scaleVar: number; rotateDeg: number; fadeVar: number } | null;
  } | null;
  /** Contour geometry (Phase AM): the traced outline for the
   *  contour target, assembled by the caller via the shared
   *  builder like the GPU paths. */
  contourGeometry?: PathGeometry | null;
  objPoints?: ArrayLike<number> | null;
  /** Per-sample unit normals parallel to objPoints (Phase O). */
  objNormals?: ArrayLike<number> | null;
}

export interface CpuMorphData {
  /** Per-particle morph targets, count*4 (xyz normalised, w = phase). */
  targets: Float32Array;
  /** Per-particle morph normals, count*3 (pure directions, Phase O). */
  normals: Float32Array;
}

/**
 * Bake the per-particle morph targets AND the companion normal cloud
 * for the CPU sim. The bake's `data` output is exactly what
 * buildGpgpuMorphTargetData returns (the normal path consumes no RNG
 * draws), so the targets are unchanged from the Phase R port; the
 * normals feed the OBJ normal initial velocity (Phase X2). Returns
 * null when morph is inactive. Pure and deterministic for a given
 * config + extras.
 */
export function buildCpuMorphData(
  config: ParticleConfig,
  count: number,
  extras: CpuMorphBakeExtras = {},
): CpuMorphData | null {
  if (!isCpuMorphActive(config)) return null;
  const { data, normalData } = buildGpgpuMorphTargetDataWithNormals({
    texSize: CPU_MORPH_TEX_SIZE,
    target: config.gpgpuMorphTarget,
    worldScale: (config.gpgpuMorphScale || 1) * 0.48,
    jitter: config.gpgpuMorphJitter || 0,
    seed: config.gpgpuSeed,
    mediaMap: extras.mediaMap ?? null,
    svgPoints: extras.svgPoints ?? null,
    pathGeometry: extras.pathGeometry ?? null,
    path: {
      mode: config.gpgpuMorphPathMode,
      writeOnStart: config.gpgpuMorphPathWriteOnStart,
      writeOnEnd: config.gpgpuMorphPathWriteOnEnd,
      taper: config.gpgpuMorphPathTaper,
      taperShape: config.gpgpuMorphPathTaperShape,
      subpathMode: config.gpgpuMorphPathSubpathMode,
      stampSpacing: config.gpgpuMorphStampSpacing,
      stampSize: config.gpgpuMorphStampSize,
      stampShape: config.gpgpuMorphStampShape,
      stampAlign: config.gpgpuMorphStampAlign,
      // Path offset (Phase AM): 0 = the authored geometry itself.
      offset: config.gpgpuMorphPathOffset,
    },
    textOnPath: extras.textOnPath ?? null,
    contourGeometry: extras.contourGeometry ?? null,
    // Polygon target + path jitter (Phase AW): read from config
    // directly, like the path / form options above. The polygon
    // side count only matters to the polygon target; the path
    // jitter amount is the line jitter gated by its paths switch
    // (0 while off, so the bake stays bit-identical).
    polygonSides: config.gpgpuMorphPolygonSides,
    pathJitter: config.layer1LineJitterPaths ? config.layer1LineJitter : 0,
    // Voronoi fracture (Phase AG): read from config directly,
    // like the path / form options above — the shared bake applies
    // it, so the CPU cloud fractures identically to the GPU bakes.
    fracture: fractureOptionFromConfig(config),
    form: {
      disperseAmount: config.gpgpuMorphDisperseAmount,
      disperseDirection: config.gpgpuMorphDisperseDirection,
      twistAmount: config.gpgpuMorphTwistAmount,
      twistAxis: config.gpgpuMorphTwistAxis,
      fractalAmount: config.gpgpuMorphFractalAmount,
      fractalFrequency: config.gpgpuMorphFractalFrequency,
      fractalEvolution: config.gpgpuMorphFractalEvolution,
    },
    objPoints: extras.objPoints ?? null,
    objNormals: extras.objNormals ?? null,
    replica: {
      count: config.gpgpuMorphReplicaCount,
      spacing: config.gpgpuMorphReplicaSpacing,
      axis: config.gpgpuMorphReplicaAxis,
      rotationDeg: config.gpgpuMorphReplicaRotation,
      scaleStep: config.gpgpuMorphReplicaScaleStep,
      phaseStepDeg: config.gpgpuMorphReplicaPhaseStep,
    },
    terrain: {
      amplitude: config.gpgpuMorphTerrainAmplitude,
      frequency: config.gpgpuMorphTerrainFrequency,
      octaves: config.gpgpuMorphTerrainOctaves,
      seed: config.gpgpuMorphTerrainSeed,
      // Terrain recipes (Phase AI): 'fbm' is the legacy field.
      kind: config.gpgpuMorphTerrainKind,
      terraceSteps: config.gpgpuMorphTerrainTerraceSteps,
      // Terrain erosion (Phase AP): plane mode only — stripped
      // in tunnel mode (the collider / slope-force precedent).
      erosion: {
      // Tunnel wrap (Phase 30): erosion is no longer stripped
      // in tunnel mode — the droplet sim wraps in x (wrapX)
      // and the consumers tile the eroded field like the
      // analytic one. Plane mode passes wrapX false and keeps
      // the Phase AP behaviour verbatim.
        water: config.gpgpuMorphTerrainErosionWater,
        droplets: config.gpgpuMorphTerrainErosionDroplets,
        deposit: config.gpgpuMorphTerrainErosionDeposit,
        thermal: config.gpgpuMorphTerrainErosionThermal,
        talus: config.gpgpuMorphTerrainErosionTalus,
        thermalPasses: config.gpgpuMorphTerrainErosionThermalPasses,
        seed: config.gpgpuMorphTerrainErosionSeed,
        // Erosion mask (Phase 20 stage 3): carried like every
        // other config-side builder so the landscape stays one.
        mask: {
          mode: config.gpgpuMorphTerrainErosionMaskMode,
          strength: config.gpgpuMorphTerrainErosionMaskStrength,
          invert: config.gpgpuMorphTerrainErosionMaskInvert,
          low: config.gpgpuMorphTerrainErosionMaskLow,
          high: config.gpgpuMorphTerrainErosionMaskHigh,
        imageGrid: config.gpgpuMorphTerrainErosionMaskImageGrid,
        drawnGrid: config.gpgpuMorphTerrainErosionMaskDrawnGrid,
        },
        wrapX: config.gpgpuTerrainMeshTunnel,
      },
    },
    // Terrain scatter grammar (Phase AI): top-level bake option,
    // same assembly as the GPU paths.
    scatter: config.gpgpuMorphScatterEnabled ? {
      density: config.gpgpuMorphScatterDensity,
      heightMin: config.gpgpuMorphScatterHeightMin,
      heightMax: config.gpgpuMorphScatterHeightMax,
      slopeMax: config.gpgpuMorphScatterSlopeMax,
      alignNormal: config.gpgpuMorphScatterAlignNormal,
      species: config.gpgpuMorphScatterSpecies,
      scaleRandom: config.gpgpuMorphScatterScaleRandom,
      rotRandom: config.gpgpuMorphScatterRotRandom,
      bend: config.gpgpuMorphScatterBend,
      pcgGraphEnabled: config.gpgpuPcgGraphEnabled,
      pcgGraphData: config.gpgpuPcgGraphData,
    } : null,
    // Raster mask (Phase X): the CPU path bakes with the same mask
    // option as the GPU paths, so clip / shape apply here too.
    mask: config.gpgpuMaskMode !== 'off' && config.gpgpuMaskMap && config.gpgpuMaskMap.length > 0
      && config.gpgpuMaskMapWidth > 0 && config.gpgpuMaskMapHeight > 0
      ? {
        map: { map: config.gpgpuMaskMap, width: config.gpgpuMaskMapWidth, height: config.gpgpuMaskMapHeight },
        mode: config.gpgpuMaskMode,
        threshold: config.gpgpuMaskThreshold,
        invert: config.gpgpuMaskInvert,
      }
      : null,
  });
  const targets = new Float32Array(count * 4);
  targets.set(data.subarray(0, count * 4));
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    normals[i * 3] = normalData[i * 4];
    normals[i * 3 + 1] = normalData[i * 4 + 1];
    normals[i * 3 + 2] = normalData[i * 4 + 2];
  }
  return { targets, normals };
}

/**
 * Bake only the per-particle morph targets (Phase R entry point, kept
 * for existing callers): a Float32Array of count*4 (xyz = normalised
 * target point, w = replica orbit phase in radians, as baked).
 * Returns null when morph is inactive, so the caller can pass the
 * result straight into createCpuParticleState.
 */
export function buildCpuMorphTargets(
  config: ParticleConfig,
  count: number,
  extras: CpuMorphBakeExtras = {},
): Float32Array | null {
  const data = buildCpuMorphData(config, count, extras);
  return data ? data.targets : null;
}

/** Small FNV-1a hash for signature purposes (source texts can be
 * large; the signature only needs to change when they do). */
function cpuSourceHash(text: string | undefined): string {
  const s = text || '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

/**
 * A cheap signature of the config fields that determine the particle
 * population and its home shape. The renderer rebuilds its state when
 * (and only when) this changes; motion parameters are read live.
 */
export function cpuShapeSignature(config: ParticleConfig): string {
  const base = [
    resolveCpuParticleCount(config),
    config.layer1Enabled ? 1 : 0, config.layer1Count, config.layer1SourceCount,
    config.layer2Enabled ? 1 : 0, config.layer2Count,
    config.layer3Enabled ? 1 : 0, config.layer3Count,
    config.gpgpuEnabled ? 1 : 0, config.gpgpuSeed,
    config.sphereRadius,
    isCpuAttractorMode(config) ? config.gpgpuAttractorType : 'none',
    config.gpgpuAttractorScale,
  ].join('|');
  // Morph (Phase R): the baked targets are part of the population's
  // shape, so every bake input joins the signature — but only while
  // morph is active, keeping the legacy signature string (and thus
  // rebuild behaviour) untouched for morph-off configs.
  let sig = base;
  if (isCpuMorphActive(config)) {
    sig = `${base}|morph:${[
    config.gpgpuMorphTarget,
    config.gpgpuMorphScale, config.gpgpuMorphJitter,
    config.gpgpuMorphReplicaCount, config.gpgpuMorphReplicaSpacing,
    config.gpgpuMorphReplicaAxis, config.gpgpuMorphReplicaRotation,
    config.gpgpuMorphReplicaScaleStep, config.gpgpuMorphReplicaPhaseStep,
    config.gpgpuMorphTerrainAmplitude, config.gpgpuMorphTerrainFrequency,
    config.gpgpuMorphTerrainOctaves, config.gpgpuMorphTerrainSeed,
    config.gpgpuMorphPathMode, config.gpgpuMorphPathWriteOnStart,
    config.gpgpuMorphPathWriteOnEnd, config.gpgpuMorphPathTaper,
    config.gpgpuMorphPathTaperShape, config.gpgpuMorphPathSubpathMode,
    config.gpgpuMorphStampSpacing, config.gpgpuMorphStampSize,
    config.gpgpuMorphStampShape, config.gpgpuMorphStampAlign,
    // Path offset / glyph deform / contour (Phase AM bake inputs).
    config.gpgpuMorphPathOffset,
    config.gpgpuMorphTextOnPathGlyphScale, config.gpgpuMorphTextOnPathGlyphRotate,
    config.gpgpuMorphTextOnPathGlyphFade,
    config.gpgpuMorphContourSource, config.gpgpuMorphContourThreshold,
    config.gpgpuMorphDisperseAmount, config.gpgpuMorphDisperseDirection,
    config.gpgpuMorphTwistAmount, config.gpgpuMorphTwistAxis,
    config.gpgpuMorphFractalAmount, config.gpgpuMorphFractalFrequency,
    config.gpgpuMorphFractalEvolution,
    cpuSourceHash(config.gpgpuMorphSvgSource),
    cpuSourceHash(config.gpgpuMorphObjSource), config.gpgpuMorphObjSampleMode,
    config.layer2TextMapText, config.layer2TextMapFontFamily,
    config.layer2TextMapWeight, config.layer2TextMapSize,
    config.layer2TextMapPadding, config.layer2TextMapInvert ? 1 : 0,
    config.layer2MediaMapWidth, config.layer2MediaMapHeight,
    config.layer2MediaLumaMap ? config.layer2MediaLumaMap.length : 0,
    // Polygon sides / path jitter (Phase AW bake inputs, appended
    // at the end like the AM fields were).
    config.gpgpuMorphPolygonSides,
    config.layer1LineJitterPaths ? config.layer1LineJitter : 0,
    ].join(',')}`;
  }
  // Age lifecycle (Phase X2): the initial age scatter is part of the
  // population state, so the age inputs join the signature — but only
  // while the age system is live, keeping the legacy string (and thus
  // rebuild behaviour) untouched for age-off configs.
  if (isCpuAgeLive(config)) {
    sig += `|age:${[
      config.gpgpuAgeMax,
      isCpuMorphActive(config) ? config.gpgpuMorphReplicaAgeStep : 0,
    ].join(',')}`;
  }
  // Vertical text layout (Phase BG): the layout fields are bake
  // inputs of the 'text' morph target, so they join the signature
  // — but only while vertical writing is on, keeping the legacy
  // string (and thus rebuild behaviour) untouched for the
  // horizontal default, the same convention as the age block.
  if (config.layer2TextMapVertical) {
    sig += `|vtext:${[
      config.layer2TextMapColumnLength,
      config.layer2TextMapColumnGap,
      config.layer2TextMapLetterSpacing,
    ].join(',')}`;
    // Vertical text finishing (Phase BK, extended by Phase BP):
    // the adjustments change the bake, so they join the
    // signature — but only while one is on, keeping the BG
    // string (and thus rebuild behaviour) untouched for the
    // all-off default.
    if (config.layer2TextMapKinsoku || config.layer2TextMapYakumono
      || config.layer2TextMapTateChuYoko || config.layer2TextMapRuby) {
      sig += `|vtextAdj:${config.layer2TextMapKinsoku ? 1 : 0},${config.layer2TextMapYakumono ? 1 : 0},${config.layer2TextMapTateChuYoko ? 1 : 0},${config.layer2TextMapRuby ? 1 : 0}`;
    }
    // Text pages (Phase 17): the page settings change the bake
    // while paging is on, so they join the signature — only
    // then, keeping the BG/BK/BP strings untouched otherwise.
    if (config.layer2TextMapPageEnabled) {
      sig += `|vpage:${config.layer2TextMapColumnBalance ? 1 : 0},${config.layer2TextMapPageIndex}`;
    }
  }
  return sig;
}

export interface CpuParticleState {
  count: number;
  /** Current positions, normalised space (attractor units in attractor mode). */
  pos: Float32Array;
  vel: Float32Array;
  /** Home positions in normalised space (unused in attractor mode). */
  home: Float32Array;
  sizeMul: Float32Array;
  phase: Float32Array;
  attractorMode: boolean;
  /** Divisor mapping attractor units back to normalised render space. */
  attractorRenderDivisor: number;
  /**
   * Per-particle morph targets (Phase R), count*4: xyz in normalised
   * space, w = baked replica orbit phase (radians). Null when morph
   * is inactive — the step then runs the legacy code path exactly.
   */
  morphTarget: Float32Array | null;
  /**
   * Per-particle morph normals (Phase X2), count*3 pure directions
   * parallel to the morph targets. Null when morph is inactive; the
   * OBJ normal kick reads it only while the normal-speed key is > 0.
   */
  morphNormal: Float32Array | null;
  /**
   * Per-particle age in seconds (Phase X2). Advanced by the step only
   * while the age system is live (ageLive); otherwise left at 0 and
   * never read. Initialised with the same scatter + replica phase
   * rule as lib/gpgpuInitialData.ts.
   */
  age: Float32Array;
  /** Whether the age lifecycle runs for this state. */
  ageLive: boolean;
  /** Lifespan the ages wrap at (config value at creation time). */
  ageMax: number;
  /**
   * Seconds since the morph (re)placement or the last normal-speed
   * change — drives the OBJ normal kick envelope, mirroring the
   * scene's uMorphKickStart on the WebGL path.
   */
  morphKickAge: number;
  /** Last normal-speed key value seen by the step. */
  morphKickSpeed: number;
}

/** Attractor ODE derivative — same formulas as the GPGPU velocity shader. */
function attractorDerivative(
  type: ParticleConfig['gpgpuAttractorType'],
  x: number, y: number, z: number,
  out: Float32Array,
): void {
  switch (type) {
    case 'lorenz':
      out[0] = 10 * (y - x); out[1] = x * (28 - z) - y; out[2] = x * y - 2.667 * z;
      return;
    case 'rossler':
      out[0] = -(y + z); out[1] = x + 0.2 * y; out[2] = 0.2 + z * (x - 5.7);
      return;
    case 'halvorsen':
      out[0] = -1.4 * x - 4 * y - 4 * z - y * y;
      out[1] = -1.4 * y - 4 * z - 4 * x - z * z;
      out[2] = -1.4 * z - 4 * x - 4 * y - x * x;
      return;
    case 'chen':
      out[0] = 35 * (y - x); out[1] = -7 * x - x * z + 28 * y; out[2] = x * y - 3 * z;
      return;
    case 'lu':
      out[0] = 36 * (y - x); out[1] = -x * z + 20 * y; out[2] = x * y - 3 * z;
      return;
    case 'aizawa': {
      const zb = z - 0.7;
      out[0] = zb * x - 3.5 * y;
      out[1] = 3.5 * x + zb * y;
      out[2] = 0.6 + 0.95 * z - (z * z * z) / 3 - (x * x + y * y) * (1 + 0.25 * z) + 0.1 * z * x * x * x;
      return;
    }
    case 'sprott':
      out[0] = y + z; out[1] = -x + 0.5 * y; out[2] = x * x - z;
      return;
    case 'rabinovich':
      out[0] = y * (z - 1 + x * x) + 0.1 * x;
      out[1] = x * (3 * z + 1 - x * x) + 0.1 * y;
      out[2] = -2 * z * (0.14 + x * y);
      return;
    case 'dejong':
      out[0] = (Math.sin(1.4 * y) - Math.cos(-2.3 * x)) - x;
      out[1] = (Math.sin(2.4 * x) - Math.cos(-2.1 * y)) - y;
      out[2] = -0.5 * z;
      return;
    case 'ikeda': {
      const r2 = x * x + y * y;
      const tt = 0.4 - 6 / (1 + r2);
      const ct = Math.cos(tt); const st = Math.sin(tt);
      out[0] = (1 + 0.918 * (x * ct - y * st)) - x;
      out[1] = (0.918 * (x * st + y * ct)) - y;
      out[2] = -0.5 * z;
      return;
    }
    case 'chua': {
      const fx = -0.714 * x - 0.2145 * (Math.abs(x + 1) - Math.abs(x - 1));
      out[0] = 15.6 * (y - x - fx); out[1] = x - y + z; out[2] = -28 * y;
      return;
    }
    case 'thomas':
    default:
      out[0] = Math.sin(y) - 0.208 * x; out[1] = Math.sin(z) - 0.208 * y; out[2] = Math.sin(x) - 0.208 * z;
  }
}

/** Typical extent of each attractor in its own units (render divisor). */
function attractorExtent(type: ParticleConfig['gpgpuAttractorType']): number {
  switch (type) {
    case 'lorenz': return 22;
    case 'chen': case 'lu': return 24;
    case 'halvorsen': return 8;
    case 'aizawa': return 1.6;
    case 'dejong': case 'ikeda': return 2.2;
    case 'chua': return 2.4;
    case 'rossler': return 9;
    case 'rabinovich': return 2.4;
    case 'sprott': return 2.4;
    case 'thomas':
    default: return 3.2;
  }
}

/**
 * Build the particle state. `homes` (optional) are world-space home
 * positions from the existing CPU layout generator
 * (components/particleData.ts, via getRigidParticlePosition with the
 * config's sphereRadius); they are normalised by that radius here.
 * Without homes, a seeded sphere/shell mix stands in.
 */
export function createCpuParticleState(
  config: ParticleConfig,
  homes: Float32Array | null,
  morphTargets: Float32Array | null = null,
  morphNormals: Float32Array | null = null,
): CpuParticleState {
  const count = resolveCpuParticleCount(config);
  const radius = Math.max(1, config.sphereRadius || 50);
  const rand = mulberry32(hashSeed(config));
  const attractorMode = isCpuAttractorMode(config);
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const home = new Float32Array(count * 3);
  const sizeMul = new Float32Array(count);
  const phase = new Float32Array(count);
  const age = new Float32Array(count);
  const ageLive = isCpuAgeLive(config);
  const ageMax = ageLive ? config.gpgpuAgeMax : 0;
  const replicaAgePhase = ageLive && isCpuReplicaAgePhaseActive(config);
  const replicaCount = cpuReplicaCount(config);
  const replicaAgeStep = Math.max(0, Math.min(1, config.gpgpuMorphReplicaAgeStep || 0));

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    let hx: number; let hy: number; let hz: number;
    if (homes && homes.length >= (i + 1) * 3) {
      hx = homes[i3] / radius; hy = homes[i3 + 1] / radius; hz = homes[i3 + 2] / radius;
    } else {
      // Seeded stand-in layout: mix of volume sphere and shell so the
      // fallback still reads as a particle sphere.
      const theta = rand() * Math.PI * 2;
      const cosPhi = 2 * rand() - 1;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const r = i % 3 === 0 ? 0.92 + rand() * 0.12 : Math.cbrt(rand()) * 0.95;
      hx = sinPhi * Math.cos(theta) * r;
      hy = sinPhi * Math.sin(theta) * r;
      hz = cosPhi * r;
    }
    // Keep homes inside the working volume even if a layout overshoots.
    const hLen = Math.hypot(hx, hy, hz);
    if (hLen > 1.25) { const s = 1.25 / hLen; hx *= s; hy *= s; hz *= s; }
    home[i3] = hx; home[i3 + 1] = hy; home[i3 + 2] = hz;
    sizeMul[i] = 0.55 + rand() * 0.9;
    phase[i] = rand() * Math.PI * 2;
    if (ageLive) {
      // Initial age (Phase X2): the WebGL initial data scatters age
      // uniformly in [0, ageMax) and, while the replica age phase is
      // active, shifts each replica block by step * ageMax, wrapping
      // inside the lifecycle. The draw happens only on this branch,
      // so age-off state creation consumes the legacy draw sequence.
      const baseAge = rand() * ageMax;
      age[i] = replicaAgePhase
        ? (baseAge + cpuReplicaIndexOf(i, replicaCount) * replicaAgeStep * ageMax) % ageMax
        : baseAge;
    }
    if (attractorMode) {
      // Start clustered near the attractor core (in attractor units);
      // the normalised-derivative flow pulls particles onto the
      // attractor within the first second.
      const extent = attractorExtent(config.gpgpuAttractorType);
      pos[i3] = hx * extent * 0.35;
      pos[i3 + 1] = hy * extent * 0.35;
      pos[i3 + 2] = hz * extent * 0.35 + (config.gpgpuAttractorType === 'lorenz' || config.gpgpuAttractorType === 'chen' || config.gpgpuAttractorType === 'lu' ? extent * 0.9 : 0);
    } else {
      pos[i3] = hx; pos[i3 + 1] = hy; pos[i3 + 2] = hz;
    }
  }

  return {
    count,
    pos,
    vel,
    home,
    sizeMul,
    phase,
    attractorMode,
    attractorRenderDivisor: attractorExtent(config.gpgpuAttractorType),
    morphTarget: morphTargets && morphTargets.length >= count * 4 ? morphTargets : null,
    morphNormal: morphNormals && morphNormals.length >= count * 3 ? morphNormals : null,
    age,
    ageLive,
    ageMax,
    morphKickAge: 0,
    morphKickSpeed: Math.max(0, config.gpgpuMorphObjNormalSpeed || 0),
  };
}

const dvScratch = new Float32Array(3);

/** Advance the simulation by dt seconds (already speed-scaled by caller). */
export function stepCpuParticles(
  state: CpuParticleState,
  config: ParticleConfig,
  dt: number,
  time: number,
): void {
  const { pos, vel, home, phase, count } = state;
  const step = Math.min(dt, 0.05);
  if (step <= 0) return;

  // Morph parameters shared by both branches (Phase X2): the WebGL
  // velocity shader composes the attractor force and the morph force
  // in a single pass, so the CPU step computes the morph terms once,
  // before the branch split. When morph is off every value below is
  // inert and both branches run their legacy computations exactly.
  const morphTarget = state.morphTarget;
  const morphOn = morphTarget !== null && isCpuMorphActive(config);
  const morphStrength = morphOn ? Math.max(0, config.gpgpuMorphStrength || 0) : 0;
  const mf = morphOn ? 1 - Math.exp(-morphStrength * step * 3.0) : 0;
  const morphBlend = morphOn ? Math.min(1, Math.max(0, mf + step * 6.0)) : 0;
  const morphPhaseGain = morphOn && config.gpgpuMorphReplicaCount > 1 ? 1 : 0;
  const morphAngBase = morphOn ? time * (config.gpgpuMorphOrbitSpeed || 0) : 0;

  // OBJ normal kick bookkeeping (Phase X2): the envelope restarts
  // when the normal-speed key changes, mirroring uMorphKickStart
  // (set on the WebGL path when the bake is rebuilt — a state rebuild
  // here — or the speed key changes). The kick velocity converts the
  // shader's units (world units per 1/60s step, integrated as
  // pos += vel * dt * speed * 60) into the CPU sim's normalised units
  // per second: * 60 / bounceRadius.
  const kickSpeed = morphOn ? Math.max(0, config.gpgpuMorphObjNormalSpeed || 0) : 0;
  if (kickSpeed !== state.morphKickSpeed) {
    state.morphKickSpeed = kickSpeed;
    state.morphKickAge = 0;
  }
  if (morphOn) state.morphKickAge += step;
  const kickNormals = morphOn && state.morphNormal !== null && kickSpeed > 0 ? state.morphNormal : null;
  const kickEnvBase = kickNormals ? Math.exp(-state.morphKickAge * 4.5) : 0;
  const kickVelNorm = kickNormals ? (kickSpeed * 60) / Math.max(1, config.gpgpuBounceRadius || 150) : 0;

  // The kick itself, shared by both branches: the particle's baked
  // normal, rotated by the same orbit angle as its morph target,
  // mixes the velocity toward normal * speed under the shader's
  // envelope — exp decay since (re)placement, full strength while
  // the age has just wrapped (the shader's posData.w < dt * 1.5
  // test, read here from the age the previous step left behind).
  // unitScale converts normalised units to the branch's units
  // (1 free-flight, the attractor render divisor in attractor mode).
  const applyObjNormalKick = (i: number, i3: number, ca: number, sa: number, unitScale: number): void => {
    if (!kickNormals) return;
    let env = kickEnvBase;
    if (state.ageLive && state.age[i] < step * 1.5) env = 1;
    if (env <= 0.003) return;
    const mixF = Math.min(0.45, env * 0.45);
    const nx0 = kickNormals[i3];
    const nz0 = kickNormals[i3 + 2];
    const nx = nx0 * ca - nz0 * sa;
    const nz = nx0 * sa + nz0 * ca;
    const kv = kickVelNorm * unitScale;
    vel[i3] += (nx * kv - vel[i3]) * mixF;
    vel[i3 + 1] += (kickNormals[i3 + 1] * kv - vel[i3 + 1]) * mixF;
    vel[i3 + 2] += (nz * kv - vel[i3 + 2]) * mixF;
  };

  if (state.attractorMode) {
    const strength = Math.max(0, config.gpgpuAttractorStrength || 0) || 1;
    // The shader drives world-space positions (ap = pos / scale, so its
    // volume is ~8x larger); in attractor units the same pull would blow
    // particles onto the safety bound, hence the 0.3 factor and the
    // stronger damping — tuned so the population stays on the attractor
    // (see the sim unit check in CPU_FALLBACK_IMPL_REPORT.md).
    const pull = strength * step * 40 * 0.3;
    const damping = Math.max(0, 1 - 4.5 * step);
    const extent = state.attractorRenderDivisor;
    const bound = extent * 2.6;
    // Attractor space modes (Phase DO; twin: lib/attractorSpace.ts).
    // The CPU pool lives in attractor units, where the render
    // divisor maps the uncentred field (Lorenz z 0..45) into the
    // view, so spread needs no recentring here: velocity matching
    // (direct ODE integration at the same ~0.016-per-frame rate,
    // expressed per second) forms the same structure the GPU
    // path draws. Frame applies the same y/z swap as the shader.
    const spaceMode = config.gpgpuAttractorSpaceMode ?? 'legacy';
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      // Start-of-step position: the WebGL velocity pass reads posIn
      // for every force, so the morph terms below use this, not the
      // position this iteration is about to integrate.
      const sx = pos[i3]; const sy = pos[i3 + 1]; const sz = pos[i3 + 2];
      if (spaceMode === 'legacy' || spaceMode === 'ring') {
        // Ring shares the legacy dynamics (its framing shift is
        // a GPU world-space output transform with no counterpart
        // in this renderer's divisor framing — see
        // lib/attractorSpace.ts).
        attractorDerivative(config.gpgpuAttractorType, pos[i3], pos[i3 + 1], pos[i3 + 2], dvScratch);
        const dl = Math.hypot(dvScratch[0], dvScratch[1], dvScratch[2]) || 1;
        vel[i3] = vel[i3] * damping + (dvScratch[0] / dl) * pull;
        vel[i3 + 1] = vel[i3 + 1] * damping + (dvScratch[1] / dl) * pull;
        vel[i3 + 2] = vel[i3 + 2] * damping + (dvScratch[2] / dl) * pull;
      } else if (spaceMode === 'spread') {
        attractorDerivative(config.gpgpuAttractorType, pos[i3], pos[i3 + 1], pos[i3 + 2], dvScratch);
        vel[i3] = dvScratch[0] * strength;
        vel[i3 + 1] = dvScratch[1] * strength;
        vel[i3 + 2] = dvScratch[2] * strength;
      } else {
        attractorDerivative(config.gpgpuAttractorType, pos[i3], pos[i3 + 2], pos[i3 + 1], dvScratch);
        vel[i3] = dvScratch[0] * strength;
        vel[i3 + 1] = dvScratch[2] * strength;
        vel[i3 + 2] = dvScratch[1] * strength;
      }
      pos[i3] += vel[i3] * step;
      pos[i3 + 1] += vel[i3 + 1] * step;
      pos[i3 + 2] += vel[i3 + 2] * step;
      // Safety net: a particle that escapes the attractor volume is
      // pulled softly back toward the core instead of flying off.
      const d2 = pos[i3] * pos[i3] + pos[i3 + 1] * pos[i3 + 1] + pos[i3 + 2] * pos[i3 + 2];
      if (d2 > bound * bound) {
        const s = bound / Math.sqrt(d2);
        pos[i3] *= s; pos[i3 + 1] *= s; pos[i3 + 2] *= s;
        vel[i3] *= 0.4; vel[i3 + 1] *= 0.4; vel[i3 + 2] *= 0.4;
      }
      // Morph inside attractor mode (Phase X2): the same relaxation
      // as the free-flight branch, evaluated in attractor units (the
      // normalised target scaled by the render divisor) against the
      // start-of-step position, then the OBJ normal kick — the order
      // the velocity shader applies them in.
      if (morphOn && morphTarget) {
        const i4 = i * 4;
        const ang = morphAngBase + morphTarget[i4 + 3] * morphPhaseGain;
        const ca = Math.cos(ang); const sa = Math.sin(ang);
        const gx0 = morphTarget[i4]; const gz0 = morphTarget[i4 + 2];
        const inv = mf / Math.max(step, 0.001);
        const vwx = ((gx0 * ca - gz0 * sa) * extent - sx) * inv;
        const vwy = (morphTarget[i4 + 1] * extent - sy) * inv;
        const vwz = ((gx0 * sa + gz0 * ca) * extent - sz) * inv;
        vel[i3] += (vwx - vel[i3]) * morphBlend;
        vel[i3 + 1] += (vwy - vel[i3 + 1]) * morphBlend;
        vel[i3 + 2] += (vwz - vel[i3 + 2]) * morphBlend;
        applyObjNormalKick(i, i3, ca, sa, extent);
      }
    }
  } else {

  const turbulence = Math.max(0, config.gpgpuTurbulence || 0);
  const curlStrength = config.gpgpuCurlEnabled ? Math.max(0, config.gpgpuCurlStrength || 0) : 0.45;
  const flowAmp = (0.22 + turbulence * 0.5) * (0.4 + curlStrength);
  const springK = 1.5;
  const gravity = config.gpgpuEnabled ? (config.gpgpuGravity || 0) : 0;
  const vortex = config.gpgpuVortexEnabled ? (config.gpgpuVortexStrength || 0) : 0;
  const windX = config.gpgpuWindEnabled ? (config.gpgpuWindX || 0) * (config.gpgpuWindStrength || 0) : 0;
  const windY = config.gpgpuWindEnabled ? (config.gpgpuWindY || 0) * (config.gpgpuWindStrength || 0) : 0;
  const jitter = Math.max(0, config.jitter || 0) * 0.15;
  const damping = Math.max(0, 1 - 2.4 * step);
  const t = time;

  // Morph attraction (Phase R): the same force law as the GPGPU
  // velocity shader — the target cloud orbits around Y by
  // time * orbitSpeed (+ the baked per-copy phase when replicas are
  // active), and the velocity is relaxed toward the velocity that
  // would cover the fraction mf of the remaining distance this step
  // (mf = 1 - exp(-strength * dt * 3)). The CPU position step is
  // pos += vel * step (no *60 factor), so vWant divides by step.
  // The shared morph parameters (morphOn / mf / morphBlend / …) are
  // computed once above the branch split (Phase X2); when morph is
  // off, every term below reduces to the legacy computation,
  // operation for operation.

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = pos[i3]; const y = pos[i3 + 1]; const z = pos[i3 + 2];
    const ph = phase[i];
    // Morph target for this particle (orbited), when active. The
    // home spring below aims at it instead of the layout home.
    let tx = home[i3]; let ty = home[i3 + 1]; let tz = home[i3 + 2];
    let morphCa = 1; let morphSa = 0;
    if (morphOn && morphTarget) {
      const i4 = i * 4;
      // One rotation for the target and the kick normal alike
      // (Phase X2): the angle is the orbit base plus the baked
      // per-copy phase. With gain 0 and base 0 the angle is 0 and
      // the rotation is the exact identity (cos = 1, sin = 0), so
      // the legacy target values stay bit-identical.
      const ang = morphAngBase + morphTarget[i4 + 3] * morphPhaseGain;
      morphCa = Math.cos(ang); morphSa = Math.sin(ang);
      const gx = morphTarget[i4]; const gz = morphTarget[i4 + 2];
      tx = gx * morphCa - gz * morphSa;
      ty = morphTarget[i4 + 1];
      tz = gx * morphSa + gz * morphCa;
    }
    // Analytic curl-ish flow (cheap sin/cos field, per-particle phase).
    let fx = Math.sin(y * 3.1 + t * 0.7 + ph) + Math.cos(z * 2.3 - t * 0.5 + ph * 0.7);
    let fy = Math.sin(z * 2.7 - t * 0.6 + ph) + Math.cos(x * 3.3 + t * 0.4);
    let fz = Math.sin(x * 2.9 + t * 0.5 + ph * 1.3) + Math.cos(y * 2.1 - t * 0.7);
    fx *= flowAmp; fy *= flowAmp; fz *= flowAmp;
    if (vortex !== 0) {
      fx += -z * vortex * 1.6;
      fz += x * vortex * 1.6;
    }
    let ax = (tx - x) * springK + fx + windX * 0.4;
    let ay = (ty - y) * springK + fy + windY * 0.4 - gravity * 0.55;
    let az = (tz - z) * springK + fz;
    if (jitter > 0) {
      const j = jitter * (Math.sin(t * 13.7 + ph * 40.0) + Math.cos(t * 9.3 + ph * 27.0)) * 0.5;
      ax += j; ay += j * 0.6; az += j * 0.8;
    }
    vel[i3] = vel[i3] * damping + ax * step * 3.2;
    vel[i3 + 1] = vel[i3 + 1] * damping + ay * step * 3.2;
    vel[i3 + 2] = vel[i3 + 2] * damping + az * step * 3.2;
    if (morphOn) {
      // Shader-identical relaxation toward the covering velocity.
      const inv = mf / Math.max(step, 0.001);
      const vwx = (tx - x) * inv;
      const vwy = (ty - y) * inv;
      const vwz = (tz - z) * inv;
      vel[i3] += (vwx - vel[i3]) * morphBlend;
      vel[i3 + 1] += (vwy - vel[i3 + 1]) * morphBlend;
      vel[i3 + 2] += (vwz - vel[i3 + 2]) * morphBlend;
      // OBJ normal kick (Phase X2): after the spring, as in the
      // shader; a no-op unless normals are baked and speed > 0.
      applyObjNormalKick(i, i3, morphCa, morphSa, 1);
    }
    pos[i3] += vel[i3] * step;
    pos[i3 + 1] += vel[i3 + 1] * step;
    pos[i3 + 2] += vel[i3 + 2] * step;
    // Soft containment sphere (the GPGPU bounce, degraded).
    const d2 = pos[i3] * pos[i3] + pos[i3 + 1] * pos[i3 + 1] + pos[i3 + 2] * pos[i3 + 2];
    if (d2 > 1.69) {
      const d = Math.sqrt(d2);
      const s = 1.3 / d;
      pos[i3] *= s; pos[i3 + 1] *= s; pos[i3 + 2] *= s;
      vel[i3] *= -0.35; vel[i3 + 1] *= -0.35; vel[i3 + 2] *= -0.35;
    }
  }
  }

  // Age lifecycle (Phase X2): runs after both branches, the way the
  // WebGL position pass runs after the velocity pass. Age advances
  // by the (already speed-scaled) step; on wrap the particle
  // restarts at its replica offset (cpuAgeRestartAge) and respawns
  // at the CPU emitter analogue — the layout home, or in attractor
  // mode the same core cluster the state was seeded with. Velocity
  // is left untouched: the WebGL respawn rewrites only the position
  // texel. With the age system off this block never runs and the
  // step is the legacy computation exactly.
  if (state.ageLive) {
    const ageMax = state.ageMax;
    const ageArr = state.age;
    for (let i = 0; i < count; i += 1) {
      const next = ageArr[i] + step;
      if (next <= ageMax) {
        ageArr[i] = next;
        continue;
      }
      ageArr[i] = cpuAgeRestartAge(config, i);
      const i3 = i * 3;
      if (state.attractorMode) {
        const extent = state.attractorRenderDivisor;
        pos[i3] = home[i3] * extent * 0.35;
        pos[i3 + 1] = home[i3 + 1] * extent * 0.35;
        pos[i3 + 2] = home[i3 + 2] * extent * 0.35
          + (config.gpgpuAttractorType === 'lorenz' || config.gpgpuAttractorType === 'chen' || config.gpgpuAttractorType === 'lu' ? extent * 0.9 : 0);
      } else {
        pos[i3] = home[i3];
        pos[i3 + 1] = home[i3 + 1];
        pos[i3 + 2] = home[i3 + 2];
      }
    }
  }
}
