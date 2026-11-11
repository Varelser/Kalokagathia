import { useState } from 'react';
import type { ComparePreviewOrientation, LayerFocusMode, LayerToggleState } from '../components/controlPanelTypes';

export function useAppUiState() {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [saveTrigger, setSaveTrigger] = useState(0);
  const [isPresetTransitioning, setIsPresetTransitioning] = useState(false);
  const [videoExportMode, setVideoExportMode] = useState<'current' | 'sequence'>('sequence');
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(8);
  const [videoFps, setVideoFps] = useState(30);
  const [layerFocusMode, setLayerFocusMode] = useState<LayerFocusMode>('all');
  const [layerMuteState, setLayerMuteState] = useState<LayerToggleState>({ layer1: false, layer2: false, layer3: false });
  const [layerLockState, setLayerLockState] = useState<LayerToggleState>({ layer1: false, layer2: false, layer3: false });
  const [comparePreviewEnabled, setComparePreviewEnabled] = useState(false);
  const [comparePreviewOrientation, setComparePreviewOrientation] = useState<ComparePreviewOrientation>('vertical');
  const [comparePreviewSlotIndex, setComparePreviewSlotIndex] = useState(0);

  return {
    comparePreviewEnabled,
    comparePreviewOrientation,
    comparePreviewSlotIndex,
    isPanelOpen,
    isPlaying,
    isPresetTransitioning,
    layerFocusMode,
    layerLockState,
    layerMuteState,
    saveTrigger,
    setComparePreviewEnabled,
    setComparePreviewOrientation,
    setComparePreviewSlotIndex,
    setIsPanelOpen,
    setIsPlaying,
    setIsPresetTransitioning,
    setLayerFocusMode,
    setLayerLockState,
    setLayerMuteState,
    setSaveTrigger,
    setVideoDurationSeconds,
    setVideoExportMode,
    setVideoFps,
    videoDurationSeconds,
    videoExportMode,
    videoFps,
  };
}
