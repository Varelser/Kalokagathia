import React from 'react';
import { ArrowDown, ArrowUp, Camera, Copy, Trash2 } from 'lucide-react';

type ControlPanelSequenceItemActionsProps = {
  index: number;
  isCustomKeyframe: boolean;
  isPublicLibrary: boolean;
  itemId: string;
  onCaptureSequenceKeyframe: (itemId: string) => void;
  onDuplicateSequenceItem: (itemId: string) => void;
  onLoadSequenceItem: (itemId: string) => void;
  onMoveSequenceItem: (itemId: string, direction: -1 | 1) => void;
  onRemoveSequenceItem: (itemId: string) => void;
  onResetSequenceKeyframe: (itemId: string) => void;
  presetSequenceLength: number;
};

export const ControlPanelSequenceItemActions: React.FC<ControlPanelSequenceItemActionsProps> = ({
  index,
  isCustomKeyframe,
  isPublicLibrary,
  itemId,
  onCaptureSequenceKeyframe,
  onDuplicateSequenceItem,
  onLoadSequenceItem,
  onMoveSequenceItem,
  onRemoveSequenceItem,
  onResetSequenceKeyframe,
  presetSequenceLength,
}) => (
  <>
    <div className="flex gap-2">
      <button
        onClick={() => onLoadSequenceItem(itemId)}
        className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
        title="Load keyframe"
      >
        Load
      </button>
      {!isPublicLibrary && (
        <>
          <button
            onClick={() => onCaptureSequenceKeyframe(itemId)}
            className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
            title="Capture current state to this keyframe"
          >
            <Camera size={12} />
          </button>
          <button
            onClick={() => onResetSequenceKeyframe(itemId)}
            disabled={!isCustomKeyframe}
            className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Return to linked preset state"
          >
            Use Preset
          </button>
        </>
      )}
    </div>
    {!isPublicLibrary && (
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => onDuplicateSequenceItem(itemId)}
          className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors"
          title="Duplicate step"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={() => onMoveSequenceItem(itemId, -1)}
          disabled={index === 0}
          className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move up"
        >
          <ArrowUp size={12} />
        </button>
        <button
          onClick={() => onMoveSequenceItem(itemId, 1)}
          disabled={index === presetSequenceLength - 1}
          className="px-3 py-2 text-[10px] font-bold uppercase rounded border border-white/20 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Move down"
        >
          <ArrowDown size={12} />
        </button>
        <button
          onClick={() => onRemoveSequenceItem(itemId)}
          className="ml-auto px-3 py-2 text-[10px] font-bold uppercase rounded border border-red-400/30 text-red-200 hover:bg-red-400/10 transition-colors"
          title="Remove step"
        >
          <Trash2 size={12} />
        </button>
      </div>
    )}
  </>
);
