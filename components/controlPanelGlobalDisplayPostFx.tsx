import React from 'react';

import type { ParticleConfig } from '../types';
import { buildPostFxStackPatch, getPostFxStackBundleById, POST_FX_STACK_BUNDLES, inferPostFxStackBundleId } from '../lib/postFxLibrary';
import { getOrderedActivePostFxStageIds } from '../lib/postFxStack';
import { Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const GlobalDisplayPostFxSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => {
  const activePostStackBundle = getPostFxStackBundleById(inferPostFxStackBundleId(config));
  const activePostStages = getOrderedActivePostFxStageIds(config).map((stage) => stage.replace(/-/g, ' '));

  const applyPostFxStackBundle = (bundleId: string) => {
    const patch = buildPostFxStackPatch(bundleId);
    (Object.keys(patch) as Array<keyof typeof patch>).forEach((key) => {
      const value = patch[key];
      if (typeof value !== 'undefined') {
        updateConfig(key as keyof ParticleConfig, value as ParticleConfig[keyof ParticleConfig]);
      }
    });
  };

  return (
    <>
      <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
        <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">Post Processing</div>
        <Toggle
          label="Stack Profile"
          value={config.postFxStackProfile}
          options={[
            { label: 'Manual', val: 'manual' },
            { label: 'Touch', val: 'touch-feedback' },
            { label: 'Particular', val: 'particular-glow' },
            { label: 'Retro', val: 'retro-feedback' },
            { label: 'Dream', val: 'dream-smear' },
          ]}
          onChange={(v) => updateConfig('postFxStackProfile', v)}
        />
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
            <span>Independent post stacks</span>
            <span>{activePostStackBundle ? activePostStackBundle.label : 'Custom'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {POST_FX_STACK_BUNDLES.map((bundle) => {
              const active = activePostStackBundle?.id === bundle.id;
              return (
                <button
                  key={bundle.id}
                  onClick={() => applyPostFxStackBundle(bundle.id)}
                  title={bundle.summary}
                  className={`rounded border px-2 py-2 text-left transition-colors ${active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/10 text-white/70 hover:bg-white/5'}`}
                >
                  <div className="text-[9px] uppercase tracking-widest">{bundle.label}</div>
                  <div className="mt-1 text-[9px] leading-relaxed text-white/45">{bundle.emphasis.join(' · ')}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-2 text-[9px] text-white/40">
            Active order · {activePostStages.length > 0 ? activePostStages.join(' → ') : 'No post stages enabled'}
          </div>
        </div>
        <Toggle
          label="Bloom"
          value={config.postBloomEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postBloomEnabled', v)}
        />
        {config.postBloomEnabled && (
          <>
            <Slider label="Bloom Intensity" value={config.postBloomIntensity} min={0} max={5} step={0.05} onChange={(v) => updateConfig('postBloomIntensity', v)} />
            <Slider label="Bloom Radius" value={config.postBloomRadius} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postBloomRadius', v)} />
            <Slider label="Luminance Threshold" value={config.postBloomThreshold} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postBloomThreshold', v)} />
          </>
        )}
        <Toggle
          label="Chromatic Aberration"
          value={config.postChromaticAberrationEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postChromaticAberrationEnabled', v)}
        />
        {config.postChromaticAberrationEnabled && (
          <Slider label="CA Offset" value={config.postChromaticAberrationOffset} min={0} max={0.01} step={0.0001} onChange={(v) => updateConfig('postChromaticAberrationOffset', v)} />
        )}
        <Toggle label="Depth of Field" value={config.postDofEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('postDofEnabled', v)} />
        {config.postDofEnabled && (
          <>
            <Slider label="Focus Distance" value={config.postDofFocusDistance} min={0} max={1} step={0.001} onChange={(v) => updateConfig('postDofFocusDistance', v)} />
            <Slider label="Focal Length" value={config.postDofFocalLength} min={0.001} max={0.3} step={0.001} onChange={(v) => updateConfig('postDofFocalLength', v)} />
            <Slider label="Bokeh Scale" value={config.postDofBokehScale} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('postDofBokehScale', v)} />
          </>
        )}
        <Toggle
          label="Noise"
          value={config.postNoiseEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postNoiseEnabled', v)}
        />
        {config.postNoiseEnabled && (
          <Slider label="Noise Opacity" value={config.postNoiseOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postNoiseOpacity', v)} />
        )}
        <Toggle
          label="Vignette"
          value={config.postVignetteEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postVignetteEnabled', v)}
        />
        {config.postVignetteEnabled && (
          <>
            <Slider label="Vignette Offset" value={config.postVignetteOffset} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postVignetteOffset', v)} />
            <Slider label="Vignette Darkness" value={config.postVignetteDarkness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('postVignetteDarkness', v)} />
          </>
        )}
        <Toggle
          label="Brightness / Contrast"
          value={config.postBrightnessContrastEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postBrightnessContrastEnabled', v)}
        />
        {config.postBrightnessContrastEnabled && (
          <>
            <Slider label="Brightness" value={config.postBrightness} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('postBrightness', v)} />
            <Slider label="Contrast" value={config.postContrastAmount} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('postContrastAmount', v)} />
          </>
        )}
        <Toggle
          label="Feedback (GPU)"
          value={config.postFeedbackEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postFeedbackEnabled', v)}
        />
        {config.postFeedbackEnabled && (
          <>
            <Slider label="Feedback Decay" value={config.postFeedbackDecay} min={0} max={0.97} step={0.01} onChange={(v) => updateConfig('postFeedbackDecay', v)} />
            <Slider label="Feedback Zoom" value={config.postFeedbackZoom} min={0.95} max={1.05} step={0.001} onChange={(v) => updateConfig('postFeedbackZoom', v)} />
            <Slider label="Feedback Rotation" value={config.postFeedbackRotation} min={-0.1} max={0.1} step={0.001} onChange={(v) => updateConfig('postFeedbackRotation', v)} />
          </>
        )}
        <Toggle
          label="Kaleidoscope / Mirror"
          value={config.postKaleidoscopeEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postKaleidoscopeEnabled', v)}
        />
        {config.postKaleidoscopeEnabled && (
          <>
            <Slider label="Kaleidoscope Segments" value={config.postKaleidoscopeSegments} min={2} max={16} step={1} onChange={(v) => updateConfig('postKaleidoscopeSegments', v)} />
            <Slider label="Kaleidoscope Rotation" value={config.postKaleidoscopeRotation} min={-3.14} max={3.14} step={0.01} onChange={(v) => updateConfig('postKaleidoscopeRotation', v)} />
          </>
        )}
        <Toggle
          label="Slit Scan (temporal bands)"
          value={config.postSlitScanEnabled}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(v) => updateConfig('postSlitScanEnabled', v)}
        />
        {config.postSlitScanEnabled && (
          <>
            <Slider label="Slit Scan Bands" value={config.postSlitScanBands} min={4} max={64} step={1} onChange={(v) => updateConfig('postSlitScanBands', v)} />
            <Slider label="Slit Scan Cycle" value={config.postSlitScanCycle} min={2} max={120} step={1} onChange={(v) => updateConfig('postSlitScanCycle', v)} />
          </>
        )}
      </div>
    </>
  );
};
