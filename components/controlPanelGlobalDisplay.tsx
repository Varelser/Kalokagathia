import React from 'react';

import { Camera, Layers3, Monitor, Move3d } from 'lucide-react';
import { getConfigPerformanceScore, getConfigPerformanceTier, getRenderQualityDescription } from '../lib/performanceHints';
import { getActiveRenderModes, getRenderCategorySummary, getRenderSupportSummary } from '../lib/renderModeRegistry';
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
