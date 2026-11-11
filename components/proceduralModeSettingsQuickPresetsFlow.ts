import type { ProceduralMode, ProceduralQuickPreset } from './proceduralModeSettingsTypes';
import { proceduralLayerPatch } from './proceduralModeSettingsTypes';

export const PROCEDURAL_QUICK_PRESETS_FLOW: Partial<Record<ProceduralMode, ProceduralQuickPreset[]>> = {
  creep_lattice: [
    {
      label: 'Creep scaffold',
      description: 'Cube lattice with slow span drag and reduced snap rigidity.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'creep_lattice', Source: 'cube', Count: 9400, BaseSize: 0.82, RadiusScale: 1.0,
        MaterialStyle: 'glass', VoxelOpacity: 0.8, VoxelScale: 1.12, VoxelDensity: 0.42, VoxelSnap: 0.34, VoxelAudioReactive: 0.08, VoxelWireframe: false,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  advection_flow: [
    {
      label: 'Advection lane',
      description: 'Plane flow sheet with directional lanes and restrained bleed.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'advection_flow', Source: 'plane', Count: 9400, BaseSize: 0.88, RadiusScale: 1.0,
        MaterialStyle: 'classic', BrushOpacity: 0.8, BrushLayers: 5, BrushScale: 1.02, BrushJitter: 0.12, BrushAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.08,
      }),
    },
  ],  vortex_transport: [
    {
      label: 'Transport column',
      description: 'Sphere fog with spiral lift and clear vortex transport.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'vortex_transport', Source: 'sphere', Count: 7600, BaseSize: 1.18, RadiusScale: 1.16,
        MaterialStyle: 'glass', FogOpacity: 0.3, FogDensity: 0.38, FogDepth: 0.86, FogScale: 1.0, FogDrift: 0.34, FogSlices: 22, FogGlow: 0.2, FogAnisotropy: 0.56, FogAudioReactive: 0.16,
        ConnectionEnabled: false, Trail: 0.06,
      }),
    },
  ],  pressure_cells: [
    {
      label: 'Pressure basin',
      description: 'Grid fog with compressed cells and basin-like density pockets.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'pressure_cells', Source: 'grid', Count: 7200, BaseSize: 1.12, RadiusScale: 1.0,
        MaterialStyle: 'halftone', FogOpacity: 0.28, FogDensity: 0.44, FogDepth: 0.62, FogScale: 0.84, FogDrift: 0.12, FogSlices: 20, FogGlow: 0.08, FogAnisotropy: 0.18, FogAudioReactive: 0.1,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  avalanche_field: [
    {
      label: 'Avalanche slope',
      description: 'Plane debris field with runout spread and slope-driven collapse.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'avalanche_field', Source: 'plane', Count: 11200, BaseSize: 0.66, RadiusScale: 1.0,
        MaterialStyle: 'halftone', CrystalOpacity: 0.74, CrystalScale: 0.82, CrystalDensity: 0.92, CrystalSpread: 0.34, CrystalAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.03,
      }),
    },
  ],  jammed_pack: [
    {
      label: 'Jammed cube pack',
      description: 'Cube-packed aggregate with locked voids and compact compression.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'jammed_pack', Source: 'cube', Count: 9800, BaseSize: 0.78, RadiusScale: 1.0,
        MaterialStyle: 'classic', CrystalOpacity: 0.82, CrystalScale: 1.02, CrystalDensity: 1.0, CrystalSpread: 0.14, CrystalAudioReactive: 0.04,
        ConnectionEnabled: false, Trail: 0.02,
      }),
    },
  ],  melt_front: [
    {
      label: 'Melt plate',
      description: 'Plane brush sheet with softened front and dripping thermal bleed.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'melt_front', Source: 'plane', Count: 9000, BaseSize: 0.92, RadiusScale: 1.0,
        MaterialStyle: 'classic', BrushOpacity: 0.82, BrushLayers: 5, BrushScale: 1.08, BrushJitter: 0.18, BrushAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.1,
      }),
    },
  ],  freeze_skin: [
    {
      label: 'Frozen shell',
      description: 'Sphere shell with icy crust, frost ring, and locked surface.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'freeze_skin', Source: 'sphere', Count: 7600, BaseSize: 1.0, RadiusScale: 1.08,
        MaterialStyle: 'glass', HullOpacity: 0.72, HullFresnel: 0.92, HullPointBudget: 1600, HullJitter: 0.05,
        ConnectionEnabled: false, Trail: 0.03,
      }),
    },
  ],  condense_field: [
    {
      label: 'Condense basin',
      description: 'Plane fog field with droplet cores and sinking condensation bands.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'condense_field', Source: 'plane', Count: 7600, BaseSize: 1.06, RadiusScale: 1.0,
        MaterialStyle: 'glass', FogOpacity: 0.3, FogDensity: 0.48, FogDepth: 0.7, FogScale: 0.9, FogDrift: 0.14, FogSlices: 22, FogGlow: 0.12, FogAnisotropy: 0.22, FogAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  evaporative_sheet: [
    {
      label: 'Evaporative film',
      description: 'Text/plane sheet with retreating edge and salt-fringe breakup.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'evaporative_sheet', Source: 'text', Count: 8600, BaseSize: 0.84, RadiusScale: 1.0,
        MaterialStyle: 'halftone', TextMapText: 'DRY', TextMapSize: 276, TextMapPadding: 36, TextMapWeight: 700, BrushOpacity: 0.7, BrushLayers: 4, BrushScale: 0.96, BrushJitter: 0.14, BrushAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.08,
      }),
    },
  ],  sublimate_cloud: [
    {
      label: 'Sublimating cloud',
      description: 'Ring cloud with hollow core and lifted crystal loss.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'sublimate_cloud', Source: 'ring', Count: 7000, BaseSize: 1.12, RadiusScale: 1.04,
        MaterialStyle: 'glass', FogOpacity: 0.24, FogDensity: 0.34, FogDepth: 0.92, FogScale: 1.12, FogDrift: 0.26, FogSlices: 20, FogGlow: 0.16, FogAnisotropy: 0.48, FogAudioReactive: 0.12,
        ConnectionEnabled: false, Trail: 0.06,
      }),
    },
  ],
};
