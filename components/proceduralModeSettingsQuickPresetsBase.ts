import type { ProceduralMode, ProceduralQuickPreset } from './proceduralModeSettingsTypes';
import { proceduralLayerPatch } from './proceduralModeSettingsTypes';

export const PROCEDURAL_QUICK_PRESETS_BASE: Partial<Record<ProceduralMode, ProceduralQuickPreset[]>> = {
  sheet: [
    {
      label: 'Clean membrane',
      description: 'Plane-based translucent sheet with restrained motion.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'sheet', Source: 'plane', Count: 12000, BaseSize: 1.1, RadiusScale: 1.15,
        MaterialStyle: 'glass', SheetOpacity: 0.7, SheetFresnel: 0.55, SheetAudioReactive: 0.2, SheetWireframe: false,
        ConnectionEnabled: false, Trail: 0.08,
      }),
    },
    {
      label: 'Wire membrane',
      description: 'Graphic wireframe surface for architectural or diagram-like looks.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'sheet', Source: 'grid', Count: 9000, BaseSize: 0.95, RadiusScale: 1.0,
        MaterialStyle: 'halftone', SheetOpacity: 0.4, SheetFresnel: 0.82, SheetAudioReactive: 0.15, SheetWireframe: true,
        ConnectionEnabled: false, Trail: 0.0,
      }),
    },
  ],  surface_shell: [
    {
      label: 'Glass shell',
      description: 'Outer hull with denser point budget and subtle shimmer.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'surface_shell', Source: 'sphere', Count: 14000, BaseSize: 0.9, RadiusScale: 1.2,
        MaterialStyle: 'glass', HullOpacity: 0.65, HullPointBudget: 3072, HullJitter: 0.08, HullFresnel: 0.6, HullAudioReactive: 0.2, HullWireframe: false,
      }),
    },
  ],  surface_patch: [
    {
      label: 'Patch fabric',
      description: 'Semi-relaxed panel surface with useful mid density defaults.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'surface_patch', Source: 'plane', Count: 11000, BaseSize: 0.95, RadiusScale: 1.0,
        MaterialStyle: 'classic', PatchOpacity: 0.72, PatchResolution: 54, PatchRelax: 0.34, PatchFresnel: 0.35, PatchAudioReactive: 0.15, PatchWireframe: false,
      }),
    },
  ],  brush_surface: [
    {
      label: 'Dry brush',
      description: 'Painterly layered surface with moderate breakup.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'brush_surface', Source: 'plane', Count: 9000, BaseSize: 1.2, RadiusScale: 1.05,
        MaterialStyle: 'classic', BrushOpacity: 0.58, BrushLayers: 5, BrushScale: 1.1, BrushJitter: 0.28, BrushAudioReactive: 0.18,
      }),
    },
  ],  fiber_field: [
    {
      label: 'Fiber weave',
      description: 'Structured filaments with controllable curl and density.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'fiber_field', Source: 'cylinder', Count: 10000, BaseSize: 0.7, RadiusScale: 1.0,
        MaterialStyle: 'hologram', FiberOpacity: 0.7, FiberLength: 0.74, FiberDensity: 0.48, FiberCurl: 0.38, FiberAudioReactive: 0.22,
      }),
    },
  ],  growth_field: [
    {
      label: 'Branch bloom',
      description: 'Balanced branching field suitable for botanical or neural structures.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'growth_field', Source: 'sphere', Count: 8500, BaseSize: 0.86, RadiusScale: 1.08,
        MaterialStyle: 'classic', GrowthOpacity: 0.82, GrowthBranches: 6, GrowthLength: 0.92, GrowthSpread: 0.48, GrowthAudioReactive: 0.16,
      }),
    },
  ],  deposition_field: [
    {
      label: 'Sediment relief',
      description: 'Accumulated layered terrain with restrained erosion.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'deposition_field', Source: 'plane', Count: 12000, BaseSize: 0.8, RadiusScale: 1.0,
        MaterialStyle: 'chrome', DepositionOpacity: 0.78, DepositionRelief: 0.56, DepositionErosion: 0.22, DepositionBands: 5, DepositionAudioReactive: 0.18, DepositionWireframe: false,
      }),
    },
  ],  crystal_aggregate: [
    {
      label: 'Crystal bloom',
      description: 'Clustered crystal body with moderate spread.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'crystal_aggregate', Source: 'sphere', Count: 9500, BaseSize: 0.88, RadiusScale: 1.0,
        MaterialStyle: 'glass', CrystalOpacity: 0.74, CrystalScale: 1.18, CrystalDensity: 0.58, CrystalSpread: 0.34, CrystalAudioReactive: 0.2, CrystalWireframe: false,
      }),
    },
  ],  erosion_trail: [
    {
      label: 'Weathered trace',
      description: 'Directional erosion marks with readable drift.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'erosion_trail', Source: 'plane', Count: 10000, BaseSize: 0.72, RadiusScale: 1.0,
        MaterialStyle: 'halftone', ErosionTrailOpacity: 0.68, ErosionTrailDensity: 0.5, ErosionTrailLength: 0.82, ErosionTrailDrift: 0.34, ErosionTrailAudioReactive: 0.15,
      }),
    },
  ],  voxel_lattice: [
    {
      label: 'Voxel scaffold',
      description: 'Readable block structure for lattice-like forms.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'voxel_lattice', Source: 'cube', Count: 8000, BaseSize: 1.0, RadiusScale: 1.0,
        MaterialStyle: 'chrome', VoxelOpacity: 0.72, VoxelScale: 1.22, VoxelDensity: 0.44, VoxelSnap: 0.72, VoxelAudioReactive: 0.12, VoxelWireframe: false,
      }),
    },
  ],  crystal_deposition: [
    {
      label: 'Mineral crust',
      description: 'Deposited crystal surface for mixed geological looks.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'crystal_deposition', Source: 'plane', Count: 9000, BaseSize: 0.82, RadiusScale: 1.0,
        MaterialStyle: 'glass', CrystalDepositionOpacity: 0.76, CrystalDepositionCrystalScale: 1.24, CrystalDepositionDensity: 0.54, CrystalDepositionRelief: 0.48, CrystalDepositionAudioReactive: 0.16, CrystalDepositionWireframe: false,
      }),
    },
  ],  reaction_diffusion: [
    {
      label: 'Reaction skin',
      description: 'Stable reaction-diffusion base with visible pattern contrast.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'reaction_diffusion', Source: 'plane', Count: 12000, BaseSize: 0.78, RadiusScale: 1.0,
        MaterialStyle: 'hologram', ReactionOpacity: 0.74, ReactionFeed: 0.028, ReactionKill: 0.052, ReactionScale: 1.1, ReactionWarp: 0.22, ReactionAudioReactive: 0.14,
      }),
    },
  ],  volume_fog: [
    {
      label: 'Volumetric haze',
      description: 'Soft atmospheric fog with enough slices for depth.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'volume_fog', Source: 'sphere', Count: 7000, BaseSize: 1.3, RadiusScale: 1.25,
        MaterialStyle: 'glass', FogOpacity: 0.28, FogDensity: 0.32, FogDepth: 0.72, FogScale: 1.18, FogDrift: 0.24, FogSlices: 20, FogGlow: 0.18, FogAnisotropy: 0.34, FogAudioReactive: 0.2,
      }),
    },
  ],

};
