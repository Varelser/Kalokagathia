import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AppBodyScene } from './components/AppBodyScene';
import { AppModeGate } from './components/AppModeGate';
import type { ParticleConfig, PresetRecord, PresetSequenceItem } from './types';
import {
  getInterLayerContactAmount,
  LIBRARY_SCOPE,
  loadInitialPrivateConfig,
  loadPresetSequence,
  normalizeConfig,
  PUBLIC_PRESET_LIBRARY,
} from './lib/appState';
import { useAppControlPanelBridge } from './lib/useAppControlPanelBridge';
import { useAppLayerPreview } from './lib/useAppLayerPreview';
import { useAppPresetActions } from './lib/useAppPresetActions';
import { useAppSnapshots } from './lib/useAppSnapshots';
import { useAudioController } from './lib/useAudioController';
import { useExportController } from './lib/useExportController';
import { useAppUiState } from './lib/useAppUiState';
import { useLibraryTransfer } from './lib/useLibraryTransfer';
import { useConfigHistory } from './lib/useConfigHistory';
import { createPointCloudCaptureState, type PointCloudCaptureState } from './lib/pointCloudExport';
import { usePresetLibrary } from './lib/usePresetLibrary';
import { usePresetTransition } from './lib/usePresetTransition';
import { useProjectTransfer } from './lib/useProjectTransfer';
import { useSequenceController } from './lib/useSequenceController';
import { decodeConfigPayload, enterSharedView, parseShareHash } from './lib/shareLink';
import { initGpuTier } from './lib/gpuTier';
import { useGpuTierFeatureWarnings } from './lib/useGpuTierFeatureWarnings';
import { GpuTierWarningHost } from './components/GpuTierWarningHost';
import { AUDIO_BRIDGE_MODE_PARAM, AUDIO_BRIDGE_MODE_VALUE } from './lib/audioBridge';

const AppBody: React.FC = () => {
  const isPublicLibraryMode = LIBRARY_SCOPE === 'public';
  const [config, setConfig] = useState<ParticleConfig>(() => (
    isPublicLibraryMode ? normalizeConfig(PUBLIC_PRESET_LIBRARY.currentConfig) : loadInitialPrivateConfig()
  ));
  const ui = useAppUiState();
  useEffect(() => { initGpuTier(); }, []);
  useGpuTierFeatureWarnings(config);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pointCloudCaptureRef = useRef<PointCloudCaptureState>(createPointCloudCaptureState());
  const initialPresetSequenceRef = useRef<PresetSequenceItem[] | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);

  const {
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
  } = usePresetLibrary({
    config,
    isPublicLibraryMode,
    setConfig,
  });

  const {
    applyConfigInstant,
    applyConfigMorph,
    latestConfigRef,
    stopPresetTransition,
  } = usePresetTransition({
    config,
    setActivePresetId,
    setConfig,
    setIsPresetTransitioning: ui.setIsPresetTransitioning,
  });

  const { entries: configHistoryEntries, clearHistory: clearConfigHistory } = useConfigHistory(config);

  // Share links: /#p=<presetId> applies a preset (local library first, then
  // /presets/<id>.json), /#c=<payload> applies an inline config snapshot.
  // Opening via a share link enters shared view (AI relay off) — see lib/shareLink.
  const shareHandledRef = useRef(false);
  useEffect(() => {
    if (shareHandledRef.current) return;
    shareHandledRef.current = true;
    const parsed = parseShareHash(window.location.hash);
    if (!parsed) return;
    enterSharedView();
    if (parsed.kind === 'config') {
      decodeConfigPayload(parsed.payload).then((data) => {
        if (data?.config) applyConfigMorph(data.config as unknown as ParticleConfig, presetBlendDuration, null);
      }).catch(() => { /* malformed payload: keep the default scene */ });
      return;
    }
    const local = presets.find((preset) => preset.id === parsed.id);
    if (local) {
      applyConfigMorph(local.config, presetBlendDuration, local.id);
      return;
    }
    fetch(`/presets/${encodeURIComponent(parsed.id)}.json`)
      .then((r) => ((r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then((rec: PresetRecord | null) => {
        if (rec && rec.id === parsed.id && rec.config && typeof rec.config === 'object') {
          setPresets((prev) => (prev.some((preset) => preset.id === rec.id) ? prev : [...prev, rec]));
          applyConfigMorph(rec.config, presetBlendDuration, rec.id);
        }
      })
      .catch(() => { /* unknown preset id: keep the default scene */ });
  }, [applyConfigMorph, presetBlendDuration, presets, setPresets]);

  if (initialPresetSequenceRef.current === null) {
    initialPresetSequenceRef.current = isPublicLibraryMode
      ? PUBLIC_PRESET_LIBRARY.presetSequence
      : loadPresetSequence(validPresetIds);
  }

  const interLayerContactAmount = useMemo(() => getInterLayerContactAmount(config), [config]);

  const {
    audioRef,
    audioNotice,
    dismissAudioNotice,
    handleAudioSourceModeChange,
    isAudioActive,
    microphoneStreamRef,
    sharedAudioStreamRef,
    startAudio,
    stopAudio,
    synthEngineRef,
  } = useAudioController({
    config,
    latestConfigRef,
    setConfig,
  });

  const {
    activeSequenceItemId,
    handleAddPresetToSequence,
    handleCaptureSequenceKeyframe,
    handleDuplicateSequenceItem,
    handleLoadSequenceItem,
    handleMoveSequenceItem,
    handleRemoveSequenceItem,
    handleRenameSequenceItem,
    handleReorderSequenceItem,
    handleResetSequenceKeyframe,
    handleSequenceDriveModeChange,
    handleSequenceDriveMultiplierChange,
    handleSequenceDriveStrengthModeChange,
    handleSequenceDriveStrengthOverrideChange,
    handleSequenceHoldChange,
    handleSequenceTransitionChange,
    handleSequenceTransitionEasingChange,
    handleStartSequencePlayback,
    handleStopSequencePlayback,
    isSequencePlaying,
    presetSequence,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    sequenceStepProgress,
    setActiveSequenceItemId,
    setPresetSequence,
    setSequenceLoopEnabled,
    stopSequencePlayback,
  } = useSequenceController({
    applyConfigInstant,
    applyConfigMorph,
    config,
    initialPresetSequence: initialPresetSequenceRef.current,
    initialSequenceLoopEnabled: isPublicLibraryMode ? PUBLIC_PRESET_LIBRARY.sequenceLoopEnabled : true,
    isPresetTransitioning: ui.isPresetTransitioning,
    isPublicLibraryMode,
    latestConfigRef,
    presetBlendDuration,
    presets,
    setLibraryNotice,
    validPresetIds,
  });

  const {
    dismissFrameNotice,
    dismissVideoNotice,
    frameNotice,
    isFrameExporting,
    isVideoRecording,
    startFrameExport,
    startVideoRecording,
    stopFrameExport,
    stopVideoRecording,
    videoNotice,
  } = useExportController({
    config,
    stopSequencePlayback,
    handleStartSequencePlayback,
    presetSequenceLength: presetSequence.length,
    rendererRef,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    setSequenceLoopEnabled,
    microphoneStreamRef,
    sharedAudioStreamRef,
    synthEngineRef,
    videoDurationSeconds: ui.videoDurationSeconds,
    videoExportMode: ui.videoExportMode,
    videoFps: ui.videoFps,
  });

  const { handleExportLibrary, handleImportLibrary } = useLibraryTransfer({
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
  });

  const {
    dismissProjectNotice,
    handleExportProject,
    handleImportProject,
    projectManifest,
    projectNotice,
  } = useProjectTransfer({
    activePresetId,
    config,
    isPanelOpen: ui.isPanelOpen,
    isPlaying: ui.isPlaying,
    isPublicLibraryMode,
    presetBlendDuration,
    presetSequence,
    presets,
    sequenceLoopEnabled,
    setActivePresetId,
    setConfig,
    setIsPanelOpen: ui.setIsPanelOpen,
    setIsPlaying: ui.setIsPlaying,
    setPresetBlendDuration,
    setPresetSequence,
    setPresets,
    setSequenceLoopEnabled,
    setVideoDurationSeconds: ui.setVideoDurationSeconds,
    setVideoExportMode: ui.setVideoExportMode,
    setVideoFps: ui.setVideoFps,
    stopPresetTransition,
    stopSequencePlayback,
    validPresetIds,
    videoDurationSeconds: ui.videoDurationSeconds,
    videoExportMode: ui.videoExportMode,
    videoFps: ui.videoFps,
  });

  const {
    compareConfig,
    handleCaptureSnapshot,
    handleClearSnapshot,
    handleLoadSnapshot,
    handleMorphSnapshot,
    handleProjectFileChange,
    handleRenameSnapshot,
    handleSetSnapshotNote,
    snapshotSlots,
  } = useAppSnapshots({
    applyConfigInstant,
    applyConfigMorph,
    comparePreviewEnabled: ui.comparePreviewEnabled,
    comparePreviewSlotIndex: ui.comparePreviewSlotIndex,
    config,
    handleImportProject,
    presetBlendDuration,
  });

  const {
    displayConfig,
    toggleLayerLock,
    toggleLayerMute,
  } = useAppLayerPreview({
    config,
    layerFocusMode: ui.layerFocusMode,
    layerMuteState: ui.layerMuteState,
    setLayerFocusMode: ui.setLayerFocusMode,
    setLayerLockState: ui.setLayerLockState,
    setLayerMuteState: ui.setLayerMuteState,
  });

  const { handleLoadPreset, handleTransitionToPreset } = useAppPresetActions({
    applyConfigInstant,
    applyConfigMorph,
    presetBlendDuration,
    presets,
    stopSequencePlayback,
  });

  const controlPanelProps = useAppControlPanelBridge({
    activePresetId,
    activeSequenceItemId,
    audioNotice,
    audioLevelsRef: audioRef,
    audioSourceMode: config.audioSourceMode,
    comparePreviewEnabled: ui.comparePreviewEnabled,
    comparePreviewOrientation: ui.comparePreviewOrientation,
    comparePreviewSlotIndex: ui.comparePreviewSlotIndex,
    compareReferenceConfig: compareConfig,
    config,
    contactAmount: interLayerContactAmount,
    frameNotice,
    handleProjectFileChange,
    isAudioActive,
    isFrameExporting,
    isOpen: ui.isPanelOpen,
    isPlaying: ui.isPlaying,
    isPresetDirty,
    isPresetTransitioning: ui.isPresetTransitioning,
    isPublicLibraryMode,
    isSequencePlaying,
    isVideoRecording,
    layerFocusMode: ui.layerFocusMode,
    layerLockState: ui.layerLockState,
    layerMuteState: ui.layerMuteState,
    libraryNotice,
    libraryScope: LIBRARY_SCOPE,
    onAddPresetToSequence: handleAddPresetToSequence,
    onApplyConfig: (nextConfig: ParticleConfig) => {
      applyConfigInstant(nextConfig, null);
    },
    configHistoryEntries,
    onClearConfigHistory: clearConfigHistory,
    pointCloudCaptureRef,
    onAudioSourceModeChange: handleAudioSourceModeChange,
    onCaptureSequenceKeyframe: handleCaptureSequenceKeyframe,
    onCaptureSnapshot: handleCaptureSnapshot,
    onClearSnapshot: handleClearSnapshot,
    onCreatePreset: handleCreatePreset,
    onDeletePreset: handleDeletePreset,
    onDismissAudioNotice: dismissAudioNotice,
    onDismissFrameNotice: dismissFrameNotice,
    onDismissLibraryNotice: handleDismissLibraryNotice,
    onDismissProjectNotice: dismissProjectNotice,
    onDismissVideoNotice: dismissVideoNotice,
    onDuplicatePreset: handleDuplicatePreset,
    onDuplicateSequenceItem: handleDuplicateSequenceItem,
    onExportLibrary: handleExportLibrary,
    onExportProject: handleExportProject,
    onImportLibrary: handleImportLibrary,
    onLoadPreset: handleLoadPreset,
    onLoadSequenceItem: handleLoadSequenceItem,
    onLoadSnapshot: handleLoadSnapshot,
    onMorphSnapshot: handleMorphSnapshot,
    onMoveSequenceItem: handleMoveSequenceItem,
    onOverwritePreset: handleOverwritePreset,
    onPresetBlendDurationChange: setPresetBlendDuration,
    onRandomize: handleRandomize,
    onRemoveSequenceItem: handleRemoveSequenceItem,
    onRenamePreset: handleRenamePreset,
    onSaveBredPreset: (bredConfig: ParticleConfig, name: string) => {
      const record = handleSaveBredPreset(bredConfig, name);
      if (record) {
        applyConfigInstant(record.config, record.id);
      }
    },
    onSyncApplyPresets: (nextPresets: PresetRecord[]) => {
      setPresets(nextPresets);
    },
    onSyncNotice: (notice: { tone: 'success' | 'error'; message: string }) => {
      setLibraryNotice(notice);
    },
    onRenameSequenceItem: handleRenameSequenceItem,
    onRenameSnapshot: handleRenameSnapshot,
    onReorderSequenceItem: handleReorderSequenceItem,
    onResetSequenceKeyframe: handleResetSequenceKeyframe,
    onSequenceDriveModeChange: handleSequenceDriveModeChange,
    onSequenceDriveMultiplierChange: handleSequenceDriveMultiplierChange,
    onSequenceDriveStrengthModeChange: handleSequenceDriveStrengthModeChange,
    onSequenceDriveStrengthOverrideChange: handleSequenceDriveStrengthOverrideChange,
    onSequenceHoldChange: handleSequenceHoldChange,
    onSequenceLoopEnabledChange: setSequenceLoopEnabled,
    onSequenceTransitionChange: handleSequenceTransitionChange,
    onSequenceTransitionEasingChange: handleSequenceTransitionEasingChange,
    onSetComparePreviewEnabled: ui.setComparePreviewEnabled,
    onSetComparePreviewOrientation: ui.setComparePreviewOrientation,
    onSetComparePreviewSlotIndex: ui.setComparePreviewSlotIndex,
    onSetLayerFocusMode: ui.setLayerFocusMode,
    onSetSnapshotNote: handleSetSnapshotNote,
    onStartFrameExport: startFrameExport,
    onStartSequencePlayback: handleStartSequencePlayback,
    onStartVideoRecording: startVideoRecording,
    onStopFrameExport: stopFrameExport,
    onStopPresetTransition: stopPresetTransition,
    onStopSequencePlayback: handleStopSequencePlayback,
    onStopVideoRecording: stopVideoRecording,
    onToggleLayerLock: toggleLayerLock,
    onToggleLayerMute: toggleLayerMute,
    onTransitionToPreset: handleTransitionToPreset,
    onVideoDurationSecondsChange: ui.setVideoDurationSeconds,
    onVideoExportModeChange: ui.setVideoExportMode,
    onVideoFpsChange: ui.setVideoFps,
    presetBlendDuration,
    presetSequence,
    presets,
    projectInputRef,
    projectManifest,
    projectNotice,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    sequenceStepProgress,
    setConfig,
    setIsOpen: ui.setIsPanelOpen,
    setIsPlaying: ui.setIsPlaying,
    setSaveTrigger: ui.setSaveTrigger,
    snapshotSlots,
    startAudio,
    stopAudio,
    videoDurationSeconds: ui.videoDurationSeconds,
    videoExportMode: ui.videoExportMode,
    videoFps: ui.videoFps,
    videoNotice,
  });

  return (
    <>
    <AppBodyScene
      audioRef={audioRef}
      compareConfig={compareConfig}
      comparePreviewEnabled={ui.comparePreviewEnabled}
      comparePreviewOrientation={ui.comparePreviewOrientation}
      comparePreviewSlotIndex={ui.comparePreviewSlotIndex}
      config={config}
      controlPanelProps={controlPanelProps}
      displayConfig={displayConfig}
      isPlaying={ui.isPlaying}
      isSequencePlaying={isSequencePlaying}
      rendererRef={rendererRef}
      saveTrigger={ui.saveTrigger}
      sequenceStepProgress={sequenceStepProgress}
      pointCloudCaptureRef={pointCloudCaptureRef}
    />
    <GpuTierWarningHost />
    </>
  );
};

export default function App() {
  return (
    <AppModeGate appModeParam={AUDIO_BRIDGE_MODE_PARAM} appModeValue={AUDIO_BRIDGE_MODE_VALUE}>
      <AppBody />
    </AppModeGate>
  );
}
