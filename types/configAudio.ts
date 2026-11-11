import type { AudioSourceMode, SynthScale, SynthWaveform } from './audio';

export interface ParticleConfigAudio {
  audioEnabled: boolean;
  audioSourceMode: AudioSourceMode;
  audioSensitivity: number;
  audioBeatScale: number;
  audioJitterScale: number;
  audioGateThreshold: number;
  audioResponseCurve: number;
  audioPulseDecay: number;
  audioBassMotionScale: number;
  audioBassSizeScale: number;
  audioBassAlphaScale: number;
  audioTrebleMotionScale: number;
  audioTrebleSizeScale: number;
  audioTrebleAlphaScale: number;
  audioPulseScale: number;
  audioBurstScale: number;
  audioScreenScale: number;
  audioMorphScale: number;
  audioShatterScale: number;
  audioTwistScale: number;
  audioBendScale: number;
  audioWarpScale: number;
  audioLineScale: number;
  audioCameraScale: number;
  audioHueShiftScale: number;
  // Custom Frequency Bands
  audioBandALowHz: number;
  audioBandAHighHz: number;
  audioBandAMotionScale: number;
  audioBandASizeScale: number;
  audioBandAAlphaScale: number;
  audioBandBLowHz: number;
  audioBandBHighHz: number;
  audioBandBMotionScale: number;
  audioBandBSizeScale: number;
  audioBandBAlphaScale: number;
  synthWaveform: SynthWaveform;
  synthScale: SynthScale;
  synthBaseFrequency: number;
  synthTempo: number;
  synthVolume: number;
  synthCutoff: number;
  synthPatternDepth: number;
  synthPattern: number[];
}
