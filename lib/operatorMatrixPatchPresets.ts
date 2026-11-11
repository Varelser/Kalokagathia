import type { Layer2Type, Layer3Source } from '../types';
import type {
  LayerSuffixPatch,
  OperatorDedicatedAxis,
  OperatorDedicatedSubAxis,
  OperatorDynamicsAxis,
  OperatorGeometryAxis,
  OperatorInscriptionAxis,
  OperatorMaterialAxis,
} from './operatorMatrixTypes';

export function mergeSuffix(...patches: LayerSuffixPatch[]): LayerSuffixPatch {
  const merged: LayerSuffixPatch = {};
  for (const patch of patches) {
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
  }
  return merged;
}

export function materialPatch(material: OperatorMaterialAxis): LayerSuffixPatch {
  switch (material) {
    case 'ink':
      return { MaterialStyle: 'halftone', DepositionOpacity: 0.86, DepositionBands: 7 };
    case 'ash':
      return { MaterialStyle: 'halftone', FogOpacity: 0.28, FogDensity: 0.38, CrystalOpacity: 0.74 };
    case 'resin':
      return { MaterialStyle: 'classic', HullOpacity: 0.78, HullFresnel: 0.72, FogGlow: 0.16, PatchOpacity: 0.82 };
    case 'glass':
      return { MaterialStyle: 'glass', HullOpacity: 0.7, HullFresnel: 0.88, FogGlow: 0.18 };
    case 'crystal':
      return { MaterialStyle: 'chrome', CrystalOpacity: 0.82, CrystalScale: 1.06, VoxelOpacity: 0.8 };
    case 'bio':
      return { MaterialStyle: 'classic', ReactionOpacity: 0.82, SheetOpacity: 0.74, FogDensity: 0.34 };
    case 'metal':
      return { MaterialStyle: 'chrome', HullOpacity: 0.8, VoxelOpacity: 0.82 };
    case 'dust':
      return { MaterialStyle: 'halftone', CrystalOpacity: 0.72, FogOpacity: 0.24, DepositionOpacity: 0.8 };
    case 'vapor':
      return { MaterialStyle: 'glass', FogOpacity: 0.26, FogDensity: 0.32, FogGlow: 0.14 };
  }
}

export function geometryPatch(geometry: OperatorGeometryAxis): LayerSuffixPatch {
  switch (geometry) {
    case 'sheet':
      return { RadiusScale: 1.02, SheetOpacity: 0.72, SheetFresnel: 0.7, BrushLayers: 5 };
    case 'shell':
      return { RadiusScale: 1.1, HullOpacity: 0.74, HullFresnel: 0.84, HullPointBudget: 1600 };
    case 'fog':
      return { FogOpacity: 0.28, FogDensity: 0.36, FogDepth: 0.82, FogSlices: 22, FogAnisotropy: 0.32 };
    case 'aggregate':
      return { CrystalOpacity: 0.78, CrystalScale: 0.88, CrystalDensity: 0.82, CrystalSpread: 0.22 };
    case 'lattice':
      return { VoxelOpacity: 0.8, VoxelScale: 1.1, VoxelDensity: 0.44, VoxelSnap: 0.46 };
    case 'mesh':
      return { FiberOpacity: 0.8, FiberLength: 1.02, FiberDensity: 0.72, FiberCurl: 0.22 };
    case 'front':
      return { ReactionOpacity: 0.8, ReactionFeed: 0.022, ReactionKill: 0.043, ReactionScale: 1.06, ReactionWarp: 0.22 };
    case 'plate':
      return { PatchOpacity: 0.8, PatchFresnel: 0.56, PatchResolution: 48, DepositionRelief: 0.56 };
  }
}

export function dynamicsPatch(dynamics: OperatorDynamicsAxis): LayerSuffixPatch {
  switch (dynamics) {
    case 'capillary':
      return { DepositionRelief: 0.58, DepositionBands: 8, DepositionErosion: 0.14 };
    case 'advection':
      return { BrushOpacity: 0.8, BrushScale: 1.04, BrushJitter: 0.12, BrushLayers: 5 };
    case 'vortex':
      return { FogDrift: 0.34, FogAnisotropy: 0.56, FogGlow: 0.2 };
    case 'pressure':
      return { FogDensity: 0.44, FogDepth: 0.62, FogScale: 0.84, FogDrift: 0.12 };
    case 'avalanche':
      return { CrystalDensity: 0.92, CrystalSpread: 0.34, CrystalScale: 0.82 };
    case 'jam':
      return { CrystalDensity: 1.0, CrystalSpread: 0.14, CrystalScale: 1.02 };
    case 'viscoelastic':
      return { SheetAudioReactive: 0.16, SheetFresnel: 0.78, RadiusScale: 1.1 };
    case 'freeze':
      return { HullFresnel: 0.92, HullJitter: 0.05, RadiusScale: 1.08 };
    case 'melt':
      return { BrushOpacity: 0.82, BrushScale: 1.08, BrushJitter: 0.18, BrushLayers: 5 };
    case 'sublimate':
      return { FogOpacity: 0.24, FogDensity: 0.34, FogDepth: 0.92, FogScale: 1.12 };
    case 'corrode':
      return { ReactionFeed: 0.023, ReactionKill: 0.044, ReactionWarp: 0.24 };
    case 'creep':
      return { VoxelScale: 1.12, VoxelDensity: 0.42, VoxelSnap: 0.34 };
    case 'grammar':
      return { GrowthOpacity: 0.76, GrowthBranches: 6, GrowthLength: 0.9, GrowthSpread: 0.34 };
    case 'growth':
      return { GrowthOpacity: 0.8, GrowthBranches: 8, GrowthLength: 1.02, GrowthSpread: 0.48 };
    case 'static':
      return { FogSlices: 20, FogGlow: 0.08, FogAnisotropy: 0.18, FiberCurl: 0.16 };
    case 'erode':
      return {
        DepositionErosion: 0.42,
        DepositionBands: 7,
        ErosionTrailDensity: 0.66,
        ErosionTrailOpacity: 0.72,
        ErosionTrailLength: 0.96,
        ErosionTrailDrift: 0.46,
        ErosionTrailAudioReactive: 0.12,
      };
    case 'dissolve':
      return {
        DepositionErosion: 0.34,
        DepositionBands: 6,
        DepositionOpacity: 0.78,
        FogOpacity: 0.22,
        FogDensity: 0.28,
        FogGlow: 0.12,
        PatchOpacity: 0.72,
      };
    case 'abrade':
      return {
        HullOpacity: 0.74,
        HullFresnel: 0.68,
        DepositionErosion: 0.22,
        DepositionBands: 5,
        PatchOpacity: 0.74,
        PatchFresnel: 0.52,
      };
    case 'pit':
      return {
        ReactionFeed: 0.024,
        ReactionKill: 0.045,
        ReactionWarp: 0.26,
        DepositionErosion: 0.28,
        DepositionBands: 6,
        HullFresnel: 0.76,
      };
  }
}

export function inscriptionPatch(inscription: OperatorInscriptionAxis, source: Layer3Source, label: string): LayerSuffixPatch {
  const textSeed = label.replace(/[^A-Z0-9]+/gi, ' ').trim().slice(0, 14).toUpperCase() || 'ATLAS';
  switch (inscription) {
    case 'plain':
      return {};
    case 'glyph':
      return {
        TextMapText: source === 'text' ? textSeed : 'GLYPH', TextMapSize: 280, TextMapPadding: 42, TextMapWeight: 700,
        GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.42, GlyphOutlineOpacity: 0.52,
      };
    case 'ledger':
      return {
        TextMapText: source === 'text' ? textSeed : 'LEDGER', TextMapSize: 288, TextMapPadding: 42, TextMapWeight: 700,
        DepositionBands: 8, DepositionOpacity: 0.84,
      };
    case 'rune':
      return {
        TextMapText: source === 'text' ? textSeed : 'RUNE', TextMapSize: 286, TextMapPadding: 44, TextMapWeight: 700,
        GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.56, GlyphOutlineOpacity: 0.58, FogGlow: 0.18,
      };
    case 'contour':
      return { PatchOpacity: 0.82, PatchResolution: 52, PatchFresnel: 0.62 };
    case 'palimpsest':
      return {
        TextMapText: source === 'text' ? textSeed : 'TRACE', TextMapSize: 292, TextMapPadding: 40, TextMapWeight: 700,
        DepositionErosion: 0.24, DepositionBands: 7, GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.26, GlyphOutlineOpacity: 0.44,
      };
  }
}

export function inferDedicatedAxis(
  source: Layer3Source,
  dynamics: OperatorDynamicsAxis,
  inscription: OperatorInscriptionAxis,
  mode: Layer2Type,
): OperatorDedicatedAxis | undefined {
  if (dynamics === 'erode' || dynamics === 'dissolve' || dynamics === 'abrade' || dynamics === 'pit' || mode === 'erosion_trail' || mode === 'seep_fracture' || mode === 'residue_skin' || mode === 'calcified_skin' || mode === 'corrosion_front') {
    return 'erosion-wear';
  }
  if (dynamics === 'freeze' || dynamics === 'melt' || dynamics === 'sublimate' || mode === 'freeze_skin' || mode === 'melt_front' || mode === 'condense_field' || mode === 'evaporative_sheet' || mode === 'sublimate_cloud') {
    return 'phase-transition';
  }
  if (source === 'text' || inscription === 'glyph' || inscription === 'ledger' || inscription === 'rune' || mode === 'glyph_weave' || mode === 'shell_script' || mode === 'drift_glyph_dust') {
    return 'text-inscription';
  }
  if (source === 'grid' || mode === 'stipple_field' || mode === 'static_smoke' || mode === 'pressure_cells' || mode === 'creep_lattice') {
    return 'grid-architectonic';
  }
  if (source === 'ring' || mode === 'eclipse_halo' || mode === 'vortex_transport') {
    return 'ring-orbit';
  }
  if (source === 'plane' || mode === 'ink_bleed' || mode === 'percolation_sheet' || mode === 'soot_veil' || mode === 'velvet_ash') {
    return 'plane-ledger';
  }
  return undefined;
}

export function inferDedicatedSubAxis(
  source: Layer3Source,
  dynamics: OperatorDynamicsAxis,
  inscription: OperatorInscriptionAxis,
  mode: Layer2Type,
  dedicatedAxis: OperatorDedicatedAxis | undefined,
): OperatorDedicatedSubAxis | undefined {
  if (dedicatedAxis === 'erosion-wear') {
    if (dynamics === 'erode' || dynamics === 'dissolve' || mode === 'erosion_trail' || mode === 'seep_fracture' || mode === 'corrosion_front') return 'erosion-cut';
    if (dynamics === 'abrade' || dynamics === 'pit' || mode === 'residue_skin' || mode === 'calcified_skin') return 'wear-pitted';
  }
  if (dedicatedAxis === 'phase-transition') {
    if (dynamics === 'freeze' || dynamics === 'sublimate' || mode === 'freeze_skin' || mode === 'sublimate_cloud') return 'phase-freeze';
    if (dynamics === 'melt' || dynamics === 'pressure' || mode === 'melt_front' || mode === 'condense_field' || mode === 'evaporative_sheet' || mode === 'resin_shell') return 'phase-melt';
  }
  if (dedicatedAxis === 'text-inscription') {
    if (inscription === 'glyph' || inscription === 'rune' || mode === 'glyph_weave' || mode === 'growth_grammar' || mode === 'drift_glyph_dust') return 'text-glyphic';
    if (inscription === 'ledger' || inscription === 'palimpsest' || mode === 'shell_script' || mode === 'ink_bleed' || source === 'text') return 'text-ledger';
  }
  if (dedicatedAxis === 'grid-architectonic') {
    if (mode === 'creep_lattice' || mode === 'elastic_lattice' || mode === 'fracture_grammar' || dynamics === 'creep' || source === 'cylinder' || inscription === 'contour') return 'grid-lattice';
    if (mode === 'static_smoke' || mode === 'stipple_field' || mode === 'pressure_cells' || dynamics === 'static' || dynamics === 'pressure' || source === 'grid') return 'grid-static';
  }
  if (dedicatedAxis === 'ring-orbit') {
    if (mode === 'eclipse_halo' || mode === 'halo_bloom' || mode === 'spore_halo' || source === 'ring' || inscription === 'rune') return 'ring-halo';
    if (mode === 'vortex_transport' || mode === 'prism_threads' || dynamics === 'vortex' || dynamics === 'advection') return 'ring-vortex';
  }
  if (dedicatedAxis === 'plane-ledger') {
    if (mode === 'ink_bleed' || mode === 'percolation_sheet' || inscription === 'ledger' || dynamics === 'capillary' || dynamics === 'growth') return 'plane-ink';
    if (mode === 'soot_veil' || mode === 'velvet_ash' || mode === 'biofilm_skin' || dynamics === 'static' || dynamics === 'pressure' || inscription === 'palimpsest') return 'plane-soot';
  }
  return undefined;
}

export function dedicatedAxisPatch(axis: OperatorDedicatedAxis | undefined): LayerSuffixPatch {
  switch (axis) {
    case 'text-inscription':
      return {
        TextMapSize: 308,
        TextMapPadding: 34,
        TextMapWeight: 720,
        GlyphOutlineEnabled: true,
        GlyphOutlineWidth: 1.68,
        GlyphOutlineOpacity: 0.62,
        DepositionBands: 9,
        PatchResolution: 56,
        FiberDensity: 0.8,
      };
    case 'grid-architectonic':
      return {
        VoxelSnap: 0.62,
        PatchResolution: 58,
        DepositionBands: 9,
        FogSlices: 24,
        HullPointBudget: 1760,
        FiberDensity: 0.8,
      };
    case 'ring-orbit':
      return {
        RadiusScale: 1.14,
        HullFresnel: 0.9,
        FogAnisotropy: 0.54,
        FogGlow: 0.22,
        PatchFresnel: 0.68,
      };
    case 'plane-ledger':
      return {
        PatchOpacity: 0.84,
        DepositionOpacity: 0.86,
        DepositionBands: 9,
        SheetOpacity: 0.78,
        FogDepth: 0.74,
      };
    case 'erosion-wear':
      return {
        ErosionTrailDensity: 0.72,
        ErosionTrailOpacity: 0.78,
        ErosionTrailDrift: 0.5,
        DepositionErosion: 0.42,
        HullFresnel: 0.7,
        PatchFresnel: 0.5,
      };
    case 'phase-transition':
      return {
        FogGlow: 0.2,
        FogDepth: 0.88,
        SheetFresnel: 0.8,
        HullFresnel: 0.9,
        BrushJitter: 0.18,
      };
    default:
      return {};
  }
}

export function dedicatedSubAxisPatch(axis: OperatorDedicatedSubAxis | undefined): LayerSuffixPatch {
  switch (axis) {
    case 'text-glyphic':
      return { TextMapSize: 316, TextMapWeight: 740, GlyphOutlineEnabled: true, GlyphOutlineWidth: 1.82, GlyphOutlineOpacity: 0.68, FiberDensity: 0.84, FiberLength: 1.06 };
    case 'text-ledger':
      return { TextMapPadding: 30, DepositionBands: 10, DepositionOpacity: 0.88, PatchResolution: 58, PatchOpacity: 0.84 };
    case 'grid-lattice':
      return { VoxelSnap: 0.66, VoxelDensity: 0.48, VoxelScale: 1.12, FiberDensity: 0.82, HullPointBudget: 1840 };
    case 'grid-static':
      return { FogSlices: 26, FogAnisotropy: 0.24, FogGlow: 0.12, DepositionBands: 10, PatchResolution: 60 };
    case 'ring-halo':
      return { RadiusScale: 1.16, HullFresnel: 0.94, FogGlow: 0.24, FogDepth: 0.9, PatchFresnel: 0.7 };
    case 'ring-vortex':
      return { FogDrift: 0.42, FogAnisotropy: 0.62, FogGlow: 0.26, FiberLength: 1.08, FiberCurl: 0.28 };
    case 'plane-ink':
      return { PatchOpacity: 0.86, DepositionOpacity: 0.9, DepositionBands: 10, DepositionRelief: 0.62, SheetOpacity: 0.8 };
    case 'plane-soot':
      return { FogOpacity: 0.3, FogDepth: 0.7, FogDensity: 0.4, PatchOpacity: 0.8, DepositionErosion: 0.26 };
    case 'erosion-cut':
      return { ErosionTrailDensity: 0.78, ErosionTrailLength: 1.02, ErosionTrailDrift: 0.56, DepositionErosion: 0.48, ReactionWarp: 0.28 };
    case 'wear-pitted':
      return { HullFresnel: 0.74, PatchFresnel: 0.54, DepositionErosion: 0.32, ReactionFeed: 0.025, ReactionKill: 0.046 };
    case 'phase-freeze':
      return { HullFresnel: 0.94, FogDepth: 0.92, FogGlow: 0.18, SheetFresnel: 0.84, BrushJitter: 0.1 };
    case 'phase-melt':
      return { BrushJitter: 0.22, BrushScale: 1.1, FogOpacity: 0.28, FogGlow: 0.22, PatchOpacity: 0.82 };
    default:
      return {};
  }
}
