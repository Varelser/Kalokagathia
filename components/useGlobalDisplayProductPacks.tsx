import React from 'react';

import type { ParticleConfig } from '../types';
import { buildProductPackPatch, getProductPackBundleById, inferProductPackBundleId } from '../lib/productPackLibrary';
import type { CustomProductPackRecord } from '../lib/productPackCustomLibrary';
import { getCurrentCoverageProgress, getProductPackAugmentationSuggestions, type ProductPackAugmentationSuggestion } from '../lib/productPackAugmentation';
import {
  buildProductPackCoverageRollup,
  getAllProductPackCoverageScorecards,
  getProductPackCoverageScorecardById,
  type ProductPackCoverageRollup,
  type ProductPackCoverageScorecard,
} from '../lib/productPackScorecards';
import { getCoverageProfile, type CoverageProfile } from '../lib/depictionCoverage';
import { normalizeConfig } from '../lib/appStateConfig';
import type { UpdateConfig } from './controlPanelTabsShared';
import { useGlobalDisplayProductPackCustomPacks } from './useGlobalDisplayProductPackCustomPacks';
import {
  useGlobalDisplayProductPackDetails,
  type GlobalDisplayProductPackDetailsState,
} from './useGlobalDisplayProductPackDetails';
import {
  DETAIL_SECTION_SCOPES,
  getScopeDefaultOpen,
  getScopeLabel,
  type ProductPackDetailControl,
  type ProductPackDetailGroup,
  type ProductPackDetailScope,
} from './useGlobalDisplayProductPacksShared';

interface UseGlobalDisplayProductPacksArgs {
  config: ParticleConfig;
  isPublicLibrary: boolean;
  updateConfig: UpdateConfig;
}

export interface GlobalDisplayProductPackState extends GlobalDisplayProductPackDetailsState {
  activeProductPackBundle: ReturnType<typeof getProductPackBundleById>;
  activeProductPackScorecard: ProductPackCoverageScorecard | null;
  productPackScorecards: ProductPackCoverageScorecard[];
  productPackCoverageRollup: ProductPackCoverageRollup;
  currentCoverageProgress: ReturnType<typeof getCurrentCoverageProgress>;
  coverageProfile: CoverageProfile;
  augmentationSuggestions: ProductPackAugmentationSuggestion[];
  customProductPacks: CustomProductPackRecord[];
  activeCustomProductPack: CustomProductPackRecord | null;
  activeCustomProductPackId: string | null;
  getScopeDefaultOpen: (scope: ProductPackDetailScope) => boolean;
  getScopeLabel: (scope: ProductPackDetailScope) => string;
  applyProductPackBundle: (bundleId: string) => void;
  saveCurrentAsCustomProductPack: () => void;
  duplicateCurrentProductPackState: () => void;
  formatCustomPackDate: (value: string) => string;
  applyCustomProductPackRecord: (record: CustomProductPackRecord) => void;
  overwriteCustomProductPack: (record: CustomProductPackRecord) => void;
  duplicateCustomProductPack: (record: CustomProductPackRecord) => void;
  deleteCustomProductPack: (recordId: string) => void;
}

export function useGlobalDisplayProductPacks({ config, isPublicLibrary, updateConfig }: UseGlobalDisplayProductPacksArgs): GlobalDisplayProductPackState {
  const activeProductPackBundle = React.useMemo(() => getProductPackBundleById(inferProductPackBundleId(config)), [config]);
  const activeProductPackScorecard = React.useMemo(
    () => getProductPackCoverageScorecardById(activeProductPackBundle?.id ?? null),
    [activeProductPackBundle],
  );
  const productPackScorecards = React.useMemo(() => getAllProductPackCoverageScorecards(), []);
  const productPackCoverageRollup = React.useMemo(
    () => buildProductPackCoverageRollup(productPackScorecards),
    [productPackScorecards],
  );
  const currentCoverageProgress = React.useMemo(() => getCurrentCoverageProgress(config), [config]);
  const coverageProfile = React.useMemo(() => getCoverageProfile(config), [config]);
  const augmentationSuggestions = React.useMemo(
    () => getProductPackAugmentationSuggestions(config, {
      excludeIds: activeProductPackBundle ? [activeProductPackBundle.id] : [],
      limit: 4,
    }),
    [activeProductPackBundle, config],
  );

  const activeProductPackBasePatch = React.useMemo(
    () => (activeProductPackBundle ? buildProductPackPatch(activeProductPackBundle.id) : null),
    [activeProductPackBundle],
  );
  const activeProductPackBaseConfig = React.useMemo(
    () => normalizeConfig(activeProductPackBasePatch ?? {}),
    [activeProductPackBasePatch],
  );

  const applyConfigSnapshot = React.useCallback((nextConfig: ParticleConfig) => {
    (Object.keys(nextConfig) as Array<keyof ParticleConfig>).forEach((key) => {
      updateConfig(key, nextConfig[key]);
    });
  }, [updateConfig]);

  const applyProductPackBundle = React.useCallback((bundleId: string) => {
    const patch = buildProductPackPatch(bundleId);
    (Object.keys(patch) as Array<keyof typeof patch>).forEach((key) => {
      const value = patch[key];
      if (typeof value !== 'undefined') {
        updateConfig(key as keyof ParticleConfig, value as ParticleConfig[keyof ParticleConfig]);
      }
    });
  }, [updateConfig]);

  const detailState = useGlobalDisplayProductPackDetails({
    config,
    activeProductPackBasePatch,
    updateConfig,
  });

  const customPackState = useGlobalDisplayProductPackCustomPacks({
    config,
    isPublicLibrary,
    activeProductPackBundle,
    activeProductPackBaseConfig,
    applyConfigSnapshot,
  });

  return {
    activeProductPackBundle,
    activeProductPackScorecard,
    productPackScorecards,
    productPackCoverageRollup,
    currentCoverageProgress,
    coverageProfile,
    augmentationSuggestions,
    getScopeDefaultOpen,
    getScopeLabel,
    applyProductPackBundle,
    ...detailState,
    ...customPackState,
  };
}

export { DETAIL_SECTION_SCOPES, type ProductPackDetailControl, type ProductPackDetailGroup, type ProductPackDetailScope };
