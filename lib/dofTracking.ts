// DOF particle tracking (limit plan stage 4, slice S5 — the
// DOF half of the DOF+MB pair, design
// kalokagathia-pro/STAGE4_DESIGN_MATERIALS.md §3.2, 案A:
// the generic DepthOfField stage stays canonical; only the
// particle-side supply is added).
//
// While postDofTrackParticles is on, the tracked zone's
// centroid depth is supplied every frame as the DOF stage's
// effective focusDistance. The supply chain is:
//   components/DofTrackCapture.tsx renders the main pool's
//   points into a 1x1 float target with additive blending —
//   each point contributes (worldPos * zoneWeight, zoneWeight)
//   — reads the single pixel back, and publishes the
//   centroid's view depth through the store below;
//   components/AppScenePostFx.tsx resolves the stage's
//   focusDistance through resolveEffectiveDofFocusDistance.
//
// Units: in the installed postprocessing version the CoC
// material's focusDistance uniform is a WORLD-unit distance
// (it is compared against the view-space distance of each
// fragment), so the supply is a world view depth — no
// normalisation is applied or needed.
//
// Fallback is total: tracking off, no published source (the
// capture has not run, the zone is empty, or float blending
// is unavailable on the device), or a non-finite / negative
// depth all resolve to the config's own postDofFocusDistance,
// so the stage behaves exactly as before this slice.
//
// Zone semantics: the species zones of the geometry split
// (lib/speciesAllocation.ts baked data — zone 0 is the whole
// pool whenever no baked species channel exists, exactly as
// the split itself resolves it).

import React from 'react';

/** The tracking predicate: both keys literally on. (The DOF
 *  stage's own activation stays postDofEnabled in the stack;
 *  this predicate gates the supply chain only.) */
export function dofTrackOn(config: { postDofEnabled?: unknown; postDofTrackParticles?: unknown }): boolean {
  return config.postDofEnabled === true && config.postDofTrackParticles === true;
}

/** Resolved tracked zone: a finite number rounded and
 *  clamped to [0, 3]; anything else resolves to the key
 *  default 0. */
export function resolveDofTrackZone(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.min(3, Math.max(0, Math.round(raw)));
}

/**
 * Centroid of the particles in one zone over a position
 * buffer (stride 4, xyz + age — the captureParticlesRaw
 * layout). speciesData, when given, is the baked species
 * channel (one zone index per texel, the speciesAllocation
 * layout); without it every texel is zone 0. Returns null
 * when the zone holds no texel. This is the CPU twin of the
 * capture's GPU reduction: sum(zoneWeight * pos) / sum(zoneWeight)
 * with zoneWeight in {0, 1}.
 */
export function particleZoneCentroid(
  positions: ArrayLike<number>,
  speciesData: ArrayLike<number> | null | undefined,
  zone: number,
): { centroid: [number, number, number]; count: number } | null {
  const count = Math.floor(positions.length / 4);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let i = 0; i < count; i++) {
    const z = speciesData ? Math.max(0, Math.floor(speciesData[i] ?? 0)) : 0;
    if (z !== zone) continue;
    sx += positions[i * 4];
    sy += positions[i * 4 + 1];
    sz += positions[i * 4 + 2];
    n += 1;
  }
  if (n === 0) return null;
  return { centroid: [sx / n, sy / n, sz / n], count: n };
}

/**
 * View depth of a world point: the signed distance along
 * the camera forward axis (the forward is normalised here,
 * so callers may pass any non-zero direction). A point
 * behind the camera gives a negative value.
 */
export function viewDepthOfPoint(
  point: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  cameraForward: readonly [number, number, number],
): number {
  const fx = cameraForward[0];
  const fy = cameraForward[1];
  const fz = cameraForward[2];
  const len = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (!(len > 0) || !Number.isFinite(len)) return Number.NaN;
  return (
    ((point[0] - cameraPosition[0]) * fx +
      (point[1] - cameraPosition[1]) * fy +
      (point[2] - cameraPosition[2]) * fz) /
    len
  );
}

/**
 * The effective focusDistance for the DOF stage: the tracked
 * view depth while tracking is on and the published depth is
 * finite and non-negative; the config value otherwise.
 */
export function resolveEffectiveDofFocusDistance(
  config: { postDofEnabled?: unknown; postDofTrackParticles?: unknown; postDofFocusDistance?: unknown },
  trackedViewDepth: number | null | undefined,
): number {
  const fallback = typeof config.postDofFocusDistance === 'number' && Number.isFinite(config.postDofFocusDistance)
    ? config.postDofFocusDistance
    : 0.02;
  if (!dofTrackOn(config)) return fallback;
  if (typeof trackedViewDepth !== 'number' || !Number.isFinite(trackedViewDepth) || trackedViewDepth < 0) {
    return fallback;
  }
  return trackedViewDepth;
}

// ---------------------------------------------------------------------------
// Reduction shaders (the capture's GPU twin of
// particleZoneCentroid). One sampler pair: the simulation
// position texture plus the baked species channel uploaded
// as a data texture (r = zone index / 255). With
// uHasSpecies = 0 every texel weighs as zone 0, matching the
// CPU twin's no-species rule. Additive blending accumulates
// (pos * w, w) into the 1x1 target.

export const DOF_TRACK_REDUCTION_VERT = /* glsl */ `
attribute vec2 aTexCoord;
uniform sampler2D uPosTex;
uniform sampler2D uSpeciesTex;
uniform float uZone;
uniform float uHasSpecies;
varying vec3 vWeightedPos;
varying float vWeight;
void main() {
  vec3 pos = texture2D(uPosTex, aTexCoord).xyz;
  float zoneOf = uHasSpecies > 0.5 ? floor(texture2D(uSpeciesTex, aTexCoord).r * 255.0 + 0.5) : 0.0;
  float w = abs(zoneOf - uZone) < 0.25 ? 1.0 : 0.0;
  vWeightedPos = pos * w;
  vWeight = w;
  gl_PointSize = 1.0;
  gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export const DOF_TRACK_REDUCTION_FRAG = /* glsl */ `
varying vec3 vWeightedPos;
varying float vWeight;
void main() {
  gl_FragColor = vec4(vWeightedPos, vWeight);
}
`;

// ---------------------------------------------------------------------------
// Shared tracked-focus store (capture publishes, post reads)

export interface DofFocusSource {
  /** World view depth of the tracked zone's centroid. */
  viewDepth: number;
}

let currentFocus: DofFocusSource | null = null;
const focusListeners = new Set<() => void>();

export function setDofFocusSource(next: DofFocusSource | null): void {
  const prev = currentFocus;
  if (prev === next || (prev !== null && next !== null && prev.viewDepth === next.viewDepth)) return;
  currentFocus = next;
  for (const listener of focusListeners) listener();
}

export function getDofFocusSource(): DofFocusSource | null {
  return currentFocus;
}

function subscribeDofFocusSource(listener: () => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

export function useDofFocusSource(): DofFocusSource | null {
  return React.useSyncExternalStore(subscribeDofFocusSource, getDofFocusSource, getDofFocusSource);
}
