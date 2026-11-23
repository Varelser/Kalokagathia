// CPU fallback mode (2026-11-15): a Canvas 2D degraded renderer for
// machines where WebGL is effectively unusable (software rasterisers,
// missing WebGL). The GPU tier system (lib/gpuTier.ts) already detects
// software renderers; this module owns the user's CPU-mode preference
// ('auto' follows that detection, 'on'/'off' force it) and the runtime
// store the scene switch and the GPU Diagnostics section read.
//
// Activation precedence: ?cpu=1 / ?cpu=0 query (test hook, wins over
// everything) > manual setting ('on'/'off') > 'auto' (software renderer
// detected, or no WebGL context could be created at all).
//
// Dependency-free and node-safe like gpuTier.ts: every window /
// localStorage / document access is guarded (verify scripts import the
// module graph under node).

import { useSyncExternalStore } from 'react';
import {
  getGpuTierInfo,
  isSoftwareRendererString,
  subscribeGpuTier,
} from './gpuTier';

export type CpuFallbackSetting = 'auto' | 'on' | 'off';

export type CpuFallbackReason = 'query' | 'manual' | 'software' | 'no-webgl' | 'safe-mode' | null;

export interface CpuFallbackState {
  active: boolean;
  setting: CpuFallbackSetting;
  reason: CpuFallbackReason;
  /** Last fps reported by the CPU renderer (null while inactive). */
  fps: number | null;
  /** Particle count the CPU renderer is currently simulating. */
  particleCount: number | null;
}

export const CPU_FALLBACK_STORAGE_KEY = 'kalokagathia.cpuFallback.v1';

function isSetting(value: unknown): value is CpuFallbackSetting {
  return value === 'auto' || value === 'on' || value === 'off';
}

function readSetting(): CpuFallbackSetting {
  try {
    if (typeof localStorage === 'undefined') return 'auto';
    const raw = localStorage.getItem(CPU_FALLBACK_STORAGE_KEY);
    return isSetting(raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

function writeSetting(setting: CpuFallbackSetting): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CPU_FALLBACK_STORAGE_KEY, setting);
  } catch {
    // Storage blocked: the in-memory setting still applies this session.
  }
}

/** ?cpu=1 forces CPU mode, ?cpu=0 forces it off; null when absent. */
export function readCpuQueryOverride(): boolean | null {
  try {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get('cpu');
    if (value === '1') return true;
    if (value === '0') return false;
    return null;
  } catch {
    return null;
  }
}

let webglProbeResult: boolean | null = null;

/**
 * One-shot probe: can this browser create any WebGL context at all?
 * Cached for the session; true in non-browser contexts (nothing to
 * fall back from under node).
 */
export function probeWebGlAvailable(): boolean {
  if (webglProbeResult !== null) return webglProbeResult;
  try {
    if (typeof document === 'undefined') {
      webglProbeResult = true;
      return webglProbeResult;
    }
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    webglProbeResult = gl !== null;
    if (gl) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    return webglProbeResult;
  } catch {
    webglProbeResult = false;
    return webglProbeResult;
  }
}

function computeActive(setting: CpuFallbackSetting): { active: boolean; reason: CpuFallbackReason } {
  const query = readCpuQueryOverride();
  if (query !== null) return { active: query, reason: query ? 'query' : null };
  if (setting === 'on') return { active: true, reason: 'manual' };
  if (setting === 'off') return { active: false, reason: null };
  const info = getGpuTierInfo();
  if (info.source === 'software' || isSoftwareRendererString(info.renderer)) {
    return { active: true, reason: 'software' };
  }
  if (!probeWebGlAvailable()) return { active: true, reason: 'no-webgl' };
  return { active: false, reason: null };
}

let currentSetting: CpuFallbackSetting = readSetting();
let currentFps: number | null = null;
let currentCount: number | null = null;
let snapshot: CpuFallbackState = (() => {
  const { active, reason } = computeActive(currentSetting);
  return { active, setting: currentSetting, reason, fps: null, particleCount: null };
})();

const listeners = new Set<() => void>();

function refresh(): void {
  const { active, reason } = computeActive(currentSetting);
  const next: CpuFallbackState = {
    active,
    setting: currentSetting,
    reason,
    fps: active ? currentFps : null,
    particleCount: active ? currentCount : null,
  };
  if (
    next.active !== snapshot.active
    || next.setting !== snapshot.setting
    || next.reason !== snapshot.reason
    || next.fps !== snapshot.fps
    || next.particleCount !== snapshot.particleCount
  ) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
}

// GPU tier detection can land after first paint (App runs initGpuTier
// in an effect); re-evaluate auto-activation when it changes.
subscribeGpuTier(() => refresh());

export function subscribeCpuFallback(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCpuFallbackState(): CpuFallbackState {
  return snapshot;
}

export function setCpuFallbackSetting(setting: CpuFallbackSetting): void {
  currentSetting = setting;
  writeSetting(setting);
  refresh();
}

/** Called by the CPU renderer each stats tick (~2/s). */
export function reportCpuRendererStats(fps: number | null, particleCount: number | null): void {
  currentFps = fps;
  currentCount = particleCount;
  refresh();
}

/** React binding for the CPU fallback store. */
export function useCpuFallback(): CpuFallbackState {
  return useSyncExternalStore(subscribeCpuFallback, getCpuFallbackState, getCpuFallbackState);
}
