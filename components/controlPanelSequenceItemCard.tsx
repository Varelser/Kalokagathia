import React from 'react';
import { MoveVertical } from 'lucide-react';
import type { PresetRecord, PresetSequenceItem, SequenceDriveMode, SequenceDriveStrengthMode, SequenceTransitionEasing } from '../types';
import { EasingPreview } from './controlPanelParts';
import { ControlPanelSequenceItemActions } from './controlPanelSequenceItemActions';
import { ControlPanelSequenceItemEditable } from './controlPanelSequenceItemEditable';
import { ControlPanelSequenceItemReadonly } from './controlPanelSequenceItemReadonly';

type ControlPanelSequenceItemCardProps = {
  activeSequenceItemId: string | null;
  configScreenSequenceDriveStrength: number;
  draggingSequenceItemId: string | null;
  dropTargetSequenceItemId: string | null;
  handleSequenceDragEnd: () => void;
  handleSequenceDragOver: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  handleSequenceDragStart: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  handleSequenceDrop: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  index: number;
  isPublicLibrary: boolean;
  item: PresetSequenceItem;
  onCaptureSequenceKeyframe: (itemId: string) => void;
  onDuplicateSequenceItem: (itemId: string) => void;
  onLoadSequenceItem: (itemId: string) => void;
  onMoveSequenceItem: (itemId: string, direction: -1 | 1) => void;
  onRemoveSequenceItem: (itemId: string) => void;
  onRenameSequenceItem: (itemId: string, label: string) => void;
  onResetSequenceKeyframe: (itemId: string) => void;
  onSequenceDriveModeChange: (itemId: string, mode: SequenceDriveMode) => void;
  onSequenceDriveMultiplierChange: (itemId: string, multiplier: number) => void;
  onSequenceDriveStrengthModeChange: (itemId: string, mode: SequenceDriveStrengthMode) => void;
  onSequenceDriveStrengthOverrideChange: (itemId: string, value: number) => void;
  onSequenceHoldChange: (itemId: string, holdSeconds: number) => void;
  onSequenceTransitionChange: (itemId: string, transitionSeconds: number) => void;
  onSequenceTransitionEasingChange: (itemId: string, transitionEasing: SequenceTransitionEasing) => void;
  preset: PresetRecord;
  presetSequenceLength: number;
};

export const ControlPanelSequenceItemCard: React.FC<ControlPanelSequenceItemCardProps> = ({
  activeSequenceItemId,
  configScreenSequenceDriveStrength,
  draggingSequenceItemId,
  dropTargetSequenceItemId,
  handleSequenceDragEnd,
  handleSequenceDragOver,
  handleSequenceDragStart,
  handleSequenceDrop,
  index,
  isPublicLibrary,
  item,
  onCaptureSequenceKeyframe,
  onDuplicateSequenceItem,
  onLoadSequenceItem,
  onMoveSequenceItem,
  onRemoveSequenceItem,
  onRenameSequenceItem,
  onResetSequenceKeyframe,
  onSequenceDriveModeChange,
  onSequenceDriveMultiplierChange,
  onSequenceDriveStrengthModeChange,
  onSequenceDriveStrengthOverrideChange,
  onSequenceHoldChange,
  onSequenceTransitionChange,
  onSequenceTransitionEasingChange,
  preset,
  presetSequenceLength,
}) => {
  const isActiveStep = item.id === activeSequenceItemId;
  const isCustomKeyframe = Boolean(item.keyframeConfig);
  const isDraggingStep = item.id === draggingSequenceItemId;
  const isDropTarget = item.id === dropTargetSequenceItemId && draggingSequenceItemId !== null;

  return (
    <div
      onDragOver={isPublicLibrary ? undefined : (event) => handleSequenceDragOver(event, item.id)}
      onDrop={isPublicLibrary ? undefined : (event) => handleSequenceDrop(event, item.id)}
      className={`rounded border p-2 transition-colors ${isActiveStep ? 'border-white/35 bg-white/10' : 'border-white/10 bg-black/10'} ${isDropTarget ? 'border-white/60 bg-white/15' : ''} ${isDraggingStep ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {!isPublicLibrary && (
            <button
              type="button"
              draggable
              onDragStart={(event) => handleSequenceDragStart(event, item.id)}
              onDragEnd={handleSequenceDragEnd}
              className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/15 bg-white/5 text-white/45 transition-colors hover:text-white/80 hover:border-white/35 cursor-grab active:cursor-grabbing"
              title="Drag to reorder"
            >
              <MoveVertical size={12} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest text-white/45">Step {index + 1}</div>
            {isPublicLibrary ? (
              <div className="w-full py-1 text-xs font-semibold truncate">{item.label}</div>
            ) : (
              <input
                type="text"
                value={item.label}
                onChange={(event) => onRenameSequenceItem(item.id, event.target.value)}
                className="w-full bg-transparent text-xs font-semibold truncate outline-none border-b border-white/10 focus:border-white/40 py-1"
              />
            )}
            <div className="mt-1 text-[9px] uppercase tracking-widest text-white/40">
              Source {preset.name} {isCustomKeyframe ? '• Custom Keyframe' : '• Preset Link'}
            </div>
          </div>
        </div>
        {isActiveStep && (
          <span className="px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded-full bg-white text-black">
            Live
          </span>
        )}
      </div>
      {isPublicLibrary ? (
        <ControlPanelSequenceItemReadonly item={item} />
      ) : (
        <ControlPanelSequenceItemEditable
          configScreenSequenceDriveStrength={configScreenSequenceDriveStrength}
          item={item}
          onSequenceDriveModeChange={onSequenceDriveModeChange}
          onSequenceDriveMultiplierChange={onSequenceDriveMultiplierChange}
          onSequenceDriveStrengthModeChange={onSequenceDriveStrengthModeChange}
          onSequenceDriveStrengthOverrideChange={onSequenceDriveStrengthOverrideChange}
          onSequenceHoldChange={onSequenceHoldChange}
          onSequenceTransitionChange={onSequenceTransitionChange}
          onSequenceTransitionEasingChange={onSequenceTransitionEasingChange}
        />
      )}
      <div className="mb-4">
        <EasingPreview easing={item.transitionEasing} />
      </div>
      <ControlPanelSequenceItemActions
        index={index}
        isCustomKeyframe={isCustomKeyframe}
        isPublicLibrary={isPublicLibrary}
        itemId={item.id}
        onCaptureSequenceKeyframe={onCaptureSequenceKeyframe}
        onDuplicateSequenceItem={onDuplicateSequenceItem}
        onLoadSequenceItem={onLoadSequenceItem}
        onMoveSequenceItem={onMoveSequenceItem}
        onRemoveSequenceItem={onRemoveSequenceItem}
        onResetSequenceKeyframe={onResetSequenceKeyframe}
        presetSequenceLength={presetSequenceLength}
      />
    </div>
  );
};
