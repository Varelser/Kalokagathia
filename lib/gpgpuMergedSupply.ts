/**
 * Merged supply (Grammar 2.0 stage 2, texture-unit follow-up;
 * Sugi chose the supply integration — 供給統合 — on
 * 2026-11-27 over a second return mechanism).
 *
 * The problem (B1 record): the velocity fragment's resident
 * budget is the 16-unit floor. The live variant returns the
 * spawn-order unit and spends it on the REP output texture;
 * the column variant returns the same unit and spends it on
 * the column-data texture. Standing BOTH therefore measured
 * 17 units and failed validation on the target GPU.
 *
 * The integration: the two supplies share ONE texture. The
 * REP's ping-pong targets grow taller — the bottom texSize
 * rows keep the per-particle live aggregate exactly as before
 * (the REP renders through a viewport restricted to that
 * square, so its vUv semantics are untouched), and the column
 * data is blitted into the strip above it, packed linearly in
 * the column layout's texel order. Every consumer then reads
 * through the one sampler:
 *   - velocity: the live segment samples the merged texture
 *     with globalUv.y scaled by texSize / totalHeight, and
 *     kaloColFetch remaps its linear texel index into the
 *     strip (see the merged variants in the velocity shader
 *     modules);
 *   - position / draw: they keep sampling the REP texture,
 *     with their live reads scaled by the same y factor
 *     (uniform uLiveTexYScale, 1.0 whenever the merged supply
 *     does not stand, in which case their variant strings are
 *     the pre-integration ones).
 *
 * This module is the SINGLE resolution point for "the merged
 * supply stands": the REP stands (its fragment builds
 * non-null under the exact options the scene uses) AND a
 * column supply exists. Every consumer — the scene's REP
 * construction, the velocity / position / draw variant
 * builders, the passes' uniform supply — resolves through
 * here so the four can never disagree. Cached by the same
 * signature ingredients the scene's REP signature and the
 * column supply's cache use, plus texSize.
 */
import { buildRuleEvalFragment } from './gpgpuParticleRulesLive';
import { parseGpgpuGroups } from './gpgpuGroups';
import { resolveLiveRulesWithPredation, type PredationConfigSlice } from './gpgpuPredation';
import { getColumnSupply, type ColumnConfigSlice } from './gpgpuPathAssets';

export type MergedSupplyConfigSlice = PredationConfigSlice & ColumnConfigSlice & {
  gpgpuParticleRulesLive?: string;
  gpgpuAttrNames?: readonly string[];
  gpgpuAttrNames2?: readonly string[];
  gpgpuGroupsData?: string;
};

export interface MergedSupplyPlan {
  /** Column texels (the column layout's width * height). */
  texelCount: number;
  /** Strip height in texels: the column texels packed into
   *  rows of the merged texture's width (texSize). */
  stripRows: number;
  /** Merged texture height: texSize + stripRows. */
  totalHeight: number;
  /** Live-region y scale: texSize / totalHeight. */
  yScale: number;
}

let planCache: { signature: string; plan: MergedSupplyPlan | null } | null = null;

function mergedSignature(config: MergedSupplyConfigSlice, texSize: number): string {
  return [
    config.gpgpuParticleRulesLive ?? '',
    config.gpgpuPredationEnabled ? 1 : 0,
    config.gpgpuPredationOutcome ?? '',
    config.gpgpuPredationBirth ? 1 : 0,
    config.gpgpuPredationStrike ?? '',
    config.gpgpuPredationStrikeFrames ?? '',
    config.gpgpuPredationGraceSeconds ?? '',
    config.gpgpuGroupsData ?? '',
    (config.gpgpuAttrNames ?? []).join(','),
    (config.gpgpuAttrNames2 ?? []).join(','),
    config.gpgpuFieldInstances ?? '',
    config.gpgpuFieldLayers ?? '',
    config.gpgpuSteerSeekPath ?? '',
    config.gpgpuSteerSeekPaths ?? '',
    config.gpgpuSteerSeekPathSvg ?? '',
    String(config.gpgpuSteerSeekPathSvgScale ?? ''),
    texSize,
  ].join('\n');
}

/**
 * The merged supply plan for this config at this texSize, or
 * null while either supply is absent. The REP-stands half
 * replicates the scene's construction condition exactly
 * (same merged rule list, same fragment options), so a plan
 * exists precisely while the scene's REP pass exists AND the
 * column supply exists.
 */
export function resolveMergedSupplyPlan(
  config: MergedSupplyConfigSlice,
  texSize: number,
): MergedSupplyPlan | null {
  const signature = mergedSignature(config, texSize);
  if (planCache && planCache.signature === signature) return planCache.plan;
  let plan: MergedSupplyPlan | null = null;
  const supply = getColumnSupply(config);
  if (supply) {
    const fragment = buildRuleEvalFragment(resolveLiveRulesWithPredation(config), {
      names: config.gpgpuAttrNames ?? [],
      names2: config.gpgpuAttrNames2 ?? [],
      groupDefs: parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
      densityAvailable: true,
    });
    if (fragment) {
      const texelCount = supply.width * supply.height;
      const stripRows = Math.max(1, Math.ceil(texelCount / texSize));
      const totalHeight = texSize + stripRows;
      plan = { texelCount, stripRows, totalHeight, yScale: texSize / totalHeight };
    }
  }
  planCache = { signature, plan };
  return plan;
}

/** Whether the merged supply stands (plan shorthand). */
export function mergedSupplyActive(config: MergedSupplyConfigSlice, texSize: number): boolean {
  return resolveMergedSupplyPlan(config, texSize) !== null;
}
