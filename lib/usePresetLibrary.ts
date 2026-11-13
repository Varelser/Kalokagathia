import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ParticleConfig, PresetRecord } from '../types';
import {
  hasPersistedPresetRecords,
  loadPresetRecords,
  normalizeConfig,
  parsePersistedPresetRecords,
  PRESET_STORAGE_KEY,
  PUBLIC_PRESET_LIBRARY,
} from './appState';
import type { Notice } from './audioControllerTypes';
import { persistPresetRecordsVerifiedIdb } from './presetLibraryPersist';
import { getHydratedPayload, useStorageHydrated } from './storageDb';
import { createPresetRecord, duplicatePresetRecord } from './presetRecordFactory';
import { buildRandomizedPresetConfig } from './presetRandomizer';
import { isStarterPresetLibrary, useStarterPresetLibrary } from './lazyStarterLibrary';

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
  // Private mode loads the starter library lazily (it is the largest data
  // chunk in the app); public mode never downloads it. While it is in flight
  // a private first visit renders the persisted library, or an empty
  // placeholder when nothing is persisted yet, and the effect below fills
  // in the starter records exactly as the old synchronous path did.
  const starterLibrary = useStarterPresetLibrary(!isPublicLibraryMode);
  const hadPersistedPresetsRef = useRef<boolean | null>(null);
  if (hadPersistedPresetsRef.current === null) {
    hadPersistedPresetsRef.current = !isPublicLibraryMode && hasPersistedPresetRecords();
  }

  // IndexedDB hydration (Phase 1 renewal): the initial state below is
  // built from the localStorage path exactly as before; once hydration
  // settles, the fill-in effect further below replaces it with the
  // IndexedDB payload when one exists. Every mutation through the tracked
  // setter marks the library as user-edited, which the fill-in respects.
  const storageHydrated = useStorageHydrated(!isPublicLibraryMode);
  const [presetsStorageReady, setPresetsStorageReady] = useState<boolean>(() => isPublicLibraryMode);
  const userEditedPresetsRef = useRef(false);

  const [presets, setPresetsState] = useState<PresetRecord[]>(() => (
    isPublicLibraryMode ? PUBLIC_PRESET_LIBRARY.presets : loadPresetRecords()
  ));
  const setPresets = useCallback<Dispatch<SetStateAction<PresetRecord[]>>>((action) => {
    userEditedPresetsRef.current = true;
    setPresetsState(action);
  }, []);
  const [activePresetId, setActivePresetId] = useState<string | null>(() => (
    isPublicLibraryMode
      ? (PUBLIC_PRESET_LIBRARY.activePresetId ?? PUBLIC_PRESET_LIBRARY.presets[0]?.id ?? null)
      : null
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
  }, [config, isPublicLibraryMode, presets.length, setPresets]);

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
  }, [config, isPublicLibraryMode, setPresets]);

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
  }, [isPublicLibraryMode, setPresets]);

  /** Create a preset record directly from an arbitrary config (used by preset breeding). Returns the created record, or null when the library is read-only. Does not change the current config; callers apply it explicitly. */
  const handleSaveBredPreset = useCallback((bredConfig: ParticleConfig, name: string): PresetRecord | null => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return null;
    }

    const preset = createPresetRecord(normalizeConfig(bredConfig), name, presets.length);
    setPresets((prev) => [preset, ...prev]);
    return preset;
  }, [isPublicLibraryMode, presets.length, setPresets]);

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
  }, [isPublicLibraryMode, presets, setConfig, setPresets]);

  const handleDeletePreset = useCallback((presetId: string) => {
    if (isPublicLibraryMode) {
      setLibraryNotice({ tone: 'error', message: 'Public library is read-only in this build.' });
      return;
    }

    setPresets((prev) => prev.filter((preset) => preset.id !== presetId));
    setActivePresetId((prev) => (prev === presetId ? null : prev));
  }, [isPublicLibraryMode, setPresets]);

  const handleDismissLibraryNotice = useCallback(() => {
    setLibraryNotice(null);
  }, []);

  const persistFailedRef = useRef(false);

  // Starter fill-in: when the lazy starter library arrives for a private
  // first visit (nothing persisted), reproduce the old synchronous initial
  // state — starter presets (deduped, in order) and the starter active
  // preset. If the visitor already created presets in the meantime, theirs
  // stay in front and the starter records are appended, matching the order
  // the old path would have produced.
  useEffect(() => {
    if (isPublicLibraryMode || !starterLibrary || hadPersistedPresetsRef.current) {
      return;
    }
    const starterRecords = loadPresetRecords(starterLibrary);
    setPresetsState((prev) => {
      if (prev.length === 0) {
        return starterRecords;
      }
      const seen = new Set(prev.map((preset) => preset.id));
      return [...prev, ...starterRecords.filter((preset) => !seen.has(preset.id))];
    });
    setActivePresetId((prev) => prev ?? starterLibrary.activePresetId ?? null);
  }, [isPublicLibraryMode, starterLibrary]);

  // IndexedDB fill-in: once hydration has settled, a persisted IndexedDB
  // payload is authoritative (it is the only store that can hold an
  // oversized library). An untouched library is replaced wholesale; if
  // the visitor already edited in the brief pre-hydration window, their
  // new records stay in front and the IndexedDB records follow, so no
  // edit is lost either way. Runs once — afterwards presetsStorageReady
  // unlocks the persist effect below.
  useEffect(() => {
    if (isPublicLibraryMode || !storageHydrated || presetsStorageReady) {
      return;
    }
    const raw = getHydratedPayload(PRESET_STORAGE_KEY);
    if (typeof raw === 'string') {
      const fromIdb = parsePersistedPresetRecords(raw);
      if (fromIdb) {
        setPresetsState((prev) => {
          if (!userEditedPresetsRef.current) {
            return fromIdb;
          }
          const idbIds = new Set(fromIdb.map((preset) => preset.id));
          const userOnly = prev.filter((preset) => !idbIds.has(preset.id));
          return [...userOnly, ...fromIdb];
        });
      }
    }
    setPresetsStorageReady(true);
  }, [isPublicLibraryMode, storageHydrated, presetsStorageReady]);

  const persistRunRef = useRef(0);

  useEffect(() => {
    if (isPublicLibraryMode || typeof window === 'undefined') {
      return;
    }
    if (!presetsStorageReady) {
      // Never persist before IndexedDB hydration has settled and the
      // fill-in above has run: the pre-hydration state can be a
      // localStorage-only (or empty) placeholder that must not clobber
      // the authoritative IndexedDB payload.
      return;
    }
    if (!starterLibrary) {
      // Defer the starter-identity decision (and persistence) until the
      // starter library has arrived; the check itself is unchanged.
      return;
    }
    if (presets.length === 0) {
      // Nothing to persist yet (the starter fill-in is still pending, or
      // every preset was deleted). An empty payload is treated as "absent"
      // by every reader, so skipping the write is load-equivalent and keeps
      // a first visit from touching localStorage at all.
      return;
    }
    if (isStarterPresetLibrary(presets, starterLibrary)) {
      return;
    }
    // Verified save (small-fix bundle, now IndexedDB-backed): write, read
    // back, and check the payload is the expected raw array containing
    // every record. A failure (quota, serialization, read-back mismatch)
    // is surfaced to the user once per failure streak instead of being
    // silently swallowed. Saves are serialized inside
    // persistPresetRecordsVerifiedIdb; the run id keeps a superseded
    // save's result from touching the notice state.
    const runId = ++persistRunRef.current;
    persistPresetRecordsVerifiedIdb(PRESET_STORAGE_KEY, presets)
      .then((result) => {
        if (runId !== persistRunRef.current) {
          return;
        }
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
      })
      .catch((error) => {
        if (runId !== persistRunRef.current) {
          return;
        }
        console.warn(`Failed to persist ${PRESET_STORAGE_KEY}:`, error);
        if (!persistFailedRef.current) {
          persistFailedRef.current = true;
          setLibraryNotice({
            tone: 'error',
            message: 'プリセットの保存に失敗しました（ブラウザの保存容量不足の可能性があります）。Library I/O の Export JSON でバックアップしてください。',
          });
        }
      });
  }, [isPublicLibraryMode, presets, starterLibrary, presetsStorageReady]);

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
