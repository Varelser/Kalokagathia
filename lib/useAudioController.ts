import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import type { AudioSourceMode, ParticleConfig } from '../types';
import { startAudioLevelMonitoring, type AudioAnalysisOptions } from './audioAnalysis';
import {
  buildStandaloneSynthUrl,
  createAudioBridgeSessionId,
  isAudioBridgeHostMessage,
} from './audioBridge';
import { applySynthSettings, restartSynthSequencer } from './audioSynth';
import { ZERO_AUDIO_LEVELS } from './audioControllerTypes';
import type { AnalyzerLike, AudioLevels, Notice, SynthEngine } from './audioControllerTypes';
import { startSelectedAudioSource, stopAudioResources } from './audioSourceManager';

type UseAudioControllerArgs = {
  config: ParticleConfig;
  latestConfigRef: MutableRefObject<ParticleConfig>;
  setConfig: Dispatch<SetStateAction<ParticleConfig>>;
};

export function useAudioController({ config, latestConfigRef, setConfig }: UseAudioControllerArgs) {
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [audioNotice, setAudioNotice] = useState<Notice | null>(null);
  const audioRef = useRef<AudioLevels>({ ...ZERO_AUDIO_LEVELS });
  const analyzerRef = useRef<AnalyzerLike | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const sharedAudioStreamRef = useRef<MediaStream | null>(null);
  const synthEngineRef = useRef<SynthEngine | null>(null);
  const standaloneSynthWindowRef = useRef<Window | null>(null);
  const standaloneSynthSessionIdRef = useRef<string | null>(null);
  const stopAudioInProgressRef = useRef(false);
  const analysisOptionsRef = useRef<AudioAnalysisOptions>({
    sensitivity: config.audioSensitivity,
    gateThreshold: config.audioGateThreshold,
    responseCurve: config.audioResponseCurve,
    pulseDecay: config.audioPulseDecay,
    bandALowHz: config.audioBandALowHz,
    bandAHighHz: config.audioBandAHighHz,
    bandBLowHz: config.audioBandBLowHz,
    bandBHighHz: config.audioBandBHighHz,
    sampleRate: 44100, // updated at runtime from AudioContext
  });

  const dismissAudioNotice = useCallback(() => {
    setAudioNotice(null);
  }, []);

  const postToStandaloneSynthWindow = useCallback((message: unknown) => {
    if (typeof window === 'undefined') {
      return false;
    }

    const standaloneWindow = standaloneSynthWindowRef.current;
    if (!standaloneWindow || standaloneWindow.closed) {
      return false;
    }

    standaloneWindow.postMessage(message, window.location.origin);
    return true;
  }, []);

  const ensureStandaloneSynthWindow = useCallback(() => {
    if (typeof window === 'undefined') {
      throw new Error('Standalone synth can only be opened in a browser window.');
    }

    const sessionId = standaloneSynthSessionIdRef.current ?? createAudioBridgeSessionId();
    standaloneSynthSessionIdRef.current = sessionId;
    const popupUrl = buildStandaloneSynthUrl(window.location.href, sessionId);
    let standaloneWindow = standaloneSynthWindowRef.current;

    if (!standaloneWindow || standaloneWindow.closed) {
      standaloneWindow = window.open(
        popupUrl,
        'kalokagathia-standalone-synth',
        'popup=yes,width=460,height=760,resizable=yes',
      );
    }

    if (!standaloneWindow) {
      throw new Error('Could not open the standalone synth window. Allow pop-ups for this site and try again.');
    }

    standaloneSynthWindowRef.current = standaloneWindow;
    standaloneWindow.focus();
    return sessionId;
  }, []);

  const stopAudio = useCallback(() => {
    if (stopAudioInProgressRef.current) {
      return;
    }
    stopAudioInProgressRef.current = true;

    try {
      const standaloneWindow = standaloneSynthWindowRef.current;
      if (standaloneWindow?.closed) {
        standaloneSynthWindowRef.current = null;
      }

      const standaloneSessionId = standaloneSynthSessionIdRef.current;
      if (standaloneSessionId) {
        postToStandaloneSynthWindow({
          type: 'audio-bridge-stop',
          sessionId: standaloneSessionId,
        });
      }

      stopAudioResources({
        analyzerRef,
        audioContextRef,
        audioRef,
        microphoneStreamRef,
        sharedAudioStreamRef,
        synthEngineRef,
      }, setConfig, setIsAudioActive);
    } finally {
      stopAudioInProgressRef.current = false;
    }
  }, [postToStandaloneSynthWindow, setConfig]);

  const startAudio = useCallback(async () => {
    if (latestConfigRef.current.audioSourceMode === 'standalone-synth') {
      try {
        stopAudio();
        setAudioNotice(null);
        const sessionId = ensureStandaloneSynthWindow();
        postToStandaloneSynthWindow({
          type: 'audio-bridge-connect',
          sessionId,
          config: latestConfigRef.current,
          autoStart: true,
        });
        postToStandaloneSynthWindow({
          type: 'audio-bridge-start',
          sessionId,
          config: latestConfigRef.current,
        });
        setAudioNotice({
          tone: 'success',
          message: 'Standalone synth window opened. If audio does not start automatically there, click Start Audio in that window.',
        });
      } catch (err) {
        console.error('Standalone synth initialization failed:', err);
        const message = err instanceof Error ? err.message : 'Standalone synth window could not be opened.';
        setAudioNotice({ tone: 'error', message });
      }
      return;
    }

    try {
      stopAudio();
      setAudioNotice(null);
      await startSelectedAudioSource(
        latestConfigRef,
        {
          analyzerRef,
          audioContextRef,
          audioRef,
          microphoneStreamRef,
          sharedAudioStreamRef,
          synthEngineRef,
        },
        {
          setAudioNotice,
          setConfig,
          setIsAudioActive,
        },
        stopAudio,
      );
    } catch (err) {
      console.error('Audio initialization failed:', err);
      const message = err instanceof Error ? err.message : 'Audio input could not be started.';
      setAudioNotice({ tone: 'error', message });
    }
  }, [ensureStandaloneSynthWindow, latestConfigRef, postToStandaloneSynthWindow, setConfig, stopAudio]);

  const handleAudioSourceModeChange = useCallback((mode: AudioSourceMode) => {
    stopAudio();
    setAudioNotice(null);
    setConfig((prev) => ({ ...prev, audioSourceMode: mode }));
  }, [setConfig, stopAudio]);

  useEffect(() => {
    const synth = synthEngineRef.current;
    if (!synth || latestConfigRef.current.audioSourceMode !== 'internal-synth') {
      return;
    }

    applySynthSettings(synth, latestConfigRef.current);
  }, [config.synthCutoff, config.synthPatternDepth, config.synthVolume, config.synthWaveform, latestConfigRef]);

  useEffect(() => {
    const synth = synthEngineRef.current;
    if (!synth || latestConfigRef.current.audioSourceMode !== 'internal-synth') {
      return;
    }

    restartSynthSequencer(synth, latestConfigRef.current);

    return () => {
      if (synth.stepTimer !== null) {
        window.clearInterval(synth.stepTimer);
        synth.stepTimer = null;
      }
    };
  }, [
    config.synthBaseFrequency,
    config.synthCutoff,
    config.synthPattern,
    config.synthPatternDepth,
    config.synthScale,
    config.synthTempo,
    latestConfigRef,
  ]);

  useEffect(() => {
    analysisOptionsRef.current = {
      sensitivity: config.audioSensitivity,
      gateThreshold: config.audioGateThreshold,
      responseCurve: config.audioResponseCurve,
      pulseDecay: config.audioPulseDecay,
      bandALowHz: config.audioBandALowHz,
      bandAHighHz: config.audioBandAHighHz,
      bandBLowHz: config.audioBandBLowHz,
      bandBHighHz: config.audioBandBHighHz,
      sampleRate: audioContextRef.current?.sampleRate ?? 44100,
    };
  }, [config.audioGateThreshold, config.audioPulseDecay, config.audioResponseCurve, config.audioSensitivity,
      config.audioBandALowHz, config.audioBandAHighHz, config.audioBandBLowHz, config.audioBandBHighHz]);

  useEffect(() => {
    if (!isAudioActive || !analyzerRef.current) {
      return;
    }
    return startAudioLevelMonitoring(analyzerRef, audioRef, analysisOptionsRef);
  }, [isAudioActive]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      if (!isAudioBridgeHostMessage(message)) {
        return;
      }

      if (message.sessionId !== standaloneSynthSessionIdRef.current) {
        return;
      }

      if (latestConfigRef.current.audioSourceMode !== 'standalone-synth' && message.type !== 'audio-bridge-closed') {
        return;
      }

      if (message.type === 'audio-bridge-ready') {
        postToStandaloneSynthWindow({
          type: 'audio-bridge-config',
          sessionId: message.sessionId,
          config: latestConfigRef.current,
        });
        postToStandaloneSynthWindow({
          type: 'audio-bridge-start',
          sessionId: message.sessionId,
          config: latestConfigRef.current,
        });
        return;
      }

      if (message.type === 'audio-bridge-status') {
        if (!message.active) {
          audioRef.current = { ...ZERO_AUDIO_LEVELS };
        }
        setIsAudioActive(message.active);
        setConfig((prev) => ({ ...prev, audioEnabled: message.active }));
        if (message.notice) {
          setAudioNotice(message.notice);
        }
        return;
      }

      if (message.type === 'audio-bridge-levels') {
        // The standalone-synth bridge protocol carries only bass/treble/pulse;
        // bandA/bandB and the FFT spectrum bands are zero on this path by design.
        audioRef.current = { bass: message.bass, treble: message.treble, pulse: message.pulse, bandA: 0, bandB: 0, sub: 0, low: 0, mid: 0, high: 0, presence: 0, level: 0 };
        return;
      }

      if (message.type === 'audio-bridge-error') {
        setIsAudioActive(false);
        setConfig((prev) => ({ ...prev, audioEnabled: false }));
        setAudioNotice({ tone: 'error', message: message.message });
        return;
      }

      if (message.type === 'audio-bridge-closed') {
        standaloneSynthWindowRef.current = null;
        standaloneSynthSessionIdRef.current = null;
        audioRef.current = { ...ZERO_AUDIO_LEVELS };
        setIsAudioActive(false);
        setConfig((prev) => ({ ...prev, audioEnabled: false }));
        if (latestConfigRef.current.audioSourceMode === 'standalone-synth') {
          setAudioNotice({ tone: 'error', message: 'Standalone synth window was closed.' });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [latestConfigRef, postToStandaloneSynthWindow, setConfig]);

  useEffect(() => {
    if (latestConfigRef.current.audioSourceMode !== 'standalone-synth') {
      return;
    }

    const standaloneSessionId = standaloneSynthSessionIdRef.current;
    if (!standaloneSessionId) {
      return;
    }

    postToStandaloneSynthWindow({
      type: 'audio-bridge-config',
      sessionId: standaloneSessionId,
      config: latestConfigRef.current,
    });
  }, [config, latestConfigRef, postToStandaloneSynthWindow]);

  useEffect(() => () => {
    stopAudio();
  }, [stopAudio]);

  return {
    audioRef,
    audioNotice,
    dismissAudioNotice,
    handleAudioSourceModeChange,
    isAudioActive,
    microphoneStreamRef,
    sharedAudioStreamRef,
    startAudio,
    stopAudio,
    synthEngineRef,
  };
}
