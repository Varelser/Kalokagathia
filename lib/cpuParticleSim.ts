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

import type { ParticleConfig } from '../types';
import { buildGpgpuMorphTargetData } from './gpgpuMorphTargets';
import type { MorphMediaMap } from './gpgpuMorphTargets';
import type { PathGeometry } from './pathGeometry';

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
 * path: the GPGPU system on + the morph toggle on. Attractor mode
 * still takes precedence in the step (see stepCpuParticles). */
export function isCpuMorphActive(config: ParticleConfig): boolean {
  return Boolean(config.gpgpuEnabled && config.gpgpuMorphEnabled);
}

/** Media-dependent bake inputs the sim cannot build itself (they need
 * canvas / source text sampling); CpuFallbackScene supplies them,
 * mirroring components/useGpgpuRuntime.ts. */
export interface CpuMorphBakeExtras {
  mediaMap?: MorphMediaMap | null;
  svgPoints?: ArrayLike<number> | null;
  pathGeometry?: PathGeometry | null;
  objPoints?: ArrayLike<number> | null;
}

/**
 * Bake the per-particle morph targets for the CPU sim: a Float32Array
 * of count*4 (xyz = normalised target point, w = replica orbit phase
 * in radians, as baked). Returns null when morph is inactive, so the
 * caller can pass the result straight into createCpuParticleState.
 * Pure and deterministic for a given config + extras.
 */
export function buildCpuMorphTargets(
  config: ParticleConfig,
  count: number,
  extras: CpuMorphBakeExtras = {},
): Float32Array | null {
  if (!isCpuMorphActive(config)) return null;
  const data = buildGpgpuMorphTargetData({
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
    },
    objPoints: extras.objPoints ?? null,
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
    },
  });
  const out = new Float32Array(count * 4);
  out.set(data.subarray(0, count * 4));
  return out;
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
  if (!isCpuMorphActive(config)) return base;
  return `${base}|morph:${[
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
    cpuSourceHash(config.gpgpuMorphSvgSource),
    cpuSourceHash(config.gpgpuMorphObjSource), config.gpgpuMorphObjSampleMode,
    config.layer2TextMapText, config.layer2TextMapFontFamily,
    config.layer2TextMapWeight, config.layer2TextMapSize,
    config.layer2TextMapPadding, config.layer2TextMapInvert ? 1 : 0,
    config.layer2MediaMapWidth, config.layer2MediaMapHeight,
    config.layer2MediaLumaMap ? config.layer2MediaLumaMap.length : 0,
  ].join(',')}`;
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
    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      attractorDerivative(config.gpgpuAttractorType, pos[i3], pos[i3 + 1], pos[i3 + 2], dvScratch);
      const dl = Math.hypot(dvScratch[0], dvScratch[1], dvScratch[2]) || 1;
      vel[i3] = vel[i3] * damping + (dvScratch[0] / dl) * pull;
      vel[i3 + 1] = vel[i3 + 1] * damping + (dvScratch[1] / dl) * pull;
      vel[i3 + 2] = vel[i3 + 2] * damping + (dvScratch[2] / dl) * pull;
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
    }
    return;
  }

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
  // When morph is off, morphOn is false and every term below reduces
  // to the legacy computation, operation for operation.
  const morphTarget = state.morphTarget;
  const morphOn = morphTarget !== null && isCpuMorphActive(config);
  const morphStrength = morphOn ? Math.max(0, config.gpgpuMorphStrength || 0) : 0;
  const mf = morphOn ? 1 - Math.exp(-morphStrength * step * 3.0) : 0;
  const morphBlend = morphOn ? Math.min(1, Math.max(0, mf + step * 6.0)) : 0;
  const morphPhaseGain = morphOn && config.gpgpuMorphReplicaCount > 1 ? 1 : 0;
  const morphAngBase = morphOn ? t * (config.gpgpuMorphOrbitSpeed || 0) : 0;
  const morphCosBase = Math.cos(morphAngBase);
  const morphSinBase = Math.sin(morphAngBase);

  for (let i = 0; i < count; i += 1) {
    const i3 = i * 3;
    const x = pos[i3]; const y = pos[i3 + 1]; const z = pos[i3 + 2];
    const ph = phase[i];
    // Morph target for this particle (orbited), when active. The
    // home spring below aims at it instead of the layout home.
    let tx = home[i3]; let ty = home[i3 + 1]; let tz = home[i3 + 2];
    if (morphOn && morphTarget) {
      const i4 = i * 4;
      let gx = morphTarget[i4]; let gy = morphTarget[i4 + 1]; let gz = morphTarget[i4 + 2];
      if (morphPhaseGain !== 0) {
        const ang = morphAngBase + morphTarget[i4 + 3] * morphPhaseGain;
        const ca = Math.cos(ang); const sa = Math.sin(ang);
        const rx = gx * ca - gz * sa;
        const rz = gx * sa + gz * ca;
        gx = rx; gz = rz;
      } else if (morphAngBase !== 0) {
        const rx = gx * morphCosBase - gz * morphSinBase;
        const rz = gx * morphSinBase + gz * morphCosBase;
        gx = rx; gz = rz;
      }
      tx = gx; ty = gy; tz = gz;
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
