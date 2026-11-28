import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { FreeCurveEditor } from './controlPanelGlobalDisplayGpgpuForcesCore';
import { flattenFreeCurvePoints, normalizeFreeCurvePoints } from '../lib/freeCurve';

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
          <Toggle label="Trail Mode （軌跡の作り方・第4段S6）" value={config.gpgpuTrailMode} options={[{ label: 'History', val: 'history' as const }, { label: 'Aux', val: 'aux' as const }]} onChange={(v) => updateConfig('gpgpuTrailMode', v)} />
          {config.gpgpuTrailMode === 'aux' && (
            <>
              <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
                Aux 方式では副粒子（Aux プール）が親粒子から一定間隔で子を落として軌跡を作ります。履歴 RT は構築されず、履歴系の描画（トレイル点・リボン・チューブ）は描かれません。
              </div>
              <Slider label="Emit Interval （発生間隔・フレーム）" value={config.gpgpuTrailEmitInterval} min={1} max={240} step={1} onChange={(v) => updateConfig('gpgpuTrailEmitInterval', Math.round(v))} />
              <Slider label="Emit Rate （発生対象率）" value={config.gpgpuTrailEmitRate} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTrailEmitRate', v)} />
              <Slider label="Aux Life （副粒子の寿命・秒、0=長さから換算）" value={config.gpgpuTrailAuxLife} min={0} max={60} step={0.05} onChange={(v) => updateConfig('gpgpuTrailAuxLife', v)} />
            </>
          )}
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
          <Slider label="Draw Fraction" value={config.gpgpuTubeDrawFraction} min={0.05} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuTubeDrawFraction', v)} />
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
          <Slider label="Tube Taper （断面テーパー）" value={config.gpgpuSmoothTubeTaper} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuSmoothTubeTaper', v)} />
          <Toggle label="Section Shape （断面形状）" value={config.gpgpuSmoothTubeSectionShape} options={[{ label: 'Circle', val: 'circle' as const }, { label: 'Polygon', val: 'polygon' as const }, { label: 'Star', val: 'star' as const }, { label: 'Custom', val: 'custom' as const }]} onChange={(v) => updateConfig('gpgpuSmoothTubeSectionShape', v)} />
          <Slider label="Section Sides （断面の頂点数）" value={config.gpgpuSmoothTubeSectionSides} min={3} max={12} step={1} onChange={(v) => updateConfig('gpgpuSmoothTubeSectionSides', Math.round(v))} />
          {config.gpgpuSmoothTubeSectionShape === 'star' && (
            <Slider label="Section Inner Ratio （星形の内側比）" value={config.gpgpuSmoothTubeSectionInnerRatio} min={0.1} max={0.95} step={0.01} onChange={(v) => updateConfig('gpgpuSmoothTubeSectionInnerRatio', v)} />
          )}
          {config.gpgpuSmoothTubeSectionShape === 'custom' && (
            <>
              <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Section Profile （任意断面・角度→半径倍率 — Phase AM）</div>
              <FreeCurveEditor
                points={normalizeFreeCurvePoints(config.gpgpuSmoothTubeSectionProfile)}
                onChange={(points) => updateConfig('gpgpuSmoothTubeSectionProfile', flattenFreeCurvePoints(points))}
              />
            </>
          )}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Width Profile （幅・長さ方向 — Phase AM）</div>
          <FreeCurveEditor
            points={normalizeFreeCurvePoints(config.gpgpuSmoothTubeWidthProfile)}
            onChange={(points) => updateConfig('gpgpuSmoothTubeWidthProfile', flattenFreeCurvePoints(points))}
          />
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Height Profile （高さ・長さ方向 — Phase AM）</div>
          <FreeCurveEditor
            points={normalizeFreeCurvePoints(config.gpgpuSmoothTubeHeightProfile)}
            onChange={(points) => updateConfig('gpgpuSmoothTubeHeightProfile', flattenFreeCurvePoints(points))}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            幅・高さプロファイルはリング位置（古い履歴→最新）に対する倍率です。全点 1（Flat）で従来同一です。Custom 断面は角度に対する半径倍率を自由曲線で与えます。
          </div>
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
