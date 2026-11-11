import React from 'react';
import type { ParticleConfig } from '../types';
import {
  AUDIO_BRIDGE_SESSION_PARAM,
  isAudioBridgeWindowMessage,
} from '../lib/audioBridge';
import { createAudioLevelReader } from '../lib/audioAnalysis';
import { DEFAULT_CONFIG, normalizeConfig } from '../lib/appState';
import { createSynthEngine, stopSynthEngine } from '../lib/audioSynthSource';
import { applySynthSettings, restartSynthSequencer } from '../lib/audioSynth';
import type { Notice, SynthEngine } from '../lib/audioControllerTypes';

function getSequencerSignature(config: ParticleConfig) {
  return JSON.stringify([
    config.synthBaseFrequency,
    config.synthTempo,
    config.synthScale,
    config.synthPatternDepth,
    config.synthPattern,
  ]);
}

export const StandaloneSynthWindow: React.FC = () => {
  const sessionId = React.useMemo(() => {
    if (typeof window === 'undefined') return 'standalone-local';
    return new URLSearchParams(window.location.search).get(AUDIO_BRIDGE_SESSION_PARAM) ?? 'standalone-local';
  }, []);
  const [config, setConfig] = React.useState<ParticleConfig>(() => normalizeConfig(DEFAULT_CONFIG));
  const [isActive, setIsActive] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice | null>({
    tone: 'success',
    message: 'Ready. This window will mirror the synth settings from the main app.',
  });
  const [levels, setLevels] = React.useState({ bass: 0, treble: 0, pulse: 0, bandA: 0, bandB: 0, sub: 0, low: 0, mid: 0, high: 0, presence: 0, level: 0 });
  const synthRef = React.useRef<SynthEngine | null>(null);
  const configRef = React.useRef(config);
  const levelsRef = React.useRef(levels);
  const animationFrameRef = React.useRef<number | null>(null);
  const lastPostedAtRef = React.useRef(0);
  const sequencerSignatureRef = React.useRef(getSequencerSignature(config));

  React.useEffect(() => {
    configRef.current = config;
  }, [config]);

  React.useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  const postToMainWindow = React.useCallback((message: unknown) => {
    if (typeof window === 'undefined' || !window.opener) {
      return;
    }
    window.opener.postMessage(message, window.location.origin);
  }, []);

  const stopLevelLoop = React.useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const syncActiveSynth = React.useCallback((nextConfig: ParticleConfig) => {
    const synth = synthRef.current;
    if (!synth) {
      return;
    }

    applySynthSettings(synth, nextConfig);
    const nextSignature = getSequencerSignature(nextConfig);
    if (nextSignature !== sequencerSignatureRef.current) {
      restartSynthSequencer(synth, nextConfig);
      sequencerSignatureRef.current = nextSignature;
    }
  }, []);

  const startLevelLoop = React.useCallback(() => {
    const synth = synthRef.current;
    if (!synth) {
      return;
    }

    stopLevelLoop();
    const readLevels = createAudioLevelReader(synth.analyser);

    const tick = (timestamp: number) => {
      const nextLevels = readLevels({
        sensitivity: configRef.current.audioSensitivity,
        gateThreshold: configRef.current.audioGateThreshold,
        responseCurve: configRef.current.audioResponseCurve,
        pulseDecay: configRef.current.audioPulseDecay,
        bandALowHz: configRef.current.audioBandALowHz,
        bandAHighHz: configRef.current.audioBandAHighHz,
        bandBLowHz: configRef.current.audioBandBLowHz,
        bandBHighHz: configRef.current.audioBandBHighHz,
        sampleRate: synth.context.sampleRate,
      }, levelsRef.current);
      levelsRef.current = nextLevels;
      setLevels(nextLevels);

      if (timestamp - lastPostedAtRef.current >= 33) {
        lastPostedAtRef.current = timestamp;
        postToMainWindow({
          type: 'audio-bridge-levels',
          sessionId,
          bass: nextLevels.bass,
          treble: nextLevels.treble,
          pulse: nextLevels.pulse,
        });
      }

      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
  }, [postToMainWindow, sessionId, stopLevelLoop]);

  const stopSynth = React.useCallback((nextNotice?: Notice) => {
    stopLevelLoop();

    const synth = synthRef.current;
    synthRef.current = null;
    if (synth) {
      stopSynthEngine(synth);
      void synth.context.close().catch(() => {});
    }

    setIsActive(false);
    levelsRef.current = { bass: 0, treble: 0, pulse: 0, bandA: 0, bandB: 0, sub: 0, low: 0, mid: 0, high: 0, presence: 0, level: 0 };
    setLevels(levelsRef.current);
    if (nextNotice) {
      setNotice(nextNotice);
    }
    postToMainWindow({
      type: 'audio-bridge-status',
      sessionId,
      active: false,
      notice: nextNotice,
    });
  }, [postToMainWindow, sessionId, stopLevelLoop]);

  const startSynth = React.useCallback(async (nextConfig = configRef.current) => {
    try {
      if (synthRef.current) {
        syncActiveSynth(nextConfig);
        await synthRef.current.context.resume();
      } else {
        const synth = await createSynthEngine(nextConfig);
        synthRef.current = synth;
        sequencerSignatureRef.current = getSequencerSignature(nextConfig);
      }

      setIsActive(true);
      setNotice({ tone: 'success', message: 'Standalone synth is running.' });
      postToMainWindow({
        type: 'audio-bridge-status',
        sessionId,
        active: true,
        notice: { tone: 'success', message: 'Standalone synth connected.' },
      });
      startLevelLoop();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Standalone synth could not be started.';
      setNotice({ tone: 'error', message });
      postToMainWindow({
        type: 'audio-bridge-error',
        sessionId,
        message,
      });
    }
  }, [postToMainWindow, sessionId, startLevelLoop, syncActiveSynth]);

  React.useEffect(() => {
    postToMainWindow({
      type: 'audio-bridge-ready',
      sessionId,
    });
  }, [postToMainWindow, sessionId]);

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }

      const message = event.data;
      if (!isAudioBridgeWindowMessage(message) || message.sessionId !== sessionId) {
        return;
      }

      if (message.type === 'audio-bridge-connect' || message.type === 'audio-bridge-config') {
        const nextConfig = normalizeConfig(message.config);
        setConfig(nextConfig);
        if (synthRef.current) {
          syncActiveSynth(nextConfig);
        }
        if (message.type === 'audio-bridge-connect' && message.autoStart) {
          void startSynth(nextConfig);
        }
        return;
      }

      if (message.type === 'audio-bridge-start') {
        const nextConfig = normalizeConfig(message.config ?? configRef.current);
        setConfig(nextConfig);
        void startSynth(nextConfig);
        return;
      }

      if (message.type === 'audio-bridge-stop') {
        stopSynth({ tone: 'success', message: 'Standalone synth stopped.' });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [sessionId, startSynth, stopSynth, syncActiveSynth]);

  React.useEffect(() => {
    const handleBeforeUnload = () => {
      postToMainWindow({
        type: 'audio-bridge-closed',
        sessionId,
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [postToMainWindow, sessionId]);

  React.useEffect(() => () => {
    stopSynth();
  }, [stopSynth]);

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-8">
        <div className="mb-8">
          <div className="mb-2 text-[10px] uppercase tracking-[0.35em] text-cyan-300/75">Kalokagathia Audio Bridge</div>
          <h1 className="text-3xl font-light tracking-[0.08em]">Standalone Synth</h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/65">
            This window runs the synth outside the main canvas so audio stays separate while the visuals still react in the main app.
          </p>
        </div>

        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-white/45">Status</div>
              <div className={`mt-1 text-sm uppercase tracking-[0.22em] ${isActive ? 'text-emerald-300' : 'text-white/60'}`}>
                {isActive ? 'Running' : 'Idle'}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { void startSynth(); }}
                className="rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-cyan-100 transition hover:bg-cyan-400/20"
              >
                Start Audio
              </button>
              <button
                onClick={() => stopSynth({ tone: 'success', message: 'Standalone synth stopped.' })}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/80 transition hover:bg-white/10"
              >
                Stop
              </button>
            </div>
          </div>

          {notice && (
            <div className={`rounded-xl border px-3 py-3 text-xs leading-5 ${
              notice.tone === 'error'
                ? 'border-red-400/30 bg-red-500/10 text-red-100'
                : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'
            }`}>
              {notice.message}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-[10px] uppercase tracking-[0.3em] text-white/45">Live Response</div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/55">
                  <span>Bass</span>
                  <span>{Math.round(levels.bass * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-cyan-300 transition-[width] duration-100" style={{ width: `${Math.round(levels.bass * 100)}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/55">
                  <span>Treble</span>
                  <span>{Math.round(levels.treble * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/10">
                  <div className="h-2 rounded-full bg-fuchsia-300 transition-[width] duration-100" style={{ width: `${Math.round(levels.treble * 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-[10px] uppercase tracking-[0.3em] text-white/45">Mirrored Settings</div>
            <dl className="space-y-2 text-sm text-white/75">
              <div className="flex items-center justify-between gap-4">
                <dt>Wave</dt>
                <dd className="uppercase tracking-[0.16em] text-white/90">{config.synthWaveform}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Scale</dt>
                <dd className="uppercase tracking-[0.16em] text-white/90">{config.synthScale}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Base</dt>
                <dd className="uppercase tracking-[0.16em] text-white/90">{Math.round(config.synthBaseFrequency)} Hz</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Tempo</dt>
                <dd className="uppercase tracking-[0.16em] text-white/90">{Math.round(config.synthTempo)} BPM</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Pattern Depth</dt>
                <dd className="uppercase tracking-[0.16em] text-white/90">{Math.round(config.synthPatternDepth * 100)}%</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/60">
          Use the main Kalokagathia window to change waveform, scale, tempo, and pattern. Those values are mirrored here live.
          For arbitrary audio from another app or browser window, keep using <span className="text-white/85">Shared Tab / System</span>; on macOS the browser may still limit which surfaces expose audio tracks.
        </div>
      </div>
    </div>
  );
};
