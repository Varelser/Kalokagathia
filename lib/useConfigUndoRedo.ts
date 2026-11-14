import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParticleConfig } from '../types';

/**
 * Global undo/redo for config edits (Wave 2 of the ultimate plan).
 *
 * Why a watcher: every config write in the app — panel `updateConfig`
 * helpers, preset loads, morphs, randomize, imports, the AI tab — ends
 * at the single `setConfig` state in App, but that setter is handed out
 * raw to many hooks and components, so intercepting the setter itself
 * would mean re-plumbing the whole tree. Instead this hook watches the
 * live config (the same proven pattern as the automatic history strip
 * in useConfigHistory) and maintains pointer-style undo/redo stacks:
 *
 * - A change is committed only once the config settles for `settleMs`.
 *   Slider drags and per-frame preset morphs therefore collapse into a
 *   single entry whose "before" is the last committed state — a preset
 *   apply (instant or morph) is exactly one undo step.
 * - While `suspended` is true (sequence playback), config changes are a
 *   performance, not edits: nothing is recorded. When playback stops,
 *   the history re-baselines to whatever config is on screen (the redo
 *   chain is cleared) without inventing an entry for the show itself.
 * - Audio never writes the config per frame (reactivity reads live
 *   levels at render time), so audio toggles are ordinary edits here.
 *
 * Snapshots are JSON deep clones: the config is JSON-persisted by
 * design, and cloning defends against the shallow-spread update style
 * (`{ ...prev, [key]: value }`) that shares nested objects/arrays
 * between successive configs. Restores hand `applyConfig` a fresh
 * clone parsed from the stored JSON, so the live config never aliases
 * a stored snapshot.
 *
 * History is session-local, capped at `maxEntries` undo steps.
 */

const DEFAULT_SETTLE_MS = 500;
const DEFAULT_MAX_ENTRIES = 50;

export interface UseConfigUndoRedoArgs {
  /** Live config to watch. */
  config: ParticleConfig;
  /** Apply a snapshot instantly (App wires stopSequencePlayback + applyConfigInstant). */
  applyConfig: (next: ParticleConfig) => void;
  /** True while sequence playback is driving the config. */
  suspended: boolean;
  settleMs?: number;
  maxEntries?: number;
}

interface ConfigSnapshot {
  config: ParticleConfig;
  /** Cached serialization, used for identity comparisons and fresh-clone restores. */
  json: string;
}

const takeSnapshot = (config: ParticleConfig): ConfigSnapshot => {
  const json = JSON.stringify(config);
  return { config: JSON.parse(json) as ParticleConfig, json };
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.tagName === 'SELECT'
    || target.isContentEditable
  );
};

export function useConfigUndoRedo({
  config,
  applyConfig,
  suspended,
  settleMs = DEFAULT_SETTLE_MS,
  maxEntries = DEFAULT_MAX_ENTRIES,
}: UseConfigUndoRedoArgs) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pastRef = useRef<ConfigSnapshot[]>([]);
  const futureRef = useRef<ConfigSnapshot[]>([]);
  const presentRef = useRef<ConfigSnapshot | null>(null);
  if (presentRef.current === null) {
    presentRef.current = takeSnapshot(config);
  }
  const latestConfigRef = useRef(config);
  const pendingRef = useRef<ParticleConfig | null>(null);
  const timerRef = useRef<number | null>(null);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  const applyConfigRef = useRef(applyConfig);
  applyConfigRef.current = applyConfig;

  useEffect(() => {
    latestConfigRef.current = config;
  }, [config]);

  const syncFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const cancelPending = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  /** Commit the pending (still settling) config as the new present. */
  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || suspendedRef.current) return;
    const present = presentRef.current;
    if (!present) return;
    const next = takeSnapshot(pending);
    if (next.json === present.json) return;
    pastRef.current.push(present);
    if (pastRef.current.length > maxEntries) {
      pastRef.current.splice(0, pastRef.current.length - maxEntries);
    }
    presentRef.current = next;
    futureRef.current = [];
    syncFlags();
  }, [maxEntries, syncFlags]);

  const commitPending = useCallback(() => {
    timerRef.current = null;
    flushPending();
  }, [flushPending]);

  // Watch the live config: schedule a commit once it settles. Changes
  // that merely re-state the present (including our own restores, whose
  // JSON matches the present we set before applying) never schedule.
  useEffect(() => {
    if (suspended) {
      cancelPending();
      return;
    }
    const present = presentRef.current;
    if (!present) return;
    if (JSON.stringify(config) === present.json) {
      cancelPending();
      return;
    }
    pendingRef.current = config;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(commitPending, settleMs);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [cancelPending, commitPending, config, settleMs, suspended]);

  // Re-baseline when suspension (sequence playback) lifts: the config on
  // screen becomes the present without recording the performance, and
  // the redo chain no longer describes this state, so it is cleared.
  const wasSuspendedRef = useRef(suspended);
  useEffect(() => {
    const wasSuspended = wasSuspendedRef.current;
    wasSuspendedRef.current = suspended;
    if (!wasSuspended || suspended) return;
    cancelPending();
    const present = presentRef.current;
    if (!present) return;
    const baseline = takeSnapshot(latestConfigRef.current);
    if (baseline.json !== present.json) {
      presentRef.current = baseline;
      futureRef.current = [];
      syncFlags();
    }
  }, [cancelPending, suspended, syncFlags]);

  const undo = useCallback(() => {
    // A still-settling edit is committed first, so undo steps back over
    // it instead of silently discarding it.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    flushPending();
    const previous = pastRef.current.pop();
    const present = presentRef.current;
    if (!previous || !present) return;
    futureRef.current.push(present);
    presentRef.current = previous;
    syncFlags();
    // Fresh clone: the live config must never alias the stored snapshot.
    applyConfigRef.current(JSON.parse(previous.json) as ParticleConfig);
  }, [flushPending, syncFlags]);

  const redo = useCallback(() => {
    // A fresh (still settling) edit invalidates the redo chain; flushing
    // it first makes redo a correct no-op in that case.
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    flushPending();
    const next = futureRef.current.pop();
    const present = presentRef.current;
    if (!next || !present) return;
    pastRef.current.push(present);
    if (pastRef.current.length > maxEntries) {
      pastRef.current.splice(0, pastRef.current.length - maxEntries);
    }
    presentRef.current = next;
    syncFlags();
    applyConfigRef.current(JSON.parse(next.json) as ParticleConfig);
  }, [flushPending, maxEntries, syncFlags]);

  // Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z and Ctrl+Y redo.
  // Never hijack the shortcuts while the user is typing in a field
  // (the browser's own text undo must win there).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.metaKey)) {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  return { canRedo, canUndo, redo, undo };
}
