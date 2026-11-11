import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PresetRecord, PresetSequenceItem } from '../types';
import { PRESET_SEQUENCE_STORAGE_KEY } from './appState';
import {
  advanceSequencePlayback,
  getSequenceSinglePassDuration,
  loadSequenceItem,
  SequenceApplyConfigInstant,
  SequenceApplyConfigMorph,
  startSequencePlayback,
} from './sequencePlaybackHelpers';
import { STARTER_PRESET_LIBRARY } from './starterLibrary';

function safelyPersistJson(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to persist ${key}:`, error);
  }
}

function isStarterPresetSequence(presetSequence: PresetSequenceItem[]) {
  return presetSequence.length === STARTER_PRESET_LIBRARY.presetSequence.length
    && presetSequence.every((item, index) => item.id === STARTER_PRESET_LIBRARY.presetSequence[index]?.id);
}

type UseSequencePlaybackArgs = {
  applyConfigInstant: SequenceApplyConfigInstant;
  applyConfigMorph: SequenceApplyConfigMorph;
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
  initialSequenceLoopEnabled,
  isPresetTransitioning,
  isPublicLibraryMode,
  presetSequence,
  presets,
  setPresetSequence,
  validPresetIds,
}: UseSequencePlaybackArgs) {
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

  useEffect(() => {
    if (isPublicLibraryMode || typeof window === 'undefined') {
      return;
    }
    if (isStarterPresetSequence(presetSequence)) {
      return;
    }
    safelyPersistJson(PRESET_SEQUENCE_STORAGE_KEY, presetSequence);
  }, [isPublicLibraryMode, presetSequence]);

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
