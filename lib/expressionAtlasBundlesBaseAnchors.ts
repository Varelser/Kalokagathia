import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { layerPatch } from './expressionAtlasCore';

export const EXPRESSION_ATLAS_BUNDLES_BASE_ANCHORS: ExpressionAtlasBundle[] = [
{
    id: 'text-source-inscription-anchor',
    label: 'Text Source Inscription Anchor',
    summary: 'text 固定で shell script / rune smoke 系の差を比較するためのアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'shell_script' : 'rune_smoke', Source: 'text', MaterialStyle: layerIndex === 2 ? 'classic' : 'hologram', TemporalProfile: layerIndex === 2 ? 'unravel' : 'oscillate', TemporalStrength: layerIndex === 2 ? 0.24 : 0.28, TemporalSpeed: 0.9,
      Count: layerIndex === 2 ? 9800 : 9400, RadiusScale: 1.0, BaseSize: 0.8,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系', TextMapSize: 272, TextMapPadding: 44, TextMapWeight: 700,
      HullOpacity: 0.82, HullFresnel: 0.74, HullPointBudget: 1320,
      FogOpacity: 0.28, FogDensity: 0.4, FogDepth: 0.74, FogScale: 0.92, FogSlices: 17, FogGlow: 0.18,
    }),
  },
{
    id: 'grid-source-architectonic-anchor',
    label: 'Grid Source Architectonic Anchor',
    summary: 'grid 固定で static lace / lattice surge 系の差を比較するためのアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'static_lace' : 'lattice_surge', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'hologram', TemporalProfile: layerIndex === 2 ? 'oscillate' : 'resonate', TemporalStrength: 0.27, TemporalSpeed: 0.92,
      Count: 10200, RadiusScale: 1.0, BaseSize: 0.78,
      FiberOpacity: 0.78, FiberLength: 0.74, FiberDensity: 0.68, FiberCurl: 0.18,
      VoxelOpacity: 0.74, VoxelScale: 0.86, VoxelSnap: 0.18,
    }),
  },
{
    id: 'ring-source-orbit-anchor',
    label: 'Ring Source Orbit Anchor',
    summary: 'ring 固定で eclipse halo / spectral mesh 系の差を比較するためのアンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'eclipse_halo' : 'spectral_mesh', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: layerIndex === 2 ? 'oscillate' : 'resonate', TemporalStrength: 0.28, TemporalSpeed: 0.9,
      Count: layerIndex === 2 ? 9800 : 10400, RadiusScale: 1.08, BaseSize: 0.78,
      HullOpacity: 0.82, HullFresnel: 0.78, HullJitter: 0.08,
      FiberOpacity: 0.8, FiberLength: 1.12, FiberDensity: 0.7, FiberCurl: 0.28,
    }),
  },
{
    id: 'source-text-shell-deposition-anchor',
    label: 'Source Text Shell Deposition Anchor',
    summary: 'text を固定して shell script と ink bleed の差を見る比較束です。source-aware shaping の文字面基準です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'shell_script', Source: 'text', MaterialStyle: 'classic', TemporalProfile: 'unravel', TemporalStrength: 0.24, TemporalSpeed: 0.84,
      Count: 9600, RadiusScale: 0.98, BaseSize: 0.78,
      TextMapText: 'VARELSER', TextMapSize: 300, TextMapPadding: 40, TextMapWeight: 700,
      HullOpacity: 0.82, HullFresnel: 0.72, HullJitter: 0.06,
    }),
  },
{
    id: 'source-grid-shell-fog-anchor',
    label: 'Source Grid Shell Fog Anchor',
    summary: 'grid を固定して calcified skin と static smoke の差を見る比較束です。格子拘束の構造基準です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'calcified_skin', Source: 'grid', MaterialStyle: 'halftone', TemporalProfile: 'steady', TemporalStrength: 0.18, TemporalSpeed: 0.72,
      Count: 11200, RadiusScale: 1.02, BaseSize: 0.8,
      HullOpacity: 0.76, HullFresnel: 0.42, HullJitter: 0.04,
    }),
  },
{
    id: 'source-ring-halo-fog-anchor',
    label: 'Source Ring Halo Fog Anchor',
    summary: 'ring を固定して eclipse halo と dust plume の差を見る比較束です。円環・周回基準です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'eclipse_halo', Source: 'ring', MaterialStyle: 'glass', TemporalProfile: 'oscillate', TemporalStrength: 0.26, TemporalSpeed: 0.88,
      Count: 9800, RadiusScale: 1.18, BaseSize: 0.82,
      HullOpacity: 0.8, HullFresnel: 0.82, HullJitter: 0.04,
    }),
  },
{
    id: 'source-plane-fog-deposition-anchor',
    label: 'Source Plane Fog Deposition Anchor',
    summary: 'plane を固定して soot veil と ink bleed の差を見る比較束です。受け皿・台帳面の基準です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'soot_veil', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: 'steady', TemporalStrength: 0.18, TemporalSpeed: 0.7,
      Count: 10800, RadiusScale: 1.0, BaseSize: 0.8,
      FogOpacity: 0.24, FogDensity: 0.46, FogDepth: 0.72, FogScale: 0.88,
    }),
  }
];
