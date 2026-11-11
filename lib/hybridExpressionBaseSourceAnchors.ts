import type { HybridExpressionRecipe } from './hybridExpressionTypes';

export const HYBRID_EXPRESSION_BASE_SOURCE_ANCHOR_RECIPES: HybridExpressionRecipe[] = [
{
    id: 'source-text-inscribed-body',
    name: 'Source Text Inscribed Body',
    summary: 'Text source を固定し、shell script と ink bleed / rune smoke の差を比較する基準レシピ。',
    layer2Modes: ['shell_script', 'rune_smoke'],
    layer3Modes: ['ink_bleed', 'drift_glyph_dust', 'contour_echo'],
    emphasis: ['text adherence', 'script gate', 'bleed retention'],
  },
{
    id: 'source-grid-architectonic-shell',
    name: 'Source Grid Architectonic Shell',
    summary: 'Grid source を固定し、calcified shell と static fog の構造差を比較する基準レシピ。',
    layer2Modes: ['calcified_skin', 'static_smoke'],
    layer3Modes: ['lattice_surge', 'stipple_field', 'mesh_weave'],
    emphasis: ['grid quantize', 'ledger bands', 'architectonic tension'],
  },
{
    id: 'source-ring-orbit-shell-fog',
    name: 'Source Ring Orbit Shell Fog',
    summary: 'Ring source を固定し、halo shell と fog volume の円環差を比較する基準レシピ。',
    layer2Modes: ['eclipse_halo', 'halo_bloom', 'dust_plume'],
    layer3Modes: ['spectral_mesh', 'mirage_smoke', 'fracture_bloom'],
    emphasis: ['equator bias', 'orbit pull', 'ring pulse'],
  },
{
    id: 'source-plane-ledger-fog',
    name: 'Source Plane Ledger Fog',
    summary: 'Plane source を固定し、soot veil と ink bleed の台帳面差を比較する基準レシピ。',
    layer2Modes: ['soot_veil', 'velvet_ash'],
    layer3Modes: ['ink_bleed', 'deposition_field', 'surface_patch'],
    emphasis: ['plane adherence', 'soot stain', 'ledger band'],
  }
];
