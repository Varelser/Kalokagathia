// FLIP 3D atlas fix — 案D downgrade (design draft
// FLIP_WEBGL_ATLAS_DESIGN_DRAFT §4.3): even after the atlas
// merge (案B), a velocity variant carrying BOTH the FLIP 3D
// coupling and the Grains complete neighbourhood scan needs
// 17 texture units, one over the 16-unit floor. On GPUs with
// MAX_TEXTURE_IMAGE_UNITS <= 16 the variant assembly therefore
// resolves the Grains neighbourhood from full scan (mode 1)
// to subsample (mode 0) whenever the FLIP 3D coupling stands,
// and the grainsFullScan variant is never built. SPH is not
// part of the full-scan plan switch, so the downgrade costs
// only Grains neighbourhood precision.
//
// E3 generalisation (Grains Stage B, 2026-11-25): the full-scan
// variant declares 17 samplers with or without the FLIP 3D
// coupling — the resident preamble already uses all 16 units
// and the scan adds uGrainsSortTex as the 17th. On a <=16-unit
// GPU the plain mode-1 program therefore fails validation and
// the velocity pass never runs (measured: the whole pool froze
// with Grains on AND off; see GRAINS_STAGEB_LOCK2). The variant
// assembly and the notice now resolve through the generalised
// rule grainsFullScanDowngradeApplies below, which drops the
// FLIP condition. flip3dGrainsDowngradeApplies keeps its
// original FLIP-specific meaning for the checks that pin it.
//
// The downgrade is never silent: while it applies, the notice
// store below is active and the root layout shows the notice.
// Shaped like lib/safeMode.ts (dependency-free module store +
// useSyncExternalStore hook).

import { useSyncExternalStore } from 'react';
import { flip3dActive } from './flip3d';
import { grainsCellSortActive, grainsNeighborhoodMode } from './gpgpuGrains';
import type { ParticleConfig } from '../types';

/** Texture-unit floor the velocity shader must fit into. */
export const TEXTURE_UNIT_FLOOR = 16;

/**
 * Pure downgrade rule: true exactly when the config stands
 * the FLIP 3D coupling AND the Grains full scan, and the GPU
 * reports at most TEXTURE_UNIT_FLOOR fragment texture units.
 * An unknown unit count (null) never downgrades — the
 * historical behaviour is preserved where the probe failed.
 */
export function flip3dGrainsDowngradeApplies(
  config: ParticleConfig,
  maxTextureImageUnits: number | null,
): boolean {
  return flip3dActive(config)
    && grainsNeighborhoodMode(config) === 1
    && maxTextureImageUnits !== null
    && maxTextureImageUnits <= TEXTURE_UNIT_FLOOR;
}

/**
 * Generalised downgrade rule (E3): true exactly when the
 * config stands the Grains full scan (mode 1) and the GPU
 * reports at most TEXTURE_UNIT_FLOOR fragment texture units,
 * whether or not the FLIP 3D coupling stands — the full-scan
 * velocity variant needs 17 units either way (resident 16 +
 * uGrainsSortTex), so on such a GPU it can never validate.
 * An unknown unit count (null) never downgrades — the
 * historical behaviour is preserved where the probe failed.
 */
export function grainsFullScanDowngradeApplies(
  config: ParticleConfig,
  maxTextureImageUnits: number | null,
): boolean {
  return grainsNeighborhoodMode(config) === 1
    && maxTextureImageUnits !== null
    && maxTextureImageUnits <= TEXTURE_UNIT_FLOOR;
}

/**
 * Resolved neighbourhood mode under the E3 downgrade: while
 * the downgrade applies, every Grains consumer resolves to
 * the subsample plan (mode 0), not just the velocity variant.
 * The position projection in particular must share the
 * velocity pass's plan — measured on the real GPU (Grains
 * Stage B residual isolation, 2026-11-25): with the velocity
 * side downgraded but the projection still resolving the
 * complete neighbourhood, the pile never settles (meanSpeed2
 * ~0.5 after 120 s, vs ~0.001 for the mode-0 control);
 * turning the projection off settled it, and raising rest
 * damping to its maximum changed nothing.
 */
export function resolveGrainsNeighborhoodMode(
  config: ParticleConfig,
  maxTextureImageUnits: number | null,
): 0 | 1 {
  return grainsFullScanDowngradeApplies(config, maxTextureImageUnits)
    ? 0
    : grainsNeighborhoodMode(config);
}

/**
 * Resolved cell-sort activity under the E3 downgrade: the
 * sorted cell index exists only for the complete-neighbourhood
 * consumers (the velocity full scan and the cell-search
 * projection variant). While the downgrade applies neither
 * consumer can use it, so the sort pool and passes resolve
 * off as well.
 */
export function resolveGrainsCellSortActive(
  config: ParticleConfig,
  maxTextureImageUnits: number | null,
): boolean {
  return grainsCellSortActive(config)
    && !grainsFullScanDowngradeApplies(config, maxTextureImageUnits);
}

// --- Notice store ---------------------------------------------------

export interface Flip3dGrainsDowngradeState {
  active: boolean;
}

export const FLIP3D_GRAINS_DOWNGRADE_NOTICE =
  'この GPU ではテクスチャユニット上限のため Grains フルスキャン近傍をサブサンプルに落としています';

let state: Flip3dGrainsDowngradeState = { active: false };
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function setFlip3dGrainsDowngrade(active: boolean): void {
  if (state.active === active) return;
  state = { active };
  emit();
}

export function getFlip3dGrainsDowngradeState(): Flip3dGrainsDowngradeState {
  return state;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useFlip3dGrainsDowngrade(): Flip3dGrainsDowngradeState {
  return useSyncExternalStore(subscribe, getFlip3dGrainsDowngradeState, getFlip3dGrainsDowngradeState);
}
