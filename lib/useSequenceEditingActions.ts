import { Dispatch, MutableRefObject, SetStateAction, useCallback } from 'react';
import type {
  ParticleConfig,
  PresetRecord,
  PresetSequenceItem,
  SequenceDriveMode,
  SequenceDriveStrengthMode,
  SequenceTransitionEasing,
} from '../types';
import type { Notice } from './audioControllerTypes';
import {
  addPresetToSequence,
  captureSequenceKeyframe,
  duplicateSequenceItem,
  getSequenceItemResolvedConfig,
  moveSequenceItem,
  removeSequenceItem,
  reorderSequenceItem,
  updateDriveMode,
  updateDriveMultiplier,
  updateDriveStrengthMode,
  updateDriveStrengthOverride,
  updateSequenceItem,
  updateTransitionEasing,
} from './sequenceEditing';

type UseSequenceEditingActionsArgs = {
  config: ParticleConfig;
  isPublicLibraryMode: boolean;
  latestConfigRef: MutableRefObject<ParticleConfig>;
  presetBlendDuration: number;
  presets: PresetRecord[];
  setActiveSequenceItemId: Dispatch<SetStateAction<string | null>>;
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
  setPresetSequence: Dispatch<SetStateAction<PresetSequenceItem[]>>;
  validPresetIds: Set<string>;
};

export function useSequenceEditingActions({
  config,
  isPublicLibraryMode,
  latestConfigRef,
  presetBlendDuration,
  presets,
  setActiveSequenceItemId,
  setLibraryNotice,
  setPresetSequence,
  validPresetIds,
}: UseSequenceEditingActionsArgs) {
  const handleAddPresetToSequence = useCallback((presetId: string) => {
    addPresetToSequence(presetId, {
      isPublicLibraryMode,
      presetBlendDuration,
      presets,
      setLibraryNotice,
      setPresetSequence,
      validPresetIds,
    });
  }, [isPublicLibraryMode, presetBlendDuration, presets, setLibraryNotice, setPresetSequence, validPresetIds]);

  const handleRemoveSequenceItem = useCallback((itemId: string) => {
    removeSequenceItem(itemId, {
      isPublicLibraryMode,
      setActiveSequenceItemId,
      setLibraryNotice,
      setPresetSequence,
    });
  }, [isPublicLibraryMode, setActiveSequenceItemId, setLibraryNotice, setPresetSequence]);

  const handleSequenceHoldChange = useCallback((itemId: string, holdSeconds: number) => {
    updateSequenceItem(
      itemId,
      (item) => ({ ...item, holdSeconds: Math.max(0.2, holdSeconds) }),
      isPublicLibraryMode,
      setPresetSequence,
    );
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleSequenceTransitionChange = useCallback((itemId: string, transitionSeconds: number) => {
    updateSequenceItem(
      itemId,
      (item) => ({ ...item, transitionSeconds: Math.max(0.05, transitionSeconds) }),
      isPublicLibraryMode,
      setPresetSequence,
    );
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleSequenceTransitionEasingChange = useCallback((itemId: string, transitionEasing: SequenceTransitionEasing) => {
    updateTransitionEasing(itemId, transitionEasing, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleSequenceDriveModeChange = useCallback((itemId: string, mode: SequenceDriveMode) => {
    updateDriveMode(itemId, mode, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleSequenceDriveStrengthModeChange = useCallback((itemId: string, mode: SequenceDriveStrengthMode) => {
    updateDriveStrengthMode(itemId, mode, isPublicLibraryMode, latestConfigRef, setPresetSequence);
  }, [isPublicLibraryMode, latestConfigRef, setPresetSequence]);

  const handleSequenceDriveStrengthOverrideChange = useCallback((itemId: string, value: number) => {
    updateDriveStrengthOverride(itemId, value, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleSequenceDriveMultiplierChange = useCallback((itemId: string, multiplier: number) => {
    updateDriveMultiplier(itemId, multiplier, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleRenameSequenceItem = useCallback((itemId: string, label: string) => {
    updateSequenceItem(
      itemId,
      (item) => ({ ...item, label: label.trim() || item.label }),
      isPublicLibraryMode,
      setPresetSequence,
    );
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleCaptureSequenceKeyframe = useCallback((itemId: string) => {
    captureSequenceKeyframe(itemId, config, isPublicLibraryMode, setLibraryNotice, setPresetSequence);
  }, [config, isPublicLibraryMode, setLibraryNotice, setPresetSequence]);

  const handleResetSequenceKeyframe = useCallback((itemId: string) => {
    updateSequenceItem(
      itemId,
      (item) => ({ ...item, keyframeConfig: null }),
      isPublicLibraryMode,
      setPresetSequence,
    );
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleDuplicateSequenceItem = useCallback((itemId: string) => {
    duplicateSequenceItem(itemId, {
      isPublicLibraryMode,
      setLibraryNotice,
      setPresetSequence,
    });
  }, [isPublicLibraryMode, setLibraryNotice, setPresetSequence]);

  const handleMoveSequenceItem = useCallback((itemId: string, direction: -1 | 1) => {
    moveSequenceItem(itemId, direction, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleReorderSequenceItem = useCallback((sourceItemId: string, targetItemId: string) => {
    reorderSequenceItem(sourceItemId, targetItemId, isPublicLibraryMode, setPresetSequence);
  }, [isPublicLibraryMode, setPresetSequence]);

  const handleGetSequenceItemResolvedConfig = useCallback((item: PresetSequenceItem) => {
    return getSequenceItemResolvedConfig(item, presets);
  }, [presets]);

  return {
    getSequenceItemResolvedConfig: handleGetSequenceItemResolvedConfig,
    handleAddPresetToSequence,
    handleCaptureSequenceKeyframe,
    handleDuplicateSequenceItem,
    handleMoveSequenceItem,
    handleRemoveSequenceItem,
    handleRenameSequenceItem,
    handleReorderSequenceItem,
    handleResetSequenceKeyframe,
    handleSequenceDriveModeChange,
    handleSequenceDriveMultiplierChange,
    handleSequenceDriveStrengthModeChange,
    handleSequenceDriveStrengthOverrideChange,
    handleSequenceHoldChange,
    handleSequenceTransitionChange,
    handleSequenceTransitionEasingChange,
  };
}
