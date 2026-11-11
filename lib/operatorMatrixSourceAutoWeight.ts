import type { Layer3Source } from '../types';
import type { TemporalProfile } from './temporalProfiles';
import type {
  LayerSuffixPatch,
  OperatorGeometryAxis,
  OperatorInscriptionAxis,
} from './operatorMatrixTypes';

export type OperatorSourceAutoWeight = {
  countMultiplier: number;
  baseSizeMultiplier: number;
  radiusScaleMultiplier: number;
  temporalStrength: number;
  suffixPatch: LayerSuffixPatch;
  reviewTags: string[];
  labelToken: string;
};

/** Sources that have an auto-weight entry below (a subset of Layer3Source). */
export type AutoWeightedSource = 'text' | 'grid' | 'plane' | 'ring' | 'image' | 'video' | 'sphere' | 'cylinder' | 'cube';

const SOURCE_LABEL_TOKENS: Record<AutoWeightedSource, string> = {
  text: 'Text',
  grid: 'Grid',
  plane: 'Plane',
  ring: 'Ring',
  image: 'Image',
  video: 'Video',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  cube: 'Cube',
};

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function roundTo(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sourcePreferredInscription(source: Layer3Source, current: OperatorInscriptionAxis): OperatorInscriptionAxis {
  switch (source) {
    case 'text':
      return current === 'plain' ? 'glyph' : current;
    case 'grid':
      return current === 'plain' ? 'ledger' : current === 'glyph' ? 'ledger' : current;
    case 'ring':
      return current === 'plain' ? 'rune' : current === 'ledger' ? 'contour' : current;
    case 'plane':
      return current === 'plain' ? 'ledger' : current;
    case 'image':
      return current === 'plain' ? 'palimpsest' : current;
    case 'video':
      return current === 'plain' ? 'rune' : current;
    case 'sphere':
      return current === 'plain' ? 'contour' : current;
    case 'cylinder':
      return current === 'plain' ? 'glyph' : current;
    case 'cube':
      return current === 'plain' ? 'ledger' : current;
    default:
      return current;
  }
}

export function sourcePreferredTemporal(source: Layer3Source, current: TemporalProfile): TemporalProfile {
  switch (source) {
    case 'text':
      return current === 'steady' ? 'rewrite' : current;
    case 'grid':
      return current === 'steady' ? 'hysteresis' : current;
    case 'ring':
      return current === 'steady' ? 'oscillate' : current;
    case 'plane':
      return current === 'steady' ? 'accrete' : current;
    case 'image':
      return current === 'steady' ? 'recur' : current;
    case 'video':
      return current === 'steady' ? 'intermittent' : current;
    case 'sphere':
      return current === 'steady' ? 'inhale' : current;
    case 'cylinder':
      return current === 'steady' ? 'resonate' : current;
    case 'cube':
      return current === 'steady' ? 'ossify' : current;
    default:
      return current;
  }
}

export function sourceAutoWeight(
  source: Layer3Source,
  geometry: OperatorGeometryAxis,
  inscription: OperatorInscriptionAxis,
): OperatorSourceAutoWeight {
  const inscriptionAware = inscription === 'glyph' || inscription === 'ledger' || inscription === 'rune' || inscription === 'palimpsest';
  switch (source) {
    case 'text':
      return {
        countMultiplier: geometry === 'mesh' ? 0.92 : 0.9,
        baseSizeMultiplier: 0.94,
        radiusScaleMultiplier: 0.98,
        temporalStrength: 0.29,
        suffixPatch: {
          TextMapSize: 300,
          TextMapPadding: 34,
          GlyphOutlineEnabled: inscriptionAware,
          GlyphOutlineOpacity: inscriptionAware ? 0.6 : 0.42,
          PatchResolution: 54,
          DepositionBands: 8,
        },
        reviewTags: ['source-text', 'inscribed'],
        labelToken: SOURCE_LABEL_TOKENS.text,
      };
    case 'grid':
      return {
        countMultiplier: 1.06,
        baseSizeMultiplier: 0.92,
        radiusScaleMultiplier: 1.02,
        temporalStrength: 0.27,
        suffixPatch: {
          DepositionBands: 9,
          PatchResolution: 56,
          VoxelSnap: 0.56,
          FogSlices: 24,
          FiberDensity: 0.78,
        },
        reviewTags: ['source-grid', 'architectonic'],
        labelToken: SOURCE_LABEL_TOKENS.grid,
      };
    case 'ring':
      return {
        countMultiplier: 0.94,
        baseSizeMultiplier: 1.05,
        radiusScaleMultiplier: 1.14,
        temporalStrength: 0.31,
        suffixPatch: {
          HullFresnel: 0.88,
          FogAnisotropy: 0.48,
          FogGlow: 0.2,
          PatchFresnel: 0.64,
          RadiusScale: 1.1,
        },
        reviewTags: ['source-ring', 'orbit'],
        labelToken: SOURCE_LABEL_TOKENS.ring,
      };
    case 'plane':
      return {
        countMultiplier: 1.08,
        baseSizeMultiplier: 0.9,
        radiusScaleMultiplier: 0.98,
        temporalStrength: 0.25,
        suffixPatch: {
          PatchOpacity: 0.82,
          DepositionOpacity: 0.84,
          DepositionBands: 8,
          SheetOpacity: 0.76,
          FogDepth: 0.76,
        },
        reviewTags: ['source-plane', 'ledger-plane'],
        labelToken: SOURCE_LABEL_TOKENS.plane,
      };
    case 'image':
      return {
        countMultiplier: 0.95,
        baseSizeMultiplier: 1.04,
        radiusScaleMultiplier: 1.04,
        temporalStrength: 0.26,
        suffixPatch: {
          BrushJitter: 0.16,
          BrushScale: 1.06,
          DepositionOpacity: 0.8,
          DepositionErosion: 0.24,
          FogGlow: 0.16,
        },
        reviewTags: ['source-image', 'palimpsest-image'],
        labelToken: SOURCE_LABEL_TOKENS.image,
      };
    case 'video':
      return {
        countMultiplier: 0.9,
        baseSizeMultiplier: 1.02,
        radiusScaleMultiplier: 1.02,
        temporalStrength: 0.34,
        suffixPatch: {
          FogDrift: 0.38,
          BrushJitter: 0.18,
          BrushLayers: 6,
          FiberCurl: 0.26,
          GlyphOutlineOpacity: 0.56,
        },
        reviewTags: ['source-video', 'volatile'],
        labelToken: SOURCE_LABEL_TOKENS.video,
      };
    case 'sphere':
      return {
        countMultiplier: 0.92,
        baseSizeMultiplier: 1.06,
        radiusScaleMultiplier: 1.16,
        temporalStrength: 0.28,
        suffixPatch: {
          HullOpacity: 0.78,
          HullFresnel: 0.9,
          FogDepth: 0.86,
          CrystalScale: 0.94,
        },
        reviewTags: ['source-sphere', 'volumetric'],
        labelToken: SOURCE_LABEL_TOKENS.sphere,
      };
    case 'cylinder':
      return {
        countMultiplier: 1.02,
        baseSizeMultiplier: 0.9,
        radiusScaleMultiplier: 1.06,
        temporalStrength: 0.29,
        suffixPatch: {
          FiberLength: 1.12,
          FiberDensity: 0.78,
          VoxelScale: 1.06,
          SheetFresnel: 0.74,
        },
        reviewTags: ['source-cylinder', 'axial'],
        labelToken: SOURCE_LABEL_TOKENS.cylinder,
      };
    case 'cube':
      return {
        countMultiplier: 1.05,
        baseSizeMultiplier: 0.94,
        radiusScaleMultiplier: 1.02,
        temporalStrength: 0.27,
        suffixPatch: {
          VoxelSnap: 0.6,
          CrystalSpread: 0.18,
          PatchResolution: 52,
          HullPointBudget: 1700,
        },
        reviewTags: ['source-cube', 'packed'],
        labelToken: SOURCE_LABEL_TOKENS.cube,
      };
  }
  // Unreachable for the sources autoVariantSourcesForGeometry hands
  // out; previously this fell through to undefined and the callers
  // crashed dereferencing the result. Fail with a name instead.
  throw new Error(`sourceAutoWeight: no auto-weight defined for source "${source}"`);
}

export function autoVariantSourcesForGeometry(geometry: OperatorGeometryAxis): Layer3Source[] {
  switch (geometry) {
    case 'plate':
      return ['text', 'grid', 'image', 'plane'];
    case 'sheet':
      return ['plane', 'image', 'video', 'text'];
    case 'fog':
      return ['ring', 'plane', 'video', 'sphere'];
    case 'aggregate':
      return ['plane', 'cube', 'sphere'];
    case 'lattice':
      return ['grid', 'cylinder', 'cube'];
    case 'mesh':
      return ['text', 'grid', 'cylinder', 'ring'];
    case 'front':
      return ['text', 'grid', 'plane', 'video'];
    case 'shell':
      return ['ring', 'sphere', 'image', 'plane'];
  }
}
