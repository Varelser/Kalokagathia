import React from 'react';
import { Gauge, GitCommit, Minimize2, Network, Share2, Sliders } from 'lucide-react';
import { Slider, Toggle } from './controlPanelParts';
import { ProceduralModeSettings } from './controlPanelProceduralModeSettings';
import type { SharedLayerParticleSectionsProps } from './controlPanelLayerTabSharedTypes';

export const SharedLayerTabParticleSections: React.FC<SharedLayerParticleSectionsProps> = ({
  config,
  layerIndex,
  layerShortName,
  read,
  write,
  updateConfig,
  isProceduralMode,
  compactProceduralUi,
  setCompactProceduralUi,
  showLegacyDynamics,
  setShowLegacyDynamics,
}) => (
  <>
    {isProceduralMode && (
      <div className="mb-4 rounded border border-emerald-400/20 bg-emerald-400/5 p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-emerald-200/80">Procedural focus mode</div>
        <div className="text-[10px] leading-relaxed text-white/55">
          {read<string>('Type')} は専用 Structure controls を優先するモードです。従来の粒子 Dynamics / Forces / Collision は既定で折りたたみました。
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setCompactProceduralUi(true)}
            className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${compactProceduralUi ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'}`}
          >
            Compact UI
          </button>
          <button
            onClick={() => setCompactProceduralUi(false)}
            className={`rounded border px-2 py-1 text-[9px] uppercase tracking-widest transition-colors ${!compactProceduralUi ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'}`}
          >
            Full UI
          </button>
        </div>
        <button
          onClick={() => setShowLegacyDynamics((value) => !value)}
          className="mt-3 rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase tracking-widest text-white/70 transition-colors hover:bg-white/10"
        >
          {showLegacyDynamics ? 'Hide legacy particle controls' : 'Show legacy particle controls'}
        </button>
      </div>
    )}
    {(!isProceduralMode || showLegacyDynamics) && (
      <>
        <div>
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">{layerShortName}: Dynamics</h3>
          <Slider label="Speed / Velocity" value={read('FlowSpeed')} min={0} max={10.0} step={0.001} onChange={(v) => write('FlowSpeed', v)} />
          <Slider label="Amplitude / Force" value={read('FlowAmplitude')} min={0} max={10000} step={1} onChange={(v) => write('FlowAmplitude', v)} />
          <Slider label="Frequency / Density" value={read('FlowFrequency')} min={0} max={200} step={0.1} onChange={(v) => write('FlowFrequency', v)} />
          <Slider label="Complexity / Noise" value={read('Complexity')} min={0} max={50} step={0.1} onChange={(v) => write('Complexity', v)} />
        </div>
        <div className="border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Gauge size={12} /> {layerShortName}: Forces
          </h3>
          <Slider label="Gravity (Y-Axis)" value={read('Gravity')} min={-200} max={200} step={0.1} onChange={(v) => write('Gravity', v)} />
          <Slider label="Air Resistance" value={read('Resistance')} min={0} max={0.99} step={0.01} onChange={(v) => write('Resistance', v)} />
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="col-span-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Wind / Bias</div>
            <Slider label="X" value={read('WindX')} min={-200} max={200} step={1} onChange={(v) => write('WindX', v)} />
            <Slider label="Y" value={read('WindY')} min={-200} max={200} step={1} onChange={(v) => write('WindY', v)} />
            <Slider label="Z" value={read('WindZ')} min={-200} max={200} step={1} onChange={(v) => write('WindZ', v)} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <div className="col-span-3 text-[10px] uppercase tracking-widest font-medium opacity-70">Layer Spin</div>
            <Slider label="X" value={read('SpinX')} min={-5.0} max={5.0} step={0.001} onChange={(v) => write('SpinX', v)} />
            <Slider label="Y" value={read('SpinY')} min={-5.0} max={5.0} step={0.001} onChange={(v) => write('SpinY', v)} />
            <Slider label="Z" value={read('SpinZ')} min={-5.0} max={5.0} step={0.001} onChange={(v) => write('SpinZ', v)} />
          </div>
        </div>
        <div className="border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Sliders size={12} /> {layerShortName}: Simulation Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Slider label="Affect Position" value={read('AffectPos')} min={0} max={1} step={0.01} onChange={(v) => write('AffectPos', v)} />
            <Slider label="Noise Scale" value={read('NoiseScale')} min={0.1} max={50} step={0.1} onChange={(v) => write('NoiseScale', v)} />
            <Slider label="Evolution Spd" value={read('Evolution')} min={0} max={10} step={0.01} onChange={(v) => write('Evolution', v)} />
            <Slider label="Move w/ Wind" value={read('MoveWithWind')} min={0} max={10} step={0.01} onChange={(v) => write('MoveWithWind', v)} />
            <Slider label="Fluid Force" value={read('FluidForce')} min={0} max={50} step={0.1} onChange={(v) => write('FluidForce', v)} />
            <Slider label="Viscosity" value={read('Viscosity')} min={0.01} max={0.9} step={0.01} onChange={(v) => write('Viscosity', v)} />
            <Slider label="Octave Mult" value={read('OctaveMult')} min={1} max={10} step={0.1} onChange={(v) => write('OctaveMult', v)} />
            <Slider label="Fidelity (Iter)" value={read('Fidelity')} min={1} max={10} step={1} onChange={(v) => write('Fidelity', v)} />
          </div>
        </div>
        <div className="border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
            <GitCommit size={12} /> {layerShortName}: Interactions
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Slider label="Neighbor Bias (Repel <-> Cohere)" value={read('InteractionNeighbor')} min={-5} max={5} step={0.01} onChange={(v) => write('InteractionNeighbor', v)} />
            </div>
            <Slider label="Mouse Force" value={read('MouseForce')} min={-500} max={500} step={1} onChange={(v) => write('MouseForce', v)} />
            <Slider label="Mouse Radius" value={read('MouseRadius')} min={0} max={2000} step={10} onChange={(v) => write('MouseRadius', v)} />
          </div>
          <div className="mt-4 border-t border-white/5 pt-2">
            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/60 mb-2">
              <Network size={12} /> Nearby Connections / Plexus
            </div>
            <Toggle label="Draw Lines" value={read('ConnectionEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('ConnectionEnabled', v)} />
            {read('ConnectionEnabled') && (
              <div className="grid grid-cols-2 gap-4">
                <Slider label="Max Distance" value={read('ConnectionDistance')} min={10} max={1000} step={1} onChange={(v) => write('ConnectionDistance', v)} />
                <Slider label="Opacity" value={read('ConnectionOpacity')} min={0} max={1} step={0.01} onChange={(v) => write('ConnectionOpacity', v)} />
                <Slider label="Line Velocity Glow" value={read('LineVelocityGlow')} min={0} max={2} step={0.01} onChange={(v) => write('LineVelocityGlow', v)} />
                <Slider label="Line Velocity Alpha" value={read('LineVelocityAlpha')} min={0} max={2} step={0.01} onChange={(v) => write('LineVelocityAlpha', v)} />
                <Slider label="Line Burst Pulse" value={read('LineBurstPulse')} min={0} max={2} step={0.01} onChange={(v) => write('LineBurstPulse', v)} />
                <Slider label="Line Shimmer" value={read('LineShimmer')} min={0} max={1} step={0.01} onChange={(v) => write('LineShimmer', v)} />
                <Slider label="Shimmer Speed" value={read('LineFlickerSpeed')} min={0.05} max={8} step={0.01} onChange={(v) => write('LineFlickerSpeed', v)} />
                <Toggle label="Line Style" value={read('ConnectionStyle')} options={[{ label: 'Classic', val: 'classic' }, { label: 'Brush', val: 'brush' }, { label: 'Filament', val: 'filament' }]} onChange={(v) => write('ConnectionStyle', v)} />
                <Slider label="Line Width" value={read('ConnectionWidth')} min={0.1} max={4} step={0.01} onChange={(v) => write('ConnectionWidth', v)} />
                <Slider label="Edge Softness" value={read('ConnectionSoftness')} min={0} max={1} step={0.01} onChange={(v) => write('ConnectionSoftness', v)} />
              </div>
            )}
          </div>
        </div>
        <div className="border-b border-white/10 pb-4 mb-4">
          <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Minimize2 size={12} /> {layerShortName}: Physics & Collision
          </h3>
          <Toggle label="Collision Mode" value={read('CollisionMode') || 'none'} options={[{ label: 'Off', val: 'none' }, { label: 'Cell Repulsion', val: 'world' }]} onChange={(v) => write('CollisionMode', v)} />
          {read('CollisionMode') !== 'none' && (
            <>
              <Slider label="Cell Radius" value={read('CollisionRadius') || 20} min={1} max={500} step={1} onChange={(v) => write('CollisionRadius', v)} />
              <Slider label="Cell Push Force" value={read('Repulsion') || 10} min={0} max={500} step={1} onChange={(v) => write('Repulsion', v)} />
            </>
          )}
          <Toggle label="Floor Boundary" value={read('BoundaryEnabled') || false} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('BoundaryEnabled', v)} />
          {read('BoundaryEnabled') && (
            <>
              <Slider label="Floor Level Y" value={read('BoundaryY') || 300} min={-2000} max={2000} step={10} onChange={(v) => write('BoundaryY', v)} />
              <Slider label="Bounce Factor" value={read('BoundaryBounce') || 0.5} min={0} max={2.0} step={0.1} onChange={(v) => write('BoundaryBounce', v)} />
            </>
          )}
        </div>
      </>
    )}
    <div className="border-b border-white/10 pb-4 mb-4">
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4">{layerShortName}: Structure</h3>
      <ProceduralModeSettings config={config} layerIndex={layerIndex} updateConfig={updateConfig} />
      <div className="mb-4">
        <div className="mb-2 text-[10px] uppercase tracking-widest font-medium opacity-70">Particle Color</div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={read('Color')}
            onChange={(e) => write('Color', e.target.value)}
            className="w-12 h-8 rounded-md bg-transparent border border-white/20 p-0 cursor-pointer"
          />
          <span className="text-sm font-mono">{read('Color')}</span>
        </div>
      </div>
      <Slider label="Particle Count" value={read('Count')} min={1} max={2000000} step={1} onChange={(v) => write('Count', v)} />
      <Slider label="Particle Size" value={read('BaseSize')} min={0.1} max={100} step={0.1} onChange={(v) => write('BaseSize', v)} />
      <Slider label="Trail Strength" value={read('Trail')} min={0} max={0.99} step={0.01} onChange={(v) => write('Trail', v)} />
      <Slider label="Life Frames" value={read('Life')} min={4} max={240} step={1} onChange={(v) => write('Life', v)} />
      <Slider label="Life Spread" value={read('LifeSpread')} min={0} max={1} step={0.01} onChange={(v) => write('LifeSpread', v)} />
      <Slider label="Life Size Boost" value={read('LifeSizeBoost')} min={0} max={2} step={0.01} onChange={(v) => write('LifeSizeBoost', v)} />
      <Slider label="Life Size Taper" value={read('LifeSizeTaper')} min={0} max={2} step={0.01} onChange={(v) => write('LifeSizeTaper', v)} />
      <Slider label="Burst Push" value={read('Burst')} min={0} max={2} step={0.01} onChange={(v) => write('Burst', v)} />
      <Slider label="Burst Phase" value={read('BurstPhase')} min={0} max={1} step={0.01} onChange={(v) => write('BurstPhase', v)} />
      <Toggle
        label="Burst Direction"
        value={read('BurstMode')}
        options={[
          { label: 'Radial', val: 'radial' },
          { label: 'Cone', val: 'cone' },
          { label: 'Sweep', val: 'sweep' },
        ]}
        onChange={(v) => write('BurstMode', v)}
      />
      <Toggle
        label="Burst Wave"
        value={read('BurstWaveform')}
        options={[
          { label: 'Single', val: 'single' },
          { label: 'Loop', val: 'loop' },
          { label: 'Stutter', val: 'stutter' },
          { label: 'Heart', val: 'heartbeat' },
        ]}
        onChange={(v) => write('BurstWaveform', v)}
      />
      <Slider label="Sweep Speed" value={read('BurstSweepSpeed')} min={0.05} max={6} step={0.01} onChange={(v) => write('BurstSweepSpeed', v)} />
      <Slider label="Sweep Tilt" value={read('BurstSweepTilt')} min={0} max={1} step={0.01} onChange={(v) => write('BurstSweepTilt', v)} />
      <Slider label="Cone Width" value={read('BurstConeWidth')} min={0} max={1} step={0.01} onChange={(v) => write('BurstConeWidth', v)} />
      <Slider label="Emitter Orbit Spd" value={read('EmitterOrbitSpeed')} min={0} max={6} step={0.01} onChange={(v) => write('EmitterOrbitSpeed', v)} />
      <Slider label="Emitter Orbit Rad" value={read('EmitterOrbitRadius')} min={0} max={400} step={1} onChange={(v) => write('EmitterOrbitRadius', v)} />
      <Slider label="Emitter Pulse" value={read('EmitterPulseAmount')} min={0} max={1.5} step={0.01} onChange={(v) => write('EmitterPulseAmount', v)} />
      <Slider label="Trail Drag" value={read('TrailDrag')} min={0} max={1.5} step={0.01} onChange={(v) => write('TrailDrag', v)} />
      <Slider label="Trail Turbulence" value={read('TrailTurbulence')} min={0} max={1.5} step={0.01} onChange={(v) => write('TrailTurbulence', v)} />
      <Slider label="Trail Drift" value={read('TrailDrift')} min={0} max={1.5} step={0.01} onChange={(v) => write('TrailDrift', v)} />
      <Slider label="Velocity Glow" value={read('VelocityGlow')} min={0} max={2} step={0.01} onChange={(v) => write('VelocityGlow', v)} />
      <Slider label="Velocity Alpha" value={read('VelocityAlpha')} min={0} max={2} step={0.01} onChange={(v) => write('VelocityAlpha', v)} />
      <Slider label="Particle Flicker" value={read('FlickerAmount')} min={0} max={1} step={0.01} onChange={(v) => write('FlickerAmount', v)} />
      <Slider label="Flicker Speed" value={read('FlickerSpeed')} min={0.05} max={8} step={0.01} onChange={(v) => write('FlickerSpeed', v)} />
      <Slider label="Velocity Stretch" value={read('Streak')} min={0} max={2} step={0.01} onChange={(v) => write('Streak', v)} />
      <Toggle
        label="Sprite Shape"
        value={read('SpriteMode')}
        options={[
          { label: 'Soft', val: 'soft' },
          { label: 'Ring', val: 'ring' },
          { label: 'Spark', val: 'spark' },
        ]}
        onChange={(v) => write('SpriteMode', v)}
      />
      <Toggle
        label="Geometry Mode"
        value={read('GeomMode3D')}
        options={[
          { label: 'Sprite', val: 'billboard' },
          { label: 'Cube', val: 'cube' },
          { label: 'Tetra', val: 'tetra' },
          { label: 'Icosa', val: 'icosa' },
        ]}
        onChange={(v) => write('GeomMode3D', v)}
      />
      {read('GeomMode3D') !== 'billboard' && (
        <Slider label="Geom Scale" value={read('GeomScale3D')} min={0.1} max={8} step={0.05} onChange={(v) => write('GeomScale3D', v)} />
      )}
    </div>
    <div className="pt-2">
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Share2 size={12} /> Aux Emitter System
      </h3>
      <Toggle label="Emit from Parents" value={read('AuxEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('AuxEnabled', v)} />
      {read('AuxEnabled') && (
        <>
          <Slider label="Emitted Particles" value={read('AuxCount')} min={100} max={1000000} step={100} onChange={(v) => write('AuxCount', v)} />
          <Slider label="Life / Trail Length" value={read('AuxLife')} min={1} max={500} step={1} onChange={(v) => write('AuxLife', v)} />
          <Slider label="Diffusion / Spread" value={read('AuxDiffusion')} min={0} max={200} step={0.1} onChange={(v) => write('AuxDiffusion', v)} />
        </>
      )}
    </div>
    <div className="pt-4">
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Share2 size={12} /> Burst Sparks
      </h3>
      <Toggle label="Emit Spark Bursts" value={read('SparkEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('SparkEnabled', v)} />
      {read('SparkEnabled') && (
        <>
          <Slider label="Spark Count" value={read('SparkCount')} min={100} max={300000} step={100} onChange={(v) => write('SparkCount', v)} />
          <Slider label="Spark Life" value={read('SparkLife')} min={4} max={120} step={1} onChange={(v) => write('SparkLife', v)} />
          <Slider label="Spark Diffusion" value={read('SparkDiffusion')} min={0} max={20} step={0.1} onChange={(v) => write('SparkDiffusion', v)} />
          <Slider label="Spark Burst Boost" value={read('SparkBurst')} min={0} max={2} step={0.01} onChange={(v) => write('SparkBurst', v)} />
        </>
      )}
    </div>
    <div className="pt-4 border-t border-white/10">
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">{layerShortName}: Ghost Trail</h3>
      <Toggle label="Ghost Trail" value={read('GhostTrailEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('GhostTrailEnabled', v)} />
      {read('GhostTrailEnabled') && (
        <>
          <Slider label="Ghost Count" value={read('GhostTrailCount')} min={1} max={8} step={1} onChange={(v) => write('GhostTrailCount', Math.round(v))} />
          <Slider label="Time Step (s)" value={read('GhostTrailDt')} min={0.01} max={0.5} step={0.01} onChange={(v) => write('GhostTrailDt', v)} />
          <Slider label="Fade" value={read('GhostTrailFade')} min={0.1} max={0.95} step={0.01} onChange={(v) => write('GhostTrailFade', v)} />
        </>
      )}
    </div>
    <div className="pt-4 border-t border-white/10">
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">{layerShortName}: SDF Shape</h3>
      <Toggle label="SDF Shape Mode" value={read('SdfEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write('SdfEnabled', v)} />
      {read('SdfEnabled') && (
        <>
          <Toggle label="Shape" value={read('SdfShape')} options={[{ label: 'Sphere', val: 'sphere' }, { label: 'Ring', val: 'ring' }, { label: 'Star', val: 'star' }, { label: 'Hex', val: 'hexagon' }]} onChange={(v) => write('SdfShape', v)} />
          <Slider label="Specular" value={read('SdfSpecular')} min={0} max={3} step={0.05} onChange={(v) => write('SdfSpecular', v)} />
          <Slider label="Shininess" value={read('SdfShininess')} min={1} max={64} step={1} onChange={(v) => write('SdfShininess', v)} />
          <Slider label="Ambient" value={read('SdfAmbient')} min={0} max={1} step={0.01} onChange={(v) => write('SdfAmbient', v)} />
          <Slider label="Light X" value={read('SdfLightX')} min={-1} max={1} step={0.01} onChange={(v) => write('SdfLightX', v)} />
          <Slider label="Light Y" value={read('SdfLightY')} min={-1} max={1} step={0.01} onChange={(v) => write('SdfLightY', v)} />
        </>
      )}
    </div>
  </>
);
