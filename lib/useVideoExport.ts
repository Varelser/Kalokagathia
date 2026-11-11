import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { Notice, SynthEngine } from './audioControllerTypes';
import { applySynthSettings, restartSynthSequencer } from './audioSynth';
import { createSynthEngine, stopSynthEngine } from './audioSynthSource';
import {
  getSupportedVideoMimeType,
  validateVideoExportTarget,
} from './videoExportHelpers';
import {
  cleanupVideoExportSession,
  startVideoRecorderSession,
  stopVideoRecorder,
} from './videoExportRecording';

type UseVideoExportArgs = {
  config: ParticleConfig;
  handleStartSequencePlayback: () => void;
  presetSequenceLength: number;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  sequenceLoopEnabled: boolean;
  sequenceSinglePassDuration: number;
  setSequenceLoopEnabled: (value: boolean) => void;
  microphoneStreamRef: MutableRefObject<MediaStream | null>;
  sharedAudioStreamRef: MutableRefObject<MediaStream | null>;
  stopSequencePlayback: () => void;
  synthEngineRef: MutableRefObject<SynthEngine | null>;
  videoDurationSeconds: number;
  videoExportMode: 'current' | 'sequence';
  videoFps: number;
};

export function useVideoExport({
  config,
  handleStartSequencePlayback,
  presetSequenceLength,
  rendererRef,
  sequenceLoopEnabled,
  sequenceSinglePassDuration,
  setSequenceLoopEnabled,
  microphoneStreamRef,
  sharedAudioStreamRef,
  stopSequencePlayback,
  synthEngineRef,
  videoDurationSeconds,
  videoExportMode,
  videoFps,
}: UseVideoExportArgs) {
  const [isVideoRecording, setIsVideoRecording] = useState(false);
  const [videoNotice, setVideoNotice] = useState<Notice | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingSynthEngineRef = useRef<SynthEngine | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoStopTimerRef = useRef<number | null>(null);
  const recordingLoopRestoreRef = useRef<boolean | null>(null);
  const recordingModeRef = useRef<'current' | 'sequence'>('current');

  const clearVideoStopTimer = useCallback(() => {
    if (videoStopTimerRef.current !== null) {
      window.clearTimeout(videoStopTimerRef.current);
      videoStopTimerRef.current = null;
    }
  }, []);

  const dismissVideoNotice = useCallback(() => {
    setVideoNotice(null);
  }, []);

  const showVideoNotice = useCallback((message: string) => {
    setVideoNotice({ tone: 'error', message });
  }, []);

  const stopVideoRecording = useCallback(() => {
    clearVideoStopTimer();

    if (recordingModeRef.current === 'sequence') {
      stopSequencePlayback();
    }

    stopVideoRecorder({
      mediaRecorderRef,
      mediaStreamRef,
      microphoneStreamRef,
      recordingLoopRestoreRef,
      recordingSynthEngineRef,
      videoChunksRef,
    }, {
      setIsVideoRecording,
      setSequenceLoopEnabled,
      setVideoNotice,
    });
  }, [clearVideoStopTimer, setSequenceLoopEnabled, stopSequencePlayback, microphoneStreamRef]);

  const startVideoRecording = useCallback(() => {
    void (async () => {
      const renderer = rendererRef.current;
      const canvas = renderer?.domElement ?? null;
      const validationError = validateVideoExportTarget(
        canvas,
        presetSequenceLength,
        sequenceSinglePassDuration,
        videoDurationSeconds,
        videoExportMode,
      );
      if (validationError) {
        setVideoNotice({ tone: 'error', message: validationError });
        return;
      }

      const targetDuration = videoExportMode === 'sequence'
        ? sequenceSinglePassDuration
        : Math.max(0.5, videoDurationSeconds);
      const mimeType = getSupportedVideoMimeType();
      if (!canvas) {
        return;
      }

      dismissVideoNotice();
      clearVideoStopTimer();
      videoChunksRef.current = [];
      recordingModeRef.current = videoExportMode;
      recordingLoopRestoreRef.current = sequenceLoopEnabled;

      try {
        if (config.audioSourceMode === 'standalone-synth' && config.audioEnabled) {
          recordingSynthEngineRef.current = await createSynthEngine(config, { connectToDestination: false });
        }

        startVideoRecorderSession({
          canvas,
          config,
          mimeType,
          refs: {
            mediaRecorderRef,
            mediaStreamRef,
            microphoneStreamRef,
            recordingLoopRestoreRef,
            recordingSynthEngineRef,
            videoChunksRef,
          },
          setters: {
            setIsVideoRecording,
            setSequenceLoopEnabled,
            setVideoNotice,
          },
          sharedAudioStreamRef,
          stopVideoRecording,
          synthEngineRef,
          videoExportMode,
          videoFps,
        });

        if (videoExportMode === 'sequence') {
          setSequenceLoopEnabled(false);
          handleStartSequencePlayback();
        }

        videoStopTimerRef.current = window.setTimeout(() => {
          stopVideoRecording();
        }, targetDuration * 1000);
      } catch (error) {
        console.error('Video recording failed to start:', error);
        setVideoNotice({ tone: 'error', message: 'Could not start video recording.' });
        stopVideoRecording();
      }
    })();
  }, [
    clearVideoStopTimer,
    config,
    dismissVideoNotice,
    handleStartSequencePlayback,
    microphoneStreamRef,
    presetSequenceLength,
    rendererRef,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    setSequenceLoopEnabled,
    sharedAudioStreamRef,
    stopVideoRecording,
    synthEngineRef,
    videoDurationSeconds,
    videoExportMode,
    videoFps,
  ]);

  useEffect(() => {
    const recordingSynth = recordingSynthEngineRef.current;
    if (!recordingSynth || !isVideoRecording) {
      return;
    }

    if (config.audioSourceMode === 'standalone-synth' && config.audioEnabled) {
      return;
    }

    stopSynthEngine(recordingSynth);
    void recordingSynth.context.close().catch(() => {});
    recordingSynthEngineRef.current = null;
  }, [config.audioEnabled, config.audioSourceMode, isVideoRecording]);

  useEffect(() => {
    const recordingSynth = recordingSynthEngineRef.current;
    if (!recordingSynth || !isVideoRecording || config.audioSourceMode !== 'standalone-synth' || !config.audioEnabled) {
      return;
    }

    applySynthSettings(recordingSynth, config);
  }, [
    config,
    config.audioEnabled,
    config.audioSourceMode,
    config.synthCutoff,
    config.synthPatternDepth,
    config.synthVolume,
    config.synthWaveform,
    isVideoRecording,
  ]);

  useEffect(() => {
    const recordingSynth = recordingSynthEngineRef.current;
    if (!recordingSynth || !isVideoRecording || config.audioSourceMode !== 'standalone-synth' || !config.audioEnabled) {
      return;
    }

    restartSynthSequencer(recordingSynth, config);

    return () => {
      if (recordingSynth.stepTimer !== null) {
        window.clearInterval(recordingSynth.stepTimer);
        recordingSynth.stepTimer = null;
      }
    };
  }, [
    config,
    config.audioEnabled,
    config.audioSourceMode,
    config.synthBaseFrequency,
    config.synthCutoff,
    config.synthPattern,
    config.synthPatternDepth,
    config.synthScale,
    config.synthTempo,
    isVideoRecording,
  ]);

  useEffect(() => () => {
    clearVideoStopTimer();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    cleanupVideoExportSession({
      mediaRecorderRef,
      mediaStreamRef,
      microphoneStreamRef,
      recordingLoopRestoreRef,
      recordingSynthEngineRef,
      videoChunksRef,
    }, {
      setIsVideoRecording,
      setSequenceLoopEnabled,
      setVideoNotice,
    });
  }, [clearVideoStopTimer, microphoneStreamRef, setSequenceLoopEnabled]);

  return {
    dismissVideoNotice,
    isVideoRecording,
    showVideoNotice,
    startVideoRecording,
    stopVideoRecording,
    videoNotice,
  };
}
