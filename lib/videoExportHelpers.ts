import { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import type { SynthEngine } from './audioControllerTypes';

export function getSupportedVideoMimeType() {
  const mimeCandidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || '';
}

export function buildRecordingStream(
  canvas: HTMLCanvasElement,
  config: ParticleConfig,
  microphoneStreamRef: MutableRefObject<MediaStream | null>,
  sharedAudioStreamRef: MutableRefObject<MediaStream | null>,
  standaloneSynthStreamRef: MutableRefObject<SynthEngine | null>,
  synthEngineRef: MutableRefObject<SynthEngine | null>,
  videoFps: number,
) {
  const canvasStream = canvas.captureStream(Math.max(1, videoFps));
  let recordingStream: MediaStream = canvasStream;

  if (config.audioSourceMode === 'microphone' && microphoneStreamRef.current) {
    const videoTracks = canvasStream.getVideoTracks();
    const audioTracks = microphoneStreamRef.current.getAudioTracks().filter((track) => track.readyState === 'live');
    if (typeof MediaStream !== 'undefined' && audioTracks.length > 0) {
      recordingStream = new MediaStream([...videoTracks, ...audioTracks]);
    }
  } else if (config.audioSourceMode === 'internal-synth' && synthEngineRef.current?.mediaDestination) {
    const videoTracks = canvasStream.getVideoTracks();
    const audioTracks = synthEngineRef.current.mediaDestination.stream.getAudioTracks();
    if (typeof MediaStream !== 'undefined' && audioTracks.length > 0) {
      recordingStream = new MediaStream([...videoTracks, ...audioTracks]);
    }
  } else if (config.audioSourceMode === 'standalone-synth' && standaloneSynthStreamRef.current?.mediaDestination) {
    const videoTracks = canvasStream.getVideoTracks();
    const audioTracks = standaloneSynthStreamRef.current.mediaDestination.stream.getAudioTracks().filter((track) => track.readyState === 'live');
    if (typeof MediaStream !== 'undefined' && audioTracks.length > 0) {
      recordingStream = new MediaStream([...videoTracks, ...audioTracks]);
    }
  } else if (config.audioSourceMode === 'shared-audio' && sharedAudioStreamRef.current) {
    const videoTracks = canvasStream.getVideoTracks();
    const audioTracks = sharedAudioStreamRef.current.getAudioTracks().filter((track) => track.readyState === 'live');
    if (typeof MediaStream !== 'undefined' && audioTracks.length > 0) {
      recordingStream = new MediaStream([...videoTracks, ...audioTracks]);
    }
  }

  return recordingStream;
}

export function downloadRecordedVideo(blob: Blob, videoExportMode: 'current' | 'sequence') {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `kalokagathia-${videoExportMode}-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
}

export function validateVideoExportTarget(
  canvas: HTMLCanvasElement | null,
  presetSequenceLength: number,
  sequenceSinglePassDuration: number,
  videoDurationSeconds: number,
  videoExportMode: 'current' | 'sequence',
) {
  if (!canvas) {
    return 'Renderer is not ready yet.';
  }

  if (typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
    return 'This browser does not support video capture.';
  }

  const targetDuration = videoExportMode === 'sequence'
    ? sequenceSinglePassDuration
    : Math.max(0.5, videoDurationSeconds);

  if (targetDuration <= 0) {
    return 'Set a valid recording duration first.';
  }

  if (videoExportMode === 'sequence' && presetSequenceLength === 0) {
    return 'Add at least one sequence step before exporting sequence video.';
  }

  const mimeType = getSupportedVideoMimeType();
  if (!mimeType) {
    return 'No supported WebM codec was found.';
  }

  return null;
}
