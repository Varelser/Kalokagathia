import { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import type { Notice, SynthEngine } from './audioControllerTypes';
import { stopSynthEngine } from './audioSynthSource';
import { buildRecordingStream, downloadRecordedVideo, stopMediaStream } from './videoExportHelpers';

export type VideoExportMode = 'current' | 'sequence';

export type VideoExportRefs = {
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>;
  mediaStreamRef: MutableRefObject<MediaStream | null>;
  microphoneStreamRef: MutableRefObject<MediaStream | null>;
  recordingLoopRestoreRef: MutableRefObject<boolean | null>;
  recordingSynthEngineRef: MutableRefObject<SynthEngine | null>;
  videoChunksRef: MutableRefObject<Blob[]>;
};

type VideoExportSetters = {
  setIsVideoRecording: (value: boolean) => void;
  setSequenceLoopEnabled: (value: boolean) => void;
  setVideoNotice: (notice: Notice) => void;
};

type StartVideoRecorderSessionArgs = {
  canvas: HTMLCanvasElement;
  config: ParticleConfig;
  mimeType: string;
  refs: VideoExportRefs;
  setters: VideoExportSetters;
  sharedAudioStreamRef: MutableRefObject<MediaStream | null>;
  stopVideoRecording: () => void;
  synthEngineRef: MutableRefObject<SynthEngine | null>;
  videoExportMode: VideoExportMode;
  videoFps: number;
};

export function cleanupVideoExportSession(refs: VideoExportRefs, setters: VideoExportSetters) {
  stopMediaStream(refs.mediaStreamRef.current);
  refs.mediaStreamRef.current = null;

  if (refs.recordingSynthEngineRef.current) {
    stopSynthEngine(refs.recordingSynthEngineRef.current);
    void refs.recordingSynthEngineRef.current.context.close().catch(() => {});
    refs.recordingSynthEngineRef.current = null;
  }

  if (refs.recordingLoopRestoreRef.current !== null) {
    setters.setSequenceLoopEnabled(refs.recordingLoopRestoreRef.current);
    refs.recordingLoopRestoreRef.current = null;
  }

  refs.mediaRecorderRef.current = null;
  refs.videoChunksRef.current = [];
  setters.setIsVideoRecording(false);
}

export function stopVideoRecorder(refs: VideoExportRefs, setters: VideoExportSetters) {
  const recorder = refs.mediaRecorderRef.current;
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
    return;
  }

  cleanupVideoExportSession(refs, setters);
}

export function startVideoRecorderSession({
  canvas,
  config,
  mimeType,
  refs,
  setters,
  sharedAudioStreamRef,
  stopVideoRecording,
  synthEngineRef,
  videoExportMode,
  videoFps,
}: StartVideoRecorderSessionArgs) {
  const recordingStream = buildRecordingStream(
    canvas,
    config,
    refs.microphoneStreamRef,
    sharedAudioStreamRef,
    refs.recordingSynthEngineRef,
    synthEngineRef,
    videoFps,
  );
  const recorder = new MediaRecorder(recordingStream, {
    mimeType,
    videoBitsPerSecond: 12_000_000,
  });

  refs.mediaStreamRef.current = recordingStream;
  refs.mediaRecorderRef.current = recorder;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      refs.videoChunksRef.current.push(event.data);
    }
  };

  recorder.onstop = () => {
    const blob = new Blob(refs.videoChunksRef.current, { type: mimeType });
    if (blob.size > 0) {
      downloadRecordedVideo(blob, videoExportMode);
      setters.setVideoNotice({ tone: 'success', message: 'Video exported.' });
    } else {
      setters.setVideoNotice({ tone: 'error', message: 'Recorded video was empty.' });
    }

    cleanupVideoExportSession(refs, setters);
  };

  recorder.onerror = () => {
    setters.setVideoNotice({ tone: 'error', message: 'Video recording failed.' });
    stopVideoRecording();
  };

  recorder.start(250);
  setters.setIsVideoRecording(true);
}
