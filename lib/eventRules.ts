// Phase 18 stage 4 — event rules: event -> condition (expression) -> actions.
//
// Until this stage the scene had four disconnected firing sources
// (modulation envelopes, the MIDI note actions' fixed five, GPU
// particle events, and time/step drivers) and no shared
// "event -> condition -> action" home. This module is that home:
// a pure rule model + validator + evaluator. It owns NO side
// effects — evaluation returns the actions to perform and the
// caller decides how to perform them (stage 4 wires exactly one
// action, `synth-note`, at exactly one place: the synth sequencer
// step boundary in lib/audioSynth.ts).
//
// Persistence follows the modulation / MIDI localStorage discipline
// (lib/modulation.ts, lib/midiControl.ts): rules are a property of
// the user's setup, stored under one localStorage key, and NEVER
// enter the config — this stage adds zero config keys. A missing /
// empty / corrupt payload means "no rules", which is exactly the
// legacy behaviour.
//
// Broken rules are dropped individually (unlike the PCG graph's
// whole-payload fallback in stage 3): one malformed rule disables
// only itself and can never take the evaluator — or the scene —
// down with it.

import {
  compileExpression,
  evaluateCompiledExpressionWithVars,
} from './expression';

export type EventRuleEventType =
  | 'beat'
  | 'midi-note'
  | 'predicate'
  | 'pattern-boundary';

export const EVENT_RULE_EVENT_TYPES: readonly EventRuleEventType[] = [
  'beat',
  'midi-note',
  'predicate',
  'pattern-boundary',
];

export interface SynthNoteAction {
  type: 'synth-note';
  /** MIDI note number 0..127; takes precedence over semitoneOffset. */
  note?: number;
  /** Semitones above the synth base frequency (when note is unset). */
  semitoneOffset?: number;
  /** Note length in seconds, clamped 0.05..2 (default 0.28). */
  durationSec?: number;
  /** Velocity / gain multiplier 0..1 (default 1). */
  gain?: number;
}

export type EventRuleAction = SynthNoteAction;

export const EVENT_RULE_ACTION_TYPES: readonly string[] = ['synth-note'];

export interface EventRule {
  id: string;
  event: EventRuleEventType;
  /** For midi-note rules only: only fire for this note number. */
  note?: number;
  /** Condition expression; empty / absent = always fires. Evaluated
   *  with lib/expression.ts against EVENT_RULE_VARIABLES. */
  condition?: string;
  enabled?: boolean;
  actions: EventRuleAction[];
}

/** An event occurrence fed to the evaluator. */
export interface EventRuleEvent {
  type: EventRuleEventType;
  /** MIDI note number for midi-note events. */
  note?: number;
  /** Step / beat index within the driving pattern, when known. */
  step?: number;
}

/**
 * Context values the condition expression may read. Every field is
 * optional; missing values read as 0. `slots` carries attribute
 * slot values by index (slot0..slot7 — stage 1's 8 slots).
 */
export interface EventRuleContext {
  /** Primary 0..1 input (x in the expression language). */
  x?: number;
  /** Time in seconds (t in the expression language). */
  t?: number;
  vel?: number;
  age?: number;
  rad?: number;
  note?: number;
  velocity?: number;
  step?: number;
  beat?: number;
  slots?: readonly number[];
}

export const EVENT_RULE_VARIABLES: readonly string[] = [
  'vel', 'age', 'rad', 'note', 'velocity', 'step', 'beat',
  'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7',
];

export const EVENT_RULES_STORAGE_KEY = 'kalokagathia.eventRules.v1';
export const EVENT_RULES_MAX_RULES = 64;
export const EVENT_RULES_MAX_ACTIONS = 8;
export const EVENT_RULES_MAX_CHARS = 100_000;

const RULE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function validateAction(raw: unknown): EventRuleAction | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (a.type !== 'synth-note') return null;
  const out: SynthNoteAction = { type: 'synth-note' };
  if (a.note !== undefined) {
    if (typeof a.note !== 'number' || !Number.isFinite(a.note)) return null;
    out.note = Math.max(0, Math.min(127, Math.floor(a.note)));
  }
  if (a.semitoneOffset !== undefined) {
    if (typeof a.semitoneOffset !== 'number' || !Number.isFinite(a.semitoneOffset)) return null;
    out.semitoneOffset = Math.max(-48, Math.min(48, a.semitoneOffset));
  }
  if (a.durationSec !== undefined) {
    if (typeof a.durationSec !== 'number' || !Number.isFinite(a.durationSec)) return null;
    out.durationSec = Math.max(0.05, Math.min(2, a.durationSec));
  }
  if (a.gain !== undefined) {
    if (typeof a.gain !== 'number' || !Number.isFinite(a.gain)) return null;
    out.gain = Math.max(0, Math.min(1, a.gain));
  }
  return out;
}

/**
 * Validate one untrusted rule. Returns the normalised rule, or
 * null when the rule is malformed in any way (bad id, unknown
 * event / action, un-compilable condition, no actions) — the
 * caller drops just this rule.
 */
export function validateEventRule(raw: unknown): EventRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !RULE_ID_RE.test(r.id)) return null;
  if (typeof r.event !== 'string' || !EVENT_RULE_EVENT_TYPES.includes(r.event as EventRuleEventType)) return null;
  if (r.enabled !== undefined && typeof r.enabled !== 'boolean') return null;
  if (r.note !== undefined) {
    if (typeof r.note !== 'number' || !Number.isFinite(r.note)) return null;
  }
  let condition: string | undefined;
  if (r.condition !== undefined && r.condition !== null && r.condition !== '') {
    if (typeof r.condition !== 'string') return null;
    const compiled = compileExpression(r.condition, EVENT_RULE_VARIABLES);
    if (!compiled.ok) return null;
    condition = r.condition;
  }
  if (!Array.isArray(r.actions) || r.actions.length === 0 || r.actions.length > EVENT_RULES_MAX_ACTIONS) return null;
  const actions: EventRuleAction[] = [];
  for (const rawAction of r.actions) {
    const action = validateAction(rawAction);
    if (!action) return null;
    actions.push(action);
  }
  const out: EventRule = { id: r.id, event: r.event as EventRuleEventType, actions };
  if (r.note !== undefined) out.note = Math.max(0, Math.min(127, Math.floor(r.note as number)));
  if (condition !== undefined) out.condition = condition;
  if (r.enabled !== undefined) out.enabled = r.enabled;
  return out;
}

/** Validate a list, dropping broken rules individually. */
export function validateEventRules(raw: unknown): EventRule[] {
  if (!Array.isArray(raw)) return [];
  const out: EventRule[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= EVENT_RULES_MAX_RULES) break;
    const rule = validateEventRule(item);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    out.push(rule);
  }
  return out;
}

/** Parse a serialised payload; broken payload -> no rules. */
export function parseEventRulesData(data: string | null | undefined): EventRule[] {
  if (!data || typeof data !== 'string' || data.length > EVENT_RULES_MAX_CHARS) return [];
  try {
    return validateEventRules(JSON.parse(data) as unknown);
  } catch {
    return [];
  }
}

export function serializeEventRules(rules: readonly EventRule[]): string {
  const valid = validateEventRules(rules);
  return valid.length === 0 ? '' : JSON.stringify(valid);
}

export function loadEventRules(storage: Pick<Storage, 'getItem'> | undefined): EventRule[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(EVENT_RULES_STORAGE_KEY);
    if (!raw) return [];
    return parseEventRulesData(raw);
  } catch {
    return [];
  }
}

export function saveEventRules(
  storage: Pick<Storage, 'setItem'> | undefined,
  rules: readonly EventRule[],
): void {
  if (!storage) return;
  try {
    const text = serializeEventRules(rules);
    if (text) storage.setItem(EVENT_RULES_STORAGE_KEY, text);
    else if (typeof (storage as Storage).removeItem === 'function') {
      (storage as Storage).removeItem(EVENT_RULES_STORAGE_KEY);
    }
  } catch {
    // Storage full/blocked: the rules simply won't persist.
  }
}

// ---------------------------------------------------------------------------
// Evaluation (pure: event + context -> actions, no side effects)

function buildEnv(event: EventRuleEvent, ctx: EventRuleContext): Record<string, number> {
  const env: Record<string, number> = {
    x: finiteOr(ctx.x, 0),
    t: finiteOr(ctx.t, 0),
    vel: finiteOr(ctx.vel, 0),
    age: finiteOr(ctx.age, 0),
    rad: finiteOr(ctx.rad, 0),
    note: finiteOr(event.note ?? ctx.note, 0),
    velocity: finiteOr(ctx.velocity, 0),
    step: finiteOr(event.step ?? ctx.step, 0),
    beat: finiteOr(ctx.beat ?? event.step ?? ctx.step, 0),
  };
  for (let i = 0; i < 8; i += 1) {
    env[`slot${i}`] = finiteOr(ctx.slots?.[i], 0);
  }
  return env;
}

/** Does one rule fire for this event + context? */
export function eventRuleMatches(rule: EventRule, event: EventRuleEvent, ctx: EventRuleContext = {}): boolean {
  if (rule.enabled === false) return false;
  if (rule.event !== event.type) return false;
  if (rule.event === 'midi-note' && rule.note !== undefined && event.note !== undefined && rule.note !== event.note) return false;
  if (!rule.condition) return true;
  const compiled = compileExpression(rule.condition, EVENT_RULE_VARIABLES);
  if (!compiled.ok) return false;
  const value = evaluateCompiledExpressionWithVars(compiled.ast, buildEnv(event, ctx));
  return Number.isFinite(value) && value !== 0;
}

/**
 * Evaluate all rules for one event occurrence. Matching rules
 * contribute their actions in rule order (and action order within
 * a rule). Pure: the same inputs always return the same list.
 */
export function evaluateEventRules(
  rules: readonly EventRule[],
  event: EventRuleEvent,
  ctx: EventRuleContext = {},
): EventRuleAction[] {
  const out: EventRuleAction[] = [];
  for (const rule of rules) {
    if (eventRuleMatches(rule, event, ctx)) out.push(...rule.actions);
  }
  return out;
}

/**
 * Dispatch evaluated actions to caller-supplied handlers. This is
 * the only place action types are routed, and it performs no side
 * effect of its own beyond the handlers it is given.
 */
export function dispatchEventRuleActions(
  actions: readonly EventRuleAction[],
  handlers: { synthNote?: (action: SynthNoteAction) => void },
): void {
  for (const action of actions) {
    if (action.type === 'synth-note') handlers.synthNote?.(action);
  }
}
