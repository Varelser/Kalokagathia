import type { ProductPackFamily } from './productPackLibrary';
import type { ProductPackDetailGroup } from './productPackDetailControlTypes';

const COMMON_DETAIL_GROUP: ProductPackDetailGroup = {
  id: 'pack-common-detail-controls',
  label: 'Bundle Fine Controls',
  summary: '既存の pack / bundle を消さず、その上から密度・エネルギー・発光を細かく追い込むための共通コントロールです。',
  controls: [
    { kind: 'toggle', key: 'gpgpuEnabled', label: 'GPGPU Layer', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
    { kind: 'slider', key: 'gpgpuCount', label: 'Particle Density', min: 1024, max: 1048576, step: 1024 },
    { kind: 'slider', key: 'gpgpuSpeed', label: 'Particle Speed', min: 0.1, max: 5, step: 0.1 },
    { kind: 'slider', key: 'gpgpuOpacity', label: 'Particle Opacity', min: 0, max: 1, step: 0.01 },
    { kind: 'slider', key: 'particleGlow', label: 'Global Glow', min: 0, max: 1.5, step: 0.01 },
  ],
};

const FAMILY_DETAIL_GROUPS: Record<ProductPackFamily, ProductPackDetailGroup[]> = {
  touchdesigner: [
    {
      id: 'family-touchdesigner-detail-controls',
      label: 'TouchDesigner Family Controls',
      summary: 'feedback / split / TOP-COP 的な滲みと場の再記述を上から細分化します。',
      controls: [
        { kind: 'slider', key: 'screenPersistenceIntensity', label: 'Feedback Persistence', min: 0, max: 0.4, step: 0.01 },
        { kind: 'slider', key: 'screenSplitIntensity', label: 'Channel Split', min: 0, max: 0.4, step: 0.01 },
        { kind: 'slider', key: 'screenInterferenceIntensity', label: 'Interference', min: 0, max: 0.5, step: 0.01 },
        { kind: 'slider', key: 'postChromaticAberrationOffset', label: 'CA Offset', min: 0, max: 0.01, step: 0.0001 },
        { kind: 'slider', key: 'layer3PatchResolution', label: 'Surface Relief Resolution', min: 8, max: 128, step: 1 },
      ],
    },
  ],
  trapcode: [
    {
      id: 'family-trapcode-detail-controls',
      label: 'Trapcode Family Controls',
      summary: 'burst / streak / glow / audio blast の量感を pack の上から追い込みます。',
      controls: [
        { kind: 'slider', key: 'gpgpuAudioBlast', label: 'Audio Blast', min: 0, max: 4, step: 0.05 },
        { kind: 'slider', key: 'gpgpuTrailLength', label: 'Trail Length', min: 2, max: 16, step: 1 },
        { kind: 'slider', key: 'gpgpuStreakLength', label: 'Streak Length', min: 1, max: 64, step: 1 },
        { kind: 'slider', key: 'postBloomIntensity', label: 'Glow Intensity', min: 0, max: 5, step: 0.05 },
        { kind: 'slider', key: 'screenPulseIntensity', label: 'Impact Pulse', min: 0, max: 1, step: 0.01 },
      ],
    },
  ],
  universe: [
    {
      id: 'family-universe-detail-controls',
      label: 'Universe Family Controls',
      summary: 'retro / broadcast / ghost / lens 的な画面処理を bundle を保ったまま細分化します。',
      controls: [
        { kind: 'slider', key: 'screenScanlineIntensity', label: 'Scanline', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'screenNoiseIntensity', label: 'Screen Noise', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'postVignetteDarkness', label: 'Vignette Darkness', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'postBrightness', label: 'Brightness', min: -1, max: 1, step: 0.01 },
        { kind: 'slider', key: 'postContrastAmount', label: 'Contrast', min: -1, max: 1, step: 0.01 },
      ],
    },
  ],
  hybrid: [
    {
      id: 'family-hybrid-detail-controls',
      label: 'Hybrid Family Controls',
      summary: '複数 solver / post / collision を跨ぐ束を、統合層で細かく調整します。',
      controls: [
        { kind: 'slider', key: 'interLayerCollisionStrength', label: 'Layer Contact Strength', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'screenPersistenceLayers', label: 'Feedback Layers', min: 1, max: 8, step: 1 },
        { kind: 'toggle', key: 'gpgpuSortEnabled', label: 'GPU Sorting', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
        { kind: 'slider', key: 'postNoiseOpacity', label: 'Noise Mix', min: 0, max: 1, step: 0.01 },
      ],
    },
  ],
  houdini: [
    {
      id: 'family-houdini-detail-controls',
      label: 'Houdini Family Controls',
      summary: 'pyro / vellum / mpm / fracture 寄りの束を solver 感を保ったまま細分化します。',
      controls: [
        { kind: 'toggle', key: 'gpgpuFluidEnabled', label: 'Fluid Solver', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
        { kind: 'slider', key: 'gpgpuFluidStrength', label: 'Fluid Strength', min: 0, max: 4, step: 0.05 },
        { kind: 'slider', key: 'gpgpuFluidScale', label: 'Fluid Scale', min: 0.001, max: 0.1, step: 0.001 },
        { kind: 'slider', key: 'gpgpuMetaballResolution', label: 'Metaball Resolution', min: 12, max: 96, step: 1 },
        { kind: 'slider', key: 'gpgpuVolumetricDensity', label: 'Volume Density', min: 0, max: 3, step: 0.05 },
      ],
    },
  ],
  niagara: [
    {
      id: 'family-niagara-detail-controls',
      label: 'Niagara Family Controls',
      summary: 'orbit / magnetic / elastic / stateless emitter 系の動きを細かく刻みます。',
      controls: [
        { kind: 'slider', key: 'gpgpuNBodyStrength', label: 'N-Body Strength', min: 0, max: 10, step: 0.1 },
        { kind: 'slider', key: 'gpgpuWellOrbit', label: 'Orbit', min: 0, max: 2, step: 0.01 },
        { kind: 'slider', key: 'gpgpuMagneticStrength', label: 'Magnetic Field', min: 0, max: 4, step: 0.05 },
        { kind: 'slider', key: 'gpgpuElasticStrength', label: 'Elastic Coupling', min: 0, max: 4, step: 0.05 },
        { kind: 'slider', key: 'gpgpuGeomScale', label: 'Instance Scale', min: 0.1, max: 5, step: 0.05 },
      ],
    },
  ],
  geometrynodes: [
    {
      id: 'family-geometrynodes-detail-controls',
      label: 'Geometry Nodes Family Controls',
      summary: 'simulation zone / lattice / surface patch / voxel の場を細かく追い込みます。',
      controls: [
        { kind: 'toggle', key: 'gpgpuVerletEnabled', label: 'Frame Carry Simulation', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
        { kind: 'slider', key: 'gpgpuSpringStrength', label: 'Spring To Spawn', min: 0, max: 4, step: 0.05 },
        { kind: 'slider', key: 'layer3PatchResolution', label: 'Patch Resolution', min: 8, max: 128, step: 1 },
        { kind: 'slider', key: 'layer3PatchRelax', label: 'Patch Relax', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'layer3VoxelDensity', label: 'Voxel Density', min: 0, max: 1, step: 0.01 },
      ],
    },
  ],
  unityvfx: [
    {
      id: 'family-unityvfx-detail-controls',
      label: 'Unity VFX Family Controls',
      summary: 'GPU graph / sheet / instance / velocity-driven FX をリアルタイム寄りに細分化します。',
      controls: [
        { kind: 'toggle', key: 'gpgpuWebGPUEnabled', label: 'WebGPU Backend', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
        { kind: 'slider', key: 'gpgpuGeomScale', label: 'Geom Scale', min: 0.1, max: 5, step: 0.05 },
        { kind: 'slider', key: 'gpgpuTrailVelocityScale', label: 'Velocity Trail Scale', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'postBloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.01 },
        { kind: 'slider', key: 'screenSweepIntensity', label: 'Sweep Intensity', min: 0, max: 1, step: 0.01 },
      ],
    },
  ],
};


export { COMMON_DETAIL_GROUP, FAMILY_DETAIL_GROUPS };
