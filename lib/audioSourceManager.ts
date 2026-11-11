import { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import { startSharedAudioSource, startMicrophoneAudioSource } from './audioStreamSources';
import { stopSynthEngine, startInternalSynthAudioSource } from './audioSynthSource';
import { AudioControllerRefs, AudioControllerSetters } from './audioSourceTypes';
import { ZERO_AUDIO_LEVELS } from './audioControllerTypes';
import { stopStreamTracks } from './audioSourceUtils';

export function stopAudioResources(
  refs: AudioControllerRefs,
  setConfig: AudioControllerSetters['setConfig'],
  setIsAudioActive: AudioControllerSetters['setIsAudioActive'],
) {
  stopSynthEngine(refs.synthEngineRef.current);
  refs.synthEngineRef.current = null;

  stopStreamTracks(refs.microphoneStreamRef.current);
  refs.microphoneStreamRef.current = null;

  stopStreamTracks(refs.sharedAudioStreamRef.current);
  refs.sharedAudioStreamRef.current = null;

  if (refs.audioContextRef.current) {
    // 既に closed/closing 状態なら再呼び出し不要（冪等性の保証）
    if (refs.audioContextRef.current.state !== 'closed') {
      void refs.audioContextRef.current.close();
    }
    refs.audioContextRef.current = null;
  }

  refs.analyzerRef.current = null;
  refs.audioRef.current = { ...ZERO_AUDIO_LEVELS };
  setIsAudioActive(false);
  setConfig((prev) => ({ ...prev, audioEnabled: false }));
}

export async function startSelectedAudioSource(
  latestConfigRef: MutableRefObject<ParticleConfig>,
  refs: AudioControllerRefs,
  setters: AudioControllerSetters,
  stopAudio: () => void,
) {
  const mode = latestConfigRef.current.audioSourceMode;

  if (mode === 'microphone') {
    await startMicrophoneAudioSource(refs, setters);
    return;
  }

  if (mode === 'shared-audio') {
    await startSharedAudioSource(latestConfigRef, refs, setters, stopAudio);
    return;
  }

  await startInternalSynthAudioSource(latestConfigRef, refs, setters);
}
