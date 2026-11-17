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
  | { kind: 'envelope'; trigger: EnvelopeTrigger; attack: number; decay: number };

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

interface RouteSignalState {
  /** Last lag output; null until the first sample initialises it. */
  lagValue: number | null;
  lagTime: number;
  /** Last manual/audio trigger time for envelope sources. */
  envLastTrigger: number;
  /** Previous audio pulse level for edge detection. */
  envPrevAudio: number;
}

const routeSignalStates = new Map<string, RouteSignalState>();
let midiTriggerTime = Number.NEGATIVE_INFINITY;

function getRouteSignalState(routeId: string): RouteSignalState {
  let state = routeSignalStates.get(routeId);
  if (!state) {
    state = { lagValue: null, lagTime: 0, envLastTrigger: Number.NEGATIVE_INFINITY, envPrevAudio: 0 };
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
  for (const route of setup.routes) {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === route.target);
    if (!entry) continue;
    const base = config[route.target];
    if (typeof base !== 'number') continue;
    const evaluated = evaluateSource(route.source, setup, time, audio, route.id);
    let { value01 } = evaluated;
    const { center } = evaluated;
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
      const rawSource = route.source as ModulationSource;
      const sourceOk =
        (rawSource.kind === 'lfo' && typeof rawSource.index === 'number' && rawSource.index >= 0 && rawSource.index < MODULATION_LFO_COUNT) ||
        (rawSource.kind === 'audio' && AUDIO_BANDS.includes(rawSource.band)) ||
        (rawSource.kind === 'noise' && NOISE_SOURCE_IDS.includes(rawSource.source)) ||
        rawSource.kind === 'vnoise' ||
        rawSource.kind === 'envelope';
      if (!sourceOk) return;
      // Phase AC sources are rebuilt field by field so malformed
      // stored values can never reach the evaluator.
      let source: ModulationSource = rawSource;
      if (rawSource.kind === 'vnoise') {
        source = {
          kind: 'vnoise',
          seed: typeof rawSource.seed === 'number' && Number.isFinite(rawSource.seed) ? Math.min(9999, Math.max(0, Math.round(rawSource.seed))) : 1,
          rate: typeof rawSource.rate === 'number' && Number.isFinite(rawSource.rate) ? Math.min(4, Math.max(0.02, rawSource.rate)) : 0.35,
          octaves: typeof rawSource.octaves === 'number' && Number.isFinite(rawSource.octaves) ? Math.min(4, Math.max(1, Math.round(rawSource.octaves))) : 2,
        };
      } else if (rawSource.kind === 'envelope') {
        source = {
          kind: 'envelope',
          trigger: rawSource.trigger === 'audio' || rawSource.trigger === 'midi' ? rawSource.trigger : 'manual',
          attack: typeof rawSource.attack === 'number' && Number.isFinite(rawSource.attack) ? Math.min(1, Math.max(0.005, rawSource.attack)) : 0.01,
          decay: typeof rawSource.decay === 'number' && Number.isFinite(rawSource.decay) ? Math.min(4, Math.max(0.05, rawSource.decay)) : 0.6,
        };
      }
      routes.push({
        id: typeof route.id === 'string' ? route.id : `route-${i}`,
        source,
        target: route.target as keyof ParticleConfig,
        depth: typeof route.depth === 'number' && Number.isFinite(route.depth) ? Math.min(1, Math.max(-1, route.depth)) : 0.3,
        lag: typeof route.lag === 'number' && Number.isFinite(route.lag) ? Math.min(5, Math.max(0, route.lag)) : 0,
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
