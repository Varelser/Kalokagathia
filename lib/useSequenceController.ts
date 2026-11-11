import { Dispatch, MutableRefObject, SetStateAction, useState } from 'react';
import type { ParticleConfig, PresetRecord, PresetSequenceItem, SequenceTransitionEasing } from '../types';
import type { Notice } from './audioControllerTypes';
import { useSequenceEditingActions } from './useSequenceEditingActions';
import { useSequencePlayback } from './useSequencePlayback';

type UseSequenceControllerArgs = {
  applyConfigInstant: (nextConfig: ParticleConfig, nextPresetId?: string | null) => boolean;
  applyConfigMorph: (
    targetConfig: ParticleConfig,
    durationSeconds: number,
    nextPresetId?: string | null,
    easing?: SequenceTransitionEasing,
  ) => boolean;
  config: ParticleConfig;
  initialPresetSequence: PresetSequenceItem[];
  initialSequenceLoopEnabled: boolean;
  isPresetTransitioning: boolean;
  isPublicLibraryMode: boolean;
  latestConfigRef: MutableRefObject<ParticleConfig>;
  presetBlendDuration: number;
  presets: PresetRecord[];
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
  validPresetIds: Set<string>;
};

export function useSequenceController({
  applyConfigInstant,
  applyConfigMorph,
  config,
  initialPresetSequence,
  initialSequenceLoopEnabled,
  isPresetTransitioning,
  isPublicLibraryMode,
  latestConfigRef,
  presetBlendDuration,
  presets,
  setLibraryNotice,
  validPresetIds,
}: UseSequenceControllerArgs) {
  const [presetSequence, setPresetSequence] = useState<PresetSequenceItem[]>(initialPresetSequence);

  const {
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
  } = useSequencePlayback({
    applyConfigInstant,
    applyConfigMorph,
    initialSequenceLoopEnabled,
    isPresetTransitioning,
    isPublicLibraryMode,
    presetSequence,
    presets,
    setPresetSequence,
    validPresetIds,
  });

  const editingActions = useSequenceEditingActions({
    config,
    isPublicLibraryMode,
    latestConfigRef,
    presetBlendDuration,
    presets,
    setActiveSequenceItemId,
    setLibraryNotice,
    setPresetSequence,
    validPresetIds,
  });

  return {
    activeSequenceItemId,
    ...editingActions,
    handleLoadSequenceItem,
    handleStartSequencePlayback,
    handleStopSequencePlayback,
    isSequencePlaying,
    presetSequence,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    sequenceStepProgress,
    setActiveSequenceItemId,
    setPresetSequence,
    setSequenceLoopEnabled,
    stopSequencePlayback,
  };
}
