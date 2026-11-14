import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AppBodyScene } from './components/AppBodyScene';
import { AppEmbedPlayer } from './components/AppEmbedPlayer';
import { AppKioskPlayer } from './components/AppKioskPlayer';
import { AppModeGate } from './components/AppModeGate';
import { isEmbedMode } from './lib/embedMode';
import { isKioskMode } from './lib/kioskMode';
import { useKioskMode } from './lib/useKioskMode';
import type { ParticleConfig, PresetRecord, PresetSequenceItem } from './types';
import {
  getInterLayerContactAmount,
  hasPersistedPresetRecords,
  hasPersistedPresetSequence,
  LIBRARY_SCOPE,
  loadInitialPrivateConfig,
  loadPresetSequence,
  normalizeConfig,
  PUBLIC_PRESET_LIBRARY,
} from './lib/appState';
import { loadStarterPresetLibrary, useStarterPresetLibrary } from './lib/lazyStarterLibrary';
import { useStorageHydrated } from './lib/storageDb';
import { useAppControlPanelBridge } from './lib/useAppControlPanelBridge';
import { useAppLayerPreview } from './lib/useAppLayerPreview';
import { useAppPresetActions } from './lib/useAppPresetActions';
import { useAppSnapshots } from './lib/useAppSnapshots';
import { useAudioController } from './lib/useAudioController';
import { useExportController } from './lib/useExportController';
import { useAppUiState } from './lib/useAppUiState';
import { useLibraryTransfer } from './lib/useLibraryTransfer';
import { useConfigHistory } from './lib/useConfigHistory';
import { useConfigUndoRedo } from './lib/useConfigUndoRedo';
import { createPointCloudCaptureState, type PointCloudCaptureState } from './lib/pointCloudExport';
import { usePresetLibrary } from './lib/usePresetLibrary';
import { usePresetTransition } from './lib/usePresetTransition';
import { useProjectTransfer } from './lib/useProjectTransfer';
import { useSequenceController } from './lib/useSequenceController';
import { decodeConfigPayload, enterSharedView, fetchCatalogPreset, parseShareHash } from './lib/shareLink';
import { maybeWarnHeavyPreset } from './lib/gpuTierWarnings';
import { initGpuTier } from './lib/gpuTier';
import { requestPersistentStorageOnce } from './lib/platformFeatures';
import { useGpuTierFeatureWarnings } from './lib/useGpuTierFeatureWarnings';
import { GpuTierWarningHost } from './components/GpuTierWarningHost';
import { AUDIO_BRIDGE_MODE_PARAM, AUDIO_BRIDGE_MODE_VALUE } from './lib/audioBridge';

const AppBody: React.FC = () => {
  const isPublicLibraryMode = LIBRARY_SCOPE === 'public';
  // Embed mode (ultimate Wave 3, lib/embedMode): ?embed=1 boots the
  // chrome-free player for iframes on external sites. Every hook below
  // still runs unchanged — config, the share-link effect (including the
  // starter-library #p= safeguard) and playback are identical — only
  // the final render swaps the four-edge deck for the embed player, so
  // ControlPanel and its lazy panel chunks never mount.
  const embedMode = isEmbedMode();
  // Kiosk mode (ultimate Wave 5, lib/kioskMode): ?kiosk=1 boots the
  // canvas-only exhibition mode with an auto-rotating attract loop.
  // When both params are present KIOSK TAKES PRECEDENCE over embed
  // (the render branch below checks kiosk first): an exhibition
  // terminal must never show the embed control cluster.
  const kioskMode = isKioskMode();
  const [config, setConfig] = useState<ParticleConfig>(() => (
    isPublicLibraryMode ? normalizeConfig(PUBLIC_PRESET_LIBRARY.currentConfig) : loadInitialPrivateConfig()
  ));
  // The starter library (largest data chunk) loads lazily in private mode
  // only; public mode renders from PUBLIC_PRESET_LIBRARY immediately and
  // never downloads it. In private mode the initial config/sequence start
  // from persisted state or a placeholder and are filled in on arrival by
  // the effect further below (presets/active fill lives in usePresetLibrary).
  const starterLibrary = useStarterPresetLibrary(!isPublicLibraryMode);
  const initialConfigRef = useRef<ParticleConfig | null>(null);
  if (initialConfigRef.current === null) {
    initialConfigRef.current = config;
  }
  const hadPersistedPresetsRef = useRef<boolean | null>(null);
  if (hadPersistedPresetsRef.current === null) {
    hadPersistedPresetsRef.current = !isPublicLibraryMode && hasPersistedPresetRecords();
  }
  const hadPersistedSequenceRef = useRef<boolean | null>(null);
  if (hadPersistedSequenceRef.current === null) {
    hadPersistedSequenceRef.current = !isPublicLibraryMode && hasPersistedPresetSequence();
  }
  const ui = useAppUiState();
  // IndexedDB hydration (Phase 1 renewal): kicked off at the root so the
  // one-time localStorage → IndexedDB migration runs once, without
  // blocking first paint. Storage consumers gate their writes on the
  // settled flag (see usePresetLibrary / useSequencePlayback), and the
  // storageDb write queue itself waits for hydration before touching
  // IndexedDB, so nothing here can race the migration copy.
  useStorageHydrated(true);
  useEffect(() => { initGpuTier(); }, []);
  // Perf stage 5: mark the visit so index.html's static poster (a capture
  // of the default scene, shown only to first-time visitors) stays off for
  // returning users, whose restored scene would not match it.
  useEffect(() => {
    try { localStorage.setItem('kalokagathia.visited.v1', '1'); } catch { /* storage unavailable */ }
  }, []);
  // Ask the browser to keep this origin's storage persistent so the
  // IndexedDB payloads survive storage-pressure eviction (console-only).
  useEffect(() => { requestPersistentStorageOnce(); }, []);
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
    // Perf stage 4: the starter library now loads on an idle schedule,
    // so a #p= link to a starter preset can arrive before the library
    // (and before `presets` contains it). Resolve the starter library
    // explicitly before falling back to the catalog fetch — this also
    // closes the same race that existed with the old immediate load.
    void (async () => {
      if (!isPublicLibraryMode) {
        try {
          const starter = await loadStarterPresetLibrary();
          const hit = starter.presets.find((preset) => preset.id === parsed.id);
          if (hit) {
            setPresets((prev) => (prev.some((preset) => preset.id === hit.id) ? prev : [...prev, hit]));
            applyConfigMorph(hit.config, presetBlendDuration, hit.id);
            return;
          }
        } catch {
          /* starter load failed: fall through to the catalog fetch */
        }
      }
      fetchCatalogPreset(parsed.id)
        .then((rec) => {
          if (rec) {
            setPresets((prev) => (prev.some((preset) => preset.id === rec.id) ? prev : [...prev, rec]));
            applyConfigMorph(rec.config, presetBlendDuration, rec.id);
          }
        })
        .catch(() => { /* unknown preset id: keep the default scene */ });
    })();
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
    hadPersistedSequence: hadPersistedSequenceRef.current ?? false,
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

  // Global undo/redo (ultimate Wave 2): watches the live config and
  // commits settled states; sequence playback suspends recording (its
  // steps are a performance, not edits). Restores stop playback and any
  // in-flight morph, then apply instantly.
  const {
    canRedo: canRedoConfig,
    canUndo: canUndoConfig,
    redo: redoConfig,
    undo: undoConfig,
  } = useConfigUndoRedo({
    applyConfig: (nextConfig: ParticleConfig) => {
      stopSequencePlayback();
      applyConfigInstant(nextConfig, null);
    },
    config,
    suspended: isSequencePlaying,
  });

  // Kiosk attract loop (ultimate Wave 5): a no-op unless ?kiosk=1.
  // It rotates presets — the visitor's own sequence when one exists,
  // else a default spread of the starter sequence — through the same
  // applyConfigMorph engine sequence playback uses, without touching
  // the shared (persisted) sequence state. See lib/useKioskMode.
  const kiosk = useKioskMode({
    active: kioskMode,
    activePresetId,
    applyConfigMorph,
    isPublicLibraryMode,
    presetSequence,
    presets,
    starterLibrary,
  });

  // Starter fill-in (private mode): reproduce the old synchronous initial
  // state once the lazy starter library arrives. The config is only replaced
  // while it is still the untouched initial placeholder, and the sequence
  // only while it still equals its initial value, so anything the visitor
  // (or a share link) changed in the meantime is kept.
  useEffect(() => {
    if (isPublicLibraryMode || !starterLibrary) {
      return;
    }
    setConfig((prev) => (
      prev === initialConfigRef.current
        ? loadInitialPrivateConfig(starterLibrary)
        : prev
    ));
    if (!hadPersistedSequenceRef.current) {
      // Old fallback semantics: the starter sequence filtered by the valid
      // preset ids — the starter ids themselves when presets also came from
      // the starter fallback, otherwise the persisted library's ids.
      const filterIds = hadPersistedPresetsRef.current
        ? validPresetIds
        : new Set(starterLibrary.presets.map((preset) => preset.id));
      const starterSequence = loadPresetSequence(filterIds, starterLibrary);
      setPresetSequence((prev) => {
        const initial = initialPresetSequenceRef.current ?? [];
        const untouched = prev.length === initial.length
          && prev.every((item, index) => item.id === initial[index]?.id);
        return untouched ? starterSequence : prev;
      });
    }
  }, [isPublicLibraryMode, starterLibrary, setConfig, setPresetSequence, validPresetIds]);

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

  // Generated-collection shelf loads: the same RESOLUTION path share
  // links use — a record already in the library loads normally; otherwise
  // it is fetched from /presets/<id>.json (fetchCatalogPreset, the exact
  // helper the share effect uses) and appended to the library. The apply
  // itself is the shelf's standard instant load (the same verb as
  // handleLoadPreset), NOT the share flow's morph: hot-morphing into a
  // heavy post-processing configuration can crash the postprocessing
  // composer under SwiftShader (Pass.setRenderer reading .alpha of
  // null), while the instant load of the same record is clean — and
  // instant is what every other shelf card does. The share-link flow
  // itself is unchanged (cold morph at load). Resolves false when the
  // record cannot be fetched (the shelf shows a quiet note).
  const handleLoadGeneratedPreset = useCallback(
    async (presetId: string): Promise<boolean> => {
      if (presets.some((preset) => preset.id === presetId)) {
        handleLoadPreset(presetId);
        return true;
      }
      const rec = await fetchCatalogPreset(presetId);
      if (!rec) return false;
      stopSequencePlayback();
      maybeWarnHeavyPreset(rec);
      setPresets((prev) => (prev.some((preset) => preset.id === rec.id) ? prev : [...prev, rec]));
      applyConfigInstant(rec.config, rec.id);
      return true;
    },
    [applyConfigInstant, handleLoadPreset, presets, setPresets, stopSequencePlayback],
  );

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
    canRedoConfig,
    canUndoConfig,
    onRedoConfig: redoConfig,
    onUndoConfig: undoConfig,
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
    onLoadGeneratedPreset: handleLoadGeneratedPreset,
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

  if (kioskMode) {
    return (
      <AppKioskPlayer
        audioRef={audioRef}
        config={config}
        displayConfig={displayConfig}
        hintVisible={kiosk.hintVisible}
        onExitKiosk={kiosk.exitKiosk}
        paused={kiosk.paused}
        rendererRef={rendererRef}
        rotationReady={kiosk.rotationReady}
        saveTrigger={ui.saveTrigger}
        sequenceStepProgress={kiosk.stepProgress}
        pointCloudCaptureRef={pointCloudCaptureRef}
      />
    );
  }

  if (embedMode) {
    return (
      <AppEmbedPlayer
        audioRef={audioRef}
        config={config}
        displayConfig={displayConfig}
        isPlaying={ui.isPlaying}
        isSequencePlaying={isSequencePlaying}
        onTogglePlay={() => ui.setIsPlaying(!ui.isPlaying)}
        rendererRef={rendererRef}
        saveTrigger={ui.saveTrigger}
        sequenceStepProgress={sequenceStepProgress}
        pointCloudCaptureRef={pointCloudCaptureRef}
      />
    );
  }

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
