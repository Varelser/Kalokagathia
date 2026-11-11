import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const GlobalDisplayGpgpuTrailsSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* Trail */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Motion Trail" value={config.gpgpuTrailEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTrailEnabled', v)} />
      {config.gpgpuTrailEnabled && (
        <>
          <Slider label="Trail Length" value={config.gpgpuTrailLength} min={2} max={16} step={1} onChange={(v) => updateConfig('gpgpuTrailLength', v)} />
          <Slider label="Trail Fade" value={config.gpgpuTrailFade} min={0} max={0.99} step={0.01} onChange={(v) => updateConfig('gpgpuTrailFade', v)} />
          <Slider label="Velocity Scale" value={config.gpgpuTrailVelocityScale} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTrailVelocityScale', v)} />
        </>
      )}
    </div>

    {/* Streak Rendering */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Streak Rendering" value={config.gpgpuStreakEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuStreakEnabled', v)} />
      {config.gpgpuStreakEnabled && (
        <>
          <Slider label="Streak Length" value={config.gpgpuStreakLength} min={1} max={100} step={1} onChange={(v) => updateConfig('gpgpuStreakLength', v)} />
          <Slider label="Opacity" value={config.gpgpuStreakOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuStreakOpacity', v)} />
        </>
      )}
    </div>

    {/* Tube Trail (circular cross-section) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Tube Trail (Circular)" value={config.gpgpuTubeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuTubeEnabled', v)} />
      {config.gpgpuTubeEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            8-sided circular cross-section tube trail. Uses Trail Length &amp; Fade from the Trail section.
          </div>
          <Slider label="Tube Radius" value={config.gpgpuTubeRadius} min={0.5} max={20} step={0.5} onChange={(v) => updateConfig('gpgpuTubeRadius', v)} />
          <Slider label="Opacity" value={config.gpgpuTubeOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTubeOpacity', v)} />
        </>
      )}
    </div>

    {/* Smooth Tube (CatmullRom per-particle) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Smooth Tube Trail" value={config.gpgpuSmoothTubeEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSmoothTubeEnabled', v)} />
      {config.gpgpuSmoothTubeEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Smooth 3D tube trail for a subset of GPGPU particles via CPU position history.
          </div>
          <Slider label="Particle Count" value={config.gpgpuSmoothTubeCount} min={4} max={128} step={4} onChange={(v) => updateConfig('gpgpuSmoothTubeCount', Math.round(v))} />
          <Slider label="History Frames" value={config.gpgpuSmoothTubeHistory} min={4} max={32} step={2} onChange={(v) => updateConfig('gpgpuSmoothTubeHistory', Math.round(v))} />
          <Slider label="Tube Radius" value={config.gpgpuSmoothTubeRadius} min={0.5} max={15} step={0.5} onChange={(v) => updateConfig('gpgpuSmoothTubeRadius', v)} />
          <Slider label="Opacity" value={config.gpgpuSmoothTubeOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuSmoothTubeOpacity', v)} />
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[10px] text-white/60 uppercase tracking-wider">Color</label>
            <input type="color" value={config.gpgpuSmoothTubeColor} onChange={(e) => updateConfig('gpgpuSmoothTubeColor', e.target.value)} className="w-8 h-6 rounded border border-white/20 bg-transparent cursor-pointer" />
          </div>
        </>
      )}
    </div>

    {/* Ribbon Trail */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Ribbon Trail" value={config.gpgpuRibbonEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuRibbonEnabled', v)} />
      {config.gpgpuRibbonEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Quad-strip ribbons between trail frames — smooth silhouette trails instead of point clouds. Uses Trail Length &amp; Fade from the Trail section.
          </div>
          <Slider label="Width" value={config.gpgpuRibbonWidth} min={0.5} max={30} step={0.5} onChange={(v) => updateConfig('gpgpuRibbonWidth', v)} />
          <Slider label="Opacity" value={config.gpgpuRibbonOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuRibbonOpacity', v)} />
          <Slider label="Taper" value={config.gpgpuRibbonTaper} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuRibbonTaper', v)} />
          <Slider label="Max Seg Len" value={config.gpgpuRibbonMaxSegLen} min={10} max={300} step={5} onChange={(v) => updateConfig('gpgpuRibbonMaxSegLen', v)} />
        </>
      )}
    </div>
  </>
);
