import React from 'react';
import { Layers3 } from 'lucide-react';
import type { ProjectManifest } from '../types';
import { StatChip, CoverageRow, CoverageRollupRow, AugmentationSuggestionRow, ProductPackScorecardRow, LayerSummaryCard } from './controlPanelProjectIOShared';

const InlineTags: React.FC<{ values: string[]; emptyLabel?: string; tone?: 'neutral' | 'warning' }> = ({ values, emptyLabel = 'None', tone = 'neutral' }) => (
  <div className="flex flex-wrap gap-1">
    {values.length > 0 ? values.map((value) => (
      <span
        key={value}
        className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${tone === 'warning' ? 'border-amber-300/20 bg-amber-500/10 text-amber-100/80' : 'border-white/10 bg-black/20 text-white/55'}`}
      >
        {value}
      </span>
    )) : <span className="text-[10px] text-white/35">{emptyLabel}</span>}
  </div>
);

export const ControlPanelProjectIOManifestSection: React.FC<{ projectManifest: ProjectManifest }> = ({ projectManifest }) => {
  return (
    <>
      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/50">
          <Layers3 size={11} /> Schema-aware snapshot
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Presets" value={projectManifest.stats.presetCount} />
          <StatChip label="Sequence" value={projectManifest.stats.sequenceCount} />
          <StatChip label="Enabled Layers" value={projectManifest.stats.enabledLayerCount} />
          <StatChip label="Materials" value={projectManifest.stats.distinctMaterialCount} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <StatChip label="Media" value={projectManifest.stats.mediaSourceCount} />
          <StatChip label="Text" value={projectManifest.stats.textSourceCount} />
          <StatChip label="Procedural" value={projectManifest.stats.proceduralModeCount} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Methods" value={projectManifest.stats.depictionMethodCount} />
          <StatChip label="Motions" value={projectManifest.stats.motionFamilyCount} />
          <StatChip label="Backends" value={projectManifest.stats.computeBackendCount} />
          <StatChip label="GPGPU" value={projectManifest.stats.gpgpuFeatureCount} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Sources" value={projectManifest.stats.sourceFamilyCount} />
          <StatChip label="Renders" value={projectManifest.stats.renderFamilyCount} />
          <StatChip label="Post FX" value={projectManifest.stats.postFamilyCount} />
          <StatChip label="Physical" value={projectManifest.stats.physicalFamilyCount} />
          <StatChip label="Geometry" value={projectManifest.stats.geometryFamilyCount} />
          <StatChip label="Temporal" value={projectManifest.stats.temporalFamilyCount} />
          <StatChip label="Pack Families" value={projectManifest.stats.productPackFamilyCount} />
          <StatChip label="Product Packs" value={projectManifest.stats.productPackCount} />
          <StatChip label="Pack Scorecards" value={projectManifest.stats.productPackScorecardCount} />
          <StatChip label="Active Pack Score" value={projectManifest.stats.activeProductPackCoverageScore} />
          <StatChip label="Current Cover" value={projectManifest.stats.currentCoverageScore} />
          <StatChip label="Overall Cover" value={projectManifest.stats.overallCoverageScore} />
          <StatChip label="Best Pack" value={projectManifest.stats.bestPackCoverageScore} />
          <StatChip label="Solver" value={projectManifest.stats.solverFamilyCount} />
          <StatChip label="Specialist" value={projectManifest.stats.specialistFamilyCount} />
          <StatChip label="Post Stacks" value={projectManifest.stats.postStackTemplateCount} />
          <StatChip label="Gap Targets" value={projectManifest.stats.coverageGapCount} />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <CoverageRow label="Motion families" values={projectManifest.coverage.motionFamilies} />
          <CoverageRow label="Compute backends" values={projectManifest.coverage.computeBackends} />
          <CoverageRow label="Source families" values={projectManifest.coverage.sourceFamilies} />
          <CoverageRow label="Render families" values={projectManifest.coverage.renderFamilies} />
          <CoverageRow label="Post families" values={projectManifest.coverage.postFamilies} />
          <CoverageRow label="Solver families" values={projectManifest.coverage.solverFamilies} />
          <CoverageRow label="Specialist families" values={projectManifest.coverage.specialistFamilies} />
          <CoverageRow label="Physical subfamilies" values={projectManifest.coverage.physicalFamilies} />
          <CoverageRow label="Geometry subfamilies" values={projectManifest.coverage.geometryFamilies} />
          <CoverageRow label="Temporal subfamilies" values={projectManifest.coverage.temporalFamilies} />
          <CoverageRow label="Product pack families" values={projectManifest.coverage.productPackFamilies} />
          <CoverageRow label="Product packs" values={projectManifest.coverage.productPacks} />
          <CoverageRow label="Post stack templates" values={projectManifest.coverage.postStackTemplates} />
          <CoverageRow label="Active post stack" values={projectManifest.coverage.activePostStackId ? [projectManifest.coverage.activePostStackId] : []} />
          <CoverageRow label="Active product pack" values={projectManifest.coverage.activeProductPackId ? [projectManifest.coverage.activeProductPackId] : []} />
          <CoverageRow label="Gap targets" values={projectManifest.coverage.gapTargets} />
          <CoverageRollupRow rollup={projectManifest.coverage.coverageRollup} />
          <AugmentationSuggestionRow suggestions={projectManifest.coverage.augmentationSuggestions} />
          <ProductPackScorecardRow scorecards={projectManifest.coverage.productPackScorecards} />
        </div>
        <div className="mt-2 text-[10px] uppercase tracking-widest text-white/35">
          Manifest schema v{projectManifest.schemaVersion} · serialization schema v{projectManifest.serializationSchemaVersion} · mode/source/material/coverage summary included in export.
        </div>
      </div>

      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/45">Capability-aware routing</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {projectManifest.execution.map((entry) => (
            <div key={entry.key} className="rounded border border-white/10 bg-black/20 p-2 text-[10px] text-white/60">
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="font-bold uppercase tracking-widest text-white/78">{entry.label}</div>
                <div className={`rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${entry.enabled ? 'border-emerald-300/25 text-emerald-100/80' : 'border-white/10 text-white/35'}`}>
                  {entry.enabled ? 'On' : 'Off'}
                </div>
              </div>
              <div><span className="text-white/35">Mode</span> · {entry.mode}</div>
              <div><span className="text-white/35">Render</span> · {entry.renderClass}</div>
              <div><span className="text-white/35">Simulation</span> · {entry.simulationClass}</div>
              <div><span className="text-white/35">Engine</span> · {entry.resolvedEngine} <span className="text-white/30">(requested {entry.requestedEngine})</span></div>
              <div><span className="text-white/35">Path</span> · {entry.path}</div>
              <div><span className="text-white/35">Override</span> · {entry.overrideId}{entry.hybridKind ? <span className="text-white/30"> · hybrid {entry.hybridKind}</span> : null}</div>
              {entry.proceduralSystemId ? <div><span className="text-white/35">Procedural</span> · {entry.proceduralSystemId}</div> : null}
              <div className="mt-2 text-[9px] uppercase tracking-widest text-white/35">Capability flags</div>
              <div className="mt-1"><InlineTags values={entry.capabilityFlags} emptyLabel="No flags" tone={entry.capabilityFlags.includes('mobile-risky') || entry.capabilityFlags.includes('export-only') ? 'warning' : 'neutral'} /></div>
              <div className="mt-2 text-[9px] text-white/40">{entry.reason}</div>
              {entry.notes.length > 0 ? <div className="mt-2"><InlineTags values={entry.notes} emptyLabel="No notes" /></div> : null}
              <div className="mt-2 text-[9px] uppercase tracking-widest text-white/35">Scene branches</div>
              <div className="mt-1"><InlineTags values={entry.sceneBranches ?? []} emptyLabel="No branches" /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/45">Current manifest layers</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {projectManifest.layers.map((layer) => (
            <LayerSummaryCard
              key={layer.key}
              label={layer.label}
              enabled={layer.enabled}
              mode={layer.mode}
              source={layer.source}
              material={layer.material}
              features={layer.features}
              capabilityFlags={layer.capabilityFlags}
            />
          ))}
        </div>
      </div>
    </>
  );
};
