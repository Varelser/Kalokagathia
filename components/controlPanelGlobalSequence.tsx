import React from 'react';
import { ListVideo, Pause, Play } from 'lucide-react';
import { SequenceTimeline } from './controlPanelParts';
import { ControlPanelContentProps } from './controlPanelTabsShared';
import { ControlPanelSequenceItemCard } from './controlPanelSequenceItemCard';

export const GlobalSequenceSection: React.FC<ControlPanelContentProps> = ({
  activeSequenceItemId,
  config,
  draggingSequenceItemId,
  dropTargetSequenceItemId,
  handleSequenceDragEnd,
  handleSequenceDragOver,
  handleSequenceDragStart,
  handleSequenceDrop,
  isPublicLibrary,
  isSequencePlaying,
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
  onSequenceLoopEnabledChange,
  onSequenceTransitionChange,
  onSequenceTransitionEasingChange,
  onStartSequencePlayback,
  onStopSequencePlayback,
  presetSequence,
  presets,
  sequenceLoopEnabled,
  sequenceSinglePassDuration,
  sequenceStepProgress,
}) => (
  <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70">
        <ListVideo size={12} /> Sequence
      </div>
      <button
        onClick={() => onSequenceLoopEnabledChange(!sequenceLoopEnabled)}
        disabled={isPublicLibrary}
        className={`w-8 h-4 rounded-full relative transition-colors ${sequenceLoopEnabled ? 'bg-white' : 'bg-white/20'} disabled:opacity-30 disabled:cursor-not-allowed`}
        title={isPublicLibrary ? 'Locked in public build' : 'Loop playlist'}
      >
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black transition-all ${sequenceLoopEnabled ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
    {isPublicLibrary && (
      <div className="mb-3 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/50">
        Playlist structure is bundled in the public build. Playback stays available, but edits stay in the private workspace.
      </div>
    )}
    <div className="grid grid-cols-2 gap-2 mb-3">
      <button
        onClick={isSequencePlaying ? onStopSequencePlayback : onStartSequencePlayback}
        disabled={presetSequence.length === 0}
        className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {isSequencePlaying ? <Pause size={12} /> : <Play size={12} />}
        {isSequencePlaying ? 'Stop Sequence' : 'Play Sequence'}
      </button>
      <div className="flex items-center justify-center text-[9px] uppercase tracking-widest text-white/45 border border-white/10 rounded">
        {presetSequence.length} Steps
      </div>
    </div>
    {presetSequence.length > 0 && (
      <SequenceTimeline
        presetSequence={presetSequence}
        activeSequenceItemId={activeSequenceItemId}
        sequenceSinglePassDuration={sequenceSinglePassDuration}
        onLoadSequenceItem={onLoadSequenceItem}
        sequenceStepProgress={sequenceStepProgress}
        interactive={!isPublicLibrary}
        draggingSequenceItemId={draggingSequenceItemId}
        dropTargetSequenceItemId={dropTargetSequenceItemId}
        onSequenceDragStart={handleSequenceDragStart}
        onSequenceDragOver={handleSequenceDragOver}
        onSequenceDrop={handleSequenceDrop}
        onSequenceDragEnd={handleSequenceDragEnd}
      />
    )}
    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
      {presetSequence.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded p-3 text-[10px] uppercase tracking-widest text-white/35">
          Add presets below to build a playlist.
        </div>
      ) : presetSequence.map((item, index) => {
        const preset = presets.find((entry) => entry.id === item.presetId);
        if (!preset) {
          return null;
        }

        return (
          <ControlPanelSequenceItemCard
            key={item.id}
            activeSequenceItemId={activeSequenceItemId}
            configScreenSequenceDriveStrength={config.screenSequenceDriveStrength}
            draggingSequenceItemId={draggingSequenceItemId}
            dropTargetSequenceItemId={dropTargetSequenceItemId}
            handleSequenceDragEnd={handleSequenceDragEnd}
            handleSequenceDragOver={handleSequenceDragOver}
            handleSequenceDragStart={handleSequenceDragStart}
            handleSequenceDrop={handleSequenceDrop}
            index={index}
            isPublicLibrary={isPublicLibrary}
            item={item}
            onCaptureSequenceKeyframe={onCaptureSequenceKeyframe}
            onDuplicateSequenceItem={onDuplicateSequenceItem}
            onLoadSequenceItem={onLoadSequenceItem}
            onMoveSequenceItem={onMoveSequenceItem}
            onRemoveSequenceItem={onRemoveSequenceItem}
            onRenameSequenceItem={onRenameSequenceItem}
            onResetSequenceKeyframe={onResetSequenceKeyframe}
            onSequenceDriveModeChange={onSequenceDriveModeChange}
            onSequenceDriveMultiplierChange={onSequenceDriveMultiplierChange}
            onSequenceDriveStrengthModeChange={onSequenceDriveStrengthModeChange}
            onSequenceDriveStrengthOverrideChange={onSequenceDriveStrengthOverrideChange}
            onSequenceHoldChange={onSequenceHoldChange}
            onSequenceTransitionChange={onSequenceTransitionChange}
            onSequenceTransitionEasingChange={onSequenceTransitionEasingChange}
            preset={preset}
            presetSequenceLength={presetSequence.length}
          />
        );
      })}
    </div>
  </div>
);
