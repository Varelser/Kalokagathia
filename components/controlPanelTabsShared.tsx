import React from 'react';
import { X } from 'lucide-react';
import {
  AudioSourceMode,
  Layer2Type,
  ParticleConfig,
  PresetRecord,
  PresetSequenceItem,
  ProjectManifest,
  SequenceDriveMode,
  SequenceDriveStrengthMode,
  SequenceTransitionEasing,
} from '../types';
import type { AudioLevels } from '../lib/audioControllerTypes';
import type { ConfigHistoryEntry } from '../lib/useConfigHistory';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import { ControlPanelTab, type ScreenFxPreset } from './controlPanelParts';
import type { ComparePreviewOrientation, LayerFocusMode, LayerToggleState, SnapshotSlot } from './controlPanelTypes';

export type UpdateConfig = <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => void;

export type Notice = { tone: 'success' | 'error'; message: string } | null;

export interface ControlPanelContentProps {
  activeTab: ControlPanelTab;
  config: ParticleConfig;
  contactAmount: number;
  isPublicLibrary: boolean;
  lockedPanelClass: string;
  updateConfig: UpdateConfig;
  applyScreenFxPreset: (preset: ScreenFxPreset) => void;
  applyPerformancePreset: (mode: 'editing' | 'balanced' | 'cinematic') => void;
  presetName: string;
  setPresetName: React.Dispatch<React.SetStateAction<string>>;
  handleCreatePreset: () => void;
  activePresetId: string | null;
  onOverwritePreset: (presetId: string) => void;
  isPresetTransitioning: boolean;
  onStopPresetTransition: () => void;
  presetBlendDuration: number;
  onPresetBlendDurationChange: (seconds: number) => void;
  libraryInputRef: React.RefObject<HTMLInputElement | null>;
  handleLibraryFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onExportLibrary: () => void;
  handleProjectFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDismissProjectNotice: () => void;
  onExportProject: () => void;
  projectInputRef: React.RefObject<HTMLInputElement | null>;
  projectManifest: ProjectManifest;
  projectNotice: Notice;
  layerFocusMode: LayerFocusMode;
  comparePreviewEnabled: boolean;
  onSetComparePreviewEnabled: (enabled: boolean) => void;
  comparePreviewOrientation: ComparePreviewOrientation;
  onSetComparePreviewOrientation: (orientation: ComparePreviewOrientation) => void;
  comparePreviewSlotIndex: number;
  onSetComparePreviewSlotIndex: (slotIndex: number) => void;
  onSetLayerFocusMode: (mode: LayerFocusMode) => void;
  layerMuteState: LayerToggleState;
  onToggleLayerMute: (layer: keyof LayerToggleState) => void;
  layerLockState: LayerToggleState;
  onToggleLayerLock: (layer: keyof LayerToggleState) => void;
  snapshotSlots: SnapshotSlot[];
  onCaptureSnapshot: (slotIndex: number) => void;
  onLoadSnapshot: (slotIndex: number) => void;
  onMorphSnapshot: (slotIndex: number) => void;
  onClearSnapshot: (slotIndex: number) => void;
  onRenameSnapshot: (slotIndex: number, label: string) => void;
  onSetSnapshotNote: (slotIndex: number, note: string) => void;
  compareReferenceConfig: ParticleConfig | null;
  libraryImportMode: 'append' | 'replace';
  setLibraryImportMode: React.Dispatch<React.SetStateAction<'append' | 'replace'>>;
  libraryNotice: Notice;
  onDismissLibraryNotice: () => void;
  sequenceLoopEnabled: boolean;
  onSequenceLoopEnabledChange: (enabled: boolean) => void;
  isSequencePlaying: boolean;
  onStartSequencePlayback: () => void;
  onStopSequencePlayback: () => void;
  presetSequence: PresetSequenceItem[];
  activeSequenceItemId: string | null;
  sequenceSinglePassDuration: number;
  onLoadSequenceItem: (itemId: string) => void;
  sequenceStepProgress: number;
  draggingSequenceItemId: string | null;
  dropTargetSequenceItemId: string | null;
  handleSequenceDragStart: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  handleSequenceDragOver: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  handleSequenceDrop: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  handleSequenceDragEnd: () => void;
  presets: PresetRecord[];
  onRenameSequenceItem: (itemId: string, label: string) => void;
  onSequenceHoldChange: (itemId: string, holdSeconds: number) => void;
  onSequenceTransitionChange: (itemId: string, transitionSeconds: number) => void;
  onSequenceTransitionEasingChange: (itemId: string, transitionEasing: SequenceTransitionEasing) => void;
  onSequenceDriveModeChange: (itemId: string, mode: SequenceDriveMode) => void;
  onSequenceDriveStrengthModeChange: (itemId: string, mode: SequenceDriveStrengthMode) => void;
  onSequenceDriveStrengthOverrideChange: (itemId: string, value: number) => void;
  onSequenceDriveMultiplierChange: (itemId: string, multiplier: number) => void;
  onCaptureSequenceKeyframe: (itemId: string) => void;
  onResetSequenceKeyframe: (itemId: string) => void;
  onDuplicateSequenceItem: (itemId: string) => void;
  onMoveSequenceItem: (itemId: string, direction: -1 | 1) => void;
  onRemoveSequenceItem: (itemId: string) => void;
  videoExportMode: 'current' | 'sequence';
  onVideoExportModeChange: (mode: 'current' | 'sequence') => void;
  videoFps: number;
  onVideoFpsChange: (fps: number) => void;
  videoDurationSeconds: number;
  onVideoDurationSecondsChange: (seconds: number) => void;
  isVideoRecording: boolean;
  onStartVideoRecording: () => void;
  onStopVideoRecording: () => void;
  isFrameExporting: boolean;
  onStartFrameExport: () => void;
  onStopFrameExport: () => void;
  videoNotice: Notice;
  onDismissVideoNotice: () => void;
  frameNotice: Notice;
  onDismissFrameNotice: () => void;
  editingPresetId: string | null;
  editingPresetName: string;
  setEditingPresetId: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingPresetName: React.Dispatch<React.SetStateAction<string>>;
  handleSubmitRename: (presetId: string) => void;
  handleStartRename: (preset: PresetRecord) => void;
  onLoadPreset: (presetId: string) => void;
  /** Cross-device sync (item 8): replace the library with a merged pull result. */
  onSyncApplyPresets?: (presets: PresetRecord[]) => void;
  onSyncNotice?: (notice: { tone: 'success' | 'error'; message: string }) => void;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
  onJumpToTab?: (tab: ControlPanelTab) => void;
  configHistoryEntries?: ConfigHistoryEntry[];
  onClearConfigHistory?: () => void;
  pointCloudCaptureRef?: React.RefObject<PointCloudCaptureState>;
  formatPresetDate: (value: string) => string;
  isPresetDirty: boolean;
  onTransitionToPreset: (presetId: string) => void;
  onAddPresetToSequence: (presetId: string) => void;
  onDuplicatePreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  updatePositionArray: (layer: 'layer2SourcePositions' | 'layer3SourcePositions' | 'layer1SourcePositions', index: number, axis: 'x' | 'y' | 'z', value: number) => void;
  updateLayerArray: (
    key: 'layer2Counts' | 'layer2Sizes' | 'layer2RadiusScales' | 'layer2FlowSpeeds' | 'layer2FlowAmps' | 'layer2FlowFreqs' |
         'layer3Counts' | 'layer3Sizes' | 'layer3RadiusScales' | 'layer3FlowSpeeds' | 'layer3FlowAmps' | 'layer3FlowFreqs',
    index: number,
    value: number,
    baseCountKey: 'layer2Count' | 'layer3Count',
    sourceCount: number
  ) => void;
  updateLayer1Array: (key: 'layer1Radii' | 'layer1Volumes' | 'layer1Jitters' | 'layer1Counts' | 'layer1Sizes' | 'layer1PulseSpeeds' | 'layer1PulseAmps', index: number, value: number) => void;
  updateMotionArray: (layer: 'layer2Motions' | 'layer3Motions', index: number, value: Layer2Type) => void;
  audioSourceMode: AudioSourceMode;
  onAudioSourceModeChange: (mode: AudioSourceMode) => void;
  audioLevelsRef?: React.MutableRefObject<AudioLevels>;
  isAudioActive: boolean;
  stopAudio: () => void;
  startAudio: () => void;
  audioActionLabel: string;
  audioNotice: Notice;
  onDismissAudioNotice: () => void;
}

export const NoticeBanner: React.FC<{
  notice: Notice;
  onDismiss: () => void;
  className?: string;
  successClassName?: string;
  errorClassName?: string;
}> = ({ notice, onDismiss, className = 'mt-3', successClassName = 'border-white/10 text-white/70 bg-black/10', errorClassName = 'border-red-400/30 text-red-200 bg-red-400/10' }) => {
  if (!notice) return null;

  return (
    <div className={`${className} rounded border px-3 py-2 text-[10px] uppercase tracking-widest ${notice.tone === 'error' ? errorClassName : successClassName}`}>
      <div className="flex items-center justify-between gap-2">
        <span>{notice.message}</span>
        <button onClick={onDismiss} className="text-white/40 hover:text-white/80 transition-colors" title="Dismiss">
          <X size={12} />
        </button>
      </div>
    </div>
  );
};
