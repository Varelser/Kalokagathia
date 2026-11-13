import { useEffect, useState } from 'react';
import type { PresetLibraryData, PresetRecord, PresetSequenceItem } from '../types';

/**
 * Lazy access to the starter preset library (lib/starterLibrary).
 *
 * The starter/operator preset data is by far the largest data module in the
 * app (~370KB chunk). It used to be statically imported by the app-state
 * layer, which forced every visitor — including public-mode visitors who
 * never see it — to download and parse it before first paint. It is now
 * loaded through a dynamic import on first private-mode mount instead.
 *
 * Identity checks below take the loaded library as a parameter and use the
 * exact same expressions the previous static checks used against
 * STARTER_PRESET_LIBRARY, so their results are unchanged once the chunk has
 * arrived; callers defer the decision while it is still in flight.
 */

let cachedStarterLibrary: PresetLibraryData | null = null;
let starterLibraryPromise: Promise<PresetLibraryData> | null = null;

export function getCachedStarterPresetLibrary(): PresetLibraryData | null {
  return cachedStarterLibrary;
}

export function loadStarterPresetLibrary(): Promise<PresetLibraryData> {
  if (cachedStarterLibrary) {
    return Promise.resolve(cachedStarterLibrary);
  }
  if (!starterLibraryPromise) {
    starterLibraryPromise = import('./starterLibrary')
      .then((mod) => {
        cachedStarterLibrary = mod.STARTER_PRESET_LIBRARY;
        return cachedStarterLibrary;
      })
      .catch((error) => {
        starterLibraryPromise = null;
        throw error;
      });
  }
  return starterLibraryPromise;
}

/**
 * Returns the starter library once loaded, or null while it is in flight.
 * Loading only starts when `enabled` is true (private library mode); public
 * mode never downloads the starter chunk.
 */
export function useStarterPresetLibrary(enabled: boolean): PresetLibraryData | null {
  const [library, setLibrary] = useState<PresetLibraryData | null>(() => cachedStarterLibrary);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    loadStarterPresetLibrary()
      .then((loaded) => {
        if (!cancelled) {
          setLibrary(loaded);
        }
      })
      .catch((error) => {
        console.warn('Failed to load starter preset library:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return library;
}

/** Exact copy of the previous static check in usePresetLibrary, parameterized by the loaded library. */
export function isStarterPresetLibrary(presets: PresetRecord[], library: PresetLibraryData): boolean {
  return presets.length === library.presets.length
    && presets.every((preset, index) => preset.id === library.presets[index]?.id);
}

/** Exact copy of the previous static check in useSequencePlayback, parameterized by the loaded library. */
export function isStarterPresetSequence(presetSequence: PresetSequenceItem[], library: PresetLibraryData): boolean {
  return presetSequence.length === library.presetSequence.length
    && presetSequence.every((item, index) => item.id === library.presetSequence[index]?.id);
}
