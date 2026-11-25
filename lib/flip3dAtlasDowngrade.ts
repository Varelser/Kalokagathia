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
// The downgrade is never silent: while it applies, the notice
// store below is active and the root layout shows the notice.
// Shaped like lib/safeMode.ts (dependency-free module store +
// useSyncExternalStore hook).

import { useSyncExternalStore } from 'react';
import { flip3dActive } from './flip3d';
import { grainsNeighborhoodMode } from './gpgpuGrains';
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

// --- Notice store ---------------------------------------------------

export interface Flip3dGrainsDowngradeState {
  active: boolean;
}

export const FLIP3D_GRAINS_DOWNGRADE_NOTICE =
  'この GPU では FLIP 3D と Grains フルスキャン併用時に Grains 近傍をサブサンプルに落としています';

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
