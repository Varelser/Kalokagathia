import type { ParticleConfig } from "../types";

export type MaterialMoodId =
  | 'glass-cathedral'
  | 'resin-fossil'
  | 'velvet-ash'
  | 'ion-storm'
  | 'chrome-relic'
  | 'hologram-script';

export type MaterialMoodBundle = {
  id: MaterialMoodId;
  label: string;
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

export const MATERIAL_MOOD_BUNDLES: MaterialMoodBundle[] = [
  {
    id: 'glass-cathedral',
    label: 'Glass Cathedral',
    summary: '透明感・輪郭光・静かな高域。shell / fog / crystal 系に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'glass',
      TemporalProfile: 'resonate',
      TemporalStrength: 0.24,
      TemporalSpeed: 0.72,
      SheetOpacity: 0.68,
      SheetFresnel: 0.72,
      HullOpacity: 0.66,
      HullFresnel: 0.76,
      PatchOpacity: 0.72,
      PatchFresnel: 0.58,
      CrystalOpacity: 0.78,
      CrystalScale: 1.18,
      CrystalDepositionOpacity: 0.8,
      VoxelOpacity: 0.68,
      FogOpacity: 0.22,
      FogGlow: 0.24,
      FogAnisotropy: 0.42,
    }),
  },
  {
    id: 'resin-fossil',
    label: 'Resin Fossil',
    summary: '硬い樹脂・化石皮膜・堆積面。shell / lattice / deposition 向きです。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'classic',
      TemporalProfile: 'condense',
      TemporalStrength: 0.28,
      TemporalSpeed: 0.56,
      HullOpacity: 0.82,
      HullJitter: 0.06,
      VoxelOpacity: 0.78,
      VoxelSnap: 0.82,
      DepositionOpacity: 0.82,
      DepositionRelief: 0.62,
      DepositionErosion: 0.14,
      CrystalDepositionOpacity: 0.84,
      CrystalDepositionRelief: 0.58,
      PatchOpacity: 0.8,
      PatchRelax: 0.26,
    }),
  },
  {
    id: 'velvet-ash',
    label: 'Velvet Ash',
    summary: '煤・灰・鈍い拡散。fog / stipple / erosion 系に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'halftone',
      TemporalProfile: 'shed',
      TemporalStrength: 0.32,
      TemporalSpeed: 0.84,
      FogOpacity: 0.32,
      FogDensity: 0.38,
      FogDepth: 0.78,
      FogGlow: 0.08,
      ErosionTrailOpacity: 0.7,
      ErosionTrailLength: 0.94,
      ErosionTrailDrift: 0.36,
      DepositionOpacity: 0.68,
      DepositionErosion: 0.28,
      DepositionBands: 6,
    }),
  },
  {
    id: 'ion-storm',
    label: 'Ion Storm',
    summary: '高発光・帯電・流体的ドリフト。veil / smoke / thread 系に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'hologram',
      TemporalProfile: 'ignite',
      TemporalStrength: 0.34,
      TemporalSpeed: 1.08,
      FogOpacity: 0.28,
      FogGlow: 0.34,
      FogAnisotropy: 0.56,
      BrushOpacity: 0.62,
      BrushJitter: 0.22,
      FiberOpacity: 0.8,
      FiberCurl: 0.46,
      FiberLength: 0.96,
      SheetFresnel: 0.74,
      ReactionWarp: 0.3,
    }),
  },
  {
    id: 'chrome-relic',
    label: 'Chrome Relic',
    summary: '金属感・遺物感・反射寄り。crystal / voxel / shell に向きます。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'chrome',
      TemporalProfile: 'accrete',
      TemporalStrength: 0.26,
      TemporalSpeed: 0.6,
      CrystalOpacity: 0.82,
      CrystalScale: 1.28,
      VoxelOpacity: 0.8,
      VoxelScale: 1.18,
      HullOpacity: 0.78,
      HullFresnel: 0.7,
      CrystalDepositionOpacity: 0.86,
      CrystalDepositionCrystalScale: 1.32,
    }),
  },
  {
    id: 'hologram-script',
    label: 'Hologram Script',
    summary: '記号・文字・輪郭・発光線向き。text / glyph / patch に相性が良いです。',
    patch: (layerIndex) => layerPatch(layerIndex, {
      MaterialStyle: 'hologram',
      TemporalProfile: 'oscillate',
      TemporalStrength: 0.22,
      TemporalSpeed: 0.9,
      PatchOpacity: 0.78,
      PatchFresnel: 0.62,
      BrushOpacity: 0.58,
      BrushLayers: 6,
      DepositionOpacity: 0.72,
      DepositionBands: 5,
      ReactionOpacity: 0.76,
      ReactionWarp: 0.26,
      SheetOpacity: 0.62,
      SheetFresnel: 0.82,
    }),
  },
];
