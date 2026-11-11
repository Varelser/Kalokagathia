export type {
  OperatorMaterialAxis,
  OperatorGeometryAxis,
  OperatorDynamicsAxis,
  OperatorInscriptionAxis,
  OperatorDedicatedAxis,
  OperatorDedicatedSubAxis,
  OperatorRecipe,
} from './operatorMatrixTypes';

import type {
  OperatorDedicatedAxis,
  OperatorDedicatedSubAxis,
  OperatorRecipe,
} from './operatorMatrixTypes';
import { autoVariantSourcesForGeometry, buildAutoRecipeVariant } from './operatorMatrixHelpers';
import { BASE_OPERATOR_RECIPE_LIBRARY_RAW } from './operatorMatrixRecipeLibraryRaw';

export { buildOperatorLayerPatch } from './operatorMatrixHelpers';

export const OPERATOR_PROMOTED_DEDICATED_AXES: OperatorDedicatedAxis[] = [
  'text-inscription',
  'grid-architectonic',
  'ring-orbit',
  'plane-ledger',
  'erosion-wear',
  'phase-transition',
];

export const BASE_OPERATOR_RECIPE_LIBRARY: OperatorRecipe[] = BASE_OPERATOR_RECIPE_LIBRARY_RAW.map((recipe) => ({
  ...recipe,
  dedicatedAxis: recipe.dedicatedAxis,
  dedicatedSubAxis: recipe.dedicatedSubAxis ?? undefined,
}));


export const AUTO_EXPANDED_OPERATOR_RECIPE_LIBRARY: OperatorRecipe[] = BASE_OPERATOR_RECIPE_LIBRARY.flatMap((recipe) => {
  const sources = [recipe.source, ...autoVariantSourcesForGeometry(recipe.geometry).filter((source) => source !== recipe.source)];
  return sources.map((source, index) => buildAutoRecipeVariant(recipe, source, index));
});

export const OPERATOR_RECIPE_LIBRARY: OperatorRecipe[] = [
  ...BASE_OPERATOR_RECIPE_LIBRARY,
  ...AUTO_EXPANDED_OPERATOR_RECIPE_LIBRARY.filter((candidate) => !BASE_OPERATOR_RECIPE_LIBRARY.some((base) => base.id === candidate.id)),
];

export const OPERATOR_PROMOTED_DEDICATED_SUBAXES: OperatorDedicatedSubAxis[] = [
  'text-glyphic',
  'text-ledger',
  'grid-lattice',
  'grid-static',
  'ring-halo',
  'ring-vortex',
  'plane-ink',
  'plane-soot',
  'erosion-cut',
  'wear-pitted',
  'phase-freeze',
  'phase-melt',
];

export const OPERATOR_PROMOTED_DEDICATED_AXIS_SUMMARY: Record<OperatorDedicatedAxis, string> = {
  'text-inscription': 'Text-anchored inscription, ledger, and glyph collisions promoted into a dedicated emphasis axis.',
  'grid-architectonic': 'Grid-anchored architectonic, lattice, and static plate collisions promoted into a dedicated emphasis axis.',
  'ring-orbit': 'Ring and halo orbit collisions promoted into a dedicated emphasis axis.',
  'plane-ledger': 'Plane-anchored ledger, deposition, and soot collisions promoted into a dedicated emphasis axis.',
  'erosion-wear': 'Erosion, dissolution, residue wear, calcification, and corrosion promoted into a dedicated emphasis axis.',
  'phase-transition': 'Melt, freeze, condensation, and sublimation promoted into a dedicated emphasis axis.',
};

export const OPERATOR_PROMOTED_DEDICATED_SUBAXIS_SUMMARY: Record<OperatorDedicatedSubAxis, string> = {
  'text-glyphic': 'Text-glyph collisions split toward weave, outline, and rune-bearing inscription emphasis.',
  'text-ledger': 'Text-ledger collisions split toward plate, codex, and absorbent inscription emphasis.',
  'grid-lattice': 'Grid collisions split toward lattice, creep, and architectonic span emphasis.',
  'grid-static': 'Grid collisions split toward static slabs, stipple relief, and pressure basins.',
  'ring-halo': 'Ring collisions split toward halo, eclipse, and spore-rich orbital shells.',
  'ring-vortex': 'Ring collisions split toward vortex transport, threaded orbit, and spin drift.',
  'plane-ink': 'Plane collisions split toward absorbent ink, capillary plates, and ledger retention.',
  'plane-soot': 'Plane collisions split toward soot, velvet ash, and palimpsest fog bodies.',
  'erosion-cut': 'Erosion collisions split toward trail cutting, seep retreat, and corrosive front advance.',
  'wear-pitted': 'Wear collisions split toward residue, abrasion, pitting, and calcified memory.',
  'phase-freeze': 'Phase collisions split toward freeze lock, frost shells, and sublimation lift.',
  'phase-melt': 'Phase collisions split toward melt fronts, condensation basins, and resin flow.',
};
