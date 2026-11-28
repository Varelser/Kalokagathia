// Safe mode (Phase 15, Abyssal B): a crash-flag downgrade ladder,
// adapted from the Abyssal Garden transfer lab prototype
// (~/workspace/abyssal-transfer-lab/src/safemode.mjs) and shaped
// like lib/cpuFallback.ts — dependency-free, node-safe, every
// storage access guarded.
//
// How it works: at boot, if the previous session's "loading" flag
// is still set, that session never reached its survival point —
// it crashed (or the machine died under it, as the iMac did
// during the 2026-11-22 sweep) — so the ladder advances one step
// and this session runs lighter. A session that renders for
// surviveMs, or exits through pagehide, clears the flag without
// advancing. The ladder is a runtime override only: no config
// key, saved setting, or project data is ever written by it.
//
// Ladder: 0 normal / 1 pixel cap / 2 heavy post stages off /
// 3 CPU fallback scene.

import { useSyncExternalStore } from 'react';

export interface SafeModeStep {
  level: number;
  name: string;
  /** Multiplier on the canvas DPR range maximum. */
  pixCap: number;
  post: 'full' | 'reduced';
  fallback: boolean;
}

export const SAFE_MODE_LADDER: readonly SafeModeStep[] = [
  { level: 0, name: 'normal', pixCap: 1.0, post: 'full', fallback: false },
  { level: 1, name: 'pix-cap', pixCap: 0.62, post: 'full', fallback: false },
  { level: 2, name: 'post-off', pixCap: 0.62, post: 'reduced', fallback: false },
  { level: 3, name: 'fallback', pixCap: 0.45, post: 'reduced', fallback: true },
] as const;

export const SAFE_MODE_LEVEL_KEY = 'kalokagathia.safeMode.level';
export const SAFE_MODE_LOADING_KEY = 'kalokagathia.safeMode.loading';
export const SAFE_MODE_SURVIVE_MS = 15000;

export interface SafeModeState {
  level: number;
  crashedLastTime: boolean;
  step: SafeModeStep;
}

interface StorageLike {
  get: (k: string) => string | null;
  set: (k: string, v: string) => void;
}

const localStorageLike: StorageLike = {
  get: (k) => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
    } catch {
      // Storage blocked: the in-memory level still applies.
    }
  },
};

function clampLevel(v: number): number {
  return Math.min(3, Math.max(0, Math.floor(Number.isFinite(v) ? v : 0)));
}

/** Pure ladder machine (the prototype's SafeMode, typed). */
export class SafeMode {
  level: number;

  crashedLastTime = false;

  private s: StorageLike;

  constructor(storage: StorageLike) {
    this.s = storage;
    this.level = clampLevel(+(this.s.get(SAFE_MODE_LEVEL_KEY) || 0) || 0);
  }

  beginLoad(now = Date.now()): SafeModeStep {
    if (this.s.get(SAFE_MODE_LOADING_KEY)) {
      this.crashedLastTime = true;
      if (this.level < 3) {
        this.level += 1;
        this.s.set(SAFE_MODE_LEVEL_KEY, String(this.level));
      }
    }
    this.s.set(SAFE_MODE_LOADING_KEY, String(now));
    return this.step();
  }

  markSurvived(): void {
    this.s.set(SAFE_MODE_LOADING_KEY, '');
  }

  reset(): void {
    this.level = 0;
    this.crashedLastTime = false;
    this.s.set(SAFE_MODE_LEVEL_KEY, '0');
    this.s.set(SAFE_MODE_LOADING_KEY, '');
  }

  step(): SafeModeStep {
    return SAFE_MODE_LADDER[this.level];
  }
}

// --- Runtime store ------------------------------------------------

let machine: SafeMode | null = null;
let state: SafeModeState = {
  level: 0,
  crashedLastTime: false,
  step: SAFE_MODE_LADDER[0],
};
let booted = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

function syncState(): void {
  if (!machine) return;
  state = {
    level: machine.level,
    crashedLastTime: machine.crashedLastTime,
    step: machine.step(),
  };
  emit();
}

/**
 * Boot the ladder exactly once per page load. Called from the
 * root layout's first render (client only). Registers the
 * survival timer and the clean-exit hook.
 */
export function bootSafeMode(): SafeModeState {
  if (booted) return state;
  booted = true;
  if (typeof window === 'undefined') return state;
  machine = new SafeMode(localStorageLike);
  machine.beginLoad();
  syncState();
  window.setTimeout(() => {
    machine?.markSurvived();
  }, SAFE_MODE_SURVIVE_MS);
  window.addEventListener('pagehide', () => {
    machine?.markSurvived();
  });
  return state;
}

export function getSafeModeState(): SafeModeState {
  return state;
}

export function resetSafeMode(): void {
  if (!machine) machine = new SafeMode(localStorageLike);
  machine.reset();
  syncState();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useSafeMode(): SafeModeState {
  return useSyncExternalStore(subscribe, getSafeModeState, getSafeModeState);
}

/** Post stages dropped at ladder level >= 2 (the heavy ones). */
export const SAFE_MODE_HEAVY_POST_STAGES: ReadonlySet<string> = new Set([
  'bloom',
  'light-fx',
  'depth-of-field',
  'motion-blur',
  'radial-blur',
  'kaleidoscope',
  'slit-scan',
  'displace',
  'glitch',
  'pixel-sort',
  'fractal',
  'cellular',
  'moire',
  'feedback',
  'brush-accum',
  'halftone',
]);
