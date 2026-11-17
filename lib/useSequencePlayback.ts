import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PresetRecord, PresetSequenceItem } from '../types';
import {
  parsePersistedPresetRecords,
  parsePersistedPresetSequence,
  PRESET_SEQUENCE_STORAGE_KEY,
  PRESET_STORAGE_KEY,
} from './appState';
import {
  advanceSequencePlayback,
  getSequenceSinglePassDuration,
  loadSequenceItem,
  SequenceApplyConfigInstant,
  SequenceApplyConfigMorph,
  startSequencePlayback,
} from './sequencePlaybackHelpers';
import { isStarterPresetSequence, useStarterPresetLibrary } from './lazyStarterLibrary';
import { getHydratedPayload, putStoragePayload, useStorageHydrated } from './storageDb';
import {
  getSequenceClockAnchor,
  setSequenceClockTime,
  wrapSequenceClockTime,
} from './sequenceTracks';

type UseSequencePlaybackArgs = {
  applyConfigInstant: SequenceApplyConfigInstant;
  applyConfigMorph: SequenceApplyConfigMorph;
  hadPersistedSequence?: boolean;
  initialSequenceLoopEnabled: boolean;
  isPresetTransitioning: boolean;
  isPublicLibraryMode: boolean;
  presetSequence: PresetSequenceItem[];
  presets: PresetRecord[];
  setPresetSequence: Dispatch<SetStateAction<PresetSequenceItem[]>>;
  validPresetIds: Set<string>;
};

export function useSequencePlayback({
  applyConfigInstant,
  applyConfigMorph,
  hadPersistedSequence = false,
  initialSequenceLoopEnabled,
  isPresetTransitioning,
  isPublicLibraryMode,
  presetSequence,
  presets,
  setPresetSequence,
  validPresetIds,
}: UseSequencePlaybackArgs) {
  // Only used for the starter-identity check before persisting; loaded
  // lazily in private mode, never in public mode.
  const starterLibrary = useStarterPresetLibrary(!isPublicLibraryMode);
  // IndexedDB hydration (Phase 1 renewal): the first-render sequence is
  // the localStorage-derived initial value; the fill-in effect below
  // replaces it with the IndexedDB payload once hydration settles, and
  // the persist effect stays gated until that has happened.
  const storageHydrated = useStorageHydrated(!isPublicLibraryMode);
  const [sequenceStorageReady, setSequenceStorageReady] = useState<boolean>(() => isPublicLibraryMode);
  const initialSequenceRef = useRef<PresetSequenceItem[] | null>(null);
  if (initialSequenceRef.current === null) {
    initialSequenceRef.current = presetSequence;
  }
  const [isSequencePlaying, setIsSequencePlaying] = useState(false);
  const [sequenceLoopEnabled, setSequenceLoopEnabled] = useState(initialSequenceLoopEnabled);
  const [activeSequenceItemId, setActiveSequenceItemId] = useState<string | null>(null);
  const [sequenceStepProgress, setSequenceStepProgress] = useState(0);
  const sequenceTimerRef = useRef<number | null>(null);
  const sequenceProgressFrameRef = useRef<number | null>(null);
  const sequenceStepStartedAtRef = useRef<number | null>(null);

  const activeSequenceIndex = useMemo(
    () => presetSequence.findIndex((item) => item.id === activeSequenceItemId),
    [activeSequenceItemId, presetSequence],
  );

  const sequenceSinglePassDuration = useMemo(
    () => getSequenceSinglePassDuration(presetSequence),
    [presetSequence],
  );

  const clearSequenceTimer = useCallback(() => {
    if (sequenceTimerRef.current !== null) {
      window.clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }
  }, []);

  const stopSequencePlayback = useCallback(() => {
    clearSequenceTimer();
    setIsSequencePlaying(false);
  }, [clearSequenceTimer]);

  const handleLoadSequenceItem = useCallback((itemId: string) => {
    loadSequenceItem(itemId, presetSequence, presets, applyConfigInstant, stopSequencePlayback, {
      setActiveSequenceItemId,
      setSequenceStepProgress,
    });
  }, [applyConfigInstant, presetSequence, presets, stopSequencePlayback]);

  const handleStartSequencePlayback = useCallback(() => {
    startSequencePlayback(presetSequence, presets, applyConfigInstant, clearSequenceTimer, {
      setActiveSequenceItemId,
      setIsSequencePlaying,
      setSequenceStepProgress,
    });
  }, [applyConfigInstant, clearSequenceTimer, presetSequence, presets]);

  const handleStopSequencePlayback = useCallback(() => {
    stopSequencePlayback();
  }, [stopSequencePlayback]);

  // IndexedDB fill-in: once hydration has settled, a persisted IndexedDB
  // sequence is authoritative. The current sequence is only replaced
  // while it is still a derived initial value — the localStorage initial
  // sequence itself, the starter sequence, or the starter sequence
  // filtered by App's starter fill-in (an in-order subsequence of the
  // starter ids, when nothing was persisted). Anything the visitor
  // changed in the meantime fails all three checks and is kept. Runs
  // once; sequenceStorageReady then unlocks the persist effect below.
  // Declared before the persist effect so that, in the commit where
  // hydration settles, the persist effect still sees
  // sequenceStorageReady === false and cannot write first.
  useEffect(() => {
    if (isPublicLibraryMode || !storageHydrated || sequenceStorageReady) {
      return;
    }
    const raw = getHydratedPayload(PRESET_SEQUENCE_STORAGE_KEY);
    if (typeof raw === 'string') {
      // Parse against the IndexedDB library's ids when available: the
      // React-side validPresetIds may still reflect the pre-hydration
      // (localStorage) library in this commit.
      const presetRaw = getHydratedPayload(PRESET_STORAGE_KEY);
      const idbPresets = typeof presetRaw === 'string' ? parsePersistedPresetRecords(presetRaw) : null;
      const filterIds = idbPresets ? new Set(idbPresets.map((preset) => preset.id)) : validPresetIds;
      const fromIdb = parsePersistedPresetSequence(raw, filterIds);
      if (fromIdb) {
        setPresetSequence((prev) => {
          const initial = initialSequenceRef.current ?? [];
          const untouchedInitial = prev.length === initial.length
            && prev.every((item, index) => item.id === initial[index]?.id);
          if (untouchedInitial) {
            return fromIdb;
          }
          if (starterLibrary && isStarterPresetSequence(prev, starterLibrary)) {
            return fromIdb;
          }
          if (!hadPersistedSequence && starterLibrary && prev.length > 0) {
            const starterIds = starterLibrary.presetSequence.map((item) => item.id);
            let cursor = 0;
            const isStarterSubsequence = prev.every((item) => {
              const foundAt = starterIds.indexOf(item.id, cursor);
              if (foundAt < 0) return false;
              cursor = foundAt + 1;
              return true;
            });
            if (isStarterSubsequence) {
              return fromIdb;
            }
          }
          return prev;
        });
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the ready flag is the hydration gate itself: it must flip in the same commit the fill-in ran, so the persist effect below stays blocked until the next commit.
    setSequenceStorageReady(true);
  }, [hadPersistedSequence, isPublicLibraryMode, sequenceStorageReady, setPresetSequence, starterLibrary, storageHydrated, validPresetIds]);

  useEffect(() => {
    if (isPublicLibraryMode || typeof window === 'undefined') {
      return;
    }
    if (!sequenceStorageReady) {
      // Never persist before IndexedDB hydration has settled and the
      // fill-in above has run (see the note on the fill-in effect).
      return;
    }
    if (!starterLibrary) {
      // Defer the starter-identity decision (and persistence) until the
      // starter library has arrived; the check itself is unchanged.
      return;
    }
    if (presetSequence.length === 0) {
      // Nothing to persist yet (the starter fill-in is still pending, or
      // every item was removed). An empty payload is treated as "absent" by
      // every reader, so skipping the write is load-equivalent and keeps a
      // first visit from touching localStorage at all.
      return;
    }
    if (isStarterPresetSequence(presetSequence, starterLibrary)) {
      return;
    }
    // IndexedDB is the primary store (storageDb mirrors back into
    // localStorage while the payload fits the legacy cap).
    putStoragePayload(PRESET_SEQUENCE_STORAGE_KEY, JSON.stringify(presetSequence));
  }, [isPublicLibraryMode, presetSequence, sequenceStorageReady, starterLibrary]);

  useEffect(() => {
    setPresetSequence((prev) => prev.filter((item) => validPresetIds.has(item.presetId)));
  }, [setPresetSequence, validPresetIds]);

  useEffect(() => {
    if (!isSequencePlaying || isPresetTransitioning || presetSequence.length === 0 || activeSequenceIndex < 0) {
      clearSequenceTimer();
      return;
    }

    const currentItem = presetSequence[activeSequenceIndex];
    if (!currentItem) {
      return;
    }

    sequenceTimerRef.current = window.setTimeout(() => {
      advanceSequencePlayback({
        activeSequenceIndex,
        applyConfigMorph,
        presetSequence,
        presets,
        sequenceLoopEnabled,
        setters: {
          setActiveSequenceItemId,
          setIsSequencePlaying,
        },
      });
    }, currentItem.holdSeconds * 1000);

    return clearSequenceTimer;
  }, [
    activeSequenceIndex,
    applyConfigMorph,
    clearSequenceTimer,
    isPresetTransitioning,
    isSequencePlaying,
    presetSequence,
    presets,
    sequenceLoopEnabled,
  ]);

  useEffect(() => {
    if (sequenceProgressFrameRef.current !== null) {
      cancelAnimationFrame(sequenceProgressFrameRef.current);
      sequenceProgressFrameRef.current = null;
    }

    if (!isSequencePlaying || isPresetTransitioning || presetSequence.length === 0 || activeSequenceIndex < 0) {
      if (!isSequencePlaying) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- stopping playback must reset the step progress immediately; this is a playback-state reset, not derived render state.
        setSequenceStepProgress(0);
      }
      return;
    }

    const currentItem = presetSequence[activeSequenceIndex];
    if (!currentItem) {
      return;
    }

    const holdDurationMs = Math.max(200, currentItem.holdSeconds * 1000);
    sequenceStepStartedAtRef.current = performance.now();

    const tick = (now: number) => {
      const startedAt = sequenceStepStartedAtRef.current ?? now;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / holdDurationMs));
      setSequenceStepProgress(progress);

      if (progress < 1 && isSequencePlaying && !isPresetTransitioning) {
        sequenceProgressFrameRef.current = requestAnimationFrame(tick);
      }
    };

    sequenceProgressFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (sequenceProgressFrameRef.current !== null) {
        cancelAnimationFrame(sequenceProgressFrameRef.current);
        sequenceProgressFrameRef.current = null;
      }
    };
  }, [activeSequenceIndex, isPresetTransitioning, isSequencePlaying, presetSequence]);

  // Sequence track clock (Phase AN): an anchored absolute pass time,
  // published to the shared clock store at ~50ms so the effective
  // config layer can evaluate keyframe tracks. Anchors are set at
  // segment seams (playback start / morph start) from the pure seam
  // functions in sequenceTracks, so the reading never drifts: every
  // morph start re-anchors to the canonical segment start. The clock
  // only feeds the effective-config layer; config state is untouched.
  const sequenceClockAnchorRef = useRef<{ time: number; perf: number } | null>(null);
  const sequenceClockPrevTransitioningRef = useRef(false);
  const sequenceClockAnchoredIndexRef = useRef(-1);

  useEffect(() => {
    if (!isSequencePlaying) {
      sequenceClockAnchorRef.current = null;
      sequenceClockAnchoredIndexRef.current = -1;
      setSequenceClockTime(0, false);
      return;
    }
    if (!sequenceClockAnchorRef.current) {
      sequenceClockAnchorRef.current = { time: 0, perf: performance.now() };
      setSequenceClockTime(0, true);
    }
  }, [isSequencePlaying]);

  useEffect(() => {
    const wasTransitioning = sequenceClockPrevTransitioningRef.current;
    sequenceClockPrevTransitioningRef.current = isPresetTransitioning;
    if (!isSequencePlaying || wasTransitioning || !isPresetTransitioning) {
      return;
    }
    const index = activeSequenceIndex;
    if (index < 0) {
      return;
    }
    // Playback always starts with an instant apply (no morph), so a
    // morph whose target is item 0 is by construction a loop wrap.
    const isLoopWrap = index === 0;
    if (index === sequenceClockAnchoredIndexRef.current && !isLoopWrap) {
      // A morph that is not a sequence seam (e.g. a manual preset
      // click mid-playback): the clock keeps its current anchor.
      return;
    }
    sequenceClockAnchoredIndexRef.current = index;
    sequenceClockAnchorRef.current = {
      time: getSequenceClockAnchor(presetSequence, index, isLoopWrap),
      perf: performance.now(),
    };
  }, [activeSequenceIndex, isPresetTransitioning, isSequencePlaying, presetSequence]);

  useEffect(() => {
    if (!isSequencePlaying) {
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = () => {
      const anchor = sequenceClockAnchorRef.current;
      if (anchor) {
        const now = performance.now();
        if (!last || now - last >= 50) {
          last = now;
          const raw = anchor.time + (now - anchor.perf) / 1000;
          setSequenceClockTime(wrapSequenceClockTime(raw, sequenceSinglePassDuration), true);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isSequencePlaying, sequenceSinglePassDuration]);

  useEffect(() => () => {
    clearSequenceTimer();
    if (sequenceProgressFrameRef.current !== null) {
      cancelAnimationFrame(sequenceProgressFrameRef.current);
    }
  }, [clearSequenceTimer]);

  return {
    activeSequenceItemId,
    handleLoadSequenceItem,
    handleStartSequencePlayback,
    handleStopSequencePlayback,
    isSequencePlaying,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    sequenceStepProgress,
    setActiveSequenceItemId,
    setSequenceLoopEnabled,
    stopSequencePlayback,
  };
}
