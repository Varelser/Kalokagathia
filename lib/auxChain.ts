// Aux chain resolution (Phase W1, grandchild emitters).
//
// The Aux event pool (B3 + Phase Q) can chain: level 1 watches the
// main GPGPU pool, level 2 watches level 1, level 3 watches level 2.
// Depth is capped at 3 — each level costs a full 128x128 texture
// quad plus a draw, so the product surface stops there ("最大3段").
//
// Levels >= 2 share ONE parameter set (the gpgpuAux2* keys); level 3
// re-applies the level-2 settings recursively. This module is the
// pure, unit-tested source of truth for which levels are active and
// with what parameters; the scene loop and the simulation passes
// consume it so the gating rules live in exactly one place.

import type { ParticleConfig } from '../types';

export const AUX_CHAIN_MAX_DEPTH = 3;

export type AuxChainLevel = 1 | 2 | 3;

export type AuxLevelParams = {
  level: AuxChainLevel;
  mode: Exclude<ParticleConfig['gpgpuAuxMode'], 'none'>;
  intensity: number;
  life: number;
  speed: number;
  size: number;
  gravityScale: number;
  drag: number;
  curl: number;
  /** '' = inherit (level 1: main colour; level >= 2: the resolved colour one level up). */
  color: string;
  /** Deterministic hash offset so sibling levels do not roll the same gates. */
  salt: number;
};

/** Clamp a raw depth value to the supported 1..3 range (NaN → 1). */
export function clampAuxDepth(value: number): AuxChainLevel {
  if (!Number.isFinite(value)) return 1;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > AUX_CHAIN_MAX_DEPTH) return 3;
  return rounded as AuxChainLevel;
}

/**
 * The per-level hash salts. Level 1 keeps salt 0 — its shaders are
 * the untouched legacy pair and never read a salt. Levels 2 and 3
 * add their salt into the chain shader's gate hashes so a level and
 * its child, watching correlated sources in the same frame, do not
 * fire on identical hash rolls.
 */
export function auxChainSalt(level: AuxChainLevel): number {
  if (level === 2) return 101.73;
  if (level === 3) return 202.41;
  return 0;
}

/**
 * Resolve the active chain levels for a config, in spawn order.
 * A level is active only when every level above it is active:
 * - level 1: gpgpuAuxMode is not 'none';
 * - level 2: depth >= 2 and gpgpuAux2Mode is not 'none';
 * - level 3: depth >= 3 (its mode is the Aux2 mode, re-applied).
 * Returns [] when the level-1 emitter itself is off.
 */
export function resolveAuxChainLevels(
  config: Pick<
    ParticleConfig,
    | 'gpgpuAuxMode'
    | 'gpgpuAuxIntensity'
    | 'gpgpuAuxLife'
    | 'gpgpuAuxSpeed'
    | 'gpgpuAuxSize'
    | 'gpgpuAuxGravityScale'
    | 'gpgpuAuxDrag'
    | 'gpgpuAuxCurl'
    | 'gpgpuAuxColor'
    | 'gpgpuAuxDepth'
    | 'gpgpuAux2Mode'
    | 'gpgpuAux2Intensity'
    | 'gpgpuAux2Life'
    | 'gpgpuAux2Speed'
    | 'gpgpuAux2Size'
    | 'gpgpuAux2GravityScale'
    | 'gpgpuAux2Drag'
    | 'gpgpuAux2Curl'
    | 'gpgpuAux2Color'
  >,
): AuxLevelParams[] {
  if (config.gpgpuAuxMode === 'none') return [];
  const levels: AuxLevelParams[] = [
    {
      level: 1,
      mode: config.gpgpuAuxMode,
      intensity: config.gpgpuAuxIntensity,
      life: config.gpgpuAuxLife,
      speed: config.gpgpuAuxSpeed,
      size: config.gpgpuAuxSize,
      gravityScale: config.gpgpuAuxGravityScale,
      drag: config.gpgpuAuxDrag,
      curl: config.gpgpuAuxCurl,
      color: config.gpgpuAuxColor,
      salt: auxChainSalt(1),
    },
  ];
  const depth = clampAuxDepth(config.gpgpuAuxDepth);
  if (depth < 2 || config.gpgpuAux2Mode === 'none') return levels;
  const shared: Omit<AuxLevelParams, 'level' | 'salt'> = {
    mode: config.gpgpuAux2Mode,
    intensity: config.gpgpuAux2Intensity,
    life: config.gpgpuAux2Life,
    speed: config.gpgpuAux2Speed,
    size: config.gpgpuAux2Size,
    gravityScale: config.gpgpuAux2GravityScale,
    drag: config.gpgpuAux2Drag,
    curl: config.gpgpuAux2Curl,
    color: config.gpgpuAux2Color,
  };
  levels.push({ ...shared, level: 2, salt: auxChainSalt(2) });
  if (depth >= 3) levels.push({ ...shared, level: 3, salt: auxChainSalt(3) });
  return levels;
}

/**
 * Phase 20 stage 4 (UE5 #22): whether the level-1 Aux shaders use
 * the SDF-splash variant strings (AUX_VEL_FRAG_PHASE20 /
 * AUX_POS_FRAG_PHASE20). The SDF contact source exists only while
 * BOTH the analytic SDF collider is enabled and the level-1 mode
 * is bounceSplash — in every other configuration the assembled
 * Aux shaders are the shipped stock strings, with no SDF text.
 * Chain levels are not covered: their sources are Aux particles,
 * whose physics has no SDF collider to collide with.
 */
export function auxSdfSplashActive(
  config: Pick<ParticleConfig, 'gpgpuSdfEnabled' | 'gpgpuAuxMode'>,
): boolean {
  return config.gpgpuSdfEnabled && config.gpgpuAuxMode === 'bounceSplash';
}

/**
 * Resolve a level's draw colour: an explicit colour wins; ''
 * inherits the resolved colour one level up (level 1 inherits the
 * main pool colour). Mirrors the Phase Q inheritance rule, extended
 * down the chain.
 */
export function resolveAuxLevelColor(
  config: Pick<ParticleConfig, 'gpgpuColor' | 'gpgpuAuxColor' | 'gpgpuAux2Color'>,
  level: AuxChainLevel,
): string {
  if (level === 1) return config.gpgpuAuxColor ? config.gpgpuAuxColor : config.gpgpuColor;
  if (config.gpgpuAux2Color) return config.gpgpuAux2Color;
  return config.gpgpuAuxColor ? config.gpgpuAuxColor : config.gpgpuColor;
}

/**
 * The chain event predicates, mirrored from the GLSL in
 * components/gpgpuShaderAux.ts (AUX_CHAIN_EVENT_GLSL) so the unit
 * tests can pin the semantics without a GPU:
 * - a source particle is ALIVE while it has a life and its age has
 *   not reached it (aux pools carry per-particle life in vel.w,
 *   unlike the main pool's global ageMax);
 * - deathBurst fires on the frame the age crosses the life;
 * - the probability gates are Kinetix's, shared with level 1.
 */
export function auxSourceAlive(age: number, life: number): boolean {
  return life > 0.001 && age < life;
}

export function auxChainDeathEvent(age: number, life: number, delta: number): boolean {
  return auxSourceAlive(age, life) && age + delta >= life;
}

export const AUX_CHAIN_DEATH_GATE = 0.25;
export const AUX_CHAIN_BOUNCE_GATE = 0.35;
export const AUX_CHAIN_TRAIL_GATE = 0.9;
