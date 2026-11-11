import { MutableRefObject, useCallback } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { SynthEngine } from './audioControllerTypes';
import { useFrameExport } from './useFrameExport';
import { useVideoExport } from './useVideoExport';

type UseExportControllerArgs = {
  config: ParticleConfig;
  stopSequencePlayback: () => void;
  handleStartSequencePlayback: () => void;
  presetSequenceLength: number;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  sequenceLoopEnabled: boolean;
  sequenceSinglePassDuration: number;
  setSequenceLoopEnabled: (value: boolean) => void;
  microphoneStreamRef: MutableRefObject<MediaStream | null>;
  sharedAudioStreamRef: MutableRefObject<MediaStream | null>;
  synthEngineRef: MutableRefObject<SynthEngine | null>;
  videoDurationSeconds: number;
  videoExportMode: 'current' | 'sequence';
  videoFps: number;
};

export function useExportController(args: UseExportControllerArgs) {
  const videoExport = useVideoExport(args);
  const frameExport = useFrameExport({
    handleStartSequencePlayback: args.handleStartSequencePlayback,
    presetSequenceLength: args.presetSequenceLength,
    rendererRef: args.rendererRef,
    sequenceLoopEnabled: args.sequenceLoopEnabled,
    sequenceSinglePassDuration: args.sequenceSinglePassDuration,
    setSequenceLoopEnabled: args.setSequenceLoopEnabled,
    stopSequencePlayback: args.stopSequencePlayback,
    videoDurationSeconds: args.videoDurationSeconds,
    videoExportMode: args.videoExportMode,
    videoFps: args.videoFps,
  });

  const startVideoRecording = useCallback(() => {
    if (frameExport.isFrameExporting) {
      videoExport.showVideoNotice('Stop PNG frame export before recording video.');
      return;
    }
    videoExport.startVideoRecording();
  }, [frameExport.isFrameExporting, videoExport]);

  const startFrameExport = useCallback(() => {
    if (videoExport.isVideoRecording) {
      frameExport.showFrameNotice('Stop video recording before exporting PNG frames.');
      return;
    }
    void frameExport.startFrameExport();
  }, [frameExport, videoExport.isVideoRecording]);

  return {
    ...frameExport,
    ...videoExport,
    startFrameExport,
    startVideoRecording,
  };
}
