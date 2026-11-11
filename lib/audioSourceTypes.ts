import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ParticleConfig } from '../types';
import type { AnalyzerLike, AudioLevels, Notice, SynthEngine } from './audioControllerTypes';

export type AudioControllerRefs = {
  analyzerRef: MutableRefObject<AnalyzerLike | null>;
  audioContextRef: MutableRefObject<AudioContext | null>;
  audioRef: MutableRefObject<AudioLevels>;
  microphoneStreamRef: MutableRefObject<MediaStream | null>;
  sharedAudioStreamRef: MutableRefObject<MediaStream | null>;
  synthEngineRef: MutableRefObject<SynthEngine | null>;
};

export type AudioControllerSetters = {
  setAudioNotice: Dispatch<SetStateAction<Notice | null>>;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
  setIsAudioActive: Dispatch<SetStateAction<boolean>>;
};
