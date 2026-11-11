import type { ParticleConfig } from '../types';
import { normalizeSynthPattern, resolveSynthSemitoneOffset } from './appState';
import type { SynthEngine } from './audioControllerTypes';

const SYNTH_ACCENTS = [1, 0.45, 0.7, 0.9, 0.35, 0.55, 0.8, 0.6];

export function applySynthSettings(synth: SynthEngine, nextConfig: ParticleConfig) {
  const { context } = synth;
  synth.mainOsc.type = nextConfig.synthWaveform as OscillatorType;
  synth.masterGain.gain.setTargetAtTime(Math.max(0.001, nextConfig.synthVolume), context.currentTime, 0.03);
  synth.filter.frequency.setTargetAtTime(Math.max(120, nextConfig.synthCutoff), context.currentTime, 0.05);
  synth.filter.Q.setTargetAtTime(1.4 + nextConfig.synthPatternDepth * 10, context.currentTime, 0.05);
}

function triggerSynthStep(synth: SynthEngine, nextConfig: ParticleConfig) {
  const pattern = normalizeSynthPattern(nextConfig.synthPattern);
  const stepIndex = synth.currentStep % pattern.length;
  const accent = SYNTH_ACCENTS[stepIndex] ?? 1;
  const semitoneOffset = resolveSynthSemitoneOffset(nextConfig.synthScale, pattern[stepIndex] ?? 0) * Math.max(0, nextConfig.synthPatternDepth);
  const frequency = Math.max(40, nextConfig.synthBaseFrequency * Math.pow(2, semitoneOffset / 12));
  const now = synth.context.currentTime;

  applySynthSettings(synth, nextConfig);
  synth.mainOsc.frequency.cancelScheduledValues(now);
  synth.subOsc.frequency.cancelScheduledValues(now);
  synth.mainOsc.frequency.setTargetAtTime(frequency, now, 0.01);
  synth.subOsc.frequency.setTargetAtTime(Math.max(20, frequency * 0.5), now, 0.01);

  synth.noteGain.gain.cancelScheduledValues(now);
  synth.noteGain.gain.setValueAtTime(0.0001, now);
  synth.noteGain.gain.linearRampToValueAtTime(0.16 + accent * nextConfig.synthPatternDepth * 0.22, now + 0.015);
  synth.noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  synth.filter.frequency.setTargetAtTime(
    Math.max(140, nextConfig.synthCutoff * (0.65 + accent * 0.85)),
    now,
    0.02,
  );

  synth.currentStep += 1;
}

export function restartSynthSequencer(synth: SynthEngine, nextConfig: ParticleConfig) {
  if (synth.stepTimer !== null) {
    window.clearInterval(synth.stepTimer);
  }

  const intervalMs = Math.max(80, (60_000 / Math.max(30, nextConfig.synthTempo)) / 2);
  triggerSynthStep(synth, nextConfig);
  synth.stepTimer = window.setInterval(() => {
    triggerSynthStep(synth, nextConfig);
  }, intervalMs);
}
