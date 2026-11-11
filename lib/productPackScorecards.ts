import type { ParticleConfig } from '../types';
import { DEFAULT_CONFIG, normalizeConfig } from './appStateConfig';
import { COVERAGE_TARGETS, type CoverageProfile, getCoverageProfile } from './depictionCoverage';
import {
  buildProductPackPatch,
  getProductPackBundleById,
  inferProductPackBundleId,
  PRODUCT_PACK_BUNDLES,
  type ProductPackBundle,
  type ProductPackFamily,
} from './productPackLibrary';
import { getProductPackSubfamilyProfile } from './productPackSubfamilies';

export interface ProductPackCoverageAxisScore {
  covered: string[];
  missing: string[];
  hitCount: number;
  targetCount: number;
  ratio: number;
}

export interface ProductPackCoverageScorecard {
  id: string;
  label: string;
  family: ProductPackFamily;
  summary: string;
  emphasis: string[];
  postStackId: string;
  solverFamilies: string[];
  specialistFamilies: string[];
  physicalFamilies: string[];
  geometryFamilies: string[];
  temporalFamilies: string[];
  coverageScore: number;
  targetHitCount: number;
  targetTotal: number;
  sourceAxis: ProductPackCoverageAxisScore;
  renderAxis: ProductPackCoverageAxisScore;
  postAxis: ProductPackCoverageAxisScore;
  computeAxis: ProductPackCoverageAxisScore;
  motionAxis: ProductPackCoverageAxisScore;
  solverAxis: ProductPackCoverageAxisScore;
  specialistAxis: ProductPackCoverageAxisScore;
  physicalAxis: ProductPackCoverageAxisScore;
  geometryAxis: ProductPackCoverageAxisScore;
  temporalAxis: ProductPackCoverageAxisScore;
  coverage: ReturnType<typeof getCoverageProfile>;
  missingTargets: string[];
}

export interface ProductPackCoverageRollup {
  coverageScore: number;
  targetHitCount: number;
  targetTotal: number;
  averagePackCoverageScore: number;
  bestPackId: string | null;
  bestPackLabel: string | null;
  bestPackCoverageScore: number;
  sourceAxis: ProductPackCoverageAxisScore;
  renderAxis: ProductPackCoverageAxisScore;
  postAxis: ProductPackCoverageAxisScore;
  computeAxis: ProductPackCoverageAxisScore;
  motionAxis: ProductPackCoverageAxisScore;
  solverAxis: ProductPackCoverageAxisScore;
  specialistAxis: ProductPackCoverageAxisScore;
  physicalAxis: ProductPackCoverageAxisScore;
  geometryAxis: ProductPackCoverageAxisScore;
  temporalAxis: ProductPackCoverageAxisScore;
  missingTargets: string[];
}

export type CoverageTargetProfile = Pick<CoverageProfile, 'sourceFamilies' | 'renderFamilies' | 'postFamilies' | 'computeBackends' | 'motionFamilies' | 'solverFamilies' | 'specialistFamilies' | 'physicalFamilies' | 'geometryFamilies' | 'temporalFamilies'>;

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function buildAxisScore(active: string[], targets: readonly string[]): ProductPackCoverageAxisScore {
  const covered = targets.filter((target) => active.includes(target));
  const missing = targets.filter((target) => !active.includes(target));
  const targetCount = targets.length;
  const hitCount = covered.length;
  return {
    covered,
    missing,
    hitCount,
    targetCount,
    ratio: targetCount > 0 ? hitCount / targetCount : 0,
  };
}

function buildProductPackConfig(bundle: ProductPackBundle): ParticleConfig {
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...buildProductPackPatch(bundle),
  });
}

function buildAxisTargetKeys(prefix: string, values: string[]) {
  return values.map((value) => `${prefix}/${value}`);
}

export function getCoverageTargetTotalCount() {
  return COVERAGE_TARGETS.sourceFamilies.length
    + COVERAGE_TARGETS.renderFamilies.length
    + COVERAGE_TARGETS.postFamilies.length
    + COVERAGE_TARGETS.computeBackends.length
    + COVERAGE_TARGETS.motionFamilies.length
    + COVERAGE_TARGETS.solverFamilies.length
    + COVERAGE_TARGETS.specialistFamilies.length
    + COVERAGE_TARGETS.physicalFamilies.length
    + COVERAGE_TARGETS.geometryFamilies.length
    + COVERAGE_TARGETS.temporalFamilies.length;
}

export function getCoverageTargetKeysFromProfile(profile: CoverageTargetProfile) {
  return uniqueNonEmpty([
    ...buildAxisTargetKeys('source', COVERAGE_TARGETS.sourceFamilies.filter((target) => profile.sourceFamilies.includes(target))),
    ...buildAxisTargetKeys('render', COVERAGE_TARGETS.renderFamilies.filter((target) => profile.renderFamilies.includes(target))),
    ...buildAxisTargetKeys('post', COVERAGE_TARGETS.postFamilies.filter((target) => profile.postFamilies.includes(target))),
    ...buildAxisTargetKeys('compute', COVERAGE_TARGETS.computeBackends.filter((target) => profile.computeBackends.includes(target))),
    ...buildAxisTargetKeys('motion', COVERAGE_TARGETS.motionFamilies.filter((target) => profile.motionFamilies.includes(target))),
    ...buildAxisTargetKeys('solver', COVERAGE_TARGETS.solverFamilies.filter((target) => profile.solverFamilies.includes(target))),
    ...buildAxisTargetKeys('specialist', COVERAGE_TARGETS.specialistFamilies.filter((target) => profile.specialistFamilies.includes(target))),
    ...buildAxisTargetKeys('physical', COVERAGE_TARGETS.physicalFamilies.filter((target) => profile.physicalFamilies.includes(target))),
    ...buildAxisTargetKeys('geometry', COVERAGE_TARGETS.geometryFamilies.filter((target) => profile.geometryFamilies.includes(target))),
    ...buildAxisTargetKeys('temporal', COVERAGE_TARGETS.temporalFamilies.filter((target) => profile.temporalFamilies.includes(target))),
  ]);
}

export function getCoverageTargetHitCountFromProfile(profile: CoverageTargetProfile) {
  return getCoverageTargetKeysFromProfile(profile).length;
}

export function getCoverageScoreFromProfile(profile: CoverageTargetProfile) {
  const targetTotal = getCoverageTargetTotalCount();
  const hitCount = getCoverageTargetHitCountFromProfile(profile);
  return Math.round((targetTotal > 0 ? hitCount / targetTotal : 0) * 100);
}

export function getScorecardCoveredTargetKeys(scorecard: ProductPackCoverageScorecard) {
  return getCoverageTargetKeysFromProfile(scorecard.coverage);
}

function buildRollupAxis(scorecards: ProductPackCoverageScorecard[], selector: (scorecard: ProductPackCoverageScorecard) => ProductPackCoverageAxisScore, targets: readonly string[]) {
  const covered = uniqueNonEmpty(scorecards.flatMap((scorecard) => selector(scorecard).covered));
  return buildAxisScore(covered, targets);
}

export function buildProductPackCoverageScorecard(bundleOrId: ProductPackBundle | string): ProductPackCoverageScorecard | null {
  const bundle = typeof bundleOrId === 'string' ? getProductPackBundleById(bundleOrId) : bundleOrId;
  if (!bundle) return null;

  const config = buildProductPackConfig(bundle);
  const baseCoverage = getCoverageProfile(config);
  const subfamilies = getProductPackSubfamilyProfile(bundle);
  const coverage = {
    ...baseCoverage,
    solverFamilies: uniqueNonEmpty([...baseCoverage.solverFamilies, ...bundle.solverFamilies]),
    specialistFamilies: uniqueNonEmpty([...baseCoverage.specialistFamilies, ...bundle.specialistFamilies]),
    physicalFamilies: uniqueNonEmpty([...baseCoverage.physicalFamilies, ...subfamilies.physicalFamilies]),
    geometryFamilies: uniqueNonEmpty([...baseCoverage.geometryFamilies, ...subfamilies.geometryFamilies]),
    temporalFamilies: uniqueNonEmpty([...baseCoverage.temporalFamilies, ...subfamilies.temporalFamilies]),
  };
  const sourceAxis = buildAxisScore(coverage.sourceFamilies, COVERAGE_TARGETS.sourceFamilies);
  const renderAxis = buildAxisScore(coverage.renderFamilies, COVERAGE_TARGETS.renderFamilies);
  const postAxis = buildAxisScore(coverage.postFamilies, COVERAGE_TARGETS.postFamilies);
  const computeAxis = buildAxisScore(coverage.computeBackends, COVERAGE_TARGETS.computeBackends);
  const motionAxis = buildAxisScore(coverage.motionFamilies, COVERAGE_TARGETS.motionFamilies);
  const solverAxis = buildAxisScore(coverage.solverFamilies, COVERAGE_TARGETS.solverFamilies);
  const specialistAxis = buildAxisScore(coverage.specialistFamilies, COVERAGE_TARGETS.specialistFamilies);
  const physicalAxis = buildAxisScore(coverage.physicalFamilies, COVERAGE_TARGETS.physicalFamilies);
  const geometryAxis = buildAxisScore(coverage.geometryFamilies, COVERAGE_TARGETS.geometryFamilies);
  const temporalAxis = buildAxisScore(coverage.temporalFamilies, COVERAGE_TARGETS.temporalFamilies);

  const targetHitCount = sourceAxis.hitCount + renderAxis.hitCount + postAxis.hitCount + computeAxis.hitCount + motionAxis.hitCount + solverAxis.hitCount + specialistAxis.hitCount + physicalAxis.hitCount + geometryAxis.hitCount + temporalAxis.hitCount;
  const targetTotal = sourceAxis.targetCount + renderAxis.targetCount + postAxis.targetCount + computeAxis.targetCount + motionAxis.targetCount + solverAxis.targetCount + specialistAxis.targetCount + physicalAxis.targetCount + geometryAxis.targetCount + temporalAxis.targetCount;
  const coverageScore = Math.round((targetTotal > 0 ? targetHitCount / targetTotal : 0) * 100);

  return {
    id: bundle.id,
    label: bundle.label,
    family: bundle.family,
    summary: bundle.summary,
    emphasis: bundle.emphasis,
    postStackId: bundle.postStackId,
    solverFamilies: bundle.solverFamilies,
    specialistFamilies: bundle.specialistFamilies,
    physicalFamilies: subfamilies.physicalFamilies,
    geometryFamilies: subfamilies.geometryFamilies,
    temporalFamilies: subfamilies.temporalFamilies,
    coverageScore,
    targetHitCount,
    targetTotal,
    sourceAxis,
    renderAxis,
    postAxis,
    computeAxis,
    motionAxis,
    solverAxis,
    specialistAxis,
    physicalAxis,
    geometryAxis,
    temporalAxis,
    coverage,
    missingTargets: [
      ...sourceAxis.missing.map((item) => `source/${item}`),
      ...renderAxis.missing.map((item) => `render/${item}`),
      ...postAxis.missing.map((item) => `post/${item}`),
      ...computeAxis.missing.map((item) => `compute/${item}`),
      ...motionAxis.missing.map((item) => `motion/${item}`),
      ...solverAxis.missing.map((item) => `solver/${item}`),
      ...specialistAxis.missing.map((item) => `specialist/${item}`),
      ...physicalAxis.missing.map((item) => `physical/${item}`),
      ...geometryAxis.missing.map((item) => `geometry/${item}`),
      ...temporalAxis.missing.map((item) => `temporal/${item}`),
    ].slice(0, 28),
  };
}

export function getAllProductPackCoverageScorecards(): ProductPackCoverageScorecard[] {
  return PRODUCT_PACK_BUNDLES.map((bundle) => buildProductPackCoverageScorecard(bundle)).filter((item): item is ProductPackCoverageScorecard => Boolean(item));
}

export function buildProductPackCoverageRollup(scorecards = getAllProductPackCoverageScorecards()): ProductPackCoverageRollup {
  const sourceAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.sourceAxis, COVERAGE_TARGETS.sourceFamilies);
  const renderAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.renderAxis, COVERAGE_TARGETS.renderFamilies);
  const postAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.postAxis, COVERAGE_TARGETS.postFamilies);
  const computeAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.computeAxis, COVERAGE_TARGETS.computeBackends);
  const motionAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.motionAxis, COVERAGE_TARGETS.motionFamilies);
  const solverAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.solverAxis, COVERAGE_TARGETS.solverFamilies);
  const specialistAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.specialistAxis, COVERAGE_TARGETS.specialistFamilies);
  const physicalAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.physicalAxis, COVERAGE_TARGETS.physicalFamilies);
  const geometryAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.geometryAxis, COVERAGE_TARGETS.geometryFamilies);
  const temporalAxis = buildRollupAxis(scorecards, (scorecard) => scorecard.temporalAxis, COVERAGE_TARGETS.temporalFamilies);

  const targetHitCount = sourceAxis.hitCount + renderAxis.hitCount + postAxis.hitCount + computeAxis.hitCount + motionAxis.hitCount + solverAxis.hitCount + specialistAxis.hitCount + physicalAxis.hitCount + geometryAxis.hitCount + temporalAxis.hitCount;
  const targetTotal = sourceAxis.targetCount + renderAxis.targetCount + postAxis.targetCount + computeAxis.targetCount + motionAxis.targetCount + solverAxis.targetCount + specialistAxis.targetCount + physicalAxis.targetCount + geometryAxis.targetCount + temporalAxis.targetCount;
  const coverageScore = Math.round((targetTotal > 0 ? targetHitCount / targetTotal : 0) * 100);
  const averagePackCoverageScore = scorecards.length > 0
    ? Math.round(scorecards.reduce((sum, scorecard) => sum + scorecard.coverageScore, 0) / scorecards.length)
    : 0;
  const bestPack = scorecards.reduce<ProductPackCoverageScorecard | null>((best, scorecard) => {
    if (!best || scorecard.coverageScore > best.coverageScore) return scorecard;
    return best;
  }, null);

  return {
    coverageScore,
    targetHitCount,
    targetTotal,
    averagePackCoverageScore,
    bestPackId: bestPack?.id ?? null,
    bestPackLabel: bestPack?.label ?? null,
    bestPackCoverageScore: bestPack?.coverageScore ?? 0,
    sourceAxis,
    renderAxis,
    postAxis,
    computeAxis,
    motionAxis,
    solverAxis,
    specialistAxis,
    physicalAxis,
    geometryAxis,
    temporalAxis,
    missingTargets: [
      ...sourceAxis.missing.map((item) => `source/${item}`),
      ...renderAxis.missing.map((item) => `render/${item}`),
      ...postAxis.missing.map((item) => `post/${item}`),
      ...computeAxis.missing.map((item) => `compute/${item}`),
      ...motionAxis.missing.map((item) => `motion/${item}`),
      ...solverAxis.missing.map((item) => `solver/${item}`),
      ...specialistAxis.missing.map((item) => `specialist/${item}`),
      ...physicalAxis.missing.map((item) => `physical/${item}`),
      ...geometryAxis.missing.map((item) => `geometry/${item}`),
      ...temporalAxis.missing.map((item) => `temporal/${item}`),
    ].slice(0, 28),
  };
}

export function getProductPackCoverageScorecardById(id: string | null | undefined): ProductPackCoverageScorecard | null {
  if (!id) return null;
  return buildProductPackCoverageScorecard(id);
}

export function getReferencedProductPackCoverageScorecards(configs: ParticleConfig[]): ProductPackCoverageScorecard[] {
  const seen = new Set<string>();
  const scorecards: ProductPackCoverageScorecard[] = [];
  for (const config of configs) {
    const bundleId = inferProductPackBundleId(config);
    const bundle = bundleId ? getProductPackBundleById(bundleId) : null;
    if (bundle && !seen.has(bundle.id)) {
      const scorecard = buildProductPackCoverageScorecard(bundle);
      if (scorecard) {
        seen.add(bundle.id);
        scorecards.push(scorecard);
      }
    }
  }
  return scorecards;
}
