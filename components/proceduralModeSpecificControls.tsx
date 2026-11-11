import React from 'react';
import { Sparkles } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { Slider, Toggle } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelTabsShared';
import type { ProceduralMode } from './proceduralModeSettingsCatalog';

type ProceduralModeSpecificControlsProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  updateConfig: UpdateConfig;
  mode: ProceduralMode;
};

export const ProceduralModeSpecificControls: React.FC<ProceduralModeSpecificControlsProps> = ({
  config,
  layerIndex,
  updateConfig,
  mode,
}) => {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const key = (suffix: string) => `${prefix}${suffix}` as keyof ParticleConfig;
  const numberValue = (suffix: string) => config[key(suffix)] as number;
  const boolValue = (suffix: string) => config[key(suffix)] as boolean;
  const setNumber = (suffix: string, value: number) => updateConfig(key(suffix), value as never);
  const setBoolean = (suffix: string, value: boolean) => updateConfig(key(suffix), value as never);
  const stringValue = (suffix: string) => config[key(suffix)] as string;
  const setString = (suffix: string, value: string) => updateConfig(key(suffix), value as never);

  return (
    <>
<div className="mt-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/60">
    <Sparkles size={12} /> Temporal profile
  </div>
  <div className="mb-3 text-[10px] leading-relaxed text-white/50">
    時間変化の傾向をレイヤー全体へ付与します。steady は静的、growth は増殖、decay は減衰、crystallize は段階的硬化、melt は軟化、rupture は破断、oscillate は揺動、accrete は堆積、evaporate は蒸散、shed は剥離、resonate は共鳴、condense は凝縮、ignite は発火、unravel はほどけ、accumulate は蓄積循環、exfoliate は剥離循環、phase shift は相転移、inhale は呼吸、rewrite は再記述、saturate は飽和、delaminate は層剥離、anneal は焼きなまし、bifurcate は分岐、recur は再帰循環、percolate は浸透、slump は崩れ沈み、rebound は反発復元、fissure は亀裂化、ossify は硬化固定、intermittent は断続、hysteresis は履歴遅れ、fatigue は疲労、recover は回復、erupt は噴出、latency は潜伏、emerge は出現、collapse は崩壊、regrow は再成長、invert は反転です。
  </div>
  <Toggle
    label="Profile"
    value={config[key('TemporalProfile')] as string}
    options={[
      { label: 'Steady', val: 'steady' },
      { label: 'Growth', val: 'growth' },
      { label: 'Decay', val: 'decay' },
      { label: 'Crystallize', val: 'crystallize' },
      { label: 'Melt', val: 'melt' },
      { label: 'Rupture', val: 'rupture' },
      { label: 'Oscillate', val: 'oscillate' },
      { label: 'Accrete', val: 'accrete' },
      { label: 'Evaporate', val: 'evaporate' },
      { label: 'Shed', val: 'shed' },
      { label: 'Resonate', val: 'resonate' },
      { label: 'Condense', val: 'condense' },
      { label: 'Ignite', val: 'ignite' },
      { label: 'Unravel', val: 'unravel' },
      { label: 'Accumulate', val: 'accumulate' },
      { label: 'Exfoliate', val: 'exfoliate' },
      { label: 'Phase Shift', val: 'phase_shift' },
      { label: 'Inhale', val: 'inhale' },
      { label: 'Rewrite', val: 'rewrite' },
      { label: 'Saturate', val: 'saturate' },
      { label: 'Delaminate', val: 'delaminate' },
      { label: 'Anneal', val: 'anneal' },
      { label: 'Bifurcate', val: 'bifurcate' },
      { label: 'Recur', val: 'recur' },
      { label: 'Percolate', val: 'percolate' },
      { label: 'Slump', val: 'slump' },
      { label: 'Rebound', val: 'rebound' },
      { label: 'Fissure', val: 'fissure' },
      { label: 'Ossify', val: 'ossify' },
      { label: 'Intermittent', val: 'intermittent' },
      { label: 'Hysteresis', val: 'hysteresis' },
      { label: 'Fatigue', val: 'fatigue' },
      { label: 'Recover', val: 'recover' },
      { label: 'Erupt', val: 'erupt' },
      { label: 'Latency', val: 'latency' },
      { label: 'Emerge', val: 'emerge' },
      { label: 'Collapse', val: 'collapse' },
      { label: 'Regrow', val: 'regrow' },
      { label: 'Invert', val: 'invert' },
    ]}
    onChange={(value) => updateConfig(key('TemporalProfile'), value as never)}
  />
  <div className="mt-3 grid grid-cols-2 gap-4">
    <Slider label="Temporal Strength" value={numberValue('TemporalStrength')} min={0} max={1} step={0.01} onChange={(value) => setNumber('TemporalStrength', value)} />
    <Slider label="Temporal Speed" value={numberValue('TemporalSpeed')} min={0.1} max={3} step={0.01} onChange={(value) => setNumber('TemporalSpeed', value)} />
  </div>
</div>
{(mode === 'sheet' || mode === 'cloth_membrane' || mode === 'elastic_sheet' || mode === 'viscoelastic_membrane') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Surface Opacity" value={numberValue('SheetOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('SheetOpacity', value)} />
    <Slider label="Fresnel Glow" value={numberValue('SheetFresnel')} min={0} max={1} step={0.01} onChange={(value) => setNumber('SheetFresnel', value)} />
    <Slider label="Audio Ripple" value={numberValue('SheetAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('SheetAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('SheetWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('SheetWireframe', value)} />
  </div>
)}

{(mode === 'surface_shell' || mode === 'freeze_skin') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Shell Opacity" value={numberValue('HullOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('HullOpacity', value)} />
    <Slider label="Point Budget" value={numberValue('HullPointBudget')} min={128} max={8192} step={64} onChange={(value) => setNumber('HullPointBudget', value)} />
    <Slider label="Jitter" value={numberValue('HullJitter')} min={0} max={1} step={0.01} onChange={(value) => setNumber('HullJitter', value)} />
    <Slider label="Fresnel" value={numberValue('HullFresnel')} min={0} max={1} step={0.01} onChange={(value) => setNumber('HullFresnel', value)} />
    <Slider label="Audio Reactive" value={numberValue('HullAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('HullAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('HullWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('HullWireframe', value)} />
  </div>
)}

{mode === 'surface_patch' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Patch Opacity" value={numberValue('PatchOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('PatchOpacity', value)} />
    <Slider label="Resolution" value={numberValue('PatchResolution')} min={8} max={144} step={1} onChange={(value) => setNumber('PatchResolution', value)} />
    <Slider label="Relax" value={numberValue('PatchRelax')} min={0} max={1} step={0.01} onChange={(value) => setNumber('PatchRelax', value)} />
    <Slider label="Fresnel" value={numberValue('PatchFresnel')} min={0} max={1} step={0.01} onChange={(value) => setNumber('PatchFresnel', value)} />
    <Slider label="Audio Reactive" value={numberValue('PatchAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('PatchAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('PatchWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('PatchWireframe', value)} />
  </div>
)}

{(mode === 'brush_surface' || mode === 'viscous_flow' || mode === 'advection_flow' || mode === 'melt_front' || mode === 'evaporative_sheet') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('BrushOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('BrushOpacity', value)} />
    <Slider label="Layers" value={numberValue('BrushLayers')} min={1} max={16} step={1} onChange={(value) => setNumber('BrushLayers', value)} />
    <Slider label="Scale" value={numberValue('BrushScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('BrushScale', value)} />
    <Slider label="Jitter" value={numberValue('BrushJitter')} min={0} max={1} step={0.01} onChange={(value) => setNumber('BrushJitter', value)} />
    <Slider label="Audio Reactive" value={numberValue('BrushAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('BrushAudioReactive', value)} />
  </div>
)}

{mode === 'fiber_field' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('FiberOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('FiberOpacity', value)} />
    <Slider label="Length" value={numberValue('FiberLength')} min={0.05} max={2} step={0.01} onChange={(value) => setNumber('FiberLength', value)} />
    <Slider label="Density" value={numberValue('FiberDensity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('FiberDensity', value)} />
    <Slider label="Curl" value={numberValue('FiberCurl')} min={0} max={1} step={0.01} onChange={(value) => setNumber('FiberCurl', value)} />
    <Slider label="Audio Reactive" value={numberValue('FiberAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('FiberAudioReactive', value)} />
  </div>
)}

{(mode === 'growth_field' || mode === 'fracture_grammar' || mode === 'growth_grammar') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('GrowthOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('GrowthOpacity', value)} />
    <Slider label="Branches" value={numberValue('GrowthBranches')} min={1} max={16} step={1} onChange={(value) => setNumber('GrowthBranches', value)} />
    <Slider label="Length" value={numberValue('GrowthLength')} min={0.05} max={2} step={0.01} onChange={(value) => setNumber('GrowthLength', value)} />
    <Slider label="Spread" value={numberValue('GrowthSpread')} min={0} max={1} step={0.01} onChange={(value) => setNumber('GrowthSpread', value)} />
    <Slider label="Audio Reactive" value={numberValue('GrowthAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('GrowthAudioReactive', value)} />
  </div>
)}

{mode === 'deposition_field' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('DepositionOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('DepositionOpacity', value)} />
    <Slider label="Relief" value={numberValue('DepositionRelief')} min={0} max={1} step={0.01} onChange={(value) => setNumber('DepositionRelief', value)} />
    <Slider label="Erosion" value={numberValue('DepositionErosion')} min={0} max={1} step={0.01} onChange={(value) => setNumber('DepositionErosion', value)} />
    <Slider label="Bands" value={numberValue('DepositionBands')} min={1} max={12} step={1} onChange={(value) => setNumber('DepositionBands', value)} />
    <Slider label="Audio Reactive" value={numberValue('DepositionAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('DepositionAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('DepositionWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('DepositionWireframe', value)} />
  </div>
)}

{(mode === 'crystal_aggregate' || mode === 'granular_fall' || mode === 'sediment_stack' || mode === 'talus_heap' || mode === 'avalanche_field' || mode === 'jammed_pack') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('CrystalOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('CrystalOpacity', value)} />
    <Slider label="Scale" value={numberValue('CrystalScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('CrystalScale', value)} />
    <Slider label="Density" value={numberValue('CrystalDensity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('CrystalDensity', value)} />
    <Slider label="Spread" value={numberValue('CrystalSpread')} min={0} max={1} step={0.01} onChange={(value) => setNumber('CrystalSpread', value)} />
    <Slider label="Audio Reactive" value={numberValue('CrystalAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('CrystalAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('CrystalWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('CrystalWireframe', value)} />
  </div>
)}

{mode === 'erosion_trail' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('ErosionTrailOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('ErosionTrailOpacity', value)} />
    <Slider label="Density" value={numberValue('ErosionTrailDensity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('ErosionTrailDensity', value)} />
    <Slider label="Length" value={numberValue('ErosionTrailLength')} min={0.05} max={2} step={0.01} onChange={(value) => setNumber('ErosionTrailLength', value)} />
    <Slider label="Drift" value={numberValue('ErosionTrailDrift')} min={0} max={1} step={0.01} onChange={(value) => setNumber('ErosionTrailDrift', value)} />
    <Slider label="Audio Reactive" value={numberValue('ErosionTrailAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('ErosionTrailAudioReactive', value)} />
  </div>
)}

{mode === 'voxel_lattice' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('VoxelOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('VoxelOpacity', value)} />
    <Slider label="Scale" value={numberValue('VoxelScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('VoxelScale', value)} />
    <Slider label="Density" value={numberValue('VoxelDensity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('VoxelDensity', value)} />
    <Slider label="Snap" value={numberValue('VoxelSnap')} min={0} max={1} step={0.01} onChange={(value) => setNumber('VoxelSnap', value)} />
    <Slider label="Audio Reactive" value={numberValue('VoxelAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('VoxelAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('VoxelWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('VoxelWireframe', value)} />
  </div>
)}

{mode === 'crystal_deposition' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('CrystalDepositionOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('CrystalDepositionOpacity', value)} />
    <Slider label="Crystal Scale" value={numberValue('CrystalDepositionCrystalScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('CrystalDepositionCrystalScale', value)} />
    <Slider label="Density" value={numberValue('CrystalDepositionDensity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('CrystalDepositionDensity', value)} />
    <Slider label="Relief" value={numberValue('CrystalDepositionRelief')} min={0} max={1} step={0.01} onChange={(value) => setNumber('CrystalDepositionRelief', value)} />
    <Slider label="Audio Reactive" value={numberValue('CrystalDepositionAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('CrystalDepositionAudioReactive', value)} />
    <Toggle label="Wireframe" value={boolValue('CrystalDepositionWireframe')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('CrystalDepositionWireframe', value)} />
  </div>
)}

{mode === 'physarum' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('PhysarumOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('PhysarumOpacity', value)} />
    <Slider label="Sensor Angle" value={numberValue('PhysarumSensorAngle')} min={0.1} max={1.4} step={0.01} onChange={(value) => setNumber('PhysarumSensorAngle', value)} />
    <Slider label="Sensor Distance" value={numberValue('PhysarumSensorDistance')} min={1} max={24} step={0.5} onChange={(value) => setNumber('PhysarumSensorDistance', value)} />
    <Slider label="Turn Speed" value={numberValue('PhysarumTurnSpeed')} min={0.05} max={2} step={0.05} onChange={(value) => setNumber('PhysarumTurnSpeed', value)} />
    <Slider label="Move Speed" value={numberValue('PhysarumSpeed')} min={0.2} max={4} step={0.1} onChange={(value) => setNumber('PhysarumSpeed', value)} />
    <Slider label="Deposit" value={numberValue('PhysarumDeposit')} min={0.05} max={1.5} step={0.05} onChange={(value) => setNumber('PhysarumDeposit', value)} />
    <Slider label="Trail Decay" value={numberValue('PhysarumDecay')} min={0.5} max={0.995} step={0.005} onChange={(value) => setNumber('PhysarumDecay', value)} />
    <Toggle label="Display" value={stringValue('PhysarumDisplay')} options={[{ label: 'Sheet', val: 'sheet' }, { label: 'Sphere', val: 'sphere' }]} onChange={(value) => setString('PhysarumDisplay', value)} />
  </div>
)}

{mode === 'dla' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Walkers" value={numberValue('DlaWalkers')} min={1024} max={16384} step={256} onChange={(value) => setNumber('DlaWalkers', value)} />
    <Slider label="Steps / Frame" value={numberValue('DlaSteps')} min={1} max={40} step={1} onChange={(value) => setNumber('DlaSteps', value)} />
    <Slider label="Stickiness" value={numberValue('DlaStickiness')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('DlaStickiness', value)} />
    <Slider label="Thickness" value={numberValue('DlaThickness')} min={1} max={4} step={0.25} onChange={(value) => setNumber('DlaThickness', value)} />
    <Slider label="Thickness Decay" value={numberValue('DlaThicknessDecay')} min={0} max={1} step={0.01} onChange={(value) => setNumber('DlaThicknessDecay', value)} />
    <Slider label="Opacity" value={numberValue('DlaOpacity')} min={0} max={1} step={0.01} onChange={(value) => setNumber('DlaOpacity', value)} />
    <Toggle label="Seed Shape" value={stringValue('DlaSeedShape')} options={[{ label: 'Point', val: 'point' }, { label: 'Line', val: 'line' }, { label: 'Ring', val: 'ring' }, { label: 'Multi', val: 'multi' }]} onChange={(value) => setString('DlaSeedShape', value)} />
    <div className="flex items-end">
      <button type="button" className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-white/80 hover:bg-white/10" onClick={() => setNumber('DlaSeed', numberValue('DlaSeed') + 1)}>Regrow（再成長）</button>
    </div>
  </div>
)}

{mode === 'raymarch' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <div className="col-span-2 rounded border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
      注意：レイマーチングSDFは重い処理です。描画スケールとステップ数を上げるとフレームレートが大きく下がります。
    </div>
    <Toggle label="Shape（形状）" value={stringValue('RaymarchShape')} options={[{ label: 'Mandelbulb', val: 'mandelbulb' }, { label: 'Blobs', val: 'blobs' }, { label: 'Columns', val: 'columns' }]} onChange={(value) => setString('RaymarchShape', value)} />
    <Slider label="Render Scale（解像度）" value={numberValue('RaymarchScale')} min={0.25} max={1} step={0.01} onChange={(value) => setNumber('RaymarchScale', value)} />
    <Slider label="Steps（ステップ数）" value={numberValue('RaymarchSteps')} min={16} max={128} step={1} onChange={(value) => setNumber('RaymarchSteps', value)} />
    <Slider label="Power（Mandelbulb冪）" value={numberValue('RaymarchPower')} min={2} max={16} step={0.1} onChange={(value) => setNumber('RaymarchPower', value)} />
    <Slider label="Rotation（回転）" value={numberValue('RaymarchRotation')} min={0} max={1} step={0.01} onChange={(value) => setNumber('RaymarchRotation', value)} />
    <Slider label="Distance（距離）" value={numberValue('RaymarchDistance')} min={0.5} max={2} step={0.01} onChange={(value) => setNumber('RaymarchDistance', value)} />
    <Slider label="Opacity" value={numberValue('RaymarchOpacity')} min={0} max={1} step={0.01} onChange={(value) => setNumber('RaymarchOpacity', value)} />
  </div>
)}

{mode === 'l-system' && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Toggle label="Preset" value={stringValue('LsysPreset')} options={[{ label: 'Plant', val: 'plant' }, { label: 'Fern', val: 'fern' }, { label: 'Tree', val: 'tree' }, { label: 'Coral', val: 'coral' }, { label: 'Lightning', val: 'lightning' }]} onChange={(value) => setString('LsysPreset', value)} />
    <Slider label="Depth（再帰）" value={numberValue('LsysDepth')} min={1} max={8} step={1} onChange={(value) => setNumber('LsysDepth', value)} />
    <Slider label="Angle（分岐角）" value={numberValue('LsysAngle')} min={5} max={60} step={0.5} onChange={(value) => setNumber('LsysAngle', value)} />
    <Slider label="Length Decay" value={numberValue('LsysLengthDecay')} min={0.5} max={0.95} step={0.01} onChange={(value) => setNumber('LsysLengthDecay', value)} />
    <Slider label="Seed" value={numberValue('LsysSeed')} min={1} max={64} step={1} onChange={(value) => setNumber('LsysSeed', value)} />
    <Slider label="Curvature（湾曲）" value={numberValue('LsysCurvature')} min={-15} max={15} step={0.5} onChange={(value) => setNumber('LsysCurvature', value)} />
    <Slider label="Wind（風揺れ）" value={numberValue('LsysWind')} min={0} max={1} step={0.01} onChange={(value) => setNumber('LsysWind', value)} />
    <Slider label="Opacity" value={numberValue('LsysOpacity')} min={0} max={1} step={0.01} onChange={(value) => setNumber('LsysOpacity', value)} />
  </div>
)}

{(mode === 'reaction_diffusion' || mode === 'cellular_front' || mode === 'corrosion_front' || mode === 'biofilm_skin') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('ReactionOpacity')} min={0.05} max={1} step={0.01} onChange={(value) => setNumber('ReactionOpacity', value)} />
    <Slider label="Feed" value={numberValue('ReactionFeed')} min={0.001} max={0.09} step={0.001} onChange={(value) => setNumber('ReactionFeed', value)} />
    <Slider label="Kill" value={numberValue('ReactionKill')} min={0.001} max={0.09} step={0.001} onChange={(value) => setNumber('ReactionKill', value)} />
    <Slider label="Scale" value={numberValue('ReactionScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('ReactionScale', value)} />
    <Slider label="Warp" value={numberValue('ReactionWarp')} min={0} max={1} step={0.01} onChange={(value) => setNumber('ReactionWarp', value)} />
    <Slider label="Audio Reactive" value={numberValue('ReactionAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('ReactionAudioReactive', value)} />
    <Toggle label="Model" value={stringValue('ReactionModel')} options={[{ label: 'Gray-Scott', val: 'gray-scott' }, { label: 'FitzHugh-Nagumo', val: 'fhn' }, { label: 'Lenia', val: 'lenia' }]} onChange={(value) => setString('ReactionModel', value)} />
    <Slider label="FHN Epsilon" value={numberValue('ReactionFhnEpsilon')} min={0.01} max={0.3} step={0.005} onChange={(value) => setNumber('ReactionFhnEpsilon', value)} />
    <Slider label="FHN a" value={numberValue('ReactionFhnA')} min={0} max={1.5} step={0.01} onChange={(value) => setNumber('ReactionFhnA', value)} />
    <Slider label="FHN b" value={numberValue('ReactionFhnB')} min={0} max={1.5} step={0.01} onChange={(value) => setNumber('ReactionFhnB', value)} />
    <Slider label="FHN Display Gain" value={numberValue('ReactionFhnGain')} min={0.2} max={4} step={0.05} onChange={(value) => setNumber('ReactionFhnGain', value)} />
    {stringValue('ReactionModel') === 'lenia' && (<>
    <Toggle label="Lenia Kernel（カーネル）" value={stringValue('ReactionLeniaKernel')} options={[{ label: 'Ring', val: 'ring' }, { label: 'Double', val: 'double' }, { label: 'Blob', val: 'blob' }]} onChange={(value) => setString('ReactionLeniaKernel', value)} />
    <Slider label="Lenia Mu（μ）" value={numberValue('ReactionLeniaMu')} min={0.05} max={0.5} step={0.005} onChange={(value) => setNumber('ReactionLeniaMu', value)} />
    <Slider label="Lenia Sigma（σ）" value={numberValue('ReactionLeniaSigma')} min={0.002} max={0.08} step={0.001} onChange={(value) => setNumber('ReactionLeniaSigma', value)} />
    <Slider label="Lenia Radius" value={numberValue('ReactionLeniaRadius')} min={5} max={15} step={1} onChange={(value) => setNumber('ReactionLeniaRadius', value)} />
    <Slider label="Lenia Dt" value={numberValue('ReactionLeniaDt')} min={0.02} max={0.3} step={0.005} onChange={(value) => setNumber('ReactionLeniaDt', value)} />
    <Slider label="Lenia Display Gain" value={numberValue('ReactionLeniaGain')} min={0.2} max={4} step={0.05} onChange={(value) => setNumber('ReactionLeniaGain', value)} />
    </>)}
  </div>
)}

{(mode === 'volume_fog' || mode === 'vortex_transport' || mode === 'pressure_cells' || mode === 'condense_field' || mode === 'sublimate_cloud') && (
  <div className="grid grid-cols-2 gap-4 mt-3">
    <Slider label="Opacity" value={numberValue('FogOpacity')} min={0.01} max={1} step={0.01} onChange={(value) => setNumber('FogOpacity', value)} />
    <Slider label="Density" value={numberValue('FogDensity')} min={0.01} max={1} step={0.01} onChange={(value) => setNumber('FogDensity', value)} />
    <Slider label="Depth" value={numberValue('FogDepth')} min={0.01} max={1.5} step={0.01} onChange={(value) => setNumber('FogDepth', value)} />
    <Slider label="Scale" value={numberValue('FogScale')} min={0.1} max={4} step={0.01} onChange={(value) => setNumber('FogScale', value)} />
    <Slider label="Drift" value={numberValue('FogDrift')} min={0} max={1} step={0.01} onChange={(value) => setNumber('FogDrift', value)} />
    <Slider label="Slices" value={numberValue('FogSlices')} min={4} max={48} step={1} onChange={(value) => setNumber('FogSlices', value)} />
    <Slider label="Glow" value={numberValue('FogGlow')} min={0} max={1} step={0.01} onChange={(value) => setNumber('FogGlow', value)} />
    <Slider label="Anisotropy" value={numberValue('FogAnisotropy')} min={0} max={1} step={0.01} onChange={(value) => setNumber('FogAnisotropy', value)} />
    <Slider label="Audio Reactive" value={numberValue('FogAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('FogAudioReactive', value)} />
  </div>
)}

{(layerIndex === 2 ? config.layer2Source : config.layer3Source) === 'text' && (
  <div className="mt-4 border-t border-white/5 pt-3">
    <div className="mb-2 flex items-center gap-2 text-[10px] uppercase font-bold text-white/60">
      <Sparkles size={12} /> Glyph Outline
    </div>
    <div className="grid grid-cols-2 gap-4">
      <Toggle label="Outline" value={boolValue('GlyphOutlineEnabled')} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(value) => setBoolean('GlyphOutlineEnabled', value)} />
      <Slider label="Width" value={numberValue('GlyphOutlineWidth')} min={0.001} max={0.1} step={0.001} onChange={(value) => setNumber('GlyphOutlineWidth', value)} />
      <Slider label="Opacity" value={numberValue('GlyphOutlineOpacity')} min={0.01} max={1} step={0.01} onChange={(value) => setNumber('GlyphOutlineOpacity', value)} />
      <Slider label="Depth Bias" value={numberValue('GlyphOutlineDepthBias')} min={0} max={1} step={0.01} onChange={(value) => setNumber('GlyphOutlineDepthBias', value)} />
      <Slider label="Audio Reactive" value={numberValue('GlyphOutlineAudioReactive')} min={0} max={2} step={0.01} onChange={(value) => setNumber('GlyphOutlineAudioReactive', value)} />
    </div>
  </div>
)}
    </>
  );
};
