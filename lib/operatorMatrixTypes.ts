import type { Layer2Type, Layer3Source, ParticleConfig } from '../types';
import type { TemporalProfile } from './temporalProfiles';

export type OperatorMaterialAxis =
  | 'ink'
  | 'ash'
  | 'resin'
  | 'glass'
  | 'crystal'
  | 'bio'
  | 'metal'
  | 'dust'
  | 'vapor';

export type OperatorGeometryAxis =
  | 'sheet'
  | 'shell'
  | 'fog'
  | 'aggregate'
  | 'lattice'
  | 'mesh'
  | 'front'
  | 'plate';

export type OperatorDynamicsAxis =
  | 'capillary'
  | 'advection'
  | 'vortex'
  | 'pressure'
  | 'avalanche'
  | 'jam'
  | 'viscoelastic'
  | 'freeze'
  | 'melt'
  | 'sublimate'
  | 'corrode'
  | 'creep'
  | 'grammar'
  | 'growth'
  | 'static'
  | 'erode'
  | 'dissolve'
  | 'abrade'
  | 'pit';

export type OperatorInscriptionAxis =
  | 'plain'
  | 'glyph'
  | 'ledger'
  | 'rune'
  | 'contour'
  | 'palimpsest';

export type OperatorDedicatedAxis =
  | 'text-inscription'
  | 'grid-architectonic'
  | 'ring-orbit'
  | 'plane-ledger'
  | 'erosion-wear'
  | 'phase-transition';

export type OperatorDedicatedSubAxis =
  | 'text-glyphic'
  | 'text-ledger'
  | 'grid-lattice'
  | 'grid-static'
  | 'ring-halo'
  | 'ring-vortex'
  | 'plane-ink'
  | 'plane-soot'
  | 'erosion-cut'
  | 'wear-pitted'
  | 'phase-freeze'
  | 'phase-melt';

export interface OperatorRecipe {
  id: string;
  label: string;
  summary: string;
  mode: Layer2Type;
  source: Layer3Source;
  material: OperatorMaterialAxis;
  geometry: OperatorGeometryAxis;
  dynamics: OperatorDynamicsAxis;
  inscription: OperatorInscriptionAxis;
  temporal: TemporalProfile;
  materialStyle: NonNullable<ParticleConfig['layer2MaterialStyle']>;
  count: number;
  baseSize: number;
  radiusScale?: number;
  reviewTags: string[];
  extraPatch?: Partial<ParticleConfig>;
  autoSourcePatch?: LayerSuffixPatch;
  dedicatedAxis?: OperatorDedicatedAxis;
  dedicatedSubAxis?: OperatorDedicatedSubAxis;
}

export type Primitive = string | number | boolean;

export type LayerSuffixPatch = Record<string, Primitive | null | undefined>;

export type OperatorSourceAutoWeight = {
  countMultiplier: number;
  baseSizeMultiplier: number;
  radiusScaleMultiplier: number;
  temporalStrength: number;
  suffixPatch: LayerSuffixPatch;
  reviewTags: string[];
  labelToken: string;
};
