import type { ExpressionAtlasBundle } from './expressionAtlasTypes';
import { layerPatch } from './expressionAtlasCore';

export const EXPRESSION_ATLAS_BUNDLES_BASE_CORE: ExpressionAtlasBundle[] = [
{
    id: 'glass-halo-orbit',
    label: 'Glass Halo Orbit',
    summary: 'ring + halo / orbit + glass を一気に適用。輪光・周回・透明感の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'eclipse_halo', Source: 'ring', MaterialStyle: 'glass', TemporalProfile: 'oscillate', TemporalStrength: 0.24, TemporalSpeed: 0.84,
      Count: 9800, RadiusScale: 1.18, BaseSize: 0.84, SourceSpread: 0.9,
      HullOpacity: 0.68, HullFresnel: 0.82, HullJitter: 0.06,
    }),
  },
{
    id: 'resin-lattice-grid',
    label: 'Resin Lattice Grid',
    summary: 'grid + lattice / shell + resin fossil。構造体・化石皮膜・足場の束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'frost_lattice', Source: 'grid', MaterialStyle: 'classic', TemporalProfile: 'condense', TemporalStrength: 0.28, TemporalSpeed: 0.62,
      Count: 11600, RadiusScale: 1.02, BaseSize: 0.82, SourceSpread: 0.84,
      VoxelOpacity: 0.78, VoxelScale: 1.14, VoxelSnap: 0.84,
    }),
  },
{
    id: 'ash-rune-plane',
    label: 'Ash Rune Plane',
    summary: 'plane + sigil / rune + ash。灰・滲み・刻印平面の束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'sigil_dust', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: 'evaporate', TemporalStrength: 0.32, TemporalSpeed: 0.96,
      Count: 11000, RadiusScale: 1.0, BaseSize: 0.8,
      DepositionOpacity: 0.72, DepositionBands: 6, DepositionErosion: 0.26, DepositionRelief: 0.54,
    }),
  },
{
    id: 'ion-prism-video',
    label: 'Ion Prism Video',
    summary: 'video + prism smoke / charge veil + ion。時間変化入力を高発光で使う束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'prism_smoke', Source: 'video', MaterialStyle: 'hologram', TemporalProfile: 'ignite', TemporalStrength: 0.36, TemporalSpeed: 1.08,
      Count: 9200, RadiusScale: 1.02, BaseSize: 0.82,
      FogOpacity: 0.28, FogDensity: 0.34, FogDepth: 0.82, FogGlow: 0.34, FogAnisotropy: 0.58,
      MediaThreshold: 0.36, MediaDepth: 1.24, MediaFrameRate: 24,
    }),
  },
{
    id: 'script-text-hologram',
    label: 'Script Text Hologram',
    summary: 'text + shell script / glyph + hologram。文字起点の発光記号束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'shell_script', Source: 'text', MaterialStyle: 'hologram', TemporalProfile: 'unravel', TemporalStrength: 0.24, TemporalSpeed: 0.86,
      Count: 9400, RadiusScale: 0.96, BaseSize: 0.76,
      TextMapText: 'VARELSER', TextMapSize: 280, TextMapPadding: 48, TextMapWeight: 700,
      PatchOpacity: 0.76, PatchFresnel: 0.62, PatchResolution: 48,
    }),
  },
{
    id: 'image-relief-fossil',
    label: 'Image Relief Fossil',
    summary: 'image + deposition / fossil。画像由来の地層・レリーフ束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'deposition_field', Source: 'image', MaterialStyle: 'classic', TemporalProfile: 'accrete', TemporalStrength: 0.28, TemporalSpeed: 0.72,
      Count: 10800, RadiusScale: 1.0, BaseSize: 0.8,
      MediaThreshold: 0.42, MediaDepth: 1.18, MediaInvert: false,
      DepositionOpacity: 0.82, DepositionRelief: 0.62, DepositionErosion: 0.14, DepositionBands: 5,
    }),
  },
{
    id: 'cylinder-braid-spectral',
    label: 'Cylinder Braid Spectral',
    summary: 'cylinder + braid / spectral mesh。編み・信号・スペクトル糸束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'spectral_mesh', Source: 'cylinder', MaterialStyle: 'chrome', TemporalProfile: 'resonate', TemporalStrength: 0.3, TemporalSpeed: 0.88,
      Count: 10400, RadiusScale: 1.12, BaseSize: 0.76,
      FiberOpacity: 0.78, FiberLength: 1.08, FiberDensity: 0.66, FiberCurl: 0.3,
    }),
  },
{
    id: 'sphere-crystal-bloom',
    label: 'Sphere Crystal Bloom',
    summary: 'sphere + crystal / bloom。結晶花・凝集塊の束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'crystal_aggregate', Source: 'sphere', MaterialStyle: 'chrome', TemporalProfile: 'crystallize', TemporalStrength: 0.32, TemporalSpeed: 0.7,
      Count: 11200, RadiusScale: 1.18, BaseSize: 0.9,
      CrystalOpacity: 0.82, CrystalScale: 1.24, CrystalDensity: 0.56, CrystalSpread: 0.24,
    }),
  },
{
    id: 'video-mirage-smoke',
    label: 'Video Mirage Smoke',
    summary: 'video + mirage smoke。蜃気楼・映像揺らぎ・蒸散束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'mirage_smoke', Source: 'video', MaterialStyle: 'hologram', TemporalProfile: 'evaporate', TemporalStrength: 0.3, TemporalSpeed: 1.0,
      Count: 8800, RadiusScale: 1.0, BaseSize: 0.84,
      FogOpacity: 0.24, FogDensity: 0.28, FogDepth: 0.76, FogGlow: 0.18, FogAnisotropy: 0.52,
      MediaThreshold: 0.34, MediaDepth: 1.2, MediaFrameRate: 24,
    }),
  },
{
    id: 'grid-shell-script',
    label: 'Grid Shell Script',
    summary: 'grid + shell script。構造体の記号皮膜束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'shell_script', Source: 'grid', MaterialStyle: 'classic', TemporalProfile: 'unravel', TemporalStrength: 0.22, TemporalSpeed: 0.82,
      Count: 11800, RadiusScale: 1.0, BaseSize: 0.8,
      PatchOpacity: 0.78, PatchResolution: 54, PatchRelax: 0.3, PatchFresnel: 0.48,
    }),
  },
{
    id: 'ring-thread-halo',
    label: 'Ring Thread Halo',
    summary: 'ring + aurora thread / halo。輪光と糸束の複合束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'aurora_threads', Source: 'ring', MaterialStyle: 'hologram', TemporalProfile: 'resonate', TemporalStrength: 0.28, TemporalSpeed: 0.92,
      Count: 9800, RadiusScale: 1.16, BaseSize: 0.8,
      FiberOpacity: 0.8, FiberLength: 1.04, FiberDensity: 0.6, FiberCurl: 0.34,
    }),
  },
{
    id: 'plane-velvet-manuscript',
    label: 'Plane Velvet Manuscript',
    summary: 'plane + velvet ash / manuscript。平面灰膜・擦れ・記述束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'velvet_ash', Source: 'plane', MaterialStyle: 'halftone', TemporalProfile: 'shed', TemporalStrength: 0.3, TemporalSpeed: 0.88,
      Count: 11400, RadiusScale: 1.02, BaseSize: 0.82,
      FogOpacity: 0.3, FogDensity: 0.36, FogDepth: 0.74, FogGlow: 0.06,
    }),
  },
{
    id: 'fracture-bloom-orbit',
    label: 'Fracture Bloom Orbit',
    summary: 'ring + fracture bloom / orbit fracture。周回破断と鉱物開花の基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'fracture_bloom', Source: 'ring', MaterialStyle: 'chrome', TemporalProfile: 'rupture', TemporalStrength: 0.34, TemporalSpeed: 0.92,
      Count: 10800, RadiusScale: 1.14, BaseSize: 0.86,
      CrystalOpacity: 0.84, CrystalScale: 1.12, CrystalDensity: 0.62, CrystalSpread: 0.32,
    }),
  },
{
    id: 'surge-lattice-grid',
    label: 'Surge Lattice Grid',
    summary: 'grid + lattice surge / frost lattice。充電格子・氷結足場・波打つ構造束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'lattice_surge', Source: 'grid', MaterialStyle: 'chrome', TemporalProfile: 'oscillate', TemporalStrength: 0.32, TemporalSpeed: 0.88,
      Count: 12000, RadiusScale: 1.08, BaseSize: 0.8,
      VoxelOpacity: 0.82, VoxelScale: 1.18, VoxelSnap: 0.78,
    }),
  },
{
    id: 'contour-codex-plate',
    label: 'Contour Codex Plate',
    summary: 'text + contour echo / codex。等高線・版面・記述面を一体化する束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'contour_echo', Source: 'text', MaterialStyle: 'chrome', TemporalProfile: 'resonate', TemporalStrength: 0.28, TemporalSpeed: 0.82,
      Count: 10400, RadiusScale: 1.04, BaseSize: 0.82,
      TextMapText: '慈愛体系', TextMapSize: 300, TextMapPadding: 42, TextMapWeight: 700,
      PatchOpacity: 0.8, PatchFresnel: 0.66, PatchResolution: 58, PatchRelax: 0.18,
    }),
  },
{
    id: 'ink-glyph-palimpsest',
    label: 'Ink Glyph Palimpsest',
    summary: 'text + ink bleed / glyph dust。滲み・削れ・残響文字面の束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'ink_bleed', Source: 'text', MaterialStyle: 'halftone', TemporalProfile: 'accrete', TemporalStrength: 0.3, TemporalSpeed: 0.9,
      Count: 11200, RadiusScale: 1.0, BaseSize: 0.78,
      TextMapText: 'VARELSER', TextMapSize: 280, TextMapPadding: 40, TextMapWeight: 700,
      DepositionOpacity: 0.76, DepositionRelief: 0.48, DepositionErosion: 0.36, DepositionBands: 7,
    }),
  },
{
    id: 'text-outline-codex',
    label: 'Text Outline Codex',
    summary: 'text + contour echo / outline codex。輪郭線・版面・接続線を一体化する束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'contour_echo', Source: 'text', MaterialStyle: 'chrome', TemporalProfile: 'resonate', TemporalStrength: 0.26, TemporalSpeed: 0.84,
      Count: 10200, RadiusScale: 1.02, BaseSize: 0.8,
      TextMapText: '慈愛体系', TextMapSize: 312, TextMapPadding: 36, TextMapWeight: 700,
      PatchOpacity: 0.8, PatchFresnel: 0.68, PatchResolution: 60, PatchRelax: 0.18,
      GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.76, GlyphOutlineOpacity: 0.68, GlyphOutlineDepthBias: 0.06,
      ConnectionEnabled: true, ConnectionStyle: 'brush', ConnectionWidth: 1.18, ConnectionOpacity: 0.22, ConnectionSoftness: 0.74,
    }),
  },
{
    id: 'text-glyph-weave-ledger',
    label: 'Text Glyph Weave Ledger',
    summary: 'text + glyph weave / ledger。文字輪郭・織り・符号線を束ねる基準束です。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Type: 'glyph_weave', Source: 'text', MaterialStyle: 'hologram', TemporalProfile: 'oscillate', TemporalStrength: 0.28, TemporalSpeed: 0.9,
      Count: 9800, RadiusScale: 0.98, BaseSize: 0.78,
      TextMapText: 'VARELSER', TextMapSize: 286, TextMapPadding: 40, TextMapWeight: 700,
      FiberOpacity: 0.82, FiberLength: 1.08, FiberDensity: 0.68, FiberCurl: 0.24,
      GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.54, GlyphOutlineOpacity: 0.6, GlyphOutlineDepthBias: 0.04,
      ConnectionEnabled: true, ConnectionStyle: 'filament', ConnectionWidth: 0.94, ConnectionOpacity: 0.2, ConnectionSoftness: 0.58,
    }),
  }
];
