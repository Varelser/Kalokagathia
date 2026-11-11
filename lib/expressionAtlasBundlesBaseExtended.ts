import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { layerPatch } from './expressionAtlasCore';

export const EXPRESSION_ATLAS_BUNDLES_BASE_EXTENDED: ExpressionAtlasBundle[] = [
{
    id: 'ring-ribbon-manifold',
    label: 'Ring Ribbon Manifold',
    summary: 'ring + ribbon veil。吊られた幕帯・薄膜層・位相ずれの基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'ribbon_veil', Source: 'ring', MaterialStyle: 'glass', TemporalProfile: 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.86,
      Count: 9800, RadiusScale: 1.14, BaseSize: 0.8,
      BrushOpacity: 0.76, BrushLayers: 7, BrushScale: 0.96, BrushJitter: 0.22,
    }),
  },
{
    id: 'image-liquid-smear-canvas',
    label: 'Image Liquid Smear Canvas',
    summary: 'image + liquid smear。滲み・引きずり・刷毛膜の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'liquid_smear', Source: 'image', MaterialStyle: 'classic', TemporalProfile: 'melt', TemporalStrength: 0.32, TemporalSpeed: 0.9,
      Count: 11000, RadiusScale: 1.0, BaseSize: 0.82,
      BrushOpacity: 0.8, BrushLayers: 6, BrushScale: 0.9, BrushJitter: 0.28,
    }),
  },
{
    id: 'sphere-branch-arbor',
    label: 'Sphere Branch Arbor',
    summary: 'sphere + branch propagation。樹状アーマチュア・増殖線の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'branch_propagation', Source: 'sphere', MaterialStyle: 'classic', TemporalProfile: 'growth', TemporalStrength: 0.3, TemporalSpeed: 0.74,
      Count: 10600, RadiusScale: 1.08, BaseSize: 0.78,
      FiberOpacity: 0.72, FiberLength: 0.96, FiberDensity: 0.66, FiberCurl: 0.26,
    }),
  },
{
    id: 'plane-biofilm-petri',
    label: 'Plane Biofilm Petri',
    summary: 'plane + biofilm skin。培地膜・群体・反応縞の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'biofilm_skin', Source: 'plane', MaterialStyle: 'glass', TemporalProfile: 'accrete', TemporalStrength: 0.28, TemporalSpeed: 0.72,
      Count: 10200, RadiusScale: 1.0, BaseSize: 0.8,
      ReactionOpacity: 0.84, ReactionFeed: 0.034, ReactionKill: 0.056, ReactionScale: 1.06, ReactionWarp: 0.22,
    }),
  },
{
    id: 'halo-bloom-equinox',
    label: 'Halo Bloom Equinox',
    summary: 'ring + halo bloom。圧縮円盤・暗い中心・外周発光の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'halo_bloom', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.92,
      Count: 9800, RadiusScale: 1.12, BaseSize: 0.84,
      HullOpacity: 0.82, HullFresnel: 0.94, HullPointBudget: 1560, HullJitter: 0.1,
    }),
  },
{
    id: 'membrane-pollen-herbarium',
    label: 'Membrane Pollen Herbarium',
    summary: 'image + membrane pollen。孔・花粉ポケット・封入膜の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'membrane_pollen', Source: 'image', MaterialStyle: 'glass', TemporalProfile: 'accrete', TemporalStrength: 0.24, TemporalSpeed: 0.76,
      Count: 10600, RadiusScale: 1.04, BaseSize: 0.8,
      HullOpacity: 0.78, HullFresnel: 0.82, HullPointBudget: 1420, HullJitter: 0.12,
    }),
  },
{
    id: 'spore-halo-reliquary',
    label: 'Spore Halo Reliquary',
    summary: 'sphere + spore halo。胞子環・浮遊粒・外周光の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'spore_halo', Source: 'sphere', MaterialStyle: 'hologram', TemporalProfile: 'shed', TemporalStrength: 0.26, TemporalSpeed: 0.86,
      Count: 10200, RadiusScale: 1.08, BaseSize: 0.82,
      HullOpacity: 0.76, HullFresnel: 0.92, HullPointBudget: 1480, HullJitter: 0.11,
    }),
  },
{
    id: 'sphere-aura-reliquary',
    label: 'Sphere Aura Reliquary',
    summary: 'sphere + aura shell。柔らかな光殻・膨張膜・静かな遺物殻の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'aura_shell', Source: 'sphere', MaterialStyle: 'glass', TemporalProfile: 'oscillate', TemporalStrength: 0.22, TemporalSpeed: 0.72,
      Count: 9600, RadiusScale: 1.1, BaseSize: 0.82,
      HullOpacity: 0.72, HullFresnel: 0.88, HullPointBudget: 1500, HullJitter: 0.08,
    }),
  },
{
    id: 'ring-eclipse-umbra',
    label: 'Ring Eclipse Umbra',
    summary: 'ring + eclipse halo。暗い中心・圧縮円盤・外周輪光の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'eclipse_halo', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: 'oscillate', TemporalStrength: 0.3, TemporalSpeed: 0.88,
      Count: 9900, RadiusScale: 1.14, BaseSize: 0.84,
      HullOpacity: 0.8, HullFresnel: 0.96, HullPointBudget: 1580, HullJitter: 0.08,
    }),
  },
{
    id: 'image-resin-amber',
    label: 'Image Resin Amber',
    summary: 'image + resin shell。琥珀被膜・樹脂流れ・滑らかな封入殻の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'resin_shell', Source: 'image', MaterialStyle: 'glass', TemporalProfile: 'steady', TemporalStrength: 0.18, TemporalSpeed: 0.6,
      Count: 10400, RadiusScale: 1.04, BaseSize: 0.8,
      HullOpacity: 0.84, HullFresnel: 0.76, HullPointBudget: 1440, HullJitter: 0.07,
      MediaThreshold: 0.4, MediaDepth: 1.14, MediaInvert: false,
    }),
  },
{
    id: 'sphere-dust-plume-column',
    label: 'Sphere Dust Plume Column',
    summary: 'sphere + dust plume。上昇する粉塵柱・対流核・鈍い堆積色の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'dust_plume', Source: 'sphere', MaterialStyle: 'halftone', TemporalProfile: 'growth', TemporalStrength: 0.28, TemporalSpeed: 0.82,
      Count: 9800, RadiusScale: 1.08, BaseSize: 0.82,
      FogOpacity: 0.26, FogDensity: 0.38, FogDepth: 0.86, FogScale: 0.98, FogSlices: 16, FogGlow: 0.08, FogAnisotropy: 0.34,
    }),
  },
{
    id: 'plane-ashfall-ledger',
    label: 'Plane Ashfall Ledger',
    summary: 'plane + ashfall。落下灰・帳面状の積層・乾いた沈降感の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'ashfall', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: 'shed', TemporalStrength: 0.3, TemporalSpeed: 0.76,
      Count: 11000, RadiusScale: 1.0, BaseSize: 0.8,
      FogOpacity: 0.24, FogDensity: 0.42, FogDepth: 0.9, FogScale: 1.04, FogSlices: 15, FogGlow: 0.06,
    }),
  },
{
    id: 'video-mirage-heatfield',
    label: 'Video Mirage Heatfield',
    summary: 'video + mirage smoke。揺らぐ熱場・屈折帯・薄い発光の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'mirage_smoke', Source: 'video', MaterialStyle: 'hologram', TemporalProfile: 'evaporate', TemporalStrength: 0.32, TemporalSpeed: 1.04,
      Count: 9200, RadiusScale: 1.02, BaseSize: 0.84,
      FogOpacity: 0.22, FogDensity: 0.26, FogDepth: 0.8, FogScale: 1.18, FogSlices: 21, FogGlow: 0.16, FogAnisotropy: 0.64,
      MediaThreshold: 0.34, MediaDepth: 1.22, MediaFrameRate: 24,
    }),
  },
{
    id: 'grid-static-smoke-slab',
    label: 'Grid Static Smoke Slab',
    summary: 'grid + static smoke。電子的な煙板・走査ノイズ・平板密度の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'static_smoke', Source: 'grid', MaterialStyle: 'hologram', TemporalProfile: 'oscillate', TemporalStrength: 0.26, TemporalSpeed: 0.92,
      Count: 10000, RadiusScale: 0.98, BaseSize: 0.8,
      FogOpacity: 0.28, FogDensity: 0.4, FogDepth: 0.72, FogScale: 0.94, FogSlices: 18, FogGlow: 0.12, FogAnisotropy: 0.2,
    }),
  },
{
    id: 'plane-velvet-ink-manuscript',
    label: 'Plane Velvet Ink Manuscript',
    summary: 'plane + velvet ash / ink bleed。灰の受け皿・吸い込み面・柔らかな煤膜の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'velvet_ash' : 'ink_bleed', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: layerIndex === 2 ? 'shed' : 'accrete', TemporalStrength: layerIndex === 2 ? 0.26 : 0.3, TemporalSpeed: layerIndex === 2 ? 0.82 : 0.9,
      Count: layerIndex === 2 ? 9800 : 10200, RadiusScale: 1.02, BaseSize: 0.82,
      FogOpacity: 0.26, FogDensity: 0.42, FogDepth: 0.78, FogScale: 0.92, FogSlices: 18, FogGlow: 0.06,
      DepositionOpacity: 0.8, DepositionRelief: 0.62, DepositionErosion: 0.3, DepositionBands: 5,
    }),
  },
{
    id: 'text-rune-ledger-smoke',
    label: 'Text Rune Ledger Smoke',
    summary: 'text + rune smoke。記号脈動・帳面状バンド・符号の残響を詰めた基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'rune_smoke' : 'drift_glyph_dust', Source: 'text', MaterialStyle: 'hologram', TemporalProfile: 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.92,
      Count: layerIndex === 2 ? 9400 : 10800, RadiusScale: 1.0, BaseSize: 0.8,
      TextMapText: layerIndex === 2 ? 'VARELSER' : '慈愛体系',
      FogOpacity: 0.28, FogDensity: 0.38, FogDepth: 0.72, FogScale: 0.9, FogSlices: 17, FogGlow: 0.18,
      DepositionOpacity: 0.74, DepositionRelief: 0.54, DepositionErosion: 0.34, DepositionBands: 6,
    }),
  },
{
    id: 'plane-soot-ink-ledger',
    label: 'Plane Soot Ink Ledger',
    summary: 'plane + soot veil / ink bleed。煤の帳面・黒化した紙面・受け皿としての版面を強めた基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: layerIndex === 2 ? 'soot_veil' : 'ink_bleed', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: layerIndex === 2 ? 'steady' : 'accrete', TemporalStrength: 0.22, TemporalSpeed: 0.78,
      Count: layerIndex === 2 ? 10400 : 10000, RadiusScale: 1.0, BaseSize: 0.8,
      FogOpacity: 0.22, FogDensity: 0.48, FogDepth: 0.7, FogScale: 0.88, FogSlices: 16, FogGlow: 0.04,
      DepositionOpacity: 0.82, DepositionRelief: 0.58, DepositionErosion: 0.26, DepositionBands: 4,
    }),
  },
{
    id: 'grid-static-signal-lace',
    label: 'Grid Static Signal Lace',
    summary: 'grid + static lace / signal braid。静電レースと信号編みを同時に立てる束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'static_lace', Source: 'grid', MaterialStyle: 'halftone', TemporalProfile: 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.92,
      Count: 9800, RadiusScale: 1.0, BaseSize: 0.74,
      FiberOpacity: 0.76, FiberLength: 0.72, FiberDensity: 0.68, FiberCurl: 0.18,
    }),
  },
{
    id: 'text-cinder-codex-web',
    label: 'Text Cinder Codex Web',
    summary: 'text + cinder web。焼けた文字残滓と煤けた網目を立てる束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'cinder_web', Source: 'text', MaterialStyle: 'halftone', TemporalProfile: 'shed', TemporalStrength: 0.26, TemporalSpeed: 0.72,
      Count: 9200, RadiusScale: 1.02, BaseSize: 0.76,
      TextMapText: 'VARELSER', TextMapSize: 256, TextMapPadding: 42, TextMapWeight: 700,
      FiberOpacity: 0.74, FiberLength: 0.66, FiberDensity: 0.62, FiberCurl: 0.24,
    }),
  },
{
    id: 'ring-spectral-braid',
    label: 'Ring Spectral Braid',
    summary: 'ring + spectral mesh / signal braid。分光編みと信号輪を合わせる束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'spectral_mesh', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: 'resonate', TemporalStrength: 0.3, TemporalSpeed: 0.9,
      Count: 10400, RadiusScale: 1.08, BaseSize: 0.76,
      FiberOpacity: 0.8, FiberLength: 1.12, FiberDensity: 0.7, FiberCurl: 0.28,
    }),
  }
];
