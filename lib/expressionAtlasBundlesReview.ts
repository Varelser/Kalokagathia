import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { layerPatch } from './expressionAtlasCore';

export const EXPRESSION_ATLAS_BUNDLES_REVIEW: ExpressionAtlasBundle[] = [
  {
    id: 'review-text-shell-ink-anchor',
    label: 'Review Text Shell Ink Anchor',
    summary: 'text 固定で shell script / ink bleed / rune smoke の差を横並び確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'shell_script' : 'ink_bleed', Source: 'text', MaterialStyle: layerIndex === 2 ? 'classic' : 'halftone', TemporalProfile: layerIndex === 2 ? 'unravel' : 'accrete', TemporalStrength: 0.26, TemporalSpeed: 0.88,
      Count: layerIndex === 2 ? 9800 : 10200, RadiusScale: 1.0, BaseSize: 0.78,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系', TextMapSize: 288, TextMapPadding: 42, TextMapWeight: 700,
      HullOpacity: 0.82, HullFresnel: 0.74, HullPointBudget: 1320,
      DepositionOpacity: 0.8, DepositionRelief: 0.6, DepositionErosion: 0.3, DepositionBands: 5,
    }),
  },
  {
    id: 'review-grid-calcified-static-anchor',
    label: 'Review Grid Calcified Static Anchor',
    summary: 'grid 固定で calcified skin / static smoke / static lace の差を横並び確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'calcified_skin' : 'static_smoke', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'hologram', TemporalProfile: layerIndex === 2 ? 'steady' : 'oscillate', TemporalStrength: 0.22, TemporalSpeed: 0.84,
      Count: 10400, RadiusScale: 1.02, BaseSize: 0.8,
      HullOpacity: 0.76, HullFresnel: 0.46, HullJitter: 0.04,
      FogOpacity: 0.24, FogDensity: 0.46, FogDepth: 0.72, FogScale: 0.9,
    }),
  },
  {
    id: 'review-ring-eclipse-spectral-anchor',
    label: 'Review Ring Eclipse Spectral Anchor',
    summary: 'ring 固定で eclipse halo / spectral mesh / dust plume の差を横並び確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'eclipse_halo' : 'spectral_mesh', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: layerIndex === 2 ? 'oscillate' : 'resonate', TemporalStrength: 0.28, TemporalSpeed: 0.9,
      Count: layerIndex === 2 ? 9800 : 10400, RadiusScale: 1.14, BaseSize: 0.8,
      HullOpacity: 0.82, HullFresnel: 0.8, HullJitter: 0.04,
      FiberOpacity: 0.8, FiberLength: 1.12, FiberDensity: 0.72, FiberCurl: 0.28,
    }),
  },
  {
    id: 'review-plane-soot-ink-anchor',
    label: 'Review Plane Soot Ink Anchor',
    summary: 'plane 固定で soot veil / velvet ash / ink bleed の差を横並び確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'soot_veil' : 'ink_bleed', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: layerIndex === 2 ? 'steady' : 'accrete', TemporalStrength: 0.22, TemporalSpeed: 0.76,
      Count: layerIndex === 2 ? 10400 : 10000, RadiusScale: 1.0, BaseSize: 0.8,
      FogOpacity: 0.24, FogDensity: 0.48, FogDepth: 0.72, FogScale: 0.88,
      DepositionOpacity: 0.82, DepositionRelief: 0.58, DepositionErosion: 0.28, DepositionBands: 4,
    }),
  },

  {
    id: 'review-text-local-residual-anchor',
    label: 'Review Text Local Residual Anchor',
    summary: 'text 固定で shell script / drift glyph dust の残留衝突を局所確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'shell_script' : 'drift_glyph_dust', Source: 'text', MaterialStyle: layerIndex === 2 ? 'classic' : 'halftone', TemporalProfile: layerIndex === 2 ? 'unravel' : 'accrete', TemporalStrength: 0.28, TemporalSpeed: 0.9,
      Count: layerIndex === 2 ? 9600 : 10100, RadiusScale: 0.98, BaseSize: 0.76,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系', TextMapSize: 304, TextMapPadding: 38, TextMapWeight: 700,
      HullOpacity: 0.84, HullFresnel: 0.78, HullPointBudget: 1380,
      DepositionOpacity: 0.76, DepositionRelief: 0.46, DepositionErosion: 0.34, DepositionBands: 5,
    }),
  },
  {
    id: 'review-grid-local-residual-anchor',
    label: 'Review Grid Local Residual Anchor',
    summary: 'grid 固定で calcified skin / static lace の残留衝突を局所確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'calcified_skin' : 'static_lace', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'hologram', TemporalProfile: layerIndex === 2 ? 'steady' : 'oscillate', TemporalStrength: 0.24, TemporalSpeed: 0.82,
      Count: 10200, RadiusScale: 1.02, BaseSize: 0.78,
      HullOpacity: 0.8, HullFresnel: 0.5, HullJitter: 0.05,
      LineVelocityGlow: 0.72, LineVelocityAlpha: 0.32, LineBurstPulse: 0.28, LineShimmer: 0.3, LineFlickerSpeed: 1.58,
      FiberOpacity: 0.74, FiberLength: 0.92, FiberDensity: 0.72, FiberCurl: 0.16,
    }),
  },
  {
    id: 'review-text-glyph-density-anchor',
    label: 'Review Text Glyph Density Anchor',
    summary: 'text 固定で glyph weave / shell script / contour echo の 2D 系差を見本密度込みで確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'glyph_weave' : 'contour_echo', Source: 'text', MaterialStyle: layerIndex === 2 ? 'hologram' : 'chrome', TemporalProfile: layerIndex === 2 ? 'oscillate' : 'resonate', TemporalStrength: 0.28, TemporalSpeed: 0.88,
      Count: layerIndex === 2 ? 10200 : 9800, RadiusScale: 0.98, BaseSize: 0.78,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系', TextMapSize: 308, TextMapPadding: 36, TextMapWeight: 700,
      FiberOpacity: 0.8, FiberLength: 0.92, FiberDensity: 0.74, FiberCurl: 0.2,
      PatchResolution: 58, PatchRelax: 0.18, PatchFresnel: 0.68,
      GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.46, GlyphOutlineOpacity: 0.56,
    }),
  },
  {
    id: 'review-grid-stipple-density-anchor',
    label: 'Review Grid Stipple Density Anchor',
    summary: 'grid 固定で stipple field / static lace / calcified skin の 2D 系差を見本密度込みで確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'stipple_field' : 'static_lace', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'hologram', TemporalProfile: layerIndex === 2 ? 'accrete' : 'oscillate', TemporalStrength: 0.24, TemporalSpeed: 0.82,
      Count: 10200, RadiusScale: 1.0, BaseSize: 0.78,
      DepositionOpacity: 0.82, DepositionRelief: 0.52, DepositionErosion: 0.28, DepositionBands: 7,
      LineVelocityGlow: 0.66, LineVelocityAlpha: 0.3, LineBurstPulse: 0.22, LineShimmer: 0.28, LineFlickerSpeed: 1.46,
      FiberOpacity: 0.72, FiberLength: 0.9, FiberDensity: 0.7, FiberCurl: 0.14,
    }),
  },
  {
    id: 'review-text-plate-weave-anchor',
    label: 'Review Text Plate Weave Anchor',
    summary: 'text 固定で contour echo / glyph weave / shell script の inscription 差を確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'contour_echo' : 'glyph_weave', Source: 'text', MaterialStyle: layerIndex === 2 ? 'chrome' : 'hologram', TemporalProfile: layerIndex === 2 ? 'resonate' : 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.86,
      Count: layerIndex === 2 ? 9800 : 10200, RadiusScale: 0.98, BaseSize: 0.78,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系', TextMapSize: 304, TextMapPadding: 38, TextMapWeight: 700,
      PatchResolution: 58, PatchRelax: 0.16, PatchFresnel: 0.72,
      GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.52, GlyphOutlineOpacity: 0.58,
      FiberOpacity: 0.78, FiberLength: 0.94, FiberDensity: 0.74, FiberCurl: 0.18,
    }),
  },
  {
    id: 'review-grid-relief-line-anchor',
    label: 'Review Grid Relief Line Anchor',
    summary: 'grid 固定で tremor lattice / static lace の relief と line 差を確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'tremor_lattice' : 'static_lace', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'hologram', TemporalProfile: layerIndex === 2 ? 'oscillate' : 'resonate', TemporalStrength: 0.24, TemporalSpeed: 0.84,
      Count: 10200, RadiusScale: 1.02, BaseSize: 0.78,
      PatchResolution: 56, PatchRelax: 0.18, PatchFresnel: 0.68,
      LineVelocityGlow: 0.7, LineVelocityAlpha: 0.32, LineBurstPulse: 0.24, LineShimmer: 0.3, LineFlickerSpeed: 1.52,
      FiberOpacity: 0.72, FiberLength: 0.92, FiberDensity: 0.72, FiberCurl: 0.14,
    }),
  },
  {
    id: 'review-grid-relief-shell-anchor',
    label: 'Review Grid Relief Shell Anchor',
    summary: 'grid 固定で contour echo / calcified skin の plate と shell 差を確認する review 用アンカー束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'contour_echo' : 'calcified_skin', Source: 'grid', MaterialStyle: layerIndex === 2 ? 'halftone' : 'chrome', TemporalProfile: layerIndex === 2 ? 'resonate' : 'steady', TemporalStrength: 0.24, TemporalSpeed: 0.8,
      Count: layerIndex === 2 ? 10000 : 9800, RadiusScale: 1.0, BaseSize: 0.78,
      PatchResolution: 58, PatchRelax: 0.16, PatchFresnel: 0.7,
      HullOpacity: 0.78, HullFresnel: 0.52, HullJitter: 0.05,
    }),
  },
];
