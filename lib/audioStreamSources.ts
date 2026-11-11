import { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import { createFakeSharedAudioAnalyzer } from './audioAnalysis';
import { attachStreamAnalyzer } from './audioSourceUtils';
import { AudioControllerRefs, AudioControllerSetters } from './audioSourceTypes';

function buildSharedDisplayMediaOptions() {
  return {
    audio: {
      suppressLocalAudioPlayback: false,
    },
    video: {
      displaySurface: 'browser',
    },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: 'include',
    monitorTypeSurfaces: 'include',
  } as DisplayMediaStreamOptions;
}

function getSharedAudioFailureMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError') {
      return 'Shared audio capture was cancelled. Choose a tab or screen and make sure audio sharing is enabled in the picker.';
    }
    if (error.name === 'NotReadableError') {
      return 'The selected window could not expose audio. Browser tab sharing is more reliable than app-window capture on macOS.';
    }
    if (error.name === 'AbortError') {
      return 'Shared audio capture was interrupted before it could start.';
    }
  }

  return 'Shared audio capture could not be started. Try a Chromium browser tab with audio enabled, or use Standalone Synth.';
}

export async function startMicrophoneAudioSource(
  refs: AudioControllerRefs,
  setters: AudioControllerSetters,
) {
  const fakeAnalyzer = window.__MONOSPHERE_FAKE_AUDIO_FACTORY__?.();
  if (fakeAnalyzer) {
    refs.analyzerRef.current = fakeAnalyzer;
    setters.setIsAudioActive(true);
    setters.setConfig((prev) => ({ ...prev, audioEnabled: true }));
    return;
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  await attachStreamAnalyzer(stream, refs.microphoneStreamRef, refs, setters);
}

export async function startSharedAudioSource(
  _latestConfigRef: MutableRefObject<ParticleConfig>,
  refs: AudioControllerRefs,
  setters: AudioControllerSetters,
  stopAudio: () => void,
) {
  const fakeSharedStream = await window.__MONOSPHERE_FAKE_SHARED_STREAM_FACTORY__?.();
  if (fakeSharedStream) {
    if (typeof window.__sharedAudioGain === 'number') {
      refs.analyzerRef.current = createFakeSharedAudioAnalyzer();
      refs.sharedAudioStreamRef.current = fakeSharedStream;
      setters.setIsAudioActive(true);
      setters.setConfig((prev) => ({ ...prev, audioEnabled: true }));
    } else {
      await attachStreamAnalyzer(fakeSharedStream, refs.sharedAudioStreamRef, refs, setters);
    }
    setters.setAudioNotice({ tone: 'success', message: 'Shared audio connected.' });
    return;
  }

  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Display audio capture is not supported in this browser.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(buildSharedDisplayMediaOptions());
  } catch (error) {
    throw new Error(getSharedAudioFailureMessage(error), { cause: error });
  }

  const stopWhenShareEnds = () => {
    if (refs.sharedAudioStreamRef.current === stream) {
      setters.setAudioNotice({ tone: 'error', message: 'Shared audio ended. Start sharing again to keep the visuals reactive.' });
      stopAudio();
    }
  };

  stream.getTracks().forEach((track) => {
    track.addEventListener('ended', stopWhenShareEnds, { once: true });
  });

  try {
    await attachStreamAnalyzer(stream, refs.sharedAudioStreamRef, refs, setters);
  } catch (error) {
    if (error instanceof Error && error.message.includes('No audio track')) {
      throw new Error('The selected surface did not provide an audio track. On macOS, browser tab sharing is the most reliable option; app-window/system capture may be unavailable. Try sharing a tab with audio enabled, or use Standalone Synth.', { cause: error });
    }
    throw error;
  }
  setters.setAudioNotice({ tone: 'success', message: 'Shared audio connected.' });
}
