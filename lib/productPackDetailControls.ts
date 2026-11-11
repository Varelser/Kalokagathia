import type { ParticleConfig } from '../types';
import type { ProductPackDetailGroup } from './productPackDetailControlTypes';
import { getProductPackBundleById, inferProductPackBundleId } from './productPackLibrary';
import { COMMON_DETAIL_GROUP, FAMILY_DETAIL_GROUPS } from './productPackDetailControlFamilies';
import { SOLVER_DETAIL_GROUPS } from './productPackDetailControlSolvers';
import { PACK_DETAIL_GROUPS } from './productPackDetailControlPacks';

export type { ProductPackDetailControl, ProductPackDetailGroup } from './productPackDetailControlTypes';

const uniqueGroups = (groups: ProductPackDetailGroup[]): ProductPackDetailGroup[] => {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.id)) return false;
    seen.add(group.id);
    return true;
  });
};

export const getProductPackDetailGroups = (config: ParticleConfig): ProductPackDetailGroup[] => {
  const bundle = getProductPackBundleById(inferProductPackBundleId(config));
  if (!bundle) {
    return [COMMON_DETAIL_GROUP];
  }

  const familyGroups = FAMILY_DETAIL_GROUPS[bundle.family] ?? [];
  const packGroup = PACK_DETAIL_GROUPS[bundle.id];
  const solverGroups = bundle.solverFamilies
    .map((solverFamily) => SOLVER_DETAIL_GROUPS[solverFamily])
    .filter((group): group is ProductPackDetailGroup => Boolean(group));

  return uniqueGroups([COMMON_DETAIL_GROUP, ...familyGroups, ...(packGroup ? [packGroup] : []), ...solverGroups]);
};

