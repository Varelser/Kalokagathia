import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParticleConfig, PresetRecord } from '../types';
import {
  hasPersistedPresetRecords,
  loadPresetRecords,
  normalizeConfig,
  PRESET_STORAGE_KEY,
  PUBLIC_PRESET_LIBRARY,
} from './appState';
import type { Notice } from './audioControllerTypes';
import { persistPresetRecordsVerified } from './presetLibraryPersist';
import { createPresetRecord, duplicatePresetRecord } from './presetRecordFactory';
import { buildRandomizedPresetConfig } from './presetRandomizer';
import { STARTER_PRESET_LIBRARY } from './starterLibrary';

function isStarterPresetLibrary(presets: PresetRecord[]) {
  return presets.length === STARTER_PRESET_LIBRARY.presets.length
    && presets.every((preset, index) => preset.id === STARTER_PRESET_LIBRARY.presets[index]?.id);
}

type UsePresetLibraryArgs = {
  config: ParticleConfig;
  isPublicLibraryMode: boolean;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
};

export function usePresetLibrary({
  config,
  isPublicLibraryMode,
  setConfig,
}: UsePresetLibraryArgs) {
  const [presets, setPresets] = useState<PresetRecord[]>(() => (
    isPublicLibraryMode ? PUBLIC_PRESET_LIBRARY.presets : loadPresetRecords()
  ));
  const [activePresetId, setActivePresetId] = useState<string | null>(() => (
    isPublicLibraryMode
      ? (PUBLIC_PRESET_LIBRARY.activePresetId ?? PUBLIC_PRESET_LIBRARY.presets[0]?.id ?? null)
      : (hasPersistedPresetRecords() ? null : (STARTER_PRESET_LIBRARY.activePresetId ?? null))
  ));
  const [presetBlendDuration, setPresetBlendDuration] = useState(() => (
    isPublicLibraryMode ? PUBLIC_PRESET_LIBRARY.presetBlendDuration : 1.5
  ));
  const [libraryNotice, setLibraryNotice] = useState<Notice | null>(null);

  const validPresetIds = useMemo(
    () => new Set(presets.map((preset) => preset.id)),
    [presets],
  );

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === activePresetId) ?? null,
    [activePresetId, presets],
  );

  const isPresetDirty = useMemo(() => {
    if (!activePreset) {
      return false;
    }
    return JSON.stringify(activePreset.config) !== JSON.stringify(config);
  }, [activePreset, config]);

  const handleRandomize = useCallback(() => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public build is locked for exhibition viewing.' });
      return;
    }

    setConfig((prev) => normalizeConfig(buildRandomizedPresetConfig(prev)));
  }, [isPublicLibraryMode, setConfig]);

  const handleCreatePreset = useCallback((name: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    const preset = createPresetRecord(config, name, presets.length);
    setPresets((prev) => [preset, ...prev]);
    setActivePresetId(preset.id);
  }, [config, isPublicLibraryMode, presets.length]);

  const handleOverwritePreset = useCallback((presetId: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    const now = new Date().toISOString();
    setPresets((prev) => prev.map((preset) => (
      preset.id === presetId
        ? { ...preset, config: normalizeConfig(config), updatedAt: now }
        : preset
    )));
    setActivePresetId(presetId);
  }, [config, isPublicLibraryMode]);

  const handleRenamePreset = useCallback((presetId: string, nextName: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      return;
    }

    const now = new Date().toISOString();
    setPresets((prev) => prev.map((preset) => (
      preset.id === presetId
        ? { ...preset, name: trimmedName, updatedAt: now }
        : preset
    )));
  }, [isPublicLibraryMode]);

  /** Create a preset record directly from an arbitrary config (used by preset breeding). Returns the created record, or null when the library is read-only. Does not change the current config; callers apply it explicitly. */
  const handleSaveBredPreset = useCallback((bredConfig: ParticleConfig, name: string): PresetRecord | null => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return null;
    }

    const preset = createPresetRecord(normalizeConfig(bredConfig), name, presets.length);
    setPresets((prev) => [preset, ...prev]);
    return preset;
  }, [isPublicLibraryMode, presets.length]);

  const handleDuplicatePreset = useCallback((presetId: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    const sourcePreset = presets.find((preset) => preset.id === presetId);
    if (!sourcePreset) {
      return;
    }

    const duplicate = duplicatePresetRecord(sourcePreset);
    setPresets((prev) => [duplicate, ...prev]);
    setActivePresetId(duplicate.id);
    setConfig(normalizeConfig(duplicate.config));
  }, [isPublicLibraryMode, presets, setConfig]);

  const handleDeletePreset = useCallback((presetId: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    setPresets((prev) => prev.filter((preset) => preset.id !== presetId));
    setActivePresetId((prev) => (prev === presetId ? null : prev));
  }, [isPublicLibraryMode]);

  const handleDismissLibraryNotice = useCallback(() => {
    setLibraryNotice(null);
  }, []);

  const persistFailedRef = useRef(false);

  useEffect(() => {
    if (isPublicLibraryMode || typeof window === 'undefined') {
      return;
    }
    if (isStarterPresetLibrary(presets)) {
      return;
    }
    // Verified save (small-fix bundle): write, read back, and check the
    // payload is the expected raw array containing every record. A failure
    // (quota, serialization, read-back mismatch) is surfaced to the user
    // once per failure streak instead of being silently swallowed.
    const result = persistPresetRecordsVerified(window.localStorage, PRESET_STORAGE_KEY, presets);
    if (!result.ok) {
      console.warn(`Failed to persist ${PRESET_STORAGE_KEY}:`, result.reason);
      if (!persistFailedRef.current) {
        persistFailedRef.current = true;
        setLibraryNotice({
          tone: 'error',
          message: 'プリセットの保存に失敗しました（ブラウザの保存容量不足の可能性があります）。Library I/O の Export JSON でバックアップしてください。',
        });
      }
    } else {
      persistFailedRef.current = false;
    }
  }, [isPublicLibraryMode, presets]);

  return {
    activePresetId,
    handleCreatePreset,
    handleDeletePreset,
    handleDismissLibraryNotice,
    handleDuplicatePreset,
    handleOverwritePreset,
    handleRandomize,
    handleRenamePreset,
    handleSaveBredPreset,
    isPresetDirty,
    libraryNotice,
    presetBlendDuration,
    presets,
    setActivePresetId,
    setLibraryNotice,
    setPresets,
    setPresetBlendDuration,
    validPresetIds,
  };
}
