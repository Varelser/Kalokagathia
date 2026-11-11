import { Dispatch, SetStateAction } from 'react';
import type { ParticleConfig, PresetRecord, PresetSequenceItem } from '../types';
import {
  normalizeConfig,
  normalizeSequenceDriveMultiplier,
} from './appState';
import type { Notice } from './audioControllerTypes';

export type SetPresetSequence = Dispatch<SetStateAction<PresetSequenceItem[]>>;

export function getSequenceItemResolvedConfig(item: PresetSequenceItem, presets: PresetRecord[]) {
  const preset = presets.find((entry) => entry.id === item.presetId);
  const baseConfig = item.keyframeConfig
    ? normalizeConfig(item.keyframeConfig)
    : preset
      ? normalizeConfig(preset.config)
      : null;
  if (!baseConfig) {
    return null;
  }

  const driveStrengthBase = item.screenSequenceDriveStrengthMode === 'override' && item.screenSequenceDriveStrengthOverride !== null
    ? item.screenSequenceDriveStrengthOverride
    : baseConfig.screenSequenceDriveStrength;

  return {
    ...baseConfig,
    screenSequenceDriveEnabled: item.screenSequenceDriveMode === 'inherit'
      ? baseConfig.screenSequenceDriveEnabled
      : item.screenSequenceDriveMode === 'on',
    screenSequenceDriveStrength: driveStrengthBase * normalizeSequenceDriveMultiplier(item.screenSequenceDriveMultiplier),
  };
}

export function withPublicGuard(isPublicLibraryMode: boolean, setLibraryNotice: Dispatch<SetStateAction<Notice | null>>, message: string) {
  if (isPublicLibraryMode) {
    setLibraryNotice({ tone: 'error', message });
    return true;
  }
  return false;
}

export function updateSequenceItem(
  itemId: string,
  updater: (item: PresetSequenceItem) => PresetSequenceItem,
  isPublicLibraryMode: boolean,
  setPresetSequence: SetPresetSequence,
) {
  if (isPublicLibraryMode) {
    return;
  }
  setPresetSequence((prev) => prev.map((item) => (
    item.id === itemId ? updater(item) : item
  )));
}

export function cloneKeyframeConfig(config: ParticleConfig | null | undefined) {
  return config ? normalizeConfig(config) : null;
}
