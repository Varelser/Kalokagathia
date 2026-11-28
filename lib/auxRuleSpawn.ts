// Aux rule-driven spawn mode (Grammar 2.0 stage 1, slice 1D-3).
//
// Design: kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md §4 / §5.
// The chain gains a sixth event mode, `ruleSpawn` (mode id 4):
// a candidate (main-pool particle) whose live-rule mask — the
// REP output's .r channel — carries the spawn pulse (bit 13,
// LIVE_RULE_SPAWN_BIT) on this frame spawns a child at its
// position. The division of labour is the design's: the RULE
// decides whether (its condition, evaluated live by the REP),
// the Aux side decides how many (the shared (slot, tick,
// candidate) hash gate, capped by the level's intensity).
// The pulse is per-evaluation and never latches, so a rule
// that stops matching stops the spawns on the next REP
// evaluation (subject to the gpgpuRuleEvalInterval cadence).
//
// LEVEL 1 ONLY — fixed structurally, not by convention:
//  - the REP exists only for the MAIN pool (its texels are
//    main particles), so the chain levels' sources (Aux
//    particles) have no rule mask to sample: the chain event
//    builders carry no ruleSpawn variant at all;
//  - 'ruleSpawn' is a value of gpgpuAuxMode only — the
//    gpgpuAux2Mode union, its AI-catalog values and its
//    control-panel select never offer it;
//  - a chain level whose mode could somehow read 4 would
//    find no branch for it in the chain event chunk and
//    never spawn. Levels 2/3 follow the grammar only
//    indirectly: level 1's spawns themselves are
//    rule-driven, and their children chain from there.
//
// The spawn velocity is the shared burst distribution (the
// deathBurst form): a hash direction at the legacy
// 0.35 + 0.65 h speed factor. Children spawned this way are
// ordinary Aux particles of the level: the level's Life /
// Speed / Size / physics keys apply, and the slice-1D-1
// inheritance write records the parent's slots / species
// for them exactly like every other mode's spawns.
//
// This module is the pure, unit-tested source of truth for
// the mode's activation and gate semantics; the GLSL lives
// in components/gpgpuShaderAux.ts (the ruleSpawn variant of
// the level-1 event chunk) and mirrors the twins below.

import type { ParticleConfig } from '../types';
import { LIVE_RULE_SPAWN_BIT } from './gpgpuParticleRulesLive';

/** The ruleSpawn mode id in AUX_MODE_IDS. */
export const AUX_RULE_SPAWN_MODE_ID = 4;

/**
 * The level-1 shaders carry the ruleSpawn variant while the
 * level-1 mode is 'ruleSpawn' (the mode is a uniform, but the
 * REP binding and its branch are spliced text — the Phase
 * 19/20 variant discipline). Every other mode assembles the
 * stock strings. There is deliberately no chain counterpart.
 */
export function auxRuleSpawnLevel1Active(
  config: Pick<ParticleConfig, 'gpgpuAuxMode'>,
): boolean {
  return config.gpgpuAuxMode === 'ruleSpawn';
}

/**
 * Twin of the GLSL bit test
 * `mod(floor(mask / 8192.0), 2.0) > 0.5`: is the spawn pulse
 * standing in this REP mask value? Exact for the mask range
 * 0..16383 the REP writes (float-stored, nearest-sampled).
 */
export function auxRuleMaskHasSpawn(mask: number): boolean {
  if (!Number.isFinite(mask)) return false;
  return Math.floor(mask / LIVE_RULE_SPAWN_BIT) % 2 === 1;
}

/**
 * The spawn decision for one candidate on one tick: the
 * pulse must stand AND the shared hash gate must pass under
 * the intensity cap (`gate < clamp(intensity, 0, 1)` — the
 * design's "Intensity を上限とする既存ハッシュゲート").
 * `gate` is the shaders' auxHash roll in [0, 1). A
 * non-finite intensity never fires.
 */
export function auxRuleSpawnGate(mask: number, gate: number, intensity: number): boolean {
  if (!Number.isFinite(intensity)) return false;
  if (!auxRuleMaskHasSpawn(mask)) return false;
  const cap = Math.min(1, Math.max(0, intensity));
  return gate < cap;
}

type Vec3 = readonly [number, number, number];

/**
 * Twin of the GLSL ruleSpawn burst velocity: the shared
 * burst distribution — `h3` is the hash direction sample in
 * [-0.5, 0.5]^3 (normalised with the legacy 0.01 threshold
 * and the (0, 1, 0) fallback), `hA` drives the speed factor
 * 0.35 + 0.65 hA, exactly as deathBurst shapes its burst.
 */
export function auxRuleSpawnVelocity(
  h3: Vec3,
  hA: number,
  speed: number,
): [number, number, number] {
  const l = Math.hypot(h3[0], h3[1], h3[2]);
  const dir: [number, number, number] = l > 0.01
    ? [h3[0] / l, h3[1] / l, h3[2] / l]
    : [0, 1, 0];
  const mag = speed * (0.35 + 0.65 * hA);
  return [dir[0] * mag, dir[1] * mag, dir[2] * mag];
}
