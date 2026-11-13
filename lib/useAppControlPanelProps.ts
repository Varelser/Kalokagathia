import { useCallback } from 'react';
import { PUBLIC_PRESET_LIBRARY, loadInitialPrivateConfig, normalizeConfig } from './appState';
import { getCachedStarterPresetLibrary } from './lazyStarterLibrary';
import { ControlPanelProps } from '../components/controlPanelTypes';
import type { ParticleConfig } from '../types';

export type UseAppControlPanelPropsArgs = Omit<ControlPanelProps, 'togglePlay' | 'onSave' | 'onReset'> & {
  isPublicLibraryMode: boolean;
  setConfig: React.Dispatch<React.SetStateAction<ParticleConfig>>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveTrigger: React.Dispatch<React.SetStateAction<number>>;
};

export function useAppControlPanelProps({
  isPublicLibraryMode,
  setConfig,
  setIsPlaying,
  setSaveTrigger,
  ...props
}: UseAppControlPanelPropsArgs): ControlPanelProps {
  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, [setIsPlaying]);

  const onSave = useCallback(() => {
    setSaveTrigger((prev) => prev + 1);
  }, [setSaveTrigger]);

  const onReset = useCallback(() => {
    setConfig(
      isPublicLibraryMode
        ? normalizeConfig(PUBLIC_PRESET_LIBRARY.currentConfig)
        // The starter library is loaded lazily at mount in private mode, so
        // by reset time it is cached; if it somehow is not, this falls back
        // to the default config, matching loadInitialPrivateConfig().
        : loadInitialPrivateConfig(getCachedStarterPresetLibrary()),
    );
  }, [isPublicLibraryMode, setConfig]);

  return {
    ...props,
    onReset,
    onSave,
    setConfig,
    togglePlay,
  };
}
