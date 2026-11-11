import React from 'react';
import { ChevronDown, ChevronUp, Clapperboard } from 'lucide-react';
import {
  ControlPanelActions,
  ControlPanelFooter,
  ControlPanelHeader,
  ControlPanelRail,
  ControlPanelTabBar,
  ControlPanelTrigger,
  getTabTier,
  getTabsForTier,
  type PanelTier,
} from './controlPanelChrome';
import { ControlPanelContent } from './controlPanelTabs';
import { CommandPalette } from './CommandPalette';
import { ControlPanelProps } from './controlPanelTypes';
import { useControlPanelState } from './useControlPanelState';

export const ControlPanel: React.FC<ControlPanelProps> = (props) => {
  const [isWide, setIsWide] = React.useState(false);
  // Mobile bottom sheet (item 9): expanded = capped sheet (68dvh, see
  // styles.css), collapsed = slim handle bar only so the canvas is fully
  // visible. Desktop ignores this state (the toggle is display:none >640px).
  const [sheetCollapsed, setSheetCollapsed] = React.useState(false);
  const [deckHover, setDeckHover] = React.useState(true);
  const [deckFocus, setDeckFocus] = React.useState(false);
  // Gloss auto-adjust (idea 6): sample the scene behind the deck and deepen the
  // glass tint on bright scenes so text stays readable; dark scenes keep v7 gloss.
  const [glossBoost, setGlossBoost] = React.useState(0);
  React.useEffect(() => {
    if (!props.isOpen) return undefined;
    let cancelled = false;
    const sample = () => {
      try {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!canvas || canvas.width === 0) return;
        requestAnimationFrame(() => {
          if (cancelled) return;
          try {
            const c2 = document.createElement('canvas');
            c2.width = 8;
            c2.height = 8;
            const ctx = c2.getContext('2d');
            if (!ctx) return;
            const w = canvas.width;
            const h = canvas.height;
            ctx.drawImage(canvas, w * 0.55, 0, w * 0.45, h, 0, 0, 8, 8);
            const data = ctx.getImageData(0, 0, 8, 8).data;
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
              sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            }
            const lum = sum / 64;
            const boost = Math.max(0, Math.min(1, (lum - 0.35) / 0.5));
            const stepped = Math.round(boost * 20) / 20;
            setGlossBoost((prev) => (Math.abs(prev - stepped) >= 0.05 ? stepped : prev));
          } catch {
            /* sampling unavailable */
          }
        });
      } catch {
        /* ignore */
      }
    };
    sample();
    const id = window.setInterval(sample, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [props.isOpen]);
  const deckActive = deckHover || deckFocus;
  const {
    config,
    contactAmount,
    libraryScope,
    setConfig,
    isOpen,
    setIsOpen,
  } = props;
  const isPublicLibrary = libraryScope === 'public';
  const {
    activeTab,
    applyPerformancePreset,
    applyScreenFxPreset,
    audioActionLabel,
    draggingSequenceItemId,
    dropTargetSequenceItemId,
    editingPresetId,
    editingPresetName,
    formatPresetDate,
    handleCreatePreset,
    handleLibraryFileChange,
    handleSequenceDragEnd,
    handleSequenceDragOver,
    handleSequenceDragStart,
    handleSequenceDrop,
    handleStartRename,
    handleSubmitRename,
    libraryImportMode,
    libraryInputRef,
    lockedPanelClass,
    panelTier,
    presetName,
    setActiveTab,
    setPanelTier,
    setEditingPresetId,
    setEditingPresetName,
    setLibraryImportMode,
    setPresetName,
    updateConfig,
    updateLayer1Array,
    updateLayerArray,
    updateMotionArray,
    updatePositionArray,
  } = useControlPanelState({
    audioSourceMode: props.audioSourceMode,
    config,
    isAudioActive: props.isAudioActive,
    isPublicLibrary,
    onCreatePreset: props.onCreatePreset,
    onImportLibrary: props.onImportLibrary,
    onRenamePreset: props.onRenamePreset,
    onReorderSequenceItem: props.onReorderSequenceItem,
    layerLockState: props.layerLockState,
    setConfig,
  });

  const handleSelectTier = (tier: PanelTier) => {
    setPanelTier(tier);
    if (!getTabsForTier(tier).some((tab) => tab.id === activeTab)) {
      setActiveTab('play');
    }
  };

  const handleJumpToTab = (tab: typeof activeTab) => {
    const needed = getTabTier(tab);
    const rank = { play: 0, design: 1, lab: 2 } as const;
    if (rank[needed] > rank[panelTier]) {
      setPanelTier(needed);
    }
    setActiveTab(tab);
  };

  if (!isOpen) {
    return (
      <>
      <CommandPalette presets={props.presets} onLoadPreset={props.onLoadPreset} onJumpToTab={(tab) => { setIsOpen(true); handleJumpToTab(tab); }} onRevealParameter={(entry) => { (window as unknown as { __mgPendingReveal?: unknown }).__mgPendingReveal = { ...entry, at: Date.now() }; window.dispatchEvent(new CustomEvent('kalokagathia:reveal-setting', { detail: entry })); }} />
      <ControlPanelTrigger
        activeTab={activeTab}
        backgroundColor={config.backgroundColor}
        onOpen={() => setIsOpen(true)}
        onSelectTab={setActiveTab}
        tier={panelTier}
      />
      </>
    );
  }

  return (
    <div className="mg-deck pointer-events-none absolute inset-y-0 right-0 z-50 flex w-full justify-end p-3 text-white sm:p-4">
      <div className="pointer-events-auto">
        <CommandPalette presets={props.presets} onLoadPreset={props.onLoadPreset} onJumpToTab={handleJumpToTab} onRevealParameter={(entry) => { (window as unknown as { __mgPendingReveal?: unknown }).__mgPendingReveal = { ...entry, at: Date.now() }; window.dispatchEvent(new CustomEvent('kalokagathia:reveal-setting', { detail: entry })); }} />
      </div>
      <div
        onMouseEnter={() => setDeckHover(true)}
        onMouseLeave={() => setDeckHover(false)}
        onPointerDown={() => setDeckHover(true)}
        onFocusCapture={(e) => { const t = e.target as HTMLElement; setDeckFocus(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }}
        onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDeckFocus(false); }}
        className={`mg-sheet flex h-full w-full items-stretch justify-end transition-opacity duration-500 ${deckActive ? 'opacity-100' : 'opacity-[0.22]'} ${sheetCollapsed ? 'mg-sheet-collapsed' : ''} ${isWide ? 'max-w-[min(96vw,78rem)]' : 'max-w-[min(96vw,37rem)]'}`}>
        <ControlPanelRail
          activeTab={activeTab}
          isWide={isWide}
          onClose={() => setIsOpen(false)}
          onSelectTab={setActiveTab}
          onToggleWidth={() => setIsWide((prev) => !prev)}
          tier={panelTier}
          onSelectTier={handleSelectTier}
        />
        <div style={{ backgroundImage: `linear-gradient(118deg, rgba(255,255,255,${(0.15 - 0.05 * glossBoost).toFixed(3)}), rgba(255,255,255,0.03) 34%, rgba(0,0,0,${(0.08 + 0.14 * glossBoost).toFixed(3)}) 62%, rgba(0,0,0,${(0.16 + 0.22 * glossBoost).toFixed(3)}))` }} className="mg-sheet-panel pointer-events-auto flex min-w-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-white/25 bg-[linear-gradient(118deg,rgba(255,255,255,0.15),rgba(255,255,255,0.03)_34%,rgba(0,0,0,0.08)_62%,rgba(0,0,0,0.16))] shadow-[0_30px_90px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.38),inset_0_26px_38px_-24px_rgba(255,255,255,0.30),inset_0_-20px_32px_-20px_rgba(255,255,255,0.12)] backdrop-blur-md backdrop-saturate-200">
          <div className="mg-sheet-bar">
            <button
              type="button"
              data-testid="sheet-toggle"
              aria-expanded={!sheetCollapsed}
              onClick={() => setSheetCollapsed((prev) => !prev)}
              className="mg-sheet-toggle"
              title={sheetCollapsed ? 'コントロールを開く' : 'シートをたたんで作品だけ見る'}
            >
              <span className="mg-sheet-grip" aria-hidden="true" />
              <span className="mg-sheet-toggle-label">{sheetCollapsed ? 'コントロールを開く' : 'たたむ'}</span>
              {sheetCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            <button
              type="button"
              data-testid="cinema-toggle"
              onClick={() => window.dispatchEvent(new CustomEvent('kalokagathia:toggle-cinema'))}
              className="mg-cinema-toggle"
              title="鑑賞モード（UIを隠す）— 画面タップで戻る"
            >
              <Clapperboard size={16} />
              <span>鑑賞</span>
            </button>
          </div>
          <ControlPanelHeader
            activeTab={activeTab}
            isPublicLibrary={isPublicLibrary}
            isWide={isWide}
            onClose={() => setIsOpen(false)}
            onToggleWidth={() => setIsWide((prev) => !prev)}
          />
          <ControlPanelActions
            isPlaying={props.isPlaying}
            isPublicLibrary={isPublicLibrary}
            onRandomize={props.onRandomize}
            onReset={props.onReset}
            togglePlay={props.togglePlay}
          />
          <ControlPanelTabBar activeTab={activeTab} onSelectTab={setActiveTab} tier={panelTier} onSelectTier={handleSelectTier} />

          <ControlPanelContent
            activeTab={activeTab}
            config={config}
            contactAmount={contactAmount}
            isPublicLibrary={isPublicLibrary}
            lockedPanelClass={lockedPanelClass}
            updateConfig={updateConfig}
            applyPerformancePreset={applyPerformancePreset}
            applyScreenFxPreset={applyScreenFxPreset}
            presetName={presetName}
            setPresetName={setPresetName}
            handleCreatePreset={handleCreatePreset}
            activePresetId={props.activePresetId}
            onOverwritePreset={props.onOverwritePreset}
            isPresetTransitioning={props.isPresetTransitioning}
            onStopPresetTransition={props.onStopPresetTransition}
            presetBlendDuration={props.presetBlendDuration}
            onPresetBlendDurationChange={props.onPresetBlendDurationChange}
            libraryInputRef={libraryInputRef}
            handleLibraryFileChange={handleLibraryFileChange}
            handleProjectFileChange={props.handleProjectFileChange}
            onDismissProjectNotice={props.onDismissProjectNotice}
            onExportLibrary={props.onExportLibrary}
            onExportProject={props.onExportProject}
            libraryImportMode={libraryImportMode}
            setLibraryImportMode={setLibraryImportMode}
            libraryNotice={props.libraryNotice}
            onDismissLibraryNotice={props.onDismissLibraryNotice}
            sequenceLoopEnabled={props.sequenceLoopEnabled}
            onSequenceLoopEnabledChange={props.onSequenceLoopEnabledChange}
            isSequencePlaying={props.isSequencePlaying}
            onStartSequencePlayback={props.onStartSequencePlayback}
            onStopSequencePlayback={props.onStopSequencePlayback}
            presetSequence={props.presetSequence}
            activeSequenceItemId={props.activeSequenceItemId}
            sequenceSinglePassDuration={props.sequenceSinglePassDuration}
            onLoadSequenceItem={props.onLoadSequenceItem}
            sequenceStepProgress={props.sequenceStepProgress}
            draggingSequenceItemId={draggingSequenceItemId}
            dropTargetSequenceItemId={dropTargetSequenceItemId}
            handleSequenceDragStart={handleSequenceDragStart}
            handleSequenceDragOver={handleSequenceDragOver}
            handleSequenceDrop={handleSequenceDrop}
            handleSequenceDragEnd={handleSequenceDragEnd}
            presets={props.presets}
            projectInputRef={props.projectInputRef}
            projectManifest={props.projectManifest}
            projectNotice={props.projectNotice}
            layerFocusMode={props.layerFocusMode}
            comparePreviewEnabled={props.comparePreviewEnabled}
            onSetComparePreviewEnabled={props.onSetComparePreviewEnabled}
            comparePreviewOrientation={props.comparePreviewOrientation}
            onSetComparePreviewOrientation={props.onSetComparePreviewOrientation}
            comparePreviewSlotIndex={props.comparePreviewSlotIndex}
            onSetComparePreviewSlotIndex={props.onSetComparePreviewSlotIndex}
            onSetLayerFocusMode={props.onSetLayerFocusMode}
            layerMuteState={props.layerMuteState}
            onToggleLayerMute={props.onToggleLayerMute}
            layerLockState={props.layerLockState}
            onToggleLayerLock={props.onToggleLayerLock}
            snapshotSlots={props.snapshotSlots}
            onCaptureSnapshot={props.onCaptureSnapshot}
            onLoadSnapshot={props.onLoadSnapshot}
            onMorphSnapshot={props.onMorphSnapshot}
            onClearSnapshot={props.onClearSnapshot}
            onRenameSnapshot={props.onRenameSnapshot}
            onSetSnapshotNote={props.onSetSnapshotNote}
            compareReferenceConfig={props.compareReferenceConfig}
            onRenameSequenceItem={props.onRenameSequenceItem}
            onSequenceHoldChange={props.onSequenceHoldChange}
            onSequenceTransitionChange={props.onSequenceTransitionChange}
            onSequenceTransitionEasingChange={props.onSequenceTransitionEasingChange}
            onSequenceDriveModeChange={props.onSequenceDriveModeChange}
            onSequenceDriveStrengthModeChange={props.onSequenceDriveStrengthModeChange}
            onSequenceDriveStrengthOverrideChange={props.onSequenceDriveStrengthOverrideChange}
            onSequenceDriveMultiplierChange={props.onSequenceDriveMultiplierChange}
            onCaptureSequenceKeyframe={props.onCaptureSequenceKeyframe}
            onResetSequenceKeyframe={props.onResetSequenceKeyframe}
            onDuplicateSequenceItem={props.onDuplicateSequenceItem}
            onMoveSequenceItem={props.onMoveSequenceItem}
            onRemoveSequenceItem={props.onRemoveSequenceItem}
            videoExportMode={props.videoExportMode}
            onVideoExportModeChange={props.onVideoExportModeChange}
            videoFps={props.videoFps}
            onVideoFpsChange={props.onVideoFpsChange}
            videoDurationSeconds={props.videoDurationSeconds}
            onVideoDurationSecondsChange={props.onVideoDurationSecondsChange}
            isVideoRecording={props.isVideoRecording}
            onStartVideoRecording={props.onStartVideoRecording}
            onStopVideoRecording={props.onStopVideoRecording}
            isFrameExporting={props.isFrameExporting}
            onStartFrameExport={props.onStartFrameExport}
            onStopFrameExport={props.onStopFrameExport}
            videoNotice={props.videoNotice}
            onDismissVideoNotice={props.onDismissVideoNotice}
            frameNotice={props.frameNotice}
            onDismissFrameNotice={props.onDismissFrameNotice}
            editingPresetId={editingPresetId}
            editingPresetName={editingPresetName}
            setEditingPresetId={setEditingPresetId}
            setEditingPresetName={setEditingPresetName}
            handleSubmitRename={handleSubmitRename}
            handleStartRename={handleStartRename}
            onLoadPreset={props.onLoadPreset}
            onApplyConfig={props.onApplyConfig}
            onSaveBredPreset={props.onSaveBredPreset}
            onSyncApplyPresets={props.onSyncApplyPresets}
            onSyncNotice={props.onSyncNotice}
            onJumpToTab={handleJumpToTab}
            configHistoryEntries={props.configHistoryEntries}
            onClearConfigHistory={props.onClearConfigHistory}
            pointCloudCaptureRef={props.pointCloudCaptureRef}
            formatPresetDate={formatPresetDate}
            isPresetDirty={props.isPresetDirty}
            onTransitionToPreset={props.onTransitionToPreset}
            onAddPresetToSequence={props.onAddPresetToSequence}
            onDuplicatePreset={props.onDuplicatePreset}
            onDeletePreset={props.onDeletePreset}
            updatePositionArray={updatePositionArray}
            updateLayerArray={updateLayerArray}
            updateLayer1Array={updateLayer1Array}
            updateMotionArray={updateMotionArray}
            audioSourceMode={props.audioSourceMode}
            onAudioSourceModeChange={props.onAudioSourceModeChange}
            audioLevelsRef={props.audioLevelsRef}
            isAudioActive={props.isAudioActive}
            stopAudio={props.stopAudio}
            startAudio={props.startAudio}
            audioActionLabel={audioActionLabel}
            audioNotice={props.audioNotice}
            onDismissAudioNotice={props.onDismissAudioNotice}
          />

          <ControlPanelFooter
            config={config}
            isPublicLibrary={isPublicLibrary}
            onSave={props.onSave}
            updateConfig={updateConfig}
          />
        </div>
      </div>
    </div>
  );
};
