import React from 'react';
import type { PresetSequenceItem } from '../types';

export const SequenceTimeline: React.FC<{
  presetSequence: PresetSequenceItem[];
  activeSequenceItemId: string | null;
  sequenceSinglePassDuration: number;
  onLoadSequenceItem: (itemId: string) => void;
  sequenceStepProgress: number;
  interactive: boolean;
  draggingSequenceItemId: string | null;
  dropTargetSequenceItemId: string | null;
  onSequenceDragStart: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  onSequenceDragOver: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  onSequenceDrop: (event: React.DragEvent<HTMLElement>, itemId: string) => void;
  onSequenceDragEnd: () => void;
}> = ({
  presetSequence,
  activeSequenceItemId,
  sequenceSinglePassDuration,
  onLoadSequenceItem,
  sequenceStepProgress,
  interactive,
  draggingSequenceItemId,
  dropTargetSequenceItemId,
  onSequenceDragStart,
  onSequenceDragOver,
  onSequenceDrop,
  onSequenceDragEnd,
}) => {
  const totalDuration = Math.max(0.001, sequenceSinglePassDuration);
  let accumulatedPercent = 0;
  let indicatorLeftPercent = 0;

  presetSequence.forEach((item, index) => {
    const transitionPercent = ((index === 0 ? 0 : item.transitionSeconds) / totalDuration) * 100;
    if (index > 0) {
      accumulatedPercent += transitionPercent;
    }

    const holdPercent = (item.holdSeconds / totalDuration) * 100;
    if (item.id === activeSequenceItemId) {
      indicatorLeftPercent = accumulatedPercent + holdPercent * Math.min(1, Math.max(0, sequenceStepProgress));
    }
    accumulatedPercent += holdPercent;
  });

  return (
    <div className="mb-3 rounded border border-white/10 bg-black/10 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.24em] text-white/45">
        <span>Sequence Timeline</span>
        <span>{sequenceSinglePassDuration.toFixed(2)} sec</span>
      </div>
      <div className="relative flex h-3 overflow-hidden rounded-full border border-white/10 bg-white/5">
        {presetSequence.map((item, index) => {
          const holdWidth = `${(item.holdSeconds / totalDuration) * 100}%`;
          const transitionWidth = `${((index === 0 ? 0 : item.transitionSeconds) / totalDuration) * 100}%`;
          const isActive = item.id === activeSequenceItemId;
          const isDragging = item.id === draggingSequenceItemId;
          const isDropTarget = item.id === dropTargetSequenceItemId && draggingSequenceItemId !== null;

          return (
            <React.Fragment key={item.id}>
              {index > 0 && item.transitionSeconds > 0 && (
                <button
                  type="button"
                  draggable={interactive}
                  onDragStart={interactive ? (event) => onSequenceDragStart(event, item.id) : undefined}
                  onDragOver={interactive ? (event) => onSequenceDragOver(event, item.id) : undefined}
                  onDrop={interactive ? (event) => onSequenceDrop(event, item.id) : undefined}
                  onDragEnd={interactive ? onSequenceDragEnd : undefined}
                  onClick={() => onLoadSequenceItem(item.id)}
                  title={`${item.label} transition ${item.transitionSeconds.toFixed(2)}s`}
                  className={`h-full border-r border-black/40 transition-opacity hover:opacity-100 ${isActive ? 'bg-white/80 opacity-100' : 'bg-white/25 opacity-75'} ${isDropTarget ? 'ring-1 ring-inset ring-white/80' : ''} ${isDragging ? 'opacity-50' : ''}`}
                  style={{ width: transitionWidth }}
                />
              )}
              <button
                type="button"
                draggable={interactive}
                onDragStart={interactive ? (event) => onSequenceDragStart(event, item.id) : undefined}
                onDragOver={interactive ? (event) => onSequenceDragOver(event, item.id) : undefined}
                onDrop={interactive ? (event) => onSequenceDrop(event, item.id) : undefined}
                onDragEnd={interactive ? onSequenceDragEnd : undefined}
                onClick={() => onLoadSequenceItem(item.id)}
                title={`${item.label} hold ${item.holdSeconds.toFixed(2)}s`}
                className={`h-full border-r border-black/40 transition-opacity hover:opacity-100 ${isActive ? 'bg-white opacity-100' : 'bg-white/55 opacity-80'} ${isDropTarget ? 'ring-1 ring-inset ring-white/80' : ''} ${isDragging ? 'opacity-50' : ''}`}
                style={{ width: holdWidth }}
              />
            </React.Fragment>
          );
        })}
        {activeSequenceItemId && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.65)]"
            style={{ left: `${indicatorLeftPercent}%` }}
          />
        )}
      </div>
      <div className="mt-2 grid gap-1 text-[9px] uppercase tracking-widest text-white/45">
        {presetSequence.map((item, index) => {
          const isActive = item.id === activeSequenceItemId;
          return (
            <button
              key={item.id}
              type="button"
              draggable={interactive}
              onDragStart={interactive ? (event) => onSequenceDragStart(event, item.id) : undefined}
              onDragOver={interactive ? (event) => onSequenceDragOver(event, item.id) : undefined}
              onDrop={interactive ? (event) => onSequenceDrop(event, item.id) : undefined}
              onDragEnd={interactive ? onSequenceDragEnd : undefined}
              onClick={() => onLoadSequenceItem(item.id)}
              className={`flex items-center justify-between gap-2 text-left transition-colors hover:text-white/90 ${isActive ? 'text-white/85' : ''} ${item.id === dropTargetSequenceItemId && draggingSequenceItemId !== null ? 'text-white' : ''}`}
            >
              <span className="truncate">{index + 1}. {item.label}</span>
              <span className="font-mono">H {item.holdSeconds.toFixed(1)} / T {index === 0 ? '0.0' : item.transitionSeconds.toFixed(1)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
