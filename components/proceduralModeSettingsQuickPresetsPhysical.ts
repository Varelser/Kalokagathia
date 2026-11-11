import type { ProceduralMode, ProceduralQuickPreset } from './proceduralModeSettingsTypes';
import { proceduralLayerPatch } from './proceduralModeSettingsTypes';

export const PROCEDURAL_QUICK_PRESETS_PHYSICAL: Partial<Record<ProceduralMode, ProceduralQuickPreset[]>> = {
  cellular_front: [
    {
      label: 'Cell split front',
      description: 'Grid-grown advancing cellular front with branching pressure and readable edge crawl.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'cellular_front', Source: 'grid', Count: 9800, BaseSize: 0.8, RadiusScale: 1.0,
        MaterialStyle: 'hologram', ReactionOpacity: 0.78, ReactionFeed: 0.026, ReactionKill: 0.048, ReactionScale: 1.06, ReactionWarp: 0.2, ReactionAudioReactive: 0.1,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  biofilm_skin: [
    {
      label: 'Colony film',
      description: 'Image-driven biofilm skin with wet pooling, soft scar bands, and living colony spread.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'biofilm_skin', Source: 'image', Count: 9600, BaseSize: 0.86, RadiusScale: 1.06,
        MaterialStyle: 'glass', ReactionOpacity: 0.82, ReactionFeed: 0.022, ReactionKill: 0.042, ReactionScale: 0.96, ReactionWarp: 0.3, ReactionAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.05,
      }),
    },
  ],  cloth_membrane: [
    {
      label: 'Draped sail',
      description: 'Plane cloth membrane with soft sag and restrained ripple.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'cloth_membrane', Source: 'plane', Count: 9600, BaseSize: 1.02, RadiusScale: 1.12,
        MaterialStyle: 'glass', SheetOpacity: 0.64, SheetFresnel: 0.62, SheetAudioReactive: 0.12, SheetWireframe: false,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  viscous_flow: [
    {
      label: 'Viscous spill',
      description: 'Image-driven viscous sheet with pooling drag and stain-like drift.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'viscous_flow', Source: 'image', Count: 9400, BaseSize: 0.92, RadiusScale: 1.0,
        MaterialStyle: 'classic', BrushOpacity: 0.82, BrushLayers: 6, BrushScale: 1.08, BrushJitter: 0.18, BrushAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.06,
      }),
    },
  ],  granular_fall: [
    {
      label: 'Granular drop',
      description: 'Sphere-based granular fall with pile-friendly particulate density.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'granular_fall', Source: 'sphere', Count: 10400, BaseSize: 0.74, RadiusScale: 1.0,
        MaterialStyle: 'halftone', CrystalOpacity: 0.72, CrystalScale: 0.92, CrystalDensity: 0.76, CrystalSpread: 0.24, CrystalAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  fracture_grammar: [
    {
      label: 'Fracture syntax',
      description: 'Grid-driven angular fracture grammar with narrow spread.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'fracture_grammar', Source: 'grid', Count: 8600, BaseSize: 0.76, RadiusScale: 1.0,
        MaterialStyle: 'classic', GrowthOpacity: 0.76, GrowthBranches: 6, GrowthLength: 0.86, GrowthSpread: 0.34, GrowthAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  growth_grammar: [
    {
      label: 'Growth syntax',
      description: 'Recursive growth grammar scaffold with spherical arbor motion.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'growth_grammar', Source: 'sphere', Count: 9000, BaseSize: 0.78, RadiusScale: 1.08,
        MaterialStyle: 'hologram', GrowthOpacity: 0.78, GrowthBranches: 8, GrowthLength: 1.02, GrowthSpread: 0.48, GrowthAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.06,
      }),
    },
  ],  viscoelastic_membrane: [
    {
      label: 'Memory sheet',
      description: 'Plane membrane with delayed rebound and elastic sag memory.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'viscoelastic_membrane', Source: 'plane', Count: 9800, BaseSize: 0.94, RadiusScale: 1.1,
        MaterialStyle: 'glass', SheetOpacity: 0.68, SheetFresnel: 0.78, SheetAudioReactive: 0.16, SheetWireframe: false,
        ConnectionEnabled: false, Trail: 0.05,
      }),
    },
  ],  percolation_sheet: [
    {
      label: 'Percolation ledger',
      description: 'Text-driven receiving sheet with channelized soak and wick retention.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'percolation_sheet', Source: 'text', Count: 9600, BaseSize: 0.82, RadiusScale: 1.0,
        TextMapText: 'FLOW', MaterialStyle: 'halftone', DepositionOpacity: 0.84, DepositionRelief: 0.58, DepositionErosion: 0.16, DepositionBands: 8, DepositionAudioReactive: 0.08, DepositionWireframe: false,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],  talus_heap: [
    {
      label: 'Talus slope',
      description: 'Plane-driven angular heap with compressed spread and stable foot.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'talus_heap', Source: 'plane', Count: 10800, BaseSize: 0.68, RadiusScale: 1.0,
        MaterialStyle: 'halftone', CrystalOpacity: 0.76, CrystalScale: 0.78, CrystalDensity: 0.84, CrystalSpread: 0.16, CrystalAudioReactive: 0.06,
        ConnectionEnabled: false, Trail: 0.03,
      }),
    },
  ],  corrosion_front: [
    {
      label: 'Etch front',
      description: 'Grid reaction plate with pitted corrosion edge and crawling front.',
      patch: (layerIndex) => proceduralLayerPatch(layerIndex, {
        Type: 'corrosion_front', Source: 'grid', Count: 9200, BaseSize: 0.8, RadiusScale: 1.0,
        MaterialStyle: 'chrome', ReactionOpacity: 0.8, ReactionFeed: 0.023, ReactionKill: 0.044, ReactionScale: 1.08, ReactionWarp: 0.24, ReactionAudioReactive: 0.08,
        ConnectionEnabled: false, Trail: 0.04,
      }),
    },
  ],
};
