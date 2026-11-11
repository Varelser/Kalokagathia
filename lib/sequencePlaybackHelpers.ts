import { Dispatch, SetStateAction } from 'react';
import type { ParticleConfig, PresetRecord, PresetSequenceItem, SequenceTransitionEasing } from '../types';
import { getSequenceItemResolvedConfig } from './sequenceEditing';

export type SequenceApplyConfigInstant = (
  nextConfig: ParticleConfig,
  nextPresetId?: string | null,
) => boolean;

export type SequenceApplyConfigMorph = (
  targetConfig: ParticleConfig,
  durationSeconds: number,
  nextPresetId?: string | null,
  easing?: SequenceTransitionEasing,
) => boolean;

type SequencePlaybackStateSetters = {
  setActiveSequenceItemId: Dispatch<SetStateAction<string | null>>;
  setIsSequencePlaying: Dispatch<SetStateAction<boolean>>;
  setSequenceStepProgress: Dispatch<SetStateAction<number>>;
};

export function getSequenceSinglePassDuration(presetSequence: PresetSequenceItem[]) {
  if (presetSequence.length === 0) {
    return 0;
  }

  return presetSequence.reduce((total, item, index) => {
    const transition = index === 0 ? 0 : item.transitionSeconds;
    return total + item.holdSeconds + transition;
  }, 0);
}

export function loadSequenceItem(
  itemId: string,
  presetSequence: PresetSequenceItem[],
  presets: PresetRecord[],
  applyConfigInstant: SequenceApplyConfigInstant,
  stopSequencePlayback: () => void,
  setters: Pick<SequencePlaybackStateSetters, 'setActiveSequenceItemId' | 'setSequenceStepProgress'>,
) {
  const item = presetSequence.find((entry) => entry.id === itemId);
  if (!item) {
    return;
  }

  const resolvedConfig = getSequenceItemResolvedConfig(item, presets);
  if (!resolvedConfig) {
    return;
  }

  stopSequencePlayback();
  setters.setSequenceStepProgress(0);
  setters.setActiveSequenceItemId(itemId);
  applyConfigInstant(resolvedConfig, item.keyframeConfig ? null : item.presetId);
}

export function startSequencePlayback(
  presetSequence: PresetSequenceItem[],
  presets: PresetRecord[],
  applyConfigInstant: SequenceApplyConfigInstant,
  clearSequenceTimer: () => void,
  setters: SequencePlaybackStateSetters,
) {
  if (presetSequence.length === 0) {
    return;
  }

  clearSequenceTimer();
  setters.setSequenceStepProgress(0);

  const firstItem = presetSequence[0];
  if (!firstItem) {
    return;
  }

  const resolvedConfig = getSequenceItemResolvedConfig(firstItem, presets);
  if (!resolvedConfig) {
    return;
  }

  setters.setIsSequencePlaying(true);
  setters.setActiveSequenceItemId(firstItem.id);
  applyConfigInstant(resolvedConfig, firstItem.keyframeConfig ? null : firstItem.presetId);
}

type AdvanceSequencePlaybackArgs = {
  activeSequenceIndex: number;
  applyConfigMorph: SequenceApplyConfigMorph;
  presetSequence: PresetSequenceItem[];
  presets: PresetRecord[];
  sequenceLoopEnabled: boolean;
  setters: Pick<SequencePlaybackStateSetters, 'setActiveSequenceItemId' | 'setIsSequencePlaying'>;
};

export function advanceSequencePlayback({
  activeSequenceIndex,
  applyConfigMorph,
  presetSequence,
  presets,
  sequenceLoopEnabled,
  setters,
}: AdvanceSequencePlaybackArgs) {
  const currentItem = presetSequence[activeSequenceIndex];
  if (!currentItem) {
    return;
  }

  const nextIndex = activeSequenceIndex + 1;
  if (nextIndex >= presetSequence.length) {
    if (!sequenceLoopEnabled) {
      setters.setIsSequencePlaying(false);
      setters.setActiveSequenceItemId(currentItem.id);
      return;
    }

    const firstItem = presetSequence[0];
    if (!firstItem) {
      setters.setIsSequencePlaying(false);
      return;
    }

    const firstConfig = getSequenceItemResolvedConfig(firstItem, presets);
    if (!firstConfig) {
      setters.setIsSequencePlaying(false);
      return;
    }

    setters.setActiveSequenceItemId(firstItem.id);
    applyConfigMorph(
      firstConfig,
      firstItem.transitionSeconds,
      firstItem.keyframeConfig ? null : firstItem.presetId,
      firstItem.transitionEasing,
    );
    return;
  }

  const nextItem = presetSequence[nextIndex];
  if (!nextItem) {
    setters.setIsSequencePlaying(false);
    return;
  }

  const nextConfig = getSequenceItemResolvedConfig(nextItem, presets);
  if (!nextConfig) {
    setters.setIsSequencePlaying(false);
    return;
  }

  setters.setActiveSequenceItemId(nextItem.id);
  applyConfigMorph(
    nextConfig,
    nextItem.transitionSeconds,
    nextItem.keyframeConfig ? null : nextItem.presetId,
    nextItem.transitionEasing,
  );
}
