/**
 * Predator-Prey semantics (Grammar 2.0 stage 2, slice B6):
 * the OUTCOME layer over the Phase AA1 behaviour forces.
 *
 * The behaviour layer (lib/particleLifeBehavior.ts) already
 * makes species pursue their prey species and flee their
 * predator species around the fixed cyclic chain — but nothing
 * ever came of an encounter: no particle disappeared, changed
 * or multiplied. This module gives the encounter its semantics
 * WITHOUT a new solver, exactly as STAGE2_DESIGN.md section 3
 * B6 prescribes: predation is carried on the Grammar 2.0 live
 * rule engine (REP, lib/gpgpuParticleRulesLive.ts) as
 *
 *   - prey outcome: a TRUE-KILL (the prey is parked forever —
 *     the population really decreases) or, in 'convert' mode,
 *     a STATE TRANSITION to the assimilated state (the
 *     grammar's form of a species change: the live species
 *     itself is texel-index-derived and fixed by design, so a
 *     change of kind is expressed as a state other rules and
 *     force gates can read through `state`).
 *   - predator outcome: a SPAWN pulse (bit 13) while prey is
 *     in range — the population increases through the Aux
 *     pool's existing ruleSpawn mode, like every spawn rule.
 *
 * Two things had to exist before any of this could be a rule:
 *
 *   1. The encounter supply. Live conditions gain the
 *      neighbourhood variables `prey` / `pred` (the counts of
 *      sampled prey- / predator-species neighbours within the
 *      vision range), computed in the REP from the position
 *      texture with the same 64-point stride sampling the
 *      velocity pass's Particle Life block uses. The CPU twin
 *      of that supply is predationNeighborhood below; the GLSL
 *      lives in buildRuleEvalFragment under conditional
 *      emission (it appears only while a live condition reads
 *      prey / pred). Species are the plSpecies derivation
 *      (attrHash twin in lib/gpgpuAttributes.ts), so the REP,
 *      the sim and the draw agree on every particle's species.
 *
 *   2. The generated rules. While predation is enabled,
 *      buildPredationRules produces the fixed rule pair and
 *      mergePredationRules appends it AFTER the user's own
 *      live rules (user rules keep priority: state transitions
 *      are last-match-wins in rule order, and a user rule can
 *      always outvote the generated transition; the true-kill
 *      is an OR like every kill). A generated rule whose id
 *      the user already uses is skipped — the user's row wins.
 *
 * Relation form (inventory section 9's open question, fixed
 * here): the relation stays the FIXED CYCLIC CHAIN of the
 * behaviour layer (species i preys on (i+1) mod n, is preyed
 * on by (i-1) mod n). It is NOT widened to a per-pair matrix:
 * the matrix already has a job (the force weights), and a
 * second, divergent relation definition would let the forces
 * and the outcomes disagree about who eats whom.
 *
 * Range / species reuse the behaviour layer's keys
 * (gpgpuParticleLifeSpecies, and the vision range with the
 * same fallback the velocity block uses: vision range when
 * positive, else the interaction radius). The vision CONE is
 * not part of the REP supply: the counts are range-only. The
 * cone stays a property of the force layer (recorded in the
 * slice record).
 *
 * Defaults are the identity: predation disabled, and while
 * disabled no rule is generated, no REP variable is supplied
 * and every consumer predicate in this module is false, so a
 * stock config is bit-identical to the pre-B6 build.
 *
 * Follow-up (stage 2 B6 gate follow-up, 2026-11-27): the
 * first B-group gate found the generated prey rule firing on
 * essentially the whole population at the first evaluation —
 * not a defect (the implementation reproduces exactly), but
 * the strike scale is a raw count over the 64 global stride
 * samples, so strike 1 at spawn density is exceeded many
 * times over, and with species count 2 the cyclic chain
 * degenerates into mutual predation (every particle is
 * somebody's prey). Two additive keys soften the onset
 * WITHOUT changing any existing meaning, both defaulting to
 * the pre-follow-up behaviour:
 *
 *   - gpgpuPredationStrikeFrames (default 1): the prey
 *     outcome requires the strike condition to hold for this
 *     many CONSECUTIVE REP evaluations. The generated prey
 *     rule then reads the `predhold` condition variable —
 *     the consecutive-hold count accumulated by the hold
 *     pass (components/gpgpuPredationHoldPass.ts) under the
 *     same conditional-supply discipline as `hits`. The CPU
 *     twin of one accumulation step is predationHoldStep.
 *   - gpgpuPredationGraceSeconds (default 0): the prey
 *     outcome does not fire while fewer than this many
 *     seconds have passed since the predation rule set was
 *     (re)activated — the generated rule reads the `predage`
 *     variable (seconds since activation, supplied by the
 *     REP from its activation uniform), and the hold pass
 *     keeps its count at zero during the grace window, so
 *     counting starts fresh when the window ends.
 *
 * With both keys at their defaults the generated rule
 * strings are byte-identical to the original slice's.
 */

import { attrHash } from './gpgpuAttributes';
import { predatorSpeciesOf, preySpeciesOf } from './particleLifeBehavior';
import {
  buildRuleEvalFragment,
  resolveLiveParticleRules,
  type LiveParticleRule,
  type RuleEvalFragmentOptions,
} from './gpgpuParticleRulesLive';

export type PredationOutcome = 'kill' | 'convert';

/** Fixed ids of the generated rules (a user rule with the
 *  same id suppresses the generated one). */
export const PREDATION_PREY_RULE_ID = 'predation-prey';
export const PREDATION_BIRTH_RULE_ID = 'predation-birth';

/**
 * The state a converted prey transitions to: the grammar's
 * marker for "assimilated into the predator". 255 is the top
 * of the state range, far from the small ids rule lists and
 * group proxies use, so a collision needs a deliberate
 * set-state 255 of the user's own.
 */
export const PREDATION_ASSIMILATED_STATE = 255;

/** Neighbour samples per evaluation (the velocity block's 64). */
export const PREDATION_SAMPLE_COUNT = 64;

/** The config slice the predation layer reads. */
export interface PredationConfigSlice {
  gpgpuPredationEnabled?: boolean;
  gpgpuPredationOutcome?: string;
  gpgpuPredationBirth?: boolean;
  gpgpuPredationStrike?: number;
  gpgpuPredationStrikeFrames?: number;
  gpgpuPredationGraceSeconds?: number;
  gpgpuParticleLifeSpecies?: number;
  gpgpuParticleLifeVisionRange?: number;
  gpgpuParticleLifeRadius?: number;
}

export interface ResolvedPredation {
  enabled: boolean;
  outcome: PredationOutcome;
  birth: boolean;
  /** Sampled predators in range required for the prey rule. */
  strike: number;
  /**
   * Consecutive REP evaluations the strike condition must
   * hold before the prey outcome fires (B6 follow-up);
   * 1 = the original immediate semantics.
   */
  strikeFrames: number;
  /**
   * Seconds after (re)activation during which the prey
   * outcome cannot fire (B6 follow-up); 0 = no grace.
   */
  graceSeconds: number;
  speciesCount: number;
  /** Encounter range (vision range, else interaction radius). */
  range: number;
}

/** Upper clamp for the persistence count (evaluations). */
export const PREDATION_STRIKE_FRAMES_MAX = 600;
/** Upper clamp for the activation grace (seconds). */
export const PREDATION_GRACE_SECONDS_MAX = 300;
/** The hold count's saturation (the hold target's float .r). */
export const PREDATION_HOLD_MAX = 255;

function clampSpeciesCount(value: number | undefined): number {
  // The plSpecies clamps (lib/gpgpuParticleLife.ts): 2..6.
  return Math.max(2, Math.min(6, Math.round(value ?? 4) || 4));
}

/** Resolve the predation config slice (never throws). */
export function resolvePredation(cfg: PredationConfigSlice): ResolvedPredation {
  const speciesCount = clampSpeciesCount(cfg.gpgpuParticleLifeSpecies);
  const vision = typeof cfg.gpgpuParticleLifeVisionRange === 'number' && Number.isFinite(cfg.gpgpuParticleLifeVisionRange)
    ? cfg.gpgpuParticleLifeVisionRange
    : 0;
  const radius = typeof cfg.gpgpuParticleLifeRadius === 'number' && Number.isFinite(cfg.gpgpuParticleLifeRadius)
    ? cfg.gpgpuParticleLifeRadius
    : 60;
  const strikeRaw = typeof cfg.gpgpuPredationStrike === 'number' && Number.isFinite(cfg.gpgpuPredationStrike)
    ? Math.round(cfg.gpgpuPredationStrike)
    : 1;
  const framesRaw = typeof cfg.gpgpuPredationStrikeFrames === 'number' && Number.isFinite(cfg.gpgpuPredationStrikeFrames)
    ? Math.round(cfg.gpgpuPredationStrikeFrames)
    : 1;
  const graceRaw = typeof cfg.gpgpuPredationGraceSeconds === 'number' && Number.isFinite(cfg.gpgpuPredationGraceSeconds)
    ? cfg.gpgpuPredationGraceSeconds
    : 0;
  return {
    enabled: cfg.gpgpuPredationEnabled === true,
    outcome: cfg.gpgpuPredationOutcome === 'convert' ? 'convert' : 'kill',
    birth: cfg.gpgpuPredationBirth !== false,
    strike: Math.max(1, Math.min(PREDATION_SAMPLE_COUNT, strikeRaw)),
    strikeFrames: Math.max(1, Math.min(PREDATION_STRIKE_FRAMES_MAX, framesRaw)),
    graceSeconds: Math.max(0, Math.min(PREDATION_GRACE_SECONDS_MAX, graceRaw)),
    speciesCount,
    range: vision > 0 ? vision : Math.max(radius, 1),
  };
}

/** True while the predation semantics stand (rules generated). */
export function predationActive(cfg: PredationConfigSlice): boolean {
  return resolvePredation(cfg).enabled;
}

/**
 * True while the generated prey rule carries a true-kill
 * (the position pass's live true-kill consumer must stand —
 * the passes resolve it through here so the generated rule
 * counts exactly like a user-written one).
 */
export function predationTrueKillActive(cfg: PredationConfigSlice): boolean {
  const resolved = resolvePredation(cfg);
  return resolved.enabled && resolved.outcome === 'kill';
}

/**
 * True while the generated birth rule stands (its spawn
 * pulse feeds the existing bit-13 consumers: the Aux
 * ruleSpawn mode and the E2 rule spawn gate).
 */
export function predationBirthActive(cfg: PredationConfigSlice): boolean {
  const resolved = resolvePredation(cfg);
  return resolved.enabled && resolved.birth;
}

/**
 * The species of a texel index — the CPU twin of the GLSL
 * plSpecies (velocity helpers / points readout), via the
 * shared attrHash twin.
 */
export function predationSpeciesOfIndex(index: number, speciesCount: number): number {
  const n = clampSpeciesCount(speciesCount);
  return Math.min(Math.floor(attrHash(index + 17.17) * n), n - 1);
}

/**
 * CPU twin of the REP's neighbourhood supply (the GLSL block
 * buildRuleEvalFragment emits while a live condition reads
 * prey / pred): 64 stride samples over the position texture's
 * linear index space, the sampled texel's 3x3 block around
 * self skipped (the velocity pattern's uv-distance test),
 * neighbours counted when 0.001 < distance < range, split by
 * the cyclic relation. `positions` is the stride-4 position
 * array (xyz + age); parked particles sit at y = -99999 and
 * so never fall inside any range, on either side.
 */
export function predationNeighborhood(
  positions: ArrayLike<number>,
  selfIndex: number,
  texSize: number,
  speciesCount: number,
  range: number,
): { prey: number; pred: number } {
  const n = clampSpeciesCount(speciesCount);
  const selfSpecies = predationSpeciesOfIndex(selfIndex, n);
  const preySpecies = preySpeciesOf(selfSpecies, n);
  const predSpecies = predatorSpeciesOf(selfSpecies, n);
  const sx = positions[selfIndex * 4] ?? 0;
  const sy = positions[selfIndex * 4 + 1] ?? 0;
  const sz = positions[selfIndex * 4 + 2] ?? 0;
  const selfTx = selfIndex % texSize;
  const selfTy = Math.floor(selfIndex / texSize);
  const total = texSize * texSize;
  const stride = total / PREDATION_SAMPLE_COUNT;
  let prey = 0;
  let pred = 0;
  for (let i = 0; i < PREDATION_SAMPLE_COUNT; i++) {
    const si = Math.floor(i * stride);
    const dx = (si % texSize) - selfTx;
    const dy = Math.floor(si / texSize) - selfTy;
    if (Math.sqrt(dx * dx + dy * dy) < 1.5) continue;
    const ox = positions[si * 4] ?? 0;
    const oy = positions[si * 4 + 1] ?? 0;
    const oz = positions[si * 4 + 2] ?? 0;
    const ddx = ox - sx;
    const ddy = oy - sy;
    const ddz = oz - sz;
    const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
    if (d < range && d > 0.001) {
      const other = predationSpeciesOfIndex(si, n);
      if (other === preySpecies) prey += 1;
      if (other === predSpecies) pred += 1;
    }
  }
  return { prey, pred };
}

/**
 * The generated predation rules for a resolved config (empty
 * while disabled). Rule order is fixed: the prey outcome
 * first, then the birth pulse. The conditions are plain
 * expression-language formulas over the REP's neighbourhood
 * variables; in 'convert' mode the prey rule additionally
 * requires the particle not to be assimilated already (the
 * multiplication form of AND the grammar uses), so conversion
 * is a one-way transition instead of a per-evaluation rewrite.
 */
/** Grace seconds as an expression-language number literal. */
function fmtGraceSeconds(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function buildPredationRules(cfg: PredationConfigSlice): LiveParticleRule[] {
  const resolved = resolvePredation(cfg);
  if (!resolved.enabled) return [];
  // B6 follow-up: the strike core of the prey condition.
  // With strikeFrames at its default the core is the
  // original `pred >= strike`; above 1 it reads the hold
  // pass's consecutive-hold count (`predhold`) instead. A
  // positive grace multiplies in the activation-age gate
  // (`predage`). Both keys at their defaults reproduce the
  // original condition strings byte for byte.
  let strikeCore = resolved.strikeFrames > 1
    ? `predhold >= ${resolved.strikeFrames}`
    : `pred >= ${resolved.strike}`;
  if (resolved.graceSeconds > 0) {
    strikeCore = `(${strikeCore}) * (predage >= ${fmtGraceSeconds(resolved.graceSeconds)})`;
  }
  const preyRule: LiveParticleRule = resolved.outcome === 'convert'
    ? {
      id: PREDATION_PREY_RULE_ID,
      enabled: true,
      target: { type: 'all' },
      condition: `(${strikeCore}) * (state != ${PREDATION_ASSIMILATED_STATE})`,
      action: { type: 'set-state', state: PREDATION_ASSIMILATED_STATE },
    }
    : {
      id: PREDATION_PREY_RULE_ID,
      enabled: true,
      target: { type: 'all' },
      condition: strikeCore,
      action: { type: 'true-kill' },
    };
  const rules: LiveParticleRule[] = [preyRule];
  if (resolved.birth) {
    rules.push({
      id: PREDATION_BIRTH_RULE_ID,
      enabled: true,
      target: { type: 'all' },
      condition: 'prey >= 1',
      action: { type: 'spawn' },
    });
  }
  return rules;
}

/**
 * The effective live rule list: the user's rules first, the
 * generated predation rules appended (skipping any whose id
 * the user already owns). While predation is disabled this
 * returns the user list itself.
 */
export function mergePredationRules(
  userRules: readonly LiveParticleRule[],
  cfg: PredationConfigSlice,
): LiveParticleRule[] {
  const generated = buildPredationRules(cfg);
  if (generated.length === 0) return [...userRules];
  const owned = new Set(userRules.map((rule) => rule.id));
  return [...userRules, ...generated.filter((rule) => !owned.has(rule.id))];
}

/** Parse the user's live rule text and merge predation in. */
export function resolveLiveRulesWithPredation(
  cfg: PredationConfigSlice & { gpgpuParticleRulesLive?: string },
): LiveParticleRule[] {
  return mergePredationRules(resolveLiveParticleRules(cfg.gpgpuParticleRulesLive ?? ''), cfg);
}

/**
 * Whether the REP stands for the merged rule list under the
 * given build options — the predation counterpart of
 * liveRuleEvalStands, for consumers that must stand while the
 * REP stands (the attribute bake above all).
 */
export function predationRepStands(
  cfg: PredationConfigSlice & { gpgpuParticleRulesLive?: string },
  options: RuleEvalFragmentOptions,
): boolean {
  if (!predationActive(cfg)) return false;
  return buildRuleEvalFragment(resolveLiveRulesWithPredation(cfg), options) !== null;
}

/**
 * True while the hold pass must accumulate (B6 follow-up):
 * predation stands with a persistence requirement above the
 * immediate default. (A user rule reading `predhold` stands
 * the pass through the REP fragment instead — the wiring
 * keys the pass's lifecycle off the built fragment, exactly
 * like the contact pass; this predicate covers the
 * generated-rule route for non-scene consumers.)
 */
export function predationHoldActive(cfg: PredationConfigSlice): boolean {
  const resolved = resolvePredation(cfg);
  return resolved.enabled && resolved.strikeFrames > 1;
}

/**
 * CPU twin of ONE hold-pass accumulation step (the GLSL in
 * components/gpgpuPredationHoldPass.ts): the count of
 * consecutive evaluations for which the strike condition
 * held for this particle. A respawn restarts the count (the
 * age going backwards is the reset test, the contact pass's
 * discipline), the activation grace window holds the count
 * at zero (counting starts fresh when the window ends), a
 * failed condition resets it, and the count saturates at
 * PREDATION_HOLD_MAX. `age` / `prevAgeSeen` are the position
 * texture's .w (seconds of the current life).
 */
export function predationHoldStep(
  prev: { count: number; ageSeen: number },
  input: { age: number; pred: number; strike: number; inGrace: boolean },
): { count: number; ageSeen: number } {
  let count = prev.count;
  if (input.age < prev.ageSeen) count = 0;
  if (input.inGrace) {
    count = 0;
  } else if (input.pred >= input.strike) {
    count = Math.min(count + 1, PREDATION_HOLD_MAX);
  } else {
    count = 0;
  }
  return { count, ageSeen: input.age };
}
