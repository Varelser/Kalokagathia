/**
 * Curve remap stage (Layer 1 WP9, phase B): the general
 * Graph Mapper receptacle — input value → free curve →
 * output value → parameter.
 *
 * Until this phase the free control-point curve asset
 * (lib/freeCurve.ts) had only FIXED consumers: the five age
 * curves' free mode (lib/gpgpuAgeFreeCurves.ts), the emission
 * curve, and the spawn envelope (lib/gpgpuSpawnAllocator.ts).
 * Each wires one input (normalised age / emission phase /
 * envelope phase) to one hard-coded purpose. The modulation
 * engine (lib/modulation.ts) is the mirror image: arbitrary
 * inputs routed to arbitrary parameters, but the shaping is
 * a linear depth around a centre — no curve stage.
 *
 * This module is the missing general stage between them. A
 * remap SPEC is pure data (id, input source, curve asset,
 * output range, target parameter, compose mode) designed to
 * be authored as JSON later (phase C persistence); the
 * RESOLUTION is a set of pure functions. The module never
 * reads state: the caller (a future wiring layer — phase B2,
 * in the effective-config layer next to applyModulation)
 * supplies each spec's raw input scalar per frame, exactly
 * like evaluateSource's callers supply time and audio.
 *
 * Semantics pinned here:
 *
 *   - input phase: the raw input is normalised to the curve
 *     domain [0, 1] by the input source kind (see
 *     curveRemapPhase). 'signal' / 'age' inputs are already
 *     normalised and only clamp; 'time' wraps by its period;
 *     'param' / 'value' normalise by the spec's input range.
 *   - curve output: the free curve's value c in
 *     [0, FREE_CURVE_VALUE_MAX] is normalised by the asset's
 *     own maximum and mapped onto the output range:
 *     out = outputMin + (c / FREE_CURVE_VALUE_MAX) ×
 *     (outputMax − outputMin). With the output range
 *     [0, FREE_CURVE_VALUE_MAX] the output IS the curve value
 *     bit-exactly (division / multiplication by 4 is exact),
 *     which is what makes the fixed consumers reproducible
 *     through this stage (pinned by the phase B test):
 *       · a 5-point age curve equals the remap of the same
 *         knots placed as free points (both are the same
 *         piecewise-linear function over the same knots);
 *       · the emission curve equals the remap at output
 *         range [0, 4], mode 'replace', bit-exactly;
 *       · the spawn envelope inside its window equals the
 *         remap with input range [start, stop].
 *   - composition: 'replace' writes the output, 'add' adds
 *     it to the target's base value, 'multiply' multiplies
 *     the base by it. Specs apply in list order, so a later
 *     spec composes on an earlier spec's result for the same
 *     target.
 *   - inert forms: an identity curve under 'multiply' with
 *     output range [0, 4] returns the base bit-exactly for
 *     every input; an all-zero curve under 'add' with
 *     outputMin 0 does the same. An empty spec list returns
 *     the config object itself (applyModulation's identity
 *     discipline).
 *
 * Deliberately NOT here (the consuming layers keep them):
 * window gating like the envelope's start / stop, catalog
 * range clamping and step snapping (applyModulation's job),
 * and any config key — specs are not persisted yet, that is
 * phase C. No existing consumer path changes behaviour:
 * nothing calls this module until phase B2 wires it.
 */
import {
  FREE_CURVE_VALUE_MAX,
  evaluateFreeCurve,
  flattenFreeCurvePoints,
  isFreeCurveIdentity,
  normalizeFreeCurvePoints,
  type FreeCurvePoint,
} from './freeCurve';

/**
 * Where a spec's raw input scalar comes from. The kinds
 * mirror the input families that already exist in the tree:
 * modulation signals (value01), the age axis, playback time,
 * another parameter's value (the expression parameter
 * reference idea), and a plain scalar. The module never
 * samples any of them — the caller supplies the scalar.
 */
export type CurveRemapInputSource =
  | { kind: 'signal' }
  | { kind: 'age' }
  | { kind: 'time'; period: number }
  | { kind: 'param'; key: string }
  | { kind: 'value' };

export type CurveRemapComposeMode = 'replace' | 'add' | 'multiply';

export const CURVE_REMAP_COMPOSE_MODES: readonly CurveRemapComposeMode[] = [
  'replace', 'add', 'multiply',
];

/** List cap, in the spirit of the sequence tracks' 16. */
export const CURVE_REMAP_MAX_SPECS = 16;

export interface CurveRemapSpec {
  /** Route-style id; the caller keys raw inputs by it. */
  id: string;
  input: CurveRemapInputSource;
  /** Input range for 'param' / 'value' normalisation. */
  inputMin: number;
  inputMax: number;
  /** Free curve asset in stored flat form [t0, v0, …]. */
  curve: readonly number[];
  /** Output range the normalised curve output maps onto. */
  outputMin: number;
  outputMax: number;
  /** Target parameter key (a numeric config key by name). */
  target: string;
  mode: CurveRemapComposeMode;
}

export interface ResolvedCurveRemap {
  id: string;
  input: CurveRemapInputSource;
  inputMin: number;
  inputMax: number;
  /** Normalised knot list (2..FREE_CURVE_MAX_POINTS points). */
  points: FreeCurvePoint[];
  outputMin: number;
  outputMax: number;
  target: string;
  mode: CurveRemapComposeMode;
  /** True when every knot value is exactly 1. */
  identity: boolean;
}

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Normalise one input source field; null when unusable. */
function normalizeRemapInput(raw: unknown): CurveRemapInputSource | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as { kind?: unknown; period?: unknown; key?: unknown };
  switch (source.kind) {
    case 'signal':
      return { kind: 'signal' };
    case 'age':
      return { kind: 'age' };
    case 'value':
      return { kind: 'value' };
    case 'time': {
      const period = finiteOr(source.period, 0);
      return { kind: 'time', period: Math.max(0, period) };
    }
    case 'param': {
      const key = typeof source.key === 'string' ? source.key.trim() : '';
      return key ? { kind: 'param', key } : null;
    }
    default:
      return null;
  }
}

/**
 * Coerce arbitrary input into a clean spec, or null when the
 * shape is unusable (no id, no target, unknown input kind or
 * compose mode). Numeric fields fall back per-field: input
 * range to [0, 1], output range to [0, FREE_CURVE_VALUE_MAX]
 * (the range under which the output is the curve value
 * itself). The curve goes through the asset's own
 * normalisation, so a malformed curve degrades to identity.
 */
export function normalizeCurveRemapSpec(input: unknown): CurveRemapSpec | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<CurveRemapSpec> & { input?: unknown };
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const target = typeof raw.target === 'string' ? raw.target.trim() : '';
  if (!id || !target) return null;
  const inputSource = normalizeRemapInput(raw.input);
  if (!inputSource) return null;
  const mode = CURVE_REMAP_COMPOSE_MODES.includes(raw.mode as CurveRemapComposeMode)
    ? (raw.mode as CurveRemapComposeMode)
    : null;
  if (!mode) return null;
  return {
    id,
    input: inputSource,
    inputMin: finiteOr(raw.inputMin, 0),
    inputMax: finiteOr(raw.inputMax, 1),
    curve: flattenFreeCurvePoints(normalizeFreeCurvePoints(raw.curve)),
    outputMin: finiteOr(raw.outputMin, 0),
    outputMax: finiteOr(raw.outputMax, FREE_CURVE_VALUE_MAX),
    target,
    mode,
  };
}

/**
 * Parse a spec list from an array or a JSON string (the form
 * a future config key would carry). Unusable entries are
 * dropped, duplicate ids keep the first occurrence, and the
 * list caps at CURVE_REMAP_MAX_SPECS.
 */
export function parseCurveRemapSpecs(input: unknown): CurveRemapSpec[] {
  let list: unknown = input;
  if (typeof input === 'string') {
    try {
      list = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const specs: CurveRemapSpec[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const spec = normalizeCurveRemapSpec(entry);
    if (!spec || seen.has(spec.id)) continue;
    seen.add(spec.id);
    specs.push(spec);
    if (specs.length >= CURVE_REMAP_MAX_SPECS) break;
  }
  return specs;
}

/** Resolve a spec into its evaluation-ready form. */
export function resolveCurveRemap(spec: CurveRemapSpec): ResolvedCurveRemap {
  const points = normalizeFreeCurvePoints(spec.curve);
  return {
    id: spec.id,
    input: spec.input,
    inputMin: spec.inputMin,
    inputMax: spec.inputMax,
    points,
    outputMin: spec.outputMin,
    outputMax: spec.outputMax,
    target: spec.target,
    mode: spec.mode,
    identity: isFreeCurveIdentity(points),
  };
}

export function resolveCurveRemaps(specs: readonly CurveRemapSpec[]): ResolvedCurveRemap[] {
  return specs.map(resolveCurveRemap);
}

/** True while a parsed spec list has anything to apply. */
export function curveRemapSpecsActive(specs: readonly CurveRemapSpec[]): boolean {
  return specs.length > 0;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Normalise a raw input scalar to the curve domain [0, 1]
 * by the spec's input source kind. Non-finite input reads
 * as 0. 'time' with a non-positive period never advances
 * (phase 0); 'param' / 'value' with a degenerate input
 * range (min === max) read as phase 0.
 */
export function curveRemapPhase(resolved: ResolvedCurveRemap, rawInput: number): number {
  const raw = Number.isFinite(rawInput) ? rawInput : 0;
  switch (resolved.input.kind) {
    case 'signal':
    case 'age':
      return clamp01(raw);
    case 'time': {
      const period = resolved.input.period;
      if (!(period > 0)) return 0;
      const wrapped = (raw / period) % 1;
      return wrapped < 0 ? wrapped + 1 : wrapped;
    }
    case 'param':
    case 'value': {
      const span = resolved.inputMax - resolved.inputMin;
      if (span === 0) return 0;
      return clamp01((raw - resolved.inputMin) / span);
    }
  }
}

/**
 * The remapped output value for a raw input: the curve
 * evaluated at the input phase, normalised by the asset's
 * value maximum, mapped onto the output range.
 */
export function evaluateCurveRemap(resolved: ResolvedCurveRemap, rawInput: number): number {
  const curveValue = evaluateFreeCurve(resolved.points, curveRemapPhase(resolved, rawInput));
  const normalised = curveValue / FREE_CURVE_VALUE_MAX;
  return resolved.outputMin + normalised * (resolved.outputMax - resolved.outputMin);
}

/** Compose a remapped output onto a target's base value. */
export function applyCurveRemapValue(
  resolved: ResolvedCurveRemap,
  rawInput: number,
  base: number,
): number {
  const output = evaluateCurveRemap(resolved, rawInput);
  switch (resolved.mode) {
    case 'replace':
      return output;
    case 'add':
      return base + output;
    case 'multiply':
      return base * output;
  }
}

/**
 * The resolution point for a future wiring layer: apply a
 * spec list to a numeric config record, with raw inputs
 * keyed by spec id. Returns the SAME object when the list
 * is empty or nothing applies, so callers can rely on
 * identity (applyModulation's discipline). A spec is
 * skipped when its input was not supplied or its target is
 * absent / not a number — an unsupplied remap is inert,
 * never an error. Specs apply in list order.
 */
export function applyCurveRemaps<T extends Record<string, number>>(
  config: T,
  specs: readonly CurveRemapSpec[],
  inputs: Readonly<Record<string, number>>,
): T {
  if (specs.length === 0) return config;
  let next: T | null = null;
  for (const spec of specs) {
    const raw = inputs[spec.id];
    if (typeof raw !== 'number') continue;
    const view = (next ?? config) as Record<string, number>;
    const current = view[spec.target];
    if (typeof current !== 'number') continue;
    const value = applyCurveRemapValue(resolveCurveRemap(spec), raw, current);
    if (!next) next = { ...config };
    (next as Record<string, number>)[spec.target] = value;
  }
  return next ?? config;
}
