import type { ParticleConfig, Layer3Source } from "../types";

export type SourceFamilyBundle = {
  id: string;
  label: string;
  source: Layer3Source;
  summary: string;
  patch: (layerIndex: 2 | 3) => Partial<ParticleConfig>;
};

type Primitive = string | number | boolean;
const layerPatch = (layerIndex: 2 | 3, values: Record<string, Primitive>): Partial<ParticleConfig> => {
  const prefix = layerIndex === 2 ? 'layer2' : 'layer3';
  const patch: Partial<ParticleConfig> = {};
  for (const [suffix, value] of Object.entries(values)) {
    (patch as Record<string, Primitive>)[`${prefix}${suffix}`] = value;
  }
  return patch;
};

export const SOURCE_FAMILY_BUNDLES: SourceFamilyBundle[] = [
  {
    id: 'sphere-body',
    label: 'Sphere Body',
    source: 'sphere',
    summary: '塊・殻・群れの基準。shell / crystal / fog の起点向け。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'sphere', Count: 11000, RadiusScale: 1.16, BaseSize: 0.94, SourceSpread: 1.0,
    }),
  },
  {
    id: 'ring-orbit',
    label: 'Ring Orbit',
    source: 'ring',
    summary: '軌道・脈動・halo の基準。orbit / pulse / halo 系に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'ring', Count: 9800, RadiusScale: 1.2, BaseSize: 0.86, SourceSpread: 0.92,
    }),
  },
  {
    id: 'grid-architectonic',
    label: 'Grid Architectonic',
    source: 'grid',
    summary: '構造・格子・patch の基準。lattice / patch / shell script に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'grid', Count: 12000, RadiusScale: 1.0, BaseSize: 0.82, SourceSpread: 0.86,
    }),
  },
  {
    id: 'plane-manuscript',
    label: 'Plane Manuscript',
    source: 'plane',
    summary: '堆積・侵食・筆致の基準。deposition / brush / erosion 向きです。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'plane', Count: 11800, RadiusScale: 1.04, BaseSize: 0.8, SourceSpread: 0.84,
    }),
  },
  {
    id: 'text-inscription',
    label: 'Text Inscription',
    source: 'text',
    summary: '記号・文様・輪郭の基準。glyph / script / rune に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'text', Count: 9600, RadiusScale: 0.98, BaseSize: 0.78, SourceSpread: 0.82,
      TextMapText: 'VARELSER', TextMapSize: 280, TextMapPadding: 48, TextMapWeight: 700,
    }),
  },
  {
    id: 'image-relief',
    label: 'Image Relief',
    source: 'image',
    summary: '画素由来の地形・堆積・滲みの基準。deposition / patch / bleed 向きです。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'image', Count: 10800, RadiusScale: 1.0, BaseSize: 0.8, SourceSpread: 0.8,
      MediaThreshold: 0.42, MediaDepth: 1.18, MediaInvert: false,
    }),
  },
  {
    id: 'video-plume',
    label: 'Video Plume',
    source: 'video',
    summary: '時間変化入力の基準。fog / smoke / drift / halo に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'video', Count: 9000, RadiusScale: 1.02, BaseSize: 0.82, SourceSpread: 0.88,
      MediaThreshold: 0.36, MediaDepth: 1.26, MediaFrameRate: 24,
    }),
  },
  {
    id: 'cylinder-thread',
    label: 'Cylinder Thread',
    source: 'cylinder',
    summary: '繊維・編み・thread の基準。fiber / braid / spectral mesh に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      Source: 'cylinder', Count: 10400, RadiusScale: 1.12, BaseSize: 0.76, SourceSpread: 0.9,
    }),
  },
];
