import React from 'react';

import { Camera, Layers3, Monitor, Move3d } from 'lucide-react';
import { getConfigPerformanceScore, getConfigPerformanceTier, getRenderQualityDescription } from '../lib/performanceHints';
import { getActiveRenderModes, getRenderCategorySummary, getRenderSupportSummary } from '../lib/renderModeRegistry';
import { KINETIX_STAGE_BACKGROUNDS } from '../lib/kinetixGradients';
import { HORIZON_GRADIENT_PRESETS } from '../lib/horizonBackground';
import { Slider, Toggle } from './controlPanelParts';
import { ControlPanelContentProps } from './controlPanelTabsShared';
import { GlobalDisplayEffectsSection } from './controlPanelGlobalDisplayEffects';
import { GlobalDisplayProductPacksSection } from './controlPanelGlobalDisplayProductPacks';
import { useGlobalDisplayProductPacks } from './useGlobalDisplayProductPacks';

export const GlobalDisplaySection: React.FC<ControlPanelContentProps> = ({
  applyPerformancePreset,
  applyScreenFxPreset,
  config,
  contactAmount,
  isPublicLibrary,
  updateConfig,
}) => {
  const performanceTier = getConfigPerformanceTier(config);
  const performanceScore = getConfigPerformanceScore(config);
  const activeRenderModes = getActiveRenderModes(config);
  const renderCategorySummary = getRenderCategorySummary(config);
  const renderSupportSummary = getRenderSupportSummary(config);

  const productPackState = useGlobalDisplayProductPacks({
    config,
    isPublicLibrary,
    updateConfig,
  });

  return (
    <>
      <div className={isPublicLibrary ? 'pointer-events-none opacity-45 select-none' : ''}>
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Monitor size={12} /> Display
        </h3>
        <div className="mb-4 rounded border border-white/10 bg-white/5 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-white/70">
            <span>Render Quality</span>
            <span className="font-mono">{performanceTier}</span>
          </div>
          <Toggle
            label="Quality Profile"
            value={config.renderQuality}
            options={[
              { label: 'Draft', val: 'draft' },
              { label: 'Balanced', val: 'balanced' },
              { label: 'Cinematic', val: 'cinematic' },
            ]}
            onChange={(value) => updateConfig('renderQuality', value)}
          />
          <div className="mt-2 text-[10px] text-white/50">
            {getRenderQualityDescription(config.renderQuality)}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button
              onClick={() => applyPerformancePreset('editing')}
              className="rounded border border-white/15 bg-white/5 px-2 py-2 text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/10"
            >
              Optimize Edit
            </button>
            <button
              onClick={() => applyPerformancePreset('balanced')}
              className="rounded border border-white/15 bg-white/5 px-2 py-2 text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/10"
            >
              Balanced
            </button>
            <button
              onClick={() => applyPerformancePreset('cinematic')}
              className="rounded border border-white/15 bg-white/5 px-2 py-2 text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/10"
            >
              Cinematic
            </button>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.2em] text-white/45">
              <span>Scene Load</span>
              <span>{Math.round(performanceScore * 10) / 10}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-[width] duration-150 ${
                  performanceTier === 'heavy' ? 'bg-red-300' : performanceTier === 'medium' ? 'bg-white/80' : 'bg-white/45'
                }`}
                style={{ width: `${Math.min(100, performanceScore * 8)}%` }}
              />
            </div>
          </div>
        </div>
        <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
          <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/70">
            <Layers3 size={12} /> Render Classes
          </div>
          <div className="mb-3 text-[10px] text-white/45 leading-relaxed">
            Current render stack grouped by primitive class. This is the registry layer for expanding beyond one particle pipeline.
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded border border-white/10 bg-black/20 p-2">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">Stable</div>
              <div className="mt-1 text-sm font-bold text-white/85">{renderSupportSummary.stable}</div>
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-2">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">Experimental</div>
              <div className="mt-1 text-sm font-bold text-white/85">{renderSupportSummary.experimental}</div>
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-2">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">Heavy</div>
              <div className="mt-1 text-sm font-bold text-white/85">{renderSupportSummary.heavy}</div>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            {renderCategorySummary.map((entry) => (
              <div key={entry.category} className="rounded border border-white/10 bg-black/20 px-2 py-2">
                <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.2em] text-white/45">
                  <span>{entry.category}</span>
                  <span className="font-mono text-white/65">{entry.activeCount}/{entry.totalCount}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-white/60" style={{ width: `${entry.totalCount > 0 ? (entry.activeCount / entry.totalCount) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {activeRenderModes.length > 0 ? activeRenderModes.map((mode) => (
              <div key={mode.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                <div className="text-[9px] uppercase tracking-[0.2em] text-white/45">{mode.category} · {mode.support}</div>
                <div className="mt-1 text-[11px] font-medium text-white/85">{mode.label}</div>
              </div>
            )) : (
              <div className="text-[10px] text-white/45">No render class is active yet.</div>
            )}
          </div>
        </div>
        <Toggle label="Background" value={config.backgroundColor} options={[{ label: 'Black', val: 'black' }, { label: 'White', val: 'white' }]} onChange={(value) => updateConfig('backgroundColor', value)} />
        <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Stage Background (Kinetix)</div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {KINETIX_STAGE_BACKGROUNDS.map((bg) => {
            const active = config.backgroundHex === bg.hex;
            return (
              <button
                key={bg.id}
                onClick={() => {
                  updateConfig('backgroundHex', bg.hex);
                  updateConfig('backgroundColor', bg.tone);
                  updateConfig('particleColor', bg.tone === 'white' ? 'black' : 'white');
                }}
                className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] transition-colors ${active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/10 text-white/70 hover:bg-white/5'}`}
              >
                <span className="inline-block h-3 w-3 rounded-sm border border-white/30" style={{ backgroundColor: bg.hex }} />
                {bg.name}
              </button>
            );
          })}
        </div>
        <div className="mb-2 flex items-center gap-2">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(config.backgroundHex) ? config.backgroundHex : '#000000'}
            onChange={(e) => updateConfig('backgroundHex', e.target.value)}
            className="h-8 w-14 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
          />
          <div className="flex-1 text-[10px] text-white/50">
            {config.backgroundHex ? `Custom background ${config.backgroundHex}（トーン判定は Background 側）` : '任意色は未設定（従来の黒/白トーン）'}
          </div>
          {config.backgroundHex && (
            <button onClick={() => updateConfig('backgroundHex', '')} className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/5">Clear</button>
          )}
        </div>
        <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Horizon Background</div>
        <Toggle
          label="Background Mode"
          value={config.backgroundMode}
          options={[
            { label: 'Solid', val: 'solid' },
            { label: 'Gradient', val: 'gradient' },
            { label: 'Image', val: 'image' },
          ]}
          onChange={(value) => updateConfig('backgroundMode', value)}
        />
        {config.backgroundMode === 'gradient' && (
          <div className="mb-2 rounded border border-white/10 bg-white/5 p-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {HORIZON_GRADIENT_PRESETS.map((preset) => {
                const active = config.backgroundGradientColorA === preset.colorA
                  && config.backgroundGradientColorB === preset.colorB
                  && config.backgroundGradientType === preset.type;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      updateConfig('backgroundGradientColorA', preset.colorA);
                      updateConfig('backgroundGradientColorB', preset.colorB);
                      updateConfig('backgroundGradientType', preset.type);
                      updateConfig('backgroundGradientAngle', preset.angle);
                      updateConfig('backgroundColor', preset.tone);
                      updateConfig('particleColor', preset.tone === 'white' ? 'black' : 'white');
                    }}
                    className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] transition-colors ${active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/10 text-white/70 hover:bg-white/5'}`}
                  >
                    <span
                      className="inline-block h-3 w-3 rounded-sm border border-white/30"
                      style={{ background: preset.type === 'radial' ? `radial-gradient(circle, ${preset.colorA}, ${preset.colorB})` : `linear-gradient(0deg, ${preset.colorA}, ${preset.colorB})` }}
                    />
                    {preset.name}
                  </button>
                );
              })}
            </div>
            <div className="mb-2 flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[10px] text-white/60">
                A
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(config.backgroundGradientColorA) ? config.backgroundGradientColorA : '#000000'}
                  onChange={(e) => updateConfig('backgroundGradientColorA', e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-white/60">
                B
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(config.backgroundGradientColorB) ? config.backgroundGradientColorB : '#232830'}
                  onChange={(e) => updateConfig('backgroundGradientColorB', e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
                />
              </label>
              <div className="flex-1 text-[10px] text-white/50">2色グラデーション（A → B）</div>
            </div>
            <Toggle
              label="Gradient Type"
              value={config.backgroundGradientType}
              options={[
                { label: 'Linear', val: 'linear' },
                { label: 'Radial', val: 'radial' },
              ]}
              onChange={(value) => updateConfig('backgroundGradientType', value)}
            />
            {config.backgroundGradientType === 'linear' && (
              <Slider label="Gradient Angle" value={config.backgroundGradientAngle} min={0} max={360} step={1} onChange={(value) => updateConfig('backgroundGradientAngle', value)} />
            )}
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              角度は画面空間（0=左→右、90=下→上）。放射は中心（A）→ 外周（B）。透過書き出し・配信の透過面では背景は従来どおり無効になります。
            </div>
          </div>
        )}
        {config.backgroundMode === 'image' && (
          <HorizonImageBlock config={config} updateConfig={updateConfig} />
        )}
        <Toggle label="Particles" value={config.particleColor} options={[{ label: 'White', val: 'white' }, { label: 'Black', val: 'black' }]} onChange={(value) => updateConfig('particleColor', value)} />
        <Slider label="Base Opacity" value={config.opacity} min={0.1} max={1} step={0.01} onChange={(value) => updateConfig('opacity', value)} />
        <Slider label="Contrast / Intensity" value={config.contrast} min={0.5} max={5.0} step={0.1} onChange={(value) => updateConfig('contrast', value)} />
        <Slider label="Edge Softness" value={config.particleSoftness} min={0} max={1} step={0.01} onChange={(value) => updateConfig('particleSoftness', value)} />
        <Slider label="Glow / Halo" value={config.particleGlow} min={0} max={1.5} step={0.01} onChange={(value) => updateConfig('particleGlow', value)} />
        <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
          <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">Inter-Layer Collision</div>
          <Toggle label="Layer Repulsion" value={config.interLayerCollisionEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => updateConfig('interLayerCollisionEnabled', value)} />
          {config.interLayerCollisionEnabled && (
            <>
              <div className="mb-4 rounded border border-white/10 bg-black/20 p-3" data-contact-meter={contactAmount.toFixed(3)}>
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-white/65">
                  <span>Contact Meter</span>
                  <span className="font-mono">{Math.round(contactAmount * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-white transition-[width] duration-150" style={{ width: `${Math.max(0, Math.min(100, contactAmount * 100))}%` }} />
                </div>
              </div>
              <Toggle
                label="Collider Mode"
                value={config.interLayerCollisionMode}
                options={[
                  { label: 'Layer Volume', val: 'layer-volume' },
                  { label: 'Per Source', val: 'source-volume' },
                ]}
                onChange={(value) => updateConfig('interLayerCollisionMode', value)}
              />
              <Slider label="Push Strength" value={config.interLayerCollisionStrength} min={0} max={200} step={1} onChange={(value) => updateConfig('interLayerCollisionStrength', value)} />
              <Slider label="Collision Padding" value={config.interLayerCollisionPadding} min={0} max={400} step={1} onChange={(value) => updateConfig('interLayerCollisionPadding', value)} />
              <Toggle label="Audio Link" value={config.interLayerAudioReactive} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => updateConfig('interLayerAudioReactive', value)} />
              {config.interLayerAudioReactive && (
                <Slider label="Audio Boost" value={config.interLayerAudioBoost} min={0} max={4} step={0.05} onChange={(value) => updateConfig('interLayerAudioBoost', value)} />
              )}
              <Toggle label="Impact FX" value={config.interLayerContactFxEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => updateConfig('interLayerContactFxEnabled', value)} />
              {config.interLayerContactFxEnabled && (
                <>
                  <Slider label="Contact Glow" value={config.interLayerContactGlowBoost} min={0} max={2} step={0.01} onChange={(value) => updateConfig('interLayerContactGlowBoost', value)} />
                  <Slider label="Contact Size" value={config.interLayerContactSizeBoost} min={0} max={2} step={0.01} onChange={(value) => updateConfig('interLayerContactSizeBoost', value)} />
                  <Slider label="Contact Line Boost" value={config.interLayerContactLineBoost} min={0} max={2} step={0.01} onChange={(value) => updateConfig('interLayerContactLineBoost', value)} />
                  <Slider label="Contact Screen Boost" value={config.interLayerContactScreenBoost} min={0} max={1.5} step={0.01} onChange={(value) => updateConfig('interLayerContactScreenBoost', value)} />
                </>
              )}
            </>
          )}
        </div>
        <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
          <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">Particle Shape &amp; Lighting</div>
          <Toggle
            label="SDF Shape Mode"
            value={config.sdfShapeEnabled}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(value) => updateConfig('sdfShapeEnabled', value)}
          />
          {config.sdfShapeEnabled && (
            <>
              <Toggle
                label="Shape"
                value={config.sdfShape}
                options={[
                  { label: 'Sphere', val: 'sphere' },
                  { label: 'Ring', val: 'ring' },
                  { label: 'Star', val: 'star' },
                  { label: 'Hex', val: 'hexagon' },
                  { label: 'Diamond', val: 'diamond' },
                  { label: 'Flare', val: 'flare' },
                  { label: 'Cloud', val: 'cloud' },
                  { label: 'Bokeh', val: 'bokeh' },
                  { label: 'Crosshair', val: 'crosshair' },
                  { label: 'Iris', val: 'iris' },
                  { label: 'Lightning', val: 'lightning' },
                ]}
                onChange={(value) => updateConfig('sdfShape', value)}
              />
              <Slider label="Specular Intensity" value={config.sdfSpecularIntensity} min={0} max={3} step={0.05} onChange={(value) => updateConfig('sdfSpecularIntensity', value)} />
              <Slider label="Shininess" value={config.sdfSpecularShininess} min={1} max={64} step={1} onChange={(value) => updateConfig('sdfSpecularShininess', value)} />
              <Slider label="Ambient Light" value={config.sdfAmbientLight} min={0} max={1} step={0.01} onChange={(value) => updateConfig('sdfAmbientLight', value)} />
              <Slider label="Light X" value={config.sdfLightX} min={-1} max={1} step={0.01} onChange={(value) => updateConfig('sdfLightX', value)} />
              <Slider label="Light Y" value={config.sdfLightY} min={-1} max={1} step={0.01} onChange={(value) => updateConfig('sdfLightY', value)} />
            </>
          )}
        </div>
        <GlobalDisplayProductPacksSection {...productPackState} isPublicLibrary={isPublicLibrary} />
        <GlobalDisplayEffectsSection
          config={config}
          updateConfig={updateConfig}
          applyScreenFxPreset={applyScreenFxPreset}
        />
      </div>

      <div className={`${isPublicLibrary ? 'pointer-events-none opacity-45 select-none' : ''} pt-4 border-t border-white/10`}>
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Camera size={12} /> Camera & View
        </h3>
        <Toggle
          label="Camera Control"
          value={config.cameraControlMode}
          options={[
            { label: 'Auto', val: 'auto' },
            { label: 'Hybrid', val: 'hybrid' },
            { label: 'Manual', val: 'manual' },
          ]}
          onChange={(value) => updateConfig('cameraControlMode', value)}
        />
        <div className="mb-3 text-[10px] text-white/45">
          {config.cameraControlMode === 'auto'
            ? 'Auto locks OrbitControls and lets the camera rig fully choreograph motion.'
            : config.cameraControlMode === 'manual'
              ? 'Manual disables camera impulse so orbit, pan, and zoom stay fully user-driven.'
              : 'Hybrid keeps OrbitControls live and adds camera impulse only when you are not interacting.'}
        </div>
        <div className="mb-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">View Presets</div>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => {
                updateConfig('cameraControlMode', 'auto');
                updateConfig('manualRotationX', 0);
                updateConfig('manualRotationY', 0);
                updateConfig('manualRotationZ', 0);
                updateConfig('cameraDistance', 60);
                updateConfig('perspective', 1000);
              }}
              className="py-2 text-[9px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Perspective
            </button>
            <button
              onClick={() => {
                updateConfig('cameraControlMode', 'manual');
                updateConfig('manualRotationX', 0);
                updateConfig('manualRotationY', 0);
                updateConfig('manualRotationZ', 0);
                updateConfig('cameraDistance', 60);
              }}
              className="py-2 text-[9px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Front
            </button>
            <button
              onClick={() => {
                updateConfig('cameraControlMode', 'manual');
                updateConfig('manualRotationX', Math.PI / 2);
                updateConfig('manualRotationY', 0);
                updateConfig('manualRotationZ', 0);
                updateConfig('cameraDistance', 60);
              }}
              className="py-2 text-[9px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Top
            </button>
            <button
              onClick={() => {
                updateConfig('cameraControlMode', 'manual');
                updateConfig('manualRotationX', 0);
                updateConfig('manualRotationY', 0);
                updateConfig('manualRotationZ', 0);
                updateConfig('cameraDistance', 28);
              }}
              className="py-2 text-[9px] font-bold uppercase rounded border border-white/20 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Close-up
            </button>
          </div>
          <div className="mt-2 text-[10px] text-white/45">
            Kinetix-style viewpoint presets (B4): they only set the existing camera / manual-rotation keys — Perspective restores the auto rig defaults, Top frames the scene from above via the X axis rotation.
          </div>
        </div>
        <Toggle label="View Mode" value={config.viewMode || 'perspective'} options={[{ label: '3D (Persp)', val: 'perspective' }, { label: '2D (Ortho)', val: 'orthographic' }]} onChange={(value) => updateConfig('viewMode', value)} />
        <Slider label="Perspective (FOV) (3D Only)" value={config.perspective} min={200} max={3000} step={50} onChange={(value) => updateConfig('perspective', value)} />
        <Slider label={config.viewMode === 'orthographic' ? 'Camera Zoom (2D)' : 'Camera Distance (3D)'} value={config.cameraDistance} min={0} max={5000} step={10} onChange={(value) => updateConfig('cameraDistance', value)} />
        <Slider label="Camera Impulse" value={config.cameraImpulseStrength} min={0} max={2} step={0.01} onChange={(value) => updateConfig('cameraImpulseStrength', value)} />
        <Slider label="Impulse Speed" value={config.cameraImpulseSpeed} min={0.05} max={4} step={0.01} onChange={(value) => updateConfig('cameraImpulseSpeed', value)} />
        <Slider label="Impulse Drift" value={config.cameraImpulseDrift} min={0} max={2} step={0.01} onChange={(value) => updateConfig('cameraImpulseDrift', value)} />
        <Slider label="Burst Camera Boost" value={config.cameraBurstBoost} min={0} max={2} step={0.01} onChange={(value) => updateConfig('cameraBurstBoost', value)} />
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 text-[10px] uppercase tracking-widest font-medium opacity-70 mb-1">Manual Axis Rotation</div>
          <div className="col-span-2">
            <Slider label="X Axis" value={config.manualRotationX} min={0} max={Math.PI * 2} step={0.05} onChange={(value) => updateConfig('manualRotationX', value)} />
            <Slider label="Y Axis" value={config.manualRotationY} min={0} max={Math.PI * 2} step={0.05} onChange={(value) => updateConfig('manualRotationY', value)} />
            <Slider label="Z Axis" value={config.manualRotationZ} min={0} max={Math.PI * 2} step={0.05} onChange={(value) => updateConfig('manualRotationZ', value)} />
          </div>
        </div>
      </div>

      <div className={`${isPublicLibrary ? 'pointer-events-none opacity-45 select-none' : ''} pt-4 border-t border-white/10`}>
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Move3d size={12} /> Auto Animation
        </h3>
        <Slider label="Auto Speed X" value={config.rotationSpeedX} min={-0.2} max={0.2} step={0.001} onChange={(value) => updateConfig('rotationSpeedX', value)} />
        <Slider label="Auto Speed Y" value={config.rotationSpeedY} min={-0.2} max={0.2} step={0.001} onChange={(value) => updateConfig('rotationSpeedY', value)} />
      </div>
    </>
  );
};

/**
 * Image source controls for the Horizon 'image' background mode
 * (Phase I). The picked image is downscaled to <=1024px and stored
 * in the config as a data URL (backgroundImageSource), so — like the
 * gradient-driver image — it persists with presets / projects. The
 * texture is baked at the frame's aspect by lib/horizonBackground.ts
 * (cover crops the overflow, fit letterboxes over the solid
 * background colour). While no image is set the solid background
 * shows; the status line states that explicitly.
 */
const HorizonImageBlock: React.FC<Pick<ControlPanelContentProps, 'config' | 'updateConfig'>> = ({ config, updateConfig }) => {
  const source = config.backgroundImageSource;
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = url;
      });
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateConfig('backgroundImageSource', canvas.toDataURL('image/jpeg', 0.87));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            <img src={source} alt="" className="h-8 w-12 rounded border border-white/20 object-cover" />
            <button
              onClick={() => updateConfig('backgroundImageSource', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <Toggle
        label="Image Fit"
        value={config.backgroundImageFit}
        options={[
          { label: 'Cover', val: 'cover' },
          { label: 'Fit', val: 'fit' },
        ]}
        onChange={(value) => updateConfig('backgroundImageFit', value)}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? '画像を設定済み: 背景として表示されます（Cover=画面いっぱいに拡大して余りを切り取り、Fit=全体を表示して余白は単色背景）。画像は 1024px 以下に縮小され、config に保持されます。透過書き出し・配信の透過面では背景は従来どおり無効になります。'
          : '画像が未設定のため、いまは従来の単色背景が表示されています。画像を設定すると背景として表示されます。'}
      </div>
    </div>
  );
};
