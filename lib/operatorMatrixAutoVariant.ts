import type { Layer3Source } from '../types';
import type { OperatorRecipe } from './operatorMatrixTypes';
import { inferDedicatedAxis, inferDedicatedSubAxis } from './operatorMatrixPatchPresets';
import {
  sourceAutoWeight,
  sourcePreferredInscription,
  sourcePreferredTemporal,
} from './operatorMatrixSourceAutoWeight';

export { autoVariantSourcesForGeometry } from './operatorMatrixSourceAutoWeight';

export function buildAutoRecipeVariant(base: OperatorRecipe, source: Layer3Source, ordinal: number): OperatorRecipe {
  const weighting = sourceAutoWeight(source, base.geometry, base.inscription);
  const inscription = sourcePreferredInscription(source, base.inscription);
  const temporal = sourcePreferredTemporal(source, base.temporal);
  const dedicatedAxis = inferDedicatedAxis(source, base.dynamics, inscription, base.mode) ?? base.dedicatedAxis;
  const dedicatedSubAxis = inferDedicatedSubAxis(source, base.dynamics, inscription, base.mode, dedicatedAxis) ?? base.dedicatedSubAxis;
  const token = weighting.labelToken;
  return {
    ...base,
    id: `${base.id}--${source}-${ordinal + 1}`,
    label: `${base.label} / ${token ?? source}`,
    summary: `${base.summary} Auto-weighted for ${source} source anchoring and batch coverage growth.`,
    source,
    inscription,
    temporal,
    reviewTags: Array.from(new Set([...base.reviewTags, ...weighting.reviewTags, `auto-${source}`, 'operator-auto'])),
    autoSourcePatch: weighting.suffixPatch,
    dedicatedAxis,
    dedicatedSubAxis,
  };
}
