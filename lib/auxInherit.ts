// Aux spawn inheritance (Grammar 2.0 stage 1, slice 1D-1).
//
// Design: kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md §3 / §5.
// At spawn time the Aux velocity pass's decision is mirrored
// into a per-level inheritance texture (128x128 RGBA float, one
// per chain level, NOT ping-ponged — it is written only on the
// spawn frame by a sparse-write pass and read everywhere else):
//
//   .r/.g/.b = the parent's attribute slots 0/1/2, raw values at
//              spawn time (main pool parent: the attribute
//              texture; Aux parent: the parent's own inheritance
//              texture, copied verbatim — multi-level propagation
//              without decay)
//   .a       = the parent's species, normalised to [0, 1]
//              (main pool parent: the plSpecies derivation; Aux
//              parent: the parent's .a, carried down)
//
// This module is the pure, unit-tested source of truth for when
// the inheritance machinery is active and for the value
// semantics; the GLSL lives in components/gpgpuShaderAux.ts
// (buildAuxInheritFrag / the inherit variants of the velocity
// and draw builders) and mirrors the twins below.

import type { ParticleConfig } from '../types';
import { attrSpeciesValue } from './gpgpuAttributes';

export type AuxInheritConfig = Pick<
  ParticleConfig,
  'gpgpuAuxInheritSlots' | 'gpgpuAuxInheritVelScale' | 'gpgpuAuxInheritColor'
>;

/** The inheritance texture exists (and the write pass runs)
 *  while the slots key is on. Default 1 = on. */
export function auxInheritSlotsEnabled(
  config: Pick<ParticleConfig, 'gpgpuAuxInheritSlots'>,
): boolean {
  return config.gpgpuAuxInheritSlots !== 0;
}

/**
 * The velocity shaders carry the inherit-scale variant while
 * inheritance is on AND the scale differs from 1: at exactly 1
 * the legacy coefficients evaluate identically, so the stock
 * strings stay assembled (the Phase 19/20 splice discipline).
 */
export function auxInheritVelScaleActive(config: AuxInheritConfig): boolean {
  return auxInheritSlotsEnabled(config) && config.gpgpuAuxInheritVelScale !== 1;
}

/**
 * The draw shaders carry the inheritance variant while
 * inheritance is on AND the colour mix is above 0: at 0 the
 * draw is the legacy level colour alone, stock strings.
 */
export function auxInheritColorActive(
  config: Pick<ParticleConfig, 'gpgpuAuxInheritSlots' | 'gpgpuAuxInheritColor'>,
): boolean {
  return auxInheritSlotsEnabled(config) && config.gpgpuAuxInheritColor > 0;
}

export type AuxInheritAttrBakeConfig = Pick<
  ParticleConfig,
  'gpgpuAuxInheritSlots' | 'gpgpuAuxInheritColor' | 'gpgpuAuxMode'
>;

/**
 * Whether spawn inheritance consumes the main attribute
 * texture (the scene's simAttrTex) — i.e. whether the
 * attribute bake must stand for inheritance's sake.
 *
 * The level-1 inheritance write re-evaluates the spawn
 * decision and reads the parent's attribute slots 0/1/2 out
 * of simAttrTex (AUX_INHERIT_MAIN), but the passes suppress
 * the write while that texture is null
 * (`if (inherit && inherit.mainAttrTex)`). The write can run
 * only while an aux mode is active (the aux passes return
 * early on 'none', and the chain levels stand only then),
 * and its product is read only by the draw colour mix
 * (auxInheritColorActive gates the draw variant at every
 * level; chain writes merely copy level 1's texels). So the
 * bake is a consumer dependency of inheritance exactly when
 * the colour mix is active AND a mode is selected.
 *
 * The velocity-scale variant is deliberately NOT part of
 * this predicate: it scales a coefficient of the parent
 * velocity term (read from the main VELOCITY texture) and
 * never touches the attribute texture or the inheritance
 * texture, so it needs no bake.
 *
 * Registered as a bake consumer in useGpgpuRuntime, by the
 * same reasoning as the baked / live rule lists: without it,
 * an inheritance-colour-only config (attribute expressions
 * set, no legacy consumer) leaves the bake down, the write
 * silently never runs, the inheritance texture stays zero
 * and children mix toward black instead of the parent's
 * slots (real-GPU gate finding, C4).
 */
export function auxInheritAttrBakeStands(config: AuxInheritAttrBakeConfig): boolean {
  return auxInheritColorActive(config) && config.gpgpuAuxMode !== 'none';
}

/** One inheritance texel: slots 0/1/2 raw + species in .a. */
export type AuxInheritTexel = [number, number, number, number];

/**
 * Twin of the level-1 inheritance write: the parent's
 * attribute slots 0/1/2 verbatim, plus its species value
 * (the plSpecies twin, lib/gpgpuAttributes.attrSpeciesValue).
 */
export function auxInheritFromMain(
  slots: readonly [number, number, number],
  parentIndex: number,
  speciesCount: number,
): AuxInheritTexel {
  return [slots[0], slots[1], slots[2], attrSpeciesValue(parentIndex, speciesCount)];
}

/**
 * Twin of the chain inheritance write: the parent's texel is
 * copied verbatim, so slots and species propagate to
 * grandchildren without decay.
 */
export function auxInheritFromParent(parent: AuxInheritTexel): AuxInheritTexel {
  return [parent[0], parent[1], parent[2], parent[3]];
}

/**
 * The legacy parent-velocity coefficients of the event modes
 * (components/gpgpuShaderAux.ts): sparkTrail inherits 0.15 of
 * the parent velocity, birthBurst 0.25; deathBurst and
 * bounceSplash inherit none. Slice 1D-1 scales exactly these
 * two terms by gpgpuAuxInheritVelScale and adds no new
 * inheritance to the other modes (the "do not widen legacy
 * behaviour" rule of the design).
 */
export const AUX_INHERIT_VEL_COEFFS: Record<'deathBurst' | 'bounceSplash' | 'sparkTrail' | 'birthBurst', number> = {
  deathBurst: 0,
  bounceSplash: 0,
  sparkTrail: 0.15,
  birthBurst: 0.25,
};

/** Twin of the scaled parent-velocity term of a spawn. */
export function auxInheritParentVelTerm(
  mode: keyof typeof AUX_INHERIT_VEL_COEFFS,
  parentVel: readonly [number, number, number],
  velScale: number,
): [number, number, number] {
  const k = AUX_INHERIT_VEL_COEFFS[mode] * velScale;
  return [parentVel[0] * k, parentVel[1] * k, parentVel[2] * k];
}

/**
 * Twin of the draw colour mix (the design's simplified form
 * for stage 1): the inherited texel's rgb is clamped to
 * [0, 1] and mixed with the level colour by
 * gpgpuAuxInheritColor; at 0 the level colour is returned
 * untouched.
 */
export function auxInheritColorMix(
  levelColor: readonly [number, number, number],
  inherit: AuxInheritTexel,
  mixRate: number,
): [number, number, number] {
  const m = Math.min(1, Math.max(0, mixRate));
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return [
    levelColor[0] + (c(inherit[0]) - levelColor[0]) * m,
    levelColor[1] + (c(inherit[1]) - levelColor[1]) * m,
    levelColor[2] + (c(inherit[2]) - levelColor[2]) * m,
  ];
}
