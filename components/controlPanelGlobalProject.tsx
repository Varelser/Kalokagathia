import React from 'react';
import { ControlPanelProjectIO } from './controlPanelProjectIO';
import { ControlPanelContentProps } from './controlPanelTabsShared';

export const GlobalProjectSection: React.FC<ControlPanelContentProps> = ({
  handleProjectFileChange,
  onDismissProjectNotice,
  onExportProject,
  projectInputRef,
  projectManifest,
  projectNotice,
  config,
  layerFocusMode,
  comparePreviewEnabled,
  onSetComparePreviewEnabled,
  comparePreviewOrientation,
  onSetComparePreviewOrientation,
  comparePreviewSlotIndex,
  onSetComparePreviewSlotIndex,
  onSetLayerFocusMode,
  layerMuteState,
  onToggleLayerMute,
  layerLockState,
  onToggleLayerLock,
  snapshotSlots,
  onCaptureSnapshot,
  onLoadSnapshot,
  onMorphSnapshot,
  onClearSnapshot,
  onRenameSnapshot,
  onSetSnapshotNote,
  compareReferenceConfig,
}) => (
  <ControlPanelProjectIO
    handleProjectFileChange={handleProjectFileChange}
    onDismissProjectNotice={onDismissProjectNotice}
    onExportProject={onExportProject}
    projectInputRef={projectInputRef}
    projectManifest={projectManifest}
    projectNotice={projectNotice}
    layerFocusMode={layerFocusMode}
    comparePreviewEnabled={comparePreviewEnabled}
    onSetComparePreviewEnabled={onSetComparePreviewEnabled}
    comparePreviewOrientation={comparePreviewOrientation}
    onSetComparePreviewOrientation={onSetComparePreviewOrientation}
    comparePreviewSlotIndex={comparePreviewSlotIndex}
    onSetComparePreviewSlotIndex={onSetComparePreviewSlotIndex}
    onSetLayerFocusMode={onSetLayerFocusMode}
    layerMuteState={layerMuteState}
    onToggleLayerMute={onToggleLayerMute}
    layerLockState={layerLockState}
    onToggleLayerLock={onToggleLayerLock}
    snapshotSlots={snapshotSlots}
    onCaptureSnapshot={onCaptureSnapshot}
    onLoadSnapshot={onLoadSnapshot}
    onMorphSnapshot={onMorphSnapshot}
    onClearSnapshot={onClearSnapshot}
    onRenameSnapshot={onRenameSnapshot}
    onSetSnapshotNote={onSetSnapshotNote}
    compareReferenceConfig={compareReferenceConfig}
    currentConfig={config}
  />
);
