import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ParticleConfig } from '../types';
import type { LayerFocusMode, LayerToggleState } from '../components/controlPanelTypes';
import { normalizeConfig } from './appState';

interface UseAppLayerPreviewOptions {
  config: ParticleConfig;
  layerFocusMode: LayerFocusMode;
  layerMuteState: LayerToggleState;
  setLayerFocusMode: Dispatch<SetStateAction<LayerFocusMode>>;
  setLayerLockState: Dispatch<SetStateAction<LayerToggleState>>;
  setLayerMuteState: Dispatch<SetStateAction<LayerToggleState>>;
}

export const useAppLayerPreview = ({
  config,
  layerFocusMode,
  layerMuteState,
  setLayerFocusMode,
  setLayerLockState,
  setLayerMuteState,
}: UseAppLayerPreviewOptions) => {
  const toggleLayerMute = useCallback((layer: keyof LayerToggleState) => {
    setLayerMuteState((prev) => ({ ...prev, [layer]: !prev[layer] }));
    setLayerFocusMode('all');
  }, [setLayerFocusMode, setLayerMuteState]);

  const toggleLayerLock = useCallback((layer: keyof LayerToggleState) => {
    setLayerLockState((prev) => ({ ...prev, [layer]: !prev[layer] }));
  }, [setLayerLockState]);

  const displayConfig = useMemo(() => {
    const next = normalizeConfig(config);
    const visible = {
      layer1: !layerMuteState.layer1 && (layerFocusMode === 'all' || layerFocusMode === 'layer1'),
      layer2: !layerMuteState.layer2 && (layerFocusMode === 'all' || layerFocusMode === 'layer2'),
      layer3: !layerMuteState.layer3 && (layerFocusMode === 'all' || layerFocusMode === 'layer3'),
    };
    next.layer1Enabled = next.layer1Enabled && visible.layer1;
    next.layer2Enabled = next.layer2Enabled && visible.layer2;
    next.layer3Enabled = next.layer3Enabled && visible.layer3;
    return next;
  }, [config, layerFocusMode, layerMuteState]);

  return {
    displayConfig,
    toggleLayerLock,
    toggleLayerMute,
  };
};
