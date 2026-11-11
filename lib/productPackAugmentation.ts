import type { ParticleConfig } from '../types';
import { type CoverageProfile, getCoverageProfile } from './depictionCoverage';
import { getAllProductPackCoverageScorecards, getCoverageScoreFromProfile, getCoverageTargetHitCountFromProfile, getCoverageTargetKeysFromProfile, getCoverageTargetTotalCount, getScorecardCoveredTargetKeys, type CoverageTargetProfile } from './productPackScorecards';

export interface ProductPackAugmentationSuggestion {
  id: string;
  label: string;
  family: string;
  summary: string;
  postStackId: string;
  coverageGain: number;
  resultCoverageScore: number;
  resultTargetHitCount: number;
  coveredGapTargets: string[];
}

function isCoverageProfile(value: ParticleConfig | CoverageProfile): value is CoverageProfile {
  return Array.isArray((value as CoverageProfile).depictionMethods);
}

function resolveCoverageProfile(value: ParticleConfig | CoverageProfile): CoverageProfile {
  return isCoverageProfile(value) ? value : getCoverageProfile(value);
}

export function getProductPackAugmentationSuggestions(
  configOrProfile: ParticleConfig | CoverageProfile,
  options?: { excludeIds?: string[]; limit?: number },
): ProductPackAugmentationSuggestion[] {
  const profile = resolveCoverageProfile(configOrProfile);
  const excludeIds = new Set(options?.excludeIds ?? []);
  const currentTargetKeys = new Set(getCoverageTargetKeysFromProfile(profile as CoverageTargetProfile));
  const gapTargets = profile.gapTargets.length > 0
    ? profile.gapTargets
    : Array.from(new Set(Array.from({ length: 0 })));
  const gapTargetSet = new Set(gapTargets);
  const currentHitCount = getCoverageTargetHitCountFromProfile(profile as CoverageTargetProfile);
  const targetTotal = getCoverageTargetTotalCount();

  return getAllProductPackCoverageScorecards()
    .filter((scorecard) => !excludeIds.has(scorecard.id))
    .map((scorecard) => {
      const coveredGapTargets = getScorecardCoveredTargetKeys(scorecard).filter((target) => gapTargetSet.has(target) && !currentTargetKeys.has(target));
      const coverageGain = coveredGapTargets.length;
      const resultTargetHitCount = Math.min(targetTotal, currentHitCount + coverageGain);
      const resultCoverageScore = Math.round((targetTotal > 0 ? resultTargetHitCount / targetTotal : 0) * 100);
      return {
        id: scorecard.id,
        label: scorecard.label,
        family: scorecard.family,
        summary: scorecard.summary,
        postStackId: scorecard.postStackId,
        coverageGain,
        resultCoverageScore,
        resultTargetHitCount,
        coveredGapTargets: coveredGapTargets.slice(0, 8),
      };
    })
    .filter((item) => item.coverageGain > 0)
    .sort((a, b) => {
      if (b.coverageGain !== a.coverageGain) return b.coverageGain - a.coverageGain;
      if (b.resultCoverageScore !== a.resultCoverageScore) return b.resultCoverageScore - a.resultCoverageScore;
      return a.label.localeCompare(b.label);
    })
    .slice(0, options?.limit ?? 4);
}

export function getCurrentCoverageProgress(config: ParticleConfig) {
  const coverage = getCoverageProfile(config);
  return {
    coverageScore: getCoverageScoreFromProfile(coverage as CoverageTargetProfile),
    targetHitCount: getCoverageTargetHitCountFromProfile(coverage as CoverageTargetProfile),
    targetTotal: getCoverageTargetTotalCount(),
    gapTargets: coverage.gapTargets,
  };
}
