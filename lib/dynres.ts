// Dynamic resolution for the LIVE view (Phase CX).
//
// Until now the canvas DPR came from getAdaptiveDprRange()
// (components/AppSceneCameraRig.tsx): a STATIC cap derived from the
// config's performance score — R3F clamps the device pixel ratio into
// that range once, and nothing ever reacts to how fast the machine
// actually renders. This module adds the measured feedback loop
// (adapted from the Abyssal Garden transfer experiment,
// ~/workspace/abyssal-transfer-lab): average the frame time over a
// period, and when the average sits outside the target band, move the
// DPR — down only after TWO consecutive slow periods, back up only
// after a wait that doubles with every downgrade, so the loop settles
// instead of oscillating. WebGL exposes no portable GPU timer here, so
// this uses the frame-time path (the original's no-GPU-timing
// fallback) with the same constants.
//
// Settled values are remembered per PERFORMANCE SIGNATURE (render
// quality + bucketed performance score + GPGPU toggle), not per
// preset id: a preset apply replaces the whole config, and configs
// with similar heaviness share a signature, while slider tweaks that
// do not move the bucket never churn the key. The store is plain
// localStorage, capped at 64 signatures; it is NOT a config key and
// never enters presets, project files or exports.
//
// Hard boundaries:
// - Deterministic renders never see this: the controller component
//   stops feeding while the camera determinism lock is held (the lock
//   the DeterministicRenderManager holds for the whole job), and the
//   export path renders offscreen at the job's own resolution anyway.
// - The DPR never leaves the existing getAdaptiveDprRange() range for
//   the current config, so the static cap stays the outer contract.
// - Canvas resizes are expensive: a new DPR is only APPLIED when it
//   differs from the applied one by >= 0.02, and at most once per
//   measurement period (~0.9 s at 60 fps).

import type { ParticleConfig } from '../types';
import { getConfigPerformanceScore } from './performanceHints';

export const DYNRES_STORAGE_KEY = 'kalokagathia.dynres.v1';
export const DYNRES_MAX_SIGNATURES = 64;
export const DYNRES_PERIOD_FRAMES = 54;
export const DYNRES_WARMUP_PERIODS = 2;
export const DYNRES_SLOW_MS = 17.6;
export const DYNRES_FAST_MS = 12.5;
export const DYNRES_TARGET_MS = 15;
export const DYNRES_APPLY_EPSILON = 0.02;

/** Signature under which a settled DPR is remembered. Bucketed so
 *  that trivial slider movement does not churn the key. */
export function dynResSignature(config: ParticleConfig): string {
  const score = getConfigPerformanceScore(config);
  const bucket = Math.min(12, Math.round(score * 2) / 2).toFixed(1);
  return `${config.renderQuality}|s${bucket}|g${config.gpgpuEnabled ? 1 : 0}`;
}

export interface DynResStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): DynResStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadDynResSettled(storage: DynResStorage | null = defaultStorage()): Record<string, number> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DYNRES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 4) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveDynResSettled(
  signature: string,
  dpr: number,
  storage: DynResStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    const map = loadDynResSettled(storage);
    delete map[signature]; // re-insert: most-recently-settled last
    map[signature] = dpr;
    const keys = Object.keys(map);
    while (keys.length > DYNRES_MAX_SIGNATURES) {
      const oldest = keys.shift()!;
      delete map[oldest];
    }
    storage.setItem(DYNRES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage full / unavailable: the loop simply starts from the
    // range maximum next visit, exactly the pre-CX behaviour.
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const quantize = (v: number) => Math.round(v * 100) / 100;

export class DynResController {
  private range: [number, number];
  /** Continuous internal target; `applied` is what the canvas runs at. */
  private target: number;
  applied: number;
  private samples = 0;
  private timeSum = 0;
  private warmupPeriods = DYNRES_WARMUP_PERIODS;
  private badPeriods = 0;
  private goodPeriods = 0;
  private waitPeriods = 3;

  constructor(range: [number, number], initialDpr: number) {
    this.range = range;
    this.target = clamp(initialDpr, range[0], range[1]);
    this.applied = quantize(this.target);
  }

  /** Retarget on a signature / range change: start from the restored
   *  settled value when one exists, else from the current applied DPR
   *  clamped into the new range. Counters and warmup restart. */
  retarget(range: [number, number], restoredDpr: number | null): void {
    this.range = range;
    this.target = clamp(restoredDpr ?? this.applied, range[0], range[1]);
    // A restored settled value is applied immediately by the caller;
    // without one, the applied DPR only moves if the new range
    // excludes it.
    this.applied = quantize(restoredDpr !== null ? this.target : clamp(this.applied, range[0], range[1]));
    this.samples = 0;
    this.timeSum = 0;
    this.warmupPeriods = DYNRES_WARMUP_PERIODS;
    this.badPeriods = 0;
    this.goodPeriods = 0;
    this.waitPeriods = 3;
  }

  /** Adopt a DPR that was applied to the canvas externally before
   *  this controller took authority (e.g. R3F resolving the dpr
   *  prop during boot): the core's premise is "start from the
   *  current applied DPR", so an external value that predates the
   *  first decision becomes the starting point instead of being
   *  fought. Counters are untouched. */
  syncApplied(dpr: number): void {
    this.target = clamp(dpr, this.range[0], this.range[1]);
    this.applied = quantize(this.target);
  }

  /** Feed one rendered frame's delta (ms). Returns the DPR to apply
   *  when — and only when — the applied value should change. */
  feed(frameMs: number): number | null {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return null; // tab-switch hiccups are not load
    this.samples += 1;
    this.timeSum += frameMs;
    if (this.samples < DYNRES_PERIOD_FRAMES) return null;
    const avg = this.timeSum / this.samples;
    this.samples = 0;
    this.timeSum = 0;
    if (this.warmupPeriods > 0) {
      this.warmupPeriods -= 1;
      return null;
    }
    if (avg > DYNRES_SLOW_MS) {
      this.goodPeriods = 0;
      this.badPeriods += 1;
      if (this.badPeriods >= 2) {
        this.badPeriods = 0;
        const factor = clamp(Math.sqrt(DYNRES_TARGET_MS / avg), 0.6, 0.95);
        this.target = clamp(this.target * factor, this.range[0], this.range[1]);
        this.waitPeriods = Math.min(this.waitPeriods * 2, 12);
      }
    } else if (avg < DYNRES_FAST_MS) {
      this.badPeriods = 0;
      this.goodPeriods += 1;
      if (this.goodPeriods > this.waitPeriods) {
        this.goodPeriods = 0;
        const factor = Math.min(1.15, Math.sqrt(DYNRES_TARGET_MS / avg));
        this.target = clamp(this.target * factor, this.range[0], this.range[1]);
      }
    } else {
      this.badPeriods = 0;
      this.goodPeriods = 0;
    }
    const candidate = quantize(this.target);
    if (Math.abs(candidate - this.applied) >= DYNRES_APPLY_EPSILON) {
      this.applied = candidate;
      return candidate;
    }
    return null;
  }
}
