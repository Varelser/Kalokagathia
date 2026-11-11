import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const GlobalDisplayGpgpuAdvancedRenderSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* Instanced Geometry */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle
        label="Geometry Mode"
        value={config.gpgpuGeomMode}
        options={[{ label: 'Point', val: 'point' }, { label: 'Cube', val: 'cube' }, { label: 'Tetra', val: 'tetra' }, { label: 'Octa', val: 'octa' }, { label: 'Icosa', val: 'icosa' }]}
        onChange={(v) => updateConfig('gpgpuGeomMode', v)}
      />
      {config.gpgpuGeomMode !== 'point' && (
        <>
          <Slider label="Geom Scale" value={config.gpgpuGeomScale} min={0.1} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuGeomScale', v)} />
          <Toggle label="Velocity Align" value={config.gpgpuGeomVelocityAlign} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGeomVelocityAlign', v)} />
        </>
      )}
    </div>

    {/* Metaballs (Marching Cubes isosurface) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Metaballs (MC Surface)" value={config.gpgpuMetaballEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMetaballEnabled', v)} />
      {config.gpgpuMetaballEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Marching Cubes isosurface — nearby particles merge into a smooth blob mesh.
          </div>
          <Slider label="Resolution" value={config.gpgpuMetaballResolution} min={16} max={48} step={2} onChange={(v) => updateConfig('gpgpuMetaballResolution', Math.round(v))} />
          <Slider label="Blob Strength" value={config.gpgpuMetaballStrength} min={0.1} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuMetaballStrength', v)} />
          <Slider label="Iso Level" value={config.gpgpuMetaballIsoLevel} min={10} max={200} step={5} onChange={(v) => updateConfig('gpgpuMetaballIsoLevel', v)} />
          <Slider label="Decay (Subtract)" value={config.gpgpuMetaballSubtract} min={0} max={100} step={1} onChange={(v) => updateConfig('gpgpuMetaballSubtract', v)} />
          <Slider label="Opacity" value={config.gpgpuMetaballOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballOpacity', v)} />
          <Slider label="Metalness" value={config.gpgpuMetaballMetalness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballMetalness', v)} />
          <Slider label="Roughness" value={config.gpgpuMetaballRoughness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballRoughness', v)} />
          <Slider label="Update Skip (Frames)" value={config.gpgpuMetaballUpdateSkip} min={1} max={10} step={1} onChange={(v) => updateConfig('gpgpuMetaballUpdateSkip', Math.round(v))} />
          <Slider label="Particle Limit" value={config.gpgpuMetaballParticleLimit} min={64} max={4096} step={64} onChange={(v) => updateConfig('gpgpuMetaballParticleLimit', v)} />
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[10px] text-white/60 uppercase tracking-wider">Color</label>
            <input
              type="color"
              value={config.gpgpuMetaballColor}
              onChange={(e) => updateConfig('gpgpuMetaballColor', e.target.value)}
              className="w-8 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
            />
          </div>
          <div className="mt-2">
            <Toggle label="Wireframe" value={config.gpgpuMetaballWireframe} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMetaballWireframe', v)} />
          </div>
        </>
      )}
    </div>

    {/* Volumetric Ray Marching */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Volumetric (Ray March)" value={config.gpgpuVolumetricEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVolumetricEnabled', v)} />
      {config.gpgpuVolumetricEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Ray-marched sphere sprites — each particle rendered as a volumetric density cloud.
          </div>
          <Slider label="Radius" value={config.gpgpuVolumetricRadius} min={1} max={60} step={0.5} onChange={(v) => updateConfig('gpgpuVolumetricRadius', v)} />
          <Slider label="Density" value={config.gpgpuVolumetricDensity} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVolumetricDensity', v)} />
          <Slider label="Opacity" value={config.gpgpuVolumetricOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuVolumetricOpacity', v)} />
          <Slider label="Steps (quality)" value={config.gpgpuVolumetricSteps} min={4} max={32} step={2} onChange={(v) => updateConfig('gpgpuVolumetricSteps', Math.round(v))} />
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[10px] text-white/60 uppercase tracking-wider">Color</label>
            <input
              type="color"
              value={config.gpgpuVolumetricColor}
              onChange={(e) => updateConfig('gpgpuVolumetricColor', e.target.value)}
              className="w-8 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
            />
          </div>
        </>
      )}
    </div>
  </>
);
