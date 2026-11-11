import React from 'react';
import { Briefcase, Download, FolderOpen } from 'lucide-react';
import type { ParticleConfig, ProjectManifest } from '../types';
import type { Notice } from '../lib/audioControllerTypes';
import type { ComparePreviewOrientation, LayerFocusMode, LayerToggleState, SnapshotSlot } from './controlPanelTypes';
import { NoticeBanner } from './controlPanelTabsShared';
import { getActiveHybridRecipes } from '../lib/hybridExpressions';
import { ControlPanelProjectIOManifestSection } from './controlPanelProjectIOManifestSection';
import { ControlPanelProjectIOCompareSection } from './controlPanelProjectIOCompareSection';

export type ControlPanelProjectIOProps = {
  handleProjectFileChange: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDismissProjectNotice: () => void;
  onExportProject: () => void;
  projectInputRef: React.RefObject<HTMLInputElement | null>;
  projectManifest: ProjectManifest;
  projectNotice: Notice | null;
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
  currentConfig: ParticleConfig;
};

export const ControlPanelProjectIO: React.FC<ControlPanelProjectIOProps> = ({
  handleProjectFileChange,
  onDismissProjectNotice,
  onExportProject,
  projectInputRef,
  projectManifest,
  projectNotice,
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
  currentConfig,
}) => {
  const activeHybridRecipes = getActiveHybridRecipes(currentConfig);

  return (
    <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/70">
        <Briefcase size={12} /> Project I/O
      </div>
      <input
        ref={projectInputRef}
        type="file"
        accept="application/json"
        onChange={handleProjectFileChange}
        className="hidden"
      />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          onClick={onExportProject}
          className="flex items-center justify-center gap-2 rounded border border-white/20 bg-white/5 py-2 text-[10px] font-bold uppercase transition-colors hover:bg-white/10"
        >
          <Download size={12} /> Export Project
        </button>
        <button
          onClick={() => projectInputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded border border-white/20 bg-white/5 py-2 text-[10px] font-bold uppercase transition-colors hover:bg-white/10"
        >
          <FolderOpen size={12} /> Load Project
        </button>
      </div>

      {activeHybridRecipes.length > 0 ? (
        <div className="mb-3 rounded border border-fuchsia-300/20 bg-fuchsia-500/5 p-2">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-fuchsia-100/70">Active hybrid expressions</div>
          <div className="space-y-2">
            {activeHybridRecipes.map((recipe) => (
              <div key={recipe.id} className="rounded border border-white/10 bg-black/20 p-2">
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/78">{recipe.name}</div>
                <div className="mt-1 text-[10px] text-white/58">{recipe.summary}</div>
                <div className="mt-1 text-[10px] text-white/42">Focus · {recipe.emphasis.join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ControlPanelProjectIOManifestSection projectManifest={projectManifest} />

      <ControlPanelProjectIOCompareSection
        layerFocusMode={layerFocusMode}
        onSetLayerFocusMode={onSetLayerFocusMode}
        layerMuteState={layerMuteState}
        onToggleLayerMute={onToggleLayerMute}
        layerLockState={layerLockState}
        onToggleLayerLock={onToggleLayerLock}
        comparePreviewEnabled={comparePreviewEnabled}
        onSetComparePreviewEnabled={onSetComparePreviewEnabled}
        comparePreviewOrientation={comparePreviewOrientation}
        onSetComparePreviewOrientation={onSetComparePreviewOrientation}
        comparePreviewSlotIndex={comparePreviewSlotIndex}
        onSetComparePreviewSlotIndex={onSetComparePreviewSlotIndex}
        snapshotSlots={snapshotSlots}
        onCaptureSnapshot={onCaptureSnapshot}
        onLoadSnapshot={onLoadSnapshot}
        onMorphSnapshot={onMorphSnapshot}
        onClearSnapshot={onClearSnapshot}
        onRenameSnapshot={onRenameSnapshot}
        onSetSnapshotNote={onSetSnapshotNote}
        compareReferenceConfig={compareReferenceConfig}
        currentConfig={currentConfig}
      />

      <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40">
        Saves current config, presets, sequence, UI playback/export settings, and layer mode/source/material manifest.
      </div>
      <NoticeBanner notice={projectNotice} onDismiss={onDismissProjectNotice} className="mt-3" />
    </div>
  );
};
