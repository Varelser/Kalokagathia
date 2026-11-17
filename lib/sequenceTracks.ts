import React from 'react';
import type { ParticleConfig, PresetSequenceItem, SequenceTransitionEasing } from '../types';
import { PARAMETER_CATALOG, type ParameterCatalogEntry } from './parameterCatalog';
import { applyTransitionEasing } from './appStateInterpolation';

/**
 * Sequence tracks (Phase AN): time-axis keyframe tracks over numeric
 * config keys, layered on top of the preset-sequence playback.
 *
 * Design invariants (PHASE_AN_BRIEF):
 * - Tracks live in their own setup, persisted under an independent
 *   localStorage key — the same pattern as the modulation setup
 *   (Phase AC/AJ). The persisted presetSequence shape, keyframeConfig
 *   and the interpolation machinery are never touched.
 * - Tracks are applied ONLY while a sequence is playing, and ONLY in
 *   the effective-config layer (useAppSceneTemporalConfig, after
 *   modulation). Config state is never written, so track overrides
 *   cannot fight applyConfigMorph's rAF loop.
 * - With an empty track set the evaluation is never called and the
 *   effective config is the legacy path verbatim — identity by
 *   construction, verified on the real-GPU gate.
 * - Evaluation is a pure function of (tracks, time): the sequence
 *   clock (below) is anchored at segment seams so a deterministic
 *   render / unit test can reproduce every value exactly.
 */

/* ---------------- data model ---------------- */

export interface SequenceTrackKeyframe {
  /** Absolute time within one sequence pass, seconds. */
  time: number;
  value: number;
  /** Easing used when interpolating TOWARD this keyframe. */
  easing: SequenceTransitionEasing;
}

export interface SequenceTrack {
  id: string;
  key: keyof ParticleConfig;
  keyframes: SequenceTrackKeyframe[];
}

export const SEQUENCE_TRACKS_STORAGE_KEY = 'kalokagathia.sequenceTracks.v1';
export const MAX_SEQUENCE_TRACKS = 16;
export const MAX_SEQUENCE_TRACK_KEYFRAMES = 64;
/** Sanitize cap when the caller does not know the pass duration. */
export const MAX_SEQUENCE_TRACK_TIME = 86400;

const SEQUENCE_TRACK_EASINGS: SequenceTransitionEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

/* ---------------- trackable key catalog ---------------- */

/**
 * The trackable keys are the numeric PARAMETER_CATALOG entries, plus
 * the camera keys the View panel drives directly (they never entered
 * the catalog because the Play tab search has no sliders for them).
 * Ranges for the supplements come from the actual panel controls:
 * cameraDistance is the Global Display slider (0..5000, step 10);
 * manualRotation* are radian angles set to 0 / PI/2 by the view
 * buttons, so their domain is -PI..PI.
 */
const SUPPLEMENTARY_TRACK_ENTRIES: ParameterCatalogEntry[] = [
  { key: 'cameraDistance', label: 'Camera Distance (3D)', tab: 'global', min: 0, max: 5000, step: 10 },
  { key: 'manualRotationX', label: 'Manual Rotation X', tab: 'global', min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: 'manualRotationY', label: 'Manual Rotation Y', tab: 'global', min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: 'manualRotationZ', label: 'Manual Rotation Z', tab: 'global', min: -Math.PI, max: Math.PI, step: 0.01 },
];

const TRACK_ENTRY_BY_KEY = new Map<keyof ParticleConfig, ParameterCatalogEntry>();
for (const entry of PARAMETER_CATALOG) {
  if (!TRACK_ENTRY_BY_KEY.has(entry.key)) TRACK_ENTRY_BY_KEY.set(entry.key, entry);
}
for (const entry of SUPPLEMENTARY_TRACK_ENTRIES) {
  if (!TRACK_ENTRY_BY_KEY.has(entry.key)) TRACK_ENTRY_BY_KEY.set(entry.key, entry);
}

export const SEQUENCE_TRACK_CATALOG: ParameterCatalogEntry[] = [...TRACK_ENTRY_BY_KEY.values()]
  .sort((a, b) => a.label.localeCompare(b.label));

export function getSequenceTrackEntry(key: keyof ParticleConfig): ParameterCatalogEntry | null {
  return TRACK_ENTRY_BY_KEY.get(key) ?? null;
}

export function createSequenceTrackId(): string {
  return `seqtrack-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------- sanitize / persistence ---------------- */

const clampNumber = (value: unknown, min: number, max: number, fallbackValue: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallbackValue;

function sanitizeKeyframe(raw: unknown, entry: ParameterCatalogEntry, timeCap: number): SequenceTrackKeyframe | null {
  if (!raw || typeof raw !== 'object') return null;
  const kf = raw as Partial<SequenceTrackKeyframe>;
  if (typeof kf.time !== 'number' || !Number.isFinite(kf.time)) return null;
  if (typeof kf.value !== 'number' || !Number.isFinite(kf.value)) return null;
  return {
    time: Math.min(timeCap, Math.max(0, kf.time)),
    value: clampNumber(kf.value, entry.min, entry.max, entry.min),
    easing: SEQUENCE_TRACK_EASINGS.includes(kf.easing as SequenceTransitionEasing)
      ? (kf.easing as SequenceTransitionEasing)
      : 'linear',
  };
}

/**
 * Normalize an untrusted payload into a valid track set. Keys must
 * exist in the track catalog; values are clamped to the catalog
 * range; keyframes are sorted by time with same-time duplicates
 * collapsed (last one wins). One track per key — later duplicates
 * are dropped. Broken payloads fall back to the empty set.
 */
export function sanitizeSequenceTracks(raw: unknown, timeCapSeconds: number = MAX_SEQUENCE_TRACK_TIME): SequenceTrack[] {
  if (!Array.isArray(raw)) return [];
  const timeCap = typeof timeCapSeconds === 'number' && Number.isFinite(timeCapSeconds) && timeCapSeconds > 0
    ? timeCapSeconds
    : MAX_SEQUENCE_TRACK_TIME;
  const seenKeys = new Set<keyof ParticleConfig>();
  const tracks: SequenceTrack[] = [];
  for (const rawTrack of raw) {
    if (tracks.length >= MAX_SEQUENCE_TRACKS) break;
    if (!rawTrack || typeof rawTrack !== 'object') continue;
    const track = rawTrack as Partial<SequenceTrack>;
    const key = track.key as keyof ParticleConfig;
    const entry = typeof key === 'string' ? TRACK_ENTRY_BY_KEY.get(key) : undefined;
    if (!entry || seenKeys.has(key)) continue;
    seenKeys.add(key);
    const rawKeyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
    const sanitized = rawKeyframes
      .map((kf) => sanitizeKeyframe(kf, entry, timeCap))
      .filter((kf): kf is SequenceTrackKeyframe => kf !== null);
    // Sort by time (stable) and collapse same-time keyframes, last wins.
    const sorted = sanitized
      .map((kf, index) => ({ kf, index }))
      .sort((a, b) => (a.kf.time - b.kf.time) || (a.index - b.index))
      .map(({ kf }) => kf);
    const collapsed: SequenceTrackKeyframe[] = [];
    for (const kf of sorted) {
      const last = collapsed[collapsed.length - 1];
      if (last && last.time === kf.time) collapsed[collapsed.length - 1] = kf;
      else collapsed.push(kf);
    }
    tracks.push({
      id: typeof track.id === 'string' && track.id.length > 0 ? track.id : createSequenceTrackId(),
      key,
      keyframes: collapsed.slice(0, MAX_SEQUENCE_TRACK_KEYFRAMES),
    });
  }
  return tracks;
}

export function loadSequenceTracks(storage: Pick<Storage, 'getItem'> | undefined): SequenceTrack[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SEQUENCE_TRACKS_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeSequenceTracks(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function saveSequenceTracks(storage: Pick<Storage, 'setItem'>, tracks: SequenceTrack[]): void {
  try {
    storage.setItem(SEQUENCE_TRACKS_STORAGE_KEY, JSON.stringify(tracks));
  } catch {
    // Storage full/blocked: the tracks simply won't persist.
  }
}

/* ---------------- shared store (editor <-> scene) ---------------- */

let currentTracks: SequenceTrack[] | null = null;
const trackListeners = new Set<() => void>();

function ensureTracks(): SequenceTrack[] {
  if (!currentTracks) {
    currentTracks = loadSequenceTracks(typeof window !== 'undefined' ? window.localStorage : undefined);
  }
  return currentTracks;
}

export function getSequenceTracks(): SequenceTrack[] {
  return ensureTracks();
}

export function setSequenceTracks(next: SequenceTrack[]): void {
  currentTracks = sanitizeSequenceTracks(next);
  if (typeof window !== 'undefined') saveSequenceTracks(window.localStorage, currentTracks);
  trackListeners.forEach((listener) => listener());
}

export function subscribeSequenceTracks(listener: () => void): () => void {
  trackListeners.add(listener);
  return () => {
    trackListeners.delete(listener);
  };
}

export function useSequenceTracks(): SequenceTrack[] {
  return React.useSyncExternalStore(subscribeSequenceTracks, getSequenceTracks, getSequenceTracks);
}

/* ---------------- mutations (pure; UI calls setSequenceTracks) ---------------- */

export function addSequenceTrack(tracks: SequenceTrack[], key: keyof ParticleConfig, keyframe: SequenceTrackKeyframe): SequenceTrack[] {
  if (tracks.some((track) => track.key === key)) return tracks;
  return sanitizeSequenceTracks([...tracks, { id: createSequenceTrackId(), key, keyframes: [keyframe] }]);
}

export function removeSequenceTrack(tracks: SequenceTrack[], trackId: string): SequenceTrack[] {
  return tracks.filter((track) => track.id !== trackId);
}

export function upsertSequenceKeyframe(tracks: SequenceTrack[], trackId: string, keyframe: SequenceTrackKeyframe): SequenceTrack[] {
  return sanitizeSequenceTracks(tracks.map((track) => (
    track.id === trackId ? { ...track, keyframes: [...track.keyframes, keyframe] } : track
  )));
}

export function updateSequenceKeyframe(
  tracks: SequenceTrack[],
  trackId: string,
  keyframeIndex: number,
  patch: Partial<SequenceTrackKeyframe>,
): SequenceTrack[] {
  return sanitizeSequenceTracks(tracks.map((track) => (
    track.id === trackId
      ? { ...track, keyframes: track.keyframes.map((kf, index) => (index === keyframeIndex ? { ...kf, ...patch } : kf)) }
      : track
  )));
}

export function removeSequenceKeyframe(tracks: SequenceTrack[], trackId: string, keyframeIndex: number): SequenceTrack[] {
  return sanitizeSequenceTracks(tracks.map((track) => (
    track.id === trackId ? { ...track, keyframes: track.keyframes.filter((_, index) => index !== keyframeIndex) } : track
  )));
}

/* ---------------- evaluation (pure) ---------------- */

/** Value of one track at an absolute pass time; null when the track has no keyframes. */
export function evaluateSequenceTrack(track: SequenceTrack, time: number): number | null {
  const keyframes = track.keyframes;
  if (keyframes.length === 0) return null;
  const first = keyframes[0];
  if (keyframes.length === 1 || time <= first.time) return first.value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 1; i < keyframes.length; i++) {
    const next = keyframes[i];
    if (time <= next.time) {
      const prev = keyframes[i - 1];
      const span = next.time - prev.time;
      const progress = span > 0 ? (time - prev.time) / span : 1;
      const eased = applyTransitionEasing(Math.min(1, Math.max(0, progress)), next.easing);
      return prev.value + (next.value - prev.value) * eased;
    }
  }
  return last.value;
}

export function evaluateSequenceTracks(
  tracks: SequenceTrack[],
  time: number,
  baseConfig: ParticleConfig,
): Partial<ParticleConfig> {
  const overrides: Partial<ParticleConfig> = {};
  for (const track of tracks) {
    const value = evaluateSequenceTrack(track, time);
    if (value === null) continue;
    if (typeof baseConfig[track.key] !== 'number') continue;
    (overrides as Record<string, unknown>)[track.key as string] = value;
  }
  return overrides;
}

/**
 * Apply track overrides on top of a config. Returns the SAME object
 * when no track produces an override, so callers keep reference
 * identity on the legacy path.
 */
export function applySequenceTracks(config: ParticleConfig, tracks: SequenceTrack[], time: number): ParticleConfig {
  const overrides = evaluateSequenceTracks(tracks, time, config);
  if (Object.keys(overrides).length === 0) return config;
  return { ...config, ...overrides };
}

/* ---------------- sequence clock (pure seam math + shared store) ---------------- */

/** Duration of one item's segment in the pass timeline: its incoming transition (0 for item 0) plus its hold. */
export function getSequenceSegmentDuration(items: PresetSequenceItem[], index: number): number {
  const item = items[index];
  if (!item) return 0;
  return (index === 0 ? 0 : Math.max(0, item.transitionSeconds)) + Math.max(0, item.holdSeconds);
}

/** Absolute pass time at which item `index`'s segment starts (its incoming morph begins). */
export function getSequenceItemStartTime(items: PresetSequenceItem[], index: number): number {
  let total = 0;
  for (let i = 0; i < index && i < items.length; i++) {
    total += getSequenceSegmentDuration(items, i);
  }
  return total;
}

/**
 * The pass time for a playback position described as (active item,
 * phase, elapsed within the phase). During the transition phase the
 * position sits at the head of the item's segment; during hold it
 * sits after the incoming transition. This is the pure seam function
 * the clock anchors are built from.
 */
export function sequenceTimeAtPosition(
  items: PresetSequenceItem[],
  activeIndex: number,
  phase: 'transition' | 'hold',
  phaseElapsedSeconds: number,
): number {
  if (activeIndex < 0 || activeIndex >= items.length) return 0;
  const item = items[activeIndex];
  const transition = activeIndex === 0 ? 0 : Math.max(0, item.transitionSeconds);
  const base = getSequenceItemStartTime(items, activeIndex) + (phase === 'hold' ? transition : 0);
  return base + Math.max(0, phaseElapsedSeconds);
}

/**
 * Clock anchor (pass time) at the moment item `index` becomes the
 * morph target: its segment start. The loop wrap (index 0 reached
 * from the last item) anchors at -transitionSeconds so the published
 * time, wrapped by the pass duration, runs continuously from the
 * previous pass's tail.
 */
export function getSequenceClockAnchor(items: PresetSequenceItem[], index: number, isLoopWrap: boolean): number {
  if (index <= 0) {
    if (!isLoopWrap) return 0;
    return -Math.max(0, items[0]?.transitionSeconds ?? 0);
  }
  return getSequenceItemStartTime(items, index);
}

/** Wrap a raw clock reading into the pass timeline (negative readings count from the pass tail). */
export function wrapSequenceClockTime(rawTime: number, passDurationSeconds: number): number {
  if (rawTime < 0 && passDurationSeconds > 0) return rawTime + passDurationSeconds;
  return rawTime;
}

let currentClockTime = 0;
let clockRunning = false;
const clockListeners = new Set<() => void>();

export function getSequenceClockTime(): number {
  return currentClockTime;
}

export function isSequenceClockRunning(): boolean {
  return clockRunning;
}

/** Publish a clock reading (called by the playback driver, throttled to ~50ms there). */
export function setSequenceClockTime(time: number, running: boolean): void {
  const next = Number.isFinite(time) ? time : 0;
  if (next === currentClockTime && running === clockRunning) return;
  currentClockTime = next;
  clockRunning = running;
  clockListeners.forEach((listener) => listener());
}

export function subscribeSequenceClock(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
  };
}

export function useSequenceClockTime(): number {
  return React.useSyncExternalStore(subscribeSequenceClock, getSequenceClockTime, getSequenceClockTime);
}
