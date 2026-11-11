import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ParticleConfig, PresetRecord, SequenceDriveStrengthMode } from '../types';
import {
  createSequenceItemId,
  DEFAULT_SEQUENCE_DRIVE_MODE,
  DEFAULT_SEQUENCE_DRIVE_MULTIPLIER,
  DEFAULT_SEQUENCE_DRIVE_STRENGTH_MODE,
  DEFAULT_SEQUENCE_EASING,
  normalizeConfig,
  normalizeSequenceDriveStrengthMode,
} from './appState';
import type { Notice } from './audioControllerTypes';
import { cloneKeyframeConfig, SetPresetSequence, withPublicGuard } from './sequenceEditingShared';

export function addPresetToSequence(
  presetId: string,
  options: {
    isPublicLibraryMode: boolean;
    presetBlendDuration: number;
    presets: PresetRecord[];
    setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
    setPresetSequence: SetPresetSequence;
    validPresetIds: Set<string>;
  },
) {
  const { isPublicLibraryMode, presetBlendDuration, presets, setLibraryNotice, setPresetSequence, validPresetIds } = options;
  if (withPublicGuard(isPublicLibraryMode, setLibraryNotice, 'Sequence editing is disabled in the public build.')) {
    return;
  }
  if (!validPresetIds.has(presetId)) {
    return;
  }

  const preset = presets.find((entry) => entry.id === presetId);
  setPresetSequence((prev) => ([
    ...prev,
    {
      id: createSequenceItemId(),
      presetId,
      label: preset?.name || 'Keyframe',
      holdSeconds: 2,
      transitionSeconds: presetBlendDuration,
      transitionEasing: DEFAULT_SEQUENCE_EASING,
      screenSequenceDriveMode: DEFAULT_SEQUENCE_DRIVE_MODE,
      screenSequenceDriveStrengthMode: DEFAULT_SEQUENCE_DRIVE_STRENGTH_MODE,
      screenSequenceDriveStrengthOverride: null,
      screenSequenceDriveMultiplier: DEFAULT_SEQUENCE_DRIVE_MULTIPLIER,
      keyframeConfig: null,
    },
  ]));
}

export function removeSequenceItem(itemId: string, options: {
  isPublicLibraryMode: boolean;
  setActiveSequenceItemId: Dispatch<SetStateAction<string | null>>;
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
  setPresetSequence: SetPresetSequence;
}) {
  const { isPublicLibraryMode, setActiveSequenceItemId, setLibraryNotice, setPresetSequence } = options;
  if (withPublicGuard(isPublicLibraryMode, setLibraryNotice, 'Sequence editing is disabled in the public build.')) {
    return;
  }
  setPresetSequence((prev) => prev.filter((item) => item.id !== itemId));
  setActiveSequenceItemId((prev) => (prev === itemId ? null : prev));
}

export function duplicateSequenceItem(itemId: string, options: {
  isPublicLibraryMode: boolean;
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
  setPresetSequence: SetPresetSequence;
}) {
  const { isPublicLibraryMode, setLibraryNotice, setPresetSequence } = options;
  if (withPublicGuard(isPublicLibraryMode, setLibraryNotice, 'Sequence editing is disabled in the public build.')) {
    return;
  }

  setPresetSequence((prev) => {
    const index = prev.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return prev;
    }

    const sourceItem = prev[index];
    if (!sourceItem) {
      return prev;
    }

    const duplicate = {
      ...sourceItem,
      id: createSequenceItemId(),
      label: `${sourceItem.label} Copy`,
      keyframeConfig: cloneKeyframeConfig(sourceItem.keyframeConfig),
    };

    const next = [...prev];
    next.splice(index + 1, 0, duplicate);
    return next;
  });
}

export function moveSequenceItem(itemId: string, direction: -1 | 1, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  if (isPublicLibraryMode) {
    return;
  }
  setPresetSequence((prev) => {
    const index = prev.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return prev;
    }

    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= prev.length) {
      return prev;
    }

    const next = [...prev];
    const [moved] = next.splice(index, 1);
    if (!moved) {
      return prev;
    }
    next.splice(nextIndex, 0, moved);
    return next;
  });
}

export function reorderSequenceItem(sourceItemId: string, targetItemId: string, isPublicLibraryMode: boolean, setPresetSequence: SetPresetSequence) {
  if (isPublicLibraryMode || sourceItemId === targetItemId) {
    return;
  }

  setPresetSequence((prev) => {
    const sourceIndex = prev.findIndex((item) => item.id === sourceItemId);
    const targetIndex = prev.findIndex((item) => item.id === targetItemId);
    if (sourceIndex < 0 || targetIndex < 0) {
      return prev;
    }

    const next = [...prev];
    const [moved] = next.splice(sourceIndex, 1);
    if (!moved) {
      return prev;
    }
    next.splice(targetIndex, 0, moved);
    return next;
  });
}

export function captureSequenceKeyframe(
  itemId: string,
  config: ParticleConfig,
  isPublicLibraryMode: boolean,
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>,
  setPresetSequence: SetPresetSequence,
) {
  if (withPublicGuard(isPublicLibraryMode, setLibraryNotice, 'Keyframe capture is disabled in the public build.')) {
    return;
  }
  setPresetSequence((prev) => prev.map((item) => (
    item.id === itemId ? { ...item, keyframeConfig: normalizeConfig(config) } : item
  )));
}

export function updateDriveStrengthMode(
  itemId: string,
  mode: SequenceDriveStrengthMode,
  isPublicLibraryMode: boolean,
  latestConfigRef: MutableRefObject<ParticleConfig>,
  setPresetSequence: SetPresetSequence,
) {
  if (isPublicLibraryMode) {
    return;
  }
  setPresetSequence((prev) => prev.map((item) => (
    item.id === itemId
      ? {
        ...item,
        screenSequenceDriveStrengthMode: normalizeSequenceDriveStrengthMode(mode),
        screenSequenceDriveStrengthOverride: mode === 'override'
          ? (item.screenSequenceDriveStrengthOverride ?? latestConfigRef.current.screenSequenceDriveStrength)
          : null,
      }
      : item
  )));
}
