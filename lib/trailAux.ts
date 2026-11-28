// Trail mechanism change (Limit plan stage 4, slice S6):
// the Aux-type trail. Design: kalokagathia-pro/
// STAGE4_DESIGN_MATERIALS.md §4 (案A) and §0 (RT budget),
// STAGE4_PREP_INVENTORY.md §4 / §5.
//
// The legacy trail is a history snapshot ring: MAX_TRAIL (16)
// position render targets at texSize^2, one snapshot per frame,
// whose points feel no forces. In 'aux' mode the trail points
// are instead real (if simplified) simulation particles of the
// level-1 Aux pool: every Aux slot watches ONE parent in the
// main pool — candidate 0 of its chunk, the sparkTrail mapping
// — and sheds a child on its own emit tick, which inherits the
// parent's position, a sparkTrail-weighted share of its
// velocity (the 0.15 coefficient the spawn-inheritance scale
// already rewrites) and — through the slice 1D-1 inheritance
// write, which re-evaluates this mode like every other — its
// attribute slots and species. The child then lives under the
// Aux pool's own softened physics and dies after the trail
// life. The Aux pool's point draw (the pool's existing draw)
// renders the shed points as the trail: design step (i). The
// Ribbon/Tube rebuild over the Aux pool (step (ii)) is a later
// slice; it can group slots by parent through
// trailAuxParentIndex below, because the parent of a slot is
// a pure function of the slot index — no parent storage is
// needed anywhere.
//
// Boundary with stage 3 S7 (trail geometry export): S7 takes
// trajectories OUT of the state cache's main-pool frame
// series; this slice changes how live trails are MADE. No S7
// adapter is placed here — the parent-index function is the
// thin seam a later slice uses to turn an Aux trail readback
// into S7's (parent, age-ordered) point series.
//
// Flow control (the design's three points):
// - emit interval: a slot sheds once per interval frames, on
//   its own tick phase (slot index mod interval), so the pool
//   never fires in one global burst;
// - emit rate: each emit tick is gated by the shared
//   (slot, tick) hash against the rate in [0, 1];
// - pool cap: a slot holds ONE child at a time (the Aux life
//   management recycles a slot only once its child died — the
//   "oldest dies first" behaviour is the pool's own), so a
//   life longer than the mean spawn period drops the excess
//   emit ticks instead of overflowing. trailAuxFlow is the
//   exact steady-state accounting of those three points.
//
// Life resolution: gpgpuTrailAuxLife > 0 is an explicit life
// in seconds. At 0 (the default) the life is DERIVED from the
// history vocabulary — trailLength points spaced interval
// frames apart span trailLength * interval frames, so the
// derived life is trailLength * interval / 60 seconds, which
// makes the Aux trail span the same time window the history
// trail of the same length would have covered.
//
// Everything here resolves on the CPU side; the GLSL twin is
// the 'trail' branch of the Aux event chunk
// (components/gpgpuShaderAux.ts, mode id 6), spliced only
// while trailAuxActive holds, so at the defaults (mode
// 'history') every assembled string, RT set and draw is the
// legacy one byte-for-byte.

import type { ParticleConfig } from '../types';

/** The trail event's id in the Aux event chunk (uAuxMode). */
export const TRAIL_AUX_MODE_ID = 6;

/** The Aux event scan ticks at 60 Hz (the shaders' tick). */
export const TRAIL_REFERENCE_FPS = 60;

/** History ring depth (MAX_TRAIL in gpgpuShaderConstants). */
export const TRAIL_HISTORY_RT_COUNT = 16;

/** Bytes per history RT texel (RGBA float). */
export const TRAIL_HISTORY_BYTES_PER_TEXEL = 16;

export type TrailMode = ParticleConfig['gpgpuTrailMode'];

type TrailModeConfig = Pick<ParticleConfig, 'gpgpuTrailMode'>;
type TrailActiveConfig = Pick<ParticleConfig, 'gpgpuTrailEnabled' | 'gpgpuTrailMode'>;

/** Resolve the trail mode; anything but 'aux' is 'history'. */
export function resolveTrailMode(config: TrailModeConfig): TrailMode {
  return config.gpgpuTrailMode === 'aux' ? 'aux' : 'history';
}

/**
 * The Aux-type trail drives the level-1 Aux pool while the
 * trail itself is enabled and its mode is 'aux'. This is the
 * single predicate every consumer (passes, materials, render
 * outputs, history assets) keys on.
 */
export function trailAuxActive(config: TrailActiveConfig): boolean {
  return Boolean(config.gpgpuTrailEnabled) && resolveTrailMode(config) === 'aux';
}

/**
 * The history ring (and its draws) runs while the trail mode
 * is 'history'. At the default this is unconditionally the
 * legacy behaviour.
 */
export function trailHistoryActive(config: TrailModeConfig): boolean {
  return resolveTrailMode(config) === 'history';
}

/** Emit interval in frames: integer, clamped to [1, 240];
 *  a non-finite value falls back to the key default (2). */
export function resolveTrailEmitInterval(value: number): number {
  if (!Number.isFinite(value)) return 2;
  const r = Math.round(value);
  if (r < 1) return 1;
  if (r > 240) return 240;
  return r;
}

/** Emit rate: clamped to [0, 1]; a non-finite value falls
 *  back to the key default (1). */
export function resolveTrailEmitRate(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

type TrailLifeConfig = Pick<
  ParticleConfig,
  'gpgpuTrailAuxLife' | 'gpgpuTrailLength' | 'gpgpuTrailEmitInterval'
>;

/**
 * The trail child's life in seconds. An explicit
 * gpgpuTrailAuxLife > 0 wins (clamped to [0.05, 60]); at 0
 * the life is derived as trailLength * interval / 60 — the
 * span of the equivalent history trail — with trailLength
 * clamped to the history vocabulary [2, 16].
 */
export function resolveTrailAuxLifeSeconds(config: TrailLifeConfig): number {
  const explicit = config.gpgpuTrailAuxLife;
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(60, Math.max(0.05, explicit));
  }
  const length = Number.isFinite(config.gpgpuTrailLength)
    ? Math.min(16, Math.max(2, config.gpgpuTrailLength))
    : 8;
  const interval = resolveTrailEmitInterval(config.gpgpuTrailEmitInterval);
  const derived = (length * interval) / TRAIL_REFERENCE_FPS;
  return Math.min(60, Math.max(0.05, derived));
}

/**
 * The slot-to-parent mapping, mirroring the Aux event chunk's
 * chunk arithmetic term for term: chunk = max(1, floor(main /
 * aux)); a pool larger than the main population wraps by mod.
 * Candidate 0 of the chunk (stride offset 0) is the parent —
 * the same candidate sparkTrail sheds from. Returns -1 for
 * degenerate inputs.
 */
export function trailAuxParentIndex(slot: number, mainCount: number, auxCount: number): number {
  if (!Number.isFinite(slot) || !Number.isFinite(mainCount) || !Number.isFinite(auxCount)) return -1;
  const main = Math.floor(mainCount);
  const aux = Math.floor(auxCount);
  if (main < 1 || aux < 1 || slot < 0) return -1;
  const s = Math.floor(slot);
  if (aux > main) return s % main;
  const chunk = Math.max(1, Math.floor(main / aux));
  const idx = s * chunk;
  return idx < main ? idx : -1;
}

/** A slot's emit-tick phase: slot index mod interval, so
 *  neighbouring slots shed on neighbouring frames. */
export function trailSlotPhase(slot: number, interval: number): number {
  const iv = resolveTrailEmitInterval(interval);
  const s = Math.floor(Math.abs(Number.isFinite(slot) ? slot : 0));
  return s % iv;
}

/**
 * Whether the 60 Hz tick `tick` is slot `slot`'s emit tick:
 * (tick - phase) mod interval == 0. The GLSL twin phrases
 * the same test boundary-avoiding as mod(tick - slot + 0.5,
 * interval) < 1.0 on floats (FIX13: the direct phrasing
 * mod(tick - phase, interval) < 0.5 fed exact multiples of
 * a non-power-of-2 interval into mod(), which ANGLE/Metal
 * fast-reciprocal evaluation returns as the interval
 * itself, silencing the test in steady state — see
 * STAGE4_FIX13_RCP_MOD_RECORD; GLSL mod is always
 * non-negative for a positive modulus, exactly like the
 * wrap below).
 */
export function isTrailEmitTick(tick: number, slot: number, interval: number): boolean {
  const iv = resolveTrailEmitInterval(interval);
  const t = Math.floor(tick);
  const phase = trailSlotPhase(slot, iv);
  const m = (((t - phase) % iv) + iv) % iv;
  return m === 0;
}

export interface TrailAuxFlow {
  /** Parents watched by a slot (one candidate per slot). */
  coveredParents: number;
  /** Mean seconds between a parent's gated emit ticks. */
  spawnPeriodSeconds: number;
  /** Emit ticks demanded per second across covered parents. */
  demandPerSecond: number;
  /** Spawns the pool can actually sustain per second. */
  spawnsPerSecond: number;
  /** Share of demanded emit ticks dropped on busy slots. */
  dropRate: number;
  /** Steady-state live trail points across the pool. */
  aliveSteady: number;
  /** Steady-state live trail points per covered parent. */
  pointsPerParent: number;
}

/**
 * Steady-state flow accounting for the Aux trail, in the
 * Aux architecture's own terms: one slot watches one parent
 * and holds one child for `lifeSeconds`. Demand is the gated
 * emit cadence (60 / interval * rate per parent); capacity
 * is one spawn per life per slot. When the life outlasts the
 * spawn period the slot is busy at its emit ticks and the
 * excess is dropped — alive points per parent saturate at
 * exactly 1 and the drop rate is 1 - period / life.
 */
export function trailAuxFlow(input: {
  mainCount: number;
  auxCount: number;
  interval: number;
  rate: number;
  lifeSeconds: number;
}): TrailAuxFlow {
  const main = Math.max(0, Math.floor(Number.isFinite(input.mainCount) ? input.mainCount : 0));
  const aux = Math.max(0, Math.floor(Number.isFinite(input.auxCount) ? input.auxCount : 0));
  const coveredParents = Math.min(main, aux);
  const interval = resolveTrailEmitInterval(input.interval);
  const rate = resolveTrailEmitRate(input.rate);
  const life = Number.isFinite(input.lifeSeconds) && input.lifeSeconds > 0 ? input.lifeSeconds : 0;
  if (coveredParents < 1 || rate <= 0 || life <= 0) {
    return {
      coveredParents,
      spawnPeriodSeconds: Infinity,
      demandPerSecond: 0,
      spawnsPerSecond: 0,
      dropRate: 0,
      aliveSteady: 0,
      pointsPerParent: 0,
    };
  }
  const spawnPeriodSeconds = interval / (TRAIL_REFERENCE_FPS * rate);
  const demandPerSecond = coveredParents * (TRAIL_REFERENCE_FPS / interval) * rate;
  const capacityPerSecond = coveredParents / life;
  const spawnsPerSecond = Math.min(demandPerSecond, capacityPerSecond);
  const dropRate = demandPerSecond > 0 ? 1 - spawnsPerSecond / demandPerSecond : 0;
  const aliveSteady = spawnsPerSecond * life;
  return {
    coveredParents,
    spawnPeriodSeconds,
    demandPerSecond,
    spawnsPerSecond,
    dropRate,
    aliveSteady,
    pointsPerParent: coveredParents > 0 ? aliveSteady / coveredParents : 0,
  };
}

/**
 * Bytes held by the legacy history ring at a main-pool
 * texSize — the memory the Aux mode does NOT allocate (its
 * pool targets are the Aux pool's own, already resident).
 */
export function trailHistoryBytes(texSize: number): number {
  const t = Math.max(0, Math.floor(Number.isFinite(texSize) ? texSize : 0));
  return TRAIL_HISTORY_RT_COUNT * t * t * TRAIL_HISTORY_BYTES_PER_TEXEL;
}
