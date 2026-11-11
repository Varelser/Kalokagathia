import { MutableRefObject } from 'react';
import type { ParticleConfig } from '../types';
import { applySynthSettings, restartSynthSequencer } from './audioSynth';
import { AudioControllerRefs, AudioControllerSetters } from './audioSourceTypes';
import { getAudioContextCtor } from './audioSourceUtils';
import type { SynthEngine } from './audioControllerTypes';

type CreateSynthEngineOptions = {
  connectToDestination?: boolean;
};

export function stopSynthEngine(synth: SynthEngine | null) {
  if (!synth) {
    return;
  }

  if (synth.stepTimer !== null) {
    window.clearInterval(synth.stepTimer);
  }

  try { synth.mainOsc.stop(); } catch {}
  try { synth.subOsc.stop(); } catch {}
  synth.mainOsc.disconnect();
  synth.subOsc.disconnect();
  synth.filter.disconnect();
  synth.noteGain.disconnect();
  synth.masterGain.disconnect();
  synth.analyser.disconnect();
  synth.mediaDestination.disconnect();
}

export async function createSynthEngine(
  nextConfig: ParticleConfig,
  { connectToDestination = true }: CreateSynthEngineOptions = {},
) {
  const AudioContextCtor = getAudioContextCtor();
  const audioCtx = new AudioContextCtor();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.78;
  const mediaDestination = audioCtx.createMediaStreamDestination();

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';

  const noteGain = audioCtx.createGain();
  noteGain.gain.value = 0.0001;

  const masterGain = audioCtx.createGain();

  const mainOsc = audioCtx.createOscillator();
  const subOsc = audioCtx.createOscillator();
  mainOsc.type = nextConfig.synthWaveform as OscillatorType;
  subOsc.type = 'square';

  mainOsc.connect(filter);
  subOsc.connect(filter);
  filter.connect(noteGain);
  noteGain.connect(masterGain);
  masterGain.connect(analyser);
  if (connectToDestination) {
    masterGain.connect(audioCtx.destination);
  }
  masterGain.connect(mediaDestination);

  const synth: SynthEngine = {
    context: audioCtx,
    analyser,
    mediaDestination,
    mainOsc,
    subOsc,
    filter,
    noteGain,
    masterGain,
    stepTimer: null,
    currentStep: 0,
  };

  mainOsc.start();
  subOsc.start();
  await audioCtx.resume();
  applySynthSettings(synth, nextConfig);
  restartSynthSequencer(synth, nextConfig);
  return synth;
}

export async function startInternalSynthAudioSource(
  latestConfigRef: MutableRefObject<ParticleConfig>,
  refs: AudioControllerRefs,
  setters: AudioControllerSetters,
) {
  const synth = await createSynthEngine(latestConfigRef.current);

  refs.audioContextRef.current = synth.context;
  refs.synthEngineRef.current = synth;
  refs.analyzerRef.current = synth.analyser;
  setters.setIsAudioActive(true);
  setters.setConfig((prev) => ({ ...prev, audioEnabled: true }));
  setters.setAudioNotice({ tone: 'success', message: 'Built-in synth connected.' });
}
