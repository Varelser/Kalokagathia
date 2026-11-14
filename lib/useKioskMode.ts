import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParticleConfig, PresetLibraryData, PresetRecord, PresetSequenceItem, SequenceTransitionEasing } from '../types';
import { PUBLIC_PRESET_LIBRARY } from './appState';
import { isStarterPresetSequence } from './lazyStarterLibrary';
import { isWakeLockSupported } from './platformFeatures';
import { getSequenceItemResolvedConfig } from './sequenceEditing';
import { useStorageHydrated } from './storageDb';
import {
  KIOSK_HINT_VISIBLE_MS,
  KIOSK_RESUME_DELAY_MS,
  buildKioskExitUrl,
  buildKioskRotation,
} from './kioskMode';

// Kiosk mode (ultimate Wave 5): see lib/kioskMode.ts for the mode
// contract. This hook owns the attract loop while ?kiosk=1 is active
// and is a complete no-op otherwise (App calls it unconditionally).
//
// Rotation engine: a private timeout chain whose every step resolves
// the next item with the sequence system's own
// getSequenceItemResolvedConfig and transitions with applyConfigMorph
// — the same morph verb advanceSequencePlayback uses, with the item's
// transitionSeconds / transitionEasing. The shared sequence state
// machine is intentionally NOT driven: its state persists to storage,
// and kiosk pacing must never leak into the visitor's saved sequence
// (see kioskMode.ts). Consequences, stated plainly: the deck's
// sequence progress / active-item highlighting does not move in kiosk
// (nothing of the deck is mounted anyway), and the step progress
// reported here is computed locally for AppScene's sequence drive.

type ApplyConfigMorph = (
  targetConfig: ParticleConfig,
  durationSeconds: number,
  nextPresetId?: string | null,
  easing?: SequenceTransitionEasing,
) => boolean;

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
};

export type UseKioskModeArgs = {
  active: boolean;
  activePresetId: string | null;
  applyConfigMorph: ApplyConfigMorph;
  isPublicLibraryMode: boolean;
  presetSequence: PresetSequenceItem[];
  presets: PresetRecord[];
  starterLibrary: PresetLibraryData | null;
};

export function useKioskMode({
  active,
  activePresetId,
  applyConfigMorph,
  isPublicLibraryMode,
  presetSequence,
  presets,
  starterLibrary,
}: UseKioskModeArgs) {
  const [hintVisible, setHintVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rotationReady, setRotationReady] = useState(false);
  const [stepProgress, setStepProgress] = useState(0);

  // Private mode must wait for IndexedDB hydration: the visitor's own
  // sequence may only arrive with the fill-in, and preferring it over
  // the default rotation depends on seeing the settled sequence.
  const storageHydrated = useStorageHydrated(active && !isPublicLibraryMode);

  const rotationRef = useRef<PresetSequenceItem[]>([]);
  const currentIndexRef = useRef(0);
  const advanceTimerRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const hintTimerRef = useRef<number | null>(null);
  const stepStartedAtRef = useRef<number | null>(null);
  const progressFrameRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const lastMoveHandledRef = useRef(0);
  const fullscreenRequestedRef = useRef(false);
  const wakeLockSentinelRef = useRef<WakeLockSentinelLike | null>(null);

  // Latest-value refs so the timer chain never needs re-arming when App
  // re-renders with fresh arrays/callbacks.
  const applyConfigMorphRef = useRef(applyConfigMorph);
  applyConfigMorphRef.current = applyConfigMorph;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;
  const activePresetIdRef = useRef(activePresetId);
  activePresetIdRef.current = activePresetId;

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    const sentinel = wakeLockSentinelRef.current;
    wakeLockSentinelRef.current = null;
    if (sentinel && !sentinel.released) {
      void sentinel.release().catch(() => { /* already released */ });
    }
  }, []);

  const exitKiosk = useCallback(() => {
    releaseWakeLock();
    window.location.replace(buildKioskExitUrl(window.location));
  }, [releaseWakeLock]);

  // ---- rotation chain -------------------------------------------------

  const scheduleAdvanceRef = useRef<() => void>(() => {});

  const advance = useCallback(() => {
    const rotation = rotationRef.current;
    if (rotation.length === 0) return;
    // Prefer following the actually-applied preset (a #p= share start
    // or a keyframe step can move us off the tracked index).
    const appliedIndex = rotation.findIndex((item) => item.presetId === activePresetIdRef.current);
    const baseIndex = appliedIndex >= 0 ? appliedIndex : currentIndexRef.current;
    // Try each following item until one resolves (a preset can vanish
    // from the library mid-session only via edits the kiosk UI never
    // offers, so this is just belt-and-braces against a dead step).
    for (let step = 1; step <= rotation.length; step += 1) {
      const nextIndex = (baseIndex + step) % rotation.length;
      const item = rotation[nextIndex];
      if (!item) continue;
      const resolved = getSequenceItemResolvedConfig(item, presetsRef.current);
      if (!resolved) continue;
      currentIndexRef.current = nextIndex;
      applyConfigMorphRef.current(
        resolved,
        item.transitionSeconds,
        item.keyframeConfig ? null : item.presetId,
        item.transitionEasing,
      );
      stepStartedAtRef.current = performance.now();
      setStepProgress(0);
      scheduleAdvanceRef.current();
      return;
    }
  }, []);

  const scheduleAdvance = useCallback(() => {
    clearAdvanceTimer();
    if (pausedRef.current) return;
    const item = rotationRef.current[currentIndexRef.current];
    if (!item) return;
    stepStartedAtRef.current = stepStartedAtRef.current ?? performance.now();
    advanceTimerRef.current = window.setTimeout(() => {
      advanceTimerRef.current = null;
      advance();
    }, Math.max(200, item.holdSeconds * 1000));
  }, [advance, clearAdvanceTimer]);
  scheduleAdvanceRef.current = scheduleAdvance;

  // Build the rotation once the library/sequence picture has settled,
  // then start the chain. The boot scene (default config, or the #p=
  // share preset the App share effect applies) is simply the first
  // shown piece: nothing is applied here, the first advance happens
  // after the current item's hold.
  useEffect(() => {
    if (!active || rotationRef.current.length > 0) return;
    if (!isPublicLibraryMode && (!starterLibrary || !storageHydrated)) return;

    const referenceSequence = isPublicLibraryMode
      ? PUBLIC_PRESET_LIBRARY.presetSequence
      : (starterLibrary?.presetSequence ?? []);
    const isReferenceSequence = presetSequence.length === referenceSequence.length
      && presetSequence.every((item, index) => item.id === referenceSequence[index]?.id);
    // In private mode the starter-identity helper is authoritative when
    // the starter library is present (same check the persist path uses).
    const isStarter = !isPublicLibraryMode && starterLibrary
      ? isStarterPresetSequence(presetSequence, starterLibrary)
      : isReferenceSequence;
    const userSequence = presetSequence.length > 0 && !isStarter ? presetSequence : null;

    const rotation = buildKioskRotation({
      userSequence,
      starterSequence: referenceSequence,
      availablePresetIds: new Set(presets.map((preset) => preset.id)),
    });
    if (rotation.length === 0) return;

    rotationRef.current = rotation;
    const startIndex = rotation.findIndex((item) => item.presetId === activePresetIdRef.current);
    currentIndexRef.current = startIndex >= 0 ? startIndex : 0;
    stepStartedAtRef.current = performance.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time mode activation flag: the player switches from a static boot scene to the rotating attract loop in this commit.
    setRotationReady(true);
    scheduleAdvance();
  }, [active, isPublicLibraryMode, presetSequence, presets, scheduleAdvance, starterLibrary, storageHydrated]);

  // Step progress for AppScene's sequence drive (mirrors the rAF loop
  // in useSequencePlayback, scoped to the current rotation item).
  useEffect(() => {
    if (!active || !rotationReady || paused) return undefined;
    const tick = (now: number) => {
      const item = rotationRef.current[currentIndexRef.current];
      if (item && stepStartedAtRef.current !== null) {
        const holdMs = Math.max(200, item.holdSeconds * 1000);
        setStepProgress(Math.min(1, Math.max(0, (now - stepStartedAtRef.current) / holdMs)));
      }
      progressFrameRef.current = requestAnimationFrame(tick);
    };
    progressFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressFrameRef.current !== null) {
        cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
    };
  }, [active, rotationReady, paused]);

  // ---- interaction: hint, pause/resume, fullscreen, exit --------------

  useEffect(() => {
    if (!active) return undefined;

    const showHint = () => {
      setHintVisible(true);
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = window.setTimeout(() => {
        hintTimerRef.current = null;
        setHintVisible(false);
      }, KIOSK_HINT_VISIBLE_MS);
    };
    // Boot hint: the exhibitor sees how to exit once, briefly (the same
    // courtesy cinema mode extends), then the canvas is clean.
    showHint();

    const pauseRotation = () => {
      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
      if (!pausedRef.current) {
        pausedRef.current = true;
        setPaused(true);
        clearAdvanceTimer();
      }
      resumeTimerRef.current = window.setTimeout(() => {
        resumeTimerRef.current = null;
        pausedRef.current = false;
        setPaused(false);
        // Resume by re-holding the current piece for its full hold,
        // then the chain advances as usual — no startling instant cut
        // the moment the visitor steps back.
        stepStartedAtRef.current = performance.now();
        setStepProgress(0);
        scheduleAdvanceRef.current();
      }, KIOSK_RESUME_DELAY_MS);
    };

    const requestFullscreenOnce = (eventTarget: EventTarget | null) => {
      if (fullscreenRequestedRef.current || document.fullscreenElement) return;
      // A pointerdown on the hint is an exit click in progress, not a
      // fullscreen gesture.
      if (eventTarget instanceof Element && eventTarget.closest('[data-kiosk-hint]')) return;
      fullscreenRequestedRef.current = true;
      try {
        const result = document.documentElement.requestFullscreen?.();
        if (result) void result.catch(() => { /* gesture rejected: stay windowed */ });
      } catch {
        /* fullscreen unavailable: silent no-op */
      }
    };

    const onPointerMove = () => {
      // Mousemove fires continuously; one handling per second is
      // plenty to keep the hint up and the resume clock re-armed.
      const now = performance.now();
      if (now - lastMoveHandledRef.current < 1000) return;
      lastMoveHandledRef.current = now;
      showHint();
      pauseRotation();
    };
    const onPointerDown = (event: PointerEvent) => {
      requestFullscreenOnce(event.target);
      showHint();
      pauseRotation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // In fullscreen the browser consumes the first Esc itself;
        // the keydown still reaches us in most browsers — exiting
        // kiosk then is the documented behaviour either way.
        exitKiosk();
        return;
      }
      pauseRotation();
    };
    const onOtherInteraction = () => pauseRotation();

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('wheel', onOtherInteraction, { passive: true });
    window.addEventListener('touchstart', onOtherInteraction, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('wheel', onOtherInteraction);
      window.removeEventListener('touchstart', onOtherInteraction);
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current);
      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
    };
  }, [active, clearAdvanceTimer, exitKiosk]);

  // ---- wake lock --------------------------------------------------------
  // NOT the useWakeLock hook: its enable flag is the visitor's own
  // persisted deck toggle, and kiosk must neither read nor flip that
  // preference. This follows the same sentinel pattern (hold while
  // visible, re-acquire on visibilitychange, release on teardown)
  // with isWakeLockSupported from platformFeatures.
  useEffect(() => {
    if (!active || !isWakeLockSupported()) return undefined;
    let disposed = false;
    const request = async () => {
      if (wakeLockSentinelRef.current) return;
      try {
        const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
        if (!wakeLock) return;
        const sentinel = await wakeLock.request('screen');
        if (disposed) {
          void sentinel.release().catch(() => { /* ignore */ });
          return;
        }
        wakeLockSentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLockSentinelRef.current === sentinel) wakeLockSentinelRef.current = null;
        });
      } catch {
        /* background/headless: the lock simply stays unheld */
      }
    };
    void request();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      releaseWakeLock();
    };
  }, [active, releaseWakeLock]);

  // Teardown of the rotation chain on unmount / mode off.
  useEffect(() => () => {
    clearAdvanceTimer();
    if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current);
  }, [clearAdvanceTimer]);

  return {
    exitKiosk,
    hintVisible,
    paused,
    rotationReady,
    stepProgress,
  };
}
