import type { ProductPackDetailGroup } from './productPackDetailControlTypes';

const PACK_DETAIL_GROUPS: Record<string, ProductPackDetailGroup> = {
  'product-pack-touch-feedback-topology': {
    id: 'pack-touch-feedback-topology-detail-controls',
    label: 'Touch Feedback Topology Controls',
    summary: 'feedback topology pack の persistence / split / interference を個別に追い込みます。',
    controls: [
      { kind: 'slider', key: 'screenPersistenceIntensity', label: 'Feedback Persistence', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'screenPersistenceLayers', label: 'Feedback Layers', min: 1, max: 8, step: 1 },
      { kind: 'slider', key: 'screenSplitIntensity', label: 'Split Amount', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'screenInterferenceIntensity', label: 'Interference', min: 0, max: 0.5, step: 0.01 },
    ],
  },
  'product-pack-touch-pop-force-cloud': {
    id: 'pack-touch-pop-force-cloud-detail-controls',
    label: 'Touch POP Force Cloud Controls',
    summary: 'POP force cloud pack の密度・curl・vector field・instance を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuCount', label: 'Particle Density', min: 1024, max: 1048576, step: 1024 },
      { kind: 'slider', key: 'gpgpuCurlStrength', label: 'Curl Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuVFieldStrength', label: 'Vector Field Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuGeomScale', label: 'Instance Scale', min: 0.1, max: 5, step: 0.05 },
    ],
  },
  'product-pack-touch-curve-relief-feedback': {
    id: 'pack-touch-curve-relief-feedback-detail-controls',
    label: 'Touch Curve Relief Feedback Controls',
    summary: 'curve relief feedback pack の line flow と patch surface を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2FlowAmplitude', label: 'Curve Flow Amplitude', min: 0, max: 100, step: 1 },
      { kind: 'slider', key: 'layer3PatchResolution', label: 'Patch Resolution', min: 8, max: 128, step: 1 },
      { kind: 'slider', key: 'layer3PatchRelax', label: 'Patch Relax', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'screenSplitIntensity', label: 'Feedback Split', min: 0, max: 0.4, step: 0.01 },
    ],
  },
  'product-pack-trapcode-particular-noir': {
    id: 'pack-trapcode-particular-noir-detail-controls',
    label: 'Trapcode Particular Noir Controls',
    summary: 'Particular noir pack の blast / streak / age / glow を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuAudioBlast', label: 'Audio Blast', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuStreakLength', label: 'Streak Length', min: 1, max: 64, step: 1 },
      { kind: 'slider', key: 'gpgpuAgeMax', label: 'Particle Age', min: 0.5, max: 16, step: 0.1 },
      { kind: 'slider', key: 'postBloomIntensity', label: 'Glow Intensity', min: 0, max: 5, step: 0.05 },
    ],
  },
  'product-pack-trapcode-particular-audio-sparks': {
    id: 'pack-trapcode-particular-audio-sparks-detail-controls',
    label: 'Trapcode Particular Audio Sparks Controls',
    summary: 'audio sparks pack の audio burst / ring / ribbon / pulse を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuAudioBlast', label: 'Audio Blast', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuRibbonWidth', label: 'Ribbon Width', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuTrailLength', label: 'Trail Length', min: 2, max: 16, step: 1 },
      { kind: 'slider', key: 'screenPulseIntensity', label: 'Pulse Intensity', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-trapcode-form-lattice': {
    id: 'pack-trapcode-form-lattice-detail-controls',
    label: 'Trapcode Form Lattice Controls',
    summary: 'form lattice pack の voxel / connection / braid を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2VoxelDensity', label: 'Voxel Density', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2VoxelSnap', label: 'Voxel Snap', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2ConnectionDistance', label: 'Connection Distance', min: 0, max: 64, step: 1 },
      { kind: 'slider', key: 'layer2ConnectionOpacity', label: 'Connection Opacity', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-trapcode-form-sdf-swarm': {
    id: 'pack-trapcode-form-sdf-swarm-detail-controls',
    label: 'Trapcode Form SDF Swarm Controls',
    summary: 'form sdf swarm pack の instance / sdf / ribbon / vortex を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuGeomScale', label: 'Instance Scale', min: 0.1, max: 5, step: 0.05 },
      { kind: 'slider', key: 'gpgpuSdfSize', label: 'SDF Size', min: 1, max: 32, step: 0.5 },
      { kind: 'slider', key: 'gpgpuRibbonWidth', label: 'Ribbon Width', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuVortexStrength', label: 'Vortex Strength', min: 0, max: 4, step: 0.05 },
    ],
  },
  'product-pack-universe-retro-feedback': {
    id: 'pack-universe-retro-feedback-detail-controls',
    label: 'Universe Retro Feedback Controls',
    summary: 'retro feedback pack の scanline / noise / ghost を個別制御します。',
    controls: [
      { kind: 'slider', key: 'screenScanlineIntensity', label: 'Scanline', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'screenScanlineDensity', label: 'Scanline Density', min: 64, max: 1200, step: 8 },
      { kind: 'slider', key: 'screenNoiseIntensity', label: 'Noise', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'screenInterferenceIntensity', label: 'Interference', min: 0, max: 0.5, step: 0.01 },
    ],
  },
  'product-pack-universe-broadcast-ghost': {
    id: 'pack-universe-broadcast-ghost-detail-controls',
    label: 'Universe Broadcast Ghost Controls',
    summary: 'broadcast ghost pack の ripple / split / scanline damage を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2FlowAmplitude', label: 'Ripple Amplitude', min: 0, max: 100, step: 1 },
      { kind: 'slider', key: 'layer2FlowFrequency', label: 'Ripple Frequency', min: 0, max: 8, step: 0.1 },
      { kind: 'slider', key: 'screenSplitIntensity', label: 'Split Amount', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'screenSweepIntensity', label: 'Sweep Damage', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-hybrid-audio-operator-stack': {
    id: 'pack-hybrid-audio-operator-stack-detail-controls',
    label: 'Hybrid Audio Operator Stack Controls',
    summary: 'audio operator stack pack の audio drive / halo / ribbon / shell を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuAudioBlast', label: 'Audio Blast', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'layer2GlyphOutlineWidth', label: 'Halo Outline Width', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuRibbonWidth', label: 'Ribbon Width', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'layer3HullFresnel', label: 'Shell Fresnel', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-houdini-pyro-vortex-column': {
    id: 'pack-houdini-pyro-vortex-column-detail-controls',
    label: 'Houdini Pyro Vortex Column Controls',
    summary: 'pyro vortex pack の fog / condense / density volume を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2FogDensity', label: 'Fog Density', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2FogDrift', label: 'Fog Drift', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2FogSlices', label: 'Fog Slices', min: 4, max: 64, step: 1 },
      { kind: 'slider', key: 'gpgpuVolumetricDensity', label: 'Volume Density', min: 0, max: 3, step: 0.05 },
    ],
  },
  'product-pack-houdini-vellum-granular-drape': {
    id: 'pack-houdini-vellum-granular-drape-detail-controls',
    label: 'Houdini Vellum Granular Drape Controls',
    summary: 'vellum granular drape pack の cloth / grain / fall を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2SheetOpacity', label: 'Cloth Opacity', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2SheetFresnel', label: 'Cloth Fresnel', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3CrystalScale', label: 'Granular Scale', min: 0, max: 2, step: 0.01 },
      { kind: 'slider', key: 'layer3CrystalOpacity', label: 'Granular Opacity', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-houdini-growth-arbor': {
    id: 'pack-houdini-growth-arbor-detail-controls',
    label: 'Houdini Growth Arbor Controls',
    summary: 'growth arbor pack の grammar / branch / spread を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2GrowthBranches', label: 'Growth Branches', min: 1, max: 16, step: 1 },
      { kind: 'slider', key: 'layer2GrowthLength', label: 'Growth Length', min: 0, max: 2, step: 0.01 },
      { kind: 'slider', key: 'layer2GrowthSpread', label: 'Growth Spread', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3GrowthSpread', label: 'Branch Spread', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-niagara-stateless-orbit-mesh': {
    id: 'pack-niagara-stateless-orbit-mesh-detail-controls',
    label: 'Niagara Stateless Orbit Mesh Controls',
    summary: 'stateless orbit mesh pack の orbit / well / instance / trail を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuWellStrength', label: 'Well Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuNBodyStrength', label: 'N-Body Strength', min: 0, max: 10, step: 0.1 },
      { kind: 'slider', key: 'gpgpuGeomScale', label: 'Mesh Scale', min: 0.1, max: 5, step: 0.05 },
      { kind: 'slider', key: 'gpgpuTrailLength', label: 'Trail Length', min: 2, max: 16, step: 1 },
    ],
  },
  'product-pack-niagara-collision-burst-field': {
    id: 'pack-niagara-collision-burst-field-detail-controls',
    label: 'Niagara Collision Burst Field Controls',
    summary: 'collision burst field pack の sdf / mouse / trail / streak を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuSdfSize', label: 'SDF Size', min: 1, max: 32, step: 0.5 },
      { kind: 'toggle', key: 'gpgpuMouseMode', label: 'Mouse Mode', options: [{ label: 'Repel', val: 'repel' }, { label: 'Attract', val: 'attract' }, { label: 'Orbit', val: 'orbit' }] },
      { kind: 'slider', key: 'gpgpuTrailLength', label: 'Trail Length', min: 2, max: 16, step: 1 },
      { kind: 'slider', key: 'gpgpuStreakLength', label: 'Streak Length', min: 1, max: 64, step: 1 },
    ],
  },
  'product-pack-geometrynodes-simulation-lattice': {
    id: 'pack-geometrynodes-simulation-lattice-detail-controls',
    label: 'Geometry Nodes Simulation Lattice Controls',
    summary: 'simulation lattice pack の voxel / recurrence / standing field を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2VoxelDensity', label: 'Voxel Density', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer2VoxelSnap', label: 'Voxel Snap', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3PatchOpacity', label: 'Standing Field Opacity', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3TemporalStrength', label: 'Standing Field Strength', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-geometrynodes-reaction-growth-plate': {
    id: 'pack-geometrynodes-reaction-growth-plate-detail-controls',
    label: 'Geometry Nodes Reaction Growth Plate Controls',
    summary: 'reaction growth plate pack の feed / kill / branches / spread を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2ReactionFeed', label: 'Reaction Feed', min: 0, max: 0.1, step: 0.001 },
      { kind: 'slider', key: 'layer2ReactionKill', label: 'Reaction Kill', min: 0, max: 0.1, step: 0.001 },
      { kind: 'slider', key: 'layer3GrowthBranches', label: 'Growth Branches', min: 1, max: 16, step: 1 },
      { kind: 'slider', key: 'layer3GrowthSpread', label: 'Growth Spread', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-unity-vfx-gpu-sheet': {
    id: 'pack-unity-vfx-gpu-sheet-detail-controls',
    label: 'Unity VFX GPU Sheet Controls',
    summary: 'unity vfx gpu sheet pack の sheet / ribbon / tube / bloom を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2SheetOpacity', label: 'Sheet Opacity', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'gpgpuRibbonWidth', label: 'Ribbon Width', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuSmoothTubeRadius', label: 'Tube Radius', min: 0.05, max: 4, step: 0.05 },
      { kind: 'slider', key: 'postBloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-houdini-mpm-slurry-stack': {
    id: 'pack-houdini-mpm-slurry-stack-detail-controls',
    label: 'Houdini MPM Slurry Stack Controls',
    summary: 'mpm slurry pack の viscous flow / sediment / fog depth を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2SheetOpacity', label: 'Viscous Opacity', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3TemporalStrength', label: 'Sediment Growth Strength', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'depthFogNear', label: 'Depth Fog Near', min: 0, max: 1200, step: 10 },
      { kind: 'slider', key: 'depthFogFar', label: 'Depth Fog Far', min: 100, max: 3000, step: 10 },
    ],
  },
  'product-pack-houdini-destruction-fracture-debris': {
    id: 'pack-houdini-destruction-fracture-debris-detail-controls',
    label: 'Houdini Destruction Fracture Debris Controls',
    summary: 'destruction fracture debris pack の fracture / spark / collapse を個別制御します。',
    controls: [
      { kind: 'slider', key: 'layer2SparkCount', label: 'Fracture Spark Count', min: 0, max: 1024, step: 1 },
      { kind: 'slider', key: 'layer3SparkCount', label: 'Debris Spark Count', min: 0, max: 1024, step: 1 },
      { kind: 'slider', key: 'layer3SparkDiffusion', label: 'Debris Spark Diffusion', min: 0, max: 20, step: 0.1 },
      { kind: 'slider', key: 'screenImpactFlashIntensity', label: 'Impact Flash', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-touch-top-cop-signal-field': {
    id: 'pack-touch-top-cop-signal-field-detail-controls',
    label: 'Touch TOP COP Signal Field Controls',
    summary: 'top cop signal field pack の signal rewrite / image feedback を個別制御します。',
    controls: [
      { kind: 'slider', key: 'screenPersistenceIntensity', label: 'Feedback Persistence', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'screenSplitIntensity', label: 'Split Amount', min: 0, max: 0.4, step: 0.01 },
      { kind: 'slider', key: 'layer2TemporalStrength', label: 'Signal Strength', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3TemporalStrength', label: 'Contour Strength', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-hybrid-pdg-variant-sweep': {
    id: 'pack-hybrid-pdg-variant-sweep-detail-controls',
    label: 'Hybrid PDG Variant Sweep Controls',
    summary: 'pdg variant sweep pack の sequence / grammar / crystal deposition を個別制御します。',
    controls: [
      { kind: 'toggle', key: 'screenSequenceDriveEnabled', label: 'Sequence Drive', options: [{ label: 'On', val: true }, { label: 'Off', val: false }] },
      { kind: 'slider', key: 'screenSequenceDriveStrength', label: 'Sequence Strength', min: 0, max: 2, step: 0.05 },
      { kind: 'slider', key: 'layer3CrystalDepositionOpacity', label: 'Crystal Deposition Opacity', min: 0, max: 1, step: 0.01 },
      { kind: 'slider', key: 'layer3CrystalDepositionCrystalScale', label: 'Crystal Scale', min: 0, max: 2, step: 0.01 },
    ],
  },
  'product-pack-niagara-chaos-magnetic-tubes': {
    id: 'pack-niagara-chaos-magnetic-tubes-detail-controls',
    label: 'Niagara Chaos Magnetic Tubes Controls',
    summary: 'chaos magnetic tubes pack の chaos / swarm / magnetic / tubes を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuBoidsAlignment', label: 'Boids Alignment', min: 0, max: 2, step: 0.01 },
      { kind: 'slider', key: 'gpgpuMagneticStrength', label: 'Magnetic Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuElasticStrength', label: 'Elastic Strength', min: 0, max: 4, step: 0.05 },
      { kind: 'slider', key: 'gpgpuTubeRadius', label: 'Tube Radius', min: 0.05, max: 4, step: 0.05 },
    ],
  },
  'product-pack-houdini-shell-metaball-volume': {
    id: 'pack-houdini-shell-metaball-volume-detail-controls',
    label: 'Houdini Shell Metaball Volume Controls',
    summary: 'shell metaball volume pack の shell source / metaball / volumetric density を個別制御します。',
    controls: [
      { kind: 'slider', key: 'gpgpuGeomScale', label: 'Shell Instance Scale', min: 0.1, max: 5, step: 0.05 },
      { kind: 'slider', key: 'gpgpuMetaballResolution', label: 'Metaball Resolution', min: 12, max: 96, step: 1 },
      { kind: 'slider', key: 'gpgpuVolumetricDensity', label: 'Volume Density', min: 0, max: 3, step: 0.05 },
      { kind: 'slider', key: 'postVignetteDarkness', label: 'Vignette Darkness', min: 0, max: 1, step: 0.01 },
    ],
  },
  'product-pack-hybrid-contact-sdf-scatter': {
    id: 'pack-hybrid-contact-sdf-scatter-detail-controls',
    label: 'Hybrid Contact SDF Scatter Controls',
    summary: 'contact sdf scatter pack の scatter / contact / sdf / shell を個別制御します。',
    controls: [
      { kind: 'slider', key: 'interLayerContactGlowBoost', label: 'Contact Glow Boost', min: 0, max: 2, step: 0.01 },
      { kind: 'slider', key: 'interLayerContactSizeBoost', label: 'Contact Size Boost', min: 0, max: 2, step: 0.01 },
      { kind: 'slider', key: 'sdfSpecularIntensity', label: 'SDF Specular', min: 0, max: 3, step: 0.05 },
      { kind: 'slider', key: 'postVignetteDarkness', label: 'Vignette Darkness', min: 0, max: 1, step: 0.01 },
    ],
  },
};


export { PACK_DETAIL_GROUPS };
