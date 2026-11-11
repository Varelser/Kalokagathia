import React from 'react';

import { SCREEN_FX_PRESETS, Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayScreenFxSectionProps } from './controlPanelGlobalDisplayEffectsShared';

export const GlobalDisplayScreenFxSection: React.FC<GlobalDisplayScreenFxSectionProps> = ({
  applyScreenFxPreset,
  config,
  updateConfig,
}) => (
  <>
      <Toggle label="Depth Fog" value={config.depthFogEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('depthFogEnabled', v)} />
      {config.depthFogEnabled && (
        <>
          <Slider label="Fog Near" value={config.depthFogNear} min={100} max={5000} step={25} onChange={(v) => updateConfig('depthFogNear', Math.min(v, config.depthFogFar - 50))} />
          <Slider label="Fog Far" value={config.depthFogFar} min={200} max={9000} step={25} onChange={(v) => updateConfig('depthFogFar', Math.max(v, config.depthFogNear + 50))} />
        </>
      )}
      <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
        <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">Screen FX</div>
        <div className="mb-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">FX Presets</div>
          <div className="grid grid-cols-4 gap-2">
            {SCREEN_FX_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyScreenFxPreset(preset)}
                className="py-2 text-[9px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
        <Slider label="Scanline Intensity" value={config.screenScanlineIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenScanlineIntensity', v)} />
        <Slider label="Scanline Density" value={config.screenScanlineDensity} min={120} max={1200} step={10} onChange={(v) => updateConfig('screenScanlineDensity', v)} />
        <Slider label="Film Grain" value={config.screenNoiseIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenNoiseIntensity', v)} />
        <Slider label="Vignette" value={config.screenVignetteIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenVignetteIntensity', v)} />
        <Slider label="Radial Pulse" value={config.screenPulseIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenPulseIntensity', v)} />
        <Slider label="Pulse Speed" value={config.screenPulseSpeed} min={0.1} max={4} step={0.01} onChange={(v) => updateConfig('screenPulseSpeed', v)} />
        <Slider label="Impact Flash" value={config.screenImpactFlashIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenImpactFlashIntensity', v)} />
        <Slider label="Burst Auto Drive" value={config.screenBurstDrive} min={0} max={2} step={0.01} onChange={(v) => updateConfig('screenBurstDrive', v)} />
        <Slider label="Burst Noise Boost" value={config.screenBurstNoiseBoost} min={0} max={2} step={0.01} onChange={(v) => updateConfig('screenBurstNoiseBoost', v)} />
        <Slider label="Burst Flash Boost" value={config.screenBurstFlashBoost} min={0} max={2} step={0.01} onChange={(v) => updateConfig('screenBurstFlashBoost', v)} />
        <Slider label="Interference Bands" value={config.screenInterferenceIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenInterferenceIntensity', v)} />
        <Slider label="Persistence" value={config.screenPersistenceIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenPersistenceIntensity', v)} />
        <Slider label="Persistence Layers" value={config.screenPersistenceLayers} min={1} max={4} step={1} onChange={(v) => updateConfig('screenPersistenceLayers', v)} />
        <Slider label="Signal Split" value={config.screenSplitIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenSplitIntensity', v)} />
        <Slider label="Split Offset" value={config.screenSplitOffset} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenSplitOffset', v)} />
        <Toggle label="Sequence Drive" value={config.screenSequenceDriveEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('screenSequenceDriveEnabled', v)} />
        {config.screenSequenceDriveEnabled && (
          <Slider label="Sequence Boost" value={config.screenSequenceDriveStrength} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenSequenceDriveStrength', v)} />
        )}
        <Slider label="Sweep Glow" value={config.screenSweepIntensity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('screenSweepIntensity', v)} />
        <Slider label="Sweep Speed" value={config.screenSweepSpeed} min={0.1} max={3} step={0.01} onChange={(v) => updateConfig('screenSweepSpeed', v)} />
      </div>
  </>
);
