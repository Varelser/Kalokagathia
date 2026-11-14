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

export type ModulationSource =
  | { kind: 'lfo'; index: number }
  | { kind: 'audio'; band: keyof AudioLevels }
  | { kind: 'noise'; source: NoiseSourceId };

export interface ModulationRoute {
  id: string;
  source: ModulationSource;
  /** A numeric parameter key from the parameter catalog. */
  target: keyof ParticleConfig;
  /** -1..1 — fraction of the target's catalog range applied around its center/base. */
  depth: number;
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
  ];
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
  const level = audio ? audio[source.band] : 0;
  return { value01: Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0)), center: 0 };
}

export function describeModulationSource(source: ModulationSource): string {
  if (source.kind === 'lfo') return `LFO ${source.index + 1}`;
  if (source.kind === 'noise') {
    const option = NOISE_SOURCE_OPTIONS.find((candidate) => candidate.value === source.source);
    return option ? option.label : `Noise · ${source.source}`;
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
  let next: ParticleConfig | null = null;
  const contributions = new Map<keyof ParticleConfig, number>();
  for (const route of setup.routes) {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === route.target);
    if (!entry) continue;
    const base = config[route.target];
    if (typeof base !== 'number') continue;
    const { value01, center } = evaluateSource(route.source, setup, time, audio);
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
      const source = route.source as ModulationSource;
      const sourceOk =
        (source.kind === 'lfo' && typeof source.index === 'number' && source.index >= 0 && source.index < MODULATION_LFO_COUNT) ||
        (source.kind === 'audio' && AUDIO_BANDS.includes(source.band)) ||
        (source.kind === 'noise' && NOISE_SOURCE_IDS.includes(source.source));
      if (!sourceOk) return;
      routes.push({
        id: typeof route.id === 'string' ? route.id : `route-${i}`,
        source,
        target: route.target as keyof ParticleConfig,
        depth: typeof route.depth === 'number' && Number.isFinite(route.depth) ? Math.min(1, Math.max(-1, route.depth)) : 0.3,
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
