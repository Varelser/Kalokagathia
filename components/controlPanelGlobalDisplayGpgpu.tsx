import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuAdvancedRenderSection } from './controlPanelGlobalDisplayGpgpuAdvancedRender';
import { GlobalDisplayGpgpuForcesSection } from './controlPanelGlobalDisplayGpgpuForces';
import { GlobalDisplayGpgpuTrailsSection } from './controlPanelGlobalDisplayGpgpuTrails';
import { Slider, Toggle } from './controlPanelParts';

export const GlobalDisplayGpgpuSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
      <div className="mb-3 text-[10px] uppercase tracking-widest font-bold text-white/70">GPGPU Layer (GPU Particles)</div>
      <Toggle
        label="GPGPU Enabled"
        value={config.gpgpuEnabled}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => updateConfig('gpgpuEnabled', v)}
      />
      {config.gpgpuEnabled && (
        <>
          <Toggle
            label="Compute Backend"
            value={config.gpgpuExecutionPreference}
            options={[
              { label: 'Auto', val: 'auto' },
              { label: 'WebGL', val: 'webgl' },
              { label: 'WebGPU', val: 'webgpu' },
            ]}
            onChange={(v) => updateConfig('gpgpuExecutionPreference', v)}
          />
          <div className="mt-2 text-[10px] leading-relaxed text-white/55">WebGPU を要求しても、未対応の GPGPU 機能が有効な場合は自動で WebGL にフォールバックします。Diagnostics を有効にすると unsupported features を確認できます。</div>
          <div className="mt-4 border-t border-white/10 pt-4">
            <Toggle
              label="Execution Diagnostics"
              value={config.executionDiagnosticsEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('executionDiagnosticsEnabled', v)}
            />
            {config.executionDiagnosticsEnabled && (
              <Toggle
                label="Verbose Diagnostics"
                value={config.executionDiagnosticsVerbose}
                options={[{ label: 'Verbose', val: true }, { label: 'Compact', val: false }]}
                onChange={(v) => updateConfig('executionDiagnosticsVerbose', v)}
              />
            )}
            <Toggle
              label="Hybrid SDF Surface"
              value={config.hybridSdfEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridSdfEnabled', v)}
            />
            <Toggle
              label="Hybrid Patch Surface"
              value={config.hybridPatchEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridPatchEnabled', v)}
            />
            <Toggle
              label="Hybrid Fiber Field"
              value={config.hybridFiberEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridFiberEnabled', v)}
            />
            <Toggle
              label="Hybrid Granular Field"
              value={config.hybridGranularEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridGranularEnabled', v)}
            />
            <Toggle
              label="Hybrid Membrane Surface"
              value={config.hybridMembraneEnabled}
              options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
              onChange={(v) => updateConfig('hybridMembraneEnabled', v)}
            />
          </div>
          <Slider label="Particle Count" value={config.gpgpuCount} min={1024} max={1048576} step={1024} onChange={(v) => updateConfig('gpgpuCount', v)} />
          <Toggle
            label="Emit Shape"
            value={config.gpgpuEmitShape}
            options={[
              { label: 'Sphere', val: 'sphere' }, { label: 'Shell', val: 'shell' },
              { label: 'Disc', val: 'disc' },   { label: 'Ring', val: 'ring' },
              { label: 'Box', val: 'box' },     { label: 'Cone', val: 'cone' },
            ]}
            onChange={(v) => updateConfig('gpgpuEmitShape', v)}
          />
          <Slider label="Gravity" value={config.gpgpuGravity} min={0} max={2} step={0.01} onChange={(v) => updateConfig('gpgpuGravity', v)} />
          <Slider label="Turbulence" value={config.gpgpuTurbulence} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuTurbulence', v)} />
          <Slider label="Bounce" value={config.gpgpuBounce} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuBounce', v)} />
          <Slider label="Boundary Radius" value={config.gpgpuBounceRadius} min={10} max={500} step={5} onChange={(v) => updateConfig('gpgpuBounceRadius', v)} />
          <Slider label="Seed" value={config.gpgpuSeed} min={0} max={999} step={1} onChange={(v) => updateConfig('gpgpuSeed', v)} />
          <Slider label="Particle Size" value={config.gpgpuSize} min={0.5} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuSize', v)} />
          <Slider label="Speed" value={config.gpgpuSpeed} min={0.1} max={5} step={0.1} onChange={(v) => updateConfig('gpgpuSpeed', v)} />
          <Slider label="Opacity" value={config.gpgpuOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuOpacity', v)} />
          <div className="mb-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">GPGPU Color</div>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={config.gpgpuColor}
                onChange={(e) => updateConfig('gpgpuColor', e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-white/20 bg-transparent p-0.5"
              />
              <span className="font-mono text-[10px] opacity-60">{config.gpgpuColor.toUpperCase()}</span>
              <button onClick={() => updateConfig('gpgpuColor', '#88aaff')} className="ml-auto rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase hover:bg-white/10">Reset</button>
            </div>
          </div>
          <Toggle
            label="Audio Reactive"
            value={config.gpgpuAudioReactive}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(v) => updateConfig('gpgpuAudioReactive', v)}
          />
          {config.gpgpuAudioReactive && (
            <Slider label="Audio Blast" value={config.gpgpuAudioBlast} min={0} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuAudioBlast', v)} />
          )}

          <GlobalDisplayGpgpuTrailsSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuAdvancedRenderSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuForcesSection config={config} updateConfig={updateConfig} />
        </>
      )}
    </div>
  </>
);
