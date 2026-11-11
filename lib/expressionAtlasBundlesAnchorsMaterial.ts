import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { layerPatch } from './expressionAtlasCore';

export const EXPRESSION_ATLAS_BUNDLES_ANCHORS_MATERIAL: ExpressionAtlasBundle[] = [
  {
    id: 'cloth-membrane-drape-anchor',
    label: 'Cloth Membrane Drape Anchor',
    summary: 'plane / cylinder を使って cloth membrane の drape と inhale を確認するアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'cloth_membrane', Source: layerIndex === 2 ? 'plane' : 'cylinder', MaterialStyle: 'glass', TemporalProfile: layerIndex === 2 ? 'inhale' : 'oscillate', TemporalStrength: 0.24, TemporalSpeed: 0.78,
      Count: layerIndex === 2 ? 9600 : 9000, RadiusScale: 1.08, BaseSize: 0.9,
      SheetOpacity: 0.66, SheetFresnel: 0.68, SheetAudioReactive: 0.12, SheetWireframe: false,
    }),
  },
  {
    id: 'viscous-flow-ledger-anchor',
    label: 'Viscous Flow Ledger Anchor',
    summary: 'image / video を使って viscous flow の pooling と phase shift を確認するアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'viscous_flow', Source: layerIndex === 2 ? 'image' : 'video', MaterialStyle: 'classic', TemporalProfile: layerIndex === 2 ? 'phase_shift' : 'melt', TemporalStrength: 0.28, TemporalSpeed: 0.86,
      Count: 9400, RadiusScale: 1.0, BaseSize: 0.86,
      BrushOpacity: 0.84, BrushLayers: 6, BrushScale: 1.12, BrushJitter: 0.2, BrushAudioReactive: 0.08,
    }),
  },
  {
    id: 'granular-fall-pile-anchor',
    label: 'Granular Fall Pile Anchor',
    summary: 'sphere / plane を使って granular fall の pile と accumulate / exfoliate を確認するアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'granular_fall', Source: layerIndex === 2 ? 'sphere' : 'plane', MaterialStyle: 'halftone', TemporalProfile: layerIndex === 2 ? 'accumulate' : 'exfoliate', TemporalStrength: 0.26, TemporalSpeed: 0.82,
      Count: 10400, RadiusScale: 1.0, BaseSize: 0.72,
      CrystalOpacity: 0.74, CrystalScale: 0.9, CrystalDensity: 0.78, CrystalSpread: 0.26,
    }),
  },
  {
    id: 'fracture-grammar-plate-anchor',
    label: 'Fracture Grammar Plate Anchor',
    summary: 'grid / text を使って fracture grammar の plate bias と rewrite を確認するアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'fracture_grammar', Source: layerIndex === 2 ? 'grid' : 'text', MaterialStyle: 'classic', TemporalProfile: layerIndex === 2 ? 'phase_shift' : 'rewrite', TemporalStrength: 0.28, TemporalSpeed: 0.88,
      Count: 8600, RadiusScale: 1.0, BaseSize: 0.76,
      GrowthOpacity: 0.76, GrowthBranches: 6, GrowthLength: 0.88, GrowthSpread: 0.34,
      TextMapText: 'FRACTURE', TextMapSize: 280, TextMapPadding: 42, TextMapWeight: 700,
    }),
  },
  {
    id: 'growth-grammar-arbor-anchor',
    label: 'Growth Grammar Arbor Anchor',
    summary: 'sphere / text を使って growth grammar の再帰成長と rewrite を確認するアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'growth_grammar', Source: layerIndex === 2 ? 'sphere' : 'text', MaterialStyle: 'hologram', TemporalProfile: layerIndex === 2 ? 'growth' : 'rewrite', TemporalStrength: 0.28, TemporalSpeed: 0.84,
      Count: layerIndex === 2 ? 9000 : 8400, RadiusScale: 1.08, BaseSize: 0.78,
      GrowthOpacity: 0.8, GrowthBranches: 8, GrowthLength: 1.02, GrowthSpread: 0.48,
      TextMapText: 'ARBOR', TextMapSize: 288, TextMapPadding: 44, TextMapWeight: 700,
    }),
  },
];
