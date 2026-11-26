/**
 * Particle rules (G10 stage 1): the composable
 * "condition -> application" grammar for the GPGPU particle pool.
 *
 * A rule list lives in the single serialised config key
 * `gpgpuParticleRules` (JSON string, default '' = no rules =
 * legacy behaviour everywhere). One rule = one target, one
 * condition, ONE action (the PCG one-node-one-op discipline);
 * write the same target/condition on several rows when several
 * actions are wanted.
 *
 * Evaluation is BAKED (decision A, fixed in
 * kalokagathia-pro/G10_DESIGN.md): at attribute-bake time each
 * rule is evaluated on the CPU against the PRISTINE bake and the
 * frame-0 initial state, and the aggregate result is burned into
 * slot 3 of the texture copy as an integer bit mask (0..63):
 *
 *   bit0 gravity permit / bit1 turbulence / bit2 curl /
 *   bit3 wind / bit4 morph / bit5 kill
 *
 * A force bit is a PERMIT: a force with no force-gate rule at
 * all is unrestricted (bit set for every particle); a force with
 * at least one rule is permitted only on particles matched by at
 * least one of its rules (union, order-independent). The kill
 * bit is the plain OR of the kill rules. Colour is not in the
 * mask: the LAST matching colour rule wins and its colour is
 * written straight into the colour-drive channels of the copy.
 * While any effective rule exists the rule engine owns slot 3
 * (it outranks a baked group's membership channel, design 3.5);
 * with no effective rule nothing is written and the bake is the
 * pristine array itself, bit-identical to legacy.
 *
 * Conditions read the INITIAL state only (design 1.2): slot
 * values from the pristine bake, vel/age/rad from the seeded
 * initial data via attrSimValues. Live simulation quantities
 * cannot be selected on — that is dynamic evaluation, which is
 * out of scope for this grammar.
 *
 * Failure discipline mirrors the group list (the closest of the
 * six serialised-key precedents): broken rules drop individually
 * and quietly, dangling group references and uncompilable
 * conditions keep the rule but never match. Only the character
 * cap falls back wholesale (PCG precedent): a payload over the
 * cap is not partially trustworthy.
 */

import {
  attrSimValues,
  groupMembership,
  normalizeAttrNames,
  normalizeAttrNames2,
  resolveAttrNameSlot,
  ATTR_SLOT_COUNT_TOTAL,
  type AttrGroupMode,
} from './gpgpuAttributes';
import {
  evaluateGpgpuGroup,
  type GpgpuGroupDef,
} from './gpgpuGroups';
import {
  astReferencesVariable,
  compileExpression,
  evaluateCompiledExpressionWithVars,
  type ExpressionCompileResult,
} from './expression';

type CompiledAst = Extract<ExpressionCompileResult, { ok: true }>['ast'];

export const PARTICLE_RULES_MAX_RULES = 16;
export const PARTICLE_RULES_MAX_CHARS = 100_000;
export const PARTICLE_RULE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Slot channel the mask rides on (design 3.2). */
export const PARTICLE_RULE_MASK_SLOT = 3;

export const PARTICLE_RULE_FORCE_BITS = {
  gravity: 1,
  turbulence: 2,
  curl: 4,
  wind: 8,
  morph: 16,
} as const;
export const PARTICLE_RULE_KILL_BIT = 32;
export type ParticleRuleForceName = keyof typeof PARTICLE_RULE_FORCE_BITS;
export type ParticleRuleForceTarget = ParticleRuleForceName | 'all';
const FORCE_TARGETS: readonly string[] = ['all', 'gravity', 'turbulence', 'curl', 'wind', 'morph'];
const FORCE_NAMES = Object.keys(PARTICLE_RULE_FORCE_BITS) as ParticleRuleForceName[];

export type ParticleRuleTarget =
  | { type: 'all' }
  | { type: 'group'; id: string }
  | {
      type: 'predicate';
      slot: number;
      mode: AttrGroupMode;
      low: number;
      high: number;
      invert: boolean;
    };

export type ParticleRuleAction =
  | { type: 'force-gate'; force: ParticleRuleForceTarget }
  | { type: 'kill' }
  | { type: 'color'; color: [number, number, number] };

export interface ParticleRule {
  id: string;
  name?: string;
  enabled: boolean;
  target: ParticleRuleTarget;
  /** Expression-language truth formula; '' = always true. */
  condition: string;
  action: ParticleRuleAction;
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
    // The id is not required to match the id grammar: a reference
    // that cannot resolve is a dangling reference (kept, never
    // matches), not a structural error.
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
      mode: raw.mode,
      low: clamp01(raw.low),
      high: clamp01(raw.high),
      invert: raw.invert === true,
    };
  }
  return null;
}

function parseAction(raw: unknown): ParticleRuleAction | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'force-gate') {
    if (typeof raw.force !== 'string' || !FORCE_TARGETS.includes(raw.force)) return null;
    return { type: 'force-gate', force: raw.force as ParticleRuleForceTarget };
  }
  if (raw.type === 'kill') return { type: 'kill' };
  if (raw.type === 'color') {
    const color = raw.color;
    if (!Array.isArray(color) || color.length !== 3) return null;
    const rgb: number[] = [];
    for (const component of color) {
      if (typeof component !== 'number' || !Number.isFinite(component)) return null;
      rgb.push(clamp01(component));
    }
    return { type: 'color', color: [rgb[0], rgb[1], rgb[2]] };
  }
  return null;
}

/** Validate one raw rule value; null = structurally invalid. */
export function validateParticleRule(raw: unknown): ParticleRule | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !PARTICLE_RULE_ID_RE.test(raw.id)) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (typeof raw.condition !== 'string') return null;
  const target = parseTarget(raw.target);
  if (!target) return null;
  const action = parseAction(raw.action);
  if (!action) return null;
  const rule: ParticleRule = {
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
 * Parse the serialised rule list. Any failure resolves to the
 * rules that survive individual validation (or [] wholesale);
 * this never throws.
 */
export function parseParticleRules(data: string | null | undefined): ParticleRule[] {
  if (typeof data !== 'string' || data.length === 0) return [];
  if (data.length > PARTICLE_RULES_MAX_CHARS) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rules: ParticleRule[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (rules.length >= PARTICLE_RULES_MAX_RULES) break;
    const rule = validateParticleRule(raw);
    if (!rule) continue;
    if (seen.has(rule.id)) continue; // first wins, as with groups
    seen.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

/** The rules that actually act: parsed and enabled. */
export function resolveParticleRules(data: string | null | undefined): ParticleRule[] {
  return parseParticleRules(data).filter((rule) => rule.enabled);
}

export function hasEffectiveParticleRules(data: string | null | undefined): boolean {
  return resolveParticleRules(data).length > 0;
}

export function particleRulesHaveAction(
  data: string | null | undefined,
  actionType: ParticleRuleAction['type'],
): boolean {
  return resolveParticleRules(data).some((rule) => rule.action.type === actionType);
}

/** Serialise back to the config string; an empty list is ''. */
export function serializeParticleRules(rules: readonly ParticleRule[] | null | undefined): string {
  if (!rules || rules.length === 0) return '';
  const valid: ParticleRule[] = [];
  const seen = new Set<string>();
  for (const raw of rules) {
    if (valid.length >= PARTICLE_RULES_MAX_RULES) break;
    const rule = validateParticleRule(raw);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    valid.push(rule);
  }
  if (valid.length === 0) return '';
  const text = JSON.stringify(valid);
  return text.length > PARTICLE_RULES_MAX_CHARS ? '' : text;
}

/** Default = no rules at all (the '' state), however it is spelled. */
export function isDefaultParticleRules(
  input: string | readonly ParticleRule[] | null | undefined,
): boolean {
  if (input === null || input === undefined) return true;
  if (typeof input === 'string') return parseParticleRules(input).length === 0;
  return input.length === 0;
}

// ---------------------------------------------------------------------------
// Editor helpers (stage 2 UI)
// ---------------------------------------------------------------------------

let particleRuleIdCounter = 0;
export function createParticleRuleId(): string {
  particleRuleIdCounter += 1;
  return `rule-${Date.now().toString(36)}-${particleRuleIdCounter.toString(36)}`;
}

/**
 * A fresh, valid rule. The default (target all + force-gate
 * 'all') is deliberately neutral: it matches every particle and
 * permits every force, so adding a row changes nothing until the
 * row is edited — the same discipline as createEventRule.
 */
export function createParticleRule(): ParticleRule {
  return {
    id: createParticleRuleId(),
    enabled: true,
    target: { type: 'all' },
    condition: '',
    action: { type: 'force-gate', force: 'all' },
  };
}

/**
 * The variable names a condition expression may use, exactly as
 * the bake evaluator provides them (stage 2 uses this for the
 * editor's inline compile check, so the UI never disagrees with
 * the evaluator about what compiles).
 */
export function particleRuleConditionVariables(
  names: readonly string[],
  names2: readonly string[],
): string[] {
  // Exactly the evaluator's compile-time set (ruleExtraVars).
  // x/t need no entry here: they are built into the expression
  // parser itself, so they compile identically on both sides.
  return ruleExtraVars(names, names2);
}

// ---------------------------------------------------------------------------
// Bake evaluation
// ---------------------------------------------------------------------------

export interface ParticleRuleBakeArgs {
  /** Effective (enabled) rules, in list order. */
  rules: readonly ParticleRule[];
  groupDefs: readonly GpgpuGroupDef[];
  /** Pristine stage-1 bake (slots 0..3, stride 4). Never mutated. */
  attrData: Float32Array;
  /** Pristine ext bake (slots 4..7, stride 4), when built. */
  extData?: Float32Array | null;
  count: number;
  names: readonly string[];
  names2: readonly string[];
  /** Seeded initial positions (xyz + age), stride 4. */
  posData: Float32Array;
  /** Seeded initial velocities (xyz + phase), stride 4. */
  velData?: Float32Array | null;
  ageMax: number;
  bounceRadius: number;
  /** Colour-drive channels resolved by resolveAttrColorSlots. */
  colorSlots?: readonly [number, number, number] | null;
}

interface CompiledRule {
  rule: ParticleRule;
  /** Group membership per particle (target type 'group'), or null. */
  groupMembership: Uint8Array | null;
  /** Compiled condition AST; null = always true or never matches. */
  conditionAst: CompiledAst | null;
  conditionNever: boolean;
}

function ruleExtraVars(names: readonly string[], names2: readonly string[]): string[] {
  const vars = new Set<string>();
  for (const name of [...normalizeAttrNames(names), ...normalizeAttrNames2(names2)]) {
    vars.add(name.toLowerCase());
  }
  for (let slot = 0; slot < ATTR_SLOT_COUNT_TOTAL; slot++) vars.add(`slot${slot}`);
  vars.add('g');
  vars.add('vel');
  vars.add('age');
  vars.add('rad');
  return [...vars];
}

/**
 * Evaluate the rule list over the pristine bake and burn the
 * aggregate into a COPY of the bake (design 3.3/3.4). Returns
 * null when there is no effective rule — the caller then keeps
 * the pristine array itself, which is what makes the default
 * state bit-identical.
 */
export function applyParticleRulesToBake(args: ParticleRuleBakeArgs): Float32Array | null {
  const rules = args.rules.filter((rule) => rule.enabled);
  if (rules.length === 0) return null;
  const { attrData, count } = args;
  const names = normalizeAttrNames(args.names);
  const names2 = normalizeAttrNames2(args.names2);
  const lowerNames8 = [...names, ...names2].map((name) => name.toLowerCase());
  const extraVars = ruleExtraVars(names, names2);

  // Compile once per rule; resolve group targets once per rule.
  const compiled: CompiledRule[] = rules.map((rule) => {
    let groupMembership: Uint8Array | null = null;
    if (rule.target.type === 'group') {
      groupMembership = evaluateGpgpuGroup(args.groupDefs, rule.target.id, attrData, count);
    }
    let conditionAst: CompiledAst | null = null;
    let conditionNever = false;
    if (rule.condition.trim().length > 0) {
      const result = compileExpression(rule.condition, extraVars);
      if (result.ok) conditionAst = result.ast;
      else conditionNever = true; // kept, never matches (design 2.3)
    }
    return { rule, groupMembership, conditionAst, conditionNever };
  });

  // Which forces are restricted at all (permit semantics, 3.4).
  const restricted: Record<ParticleRuleForceName, boolean> = {
    gravity: false, turbulence: false, curl: false, wind: false, morph: false,
  };
  let anyColorRule = false;
  for (const { rule } of compiled) {
    if (rule.action.type === 'force-gate') {
      if (rule.action.force === 'all') {
        for (const name of FORCE_NAMES) restricted[name] = true;
      } else {
        restricted[rule.action.force] = true;
      }
    } else if (rule.action.type === 'color') {
      anyColorRule = true;
    }
  }
  const colorSlots = anyColorRule ? args.colorSlots ?? null : null;

  const out = new Float32Array(attrData);
  const vars: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const base = i * 4;
    const slots: number[] = new Array(ATTR_SLOT_COUNT_TOTAL);
    for (let s = 0; s < 4; s++) slots[s] = attrData[base + s];
    for (let s = 4; s < ATTR_SLOT_COUNT_TOTAL; s++) {
      slots[s] = args.extData ? args.extData[base + (s - 4)] : 0;
    }
    const sim = attrSimValues(
      args.posData[base], args.posData[base + 1], args.posData[base + 2], args.posData[base + 3],
      args.velData ? args.velData[base] : 0,
      args.velData ? args.velData[base + 1] : 0,
      args.velData ? args.velData[base + 2] : 0,
      args.ageMax,
      args.bounceRadius,
    );

    let mask = 0;
    for (const name of FORCE_NAMES) {
      if (!restricted[name]) mask |= PARTICLE_RULE_FORCE_BITS[name];
    }
    let kill = false;
    let winningColor: [number, number, number] | null = null;

    for (const entry of compiled) {
      const { rule } = entry;
      // Target membership T(i).
      let target = 0;
      if (rule.target.type === 'all') {
        target = 1;
      } else if (rule.target.type === 'predicate') {
        const p = rule.target;
        target = groupMembership(slots[p.slot], p.mode, p.low, p.high, p.invert);
      } else {
        target = entry.groupMembership ? entry.groupMembership[i] : 0;
      }
      if (target === 0) continue;
      // Condition C(i) over the pristine values (design 1.2).
      if (entry.conditionNever) continue;
      if (entry.conditionAst) {
        // Slot names first-win (an earlier slot's name shadows a
        // later duplicate), then the aliases, then the reserved
        // sim names and g/x/t, which win over slot names.
        for (let s = ATTR_SLOT_COUNT_TOTAL - 1; s >= 0; s--) {
          vars[lowerNames8[s]] = slots[s];
        }
        for (let s = 0; s < ATTR_SLOT_COUNT_TOTAL; s++) vars[`slot${s}`] = slots[s];
        vars.vel = sim.vel;
        vars.age = sim.age;
        vars.rad = sim.rad;
        vars.g = target;
        vars.x = target;
        vars.t = 0;
        const value = evaluateCompiledExpressionWithVars(entry.conditionAst, vars);
        if (!Number.isFinite(value) || value === 0) continue;
      }
      // Matched: apply the aggregate for this action kind.
      if (rule.action.type === 'force-gate') {
        if (rule.action.force === 'all') {
          for (const name of FORCE_NAMES) mask |= PARTICLE_RULE_FORCE_BITS[name];
        } else {
          mask |= PARTICLE_RULE_FORCE_BITS[rule.action.force];
        }
      } else if (rule.action.type === 'kill') {
        kill = true;
      } else if (rule.action.type === 'color') {
        winningColor = rule.action.color; // last match wins (3.4)
      }
    }

    if (kill) mask |= PARTICLE_RULE_KILL_BIT;
    if (winningColor && colorSlots) {
      for (let c = 0; c < 3; c++) {
        const slot = colorSlots[c];
        if (slot < 4) out[base + slot] = winningColor[c];
        else if (args.extData) {
          // The ext texture is a separate array owned by its own
          // effect; colour channels there are written by the
          // caller-visible copy only when it IS this bake. Stage 1
          // colour slots resolve from the first name set (0..3),
          // so this branch is defensive only.
        }
      }
    }
    // The mask is written last: slot 3 belongs to the rule
    // engine while any rule is effective (design 3.5), even if a
    // colour channel happens to be slot 3.
    out[base + PARTICLE_RULE_MASK_SLOT] = mask;
  }
  return out;
}

/**
 * Do any effective rules' conditions read an ext slot (4..7),
 * by name or by slotN alias? The runtime uses this to decide
 * whether the ext bake must be built before rule evaluation
 * (design 3.7 / U4).
 */
export function particleRulesReferenceExtSlots(
  rules: readonly ParticleRule[],
  names: readonly string[],
  names2: readonly string[],
): boolean {
  const extraVars = ruleExtraVars(names, names2);
  const candidates = new Set<string>();
  for (let s = 4; s < ATTR_SLOT_COUNT_TOTAL; s++) {
    candidates.add(`slot${s}`);
    const resolved = resolveAttrNameSlot(
      [...normalizeAttrNames(names), ...normalizeAttrNames2(names2)][s],
      names,
      names2,
    );
    if (resolved === s) {
      candidates.add([...normalizeAttrNames(names), ...normalizeAttrNames2(names2)][s].toLowerCase());
    }
  }
  for (const rule of rules) {
    if (!rule.enabled || rule.condition.trim().length === 0) continue;
    const result = compileExpression(rule.condition, extraVars);
    if (!result.ok) continue;
    for (const candidate of candidates) {
      if (astReferencesVariable(result.ast, candidate)) return true;
    }
  }
  return false;
}
