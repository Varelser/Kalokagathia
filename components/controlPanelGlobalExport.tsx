import React from 'react';
import { Camera, Download, Pause, Play } from 'lucide-react';
import { Slider, Toggle } from './controlPanelParts';
import { ControlPanelContentProps, NoticeBanner } from './controlPanelTabsShared';

export const GlobalExportSection: React.FC<ControlPanelContentProps> = ({
  audioSourceMode,
  frameNotice,
  isFrameExporting,
  isVideoRecording,
  onDismissFrameNotice,
  onDismissVideoNotice,
  onStartFrameExport,
  onStartVideoRecording,
  onStopFrameExport,
  onStopVideoRecording,
  onVideoDurationSecondsChange,
  onVideoExportModeChange,
  onVideoFpsChange,
  sequenceSinglePassDuration,
  videoDurationSeconds,
  videoExportMode,
  videoFps,
  videoNotice,
}) => (
  <div className="mt-4 rounded border border-white/10 bg-white/5 p-3">
    <div className="flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest text-white/70 mb-3">
      <Camera size={12} /> Video Export
    </div>
    <Toggle
      label="Recording Mode"
      value={videoExportMode}
      options={[{ label: 'Current', val: 'current' }, { label: 'Sequence', val: 'sequence' }]}
      onChange={onVideoExportModeChange}
    />
    <Slider label="Frame Rate" value={videoFps} min={12} max={60} step={1} onChange={onVideoFpsChange} />
    {videoExportMode === 'current' ? (
      <Slider label="Duration Seconds" value={videoDurationSeconds} min={1} max={30} step={0.5} onChange={onVideoDurationSecondsChange} />
    ) : (
      <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
        Sequence single-pass length: {sequenceSinglePassDuration.toFixed(2)} sec
      </div>
    )}
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={isVideoRecording ? onStopVideoRecording : onStartVideoRecording}
        className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
      >
        {isVideoRecording ? <Pause size={12} /> : <Play size={12} />}
        {isVideoRecording ? 'Stop Recording' : 'Record WebM'}
      </button>
      <div className="flex items-center justify-center text-[9px] uppercase tracking-widest text-white/45 border border-white/10 rounded">
        {isVideoRecording ? 'Recording...' : 'Browser WebM'}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 mt-2">
      <button
        onClick={isFrameExporting ? onStopFrameExport : onStartFrameExport}
        className="flex items-center justify-center gap-2 py-2 text-[10px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
      >
        {isFrameExporting ? <Pause size={12} /> : <Download size={12} />}
        {isFrameExporting ? 'Stop Frames' : 'Export PNG Frames'}
      </button>
      <div className="flex items-center justify-center text-[9px] uppercase tracking-widest text-white/45 border border-white/10 rounded">
        {isFrameExporting ? 'Capturing ZIP...' : 'PNG ZIP'}
      </div>
    </div>
    {audioSourceMode === 'standalone-synth' && (
      <div className="mt-2 rounded border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[10px] uppercase tracking-widest text-amber-100/85">
        When Standalone Synth is active, `Record WebM` mirrors its synth settings into an internal capture track.
      </div>
    )}
    <NoticeBanner notice={videoNotice} onDismiss={onDismissVideoNotice} />
    <NoticeBanner notice={frameNotice} onDismiss={onDismissFrameNotice} />
  </div>
);
