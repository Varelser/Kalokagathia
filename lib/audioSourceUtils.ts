import { MutableRefObject } from 'react';
import { AudioControllerRefs, AudioControllerSetters } from './audioSourceTypes';

export function getAudioContextCtor() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('Web Audio is not supported in this browser.');
  }
  return AudioContextCtor;
}

export function stopStreamTracks(stream: MediaStream | null) {
  if (!stream) {
    return;
  }
  stream.getTracks().forEach((track) => track.stop());
}

export async function attachStreamAnalyzer(
  stream: MediaStream,
  streamRef: MutableRefObject<MediaStream | null>,
  refs: AudioControllerRefs,
  setters: AudioControllerSetters,
) {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stopStreamTracks(stream);
    throw new Error('No audio track was provided by the selected source.');
  }

  const AudioContextCtor = getAudioContextCtor();
  const audioCtx = new AudioContextCtor();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  source.connect(analyser);
  await audioCtx.resume();

  refs.audioContextRef.current = audioCtx;
  streamRef.current = stream;
  refs.analyzerRef.current = analyser;
  setters.setIsAudioActive(true);
  setters.setConfig((prev) => ({ ...prev, audioEnabled: true }));
}
