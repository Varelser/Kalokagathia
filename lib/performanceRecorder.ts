import type { ParticleConfig } from '../types';

/**
 * Performance recording (roadmap Phase 8D, record/scrub slice).
 *
 * Records a live performance — macro moves, XY pad gestures, MIDI
 * input, preset changes — as a base config plus a timeline of
 * per-key diffs, so a take stays small even though a full config
 * is large. Playback (and scrubbing) reconstructs the config at
 * any timestamp by folding the diffs onto the base.
 *
 * A "frame" is only stored when at least one key changed since
 * the previous sample. Seed determinism of the particle
 * simulation itself is out of scope: this records the *control*
 * timeline, which is what a performer actually does.
 */

export interface PerformanceFrame {
  /** Milliseconds from the start of the take. */
  t: number;
  changes: Partial<ParticleConfig>;
}

export interface PerformanceTake {
  base: ParticleConfig;
  frames: PerformanceFrame[];
  durationMs: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? '';
  return JSON.stringify(value) ?? '';
}

/** Per-key diff between two configs (JSON equality per key). */
export function diffConfigs(
  prev: ParticleConfig,
  next: ParticleConfig,
): Partial<ParticleConfig> {
  const changes: Partial<ParticleConfig> = {};
  const record = changes as Record<string, unknown>;
  const prevRecord = prev as unknown as Record<string, unknown>;
  const nextRecord = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(nextRecord)) {
    if (stableStringify(prevRecord[key]) !== stableStringify(nextRecord[key])) {
      record[key] = nextRecord[key];
    }
  }
  return changes;
}

export class PerformanceRecorder {
  private base: ParticleConfig;
  private lastSample: ParticleConfig;
  private frames: PerformanceFrame[] = [];

  constructor(base: ParticleConfig) {
    this.base = base;
    this.lastSample = base;
  }

  /** Sample the live config at time `t` (ms). Returns true when a frame was stored. */
  sample(config: ParticleConfig, t: number): boolean {
    const changes = diffConfigs(this.lastSample, config);
    this.lastSample = config;
    if (Object.keys(changes).length === 0) return false;
    this.frames.push({ t, changes });
    return true;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  finish(durationMs: number): PerformanceTake {
    return { base: this.base, frames: this.frames, durationMs };
  }
}

/** Reconstruct the config at time `t` (all frames with frame.t <= t applied). */
export function reconstructAt(take: PerformanceTake, t: number): ParticleConfig {
  let config = take.base;
  for (const frame of take.frames) {
    if (frame.t > t) break;
    config = { ...config, ...frame.changes };
  }
  return config;
}

/** Index of the last frame at or before `t`, or -1 when none applies yet. */
export function frameIndexAt(take: PerformanceTake, t: number): number {
  let index = -1;
  for (let i = 0; i < take.frames.length; i++) {
    if (take.frames[i].t <= t) index = i;
    else break;
  }
  return index;
}

/**
 * Interpolated reconstruction: numeric keys lerp between the surrounding
 * keyframes instead of jumping at them; non-numeric keys step at their
 * keyframe (same as reconstructAt). Used for smooth playback and for the
 * deterministic export, where each rendered frame samples the take at
 * exactly that frame's timestamp.
 */
export function reconstructInterpolatedAt(take: PerformanceTake, t: number): ParticleConfig {
  const stepped = reconstructAt(take, t);
  const index = frameIndexAt(take, t);
  if (index < 0 || index >= take.frames.length - 1) return stepped;
  const current = take.frames[index];
  const next = take.frames[index + 1];
  if (next.t <= current.t) return stepped;
  const span = next.t - current.t;
  const mix = Math.min(1, Math.max(0, (t - current.t) / span));
  if (mix <= 0) return stepped;
  // Value of every key at `current` (after folding), then lerp numerics
  // toward the value the next frame will set.
  const out: Record<string, unknown> = { ...(stepped as unknown as Record<string, unknown>) };
  const nextChanges = next.changes as Record<string, unknown>;
  Object.keys(nextChanges).forEach((key) => {
    const from = out[key];
    const to = nextChanges[key];
    if (typeof from === 'number' && typeof to === 'number') {
      out[key] = from + (to - from) * mix;
    }
  });
  return out as unknown as ParticleConfig;
}

/** Remove one frame (timeline editing). Returns a new take. */
export function deleteTakeFrame(take: PerformanceTake, index: number): PerformanceTake {
  return { ...take, frames: take.frames.filter((_, i) => i !== index) };
}

/** Move one frame to a new timestamp (clamped, re-sorted). Returns a new take. */
export function shiftTakeFrame(take: PerformanceTake, index: number, newT: number): PerformanceTake {
  const frames = take.frames.map((frame, i) =>
    i === index ? { ...frame, t: Math.max(0, Math.min(take.durationMs, Math.round(newT))) } : frame,
  );
  frames.sort((a, b) => a.t - b.t);
  return { ...take, frames };
}

/** Serialise a take for export (JSON file / storage). */
export function serializeTake(take: PerformanceTake): string {
  return JSON.stringify({ kind: 'kalokagathia-performance-take', version: 1, take });
}

/** Parse + validate a serialised take. Returns null when invalid. */
export function parseTake(json: string): PerformanceTake | null {
  try {
    const data = JSON.parse(json) as { kind?: string; take?: PerformanceTake };
    if (data.kind !== 'kalokagathia-performance-take' || !data.take) return null;
    const take = data.take;
    if (!take.base || !Array.isArray(take.frames) || typeof take.durationMs !== 'number') return null;
    if (!take.frames.every((f) => typeof f.t === 'number' && f.changes && typeof f.changes === 'object')) return null;
    return take;
  } catch {
    return null;
  }
}
