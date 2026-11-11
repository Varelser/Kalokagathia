import React from 'react';
import { Copy } from 'lucide-react';
import { Layer1SourceSettings, Slider, SourcePositionConfig, Toggle } from './controlPanelParts';
import { ControlPanelContentProps } from './controlPanelTabsShared';

export const Layer1TabContent: React.FC<ControlPanelContentProps> = ({ config, lockedPanelClass, updateConfig, updateLayer1Array, updatePositionArray }) => (
  <div className={lockedPanelClass}>
    <div>
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">L1: Core Structure</h3>
      <Toggle label="Core Visibility" value={config.layer1Enabled} options={[{ label: 'Visible', val: true }, { label: 'Hidden', val: false }]} onChange={(v) => updateConfig('layer1Enabled', v)} />
      {config.layer1Enabled && (
        <>
          <Slider label="Total Core Count" value={config.layer1Count} min={100} max={2000000} step={1000} onChange={(v) => updateConfig('layer1Count', v)} />
          <Slider label="Base Radius (Global)" value={config.sphereRadius} min={10} max={2000} step={10} onChange={(v) => updateConfig('sphereRadius', v)} />
          <Slider label="Particle Size (Global)" value={config.baseSize} min={0.1} max={100} step={0.1} onChange={(v) => updateConfig('baseSize', v)} />
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Particle Color</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={config.layer1Color}
                onChange={(e) => updateConfig('layer1Color', e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
              />
              <span className="font-mono text-[10px] opacity-60">{config.layer1Color.toUpperCase()}</span>
              <button onClick={() => updateConfig('layer1Color', '#ffffff')} className="ml-auto rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase hover:bg-white/10">Reset</button>
            </div>
          </div>
          <Slider label="Volume Density (Global)" value={config.layer1Volume} min={0} max={1} step={0.001} onChange={(v) => updateConfig('layer1Volume', v)} />
          <div className="border-t border-white/10 pt-4 mt-4">
            <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
              <Copy size={12} /> Multi-Sphere Settings
            </h3>
            <Slider label="Sphere Count" value={config.layer1SourceCount || 1} min={1} max={50} step={1} onChange={(v) => updateConfig('layer1SourceCount', v)} />
            <Slider label="Sphere Spread" value={config.layer1SourceSpread || 200} min={0} max={20000} step={10} onChange={(v) => updateConfig('layer1SourceSpread', v)} />
            {config.layer1SourceCount > 1 && (
              <SourcePositionConfig
                count={config.layer1SourceCount}
                positions={config.layer1SourcePositions}
                onChange={(idx, axis, val) => updatePositionArray('layer1SourcePositions', idx, axis, val)}
                currentTheme={config.backgroundColor}
              />
            )}
            {config.layer1SourceCount > 1 && (
              <Layer1SourceSettings
                count={config.layer1SourceCount}
                counts={config.layer1Counts}
                radii={config.layer1Radii}
                volumes={config.layer1Volumes}
                jitters={config.layer1Jitters}
                sizes={config.layer1Sizes}
                pulseSpeeds={config.layer1PulseSpeeds}
                pulseAmps={config.layer1PulseAmps}
                updateCount={(idx, v) => updateLayer1Array('layer1Counts', idx, v)}
                updateRadius={(idx, v) => updateLayer1Array('layer1Radii', idx, v)}
                updateVolume={(idx, v) => updateLayer1Array('layer1Volumes', idx, v)}
                updateJitter={(idx, v) => updateLayer1Array('layer1Jitters', idx, v)}
                updateSize={(idx, v) => updateLayer1Array('layer1Sizes', idx, v)}
                updatePulseSpeed={(idx, v) => updateLayer1Array('layer1PulseSpeeds', idx, v)}
                updatePulseAmp={(idx, v) => updateLayer1Array('layer1PulseAmps', idx, v)}
                currentTheme={config.backgroundColor}
              />
            )}
          </div>
        </>
      )}
    </div>

    {config.layer1Enabled && (
      <div className="mt-4 border-t border-white/10 pt-4">
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">L1: Dynamics</h3>
        <Slider label="Chaos (Global Jitter)" value={config.jitter} min={0} max={500} step={0.1} onChange={(v) => updateConfig('jitter', v)} />
        <Slider label="Pulse Speed" value={config.pulseSpeed} min={0} max={10.0} step={0.001} onChange={(v) => updateConfig('pulseSpeed', v)} />
        <Slider label="Pulse Depth" value={config.pulseAmplitude} min={0} max={5000} step={1} onChange={(v) => updateConfig('pulseAmplitude', v)} />
      </div>
    )}
    {config.layer1Enabled && (
      <div className="mt-4 border-t border-white/10 pt-4">
        <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">L1: SDF Shape</h3>
        <Toggle label="SDF Shape Mode" value={config.layer1SdfEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('layer1SdfEnabled', v)} />
        {config.layer1SdfEnabled && (
          <>
            <Toggle label="Shape" value={config.layer1SdfShape} options={[{ label: 'Sphere', val: 'sphere' }, { label: 'Ring', val: 'ring' }, { label: 'Star', val: 'star' }, { label: 'Hex', val: 'hexagon' }]} onChange={(v) => updateConfig('layer1SdfShape', v)} />
            <Slider label="Specular" value={config.layer1SdfSpecular} min={0} max={3} step={0.05} onChange={(v) => updateConfig('layer1SdfSpecular', v)} />
            <Slider label="Shininess" value={config.layer1SdfShininess} min={1} max={64} step={1} onChange={(v) => updateConfig('layer1SdfShininess', v)} />
            <Slider label="Ambient" value={config.layer1SdfAmbient} min={0} max={1} step={0.01} onChange={(v) => updateConfig('layer1SdfAmbient', v)} />
            <Slider label="Light X" value={config.layer1SdfLightX} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('layer1SdfLightX', v)} />
            <Slider label="Light Y" value={config.layer1SdfLightY} min={-1} max={1} step={0.01} onChange={(v) => updateConfig('layer1SdfLightY', v)} />
          </>
        )}
      </div>
    )}
  </div>
);
