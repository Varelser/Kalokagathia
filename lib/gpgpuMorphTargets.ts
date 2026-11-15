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
 */

import type { ParticleConfig } from '../types';
import { createSeededRng } from './seededRng';

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
  // 'svg' (Pro-2) stays last: the target index feeds the bake seed,
  // so appending keeps every existing target's cloud bit-identical.
  'svg',
] as const;

export interface MorphMediaMap {
  map: ArrayLike<number>;
  width: number;
  height: number;
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
  /** Luma map for the text/image targets; null falls back to a shell. */
  mediaMap?: MorphMediaMap | null;
  /**
   * Normalised point cloud for the svg target (flat xy pairs in
   * centred y-up space, from lib/svgMorph.ts); null falls back to a
   * shell, like a missing media map.
   */
  svgPoints?: ArrayLike<number> | null;
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
  const { texSize, target, worldScale, jitter, seed, mediaMap, svgPoints } = options;
  const count = texSize * texSize;
  const data = new Float32Array(count * 4);
  const targetIndex = GPGPU_MORPH_TARGETS.indexOf(target);
  const rng = createSeededRng(((seed * 1000003 + targetIndex * 7919 + 12345) >>> 0) || 1);
  const isMedia = target === 'text' || target === 'image';
  const media = isMedia && mediaMap && mediaMap.map.length > 0 ? mediaMap : null;
  const svgPointCount = target === 'svg' && svgPoints ? Math.floor(svgPoints.length / 2) : 0;
  const mediaPoint = { x: 0, y: 0, z: 0 };

  for (let i = 0; i < count; i++) {
    const s = rng();
    const h1 = rng();
    const h2 = rng();
    let tx = 0;
    let ty = 0;
    let tz = 0;

    if (svgPointCount > 0 && svgPoints) {
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

    const jx = (h1 - 0.5) * jitter;
    const jy = (h2 - 0.5) * jitter;
    const jz = (((h1 + h2) % 1) - 0.5) * jitter;
    const o = i * 4;
    data[o] = (tx + jx) * worldScale;
    data[o + 1] = (ty + jy) * worldScale;
    data[o + 2] = (tz + jz) * worldScale;
    data[o + 3] = 1;
  }
  return data;
}
