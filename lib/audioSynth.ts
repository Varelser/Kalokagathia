import type { ParticleConfig } from '../types';
import { normalizeSynthPattern, resolveSynthSemitoneOffset } from './appState';
import type { SynthEngine } from './audioControllerTypes';
import {
  dispatchEventRuleActions,
  evaluateEventRules,
  evaluatePredicateTransitions,
  loadEventRules,
  type SynthNoteAction,
} from './eventRules';

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

  // Phase 18 stage 4: the single thin event-rule wiring. Rules are
  // evaluated ONLY at this step boundary (never per frame), for the
  // 'beat' event — plus 'pattern-boundary' when the step wraps to
  // the pattern head. With no rules stored this is two empty
  // evaluations and the sequencer behaves exactly as before.
  fireEventRulesAtStepBoundary(synth, nextConfig, stepIndex, pattern.length);
}

export interface SynthNoteOnceOptions {
  /** MIDI note number 0..127; takes precedence over semitoneOffset / frequency. */
  midiNote?: number;
  /** Semitones above synthBaseFrequency. */
  semitoneOffset?: number;
  /** Explicit frequency in Hz; lowest precedence. */
  frequency?: number;
  /** Note length in seconds, clamped 0.05..2 (default 0.28, the step decay). */
  durationSec?: number;
  /** Velocity / gain multiplier 0..1 (default 1). */
  gain?: number;
}

/**
 * Play ONE note on the (monophonic) synth engine — the "noteOnOnce"
 * entry point the event rules' synth-note action calls. It reuses
 * the step envelope shape but does NOT advance the sequencer step
 * and does NOT touch the pattern. Returns false and does nothing
 * when there is no engine or audio is disabled
 * (config.audioEnabled !== true), so a rule can never make sound
 * while audio is off.
 */
export function triggerSynthNoteOnce(
  synth: SynthEngine | null | undefined,
  nextConfig: ParticleConfig,
  opts: SynthNoteOnceOptions = {},
): boolean {
  if (!synth || nextConfig.audioEnabled !== true) return false;
  let frequency: number;
  if (typeof opts.midiNote === 'number' && Number.isFinite(opts.midiNote)) {
    const note = Math.max(0, Math.min(127, opts.midiNote));
    frequency = 440 * Math.pow(2, (note - 69) / 12);
  } else if (typeof opts.semitoneOffset === 'number' && Number.isFinite(opts.semitoneOffset)) {
    frequency = nextConfig.synthBaseFrequency * Math.pow(2, opts.semitoneOffset / 12);
  } else if (typeof opts.frequency === 'number' && Number.isFinite(opts.frequency)) {
    frequency = opts.frequency;
  } else {
    frequency = nextConfig.synthBaseFrequency;
  }
  frequency = Math.max(20, frequency);
  const duration = Math.max(0.05, Math.min(2, opts.durationSec ?? 0.28));
  const gain = Math.max(0, Math.min(1, opts.gain ?? 1));
  const now = synth.context.currentTime;

  applySynthSettings(synth, nextConfig);
  synth.mainOsc.frequency.cancelScheduledValues(now);
  synth.subOsc.frequency.cancelScheduledValues(now);
  synth.mainOsc.frequency.setTargetAtTime(frequency, now, 0.01);
  synth.subOsc.frequency.setTargetAtTime(Math.max(20, frequency * 0.5), now, 0.01);

  synth.noteGain.gain.cancelScheduledValues(now);
  synth.noteGain.gain.setValueAtTime(0.0001, now);
  synth.noteGain.gain.linearRampToValueAtTime(0.0001 + gain * 0.38, now + 0.015);
  synth.noteGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  return true;
}

/** Perform one evaluated synth-note action (the stage-4 action). */
export function performSynthNoteAction(
  synth: SynthEngine | null | undefined,
  nextConfig: ParticleConfig,
  action: SynthNoteAction,
): boolean {
  return triggerSynthNoteOnce(synth, nextConfig, {
    midiNote: action.note,
    semitoneOffset: action.semitoneOffset,
    durationSec: action.durationSec,
    gain: action.gain,
  });
}

/** Phase 21 stage 2: predicate rising-edge state, per rule id. */
let predicateTruthState: Map<string, boolean> = new Map();

function fireEventRulesAtStepBoundary(
  synth: SynthEngine,
  nextConfig: ParticleConfig,
  stepIndex: number,
  patternLength: number,
): void {
  try {
    const rules = loadEventRules(typeof window !== 'undefined' ? window.localStorage : undefined);
    if (rules.length === 0) return;
    const ctx = {
      t: synth.context.currentTime,
      x: patternLength > 0 ? stepIndex / patternLength : 0,
      step: stepIndex,
      beat: stepIndex,
    };
    const fire = (type: 'beat' | 'pattern-boundary') => {
      dispatchEventRuleActions(evaluateEventRules(rules, { type, step: stepIndex }, ctx), {
        synthNote: (action) => { performSynthNoteAction(synth, nextConfig, action); },
      });
    };
    fire('beat');
    if (stepIndex === 0) fire('pattern-boundary');
    // Phase 21 stage 2: predicate rules are polled at the same step
    // boundary and fire on the rising edge of their condition only.
    // With no predicate rules the transition map stays empty and
    // nothing fires — the legacy behaviour.
    const transitions = evaluatePredicateTransitions(rules, ctx, predicateTruthState);
    predicateTruthState = transitions.next;
    if (transitions.actions.length > 0) {
      dispatchEventRuleActions(transitions.actions, {
        synthNote: (action) => { performSynthNoteAction(synth, nextConfig, action); },
      });
    }
  } catch {
    // Rules are an add-on: a storage / evaluation failure must
    // never break the sequencer's own step.
  }
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
