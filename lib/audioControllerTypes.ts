export type Notice = { tone: 'success' | 'error'; message: string };
export type AudioLevels = {
  bass: number;
  treble: number;
  pulse: number;
  bandA: number;
  bandB: number;
  // FFT spectrum bands (derived in lib/audioAnalysis.ts from the same
  // frequency data, Hz edges at 44.1kHz-style sample rates):
  // sub 20-60Hz, low 60-250Hz, mid 250-2000Hz, high 2000-6000Hz,
  // presence 6000-16000Hz, level = overall spectral energy.
  sub: number;
  low: number;
  mid: number;
  high: number;
  presence: number;
  level: number;
};

export const ZERO_AUDIO_LEVELS: AudioLevels = {
  bass: 0, treble: 0, pulse: 0, bandA: 0, bandB: 0,
  sub: 0, low: 0, mid: 0, high: 0, presence: 0, level: 0,
};

export type AnalyzerLike = Pick<AnalyserNode, 'frequencyBinCount' | 'getByteFrequencyData'> & Partial<Pick<AnalyserNode, 'fftSize' | 'getByteTimeDomainData'>>;

export type SynthEngine = {
  context: AudioContext;
  analyser: AnalyserNode;
  mediaDestination: MediaStreamAudioDestinationNode;
  mainOsc: OscillatorNode;
  subOsc: OscillatorNode;
  filter: BiquadFilterNode;
  noteGain: GainNode;
  masterGain: GainNode;
  stepTimer: number | null;
  currentStep: number;
};

declare global {
  interface Window {
    __MONOSPHERE_FAKE_AUDIO_FACTORY__?: () => AnalyzerLike;
    __MONOSPHERE_FAKE_SHARED_STREAM_FACTORY__?: () => Promise<MediaStream> | MediaStream;
    __sharedAudioGain?: number;
    webkitAudioContext?: typeof AudioContext;
  }
}
