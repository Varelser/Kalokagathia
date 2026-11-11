import type { ProductPackDetailGroup } from './productPackDetailControlTypes';

const SOLVER_DETAIL_GROUPS: Record<string, ProductPackDetailGroup> = {
  'operator-graph': {
    id: 'solver-operator-graph-detail-controls',
    label: 'Operator Graph Controls',
    summary: 'operator / chain / feedback を壊さず、再記述の強度だけを細かく出します。',
    controls: [
      { kind: 'slider', key: 'screenPersistenceIntensity', label: 'Persistence', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'screenSweepIntensity', label: 'Sweep', min: 0, max: 1, step: 0.01 },
      { kind: 'toggle', key: 'screenSequenceDriveEnabled', label: 'Sequence Drive', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'screenSequenceDriveStrength', label: 'Sequence Drive Strength', min: 0, max: 2, step: 0.05 },
    ],
  },
  'system-emitter': {
    id: 'solver-system-emitter-detail-controls',
    label: 'System / Emitter Controls',
    summary: 'emit 形状・軌道・burst・ribbon を emitter 単位の感覚で追い込みます。',
    controls: [
      { kind: 'toggle', key: 'gpgpuEmitShape', label: 'Emit Shape', options: [{ label: 'Sphere', val: 'sphere' }, { label: 'Ring', val: 'ring' }, { label: 'Cone', val: 'cone' }, { label: 'Shell', val: 'shell' }] },
      { kind: 'slider', key: 'gpgpuRibbonWidth', label: 'Ribbon Width', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuTrailLength', label: 'Trail Length', min: 2, max: 16, step: 1 },
      { kind: 'slider', key: 'gpgpuWellOrbit', label: 'Emitter Orbit', min: 0, max: 2, step: 0.01 },
    ],
  },
  'simulation-zone': {
    id: 'solver-simulation-zone-detail-controls',
    label: 'Simulation Zone Controls',
    summary: '前フレーム持ち越しと時間発展の強度を bundle の上で細分化します。',
    controls: [
      { kind: 'slider', key: 'layer2TemporalStrength', label: 'Layer2 Temporal Strength', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3TemporalStrength', label: 'Layer3 Temporal Strength', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'screenPersistenceLayers', label: 'Persistence Layers', min: 1, max: 8, step: 1 },
      { kind: 'slider', key: 'layer3TemporalSpeed', label: 'Layer3 Temporal Speed', min: 0, max: 4, step: 0.05 },
    ],
  },
  'gpu-vfx-graph': {
    id: 'solver-gpu-vfx-graph-detail-controls',
    label: 'GPU VFX Graph Controls',
    summary: 'GPU backend / sort / geometry / velocity 描画を graph 感覚で追い込みます。',
    controls: [
      { kind: 'toggle', key: 'gpgpuWebGPUEnabled', label: 'WebGPU', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'toggle', key: 'gpgpuSortEnabled', label: 'GPU Sort', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'toggle', key: 'gpgpuGeomMode', label: 'Geometry Mode', options: [{ label: 'Point', val: 'point' }, { label: 'Cube', val: 'cube' }, { label: 'Icosa', val: 'icosa' }] },
      { kind: 'slider', key: 'gpgpuGeomScale', label: 'Geometry Scale', min: 0.1, max: 5, step: 0.05 },
    ],
  },
  'volumetric-solver': {
    id: 'solver-volumetric-detail-controls',
    label: 'Volumetric Solver Controls',
    summary: 'pyro / fog / volume の密度と刻みを solver 感覚で調整します。',
    controls: [
      { kind: 'toggle', key: 'gpgpuVolumetricEnabled', label: 'GPU Volume', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'gpgpuVolumetricDensity', label: 'Volume Density', min: 0, max: 3, step: 0.05 },
      { kind: 'slider', key: 'gpgpuVolumetricSteps', label: 'Raymarch Steps', min: 8, max: 128, step: 1 },
      { kind: 'slider', key: 'layer3FogDensity', label: 'Fog Density', min: 0, max: 1, step: 0.01 },
    ],
  },
  'pbd-solver': {
    id: 'solver-pbd-detail-controls',
    label: 'PBD / Vellum Controls',
    summary: 'cloth / grain / elastic / SPH の拘束感を上から細かく制御します。',
    controls: [
      { kind: 'toggle', key: 'gpgpuElasticEnabled', label: 'Elastic Constraint', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'gpgpuElasticStrength', label: 'Elastic Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuSphViscosity', label: 'SPH Viscosity', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'layer3SheetFresnel', label: 'Sheet Fresnel', min: 0, max: 1, step: 0.01 },
    ],
  },
  'mpm-material': {
    id: 'solver-mpm-detail-controls',
    label: 'MPM Material Controls',
    summary: '泥・雪・土・連続体寄りの量感を material 側から細分化します。',
    controls: [
      { kind: 'slider', key: 'gpgpuMetaballStrength', label: 'Metaball Strength', min: 0, max: 3, step: 0.05 },
      { kind: 'slider', key: 'gpgpuSphPressure', label: 'Pressure', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'layer3DepositionRelief', label: 'Deposition Relief', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3VoxelSnap', label: 'Voxel Snap', min: 0, max: 1, step: 0.01 },
    ],
  },
  'destruction-fracture': {
    id: 'solver-destruction-detail-controls',
    label: 'Destruction / Fracture Controls',
    summary: '破断・接触・崩れの見えを既存 bundle の上から強めます。',
    controls: [
      { kind: 'toggle', key: 'interLayerContactFxEnabled', label: 'Contact FX', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'layer3ErosionTrailLength', label: 'Fracture Trail Length', min: 0, max: 1, step: 0.01 },
      { kind: 'toggle', key: 'layer3VoxelWireframe', label: 'Voxel Wireframe', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'screenImpactFlashIntensity', label: 'Impact Flash', min: 0, max: 1, step: 0.01 },
    ],
  },
  'signal-image-field': {
    id: 'solver-signal-field-detail-controls',
    label: 'Signal / Image Field Controls',
    summary: 'TOP / COP / CHOP / field 的な画面場と信号場を細かく制御します。',
    controls: [
      { kind: 'toggle', key: 'postNoiseEnabled', label: 'Post Noise', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'screenScanlineIntensity', label: 'Scanline', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'screenSplitIntensity', label: 'Split Amount', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'layer3ReactionScale', label: 'Reaction Scale', min: 0.1, max: 4, step: 0.05 },
    ],
  },
  'task-graph': {
    id: 'solver-task-graph-detail-controls',
    label: 'Task / Variant Controls',
    summary: 'variant sweep や recipe multiplication を保ったまま sequence 系だけを細かく動かします。',
    controls: [
      { kind: 'toggle', key: 'autoLod', label: 'Auto LOD', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'toggle', key: 'screenSequenceDriveEnabled', label: 'Sequence Drive', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'screenSequenceDriveStrength', label: 'Sequence Strength', min: 0, max: 2, step: 0.05 },
      { kind: 'slider', key: 'layer2TemporalSpeed', label: 'Layer2 Temporal Speed', min: 0, max: 4, step: 0.05 },
    ],
  },
};




export { SOLVER_DETAIL_GROUPS };
