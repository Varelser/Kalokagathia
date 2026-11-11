import { Dispatch, SetStateAction, useCallback } from 'react';
import type { ParticleConfig, PresetLibraryData, PresetRecord, PresetSequenceItem } from '../types';
import {
  createPresetId,
  createSequenceItemId,
  normalizeConfig,
  normalizeSequenceDriveMode,
  normalizeSequenceDriveMultiplier,
  normalizeSequenceDriveStrengthMode,
  normalizeSequenceDriveStrengthOverride,
  normalizeSequenceTransitionEasing,
  parsePresetLibraryData,
  PRESET_LIBRARY_VERSION,
} from './appState';
import type { Notice } from './audioControllerTypes';

type UseLibraryTransferArgs = {
  activePresetId: string | null;
  config: ParticleConfig;
  isPublicLibraryMode: boolean;
  presetBlendDuration: number;
  presetSequence: PresetSequenceItem[];
  presets: PresetRecord[];
  sequenceLoopEnabled: boolean;
  setActivePresetId: Dispatch<SetStateAction<string | null>>;
  setActiveSequenceItemId: Dispatch<SetStateAction<string | null>>;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
  setLibraryNotice: Dispatch<SetStateAction<Notice | null>>;
  setPresetBlendDuration: Dispatch<SetStateAction<number>>;
  setPresetSequence: Dispatch<SetStateAction<PresetSequenceItem[]>>;
  setPresets: Dispatch<SetStateAction<PresetRecord[]>>;
  setSequenceLoopEnabled: Dispatch<SetStateAction<boolean>>;
  stopPresetTransition: () => void;
  stopSequencePlayback: () => void;
  validPresetIds: Set<string>;
};

export function useLibraryTransfer({
  activePresetId,
  config,
  isPublicLibraryMode,
  presetBlendDuration,
  presetSequence,
  presets,
  sequenceLoopEnabled,
  setActivePresetId,
  setActiveSequenceItemId,
  setConfig,
  setLibraryNotice,
  setPresetBlendDuration,
  setPresetSequence,
  setPresets,
  setSequenceLoopEnabled,
  stopPresetTransition,
  stopSequencePlayback,
  validPresetIds,
}: UseLibraryTransferArgs) {
  const handleExportLibrary = useCallback(() => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Export from your private workspace build instead.' });
      return;
    }

    const payload: PresetLibraryData = {
      version: PRESET_LIBRARY_VERSION,
      exportedAt: new Date().toISOString(),
      currentConfig: normalizeConfig(config),
      activePresetId,
      presetBlendDuration,
      sequenceLoopEnabled,
      presets,
      presetSequence,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kalokagathia-library-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    setLibraryNotice({ tone: 'success', message: 'Library exported.' });
  }, [activePresetId, config, isPublicLibraryMode, presetBlendDuration, presetSequence, presets, sequenceLoopEnabled, setLibraryNotice]);

  const handleImportLibrary = useCallback(async (file: File, mode: 'append' | 'replace') => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Import is disabled in the public build.' });
      return;
    }

    try {
      const text = await file.text();
      const parsed = parsePresetLibraryData(JSON.parse(text));

      if (!parsed) {
        setLibraryNotice({ tone: 'error', message: 'Invalid library JSON.' });
        return;
      }

      stopSequencePlayback();
      stopPresetTransition();

      const presetIdMap = new Map<string, string>();
      const importedPresets = parsed.presets.map((preset) => {
        const nextId = validPresetIds.has(preset.id) || presetIdMap.has(preset.id) ? createPresetId() : preset.id;
        presetIdMap.set(preset.id, nextId);
        return { ...preset, id: nextId };
      });

      const importedSequence = parsed.presetSequence
        .map((item) => ({
          id: createSequenceItemId(),
          presetId: presetIdMap.get(item.presetId) ?? item.presetId,
          label: item.label,
          holdSeconds: item.holdSeconds,
          transitionSeconds: item.transitionSeconds,
          transitionEasing: normalizeSequenceTransitionEasing(item.transitionEasing),
          screenSequenceDriveMode: normalizeSequenceDriveMode(item.screenSequenceDriveMode),
          screenSequenceDriveStrengthMode: normalizeSequenceDriveStrengthMode(item.screenSequenceDriveStrengthMode),
          screenSequenceDriveStrengthOverride: normalizeSequenceDriveStrengthOverride(item.screenSequenceDriveStrengthOverride),
          screenSequenceDriveMultiplier: normalizeSequenceDriveMultiplier(item.screenSequenceDriveMultiplier),
          keyframeConfig: item.keyframeConfig ? normalizeConfig(item.keyframeConfig) : null,
        }))
        .filter((item) => importedPresets.some((preset) => preset.id === item.presetId));

      if (mode === 'replace') {
        setPresets(importedPresets);
        setPresetSequence(importedSequence);
        setPresetBlendDuration(parsed.presetBlendDuration);
        setSequenceLoopEnabled(parsed.sequenceLoopEnabled);
        setActivePresetId(parsed.activePresetId ? (presetIdMap.get(parsed.activePresetId) ?? null) : importedPresets[0]?.id ?? null);
        setActiveSequenceItemId(importedSequence[0]?.id ?? null);
        setConfig(normalizeConfig(parsed.currentConfig));
        setLibraryNotice({ tone: 'success', message: `Library imported: ${importedPresets.length} presets replaced.` });
        return;
      }

      setPresets((prev) => [...prev, ...importedPresets]);
      setPresetSequence((prev) => [...prev, ...importedSequence]);
      setLibraryNotice({ tone: 'success', message: `Library imported: ${importedPresets.length} presets appended.` });
    } catch (error) {
      console.error('Library import failed:', error);
      setLibraryNotice({ tone: 'error', message: 'Library import failed.' });
    }
  }, [
    isPublicLibraryMode,
    setActivePresetId,
    setActiveSequenceItemId,
    setConfig,
    setLibraryNotice,
    setPresetBlendDuration,
    setPresetSequence,
    setPresets,
    setSequenceLoopEnabled,
    stopPresetTransition,
    stopSequencePlayback,
    validPresetIds,
  ]);

  return {
    handleExportLibrary,
    handleImportLibrary,
  };
}
