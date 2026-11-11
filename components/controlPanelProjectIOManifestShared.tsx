import React from 'react';
import type { ParticleConfig, ProjectManifest } from '../types';
import { getDepictionArchitecture, isProceduralLayerMode } from '../lib/depictionArchitecture';

export const StatChip: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded border border-white/10 bg-black/20 px-2 py-1">
    <div className="text-[9px] uppercase tracking-widest text-white/35">{label}</div>
    <div className="text-[11px] font-bold tracking-wide text-white/85">{value}</div>
  </div>
);

export const CoverageRow: React.FC<{ label: string; values: string[] }> = ({ label, values }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-1 text-[9px] uppercase tracking-widest text-white/35">{label}</div>
    <div className="text-[10px] text-white/58">{values.length > 0 ? values.join(' · ') : 'None recorded'}</div>
  </div>
);

export const ProductPackScorecardRow: React.FC<{
  scorecards: ProjectManifest['coverage']['productPackScorecards'];
}> = ({ scorecards }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-2 text-[9px] uppercase tracking-widest text-white/35">Product pack scorecards</div>
    <div className="grid grid-cols-2 gap-2">
      {scorecards.map((scorecard) => (
        <div key={scorecard.id} className="rounded border border-white/10 bg-black/20 px-2 py-2">
          <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/45">
            <span>{scorecard.family}</span>
            <span className="font-mono text-white/75">{scorecard.coverageScore}%</span>
          </div>
          <div className="mt-1 text-[10px] font-medium text-white/80">{scorecard.label}</div>
          <div className="mt-1 text-[9px] text-white/45">{scorecard.targetHitCount}/{scorecard.targetTotal} · {scorecard.emphasis.slice(0, 2).join(' · ') || 'No emphasis'}</div>
          <div className="mt-1 text-[9px] text-white/35">solver · {scorecard.solverFamilies.slice(0, 2).join(' · ') || 'none'}</div>
          <div className="mt-1 text-[9px] text-white/30">specialist · {scorecard.specialistFamilies.slice(0, 2).join(' · ') || 'none'}</div>
          <div className="mt-1 text-[9px] text-white/25">physics · {scorecard.physicalFamilies.slice(0, 2).join(' · ') || 'none'}</div>
          <div className="mt-1 text-[9px] text-white/25">geometry · {scorecard.geometryFamilies.slice(0, 2).join(' · ') || 'none'}</div>
          <div className="mt-1 text-[9px] text-white/25">temporal · {scorecard.temporalFamilies.slice(0, 2).join(' · ') || 'none'}</div>
        </div>
      ))}
    </div>
  </div>
);

export const CoverageRollupRow: React.FC<{
  rollup: ProjectManifest['coverage']['coverageRollup'];
}> = ({ rollup }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-2 flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/35">
      <span>Overall pack coverage</span>
      <span className="font-mono text-white/75">{rollup.coverageScore}%</span>
    </div>
    <div className="text-[10px] text-white/58">
      {rollup.targetHitCount}/{rollup.targetTotal} targets · best {rollup.bestPackLabel ?? 'n/a'} {rollup.bestPackCoverageScore}% · avg {rollup.averagePackCoverageScore}%
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-white/45">
      <div>Source {rollup.sourceAxis.hitCount}/{rollup.sourceAxis.targetCount}</div>
      <div>Render {rollup.renderAxis.hitCount}/{rollup.renderAxis.targetCount}</div>
      <div>Post {rollup.postAxis.hitCount}/{rollup.postAxis.targetCount}</div>
      <div>Compute {rollup.computeAxis.hitCount}/{rollup.computeAxis.targetCount}</div>
      <div>Motion {rollup.motionAxis.hitCount}/{rollup.motionAxis.targetCount}</div>
      <div>Solver {rollup.solverAxis.hitCount}/{rollup.solverAxis.targetCount}</div>
      <div>Specialist {rollup.specialistAxis.hitCount}/{rollup.specialistAxis.targetCount}</div>
      <div>Physical {rollup.physicalAxis.hitCount}/{rollup.physicalAxis.targetCount}</div>
      <div>Geometry {rollup.geometryAxis.hitCount}/{rollup.geometryAxis.targetCount}</div>
      <div>Temporal {rollup.temporalAxis.hitCount}/{rollup.temporalAxis.targetCount}</div>
    </div>
  </div>
);

export const AugmentationSuggestionRow: React.FC<{
  suggestions: ProjectManifest['coverage']['augmentationSuggestions'];
}> = ({ suggestions }) => (
  <div className="rounded border border-white/10 bg-black/20 p-2">
    <div className="mb-2 text-[9px] uppercase tracking-widest text-white/35">Gap-driven augmentation</div>
    {suggestions.length > 0 ? (
      <div className="grid grid-cols-2 gap-2">
        {suggestions.map((suggestion) => (
          <div key={suggestion.id} className="rounded border border-white/10 bg-black/20 px-2 py-2">
            <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-widest text-white/45">
              <span>{suggestion.family}</span>
              <span className="font-mono text-white/75">+{suggestion.coverageGain}</span>
            </div>
            <div className="mt-1 text-[10px] font-medium text-white/80">{suggestion.label}</div>
            <div className="mt-1 text-[9px] text-white/45">to {suggestion.resultCoverageScore}% · {suggestion.coveredGapTargets.slice(0, 3).join(' · ') || 'No target preview'}</div>
          </div>
        ))}
      </div>
    ) : (
      <div className="text-[10px] text-white/45">No augmentation suggestion available.</div>
    )}
  </div>
);

export const LayerSummaryCard: React.FC<{
  label: string;
  enabled: boolean;
  mode: string;
  source: string | undefined;
  material: string | undefined;
  features: string[];
  capabilityFlags?: string[];
}> = ({ label, enabled, mode, source, material, features, capabilityFlags = [] }) => {
  const typedMode = mode as ParticleConfig['layer2Type'];
  const depiction = getDepictionArchitecture(typedMode);
  const procedural = isProceduralLayerMode(typedMode);
  return (
    <div className="rounded border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">{label}</div>
        <div className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${enabled ? 'border-emerald-400/30 text-emerald-200/80' : 'border-white/10 text-white/35'}`}>
          {enabled ? 'On' : 'Off'}
        </div>
      </div>
      <div className="space-y-1 text-[10px] text-white/55">
        <div><span className="text-white/35">Mode</span> · {mode}</div>
        <div><span className="text-white/35">Source</span> · {source ?? '—'}</div>
        <div><span className="text-white/35">Material</span> · {material ?? '—'}</div>
        <div><span className="text-white/35">Depiction</span> · {depiction.depictionClass}{procedural ? ' / procedural' : ''}</div>
        <div className="text-white/40">
          {features.length > 0 ? features.slice(0, 4).join(' · ') : 'No extra features recorded'}
        </div>
        {capabilityFlags.length > 0 ? <div className="text-[9px] text-white/35">Flags · {capabilityFlags.join(' · ')}</div> : null}
      </div>
    </div>
  );
};
