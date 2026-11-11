import { useCallback } from 'react';
import type { PresetRecord } from '../types';
import { maybeWarnHeavyPreset } from './gpuTierWarnings';

type UseAppPresetActionsArgs = {
  applyConfigInstant: (nextConfig: PresetRecord['config'], nextPresetId?: string | null) => boolean;
  applyConfigMorph: (targetConfig: PresetRecord['config'], durationSeconds: number, nextPresetId?: string | null) => boolean;
  presetBlendDuration: number;
  presets: PresetRecord[];
  stopSequencePlayback: () => void;
};

export function useAppPresetActions({
  applyConfigInstant,
  applyConfigMorph,
  presetBlendDuration,
  presets,
  stopSequencePlayback,
}: UseAppPresetActionsArgs) {
  const applyPresetInstant = useCallback((presetId: string) => {
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) {
      return false;
    }

    return applyConfigInstant(preset.config, presetId);
  }, [applyConfigInstant, presets]);

  const applyPresetMorph = useCallback((presetId: string) => {
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) {
      return false;
    }

    return applyConfigMorph(preset.config, presetBlendDuration, presetId);
  }, [applyConfigMorph, presetBlendDuration, presets]);

  const handleLoadPreset = useCallback((presetId: string) => {
    stopSequencePlayback();
    const preset = presets.find((entry) => entry.id === presetId);
    if (preset) maybeWarnHeavyPreset(preset);
    applyPresetInstant(presetId);
  }, [applyPresetInstant, presets, stopSequencePlayback]);

  const handleTransitionToPreset = useCallback((presetId: string) => {
    stopSequencePlayback();
    const preset = presets.find((entry) => entry.id === presetId);
    if (preset) maybeWarnHeavyPreset(preset);
    applyPresetMorph(presetId);
  }, [applyPresetMorph, presets, stopSequencePlayback]);

  return {
    handleLoadPreset,
    handleTransitionToPreset,
  };
}
