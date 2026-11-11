import React from 'react';
import { Mic, X } from 'lucide-react';
import type { AudioSourceMode, SynthScale, SynthWaveform } from '../types';
import type { AudioLevels } from '../lib/audioControllerTypes';
import { Slider, SynthPatternEditor, Toggle } from './controlPanelParts';
import { ControlPanelContentProps } from './controlPanelTabsShared';

const SPECTRUM_BANDS: { key: 'sub' | 'low' | 'mid' | 'high' | 'presence' | 'level'; label: string; range: string }[] = [
  { key: 'sub', label: 'Sub', range: '20–60 Hz' },
  { key: 'low', label: 'Low', range: '60–250 Hz' },
  { key: 'mid', label: 'Mid', range: '250–2000 Hz' },
  { key: 'high', label: 'High', range: '2–6 kHz' },
  { key: 'presence', label: 'Presence', range: '6–16 kHz' },
  { key: 'level', label: 'Level', range: '全体' },
];

const ZERO_SPECTRUM: Pick<AudioLevels, 'sub' | 'low' | 'mid' | 'high' | 'presence' | 'level'> = {
  sub: 0, low: 0, mid: 0, high: 0, presence: 0, level: 0,
};

/**
 * Live FFT spectrum meter. Reads the shared levels ref written by
 * useAudioController's analysis loop on a 100ms interval — it does NOT
 * run its own analysis. When no audio source is active the bars are
 * forced to zero and a standby notice is shown (never simulated data).
 */
export const SpectrumMeter: React.FC<{
  audioLevelsRef?: React.MutableRefObject<AudioLevels>;
  isAudioActive: boolean;
  audioSourceMode: AudioSourceMode;
}> = ({ audioLevelsRef, isAudioActive, audioSourceMode }) => {
  const [levels, setLevels] = React.useState(ZERO_SPECTRUM);

  React.useEffect(() => {
    if (!isAudioActive || !audioLevelsRef) {
      setLevels(ZERO_SPECTRUM);
      return;
    }
    const read = () => {
      const current = audioLevelsRef.current;
      setLevels({
        sub: current?.sub ?? 0,
        low: current?.low ?? 0,
        mid: current?.mid ?? 0,
        high: current?.high ?? 0,
        presence: current?.presence ?? 0,
        level: current?.level ?? 0,
      });
    };
    read();
    const timer = window.setInterval(read, 100);
    return () => window.clearInterval(timer);
  }, [audioLevelsRef, isAudioActive]);

  const shown = isAudioActive ? levels : ZERO_SPECTRUM;

  return (
    <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-3" data-testid="spectrum-meter">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest font-bold text-white/60">Spectrum スペクトラム</span>
        <span className="text-[9px] uppercase tracking-widest text-white/35">FFT Bands</span>
      </div>
      <div className="space-y-1.5">
        {SPECTRUM_BANDS.map((band) => {
          const value = Math.max(0, Math.min(1, shown[band.key] ?? 0));
          return (
            <div key={band.key} className="flex items-center gap-2" data-band={band.key}>
              <span className="w-16 shrink-0 text-[9px] uppercase tracking-wider text-white/55">{band.label}</span>
              <div className="h-2 flex-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-2 rounded-full bg-cyan-300/80 transition-[width] duration-100"
                  style={{ width: `${Math.round(value * 100)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[9px] text-white/45">{band.range}</span>
              <span className="w-9 shrink-0 text-right font-mono text-[9px] text-white/60" data-level={value.toFixed(3)}>
                {Math.round(value * 100)}%
              </span>
            </div>
          );
        })}
      </div>
      {!isAudioActive && (
        <div className="mt-2 text-[9px] uppercase tracking-widest text-amber-200/70" data-testid="spectrum-standby">
          {audioSourceMode === 'microphone'
            ? 'マイク未接続のため待機中 — スペクトラム反応は停止しています'
            : 'オーディオ未接続のため待機中 — スペクトラム反応は停止しています'}
        </div>
      )}
    </div>
  );
};

export const AmbientTabContent: React.FC<ControlPanelContentProps> = ({ config, lockedPanelClass, updateConfig }) => (
  <div className={lockedPanelClass}>
    <div className="mb-6">
      <Toggle label="Ambient Dust" value={config.ambientEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('ambientEnabled', v)} />
    </div>
    {config.ambientEnabled && (
      <>
        <Slider label="Particle Count" value={config.ambientCount} min={0} max={100000} step={100} onChange={(v) => updateConfig('ambientCount', v)} />
        <Slider label="Spread / Range" value={config.ambientSpread} min={100} max={5000} step={10} onChange={(v) => updateConfig('ambientSpread', v)} />
        <Slider label="Drift Speed" value={config.ambientSpeed} min={0} max={2.0} step={0.001} onChange={(v) => updateConfig('ambientSpeed', v)} />
        <Slider label="Particle Size" value={config.ambientBaseSize} min={0.1} max={50} step={0.1} onChange={(v) => updateConfig('ambientBaseSize', v)} />
        <div className="mb-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Dust Color</div>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={config.ambientColor}
              onChange={(e) => updateConfig('ambientColor', e.target.value)}
              className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
            />
            <span className="font-mono text-[10px] opacity-60">{config.ambientColor.toUpperCase()}</span>
            <button onClick={() => updateConfig('ambientColor', '#888888')} className="ml-auto rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase hover:bg-white/10">Reset</button>
          </div>
        </div>
      </>
    )}
  </div>
);

export const AudioTabContent: React.FC<ControlPanelContentProps> = ({
  audioActionLabel,
  audioLevelsRef,
  audioNotice,
  audioSourceMode,
  config,
  isAudioActive,
  onAudioSourceModeChange,
  onDismissAudioNotice,
  startAudio,
  stopAudio,
  updateConfig,
}) => (
  <div>
    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
      <Mic size={12} /> Audio Analysis
    </h3>
    <Toggle
      label="Audio Source"
      value={audioSourceMode}
      options={[
        { label: 'Microphone', val: 'microphone' },
        { label: 'Shared Tab / System', val: 'shared-audio' },
        { label: 'Standalone Synth', val: 'standalone-synth' },
        { label: 'Built-in Synth', val: 'internal-synth' },
      ]}
      onChange={(value) => onAudioSourceModeChange(value as AudioSourceMode)}
    />
    <div className="mb-4">
      <button
        onClick={isAudioActive ? stopAudio : startAudio}
        className={`w-full py-3 rounded border font-bold uppercase tracking-wider transition-all ${
          isAudioActive ? 'bg-green-500/20 border-green-500/50 text-green-300' : 'bg-white/5 border-white/20 hover:bg-white/10'
        }`}
      >
        {audioActionLabel}
      </button>
    </div>
    {audioNotice && (
      <div className={`mb-4 flex items-start justify-between gap-3 rounded border px-3 py-2 text-[10px] uppercase tracking-widest ${
        audioNotice.tone === 'error'
          ? 'border-red-400/30 bg-red-500/10 text-red-100/90'
          : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100/90'
      }`}>
        <span>{audioNotice.message}</span>
        <button onClick={onDismissAudioNotice} className="opacity-60 hover:opacity-100">
          <X size={12} />
        </button>
      </div>
    )}
    <SpectrumMeter audioLevelsRef={audioLevelsRef} isAudioActive={isAudioActive} audioSourceMode={audioSourceMode} />
    {audioSourceMode === 'shared-audio' && (
      <div className="mb-4 rounded border border-cyan-400/20 bg-cyan-500/10 px-3 py-3 text-[10px] uppercase tracking-widest text-cyan-100/80">
        <div className="mb-2 font-bold text-cyan-50">YouTube Live / Shared Audio</div>
        <div className="mb-1">1. Press Start Shared Audio.</div>
        <div className="mb-1">2. In the browser picker, prefer a browser tab if you need reliable audio.</div>
        <div className="mb-1">3. Turn on audio sharing before confirming the picker.</div>
        <div>4. If an app window exposes no audio track on macOS, use Standalone Synth instead.</div>
      </div>
    )}
    {audioSourceMode === 'standalone-synth' && (
      <div className="mb-4 rounded border border-emerald-400/20 bg-emerald-500/10 px-3 py-3 text-[10px] uppercase tracking-widest text-emerald-100/80">
        <div className="mb-2 font-bold text-emerald-50">Standalone Synth Window</div>
        <div className="mb-1">1. Press Open Standalone Synth.</div>
        <div className="mb-1">2. A separate window will run the synth and feed analysis back here.</div>
        <div className="mb-1">3. If autoplay is blocked, click Start Audio inside that window once.</div>
        <div className="mb-1">4. This is the reliable fallback when shared app-window/system audio is flaky.</div>
        <div>5. WebM export can mirror this synth into the recording when the standalone synth is active.</div>
      </div>
    )}
    {(audioSourceMode === 'internal-synth' || audioSourceMode === 'standalone-synth') && (
      <>
        <Toggle
          label="Synth Wave"
          value={config.synthWaveform}
          options={[
            { label: 'Sine', val: 'sine' },
            { label: 'Tri', val: 'triangle' },
            { label: 'Saw', val: 'sawtooth' },
            { label: 'Square', val: 'square' },
          ]}
          onChange={(value) => updateConfig('synthWaveform', value as SynthWaveform)}
        />
        <Toggle
          label="Synth Scale"
          value={config.synthScale}
          options={[
            { label: 'Min Pent', val: 'minor-pentatonic' },
            { label: 'Minor', val: 'natural-minor' },
            { label: 'Dorian', val: 'dorian' },
            { label: 'Phryg', val: 'phrygian' },
            { label: 'Major', val: 'major' },
          ]}
          onChange={(value) => updateConfig('synthScale', value as SynthScale)}
        />
        <Slider label="Synth Base Hz" value={config.synthBaseFrequency} min={40} max={440} step={1} onChange={(v) => updateConfig('synthBaseFrequency', v)} />
        <Slider label="Synth Tempo" value={config.synthTempo} min={60} max={180} step={1} onChange={(v) => updateConfig('synthTempo', v)} />
        <Slider label="Synth Volume" value={config.synthVolume} min={0.01} max={0.4} step={0.01} onChange={(v) => updateConfig('synthVolume', v)} />
        <Slider label="Synth Cutoff" value={config.synthCutoff} min={120} max={6000} step={10} onChange={(v) => updateConfig('synthCutoff', v)} />
        <Slider label="Pattern Depth" value={config.synthPatternDepth} min={0} max={1} step={0.01} onChange={(v) => updateConfig('synthPatternDepth', v)} />
        <SynthPatternEditor pattern={config.synthPattern} onChange={(nextPattern) => updateConfig('synthPattern', nextPattern)} />
        <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
          {audioSourceMode === 'standalone-synth'
            ? 'These synth settings are mirrored into the companion window in real time.'
            : 'Use this only when you want the browser to generate its own reference synth.'}
        </div>
      </>
    )}
    <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
      Input Gain
    </div>
    <Slider label={audioSourceMode === 'microphone' ? 'Mic Sensitivity' : 'Analysis Sensitivity'} value={config.audioSensitivity} min={0.1} max={5} step={0.1} onChange={(v) => updateConfig('audioSensitivity', v)} />
    <Slider label="Bass Input Gain" value={config.audioBeatScale} min={0} max={3} step={0.1} onChange={(v) => updateConfig('audioBeatScale', v)} />
    <Slider label="Treble Input Gain" value={config.audioJitterScale} min={0} max={3} step={0.1} onChange={(v) => updateConfig('audioJitterScale', v)} />
    <div className="mb-4 mt-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
      Analysis Dynamics
    </div>
    <Slider label="Gate Threshold" value={config.audioGateThreshold} min={0} max={0.35} step={0.01} onChange={(v) => updateConfig('audioGateThreshold', v)} />
    <Slider label="Response Curve" value={config.audioResponseCurve} min={0.35} max={2.5} step={0.05} onChange={(v) => updateConfig('audioResponseCurve', v)} />
    <Slider label="Pulse Decay" value={config.audioPulseDecay} min={0.02} max={0.6} step={0.01} onChange={(v) => updateConfig('audioPulseDecay', v)} />
    <div className="mb-4 mt-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
      Reactive Routing
    </div>
    <Slider label="Bass -> Motion" value={config.audioBassMotionScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBassMotionScale', v)} />
    <Slider label="Bass -> Size" value={config.audioBassSizeScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBassSizeScale', v)} />
    <Slider label="Bass -> Opacity" value={config.audioBassAlphaScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBassAlphaScale', v)} />
    <Slider label="Treble -> Motion" value={config.audioTrebleMotionScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioTrebleMotionScale', v)} />
    <Slider label="Treble -> Size" value={config.audioTrebleSizeScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioTrebleSizeScale', v)} />
    <Slider label="Treble -> Opacity" value={config.audioTrebleAlphaScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioTrebleAlphaScale', v)} />
    <Slider label="Pulse -> Particles" value={config.audioPulseScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioPulseScale', v)} />
    <Slider label="Pulse -> Burst" value={config.audioBurstScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBurstScale', v)} />
    <Slider label="Pulse -> Screen FX" value={config.audioScreenScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioScreenScale', v)} />
    <Slider label="Pulse -> Motion Morph" value={config.audioMorphScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioMorphScale', v)} />
    <Slider label="Treble -> Shatter" value={config.audioShatterScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioShatterScale', v)} />
    <Slider label="Audio -> Twist" value={config.audioTwistScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioTwistScale', v)} />
    <Slider label="Audio -> Bend" value={config.audioBendScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBendScale', v)} />
    <Slider label="Audio -> Radial Warp" value={config.audioWarpScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioWarpScale', v)} />
    <Slider label="Audio -> Lines" value={config.audioLineScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioLineScale', v)} />
    <Slider label="Audio -> Camera" value={config.audioCameraScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioCameraScale', v)} />
    <Slider label="Audio -> Hue Shift" value={config.audioHueShiftScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioHueShiftScale', v)} />
    <div className="mb-4 mt-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
      Custom Frequency Bands
    </div>
    <div className="mb-4 rounded border border-cyan-400/15 bg-cyan-500/5 px-3 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-cyan-200/80">Band A</div>
      <Slider
        label={`Low Cutoff: ${config.audioBandALowHz >= 1000 ? (config.audioBandALowHz / 1000).toFixed(1) + ' kHz' : config.audioBandALowHz + ' Hz'}`}
        value={config.audioBandALowHz} min={20} max={2000} step={5}
        onChange={(v) => updateConfig('audioBandALowHz', v)}
      />
      <Slider
        label={`High Cutoff: ${config.audioBandAHighHz >= 1000 ? (config.audioBandAHighHz / 1000).toFixed(1) + ' kHz' : config.audioBandAHighHz + ' Hz'}`}
        value={config.audioBandAHighHz} min={50} max={4000} step={10}
        onChange={(v) => updateConfig('audioBandAHighHz', v)}
      />
      <Slider label="Band A → Motion" value={config.audioBandAMotionScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandAMotionScale', v)} />
      <Slider label="Band A → Size" value={config.audioBandASizeScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandASizeScale', v)} />
      <Slider label="Band A → Alpha" value={config.audioBandAAlphaScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandAAlphaScale', v)} />
    </div>
    <div className="mb-4 rounded border border-violet-400/15 bg-violet-500/5 px-3 py-3">
      <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-violet-200/80">Band B</div>
      <Slider
        label={`Low Cutoff: ${config.audioBandBLowHz >= 1000 ? (config.audioBandBLowHz / 1000).toFixed(1) + ' kHz' : config.audioBandBLowHz + ' Hz'}`}
        value={config.audioBandBLowHz} min={200} max={10000} step={50}
        onChange={(v) => updateConfig('audioBandBLowHz', v)}
      />
      <Slider
        label={`High Cutoff: ${config.audioBandBHighHz >= 1000 ? (config.audioBandBHighHz / 1000).toFixed(1) + ' kHz' : config.audioBandBHighHz + ' Hz'}`}
        value={config.audioBandBHighHz} min={500} max={20000} step={100}
        onChange={(v) => updateConfig('audioBandBHighHz', v)}
      />
      <Slider label="Band B → Motion" value={config.audioBandBMotionScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandBMotionScale', v)} />
      <Slider label="Band B → Size" value={config.audioBandBSizeScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandBSizeScale', v)} />
      <Slider label="Band B → Alpha" value={config.audioBandBAlphaScale} min={0} max={4} step={0.1} onChange={(v) => updateConfig('audioBandBAlphaScale', v)} />
    </div>
  </div>
);
