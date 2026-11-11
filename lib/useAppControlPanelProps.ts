import { useCallback } from 'react';
import { PUBLIC_PRESET_LIBRARY, loadInitialPrivateConfig, normalizeConfig } from './appState';
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
        : loadInitialPrivateConfig(),
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
