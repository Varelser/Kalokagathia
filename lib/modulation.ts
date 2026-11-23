import React from 'react';
import type { ParticleConfig } from '../types';
import type { AudioLevels } from './audioControllerTypes';
import { PARAMETER_CATALOG } from './parameterCatalog';
import {
  NOISE_SOURCE_IDS,
  NOISE_SOURCE_OPTIONS,
  getNoiseLinkValues,
  type NoiseSourceId,
} from './noiseLink';
import {
  compileExpressionCached,
  compileExpressionCachedWithVars,
  evaluateCompiledExpression,
  evaluateCompiledExpressionWithVars,
  EXPRESSION_MAX_LENGTH,
} from './expression';
import { EXPRESSION_PARAM_REF_NAMES, buildExpressionParamVars } from './expressionParamRefs';
import { getDataTable, sampleDataColumn } from './dataTable';

export { NOISE_SOURCE_OPTIONS };
export type { NoiseSourceId };

/**
 * Modulation engine.
 *
 * The scene renders from an *effective* config derived from the
 * base config just before rendering (see
 * components/useAppSceneTemporalConfig.ts, which already applies
 * the built-in temporal profiles the same way). Modulation is a
 * second overlay on that effective config: signals (LFOs, audio
 * bands, the Noise app link) are routed to catalogued parameters
 * with a depth, and the routed parameters breathe on their own.
 *
 * The base config is never written — presets, project files and
 * serialization are untouched, exactly like temporal profiles.
 * The setup (LFO settings + routes) is performance state: it
 * persists in localStorage and is shared between the Play tab
 * editor and the scene through the tiny store at the bottom of
 * this module.
 */

export type LfoWaveform = 'sine' | 'triangle' | 'saw' | 'square' | 'drift';

export interface LfoSettings {
  waveform: LfoWaveform;
  /** Cycles per second. */
  rate: number;
}

/** How an envelope source (Phase AC) is fired. */
export type EnvelopeTrigger = 'manual' | 'audio' | 'midi';

export type ModulationSource =
  | { kind: 'lfo'; index: number }
  | { kind: 'audio'; band: keyof AudioLevels }
  | { kind: 'noise'; source: NoiseSourceId }
  // Internal value noise (Phase AC): generated in-app, a pure
  // function of (seed, time) — NOT the external Noise app link
  // above ('noise'), which is a live feed from another program.
  | { kind: 'vnoise'; seed: number; rate: number; octaves: number }
  // Generalised envelope (Phase AC): the audioPulse idea as a
  // source of its own — attack/decay one-shot fired by a manual
  // button, the audio pulse band, or any MIDI note-on.
  | { kind: 'envelope'; trigger: EnvelopeTrigger; attack: number; decay: number }
  // Expression (Phase AJ): a sandboxed expression over the wrapped
  // source's value (x) and time (t), evaluated by lib/expression.ts
  // (no eval). Invalid expressions / non-finite results fall back
  // to the raw input value.
  | { kind: 'expr'; text: string; input: ModulationSource }
  // Data column (Phase AJ): a named column of the registered data
  // table (lib/dataTable.ts) read as a time series — row index is
  // floor(time × rate), values normalised by the column's range.
  | { kind: 'data'; column: string; rate: number };

/**
 * One stage of a route's CHOP-style signal chain (Phase AJ).
 * Stages apply in array order after the source is evaluated and
 * before the route's lag. spring / filter hold per-route state
 * outside the setup (the lag discipline); trim is stateless.
 */
export type ModulationChainOp =
  | { op: 'spring'; freq: number; damping: number }
  | { op: 'trim'; low: number; high: number; invert: boolean }
  | { op: 'filter'; cutoff: number };

export const MODULATION_CHAIN_MAX_OPS = 4;

export interface ModulationRoute {
  id: string;
  source: ModulationSource;
  /** A numeric parameter key from the parameter catalog. */
  target: keyof ParticleConfig;
  /** -1..1 — fraction of the target's catalog range applied around its center/base. */
  depth: number;
  /**
   * First-order lag / smoothing in seconds (Phase AC). 0 or
   * absent = the raw signal, bit-identical to the pre-AC engine.
   * The filter state lives outside the setup (see the signal
   * state section below) so presets stay pure data.
   */
  lag?: number;
  /**
   * CHOP-style chain stages (Phase AJ), applied in order after the
   * source and before `lag`. Absent / empty = the pre-AJ path,
   * bit-identical.
   */
  chain?: ModulationChainOp[];
}

export interface ModulationSetup {
  enabled: boolean;
  lfos: LfoSettings[];
  routes: ModulationRoute[];
}

export const MODULATION_LFO_COUNT = 4;

export const LFO_WAVEFORM_OPTIONS: { value: LfoWaveform; label: string }[] = [
  { value: 'sine', label: 'Sine 正弦波' },
  { value: 'triangle', label: 'Triangle 三角波' },
  { value: 'saw', label: 'Saw のこぎり波' },
  { value: 'square', label: 'Square 矩形波' },
  { value: 'drift', label: 'Drift ゆらぎ' },
];

export const AUDIO_BAND_OPTIONS: { value: keyof AudioLevels; label: string }[] = [
  { value: 'bass', label: 'Audio · 低音 Bass' },
  { value: 'treble', label: 'Audio · 高音 Treble' },
  { value: 'pulse', label: 'Audio · パルス Pulse' },
  { value: 'bandA', label: 'Audio · 帯域A' },
  { value: 'bandB', label: 'Audio · 帯域B' },
  { value: 'sub', label: 'Audio · 超低音 Sub (20-60Hz)' },
  { value: 'low', label: 'Audio · 低音 Low (60-250Hz)' },
  { value: 'mid', label: 'Audio · 中音 Mid (250-2000Hz)' },
  { value: 'high', label: 'Audio · 高音 High (2-6kHz)' },
  { value: 'presence', label: 'Audio · プレゼンス Presence (6-16kHz)' },
  { value: 'level', label: 'Audio · 全体 Level' },
];

export function createDefaultModulationSetup(): ModulationSetup {
  return {
    enabled: false,
    lfos: [
      { waveform: 'sine', rate: 0.1 },
      { waveform: 'triangle', rate: 0.23 },
      { waveform: 'saw', rate: 0.05 },
      { waveform: 'drift', rate: 0.07 },
    ],
    routes: [],
  };
}

export function createStarterModulationRoutes(): ModulationRoute[] {
  return [
    { id: 'starter-1', source: { kind: 'lfo', index: 0 }, target: 'layer2FlowSpeed', depth: 0.35 },
    { id: 'starter-2', source: { kind: 'audio', band: 'bass' }, target: 'layer2BaseSize', depth: 0.5 },
    { id: 'starter-3', source: { kind: 'lfo', index: 1 }, target: 'layer3FlowSpeed', depth: 0.3 },
    // Phase AC: the internal-noise showcase lives here, with the
    // modulation system's own starter set (presets cannot carry a
    // modulation setup — it is performance state, not config).
    { id: 'starter-4', source: { kind: 'vnoise', seed: 7, rate: 0.3, octaves: 3 }, target: 'layer3BaseSize', depth: 0.4 },
    // Phase AJ: expression shaping (x*x softens the LFO's low end)
    // and a spring-chained LFO (the CHOP chain showcase).
    {
      id: 'starter-5',
      source: { kind: 'expr', text: 'x*x', input: { kind: 'lfo', index: 2 } },
      target: 'layer2BaseSize',
      depth: 0.3,
    },
    {
      id: 'starter-6',
      source: { kind: 'lfo', index: 3 },
      target: 'layer3FlowSpeed',
      depth: 0.35,
      chain: [{ op: 'spring', freq: 1.6, damping: 0.3 }],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Phase AC signal sources: internal value noise, envelope, lag.      */
/*                                                                    */
/* The value noise and the envelope shape are pure functions, so a    */
/* deterministic render reproduces them bit-for-bit. The lag filter   */
/* and the envelope triggers hold per-route state OUTSIDE the setup:  */
/*                                                                    */
/* - Lag state initialises to the first sampled input value (no       */
/*   start-up ramp) and re-initialises whenever time runs backwards   */
/*   (a new render / scrub), so the state is a pure function of the   */
/*   (time, input) sequence since the last re-initialisation.        */
/* - An envelope's value is a pure function of (time - last trigger   */
/*   time). Manual triggers are recorded per route; the MIDI trigger  */
/*   time is shared (every note-on fires every MIDI envelope, the     */
/*   musical behaviour); the audio trigger edge-detects the pulse     */
/*   band per route.                                                  */
/* ------------------------------------------------------------------ */

/** Deterministic lattice hash → [0, 1). Integer math only (imul /
 *  shifts), so the result is bit-identical on every JS engine. */
export function hashLattice01(seed: number, i: number): number {
  let h = (seed | 0) ^ Math.imul(i | 0, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** One octave of 1D value noise at coordinate x → [0, 1]. */
export function valueNoise1D(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hashLattice01(seed, i);
  const b = hashLattice01(seed, i + 1);
  return a + (b - a) * u;
}

/**
 * Internal noise channel value at `time`: fBm over `octaves`
 * octaves of value noise (amplitudes 1, 1/2, 1/4, …, normalised),
 * sampled at time × rate lattice cells per second. → [0, 1],
 * resting around 0.5 like an LFO. Pure function of its inputs.
 */
export function internalNoiseValue(seed: number, time: number, rate: number, octaves: number): number {
  const oct = Math.max(1, Math.min(4, Math.round(octaves)));
  let sum = 0;
  let ampSum = 0;
  let amp = 1;
  let freq = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * valueNoise1D(seed + o * 101, time * rate * freq);
    ampSum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / ampSum;
}

/**
 * Envelope shape: linear attack to 1 over `attack` seconds, then
 * an exponential decay with time constant `decay`. elapsed < 0
 * (never fired / fired in the future) is exactly 0.
 */
export function envelopeShape(elapsed: number, attack: number, decay: number): number {
  if (!(elapsed >= 0)) return 0;
  const a = Math.max(0.0005, attack);
  if (elapsed < a) return elapsed / a;
  return Math.exp(-(elapsed - a) / Math.max(0.01, decay));
}

/** One step of the first-order lag filter (pure). dt <= 0 holds. */
export function lagStepValue(prev: number, raw: number, dt: number, lag: number): number {
  if (!(dt > 0) || !(lag > 0)) return prev;
  const alpha = 1 - Math.exp(-dt / lag);
  return prev + (raw - prev) * alpha;
}

/* ------------------------------------------------------------------ */
/* Phase AJ chain stages: spring / trim / filter.                     */
/*                                                                    */
/* The stateful stages follow the lag discipline exactly: state      */
/* lives outside the setup, initialises to the first sampled input,  */
/* re-initialises when time runs backwards, and is a pure function   */
/* of the (time, input) sequence since then — so a deterministic     */
/* render reproduces the chain bit-for-bit.                          */
/* ------------------------------------------------------------------ */

export interface ChainStageState {
  /** Current stage output. */
  y: number;
  /** Spring velocity (unused by filter). */
  v: number;
  /** Time of the last step. */
  time: number;
  init: boolean;
}

export function createChainStageState(): ChainStageState {
  return { y: 0, v: 0, time: 0, init: false };
}

/** Stateless trim: remap [low, high] onto [0, 1] with clamping. */
export function trimValue(raw: number, low: number, high: number, invert: boolean): number {
  const span = high - low;
  const mapped = span === 0 ? (raw < low ? 0 : 1) : Math.min(1, Math.max(0, (raw - low) / span));
  return invert ? 1 - mapped : mapped;
}

/**
 * Advance one stateful chain stage (spring / filter) toward `raw`
 * over `dt` seconds, mutating `state`. Callers initialise the
 * state to the first input and skip the call when dt <= 0.
 */
export function stepChainStage(
  op: Extract<ModulationChainOp, { op: 'spring' } | { op: 'filter' }>,
  state: ChainStageState,
  raw: number,
  dt: number,
): number {
  if (!(dt > 0)) return state.y;
  if (op.op === 'filter') {
    const alpha = 1 - Math.exp(-2 * Math.PI * Math.max(0.05, op.cutoff) * dt);
    state.y = state.y + (raw - state.y) * alpha;
    state.time += dt;
    return state.y;
  }
  // Spring: semi-implicit Euler with substeps of at most 1/240 s
  // (capped), the standard stable form for a driven oscillator.
  const omega = 2 * Math.PI * Math.max(0.05, op.freq);
  const zeta = Math.max(0, op.damping);
  const steps = Math.min(64, Math.max(1, Math.ceil(dt / (1 / 240))));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const accel = omega * omega * (raw - state.y) - 2 * zeta * omega * state.v;
    state.v += accel * h;
    state.y += state.v * h;
  }
  state.time += dt;
  return state.y;
}

/** Apply one chain stage (any kind) for a single sample. */
export function applyChainStage(
  op: ModulationChainOp,
  state: ChainStageState,
  raw: number,
  time: number,
): number {
  if (op.op === 'trim') return trimValue(raw, op.low, op.high, op.invert);
  if (!state.init || time < state.time) {
    state.y = raw;
    state.v = 0;
    state.time = time;
    state.init = true;
    return state.y;
  }
  if (time > state.time) {
    return stepChainStage(op, state, raw, time - state.time);
  }
  return state.y;
}

interface RouteSignalState {
  /** Last lag output; null until the first sample initialises it. */
  lagValue: number | null;
  lagTime: number;
  /** Last manual/audio trigger time for envelope sources. */
  envLastTrigger: number;
  /** Previous audio pulse level for edge detection. */
  envPrevAudio: number;
  /** Per-stage state for the route's chain (Phase AJ), by index. */
  chainStates: ChainStageState[];
}

const routeSignalStates = new Map<string, RouteSignalState>();
let midiTriggerTime = Number.NEGATIVE_INFINITY;

function getRouteSignalState(routeId: string): RouteSignalState {
  let state = routeSignalStates.get(routeId);
  if (!state) {
    state = {
      lagValue: null,
      lagTime: 0,
      envLastTrigger: Number.NEGATIVE_INFINITY,
      envPrevAudio: 0,
      chainStates: [],
    };
    routeSignalStates.set(routeId, state);
  }
  return state;
}

/** Fire every manual-trigger envelope routed under `routeId`. */
export function fireModulationEnvelope(routeId: string, time: number): void {
  getRouteSignalState(routeId).envLastTrigger = time;
}

/** Called from the MIDI input path on every note-on (velocity > 0). */
export function noteModulationMidiTrigger(time: number): void {
  midiTriggerTime = time;
}

/** Drop all lag/envelope state (engine reset; also used by tests). */
export function resetModulationSignalStates(): void {
  routeSignalStates.clear();
  midiTriggerTime = Number.NEGATIVE_INFINITY;
}

/** Evaluate an LFO at time t (seconds). Returns 0..1. */
export function evaluateLfo(settings: LfoSettings, time: number): number {
  const phase = time * settings.rate;
  const p = phase - Math.floor(phase);
  switch (settings.waveform) {
    case 'sine':
      return 0.5 + 0.5 * Math.sin(2 * Math.PI * phase);
    case 'triangle':
      return p < 0.5 ? 2 * p : 2 - 2 * p;
    case 'saw':
      return p;
    case 'square':
      return p < 0.5 ? 1 : 0;
    case 'drift':
      // Two incommensurate sines: an organic wander that never quite repeats.
      return (
        0.5 +
        0.32 * Math.sin(2 * Math.PI * phase) +
        0.18 * Math.sin(2 * Math.PI * phase * 2.717 + 1.3)
      );
  }
}

interface SignalValue {
  value01: number;
  /** The neutral point of the signal: LFOs rest at 0.5, audio bands at 0. */
  center: number;
}

export function evaluateSource(
  source: ModulationSource,
  setup: ModulationSetup,
  time: number,
  audio: AudioLevels | undefined,
  routeId?: string,
  // Phase 15 (Houdini §2): parameter-reference environment for
  // expression sources, built from the BASE config by
  // applyModulation. Absent = the pre-15 expression path.
  paramVars?: Record<string, number>,
): SignalValue {
  if (source.kind === 'lfo') {
    const settings = setup.lfos[source.index];
    if (!settings) return { value01: 0.5, center: 0.5 };
    return { value01: evaluateLfo(settings, time), center: 0.5 };
  }
  if (source.kind === 'noise') {
    // Noise link values rest at 0 like audio bands (silence = no
    // sender, stale state, or the sender is stopped).
    const value = getNoiseLinkValues()[source.source];
    return { value01: Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)), center: 0 };
  }
  if (source.kind === 'vnoise') {
    return { value01: internalNoiseValue(source.seed, time, source.rate, source.octaves), center: 0.5 };
  }
  if (source.kind === 'envelope') {
    const state = getRouteSignalState(routeId ?? '');
    let lastTrigger = state.envLastTrigger;
    if (source.trigger === 'midi') {
      lastTrigger = Math.max(lastTrigger, midiTriggerTime);
    } else if (source.trigger === 'audio') {
      const level = audio ? audio.pulse : 0;
      const clean = Number.isFinite(level) ? level : 0;
      if (state.envPrevAudio <= 0.6 && clean > 0.6) state.envLastTrigger = time;
      state.envPrevAudio = clean;
      lastTrigger = state.envLastTrigger;
    }
    return { value01: envelopeShape(time - lastTrigger, source.attack, source.decay), center: 0 };
  }
  if (source.kind === 'data') {
    // Data column (Phase AJ): a pure function of time given the
    // registered table. The row index wraps around the table
    // (floor(time × rate) mod rows). No table / unknown column
    // samples neutral (sampleDataColumn returns 0.5), so the
    // route is inert until data is registered.
    const table = getDataTable();
    const rowCount = table ? table.rows.length : 0;
    const rawIndex = Math.floor(time * Math.max(0, source.rate));
    const index = rowCount > 0 ? ((rawIndex % rowCount) + rowCount) % rowCount : 0;
    return { value01: sampleDataColumn(table, source.column, index), center: 0.5 };
  }
  if (source.kind === 'expr') {
    // Expression (Phase AJ): the wrapped source supplies x; the
    // expression shapes it. Invalid expressions and non-finite
    // results fall back to the raw input value.
    const inner = evaluateSource(source.input, setup, time, audio, routeId, paramVars);
    if (paramVars) {
      // Phase 15: with a parameter-reference environment the
      // expression may also read other parameters (p_<key>) —
      // base-config values normalised to [0, 1]; see
      // lib/expressionParamRefs.ts for the fixed semantics.
      const compiled = compileExpressionCachedWithVars(source.text, EXPRESSION_PARAM_REF_NAMES);
      if (!compiled.ok) return { value01: inner.value01, center: 0.5 };
      const value = evaluateCompiledExpressionWithVars(compiled.ast, { ...paramVars, x: inner.value01, t: time });
      if (!Number.isFinite(value)) return { value01: inner.value01, center: 0.5 };
      return { value01: Math.min(1, Math.max(0, value)), center: 0.5 };
    }
    const compiled = compileExpressionCached(source.text);
    if (!compiled.ok) return { value01: inner.value01, center: 0.5 };
    const value = evaluateCompiledExpression(compiled.ast, inner.value01, time);
    if (!Number.isFinite(value)) return { value01: inner.value01, center: 0.5 };
    return { value01: Math.min(1, Math.max(0, value)), center: 0.5 };
  }
  const level = audio ? audio[source.band] : 0;
  return { value01: Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0)), center: 0 };
}

export const ENVELOPE_TRIGGER_OPTIONS: { value: EnvelopeTrigger; label: string }[] = [
  { value: 'manual', label: '手動ボタン Manual' },
  { value: 'audio', label: '音声パルス Audio Pulse' },
  { value: 'midi', label: 'MIDI ノート Note' },
];

export function describeModulationSource(source: ModulationSource): string {
  if (source.kind === 'lfo') return `LFO ${source.index + 1}`;
  if (source.kind === 'noise') {
    const option = NOISE_SOURCE_OPTIONS.find((candidate) => candidate.value === source.source);
    return option ? option.label : `Noise · ${source.source}`;
  }
  if (source.kind === 'vnoise') return `内部ノイズ #${source.seed}`;
  if (source.kind === 'envelope') {
    const trigger = ENVELOPE_TRIGGER_OPTIONS.find((option) => option.value === source.trigger);
    return `エンベロープ (${trigger ? trigger.label : source.trigger})`;
  }
  if (source.kind === 'expr') return `式 [${source.text}]`;
  if (source.kind === 'data') return `データ列 ${source.column}`;
  const band = AUDIO_BAND_OPTIONS.find((option) => option.value === source.band);
  return band ? band.label : `Audio · ${source.band}`;
}

/**
 * Apply the modulation overlay. Returns the SAME object when the
 * engine is off or has no routes, so callers can rely on identity.
 * Contributions from several routes onto one parameter add up;
 * each result is clamped to the catalog range and snapped to the
 * catalog step, like every other input path (panels, MIDI, OSC).
 */
export function applyModulation(
  config: ParticleConfig,
  setup: ModulationSetup,
  time: number,
  audio: AudioLevels | undefined,
): ParticleConfig {
  if (!setup.enabled || setup.routes.length === 0) return config;
  // Prune signal state for routes that no longer exist (Phase AC).
  if (routeSignalStates.size > setup.routes.length) {
    const live = new Set(setup.routes.map((route) => route.id));
    routeSignalStates.forEach((_, id) => {
      if (!live.has(id)) routeSignalStates.delete(id);
    });
  }
  let next: ParticleConfig | null = null;
  const contributions = new Map<keyof ParticleConfig, number>();
  // Phase 15 (Houdini §2): build the parameter-reference
  // environment once, from the BASE config, when any route's
  // source tree contains an expression. Routes without
  // expressions never pay for it and behave exactly as before.
  // Only the 'expr' source kind wraps another source; every
  // other kind is a leaf, so an expression is in play exactly
  // when some route's source chain starts from one (nested
  // expressions still pass paramVars down through evaluateSource).
  const paramVars = setup.routes.some((route) => route.source.kind === 'expr')
    ? buildExpressionParamVars(config)
    : undefined;
  for (const route of setup.routes) {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === route.target);
    if (!entry) continue;
    const base = config[route.target];
    if (typeof base !== 'number') continue;
    const evaluated = evaluateSource(route.source, setup, time, audio, route.id, paramVars);
    let { value01 } = evaluated;
    const { center } = evaluated;
    // CHOP chain (Phase AJ): stages apply in order between the
    // source and the lag. Stateful stages follow the lag state
    // discipline, so the chain output is a pure function of the
    // (time, input) sequence since the last re-initialisation.
    // No chain = this block is skipped entirely (pre-AJ path).
    if (route.chain && route.chain.length > 0) {
      const state = getRouteSignalState(route.id);
      if (state.chainStates.length !== route.chain.length) {
        state.chainStates = route.chain.map(() => createChainStageState());
      }
      route.chain.forEach((op, stageIndex) => {
        value01 = applyChainStage(op, state.chainStates[stageIndex], value01, time);
      });
    }
    // First-order lag (Phase AC): state initialises to the first
    // sampled input and re-initialises when time runs backwards,
    // so the output is a pure function of the (time, input)
    // sequence since then. lag 0 / absent skips the state
    // entirely — the pre-AC signal path, bit-identical.
    if (route.lag && route.lag > 0) {
      const state = getRouteSignalState(route.id);
      if (state.lagValue === null || time < state.lagTime) {
        state.lagValue = value01;
        state.lagTime = time;
      } else if (time > state.lagTime) {
        state.lagValue = lagStepValue(state.lagValue, value01, time - state.lagTime, route.lag);
        state.lagTime = time;
      }
      value01 = state.lagValue;
    }
    const delta = (value01 - center) * route.depth * (entry.max - entry.min);
    contributions.set(route.target, (contributions.get(route.target) ?? 0) + delta);
  }
  contributions.forEach((delta, key) => {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === key);
    const base = config[key];
    if (!entry || typeof base !== 'number') return;
    const clamped = Math.min(entry.max, Math.max(entry.min, base + delta));
    const stepped = Math.round(clamped / entry.step) * entry.step;
    if (!next) next = { ...config };
    (next as unknown as Record<string, unknown>)[key as string] = Number(stepped.toFixed(6));
  });
  return next ?? config;
}

/* ---------------- persistence + validation ---------------- */

const STORAGE_KEY = 'kalokagathia.modulation.v1';

const WAVEFORMS: LfoWaveform[] = ['sine', 'triangle', 'saw', 'square', 'drift'];
const AUDIO_BANDS: (keyof AudioLevels)[] = ['bass', 'treble', 'pulse', 'bandA', 'bandB', 'sub', 'low', 'mid', 'high', 'presence', 'level'];

const clampNumber = (value: unknown, min: number, max: number, fallbackValue: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallbackValue;

/**
 * Rebuild one stored source field by field (Phase AJ refactor of
 * the inline AC-era logic, extended with the expr / data kinds).
 * Returns null when the shape is unusable. `allowExpr` is false
 * for an expression's wrapped input, so expressions cannot nest.
 */
function sanitizeSource(rawSource: unknown, allowExpr: boolean): ModulationSource | null {
  if (!rawSource || typeof rawSource !== 'object') return null;
  const source = rawSource as ModulationSource;
  switch (source.kind) {
    case 'lfo':
      return typeof source.index === 'number' && source.index >= 0 && source.index < MODULATION_LFO_COUNT
        ? { kind: 'lfo', index: Math.floor(source.index) }
        : null;
    case 'audio':
      return AUDIO_BANDS.includes(source.band) ? { kind: 'audio', band: source.band } : null;
    case 'noise':
      return NOISE_SOURCE_IDS.includes(source.source) ? { kind: 'noise', source: source.source } : null;
    case 'vnoise':
      return {
        kind: 'vnoise',
        seed: Math.min(9999, Math.max(0, Math.round(clampNumber(source.seed, 0, 9999, 1)))),
        rate: clampNumber(source.rate, 0.02, 4, 0.35),
        octaves: Math.min(4, Math.max(1, Math.round(clampNumber(source.octaves, 1, 4, 2)))),
      };
    case 'envelope':
      return {
        kind: 'envelope',
        trigger: source.trigger === 'audio' || source.trigger === 'midi' ? source.trigger : 'manual',
        attack: clampNumber(source.attack, 0.005, 1, 0.01),
        decay: clampNumber(source.decay, 0.05, 4, 0.6),
      };
    case 'data':
      return {
        kind: 'data',
        column: typeof source.column === 'string' && source.column.length > 0 ? source.column.slice(0, 64) : 'col1',
        rate: clampNumber(source.rate, 0.05, 60, 2),
      };
    case 'expr': {
      if (!allowExpr) return null;
      const input = sanitizeSource(source.input, false);
      if (!input) return null;
      return {
        kind: 'expr',
        text: typeof source.text === 'string' ? source.text.slice(0, EXPRESSION_MAX_LENGTH) : 'x',
        input,
      };
    }
    default:
      return null;
  }
}

/** Rebuild a stored chain: known stages only, params clamped. */
function sanitizeChain(rawChain: unknown): ModulationChainOp[] | undefined {
  if (!Array.isArray(rawChain)) return undefined;
  const ops: ModulationChainOp[] = [];
  rawChain.slice(0, MODULATION_CHAIN_MAX_OPS).forEach((rawOp) => {
    if (!rawOp || typeof rawOp !== 'object') return;
    const op = rawOp as ModulationChainOp;
    if (op.op === 'spring') {
      ops.push({ op: 'spring', freq: clampNumber(op.freq, 0.1, 10, 2), damping: clampNumber(op.damping, 0, 2, 0.35) });
    } else if (op.op === 'filter') {
      ops.push({ op: 'filter', cutoff: clampNumber(op.cutoff, 0.1, 40, 4) });
    } else if (op.op === 'trim') {
      ops.push({
        op: 'trim',
        low: clampNumber(op.low, 0, 1, 0),
        high: clampNumber(op.high, 0, 1, 1),
        invert: op.invert === true,
      });
    }
  });
  return ops.length > 0 ? ops : undefined;
}

function sanitizeSetup(value: unknown): ModulationSetup {
  const fallback = createDefaultModulationSetup();
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<ModulationSetup>;
  const lfos = fallback.lfos.map((def, i) => {
    const candidate = Array.isArray(raw.lfos) ? (raw.lfos[i] as Partial<LfoSettings> | undefined) : undefined;
    return {
      waveform: candidate && WAVEFORMS.includes(candidate.waveform as LfoWaveform) ? (candidate.waveform as LfoWaveform) : def.waveform,
      rate: candidate && typeof candidate.rate === 'number' && Number.isFinite(candidate.rate)
        ? Math.min(8, Math.max(0.01, candidate.rate))
        : def.rate,
    };
  });
  const routes: ModulationRoute[] = [];
  if (Array.isArray(raw.routes)) {
    raw.routes.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object') return;
      const route = entry as Partial<ModulationRoute>;
      const targetOk = typeof route.target === 'string' && PARAMETER_CATALOG.some((c) => c.key === route.target);
      if (!targetOk || !route.source || typeof route.source !== 'object') return;
      // Sources are rebuilt field by field so malformed stored
      // values can never reach the evaluator.
      const source = sanitizeSource(route.source, true);
      if (!source) return;
      routes.push({
        id: typeof route.id === 'string' ? route.id : `route-${i}`,
        source,
        target: route.target as keyof ParticleConfig,
        depth: typeof route.depth === 'number' && Number.isFinite(route.depth) ? Math.min(1, Math.max(-1, route.depth)) : 0.3,
        lag: typeof route.lag === 'number' && Number.isFinite(route.lag) ? Math.min(5, Math.max(0, route.lag)) : 0,
        chain: sanitizeChain(route.chain),
      });
    });
  }
  return { enabled: raw.enabled === true, lfos, routes };
}

export function loadModulationSetup(storage: Pick<Storage, 'getItem'> | undefined): ModulationSetup {
  if (!storage) return createDefaultModulationSetup();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultModulationSetup();
    return sanitizeSetup(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultModulationSetup();
  }
}

export function saveModulationSetup(storage: Pick<Storage, 'setItem'>, setup: ModulationSetup): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(setup));
  } catch {
    // Storage full/blocked: the setup simply won't persist.
  }
}

/* ---------------- shared store (editor <-> scene) ---------------- */

let currentSetup: ModulationSetup | null = null;
const listeners = new Set<() => void>();

function ensureSetup(): ModulationSetup {
  if (!currentSetup) {
    currentSetup = loadModulationSetup(typeof window !== 'undefined' ? window.localStorage : undefined);
  }
  return currentSetup;
}

export function getModulationSetup(): ModulationSetup {
  return ensureSetup();
}

export function setModulationSetup(next: ModulationSetup): void {
  currentSetup = next;
  if (typeof window !== 'undefined') saveModulationSetup(window.localStorage, next);
  listeners.forEach((listener) => listener());
}

export function subscribeModulation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useModulationSetup(): ModulationSetup {
  return React.useSyncExternalStore(subscribeModulation, getModulationSetup, getModulationSetup);
}
