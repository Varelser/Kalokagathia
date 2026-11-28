/**
 * Live particle rules (Grammar 2.0 stage 1, slice 1A): the
 * live-evaluated sibling of the G10 baked grammar
 * (lib/gpgpuParticleRules.ts). Design of record:
 * kalokagathia-pro/STAGE1_GRAMMAR2_DESIGN.md.
 *
 * A live rule list lives in its OWN serialised config key
 * `gpgpuParticleRulesLive` (JSON string, default '' = no live
 * rules). The baked key is never touched by this module: the
 * two grammars coexist, the baked mask keeps owning slot 3 of
 * the attribute texture, and the live aggregate is produced
 * every frame (or every `gpgpuRuleEvalInterval` frames) by the
 * rule evaluation pass (REP, components/gpgpuRuleEvalPass.ts)
 * into its dedicated ping-pong render target:
 *
 *   .r action mask (bit layout below) / .g state id (/255) /
 *   .b previous-frame condition bits / .a display override
 *   (0 through slice 1B; slice 1C writes 1 + size for a
 *   matched display rule — see buildRuleEvalFragment)
 *
 * The consumers compose the two masks conservatively (design
 * section 7): force permits are baked AND live (a live rule
 * can only restrict further), the kill bit is baked OR live.
 * With no live rule the REP is never built, no consumer shader
 * gains the live segment, and behaviour is bit-identical to
 * v2.22.0.
 *
 * The rule FORM is G10's, extended: the action union declares
 * every Grammar 2.0 action kind up front (design section 2);
 * slices implement the consumers one by one. An action whose
 * consumer does not exist yet parses and is kept — it simply
 * does not act — instead of dropping the rule. Parse / cap /
 * duplicate discipline is G10's exactly (rules drop
 * individually and quietly, first duplicate id wins, the
 * character cap falls back wholesale).
 *
 * Live condition variables (design section 3, slice 1A):
 * vel / age / rad read the CURRENT sim state (unlike the
 * baked grammar, where they read the frame-0 initial state),
 * t is the sim clock, slot0..slot7 and the slot names read the
 * current attribute texture (post dyn / feedback values
 * included), g / x are the rule's own target membership, den
 * is the density supply (only while the density pass runs —
 * see the classification below), and state is the particle's
 * current state id read from the REP ping-pong's .g channel.
 *
 * Slice 1B additions:
 *  - set-state / set-group actions are consumed: a matched
 *    set-state writes its state value into the REP output's
 *    .g channel; a matched set-group writes the group's
 *    proxy state value (see liveGroupStateValue). Evaluation
 *    is SNAPSHOT-based: within one evaluation every rule's
 *    condition reads the state the particle carried INTO the
 *    evaluation (the previous REP output), transitions apply
 *    in rule order (last match wins) to the output only, and
 *    later rules observe a transition from the NEXT
 *    evaluation on. With the fixed initial state (section 8)
 *    the same input sequence reproduces the same transitions.
 *  - `sdf` condition variable: the signed distance of the
 *    particle's current position to the analytic SDF collider
 *    (negative = inside), evaluated in the REP from the same
 *    uniform bundle the velocity pass owns. While the
 *    collider is disabled the variable reads +1e6 (outside
 *    everything), so `sdf < 0` is false everywhere.
 *  - Collision variables ARE supplied by the contact pass
 *    (components/gpgpuContactPass.ts, the slice-1B follow-up
 *    item): `hit` is the contact flag of the most recent
 *    position step (0/1) and `hits` the accumulated contact
 *    count of the particle's current life (saturating at
 *    255, reset when a respawn restarts the age). The contact
 *    pass replays the position pass's five contact judgments
 *    (sphere shell / analytic SDF / mesh SDF / floor /
 *    terrain) from the frame-start position and the fresh
 *    velocity, into its own ping-pong target (.r = hits,
 *    .g = hit, .b = the age it saw, for the reset test). It
 *    stands only while a live condition reads hit / hits,
 *    and resolves off — the variables then read 0 — while a
 *    solver configuration makes the replay unfaithful
 *    (Verlet / Grains projection / Vellum / Rigid; DEM lives
 *    on the WebGPU route, where the REP itself never runs).
 *    See STAGE1_HIT_IMPL_RECORD.md.
 *
 * Slice 1E additions (CPU / serialisation only, no shader
 * changes):
 *  - Rule sets: the same config key also accepts a
 *    hierarchical set form ({ version: 1, sets: [...] })
 *    alongside the flat array form. A flat string parses as
 *    one implicit set; expansion to the flat evaluation view
 *    is fixed (enabled sets in document order, rules in set
 *    order, first-wins rule ids across the document, the
 *    global rule cap). parseLiveParticleRules reads both
 *    forms, so every existing consumer sees the expansion.
 *  - Black Box: a single set exports to / imports from a
 *    standalone tagged JSON payload; validation follows the
 *    same discipline as the rule list, and ids that collide
 *    with existing ones are reassigned fresh ids on import.
 *
 * Slice 1C additions:
 *  - true-kill / fracture / display actions are consumed.
 *    true-kill sets mask bit 6 and LATCHES: once the bit is
 *    set in the REP output it stays set (the fragment reads
 *    the previous mask back), so a true-killed particle never
 *    revives; the position pass parks it off-screen with its
 *    age frozen (the spawn gate's parking form) and it never
 *    reaches the respawn block. Fracture sets bit 7 for the
 *    evaluations in which a fracture rule matches (a pulse,
 *    not latched — the runtime re-bake consumer is a separate
 *    item, see STAGE1_1C_IMPL_RECORD.md). Display writes the
 *    .a channel: 0 = no override, otherwise 1 + the matched
 *    display action's size (last match wins); the points draw
 *    multiplies the point size by (.a - 1) while the override
 *    is present. Opacity is parsed and kept but not consumed
 *    in this slice.
 *  - force-gate targets extend to the extension forces
 *    (design section 4, bits 8-11): drag / vortex /
 *    attractor / well. The attractor gate is also the first
 *    external-force connection (design section 5): the
 *    attractor field is defined by its own attraction key
 *    family, outside the G10 five, and is now registered as
 *    a gate target. 'all' keeps its slice-1A meaning — the
 *    G10 five only; extension forces are gated by naming
 *    them. Extension permits follow the same permit
 *    semantics and are part of the aggregate mask, so the
 *    full-permit mask value is 31 + 3840 = 3871.
 *
 * Slice 1D-3 additions (design STAGE1_1D_SPAWN_DESIGN.md
 * section 4):
 *  - The spawn action is consumed: a matched spawn rule sets
 *    mask bit 13 for that evaluation only (a pulse, like
 *    fracture — it never latches). The consumer is the Aux
 *    pool's ruleSpawn mode (lib/auxRuleSpawn.ts), which
 *    samples the bit on the candidate's REP texel and spawns
 *    a child there, inheriting the parent's slots / species
 *    through the slice-1D-1 inheritance texture like every
 *    other Aux mode.
 *  - Classification: spawn is live-only. The baked grammar
 *    has no spawn to approximate with, so a spawn rule that
 *    cannot be evaluated live resolves to 'never' instead
 *    of 'baked-fallback'.
 *
 * External-force general form (slice 1C follow-up):
 *  - force-gate targets extend to 'custom' (bit 12, the slot
 *    the slice-1C record reserved): the user's registered
 *    custom force — the GLSL snippet held in the existing
 *    `gpgpuCustomForceCode` key and spliced into the
 *    velocity tail — becomes a gate target like any other
 *    force. Permit semantics are unchanged ('all' still
 *    restricts the G10 five only; 'custom' is gated by
 *    naming it), the permit joins the aggregate mask, and
 *    the full-permit value becomes 3871 + 4096 = 7967. The
 *    consumer is the velocity tail: while the live variant
 *    is assembled, buildVelocityFragment wraps the snippet
 *    so its net effect is blended by grpCustom, the gate
 *    local the live segment derives from bit 12. No new
 *    config key is added: the registration already lives in
 *    gpgpuCustomForceCode (default ''), and its validation /
 *    failure discipline is the existing custom-force one
 *    (lib/gpgpuCustomForce.ts — an invalid snippet quietly
 *    never activates). See STAGE1_EXTFORCE_IMPL_RECORD.md.
 *
 * Stage 2 slice B7 additions (Meander promotion,
 * lib/gpgpuMeander.ts):
 *  - force-gate targets extend to 'meander' (bit 14, the
 *    first free slot above the spawn pulse): the Phase AA1
 *    wander term, promoted to a standalone force chunk in
 *    the same slice. Permit semantics are unchanged ('all'
 *    still restricts the G10 five only; 'meander' is gated
 *    by naming it), the permit joins the aggregate mask,
 *    and the full-permit value becomes 7967 + 16384 = 24351
 *    (mask range 0..32767). The consumer is the velocity
 *    live segment: grpMeander, derived from bit 14, gates
 *    the term in both of its homes (the standalone chunk
 *    and the Particle Life block's internal copy).
 *
 * Stage 2 slice B6 additions (Predator-Prey semantics,
 * lib/gpgpuPredation.ts):
 *  - Neighbourhood condition variables `prey` / `pred`: the
 *    counts of sampled prey- / predator-species neighbours
 *    within the encounter range, under the cyclic chain of
 *    the Phase AA1 behaviour layer (species i preys on
 *    (i+1) mod n, is preyed on by (i-1) mod n; species are
 *    the plSpecies texel-index derivation). The supply is
 *    computed in the REP itself from the position texture
 *    with the velocity block's 64-point stride sampling,
 *    under the same conditional-emission discipline as
 *    `hit` / `hits`: the sampling block (and its uniforms)
 *    appears only while a live condition reads prey / pred,
 *    and the CPU twin (predationNeighborhood in
 *    lib/gpgpuPredation.ts) supplies the same-named vars to
 *    evaluateLiveRuleStep callers. The variables have no
 *    WGSL home (the WebGPU REP does no neighbour sampling),
 *    so a rule reading them is not WGSL-coverable and the
 *    config routes to WebGL, like hit / hits.
 *
 * B6 follow-up additions (2026-11-27):
 *  - `predhold`: the number of consecutive evaluations for
 *    which this particle's strike condition (pred >= the
 *    resolved predation strike) has held, accumulated by
 *    the hold pass (components/gpgpuPredationHoldPass.ts)
 *    into its own ping-pong target (.r = the count, raw).
 *    The supply follows the contact discipline exactly: the
 *    sampling lines appear only while a live condition reads
 *    predhold, the pass stands only then, the CPU twin is
 *    predationHoldStep (lib/gpgpuPredation.ts) and callers
 *    of evaluateLiveRuleStep supply vars.predhold. No WGSL
 *    home — routes to WebGL, like prey / pred.
 *  - `predage`: seconds since the predation rule set was
 *    (re)activated, supplied as uTime - uPredActivationTime
 *    (the wiring owns the activation timestamp). Appears
 *    only while a live condition reads it; no WGSL home.
 */

import {
  groupMembership,
  normalizeAttrNames,
  normalizeAttrNames2,
  ATTR_SLOT_COUNT_TOTAL,
  type AttrGroupMode,
} from './gpgpuAttributes';
import {
  evaluateGpgpuGroup,
  type GpgpuGroupDef,
} from './gpgpuGroups';
import {
  PARTICLE_RULES_MAX_CHARS,
  PARTICLE_RULES_MAX_RULES,
  PARTICLE_RULE_ID_RE,
  type ParticleRuleTarget,
} from './gpgpuParticleRules';
import {
  astReferencesVariable,
  compileExpression,
  evaluateCompiledExpressionWithVars,
  type ExpressionCompileResult,
} from './expression';
import {
  astToGlsl,
  astToWgsl,
  astUsesDensityVar,
  astUsesSimVar,
  simVarToGlsl,
  ATTR_DEN_MAIN_LINES,
  ATTR_DEN_UNIFORM_LINES,
  ATTR_SIM_MAIN_LINES,
  ATTR_SIM_UNIFORM_LINES,
} from './expressionGlsl';
import { DENSITY_VAR_NAME } from './gpgpuDensity';
import { DM_HASH11_GLSL } from './gpgpuRandom';

type CompiledAst = Extract<ExpressionCompileResult, { ok: true }>['ast'];

// ---------------------------------------------------------------------------
// Mask bit layout (design section 4, fixed)
// ---------------------------------------------------------------------------

export const LIVE_RULE_FORCE_BITS = {
  gravity: 1,
  turbulence: 2,
  curl: 4,
  wind: 8,
  morph: 16,
} as const;
export const LIVE_RULE_KILL_BIT = 32;
export const LIVE_RULE_TRUE_KILL_BIT = 64;
export const LIVE_RULE_FRACTURE_BIT = 128;
/**
 * Spawn pulse bit (Grammar 2.0 stage 1, slice 1D-3; design
 * STAGE1_1D_SPAWN_DESIGN.md section 4): bit 13. Bit 12
 * (4096) stays reserved for the general external-force form
 * (slice 1C record), so the mask range widens to 0..16383.
 * Pulse semantics, like fracture: the bit stands only in the
 * evaluations whose spawn rule matches — it never latches.
 * The consumer is the Aux pool's ruleSpawn mode (mode 4),
 * which samples this bit on the candidate's REP texel.
 */
export const LIVE_RULE_SPAWN_BIT = 8192;
/**
 * Custom-force permit bit (Grammar 2.0 stage 1, the
 * external-force general form; slice 1C follow-up): bit 12
 * (4096) — the slot the slice-1C record reserved for the
 * general form. The gated force is the user's registered
 * custom force (the GLSL snippet in `gpgpuCustomForceCode`,
 * spliced into the velocity tail at __CUSTOM_FORCE__): while
 * a live force-gate rule names 'custom', the particles it
 * matches lose this permit and the tail blends the snippet's
 * effect out for them (see buildVelocityFragment). Permit
 * semantics are the same as every other force: the bit is
 * part of the full-permit mask — with this bit the mask
 * range widened to 0..16383 and the full-permit value
 * became 7967 (stage 2 B7 later widened it again; see
 * LIVE_RULE_MEANDER_FORCE_BIT).
 */
export const LIVE_RULE_CUSTOM_FORCE_BIT = 4096;
/**
 * Meander permit bit (Grammar 2.0 stage 2, slice B7): bit 14
 * (16384) — the first free slot above the spawn pulse (bit
 * 13). The gated force is the Meander wander term
 * (lib/gpgpuMeander.ts), in both of its homes: the standalone
 * 'meander' chunk and the Particle Life block's internal
 * copy — the velocity live segment ANDs this bit into
 * grpMeander and both live chunk forms multiply the term by
 * it. Permit semantics are the same as every other force:
 * the bit is part of the full-permit mask, so the mask range
 * widens to 0..32767 and the full-permit value becomes 24351.
 */
export const LIVE_RULE_MEANDER_FORCE_BIT = 16384;
/** Force-gate extension bits (consumers arrive in slice 1C). */
export const LIVE_RULE_EXT_FORCE_BITS = {
  drag: 256,
  vortex: 512,
  attractor: 1024,
  well: 2048,
} as const;
/** The .r value of a particle no live rule restricts. */
export const LIVE_RULE_MASK_ALL_PERMIT =
  LIVE_RULE_FORCE_BITS.gravity
  | LIVE_RULE_FORCE_BITS.turbulence
  | LIVE_RULE_FORCE_BITS.curl
  | LIVE_RULE_FORCE_BITS.wind
  | LIVE_RULE_FORCE_BITS.morph;

export type LiveRuleForceName = keyof typeof LIVE_RULE_FORCE_BITS;
export type LiveRuleExtForceName = keyof typeof LIVE_RULE_EXT_FORCE_BITS;
export type LiveRuleForceTarget = LiveRuleForceName | 'all';
/**
 * Every force a live force-gate may name (slice 1C): the G10
 * five, the four extension forces, and 'all' — which keeps
 * its slice-1A meaning (the G10 five only; extension forces
 * are gated by naming them).
 */
export type LiveRuleGateTarget = LiveRuleForceName | LiveRuleExtForceName | 'custom' | 'meander' | 'all';
const FORCE_TARGETS: readonly string[] = [
  'all', 'gravity', 'turbulence', 'curl', 'wind', 'morph',
  'drag', 'vortex', 'attractor', 'well', 'custom', 'meander',
];
const FORCE_NAMES = Object.keys(LIVE_RULE_FORCE_BITS) as LiveRuleForceName[];
const EXT_FORCE_NAMES = Object.keys(LIVE_RULE_EXT_FORCE_BITS) as LiveRuleExtForceName[];
/** Permit bits of the extension forces (slice 1C). */
export const LIVE_RULE_EXT_PERMIT_MASK =
  LIVE_RULE_EXT_FORCE_BITS.drag
  | LIVE_RULE_EXT_FORCE_BITS.vortex
  | LIVE_RULE_EXT_FORCE_BITS.attractor
  | LIVE_RULE_EXT_FORCE_BITS.well;
/** The .r value of a particle no live rule restricts at all
 *  (the G10 five permits + the extension permits + the
 *  custom-force permit, bit 12 + the Meander permit, bit 14
 *  — stage 2 B7). This is also the REP targets' initial .r
 *  (design section 8). */
export const LIVE_RULE_MASK_FULL_PERMIT =
  LIVE_RULE_MASK_ALL_PERMIT | LIVE_RULE_EXT_PERMIT_MASK | LIVE_RULE_CUSTOM_FORCE_BIT | LIVE_RULE_MEANDER_FORCE_BIT;

// ---------------------------------------------------------------------------
// Rule form (design section 2: the union declares every kind)
// ---------------------------------------------------------------------------

export type LiveParticleRuleAction =
  | { type: 'force-gate'; force: LiveRuleGateTarget }
  | { type: 'kill' }
  | { type: 'color'; color: [number, number, number] }
  // Grammar 2.0 actions whose consumers arrive in later
  // slices. They parse and are kept; until their slice lands
  // they do not act (design section 2).
  | { type: 'true-kill' }
  | { type: 'fracture' }
  | { type: 'display'; size: number; opacity: number }
  | { type: 'set-state'; state: number }
  | { type: 'set-group'; id: string }
  // Grammar connection (slice 1D-3): the rule only FIRES —
  // it carries no parameters; the spawn style is the Aux
  // side's keys (mode ruleSpawn, intensity, speed, life).
  | { type: 'spawn' };

/** Action kinds slice 1A consumes in the REP mask. */
export const LIVE_RULE_CONSUMED_ACTIONS_1A: readonly string[] = ['force-gate', 'kill'];
/** Action kinds slice 1B adds: state transitions (REP .g). */
export const LIVE_RULE_CONSUMED_ACTIONS_1B: readonly string[] = ['set-state', 'set-group'];
/** Action kinds slice 1C adds: true-kill (mask bit 6,
 *  latched), fracture (bit 7) and display (REP .a). The
 *  'color' action remains unconsumed. */
export const LIVE_RULE_CONSUMED_ACTIONS_1C: readonly string[] = ['true-kill', 'fracture', 'display'];
/** Action kinds slice 1D-3 adds: spawn (mask bit 13, pulse). */
export const LIVE_RULE_CONSUMED_ACTIONS_1D3: readonly string[] = ['spawn'];
/** Every action kind the REP consumes as of the current slice. */
export const LIVE_RULE_CONSUMED_ACTIONS: readonly string[] = [
  ...LIVE_RULE_CONSUMED_ACTIONS_1A,
  ...LIVE_RULE_CONSUMED_ACTIONS_1B,
  ...LIVE_RULE_CONSUMED_ACTIONS_1C,
  ...LIVE_RULE_CONSUMED_ACTIONS_1D3,
];

/**
 * The proxy state value a set-group action writes for a
 * group id (slice 1B, design section 5's downgrade: group
 * change is realised as state-as-membership, group aggregates
 * are out of scope). The value is 1 + the index of the id's
 * first appearance among the set-group actions of the given
 * rule list (enabled rules, in list order); 0 when the id
 * never appears. Deterministic for a fixed rule list, and
 * identical in the REP fragment and the CPU twin because both
 * derive it from the same live-classified sequence.
 */
export function liveGroupStateValue(
  rules: readonly LiveParticleRule[],
  groupId: string,
): number {
  const seen: string[] = [];
  for (const rule of rules) {
    if (!rule.enabled || rule.action.type !== 'set-group') continue;
    if (!seen.includes(rule.action.id)) seen.push(rule.action.id);
  }
  const index = seen.indexOf(groupId);
  return index < 0 ? 0 : index + 1;
}

export interface LiveParticleRule {
  id: string;
  name?: string;
  enabled: boolean;
  target: ParticleRuleTarget;
  /** Expression-language truth formula; '' = always true. */
  condition: string;
  action: LiveParticleRuleAction;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTarget(raw: unknown): ParticleRuleTarget | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'all') return { type: 'all' };
  if (raw.type === 'group') {
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return null;
    return { type: 'group', id: raw.id };
  }
  if (raw.type === 'predicate') {
    const slot = raw.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 3) return null;
    if (raw.mode !== 'below' && raw.mode !== 'above' && raw.mode !== 'band') return null;
    if (typeof raw.low !== 'number' || !Number.isFinite(raw.low)) return null;
    if (typeof raw.high !== 'number' || !Number.isFinite(raw.high)) return null;
    return {
      type: 'predicate',
      slot,
      mode: raw.mode as AttrGroupMode,
      low: clamp01(raw.low),
      high: clamp01(raw.high),
      invert: raw.invert === true,
    };
  }
  return null;
}

function parseAction(raw: unknown): LiveParticleRuleAction | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'force-gate': {
      if (typeof raw.force !== 'string' || !FORCE_TARGETS.includes(raw.force)) return null;
      return { type: 'force-gate', force: raw.force as LiveRuleGateTarget };
    }
    case 'kill':
      return { type: 'kill' };
    case 'spawn':
      return { type: 'spawn' };
    case 'true-kill':
      return { type: 'true-kill' };
    case 'fracture':
      return { type: 'fracture' };
    case 'color': {
      const color = raw.color;
      if (!Array.isArray(color) || color.length !== 3) return null;
      const rgb: number[] = [];
      for (const component of color) {
        if (typeof component !== 'number' || !Number.isFinite(component)) return null;
        rgb.push(clamp01(component));
      }
      return { type: 'color', color: [rgb[0], rgb[1], rgb[2]] };
    }
    case 'display': {
      const size = typeof raw.size === 'number' && Number.isFinite(raw.size) ? clamp01(raw.size) : 1;
      const opacity = typeof raw.opacity === 'number' && Number.isFinite(raw.opacity) ? clamp01(raw.opacity) : 1;
      return { type: 'display', size, opacity };
    }
    case 'set-state': {
      if (typeof raw.state !== 'number' || !Number.isFinite(raw.state)) return null;
      return { type: 'set-state', state: Math.max(0, Math.min(255, Math.round(raw.state))) };
    }
    case 'set-group': {
      if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return null;
      return { type: 'set-group', id: raw.id };
    }
    default:
      return null;
  }
}

/** Validate one raw rule value; null = structurally invalid. */
export function validateLiveParticleRule(raw: unknown): LiveParticleRule | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !PARTICLE_RULE_ID_RE.test(raw.id)) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (typeof raw.condition !== 'string') return null;
  const target = parseTarget(raw.target);
  if (!target) return null;
  const action = parseAction(raw.action);
  if (!action) return null;
  const rule: LiveParticleRule = {
    id: raw.id,
    enabled: raw.enabled === undefined ? true : raw.enabled,
    target,
    condition: raw.condition,
    action,
  };
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    rule.name = raw.name.trim().slice(0, 80);
  }
  return rule;
}

/**
 * Collect validated rules from a raw list into `out`, under
 * the shared discipline: invalid entries drop quietly, the
 * first occurrence of an id wins (against `seen`, which the
 * caller may share across lists), and the global rule cap
 * stops collection.
 */
function collectValidatedRules(
  rawList: readonly unknown[],
  seen: Set<string>,
  out: LiveParticleRule[],
): void {
  for (const raw of rawList) {
    if (out.length >= PARTICLE_RULES_MAX_RULES) break;
    const rule = validateLiveParticleRule(raw);
    if (!rule) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
  }
}

/**
 * Parse the serialised live rule list — G10's discipline
 * exactly: broken rules drop individually and quietly, the
 * character cap falls back wholesale, first duplicate wins.
 * This never throws. Slice 1E: the string may be the flat
 * form (a JSON array of rules) or the set form (a JSON
 * object with a `sets` array); the set form returns its
 * expansion (see expandLiveRuleSets).
 */
export function parseLiveParticleRules(data: string | null | undefined): LiveParticleRule[] {
  if (typeof data !== 'string' || data.length === 0) return [];
  if (data.length > PARTICLE_RULES_MAX_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    const rules: LiveParticleRule[] = [];
    collectValidatedRules(parsed, new Set<string>(), rules);
    return rules;
  }
  return expandLiveRuleSets(parseLiveRuleSetDocumentValue(parsed).sets);
}

/** The rules that actually act: parsed and enabled. */
export function resolveLiveParticleRules(data: string | null | undefined): LiveParticleRule[] {
  return parseLiveParticleRules(data).filter((rule) => rule.enabled);
}

export function hasEffectiveLiveRules(data: string | null | undefined): boolean {
  return resolveLiveParticleRules(data).length > 0;
}

export function liveRulesHaveAction(
  data: string | null | undefined,
  actionType: LiveParticleRuleAction['type'],
): boolean {
  return resolveLiveParticleRules(data).some((rule) => rule.action.type === actionType);
}

/** Any effective rule whose action the REP consumes. */
export function liveRulesHaveConsumedAction(data: string | null | undefined): boolean {
  return resolveLiveParticleRules(data).some(
    (rule) => LIVE_RULE_CONSUMED_ACTIONS.includes(rule.action.type),
  );
}

/**
 * Whether the REP stands for a live rule list under the given
 * build options: at least one effective rule classifies live
 * with a consumed action (buildRuleEvalFragment non-null).
 * This is the exact predicate the scene's fragment test
 * applies; anything that must stand while the REP stands —
 * above all the attribute bake, whose texture the REP reads
 * through the scene's simAttrTex — resolves it through here
 * so the two can never drift apart. (A live-rules-only config
 * once left the bake unbuilt, the scene suppressed the REP
 * run on the null texture, and live rules silently never
 * evaluated — real-GPU gate finding, C group.)
 */
export function liveRuleEvalStands(
  data: string | null | undefined,
  options: RuleEvalFragmentOptions,
): boolean {
  return buildRuleEvalFragment(resolveLiveParticleRules(data), options) !== null;
}

/** Serialise back to the config string; an empty list is ''. */
export function serializeLiveParticleRules(
  rules: readonly LiveParticleRule[] | null | undefined,
): string {
  if (!rules || rules.length === 0) return '';
  const valid: LiveParticleRule[] = [];
  const seen = new Set<string>();
  for (const raw of rules) {
    if (valid.length >= PARTICLE_RULES_MAX_RULES) break;
    const rule = validateLiveParticleRule(raw);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    valid.push(rule);
  }
  if (valid.length === 0) return '';
  const text = JSON.stringify(valid);
  return text.length > PARTICLE_RULES_MAX_CHARS ? '' : text;
}

/** Default = no live rules at all (the '' state). */
export function isDefaultLiveParticleRules(
  input: string | readonly LiveParticleRule[] | null | undefined,
): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input === 'string') return parseLiveParticleRules(input).length === 0;
  return input.length === 0;
}

let liveRuleIdCounter = 0;
export function createLiveParticleRuleId(): string {
  liveRuleIdCounter += 1;
  return `liverule-${Date.now().toString(36)}-${liveRuleIdCounter.toString(36)}`;
}

/** A fresh, valid, neutral live rule (mirrors createParticleRule). */
export function createLiveParticleRule(): LiveParticleRule {
  return {
    id: createLiveParticleRuleId(),
    enabled: true,
    target: { type: 'all' },
    condition: '',
    action: { type: 'force-gate', force: 'all' },
  };
}

// ---------------------------------------------------------------------------
// Rule sets (slice 1E): hierarchy over the flat list + Black Box
// ---------------------------------------------------------------------------

/**
 * One named bundle of live rules (design section 5, slice
 * 1E). Sets are the upper structure over the flat rule list:
 * the config key accepts EITHER the flat form (a JSON array
 * of rules — the slice 1A/1B format, fully compatible) OR
 * the set form:
 *
 *   { "version": 1, "sets": [ { id, name?, enabled, rules } ] }
 *
 * A flat string is read as a document of one implicit set
 * (LIVE_RULE_FLAT_SET_ID, enabled, unnamed), so both forms
 * share one expansion and one validation discipline.
 */
export interface LiveParticleRuleSet {
  id: string;
  name?: string;
  enabled: boolean;
  rules: LiveParticleRule[];
}

export interface LiveRuleSetDocument {
  sets: LiveParticleRuleSet[];
}

/** The implicit set a flat-form string parses into. */
export const LIVE_RULE_FLAT_SET_ID = 'flat';
/** Cap on the number of sets in one document. */
export const LIVE_RULE_SETS_MAX_SETS = 8;
/** Version of the set form understood by this module. */
export const LIVE_RULE_SETS_FORMAT_VERSION = 1;
/** `kind` tag of a Black Box single-set export payload. */
export const LIVE_RULE_SET_EXPORT_KIND = 'kalokagathia-live-rule-set';

let liveRuleSetIdCounter = 0;
export function createLiveRuleSetId(): string {
  liveRuleSetIdCounter += 1;
  return `liveset-${Date.now().toString(36)}-${liveRuleSetIdCounter.toString(36)}`;
}

/**
 * Validate one raw set value; null = structurally invalid.
 * The discipline is the rule list's own: a set with a bad
 * id, a non-boolean `enabled`, or a non-array `rules` drops
 * wholesale; broken rules inside it drop individually.
 */
export function validateLiveRuleSet(raw: unknown): LiveParticleRuleSet | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !PARTICLE_RULE_ID_RE.test(raw.id)) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (!Array.isArray(raw.rules)) return null;
  const rules: LiveParticleRule[] = [];
  collectValidatedRules(raw.rules, new Set<string>(), rules);
  const set: LiveParticleRuleSet = {
    id: raw.id,
    enabled: raw.enabled === undefined ? true : raw.enabled,
    rules,
  };
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    set.name = raw.name.trim().slice(0, 80);
  }
  return set;
}

/** Parse an already-decoded JSON value into a set document. */
function parseLiveRuleSetDocumentValue(parsed: unknown): LiveRuleSetDocument {
  if (Array.isArray(parsed)) {
    const rules: LiveParticleRule[] = [];
    collectValidatedRules(parsed, new Set<string>(), rules);
    if (rules.length === 0) return { sets: [] };
    return { sets: [{ id: LIVE_RULE_FLAT_SET_ID, enabled: true, rules }] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sets)) return { sets: [] };
  if (parsed.version !== undefined && parsed.version !== LIVE_RULE_SETS_FORMAT_VERSION) {
    return { sets: [] };
  }
  const sets: LiveParticleRuleSet[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.sets) {
    if (sets.length >= LIVE_RULE_SETS_MAX_SETS) break;
    const set = validateLiveRuleSet(raw);
    if (!set) continue;
    if (seen.has(set.id)) continue;
    seen.add(set.id);
    sets.push(set);
  }
  return { sets };
}

/**
 * Parse a config string (either form) into its set
 * document, preserving the hierarchy. Never throws; broken
 * input yields an empty document.
 */
export function parseLiveRuleSetDocument(
  data: string | null | undefined,
): LiveRuleSetDocument {
  if (typeof data !== 'string' || data.length === 0) return { sets: [] };
  if (data.length > PARTICLE_RULES_MAX_CHARS) return { sets: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { sets: [] };
  }
  return parseLiveRuleSetDocumentValue(parsed);
}

/**
 * Expand a set document to the flat evaluation view. The
 * order rule is fixed: enabled sets in document order,
 * rules in set order; a disabled set contributes nothing;
 * rule ids resolve first-wins across the whole expansion;
 * the global rule cap (16) applies to the expansion.
 * Disabled RULES stay in the expansion (parse semantics —
 * resolveLiveParticleRules filters them), exactly as in the
 * flat form.
 */
export function expandLiveRuleSets(
  sets: readonly LiveParticleRuleSet[] | null | undefined,
): LiveParticleRule[] {
  const out: LiveParticleRule[] = [];
  if (!sets) return out;
  const seen = new Set<string>();
  for (const set of sets) {
    if (out.length >= PARTICLE_RULES_MAX_RULES) break;
    if (!set || set.enabled === false) continue;
    collectValidatedRules(set.rules ?? [], seen, out);
  }
  return out;
}

/**
 * Serialise a set document back to the config string. A
 * document that is exactly the implicit flat set (one set,
 * LIVE_RULE_FLAT_SET_ID, enabled, unnamed) serialises in
 * the flat form, so existing flat strings round-trip
 * byte-identically; anything else uses the set form. An
 * empty document is ''.
 */
export function serializeLiveRuleSetDocument(
  doc: LiveRuleSetDocument | null | undefined,
): string {
  if (!doc) return '';
  const sets: LiveParticleRuleSet[] = [];
  const seen = new Set<string>();
  for (const raw of doc.sets ?? []) {
    if (sets.length >= LIVE_RULE_SETS_MAX_SETS) break;
    const set = validateLiveRuleSet(raw);
    if (!set) continue;
    if (seen.has(set.id)) continue;
    seen.add(set.id);
    sets.push(set);
  }
  if (sets.length === 0) return '';
  const only = sets[0];
  if (
    sets.length === 1
    && only.id === LIVE_RULE_FLAT_SET_ID
    && only.enabled
    && only.name === undefined
  ) {
    return serializeLiveParticleRules(only.rules);
  }
  const text = JSON.stringify({ version: LIVE_RULE_SETS_FORMAT_VERSION, sets });
  return text.length > PARTICLE_RULES_MAX_CHARS ? '' : text;
}

// ---------------------------------------------------------------------------
// Black Box (slice 1E): single-set export / import
// ---------------------------------------------------------------------------

/** The standalone payload exportLiveRuleSet produces. */
export interface LiveRuleSetExport {
  kind: typeof LIVE_RULE_SET_EXPORT_KIND;
  version: number;
  set: LiveParticleRuleSet;
}

/**
 * Export one set as a standalone Black Box payload (a
 * tagged JSON string a user can save, share and re-import).
 * An invalid set exports as ''.
 */
export function exportLiveRuleSet(set: LiveParticleRuleSet | null | undefined): string {
  if (!set) return '';
  const valid = validateLiveRuleSet(set);
  if (!valid) return '';
  const payload: LiveRuleSetExport = {
    kind: LIVE_RULE_SET_EXPORT_KIND,
    version: LIVE_RULE_SETS_FORMAT_VERSION,
    set: valid,
  };
  const text = JSON.stringify(payload);
  return text.length > PARTICLE_RULES_MAX_CHARS ? '' : text;
}

/**
 * Import a Black Box payload produced by exportLiveRuleSet.
 * Returns null for anything that is not a well-formed
 * payload of the current kind / version; a structurally
 * invalid set is null, while broken rules inside a valid
 * set drop individually (the usual discipline).
 *
 * Id reassignment (fixed rule): a rule id that collides
 * with an existing rule id (the caller passes the ids
 * already in use) is replaced with a fresh id; ids that do
 * not collide are kept unchanged. The set's own id follows
 * the same rule against the existing set ids.
 */
export function importLiveRuleSet(
  text: string | null | undefined,
  existing?: { rules?: readonly string[]; sets?: readonly string[] },
): LiveParticleRuleSet | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (text.length > PARTICLE_RULES_MAX_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.kind !== LIVE_RULE_SET_EXPORT_KIND) return null;
  if (parsed.version !== LIVE_RULE_SETS_FORMAT_VERSION) return null;
  const set = validateLiveRuleSet(parsed.set);
  if (!set) return null;
  const takenRules = new Set<string>(existing?.rules ?? []);
  const rules = set.rules.map((rule) => {
    if (!takenRules.has(rule.id)) {
      takenRules.add(rule.id);
      return rule;
    }
    let fresh = createLiveParticleRuleId();
    while (takenRules.has(fresh)) fresh = createLiveParticleRuleId();
    takenRules.add(fresh);
    return { ...rule, id: fresh };
  });
  let setId = set.id;
  const takenSets = new Set<string>(existing?.sets ?? []);
  if (takenSets.has(setId)) {
    do {
      setId = createLiveRuleSetId();
    } while (takenSets.has(setId));
  }
  return { ...set, id: setId, rules };
}

// ---------------------------------------------------------------------------
// Condition variables and the live / baked-fallback classification
// ---------------------------------------------------------------------------

/**
 * The variable names a live condition may use: G10's set plus
 * `state` and `den` (design section 3). x / t need no entry —
 * the expression parser reserves them itself.
 */
export function liveRuleConditionVariables(
  names: readonly string[],
  names2: readonly string[],
): string[] {
  const vars = new Set<string>();
  for (const name of [...normalizeAttrNames(names), ...normalizeAttrNames2(names2)]) {
    vars.add(name.toLowerCase());
  }
  for (let slot = 0; slot < ATTR_SLOT_COUNT_TOTAL; slot++) vars.add(`slot${slot}`);
  vars.add('g');
  vars.add('vel');
  vars.add('age');
  vars.add('rad');
  vars.add('state');
  vars.add('sdf');
  vars.add('hit');
  vars.add('hits');
  vars.add('prey');
  vars.add('pred');
  vars.add('predhold');
  vars.add('predage');
  vars.add(DENSITY_VAR_NAME);
  return [...vars];
}

export type LiveRuleRoute = 'live' | 'baked-fallback' | 'never';

export interface LiveRuleClassification {
  rule: LiveParticleRule;
  route: LiveRuleRoute;
  /** Machine-readable reason; '' for a plain live route. */
  reason: string;
  /** Compiled condition AST (null = always true, or never). */
  conditionAst: CompiledAst | null;
}

/**
 * Can the shader twin evaluate this group target live? Only a
 * direct predicate-source group can (design section 6):
 * snapshot / composite sources are CPU data, so their members
 * are fixed at bake time and the rule falls back to the baked
 * approximation (frame-0 evaluation) instead.
 */
export function liveGroupTargetShaderResolvable(
  groupDefs: readonly GpgpuGroupDef[],
  id: string,
): boolean {
  const def = groupDefs.find((d) => d.id === id);
  return !!def && def.source.kind === 'predicate';
}

/**
 * Classify every effective rule (design sections 2/3/6):
 *
 *  - 'never': the condition does not compile in the
 *    expression language at all — the G10 discipline (kept,
 *    never matches, on either route).
 *  - 'baked-fallback': the rule is meaningful but cannot be
 *    evaluated live in slice 1A — its condition has no
 *    faithful GLSL form, it reads `den` while the density
 *    pass is not running, or its group target is not
 *    shader-resolvable. The caller approximates it with the
 *    baked (frame-0) evaluation instead of dropping it.
 *    Exception (slice 1D-3): spawn rules never take this
 *    route — the baked grammar cannot spawn, so a spawn rule
 *    that cannot go live resolves to 'never' instead.
 *  - 'live': the REP evaluates it every evaluation frame.
 */
export function classifyLiveRules(
  rules: readonly LiveParticleRule[],
  options: {
    names: readonly string[];
    names2: readonly string[];
    groupDefs?: readonly GpgpuGroupDef[];
    densityAvailable?: boolean;
  },
): LiveRuleClassification[] {
  const extraVars = liveRuleConditionVariables(options.names, options.names2);
  const groupDefs = options.groupDefs ?? [];
  return rules.filter((rule) => rule.enabled).map((rule) => {
    let conditionAst: CompiledAst | null = null;
    if (rule.condition.trim().length > 0) {
      const result = compileExpression(rule.condition, extraVars);
      if (!result.ok) {
        return { rule, route: 'never' as const, reason: 'condition-uncompilable', conditionAst: null };
      }
      conditionAst = result.ast;
    }
    // Slice 1D-3: a spawn rule is LIVE-ONLY (design
    // STAGE1_1D_SPAWN_DESIGN.md section 4). The baked grammar
    // has no spawn action to approximate it with, so every
    // would-be baked fallback resolves to 'never' (kept,
    // never matches) with the underlying reason preserved
    // behind the spawn-live-only- prefix.
    const fallback = (reason: string): LiveRuleClassification => (rule.action.type === 'spawn'
      ? { rule, route: 'never', reason: `spawn-live-only-${reason}`, conditionAst: null }
      : { rule, route: 'baked-fallback', reason, conditionAst });
    if (rule.target.type === 'group' && !liveGroupTargetShaderResolvable(groupDefs, rule.target.id)) {
      return fallback('group-not-shader-resolvable');
    }
    if (conditionAst && astUsesDensityVar(conditionAst) && !options.densityAvailable) {
      return fallback('den-without-density-pass');
    }
    if (conditionAst) {
      const glsl = liveConditionGlsl(conditionAst, 'tgt', options.names, options.names2);
      if (glsl === null) {
        return fallback('glsl-unrepresentable');
      }
    }
    return { rule, route: 'live' as const, reason: '', conditionAst };
  });
}

/**
 * Does a compiled live condition read the contact variables
 * (`hit` / `hits`)? The contact pass (components/
 * gpgpuContactPass.ts) stands only while this is true for at
 * least one live rule — the same conditional-supply
 * discipline as `den` / `sdf`. The variables are always
 * GLSL-representable (they sample the contact target), so
 * they never force a baked fallback; while the contact pass
 * is resolved off by a solver configuration the sampled
 * values are 0 (see STAGE1_HIT_IMPL_RECORD.md).
 */
export function liveConditionUsesContactVars(ast: CompiledAst): boolean {
  return astReferencesVariable(ast, 'hit') || astReferencesVariable(ast, 'hits');
}

/**
 * Does a compiled live condition read the neighbourhood
 * variables (`prey` / `pred`, stage 2 slice B6)? The REP
 * emits its stride-sampling supply block only while this is
 * true for at least one live rule — the same conditional-
 * supply discipline as `hit` / `hits`. The variables are
 * always GLSL-representable (they sample the position
 * texture the REP already binds), so they never force a
 * baked fallback; they have no WGSL home, so a rule reading
 * them is not WGSL-coverable (see liveConditionWgsl).
 */
export function liveConditionUsesPredationVars(ast: CompiledAst): boolean {
  return astReferencesVariable(ast, 'prey') || astReferencesVariable(ast, 'pred');
}

/**
 * Does a compiled live condition read the predation
 * follow-up variables (`predhold` / `predage`, stage 2 B6
 * follow-up)? The hold pass stands only while predhold is
 * read by at least one live rule, and the REP emits the
 * predage supply line only while predage is read — the same
 * conditional-supply discipline as `hit` / `hits`. Both are
 * always GLSL-representable and have no WGSL home (see
 * liveConditionWgsl).
 */
export function liveConditionUsesPredholdVar(ast: CompiledAst): boolean {
  return astReferencesVariable(ast, 'predhold');
}

export function liveConditionUsesPredageVar(ast: CompiledAst): boolean {
  return astReferencesVariable(ast, 'predage');
}

// ---------------------------------------------------------------------------
// GLSL generation for one live condition
// ---------------------------------------------------------------------------

/** GLSL float literal: always a decimal point or an exponent. */
function fmtNum(value: number): string {
  if (!Number.isFinite(value)) return '0.0';
  const raw = String(value);
  return /[.eE]/.test(raw) ? raw : `${raw}.0`;
}

function slotLocal(slot: number): string {
  return slot < 4 ? `v${slot}` : `w${slot - 4}`;
}

/**
 * Emit the GLSL for one compiled live condition, or null when
 * a variable has no live GLSL home. `targetLocal` is the name
 * of the float local holding this rule's target membership
 * (g / x read it). Slot locals follow the dyn pass's layout:
 * v0..v3 from the attribute texture, w0..w3 from the ext
 * texture.
 */
export function liveConditionGlsl(
  ast: CompiledAst,
  targetLocal: string,
  names: readonly string[],
  names2: readonly string[],
): string | null {
  const lowerNames = [...normalizeAttrNames(names), ...normalizeAttrNames2(names2)]
    .map((name) => name.toLowerCase());
  const slotByName = new Map<string, number>();
  for (let slot = 0; slot < ATTR_SLOT_COUNT_TOTAL; slot++) {
    const key = lowerNames[slot];
    if (!slotByName.has(key)) slotByName.set(key, slot);
  }
  return astToGlsl(ast, (name) => {
    if (name === 'x' || name === 'g') return targetLocal;
    if (name === 't') return 'uTime';
    if (name === 'state') return 'prevState';
    if (name === 'sdf') return 'simSdf';
    if (name === 'hit') return 'simHit';
    if (name === 'hits') return 'simHits';
    if (name === 'prey') return 'simPrey';
    if (name === 'pred') return 'simPred';
    if (name === 'predhold') return 'simPredHold';
    if (name === 'predage') return 'simPredAge';
    const sim = simVarToGlsl(name);
    if (sim !== null) return sim;
    if (/^slot[0-7]$/.test(name)) return slotLocal(Number(name.slice(4)));
    const target = slotByName.get(name);
    return target === undefined ? null : slotLocal(target);
  });
}

function targetGlsl(
  target: ParticleRuleTarget,
  groupDefs: readonly GpgpuGroupDef[],
): string {
  if (target.type === 'all') return '1.0';
  if (target.type === 'predicate') {
    const mode = { below: 0, above: 1, band: 2 }[target.mode];
    return `kaloGroupMembership(kaloAttrChannel(attrData, ${target.slot}), ${mode}, ${fmtNum(target.low)}, ${fmtNum(target.high)}, ${target.invert ? 'true' : 'false'})`;
  }
  const def = groupDefs.find((d) => d.id === target.id);
  if (def && def.source.kind === 'predicate') {
    const p = def.source.predicate;
    const mode = { below: 0, above: 1, band: 2 }[p.mode];
    return `kaloGroupMembership(kaloAttrChannel(attrData, ${p.slot}), ${mode}, ${fmtNum(p.low)}, ${fmtNum(p.high)}, ${p.invert ? 'true' : 'false'})`;
  }
  return '0.0'; // unreachable for live-classified rules
}

// ---------------------------------------------------------------------------
// REP fragment builder
// ---------------------------------------------------------------------------

/**
 * Analytic SDF support (slice 1B): a verbatim port of the
 * velocity pass's abSdfDistance (components/
 * gpgpuShaderSimulationVelocityHelpers.ts) and its gyroid
 * helper, renamed so the REP fragment stays self-contained.
 * The uniform bundle is the velocity pass's own SDF bundle,
 * supplied to the REP as well (components/gpgpuRuleEvalPass.ts
 * bindings). Emitted only when a live condition reads `sdf`,
 * under the same conditional-emission discipline as sim / den.
 * While uSdfEnabled is false the caller local reads +1e6.
 */
const REP_SDF_UNIFORM_LINES: readonly string[] = [
  'uniform bool uSdfEnabled;',
  'uniform int uSdfShape;',
  'uniform float uSdfX;',
  'uniform float uSdfY;',
  'uniform float uSdfZ;',
  'uniform float uSdfSize;',
];
const REP_SDF_FUNCTION_LINES: readonly string[] = [
  'float repGyroidField(vec3 p, vec3 sc, float size) {',
  '  vec3 q = (p - sc) * (3.14159265 / max(size, 1.0));',
  '  return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);',
  '}',
  'float repSdfDistance(vec3 p) {',
  '  vec3 sc = vec3(uSdfX, uSdfY, uSdfZ);',
  '  vec3 d = p - sc;',
  '  if (uSdfShape == 0) {',
  '    return length(d) - uSdfSize;',
  '  } else if (uSdfShape == 1) {',
  '    vec3 q = abs(d) - vec3(uSdfSize);',
  '    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);',
  '  } else if (uSdfShape == 2) {',
  '    float ringD = length(d.xz) - uSdfSize;',
  '    return length(vec2(ringD, d.y)) - uSdfSize * 0.35;',
  '  } else if (uSdfShape == 4) {',
  '    return repGyroidField(p, sc, uSdfSize) * uSdfSize * 0.227;',
  '  }',
  '  float yc = clamp(d.y, -uSdfSize, uSdfSize);',
  '  return length(vec3(d.x, d.y - yc, d.z)) - uSdfSize * 0.4;',
  '}',
];

/**
 * Neighbourhood supply (stage 2 slice B6): the REP-side
 * twin of the velocity Particle Life block's stride
 * sampling, renamed so the REP fragment stays self-contained.
 * Species are the plSpecies derivation (the velocity helpers'
 * plHash / plSpecies verbatim, over the shared dmHash11 —
 * lib/gpgpuRandom.ts DM_HASH11_GLSL), the relation is the
 * cyclic chain (prey = (self+1) mod n, predator =
 * (self-1) mod n), and the sample pattern is the velocity
 * block's: 64 stride samples over the texture's linear index
 * space, the sampled texel's 3x3 block around self skipped
 * by the uv-distance test, neighbours counted for
 * 0.001 < distance < uPreyRange. The CPU twin is
 * predationNeighborhood in lib/gpgpuPredation.ts. Emitted
 * only when a live condition reads `prey` / `pred`.
 */
const REP_PREY_UNIFORM_LINES: readonly string[] = [
  'uniform float uPreyTexSizeF;',
  'uniform int uPreySpecies;',
  'uniform float uPreyRange;',
];
export const REP_PREY_FUNCTION_LINES: readonly string[] = [
  'float repHash(float n) {',
  '  return dmHash11(n * 3.71 + 17.17);',
  '}',
  'int repSpecies(vec2 uv) {',
  '  float idx = floor(uv.y * uPreyTexSizeF) * uPreyTexSizeF + floor(uv.x * uPreyTexSizeF);',
  '  float h = repHash(idx + 17.17);',
  '  return int(min(floor(h * float(uPreySpecies)), float(uPreySpecies - 1)));',
  '}',
];
export const REP_PREY_MAIN_LINES: readonly string[] = [
  '  vec3 preySelfPos = texture2D(uPosTex, vUv).xyz;',
  '  int preySelfSpecies = repSpecies(vUv);',
  '  int preyPreySpecies = int(mod(float(preySelfSpecies + 1), float(uPreySpecies)));',
  '  int preyPredSpecies = int(mod(float(preySelfSpecies - 1 + uPreySpecies), float(uPreySpecies)));',
  '  float simPrey = 0.0;',
  '  float simPred = 0.0;',
  '  float preyStride = (uPreyTexSizeF * uPreyTexSizeF) / 64.0;',
  '  for (int i = 0; i < 64; i++) {',
  '    float si = floor(float(i) * preyStride);',
  '    vec2 sUv = (vec2(mod(si, uPreyTexSizeF), floor(si / uPreyTexSizeF)) + 0.5) / uPreyTexSizeF;',
  '    if (length(sUv - vUv) < 1.5 / uPreyTexSizeF) continue;',
  '    vec3 oPos = texture2D(uPosTex, sUv).xyz;',
  '    float d = distance(preySelfPos, oPos);',
  '    if (d < uPreyRange && d > 0.001) {',
  '      int os = repSpecies(sUv);',
  '      if (os == preyPreySpecies) simPrey += 1.0;',
  '      if (os == preyPredSpecies) simPred += 1.0;',
  '    }',
  '  }',
];

export interface RuleEvalFragmentOptions {
  names: readonly string[];
  names2: readonly string[];
  groupDefs?: readonly GpgpuGroupDef[];
  densityAvailable?: boolean;
}

/**
 * Build the rule evaluation pass's fragment shader, or null
 * when the pass must not exist: no effective rule classifies
 * live with a consumed action (force-gate / kill from slice
 * 1A, set-state / set-group from slice 1B).
 * The fragment follows the dyn pass's conditional-emission
 * discipline — the sim / density / ext / sdf / contact
 * sampling lines appear only when a live condition actually
 * reads those variables, so a fragment that uses none of
 * them carries none of them.
 *
 * Output layout (design section 1): .r = the aggregate live
 * mask (section 4 bits — the five G10 permits, kill, the
 * latched true-kill, the fracture pulse, the four
 * extension permits and, slice 1D-3, the spawn pulse on
 * bit 13), .g = the state id after this
 * evaluation's transitions (/255; snapshot semantics — every
 * condition in this evaluation read the state carried in,
 * transitions land in the output and are observed from the
 * next evaluation), .b = this frame's per-rule condition
 * bits (they become the previous-frame bits for the next
 * evaluation), .a = the display override (slice 1C): 0 = no
 * override, otherwise 1 + the size of the last matching
 * display rule.
 */
export function buildRuleEvalFragment(
  rulesInput: readonly LiveParticleRule[],
  options: RuleEvalFragmentOptions,
): string | null {
  const classified = classifyLiveRules(rulesInput, options);
  const live = classified.filter((entry) => entry.route === 'live');
  const consumed = live.filter((entry) => LIVE_RULE_CONSUMED_ACTIONS.includes(entry.rule.action.type));
  if (consumed.length === 0) return null;

  let usesSim = false;
  let usesDen = false;
  let usesExt = false;
  let usesSdf = false;
  let usesHit = false;
  let usesPrey = false;
  let usesPredHold = false;
  let usesPredAge = false;
  for (const entry of live) {
    if (!entry.conditionAst) continue;
    if (astUsesSimVar(entry.conditionAst)) usesSim = true;
    if (astUsesDensityVar(entry.conditionAst)) usesDen = true;
    if (astReferencesVariable(entry.conditionAst, 'sdf')) usesSdf = true;
    if (liveConditionUsesContactVars(entry.conditionAst)) usesHit = true;
    if (liveConditionUsesPredationVars(entry.conditionAst)) usesPrey = true;
    if (liveConditionUsesPredholdVar(entry.conditionAst)) usesPredHold = true;
    if (liveConditionUsesPredageVar(entry.conditionAst)) usesPredAge = true;
    for (let slot = 4; slot < ATTR_SLOT_COUNT_TOTAL; slot++) {
      if (astReferencesVariable(entry.conditionAst, `slot${slot}`)) usesExt = true;
    }
    const lowerNames = [...normalizeAttrNames(options.names), ...normalizeAttrNames2(options.names2)]
      .map((name) => name.toLowerCase());
    for (let slot = 4; slot < ATTR_SLOT_COUNT_TOTAL; slot++) {
      if (astReferencesVariable(entry.conditionAst, lowerNames[slot])) usesExt = true;
    }
  }

  // Which forces the live force-gate rules restrict at all
  // (permit semantics, as in the bake): an unrestricted force
  // starts permitted, a restricted one starts denied and is
  // permitted by any matching rule. Slice 1C: the extension
  // forces follow the same semantics under their own
  // restricted table; 'all' restricts the G10 five only.
  const restricted: Record<LiveRuleForceName, boolean> = {
    gravity: false, turbulence: false, curl: false, wind: false, morph: false,
  };
  const restrictedExt: Record<LiveRuleExtForceName, boolean> = {
    drag: false, vortex: false, attractor: false, well: false,
  };
  let restrictedCustom = false;
  let restrictedMeander = false;
  for (const entry of live) {
    if (entry.rule.action.type !== 'force-gate') continue;
    if (entry.rule.action.force === 'all') {
      for (const name of FORCE_NAMES) restricted[name] = true;
    } else if ((FORCE_NAMES as readonly string[]).includes(entry.rule.action.force)) {
      restricted[entry.rule.action.force as LiveRuleForceName] = true;
    } else if (entry.rule.action.force === 'custom') {
      restrictedCustom = true;
    } else if (entry.rule.action.force === 'meander') {
      restrictedMeander = true;
    } else {
      restrictedExt[entry.rule.action.force as LiveRuleExtForceName] = true;
    }
  }

  const blocks: string[] = [];
  live.forEach((entry, index) => {
    const { rule } = entry;
    const tgt = `tgt${index}`;
    const matched = `matched${index}`;
    const lines: string[] = [];
    lines.push(`  float ${tgt} = ${targetGlsl(rule.target, options.groupDefs ?? [])};`);
    if (entry.conditionAst) {
      const glsl = liveConditionGlsl(entry.conditionAst, tgt, options.names, options.names2);
      if (glsl === null) return; // classified live above; defensive
      lines.push(`  float cond${index} = ${glsl};`);
      lines.push(`  float ${matched} = (${tgt} > 0.5 && cond${index} == cond${index} && abs(cond${index}) < 1.0e30 && cond${index} != 0.0) ? 1.0 : 0.0;`);
    } else {
      lines.push(`  float ${matched} = (${tgt} > 0.5) ? 1.0 : 0.0;`);
    }
    if (index < 8) lines.push(`  condBits += ${matched} * ${fmtNum(2 ** index)};`);
    if (rule.action.type === 'force-gate') {
      const forces: readonly string[] = rule.action.force === 'all' ? FORCE_NAMES : [rule.action.force];
      for (const name of forces) {
        const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
        lines.push(`  ${local} = max(${local}, ${matched});`);
      }
    } else if (rule.action.type === 'kill') {
      lines.push(`  liveKill = max(liveKill, ${matched});`);
    } else if (rule.action.type === 'true-kill') {
      lines.push(`  liveTrueKill = max(liveTrueKill, ${matched});`);
    } else if (rule.action.type === 'fracture') {
      lines.push(`  liveFracture = max(liveFracture, ${matched});`);
    } else if (rule.action.type === 'spawn') {
      // Slice 1D-3: the spawn pulse (bit 13) — stands only
      // in the evaluations whose rule matches, like the
      // fracture pulse; the Aux ruleSpawn mode samples it.
      lines.push(`  liveSpawn = max(liveSpawn, ${matched});`);
    } else if (rule.action.type === 'display') {
      // Last matching display rule wins (rule order), like
      // the state transitions. The .a encoding is 1 + size
      // so 0 stays free for "no override".
      lines.push(`  liveDisplay = (${matched} > 0.5) ? ${fmtNum(1 + rule.action.size)} : liveDisplay;`);
    } else if (rule.action.type === 'set-state') {
      // Snapshot semantics: the write lands in nextState
      // only; conditions in this evaluation keep reading
      // prevState. Later matching transitions overwrite
      // earlier ones (rule order, last wins).
      lines.push(`  nextState = (${matched} > 0.5) ? ${fmtNum(rule.action.state)} : nextState;`);
    } else if (rule.action.type === 'set-group') {
      const proxy = liveGroupStateValue(live.map((e) => e.rule), rule.action.id);
      lines.push(`  nextState = (${matched} > 0.5) ? ${fmtNum(proxy)} : nextState;`);
    }
    blocks.push(lines.join('\n'));
  });

  const fgInit = [
    ...FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `  float ${local} = ${restricted[name] ? '0.0' : '1.0'};`;
    }),
    ...EXT_FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `  float ${local} = ${restrictedExt[name] ? '0.0' : '1.0'};`;
    }),
    `  float fgCustom = ${restrictedCustom ? '0.0' : '1.0'};`,
    `  float fgMeander = ${restrictedMeander ? '0.0' : '1.0'};`,
  ];
  const maskTerms = [
    ...FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `${local} * ${fmtNum(LIVE_RULE_FORCE_BITS[name])}`;
    }),
    ...EXT_FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `${local} * ${fmtNum(LIVE_RULE_EXT_FORCE_BITS[name])}`;
    }),
    `fgCustom * ${fmtNum(LIVE_RULE_CUSTOM_FORCE_BIT)}`,
    `fgMeander * ${fmtNum(LIVE_RULE_MEANDER_FORCE_BIT)}`,
  ];

  return [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uAttrTex;',
    ...(usesExt ? ['uniform sampler2D uExtTex;'] : []),
    ...(usesSim ? ATTR_SIM_UNIFORM_LINES : []),
    ...(usesSdf && !usesSim ? ['uniform sampler2D uPosTex;'] : []),
    ...(usesDen ? ATTR_DEN_UNIFORM_LINES : []),
    ...(usesSdf ? REP_SDF_UNIFORM_LINES : []),
    ...(usesPrey && !usesSim && !usesSdf ? ['uniform sampler2D uPosTex;'] : []),
    ...(usesPrey ? REP_PREY_UNIFORM_LINES : []),
    'uniform sampler2D uPrevTex;',
    ...(usesHit ? ['uniform sampler2D uHitTex;'] : []),
    ...(usesPredHold ? ['uniform sampler2D uPredHoldTex;'] : []),
    ...(usesPredAge ? ['uniform float uPredActivationTime;'] : []),
    'uniform float uTime;',
    'float kaloAttrChannel(vec4 a, int slot) {',
    '  if (slot == 0) return a.r;',
    '  if (slot == 1) return a.g;',
    '  if (slot == 2) return a.b;',
    '  return a.a;',
    '}',
    'float kaloGroupMembership(float av, int mode, float low, float high, bool invert) {',
    '  float m;',
    '  if (mode == 0) m = step(av, high);',
    '  else if (mode == 1) m = step(low, av);',
    '  else m = step(low, av) * step(av, high);',
    '  return invert ? 1.0 - m : m;',
    '}',
    ...(usesSdf ? REP_SDF_FUNCTION_LINES : []),
    ...(usesPrey ? [DM_HASH11_GLSL.trimEnd()] : []),
    ...(usesPrey ? REP_PREY_FUNCTION_LINES : []),
    'void main() {',
    '  vec4 attrData = texture2D(uAttrTex, vUv);',
    '  float v0 = attrData.r;',
    '  float v1 = attrData.g;',
    '  float v2 = attrData.b;',
    '  float v3 = attrData.a;',
    ...(usesExt ? [
      '  vec4 extData = texture2D(uExtTex, vUv);',
      '  float w0 = extData.r;',
      '  float w1 = extData.g;',
      '  float w2 = extData.b;',
      '  float w3 = extData.a;',
    ] : []),
    ...(usesSim ? ATTR_SIM_MAIN_LINES : []),
    ...(usesDen ? ATTR_DEN_MAIN_LINES : []),
    ...(usesSdf && !usesSim ? ['  vec4 simPos = texture2D(uPosTex, vUv);'] : []),
    ...(usesSdf ? ['  float simSdf = uSdfEnabled ? repSdfDistance(simPos.xyz) : 1.0e6;'] : []),
    '  vec4 prev = texture2D(uPrevTex, vUv);',
    '  float prevState = floor(prev.g * 255.0 + 0.5);',
    ...(usesHit ? [
      '  vec4 hitData = texture2D(uHitTex, vUv);',
      '  float simHits = hitData.r;',
      '  float simHit = hitData.g;',
    ] : []),
    ...(usesPredHold ? [
      '  float simPredHold = texture2D(uPredHoldTex, vUv).r;',
    ] : []),
    ...(usesPredAge ? [
      '  float simPredAge = uTime - uPredActivationTime;',
    ] : []),
    ...(usesPrey ? REP_PREY_MAIN_LINES : []),
    '  float nextState = prevState;',
    ...fgInit,
    '  float liveKill = 0.0;',
    '  float liveTrueKill = 0.0;',
    '  float liveFracture = 0.0;',
    '  float liveSpawn = 0.0;',
    '  float liveDisplay = 0.0;',
    '  float condBits = 0.0;',
    ...blocks,
    // True-kill latch (slice 1C): once bit 6 is set in the
    // previous output it stays set — a true-killed particle
    // never revives, whatever later evaluations match.
    `  liveTrueKill = max(liveTrueKill, mod(floor(prev.r / ${fmtNum(LIVE_RULE_TRUE_KILL_BIT)}), 2.0));`,
    `  float liveMask = ${maskTerms.join(' + ')} + liveKill * ${fmtNum(LIVE_RULE_KILL_BIT)} + liveTrueKill * ${fmtNum(LIVE_RULE_TRUE_KILL_BIT)} + liveFracture * ${fmtNum(LIVE_RULE_FRACTURE_BIT)} + liveSpawn * ${fmtNum(LIVE_RULE_SPAWN_BIT)};`,
    '  gl_FragColor = vec4(liveMask, nextState / 255.0, condBits, liveDisplay);',
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// CPU twin of the REP aggregate (test / editor照合用)
// ---------------------------------------------------------------------------

export interface LiveRuleParticleInput {
  /** Attribute slot values 0..7 (missing slots read 0). */
  slots: readonly number[];
  /** Live condition variables (vel / age / rad / t / state / den / ...). */
  vars: Record<string, number>;
  /** Pristine bake + ext arrays for group targets, as in G10. */
  attrData?: Float32Array;
  extData?: Float32Array | null;
  index?: number;
  count?: number;
  /**
   * The particle's previous REP mask (slice 1C): only bit 6
   * is read — the true-kill latch. Omit for a first
   * evaluation (the REP targets start at the full-permit
   * initial state, whose bit 6 is 0).
   */
  prevMask?: number;
}

/**
 * Evaluate ONE live step for ONE particle on the CPU — the
 * exact twin of the REP fragment: permit semantics over the
 * live-classified rules, kill as OR, non-finite / zero
 * condition values never match, and (slice 1B) state
 * transitions under snapshot semantics: every condition reads
 * the state carried in (`vars.state`), matched set-state /
 * set-group actions apply in rule order (last wins) to the
 * returned state only. Group targets resolve through the
 * same CPU membership the bake uses (evaluateGpgpuGroup); in
 * the REP they resolve through the shader twin for predicate
 * groups only. The caller supplies the live variables in
 * `vars` (vel / age / rad / t / state / den / sdf / ...).
 * Slice 1C: the extension forces share the permit semantics
 * ('all' restricts the G10 five only), the custom force
 * (external-force general form) shares them under bit 12, a matched true-kill
 * sets bit 6 and the bit latches through `input.prevMask`, a
 * matched fracture sets bit 7 for this step only, a matched
 * spawn (slice 1D-3) sets bit 13 for this step only, and the
 * returned `display` is the .a value the REP writes (0 = no
 * override, otherwise 1 + the last matched display size).
 * The contact variables are caller-supplied like the rest:
 * `vars.hit` is the last step's contact flag (0/1) and
 * `vars.hits` the current life's accumulated count — the
 * accumulation itself is the contact pass's twin
 * (contactStepTwin in components/gpgpuContactPass.ts).
 * The predation follow-up variables are caller-supplied the
 * same way: `vars.predhold` is the hold pass's accumulated
 * consecutive-hold count (its twin is predationHoldStep in
 * lib/gpgpuPredation.ts) and `vars.predage` the seconds
 * since the predation rule set was (re)activated.
 */
export function evaluateLiveRuleStep(
  classified: readonly LiveRuleClassification[],
  input: LiveRuleParticleInput,
  groupDefs: readonly GpgpuGroupDef[] = [],
): { mask: number; state: number; matched: string[]; display: number } {
  const live = classified.filter((entry) => entry.route === 'live');
  const restricted: Record<LiveRuleForceName, boolean> = {
    gravity: false, turbulence: false, curl: false, wind: false, morph: false,
  };
  const restrictedExt: Record<LiveRuleExtForceName, boolean> = {
    drag: false, vortex: false, attractor: false, well: false,
  };
  let restrictedCustom = false;
  let restrictedMeander = false;
  for (const entry of live) {
    if (entry.rule.action.type !== 'force-gate') continue;
    if (entry.rule.action.force === 'all') {
      for (const name of FORCE_NAMES) restricted[name] = true;
    } else if ((FORCE_NAMES as readonly string[]).includes(entry.rule.action.force)) {
      restricted[entry.rule.action.force as LiveRuleForceName] = true;
    } else if (entry.rule.action.force === 'custom') {
      restrictedCustom = true;
    } else if (entry.rule.action.force === 'meander') {
      restrictedMeander = true;
    } else {
      restrictedExt[entry.rule.action.force as LiveRuleExtForceName] = true;
    }
  }
  let mask = 0;
  for (const name of FORCE_NAMES) {
    if (!restricted[name]) mask |= LIVE_RULE_FORCE_BITS[name];
  }
  for (const name of EXT_FORCE_NAMES) {
    if (!restrictedExt[name]) mask |= LIVE_RULE_EXT_FORCE_BITS[name];
  }
  if (!restrictedCustom) mask |= LIVE_RULE_CUSTOM_FORCE_BIT;
  if (!restrictedMeander) mask |= LIVE_RULE_MEANDER_FORCE_BIT;
  let display = 0;
  const matched: string[] = [];
  const vars: Record<string, number> = { ...input.vars };
  let state = typeof vars.state === 'number' && Number.isFinite(vars.state) ? vars.state : 0;
  for (const entry of live) {
    const { rule } = entry;
    let target = 0;
    if (rule.target.type === 'all') {
      target = 1;
    } else if (rule.target.type === 'predicate') {
      const p = rule.target;
      target = groupMembership(input.slots[p.slot] ?? 0, p.mode, p.low, p.high, p.invert);
    } else if (input.attrData && input.index !== undefined && input.count !== undefined) {
      const membership = evaluateGpgpuGroup(groupDefs, rule.target.id, input.attrData, input.count);
      target = membership ? membership[input.index] ?? 0 : 0;
    }
    if (target === 0) continue;
    if (entry.conditionAst) {
      for (let s = 0; s < ATTR_SLOT_COUNT_TOTAL; s++) vars[`slot${s}`] = input.slots[s] ?? 0;
      vars.g = target;
      vars.x = target;
      const value = evaluateCompiledExpressionWithVars(entry.conditionAst, vars);
      if (!Number.isFinite(value) || value === 0) continue;
    }
    matched.push(rule.id);
    if (rule.action.type === 'force-gate') {
      if (rule.action.force === 'all') {
        for (const name of FORCE_NAMES) mask |= LIVE_RULE_FORCE_BITS[name];
      } else if ((FORCE_NAMES as readonly string[]).includes(rule.action.force)) {
        mask |= LIVE_RULE_FORCE_BITS[rule.action.force as LiveRuleForceName];
      } else if (rule.action.force === 'custom') {
        mask |= LIVE_RULE_CUSTOM_FORCE_BIT;
      } else if (rule.action.force === 'meander') {
        mask |= LIVE_RULE_MEANDER_FORCE_BIT;
      } else {
        mask |= LIVE_RULE_EXT_FORCE_BITS[rule.action.force as LiveRuleExtForceName];
      }
    } else if (rule.action.type === 'kill') {
      mask |= LIVE_RULE_KILL_BIT;
    } else if (rule.action.type === 'true-kill') {
      mask |= LIVE_RULE_TRUE_KILL_BIT;
    } else if (rule.action.type === 'fracture') {
      mask |= LIVE_RULE_FRACTURE_BIT;
    } else if (rule.action.type === 'spawn') {
      mask |= LIVE_RULE_SPAWN_BIT;
    } else if (rule.action.type === 'display') {
      display = 1 + rule.action.size;
    } else if (rule.action.type === 'set-state') {
      state = rule.action.state;
    } else if (rule.action.type === 'set-group') {
      state = liveGroupStateValue(live.map((e) => e.rule), rule.action.id);
    }
  }
  // True-kill latch (slice 1C): a previous mask with bit 6
  // set keeps the bit, exactly as the REP fragment reads
  // prev.r back. Fracture and spawn do NOT latch.
  if (typeof input.prevMask === 'number' && (input.prevMask & LIVE_RULE_TRUE_KILL_BIT) !== 0) {
    mask |= LIVE_RULE_TRUE_KILL_BIT;
  }
  return { mask, state, matched, display };
}

/**
 * The mask-only view of evaluateLiveRuleStep (the slice-1A
 * entry point, kept for its existing callers and tests).
 */
export function evaluateLiveRuleMask(
  classified: readonly LiveRuleClassification[],
  input: LiveRuleParticleInput,
  groupDefs: readonly GpgpuGroupDef[] = [],
): { mask: number; matched: string[] } {
  const { mask, matched } = evaluateLiveRuleStep(classified, input, groupDefs);
  return { mask, matched };
}

// ---------------------------------------------------------------------------
// WGSL twin (Grammar 2.0 stage 1, the WGSL slice): the REP as
// a WebGPU compute pass, and the coverage predicate the
// capability registry uses to decide which live-rule configs
// may stay on the WebGPU route.
//
// The WGSL REP is the fragment's twin, not a port of a
// different design: same classification, same permit
// semantics, same snapshot state transitions, same mask
// composition (the aggregate line is textually identical),
// same output layout (.r mask / .g state /255 / .b condition
// bits / .a display). It evaluates from the frame-start
// position / velocity storage buffers and the mirrored
// attribute texture, exactly the state the WebGL REP reads
// from the previous frame's sim targets, and writes a
// ping-pong storage buffer the step publishes into a texture
// for the velocity / position passes (lib/webgpuCompute.ts).
//
// What has NO WGSL home, and therefore makes a rule not
// representable here (the config keeps routing to WebGL):
//  - `den`: the density supply is a WebGL pass; the WebGPU
//    route has no density texture to sample.
//  - `hit` / `hits`: the contact pass is a WebGL pass; no
//    WGSL contact replay exists.
//  - slots 4..7 (the ext texture): the WebGPU route mirrors
//    only the main attribute texture.
// Two consumed actions are representable but their CONSUMERS
// live off-route, so they block coverage instead (see
// liveRulesWgslCoverable): spawn (the Aux pool is WebGL-only)
// and display (the points draw reads the WebGL REP texture).
// ---------------------------------------------------------------------------

/**
 * Emit the WGSL for one compiled live condition, or null when
 * a variable has no WGSL home (den / hit / hits / ext slots —
 * see the section header). The twin of liveConditionGlsl:
 * slot locals v0..v3 come from the mirrored attribute
 * texture, the sim locals carry the same names as the GLSL
 * fragment's, `t` reads the REP uniform's time, `state` the
 * carried-in state, `sdf` the REP's own SDF local.
 */
export function liveConditionWgsl(
  ast: CompiledAst,
  targetLocal: string,
  names: readonly string[],
  names2: readonly string[],
): string | null {
  const lowerNames = [...normalizeAttrNames(names), ...normalizeAttrNames2(names2)]
    .map((name) => name.toLowerCase());
  const slotByName = new Map<string, number>();
  for (let slot = 0; slot < ATTR_SLOT_COUNT_TOTAL; slot++) {
    const key = lowerNames[slot];
    if (!slotByName.has(key)) slotByName.set(key, slot);
  }
  return astToWgsl(ast, (name) => {
    if (name === 'x' || name === 'g') return targetLocal;
    if (name === 't') return 'ru.time';
    if (name === 'state') return 'prevState';
    if (name === 'sdf') return 'simSdf';
    if (name === 'hit' || name === 'hits') return null;
    if (name === 'prey' || name === 'pred') return null;
    if (name === 'predhold' || name === 'predage') return null;
    if (name === DENSITY_VAR_NAME) return null;
    const sim = simVarToGlsl(name);
    if (sim !== null) return sim;
    if (/^slot[0-7]$/.test(name)) {
      const slot = Number(name.slice(4));
      return slot < 4 ? `v${slot}` : null;
    }
    const target = slotByName.get(name);
    if (target === undefined || target >= 4) return null;
    return `v${target}`;
  });
}

/**
 * Can the WGSL REP evaluate this classified entry? Entries
 * without a condition are trivially representable; entries
 * whose condition has no WGSL form are not.
 */
export function liveRuleWgslRepresentable(
  entry: LiveRuleClassification,
  names: readonly string[],
  names2: readonly string[],
): boolean {
  if (!entry.conditionAst) return true;
  return liveConditionWgsl(entry.conditionAst, 'tgt', names, names2) !== null;
}

function targetWgsl(
  target: ParticleRuleTarget,
  groupDefs: readonly GpgpuGroupDef[],
): string {
  if (target.type === 'all') return '1.0';
  if (target.type === 'predicate') {
    const mode = { below: 0, above: 1, band: 2 }[target.mode];
    return `kaloGroupMembershipWgsl(kaloAttrChannelWgsl(attrData, ${target.slot}), ${mode}, ${fmtNum(target.low)}, ${fmtNum(target.high)}, ${target.invert ? 'true' : 'false'})`;
  }
  const def = groupDefs.find((d) => d.id === target.id);
  if (def && def.source.kind === 'predicate') {
    const p = def.source.predicate;
    const mode = { below: 0, above: 1, band: 2 }[p.mode];
    return `kaloGroupMembershipWgsl(kaloAttrChannelWgsl(attrData, ${p.slot}), ${mode}, ${fmtNum(p.low)}, ${fmtNum(p.high)}, ${p.invert ? 'true' : 'false'})`;
  }
  return '0.0'; // unreachable for live-classified rules
}

/**
 * Analytic SDF support for the WGSL REP: the twin of the
 * REP fragment's repSdfDistance (itself a port of the
 * velocity pass's abSdfDistance), reading the REP uniform
 * bundle instead of the velocity pass's. Emitted only when a
 * live condition reads `sdf`. While ru.sdfEnabled is 0 the
 * caller local reads +1e6.
 */
const REP_SDF_FUNCTION_WGSL_LINES: readonly string[] = [
  'fn repGyroidFieldWgsl(p: vec3f, sc: vec3f, size: f32) -> f32 {',
  '  let q = (p - sc) * (3.14159265 / max(size, 1.0));',
  '  return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.x);',
  '}',
  'fn repSdfDistanceWgsl(p: vec3f) -> f32 {',
  '  let sc = vec3f(ru.sdfX, ru.sdfY, ru.sdfZ);',
  '  let d = p - sc;',
  '  if (ru.sdfShape == 0) {',
  '    return length(d) - ru.sdfSize;',
  '  } else if (ru.sdfShape == 1) {',
  '    let q = abs(d) - vec3f(ru.sdfSize);',
  '    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);',
  '  } else if (ru.sdfShape == 2) {',
  '    let ringD = length(d.xz) - ru.sdfSize;',
  '    return length(vec2f(ringD, d.y)) - ru.sdfSize * 0.35;',
  '  } else if (ru.sdfShape == 4) {',
  '    return repGyroidFieldWgsl(p, sc, ru.sdfSize) * ru.sdfSize * 0.227;',
  '  }',
  '  let yc = clamp(d.y, -ru.sdfSize, ru.sdfSize);',
  '  return length(vec3f(d.x, d.y - yc, d.z)) - ru.sdfSize * 0.4;',
  '}',
];

/**
 * Build the WGSL REP compute program, or null when the pass
 * must not exist on the WebGPU route: the same null condition
 * as buildRuleEvalFragment (no live rule with a consumed
 * action), OR any classified rule the WGSL REP cannot
 * evaluate faithfully — a baked-fallback rule (its WebGL
 * approximation has no WGSL counterpart) or a live rule whose
 * condition is not WGSL-representable. Returning null for the
 * whole program (never a partial one) is what keeps the two
 * routes from silently diverging.
 */
export function buildRuleEvalWgsl(
  rulesInput: readonly LiveParticleRule[],
  options: RuleEvalFragmentOptions,
): string | null {
  const classified = classifyLiveRules(rulesInput, options);
  if (classified.some((entry) => entry.route === 'baked-fallback')) return null;
  const live = classified.filter((entry) => entry.route === 'live');
  const consumed = live.filter((entry) => LIVE_RULE_CONSUMED_ACTIONS.includes(entry.rule.action.type));
  if (consumed.length === 0) return null;
  for (const entry of live) {
    if (!liveRuleWgslRepresentable(entry, options.names, options.names2)) return null;
  }

  let usesSim = false;
  let usesSdf = false;
  for (const entry of live) {
    if (!entry.conditionAst) continue;
    if (astUsesSimVar(entry.conditionAst)) usesSim = true;
    if (astReferencesVariable(entry.conditionAst, 'sdf')) usesSdf = true;
  }

  // Permit restriction tables: identical derivation to the
  // GLSL builder (an unrestricted force starts permitted, a
  // restricted one starts denied; 'all' restricts the G10
  // five only).
  const restricted: Record<LiveRuleForceName, boolean> = {
    gravity: false, turbulence: false, curl: false, wind: false, morph: false,
  };
  const restrictedExt: Record<LiveRuleExtForceName, boolean> = {
    drag: false, vortex: false, attractor: false, well: false,
  };
  let restrictedCustom = false;
  let restrictedMeander = false;
  for (const entry of live) {
    if (entry.rule.action.type !== 'force-gate') continue;
    if (entry.rule.action.force === 'all') {
      for (const name of FORCE_NAMES) restricted[name] = true;
    } else if ((FORCE_NAMES as readonly string[]).includes(entry.rule.action.force)) {
      restricted[entry.rule.action.force as LiveRuleForceName] = true;
    } else if (entry.rule.action.force === 'custom') {
      restrictedCustom = true;
    } else if (entry.rule.action.force === 'meander') {
      restrictedMeander = true;
    } else {
      restrictedExt[entry.rule.action.force as LiveRuleExtForceName] = true;
    }
  }

  const blocks: string[] = [];
  live.forEach((entry, index) => {
    const { rule } = entry;
    const tgt = `tgt${index}`;
    const matched = `matched${index}`;
    const lines: string[] = [];
    lines.push(`  let ${tgt} = ${targetWgsl(rule.target, options.groupDefs ?? [])};`);
    if (entry.conditionAst) {
      const wgsl = liveConditionWgsl(entry.conditionAst, tgt, options.names, options.names2);
      if (wgsl === null) return; // representable-checked above; defensive
      lines.push(`  let cond${index} = ${wgsl};`);
      lines.push(`  let ${matched} = select(0.0, 1.0, (${tgt} > 0.5) && (cond${index} == cond${index}) && (abs(cond${index}) < 1.0e30) && (cond${index} != 0.0));`);
    } else {
      lines.push(`  let ${matched} = select(0.0, 1.0, ${tgt} > 0.5);`);
    }
    if (index < 8) lines.push(`  condBits += ${matched} * ${fmtNum(2 ** index)};`);
    if (rule.action.type === 'force-gate') {
      const forces: readonly string[] = rule.action.force === 'all' ? FORCE_NAMES : [rule.action.force];
      for (const name of forces) {
        const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
        lines.push(`  ${local} = max(${local}, ${matched});`);
      }
    } else if (rule.action.type === 'kill') {
      lines.push(`  liveKill = max(liveKill, ${matched});`);
    } else if (rule.action.type === 'true-kill') {
      lines.push(`  liveTrueKill = max(liveTrueKill, ${matched});`);
    } else if (rule.action.type === 'fracture') {
      lines.push(`  liveFracture = max(liveFracture, ${matched});`);
    } else if (rule.action.type === 'spawn') {
      lines.push(`  liveSpawn = max(liveSpawn, ${matched});`);
    } else if (rule.action.type === 'display') {
      lines.push(`  liveDisplay = select(liveDisplay, ${fmtNum(1 + rule.action.size)}, ${matched} > 0.5);`);
    } else if (rule.action.type === 'set-state') {
      lines.push(`  nextState = select(nextState, ${fmtNum(rule.action.state)}, ${matched} > 0.5);`);
    } else if (rule.action.type === 'set-group') {
      const proxy = liveGroupStateValue(live.map((e) => e.rule), rule.action.id);
      lines.push(`  nextState = select(nextState, ${fmtNum(proxy)}, ${matched} > 0.5);`);
    }
    blocks.push(lines.join('\n'));
  });

  const fgInit = [
    ...FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `  var ${local} = ${restricted[name] ? '0.0' : '1.0'};`;
    }),
    ...EXT_FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `  var ${local} = ${restrictedExt[name] ? '0.0' : '1.0'};`;
    }),
    `  var fgCustom = ${restrictedCustom ? '0.0' : '1.0'};`,
    `  var fgMeander = ${restrictedMeander ? '0.0' : '1.0'};`,
  ];
  const maskTerms = [
    ...FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `${local} * ${fmtNum(LIVE_RULE_FORCE_BITS[name])}`;
    }),
    ...EXT_FORCE_NAMES.map((name) => {
      const local = `fg${name[0].toUpperCase()}${name.slice(1)}`;
      return `${local} * ${fmtNum(LIVE_RULE_EXT_FORCE_BITS[name])}`;
    }),
    `fgCustom * ${fmtNum(LIVE_RULE_CUSTOM_FORCE_BIT)}`,
    `fgMeander * ${fmtNum(LIVE_RULE_MEANDER_FORCE_BIT)}`,
  ];

  return [
    '// Live rule evaluation pass (REP), WGSL twin of the',
    '// WebGL REP fragment (buildRuleEvalFragment): same',
    '// classification, permit semantics, snapshot state',
    '// transitions and output layout (.r mask / .g state /255',
    '// / .b condition bits / .a display). Bindings 1/2 are the',
    '// frame-start sim buffers (the previous step\'s outputs,',
    '// the state the WebGL REP reads from its sim textures),',
    '// binding 3 the mirrored attribute bake, bindings 4/5',
    '// the REP ping-pong (previous aggregate in, new aggregate',
    '// out). The step publishes the output into a texture the',
    '// velocity / position passes sample.',
    'struct RepUniforms {',
    '  texSize : u32,',
    '  time : f32,',
    '  ageDenom : f32,',
    '  radiusDenom : f32,',
    '  sdfEnabled : f32,',
    '  sdfShape : i32,',
    '  sdfX : f32,',
    '  sdfY : f32,',
    '  sdfZ : f32,',
    '  sdfSize : f32,',
    '  pad0 : f32,',
    '  pad1 : f32,',
    '};',
    '@group(0) @binding(0) var<uniform> ru : RepUniforms;',
    '@group(0) @binding(1) var<storage, read> posIn : array<vec4f>;',
    '@group(0) @binding(2) var<storage, read> velIn : array<vec4f>;',
    '@group(0) @binding(3) var attrTex : texture_2d<f32>;',
    '@group(0) @binding(4) var<storage, read> repPrev : array<vec4f>;',
    '@group(0) @binding(5) var<storage, read_write> repOut : array<vec4f>;',
    'fn kaloAttrChannelWgsl(a: vec4f, slot: i32) -> f32 {',
    '  if (slot == 0) { return a.r; }',
    '  if (slot == 1) { return a.g; }',
    '  if (slot == 2) { return a.b; }',
    '  return a.a;',
    '}',
    'fn kaloGroupMembershipWgsl(av: f32, mode: i32, low: f32, high: f32, invert: bool) -> f32 {',
    '  var m = 0.0;',
    '  if (mode == 0) { m = step(av, high); }',
    '  else if (mode == 1) { m = step(low, av); }',
    '  else { m = step(low, av) * step(av, high); }',
    '  return select(m, 1.0 - m, invert);',
    '}',
    ...(usesSdf ? REP_SDF_FUNCTION_WGSL_LINES : []),
    '@compute @workgroup_size(64)',
    'fn main(@builtin(global_invocation_id) gid : vec3u) {',
    '  let idx = gid.x;',
    '  let texSizeU = ru.texSize;',
    '  if (idx >= texSizeU * texSizeU) { return; }',
    '  let attrData = textureLoad(attrTex, vec2i(i32(idx % texSizeU), i32(idx / texSizeU)), 0);',
    '  let v0 = attrData.r;',
    '  let v1 = attrData.g;',
    '  let v2 = attrData.b;',
    '  let v3 = attrData.a;',
    ...(usesSim || usesSdf ? [
      '  let simPos = posIn[idx];',
    ] : []),
    ...(usesSim ? [
      '  let simVel = velIn[idx];',
      '  let simVelMag = length(simVel.xyz);',
      '  let simAgeN = clamp(simPos.w / ru.ageDenom, 0.0, 1.0);',
      '  let simRadN = clamp(length(simPos.xyz) / ru.radiusDenom, 0.0, 1.0);',
    ] : []),
    ...(usesSdf ? ['  let simSdf = select(1.0e6, repSdfDistanceWgsl(simPos.xyz), ru.sdfEnabled > 0.5);'] : []),
    '  let prev = repPrev[idx];',
    '  let prevState = floor(prev.g * 255.0 + 0.5);',
    '  var nextState = prevState;',
    ...fgInit,
    '  var liveKill = 0.0;',
    '  var liveTrueKill = 0.0;',
    '  var liveFracture = 0.0;',
    '  var liveSpawn = 0.0;',
    '  var liveDisplay = 0.0;',
    '  var condBits = 0.0;',
    ...blocks,
    // True-kill latch (slice 1C), the WGSL bit-test form of
    // the fragment's mod(floor(prev.r / 64), 2) read-back:
    // prev.r is an exact small integer in a float, so the
    // u32 conversion is exact.
    '  liveTrueKill = max(liveTrueKill, select(0.0, 1.0, (u32(prev.r + 0.5) & 64u) != 0u));',
    `  let liveMask = ${maskTerms.join(' + ')} + liveKill * ${fmtNum(LIVE_RULE_KILL_BIT)} + liveTrueKill * ${fmtNum(LIVE_RULE_TRUE_KILL_BIT)} + liveFracture * ${fmtNum(LIVE_RULE_FRACTURE_BIT)} + liveSpawn * ${fmtNum(LIVE_RULE_SPAWN_BIT)};`,
    '  repOut[idx] = vec4f(liveMask, nextState / 255.0, condBits, liveDisplay);',
    '}',
    '',
  ].join('\n');
}

/**
 * The capability predicate: may a config with these live
 * rules stay on the WebGPU route? True exactly when every
 * rule's live effect is reproduced by the WGSL REP and its
 * consumers:
 *  - every rule classifies 'live' or 'never' (a
 *    baked-fallback rule's approximation is WebGL-only), and
 *    every live rule is WGSL-representable;
 *  - no live consumed rule is a spawn or display action
 *    (their consumers — the Aux pool, the points draw's REP
 *    texture — exist on the WebGL route only);
 *  - while an attribute dynamic stage (dyn / feedback /
 *    chain) is active, no live condition reads a slot value:
 *    the WebGL REP reads the post-stage texture, the WGSL
 *    REP reads the mirrored bake, so a slot-reading condition
 *    would diverge (the caller resolves `attrDynamicActive`
 *    from the config, mirroring the registry's existing
 *    attr-* declarations).
 * Rules with unconsumed actions (color) never block: they are
 * inert on both routes.
 */
export function liveRulesWgslCoverable(
  rulesInput: readonly LiveParticleRule[],
  options: RuleEvalFragmentOptions & { attrDynamicActive?: boolean },
): boolean {
  const classified = classifyLiveRules(rulesInput, options);
  const reserved = new Set(['g', 'vel', 'age', 'rad', 'state', 'sdf', 'hit', 'hits', DENSITY_VAR_NAME]);
  const slotVars = liveRuleConditionVariables(options.names, options.names2)
    .filter((name) => !reserved.has(name));
  for (const entry of classified) {
    if (entry.route === 'baked-fallback') return false;
    if (entry.route !== 'live') continue;
    if (!liveRuleWgslRepresentable(entry, options.names, options.names2)) return false;
    if (LIVE_RULE_CONSUMED_ACTIONS.includes(entry.rule.action.type)
      && (entry.rule.action.type === 'spawn' || entry.rule.action.type === 'display')) {
      return false;
    }
    if (options.attrDynamicActive && entry.conditionAst) {
      for (const name of slotVars) {
        if (astReferencesVariable(entry.conditionAst, name)) return false;
      }
    }
  }
  return true;
}
