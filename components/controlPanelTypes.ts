import React from 'react';
import type { AudioLevels } from '../lib/audioControllerTypes';
import type { ConfigHistoryEntry } from '../lib/useConfigHistory';
import type { PointCloudCaptureState } from '../lib/pointCloudExport';
import {
  AudioSourceMode,
  ParticleConfig,
  PresetRecord,
  PresetSequenceItem,
  ProjectManifest,
  SequenceDriveMode,
  SequenceDriveStrengthMode,
  SequenceTransitionEasing,
} from '../types';

export type SnapshotSlot = {
  id: string;
  label: string;
  note: string;
  capturedAt: string;
} | null;

export type LayerFocusMode = 'all' | 'layer1' | 'layer2' | 'layer3';
export type LayerToggleState = { layer1: boolean; layer2: boolean; layer3: boolean };
export type ComparePreviewOrientation = 'vertical' | 'horizontal';

export interface ControlPanelCoreProps {
  config: ParticleConfig;
  contactAmount: number;
  libraryScope: 'private' | 'public';
  setConfig: React.Dispatch<React.SetStateAction<ParticleConfig>>;
  isPlaying: boolean;
  togglePlay: () => void;
  onSave: () => void;
  onReset: () => void;
  onRandomize: () => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export interface ControlPanelPresetProps {
  presets: PresetRecord[];
  activePresetId: string | null;
  isPresetDirty: boolean;
  onCreatePreset: (name: string) => void;
  onLoadPreset: (presetId: string) => void;
  onOverwritePreset: (presetId: string) => void;
  onRenamePreset: (presetId: string, nextName: string) => void;
  onDuplicatePreset: (presetId: string) => void;
  onDeletePreset: (presetId: string) => void;
  presetBlendDuration: number;
  onPresetBlendDurationChange: (seconds: number) => void;
  onTransitionToPreset: (presetId: string) => void;
  isPresetTransitioning: boolean;
  onStopPresetTransition: () => void;
  /** Apply an arbitrary config immediately (used by preset breeding previews). */
  onApplyConfig?: (config: ParticleConfig) => void;
  /** Create a preset from an arbitrary config and load it (used by preset breeding). */
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
  /** Cross-device sync (item 8): replace the library with a merged pull result. */
  onSyncApplyPresets?: (presets: PresetRecord[]) => void;
  onSyncNotice?: (notice: { tone: 'success' | 'error'; message: string }) => void;
  /** Automatic config history entries (roadmap 7D), oldest first. */
  configHistoryEntries?: ConfigHistoryEntry[];
  onClearConfigHistory?: () => void;
  /** One-shot GPGPU position capture channel for the PLY export (roadmap Phase 9). */
  pointCloudCaptureRef?: React.RefObject<PointCloudCaptureState>;
}

export interface ControlPanelSequenceProps {
  presetSequence: PresetSequenceItem[];
  activeSequenceItemId: string | null;
  isSequencePlaying: boolean;
  sequenceLoopEnabled: boolean;
  onSequenceLoopEnabledChange: (enabled: boolean) => void;
  onAddPresetToSequence: (presetId: string) => void;
  onRemoveSequenceItem: (itemId: string) => void;
  onSequenceHoldChange: (itemId: string, holdSeconds: number) => void;
  onSequenceTransitionChange: (itemId: string, transitionSeconds: number) => void;
  onSequenceTransitionEasingChange: (itemId: string, transitionEasing: SequenceTransitionEasing) => void;
  onSequenceDriveModeChange: (itemId: string, mode: SequenceDriveMode) => void;
  onSequenceDriveStrengthModeChange: (itemId: string, mode: SequenceDriveStrengthMode) => void;
  onSequenceDriveStrengthOverrideChange: (itemId: string, value: number) => void;
  onSequenceDriveMultiplierChange: (itemId: string, multiplier: number) => void;
  onRenameSequenceItem: (itemId: string, label: string) => void;
  onCaptureSequenceKeyframe: (itemId: string) => void;
  onResetSequenceKeyframe: (itemId: string) => void;
  onLoadSequenceItem: (itemId: string) => void;
  onDuplicateSequenceItem: (itemId: string) => void;
  onMoveSequenceItem: (itemId: string, direction: -1 | 1) => void;
  onReorderSequenceItem: (sourceItemId: string, targetItemId: string) => void;
  onStartSequencePlayback: () => void;
  onStopSequencePlayback: () => void;
  sequenceStepProgress: number;
  sequenceSinglePassDuration: number;
}

export interface ControlPanelExportProps {
  audioSourceMode: AudioSourceMode;
  videoExportMode: 'current' | 'sequence';
  onVideoExportModeChange: (mode: 'current' | 'sequence') => void;
  videoDurationSeconds: number;
  onVideoDurationSecondsChange: (seconds: number) => void;
  videoFps: number;
  onVideoFpsChange: (fps: number) => void;
  isVideoRecording: boolean;
  onStartVideoRecording: () => void;
  onStopVideoRecording: () => void;
  videoNotice: { tone: 'success' | 'error'; message: string } | null;
  onDismissVideoNotice: () => void;
  isFrameExporting: boolean;
  onStartFrameExport: () => void;
  onStopFrameExport: () => void;
  frameNotice: { tone: 'success' | 'error'; message: string } | null;
  onDismissFrameNotice: () => void;
}

export interface ControlPanelLibraryProps {
  onExportLibrary: () => void;
  onImportLibrary: (file: File, mode: 'append' | 'replace') => void;
  libraryNotice: { tone: 'success' | 'error'; message: string } | null;
  onDismissLibraryNotice: () => void;
}


export interface ControlPanelProjectProps {
  handleProjectFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDismissProjectNotice: () => void;
  onExportProject: () => void;
  projectInputRef: React.RefObject<HTMLInputElement | null>;
  projectManifest: ProjectManifest;
  projectNotice: { tone: 'success' | 'error'; message: string } | null;
}

export interface ControlPanelWorkspaceProps {
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
}

export interface ControlPanelAudioProps {
  audioSourceMode: AudioSourceMode;
  onAudioSourceModeChange: (mode: AudioSourceMode) => void;
  audioNotice: { tone: 'success' | 'error'; message: string } | null;
  onDismissAudioNotice: () => void;
  startAudio: () => void;
  stopAudio: () => void;
  isAudioActive: boolean;
  /** Live levels ref owned by useAudioController; read by the spectrum meter. */
  audioLevelsRef?: React.MutableRefObject<AudioLevels>;
}

export interface ControlPanelProps extends
  ControlPanelCoreProps,
  ControlPanelPresetProps,
  ControlPanelSequenceProps,
  ControlPanelExportProps,
  ControlPanelLibraryProps,
  ControlPanelProjectProps,
  ControlPanelWorkspaceProps,
  ControlPanelAudioProps {}
