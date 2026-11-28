/**
 * Particle density field for Shine (Phase 22 stage 2, the §4
 * design by #11 白丸 — "Shine density texturing").
 *
 * What this is: a screen-space density field of the GPGPU main
 * layer, splatted from the position texture into a quarter-
 * resolution target, consumed by the LightFx Shine ray march
 * as a transmittance term. It is NOT a shadow: the light
 * position is a manual 2D UV and the field is screen-space, so
 * what it expresses is "a dense particle region weakens rays
 * passing through it" — density attenuation, never called a
 * shadow in UI or reports (the Phase Z naming discipline).
 *
 * Pieces:
 *  1. Pure math (TS) + GLSL twins that must never drift:
 *     the log compression of the raw splat accumulation and
 *     the per-segment transmittance factor.
 *  2. A tiny shared store (the lib/sceneDepth.ts precedent):
 *     the splat lives in components/sceneGpgpuSystem.tsx —
 *     that is where the position texture, the draw geometry
 *     and the point size already are, so no new publish path
 *     for the texture was needed — and the consumers read the
 *     store directly. The store is null whenever no consumer
 *     is active (the splat never runs then) and every
 *     consumer's fragment is its legacy string verbatim in
 *     that state, so the default render is unchanged.
 *
 * Supply / consumption generalization (Layer 1 WP7 Phase D):
 * the splat's source layers are authored by the key
 * postShineDensityLayers (see resolveParticleDensityLayers
 * below; the default 'main' is the Phase 22 behaviour
 * verbatim), and the LightVolume (components/LightVolume.tsx)
 * joins the LightFx Shine march as a second consumer behind
 * gpgpuLightVolumeDensity, attenuating its accumulated beam
 * by particleDensityAttenuation. The store's shape is
 * unchanged — one texture, published by the same splat — so
 * the Phase 22 consumer keeps working unmodified.
 */

import type * as THREE from 'three';

/** Quarter-resolution splat target (design-fixed, not a key). */
export const PARTICLE_DENSITY_SCALE = 0.25;

/** Per-particle splat gain: ~50 overlapping splats reach 1.0
 *  of raw accumulation, which the log compression maps to
 *  ~0.82 — dense walls saturate gracefully instead of clipping. */
export const PARTICLE_DENSITY_SPLAT_GAIN = 0.02;

/** Raw accumulation -> normalised density: log1p scaled so
 *  raw 1.0 maps to exactly 1.0 (log(1 + 8) in the denominator). */
export function shineDensityLog(raw: number): number {
  if (!(raw > 0)) return 0;
  return Math.log(1 + raw * 8) / Math.log(9);
}

/** GLSL twin of shineDensityLog (the 0.4551196 constant is
 *  1 / ln(9)). Spliced into the LightFx fragment only in the
 *  density variant. */
export const SHINE_DENSITY_GLSL = /* glsl */ `
float kaloShineDensityLog(float raw) {
  return log(1.0 + raw * 8.0) * 0.4551196;
}
`;

/**
 * Per-segment transmittance factor (TS twin of the fragment's
 * inline term): T *= exp(-strength * K * dlog * ds), with the
 * design-fixed gain K = 3. ds is the ray segment length in
 * aspect-corrected units.
 */
export const SHINE_DENSITY_GAIN = 3.0;
export function shineDensityTransmittance(
  strength: number,
  rawDensity: number,
  ds: number,
): number {
  if (!(strength > 0) || !(ds > 0)) return 1;
  return Math.exp(-strength * SHINE_DENSITY_GAIN * shineDensityLog(rawDensity) * ds);
}

/**
 * Per-fragment attenuation for a consumer that does not march
 * (the LightVolume, Layer 1 WP7 Phase D): the fraction of the
 * accumulated beam that survives passing the density field at
 * one screen position — the Shine segment transmittance with
 * the segment length folded into the strength (ds = 1). Same
 * edge rules as shineDensityTransmittance: non-positive
 * strength or empty field is exactly 1 (nothing hidden).
 */
export function particleDensityAttenuation(
  strength: number,
  rawDensity: number,
): number {
  if (!(strength > 0) || !(rawDensity > 0)) return 1;
  return Math.exp(-strength * SHINE_DENSITY_GAIN * shineDensityLog(rawDensity));
}

/** GLSL twin of particleDensityAttenuation (same formula,
 *  same edge rules). Depends on kaloShineDensityLog
 *  (SHINE_DENSITY_GLSL), which the consumer's builder splices
 *  in ahead of this chunk. Spliced only into density variants;
 *  stock strings never contain it. */
export const PARTICLE_DENSITY_ATTENUATION_GLSL = /* glsl */ `
float kaloParticleDensityAttenuation(float strength, float rawDensity) {
  if (strength <= 0.0 || rawDensity <= 0.0) return 1.0;
  return exp(-strength * 3.0 * kaloShineDensityLog(rawDensity));
}
`;

// ---------------------------------------------------------------------------
// Splat source layers (Layer 1 WP7 Phase D)
//
// The Phase 22 splat had exactly one source: the GPGPU main
// layer. The key postShineDensityLayers authors which layers
// fold into the field: a comma / space separated list of layer
// ids, resolved here into the canonical order below (the
// order is the splat's accumulation order; accumulation is
// additive, so the order carries no weighting). An empty or
// unrecognised value resolves to ['main'] — the Phase 22
// behaviour — so the default render is unchanged, and a layer
// whose pool is not running in a given frame simply
// contributes nothing that frame (the scene loop skips it).

/** Layer ids that can feed the density field, in canonical
 *  (splat accumulation) order: the main pool, then the Aux
 *  chain levels 1..3. */
export const PARTICLE_DENSITY_LAYERS = ['main', 'aux', 'aux2', 'aux3'] as const;

export type ParticleDensityLayer = (typeof PARTICLE_DENSITY_LAYERS)[number];

/** The default layer selection: the main layer only. */
export const PARTICLE_DENSITY_LAYERS_DEFAULT = 'main';

/**
 * Resolve an authored layer list: split on commas / spaces,
 * trim, lowercase, keep known ids, dedupe. The result is in
 * canonical order regardless of the authored order. Anything
 * unusable (non-string, empty, no known id) resolves to
 * ['main'].
 */
export function parseParticleDensityLayers(value: unknown): ParticleDensityLayer[] {
  if (typeof value !== 'string') return ['main'];
  const wanted = new Set<string>();
  for (const token of value.split(/[\s,]+/)) {
    const id = token.trim().toLowerCase();
    if (id) wanted.add(id);
  }
  const resolved = PARTICLE_DENSITY_LAYERS.filter((id) => wanted.has(id));
  return resolved.length > 0 ? resolved : ['main'];
}

/** The config-facing resolver for the postShineDensityLayers key. */
export function resolveParticleDensityLayers(cfg: {
  postShineDensityLayers?: string;
}): ParticleDensityLayer[] {
  return parseParticleDensityLayers(cfg ? cfg.postShineDensityLayers : undefined);
}

/** Whether a resolved layer list names the given layer. */
export function particleDensityLayerSelected(
  layers: readonly ParticleDensityLayer[],
  id: ParticleDensityLayer,
): boolean {
  return layers.includes(id);
}

// ---------------------------------------------------------------------------
// Shared density-source store (splat publishes, consumers read)

export interface ParticleDensitySource {
  texture: THREE.Texture;
}

let currentSource: ParticleDensitySource | null = null;

export function setParticleDensitySource(next: ParticleDensitySource | null): void {
  if (currentSource === next) return;
  if (
    currentSource !== null && next !== null && currentSource.texture === next.texture
  ) {
    return;
  }
  currentSource = next;
}

export function getParticleDensitySource(): ParticleDensitySource | null {
  return currentSource;
}
