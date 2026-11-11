import type { ProductPackDetailControl, ProductPackDetailGroup } from '../lib/productPackDetailControls';

export type { ProductPackDetailControl, ProductPackDetailGroup };

export type ProductPackDetailScope = 'common' | 'family' | 'pack' | 'solver';

export const DETAIL_SECTION_SCOPES: ProductPackDetailScope[] = ['common', 'pack', 'family', 'solver'];

export const EMPTY_DETAIL_GROUPS: Record<ProductPackDetailScope, ProductPackDetailGroup[]> = {
  common: [],
  family: [],
  pack: [],
  solver: [],
};

export function getDetailGroupScope(groupId: string): ProductPackDetailScope {
  if (groupId.startsWith('pack-')) return 'pack';
  if (groupId.startsWith('family-')) return 'family';
  if (groupId.startsWith('solver-')) return 'solver';
  return 'common';
}

export function getScopeLabel(scope: ProductPackDetailScope) {
  return {
    common: 'Common',
    family: 'Family',
    pack: 'Pack Specific',
    solver: 'Solver',
  }[scope];
}

export function getScopeDefaultOpen(scope: ProductPackDetailScope) {
  return scope === 'common' || scope === 'pack';
}
