import React from 'react';
import { Columns2, Rows2 } from 'lucide-react';
import type { ParticleConfig } from '../types';
import type { ComparePreviewOrientation, LayerFocusMode, LayerToggleState, SnapshotSlot } from './controlPanelTypes';
import { LayerToggleRow, SnapshotCard, getSnapshotDiff } from './controlPanelProjectIOShared';

type ControlPanelProjectIOCompareSectionProps = {
  layerFocusMode: LayerFocusMode;
  onSetLayerFocusMode: (mode: LayerFocusMode) => void;
  layerMuteState: LayerToggleState;
  onToggleLayerMute: (layer: keyof LayerToggleState) => void;
  layerLockState: LayerToggleState;
  onToggleLayerLock: (layer: keyof LayerToggleState) => void;
  comparePreviewEnabled: boolean;
  onSetComparePreviewEnabled: (enabled: boolean) => void;
  comparePreviewOrientation: ComparePreviewOrientation;
  onSetComparePreviewOrientation: (orientation: ComparePreviewOrientation) => void;
  comparePreviewSlotIndex: number;
  onSetComparePreviewSlotIndex: (slotIndex: number) => void;
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

export const ControlPanelProjectIOCompareSection: React.FC<ControlPanelProjectIOCompareSectionProps> = ({
  layerFocusMode,
  onSetLayerFocusMode,
  layerMuteState,
  onToggleLayerMute,
  layerLockState,
  onToggleLayerLock,
  comparePreviewEnabled,
  onSetComparePreviewEnabled,
  comparePreviewOrientation,
  onSetComparePreviewOrientation,
  comparePreviewSlotIndex,
  onSetComparePreviewSlotIndex,
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
  const activeCompareSlot = snapshotSlots[comparePreviewSlotIndex];
  const compareDiff = getSnapshotDiff(currentConfig, compareReferenceConfig);

  return (
    <>
      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/45">Workspace compare</div>
        <div className="mb-2 grid grid-cols-4 gap-2">
          {([
            ['all', 'All'],
            ['layer1', 'L1'],
            ['layer2', 'L2'],
            ['layer3', 'L3'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => onSetLayerFocusMode(value)}
              className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${layerFocusMode === value ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <LayerToggleRow label="Layer 1" layerKey="layer1" muted={layerMuteState.layer1} locked={layerLockState.layer1} soloActive={layerFocusMode === 'layer1'} onSolo={() => onSetLayerFocusMode(layerFocusMode === 'layer1' ? 'all' : 'layer1')} onToggleMute={onToggleLayerMute} onToggleLock={onToggleLayerLock} />
          <LayerToggleRow label="Layer 2" layerKey="layer2" muted={layerMuteState.layer2} locked={layerLockState.layer2} soloActive={layerFocusMode === 'layer2'} onSolo={() => onSetLayerFocusMode(layerFocusMode === 'layer2' ? 'all' : 'layer2')} onToggleMute={onToggleLayerMute} onToggleLock={onToggleLayerLock} />
          <LayerToggleRow label="Layer 3" layerKey="layer3" muted={layerMuteState.layer3} locked={layerLockState.layer3} soloActive={layerFocusMode === 'layer3'} onSolo={() => onSetLayerFocusMode(layerFocusMode === 'layer3' ? 'all' : 'layer3')} onToggleMute={onToggleLayerMute} onToggleLock={onToggleLayerLock} />
        </div>
        <div className="mt-2 text-[10px] text-white/40">Mute and solo affect the live preview only. Lock protects layer parameters from accidental edits.</div>
      </div>

      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-white/45">
          <span>Split compare</span>
          <button
            onClick={() => onSetComparePreviewEnabled(!comparePreviewEnabled)}
            className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${comparePreviewEnabled ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}
          >
            {comparePreviewEnabled ? 'On' : 'Off'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onSetComparePreviewOrientation('vertical')}
            className={`flex items-center justify-center gap-2 rounded border px-2 py-2 text-[9px] uppercase tracking-widest transition-colors ${comparePreviewOrientation === 'vertical' ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}
          >
            <Columns2 size={11} /> Vertical
          </button>
          <button
            onClick={() => onSetComparePreviewOrientation('horizontal')}
            className={`flex items-center justify-center gap-2 rounded border px-2 py-2 text-[9px] uppercase tracking-widest transition-colors ${comparePreviewOrientation === 'horizontal' ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}
          >
            <Rows2 size={11} /> Horizontal
          </button>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {snapshotSlots.map((slot, slotIndex) => (
            <button
              key={`compare-${slotIndex}`}
              disabled={!slot}
              onClick={() => onSetComparePreviewSlotIndex(slotIndex)}
              className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors disabled:opacity-30 ${comparePreviewSlotIndex === slotIndex ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 text-white/55 hover:bg-white/5'}`}
            >
              {String.fromCharCode(65 + slotIndex)}
            </button>
          ))}
        </div>
        <div className="mt-2 rounded border border-white/10 bg-black/25 p-2 text-[10px] text-white/55">
          {activeCompareSlot ? (
            <>
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="font-bold uppercase tracking-widest text-cyan-100/80">{activeCompareSlot.label}</div>
                <div className="text-white/35">{compareDiff.total} tracked diffs</div>
              </div>
              {activeCompareSlot.note ? <div className="mb-2 text-white/45">{activeCompareSlot.note}</div> : null}
              <div className="space-y-1">
                {compareDiff.highlights.length > 0 ? compareDiff.highlights.map((item) => (
                  <div key={item.label} className="rounded border border-white/10 bg-black/20 px-2 py-1">
                    <div className="uppercase tracking-widest text-white/35">{item.label}</div>
                    <div className="text-white/55">Live · {item.current}</div>
                    <div className="text-cyan-100/75">Compare · {item.compare}</div>
                  </div>
                )) : <div className="text-white/40">No tracked differences for the current compare slot.</div>}
              </div>
            </>
          ) : (
            <div className="text-white/40">Overlay a snapshot beside the live scene for fast A/B comparison. Capture first, then choose the snapshot slot to compare.</div>
          )}
        </div>
      </div>

      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/45">A/B snapshot bank</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {snapshotSlots.map((slot, slotIndex) => (
            <SnapshotCard
              key={slotIndex}
              slotIndex={slotIndex}
              slot={slot}
              onCaptureSnapshot={onCaptureSnapshot}
              onLoadSnapshot={onLoadSnapshot}
              onMorphSnapshot={onMorphSnapshot}
              onClearSnapshot={onClearSnapshot}
              onRenameSnapshot={onRenameSnapshot}
              onSetSnapshotNote={onSetSnapshotNote}
            />
          ))}
        </div>
      </div>
    </>
  );
};
