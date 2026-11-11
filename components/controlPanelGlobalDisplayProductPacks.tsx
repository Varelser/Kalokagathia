import React from 'react';

import { Toggle } from './controlPanelParts';
import { PRODUCT_PACK_BUNDLES } from '../lib/productPackLibrary';
import type { CustomProductPackRecord } from '../lib/productPackCustomLibrary';
import { DETAIL_SECTION_SCOPES, type GlobalDisplayProductPackState, type ProductPackDetailControl, type ProductPackDetailGroup, type ProductPackDetailScope } from './useGlobalDisplayProductPacks';

interface GlobalDisplayProductPacksSectionProps {
  isPublicLibrary: boolean;
  activeProductPackBundle: GlobalDisplayProductPackState['activeProductPackBundle'];
  activeProductPackScorecard: GlobalDisplayProductPackState['activeProductPackScorecard'];
  productPackScorecards: GlobalDisplayProductPackState['productPackScorecards'];
  productPackCoverageRollup: GlobalDisplayProductPackState['productPackCoverageRollup'];
  currentCoverageProgress: GlobalDisplayProductPackState['currentCoverageProgress'];
  coverageProfile: GlobalDisplayProductPackState['coverageProfile'];
  augmentationSuggestions: GlobalDisplayProductPackState['augmentationSuggestions'];
  activeProductPackDetailGroups: ProductPackDetailGroup[];
  deltaOnlyControls: boolean;
  setDeltaOnlyControls: React.Dispatch<React.SetStateAction<boolean>>;
  customProductPacks: CustomProductPackRecord[];
  activeCustomProductPack: CustomProductPackRecord | null;
  activeCustomProductPackId: string | null;
  applyProductPackBundle: (bundleId: string) => void;
  saveCurrentAsCustomProductPack: () => void;
  duplicateCurrentProductPackState: () => void;
  formatCustomPackDate: (value: string) => string;
  applyCustomProductPackRecord: (record: CustomProductPackRecord) => void;
  overwriteCustomProductPack: (record: CustomProductPackRecord) => void;
  duplicateCustomProductPack: (record: CustomProductPackRecord) => void;
  deleteCustomProductPack: (recordId: string) => void;
  groupedDetailSections: Record<ProductPackDetailScope, ProductPackDetailGroup[]>;
  groupedDetailVisibleCounts: Record<ProductPackDetailScope, number>;
  getScopeDefaultOpen: (scope: ProductPackDetailScope) => boolean;
  getScopeLabel: (scope: ProductPackDetailScope) => string;
  getDetailGroupModifiedCount: (group: ProductPackDetailGroup) => number;
  getVisibleControlsForGroup: (group: ProductPackDetailGroup) => ProductPackDetailControl[];
  getDetailGroupModifiedPreview: (group: ProductPackDetailGroup) => string;
  resetDetailGroupToPackBase: (group: ProductPackDetailGroup) => void;
  renderProductPackDetailControl: (control: ProductPackDetailControl) => React.ReactNode;
  activeDetailVisibleControlCount: number;
  activeDetailControlCount: number;
  activeDetailModifiedCount: number;
}

export const GlobalDisplayProductPacksSection: React.FC<GlobalDisplayProductPacksSectionProps> = ({
  isPublicLibrary,
  activeProductPackBundle,
  activeProductPackScorecard,
  productPackScorecards,
  productPackCoverageRollup,
  currentCoverageProgress,
  coverageProfile,
  augmentationSuggestions,
  activeProductPackDetailGroups,
  deltaOnlyControls,
  setDeltaOnlyControls,
  customProductPacks,
  activeCustomProductPack,
  activeCustomProductPackId,
  applyProductPackBundle,
  saveCurrentAsCustomProductPack,
  duplicateCurrentProductPackState,
  formatCustomPackDate,
  applyCustomProductPackRecord,
  overwriteCustomProductPack,
  duplicateCustomProductPack,
  deleteCustomProductPack,
  groupedDetailSections,
  groupedDetailVisibleCounts,
  getScopeDefaultOpen,
  getScopeLabel,
  getDetailGroupModifiedCount,
  getVisibleControlsForGroup,
  getDetailGroupModifiedPreview,
  resetDetailGroupToPackBase,
  renderProductPackDetailControl,
  activeDetailVisibleControlCount,
  activeDetailControlCount,
  activeDetailModifiedCount,
}) => (
  <div className="mt-5 rounded border border-white/10 bg-white/5 p-3">
    <div className="mb-3 flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest font-bold text-white/70">
      <span>Product Packs</span>
      <span className="text-white/35">{activeProductPackBundle ? activeProductPackBundle.label : 'Custom'}</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {PRODUCT_PACK_BUNDLES.map((bundle) => {
        const active = activeProductPackBundle?.id === bundle.id;
        const scorecard = productPackScorecards.find((item) => item.id === bundle.id);
        return (
          <button
            key={bundle.id}
            onClick={() => applyProductPackBundle(bundle.id)}
            title={bundle.summary}
            className={`rounded border px-2 py-2 text-left transition-colors ${active ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-black/10 text-white/70 hover:bg-white/5'}`}
          >
            <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest"><span>{bundle.label}</span><span className="font-mono text-white/60">{scorecard ? `${scorecard.coverageScore}%` : '--'}</span></div>
            <div className="mt-1 text-[9px] leading-relaxed text-white/45">{bundle.family} · {bundle.emphasis.join(' · ')}</div>
            <div className="mt-1 text-[9px] text-white/30">solver · {bundle.solverFamilies.join(' · ')}</div>
            <div className="mt-1 text-[9px] text-white/20">specialist · {bundle.specialistFamilies.join(' · ')}</div>
          </button>
        );
      })}
    </div>
    <div className="mt-2 text-[9px] text-white/40">
      Product parity pack library for TouchDesigner / Trapcode / Universe / Houdini / Niagara / Geometry Nodes style bundles.
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className="rounded border border-white/10 bg-black/20 p-2">
        <div className="text-[9px] uppercase tracking-widest text-white/40">Current coverage</div>
        <div className="mt-1 text-sm font-bold text-white/85">{currentCoverageProgress.coverageScore}%</div>
        <div className="mt-1 text-[9px] text-white/45">{currentCoverageProgress.targetHitCount}/{currentCoverageProgress.targetTotal} targets</div>
        <div className="mt-1 text-[9px] text-white/30">specialist {coverageProfile.specialistFamilies.join(' · ') || 'none'}</div>
        <div className="mt-1 text-[9px] text-white/25">physical {coverageProfile.physicalFamilies.join(' · ') || 'none'}</div>
        <div className="mt-1 text-[9px] text-white/25">geometry {coverageProfile.geometryFamilies.join(' · ') || 'none'}</div>
        <div className="mt-1 text-[9px] text-white/25">temporal {coverageProfile.temporalFamilies.join(' · ') || 'none'}</div>
      </div>
      <div className="rounded border border-white/10 bg-black/20 p-2">
        <div className="text-[9px] uppercase tracking-widest text-white/40">Library coverage</div>
        <div className="mt-1 text-sm font-bold text-white/85">{productPackCoverageRollup.coverageScore}%</div>
        <div className="mt-1 text-[9px] text-white/45">best {productPackCoverageRollup.bestPackCoverageScore}% · avg {productPackCoverageRollup.averagePackCoverageScore}%</div>
        <div className="mt-1 text-[9px] text-white/30">solver {productPackCoverageRollup.solverAxis.hitCount}/{productPackCoverageRollup.solverAxis.targetCount} · specialist {productPackCoverageRollup.specialistAxis.hitCount}/{productPackCoverageRollup.specialistAxis.targetCount}</div>
        <div className="mt-1 text-[9px] text-white/25">physical {productPackCoverageRollup.physicalAxis.hitCount}/{productPackCoverageRollup.physicalAxis.targetCount} · geometry {productPackCoverageRollup.geometryAxis.hitCount}/{productPackCoverageRollup.geometryAxis.targetCount} · temporal {productPackCoverageRollup.temporalAxis.hitCount}/{productPackCoverageRollup.temporalAxis.targetCount}</div>
      </div>
    </div>
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
        <span>Active pack scorecard</span>
        <span>{activeProductPackScorecard ? `${activeProductPackScorecard.coverageScore}%` : 'Custom'}</span>
      </div>
      <div className="text-[9px] text-white/45">
        {activeProductPackScorecard
          ? `${activeProductPackScorecard.targetHitCount}/${activeProductPackScorecard.targetTotal} targets · solver ${activeProductPackScorecard.solverFamilies.join(' · ') || 'none'} · specialist ${activeProductPackScorecard.specialistFamilies.join(' · ') || 'none'} · physical ${activeProductPackScorecard.physicalFamilies.join(' · ') || 'none'} · geometry ${activeProductPackScorecard.geometryFamilies.join(' · ') || 'none'} · temporal ${activeProductPackScorecard.temporalFamilies.join(' · ') || 'none'} · missing ${activeProductPackScorecard.missingTargets.slice(0, 4).join(' · ') || 'none'}`
          : `Custom config · ${currentCoverageProgress.gapTargets.slice(0, 4).join(' · ') || 'no gap preview'}`}
      </div>
    </div>
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
        <span>Active pack fine controls</span>
        <span>{activeProductPackDetailGroups.length} groups · {activeDetailVisibleControlCount}/{activeDetailControlCount} controls</span>
      </div>
      <div className="mb-2">
        <Toggle
          label="Delta-only Controls"
          value={deltaOnlyControls}
          options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
          onChange={(value) => setDeltaOnlyControls(Boolean(value))}
        />
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">Changed from base</div>
          <div className="mt-1 text-sm font-bold text-white/85">{activeDetailModifiedCount}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">Family groups</div>
          <div className="mt-1 text-sm font-bold text-white/85">{groupedDetailSections.family.length}</div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-2">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">Solver groups</div>
          <div className="mt-1 text-sm font-bold text-white/85">{groupedDetailSections.solver.length}</div>
        </div>
      </div>
      <div className="space-y-2">
        {DETAIL_SECTION_SCOPES.map((scope) => {
          const groups = groupedDetailSections[scope];
          if (groups.length === 0) return null;
          const scopeChanged = groups.reduce((sum, group) => sum + getDetailGroupModifiedCount(group), 0);
          const scopeVisibleCount = groupedDetailVisibleCounts[scope];
          const scopeTotalCount = groups.reduce((sum, group) => sum + group.controls.length, 0);
          return (
            <details key={scope} open={getScopeDefaultOpen(scope)} className="rounded border border-white/10 bg-black/10">
              <summary className="cursor-pointer list-none px-3 py-2">
                <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/45">
                  <span>{getScopeLabel(scope)}</span>
                  <span>{groups.length} groups · {scopeVisibleCount}/{scopeTotalCount} visible · Δ {scopeChanged}</span>
                </div>
              </summary>
              <div className="space-y-2 border-t border-white/5 px-2 py-2">
                {groups.map((group) => {
                  const modifiedCount = getDetailGroupModifiedCount(group);
                  const visibleControls = getVisibleControlsForGroup(group);
                  if (visibleControls.length === 0) return null;
                  return (
                    <details key={group.id} open={modifiedCount > 0 || scope === 'common' || scope === 'pack'} className="rounded border border-white/10 bg-black/10 p-2">
                      <summary className="cursor-pointer list-none">
                        <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/45">
                          <span>{group.label}</span>
                          <div className="flex items-center gap-2">
                            <span>{visibleControls.length}/{group.controls.length} controls</span>
                            <span>Δ {modifiedCount}</span>
                          </div>
                        </div>
                        <div className="mt-1 text-[9px] leading-relaxed text-white/35">{group.summary}</div>
                      </summary>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-white/35">
                        <span>{getDetailGroupModifiedPreview(group)}</span>
                        <button
                          onClick={() => resetDetailGroupToPackBase(group)}
                          className="rounded border border-white/10 bg-black/20 px-2 py-1 uppercase tracking-[0.18em] text-white/55 hover:bg-white/10"
                        >
                          Reset Group
                        </button>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {visibleControls.map((control) => renderProductPackDetailControl(control))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
        <span>Custom saved pack clones</span>
        <span>{customProductPacks.length}{activeCustomProductPack ? ` · active ${activeCustomProductPack.label}` : ''}</span>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <button
          onClick={saveCurrentAsCustomProductPack}
          className="rounded border border-white/10 bg-black/10 px-2 py-2 text-left text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/5 disabled:opacity-40"
          disabled={isPublicLibrary}
        >
          Save current as custom
        </button>
        <button
          onClick={duplicateCurrentProductPackState}
          className="rounded border border-white/10 bg-black/10 px-2 py-2 text-left text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/5 disabled:opacity-40"
          disabled={isPublicLibrary}
        >
          Duplicate current state
        </button>
      </div>
      <div className="mb-2 text-[9px] text-white/40">
        Save current pack + detail-control state without replacing the built-in product pack library. Stored locally in this browser.
      </div>
      {customProductPacks.length > 0 ? (
        <div className="space-y-2">
          {customProductPacks.map((record) => {
            const isActive = activeCustomProductPackId === record.id;
            return (
              <div key={record.id} className={`rounded border px-2 py-2 ${isActive ? 'border-cyan-300/40 bg-cyan-400/10' : 'border-white/10 bg-black/10'}`}>
                <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/55">
                  <span>{record.label}</span>
                  <span>{record.changedKeys.length} deltas</span>
                </div>
                <div className="mt-1 text-[9px] text-white/40">
                  {record.baseProductPackLabel ?? 'Custom base'} · updated {formatCustomPackDate(record.updatedAt)}
                </div>
                <div className="mt-1 text-[9px] text-white/35">
                  {record.changedKeys.slice(0, 5).join(' · ') || 'No delta keys recorded'}
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <button onClick={() => applyCustomProductPackRecord(record)} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/65 hover:bg-white/10">Apply</button>
                  <button onClick={() => overwriteCustomProductPack(record)} disabled={isPublicLibrary} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/65 hover:bg-white/10 disabled:opacity-40">Overwrite</button>
                  <button onClick={() => duplicateCustomProductPack(record)} disabled={isPublicLibrary} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/65 hover:bg-white/10 disabled:opacity-40">Duplicate</button>
                  <button onClick={() => deleteCustomProductPack(record.id)} disabled={isPublicLibrary} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[8px] uppercase tracking-[0.18em] text-white/65 hover:bg-white/10 disabled:opacity-40">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-[9px] text-white/45">No custom pack clone saved yet.</div>
      )}
    </div>
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/40">
        <span>Gap-driven augment</span>
        <span>{augmentationSuggestions.length}</span>
      </div>
      {augmentationSuggestions.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {augmentationSuggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              onClick={() => applyProductPackBundle(suggestion.id)}
              title={suggestion.summary}
              className="rounded border border-white/10 bg-black/10 px-2 py-2 text-left text-white/70 transition-colors hover:bg-white/5"
            >
              <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest"><span>{suggestion.label}</span><span className="font-mono text-white/60">+{suggestion.coverageGain}</span></div>
              <div className="mt-1 text-[9px] text-white/45">to {suggestion.resultCoverageScore}% · {suggestion.coveredGapTargets.slice(0, 3).join(' · ') || 'No target preview'}</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-[9px] text-white/45">No augmentation suggestion available.</div>
      )}
    </div>
  </div>
);
