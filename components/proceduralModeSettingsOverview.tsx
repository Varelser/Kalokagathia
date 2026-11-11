import React from 'react';
import { buildExpressionAtlasPatch, EXPRESSION_ATLAS_BUNDLES } from '../lib/expressionAtlasBundles';
import { MATERIAL_MOOD_BUNDLES } from '../lib/materialMoodBundles';
import { getPostFxStackBundleById } from '../lib/postFxLibrary';
import { SOURCE_FAMILY_BUNDLES } from '../lib/sourceFamilyBundles';
import { Layers3 } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { Toggle } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelTabsShared';
import type { ProceduralGuide, ProceduralQuickPreset } from './proceduralModeSettingsCatalog';

const SectionTitle: React.FC<{ label: string }> = ({ label }) => (
  <div className="mb-2 flex items-center gap-2 text-[10px] uppercase font-bold text-white/60">
    <Layers3 size={12} /> {label}
  </div>
);

const SharedMaterialControls: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  updateConfig: UpdateConfig;
}> = ({ config, layerIndex, updateConfig }) => {
  const materialKey = (layerIndex === 2 ? 'layer2MaterialStyle' : 'layer3MaterialStyle') as 'layer2MaterialStyle' | 'layer3MaterialStyle';
  return (
    <Toggle
      label="Material Style"
      value={config[materialKey]}
      options={[
        { label: 'Classic', val: 'classic' },
        { label: 'Glass', val: 'glass' },
        { label: 'Hologram', val: 'hologram' },
        { label: 'Chrome', val: 'chrome' },
        { label: 'Halftone', val: 'halftone' },
      ]}
      onChange={(value) => updateConfig(materialKey, value)}
    />
  );
};

type DepictionArchitecture = {
  spatialSignature: string;
  contrastAxis: string;
  bestSources: string[];
  shapingFocus: string[];
};

type ProceduralModeOverviewProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  updateConfig: UpdateConfig;
  label: string;
  guide?: ProceduralGuide;
  depictionArchitecture: DepictionArchitecture;
  quickPresets: ProceduralQuickPreset[];
  applyQuickPreset: (patch: Partial<ParticleConfig>) => void;
  resetModeDefaults: () => void;
};

export const ProceduralModeOverview: React.FC<ProceduralModeOverviewProps> = ({
  config,
  layerIndex,
  updateConfig,
  label,
  guide,
  depictionArchitecture,
  quickPresets,
  applyQuickPreset,
  resetModeDefaults,
}) => (
  <>
<SectionTitle label={label} />
<div className="mb-3 text-[10px] uppercase tracking-widest text-white/35">
  Dedicated controls for the selected procedural mode.
</div>

{guide && (
  <div className="mb-3 rounded border border-white/5 bg-black/10 p-3">
    <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Mode guide</div>
    <div className="mb-2 text-[11px] leading-relaxed text-white/70">{guide.summary}</div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div>
        <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Best sources</div>
        <div className="flex flex-wrap gap-1">
          {guide.bestSources.map((item) => (
            <span key={item} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/70">
              {item}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Use cases</div>
        <div className="text-[10px] leading-relaxed text-white/60">{guide.useCases.join(' · ')}</div>
      </div>
      <div>
        <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Recommended ranges</div>
        <div className="space-y-1 text-[10px] text-white/60">
          {guide.recommendedRanges.map((item) => (
            <div key={item.label}><span className="text-white/35">{item.label}</span> · {item.value}</div>
          ))}
        </div>
      </div>
    </div>
    <div className="mt-2 space-y-1 text-[10px] leading-relaxed text-white/55">
      {guide.tips.map((tip) => (
        <div key={tip}>• {tip}</div>
      ))}
    </div>
  </div>
)}

<div className="mb-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Depiction architecture</div>
  <div className="mb-2 grid grid-cols-1 gap-3 md:grid-cols-3">
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Spatial signature</div>
      <div className="text-[10px] leading-relaxed text-white/68">{depictionArchitecture.spatialSignature}</div>
    </div>
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Contrast axis</div>
      <div className="text-[10px] leading-relaxed text-white/68">{depictionArchitecture.contrastAxis}</div>
    </div>
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Best sources</div>
      <div className="flex flex-wrap gap-1">
        {depictionArchitecture.bestSources.map((item) => (
          <span key={item} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/70">
            {item}
          </span>
        ))}
      </div>
    </div>
  </div>
  <div>
    <div className="mb-1 text-[9px] uppercase tracking-widest text-white/40">Shaping focus</div>
    <div className="flex flex-wrap gap-1">
      {depictionArchitecture.shapingFocus.map((item) => (
        <span key={item} className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] tracking-wide text-white/68">
          {item}
        </span>
      ))}
    </div>
  </div>
</div>

<SharedMaterialControls config={config} layerIndex={layerIndex} updateConfig={updateConfig} />

<div className="mt-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Expression atlas bundles</div>
  <div className="mb-3 text-[10px] leading-relaxed text-white/50">mood と source を別々に触らず、1クリックで表現方向を大きく切り替える束です。探索を高速化するための atlas です。</div>
  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
    {EXPRESSION_ATLAS_BUNDLES.map((bundle) => (
      <button
        key={bundle.id}
        onClick={() => applyQuickPreset(buildExpressionAtlasPatch(bundle, layerIndex))}
        className="rounded border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-white/30 hover:bg-white/10"
        title={bundle.summary}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-white/72">{bundle.label}</div>
          {bundle.postStackId ? (
            <span className="rounded border border-white/10 bg-black/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/45">
              {getPostFxStackBundleById(bundle.postStackId)?.label ?? 'Post Stack'}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-white/46">{bundle.summary}</div>
      </button>
    ))}
  </div>
</div>

<div className="mt-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Material mood bundles</div>
  <div className="mb-3 text-[10px] leading-relaxed text-white/50">質感の方向をまとめて切り替えます。mode を変えずに、glass / resin / ash / ion などの mood を素早く当てられます。</div>
  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
    {MATERIAL_MOOD_BUNDLES.map((bundle) => (
      <button
        key={bundle.id}
        onClick={() => applyQuickPreset(bundle.patch(layerIndex))}
        className="rounded border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-white/30 hover:bg-white/10"
        title={bundle.summary}
      >
        <div className="text-[10px] uppercase tracking-widest text-white/72">{bundle.label}</div>
        <div className="mt-1 text-[10px] leading-relaxed text-white/46">{bundle.summary}</div>
      </button>
    ))}
  </div>
</div>

<div className="mt-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Source family bundles</div>
  <div className="mb-3 text-[10px] leading-relaxed text-white/50">source を family 単位で即切り替えます。リング起点、文字起点、画像起点などをすぐ試せます。</div>
  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
    {SOURCE_FAMILY_BUNDLES.map((bundle) => (
      <button
        key={bundle.id}
        onClick={() => applyQuickPreset(bundle.patch(layerIndex))}
        className="rounded border border-white/10 bg-white/5 px-3 py-2 text-left transition-colors hover:border-white/30 hover:bg-white/10"
        title={bundle.summary}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-white/72">{bundle.label}</div>
          <span className="rounded border border-white/10 bg-black/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/45">{bundle.source}</span>
        </div>
        <div className="mt-1 text-[10px] leading-relaxed text-white/46">{bundle.summary}</div>
      </button>
    ))}
  </div>
</div>

<div className="mt-3 rounded border border-white/5 bg-black/10 p-3">
  <div className="mb-2 text-[10px] uppercase tracking-widest font-bold text-white/60">Quick tuning</div>
  <div className="mb-3 text-[10px] uppercase tracking-widest text-white/35">Apply a goal-oriented starting profile, then fine-tune the dedicated controls below.</div>
  <div className="flex flex-wrap gap-2">
    {quickPresets.map((preset) => (
      <button
        key={preset.label}
        onClick={() => applyQuickPreset(preset.patch(layerIndex))}
        className="rounded border border-white/15 bg-white/5 px-2 py-1 text-[9px] uppercase tracking-widest text-white/75 transition-colors hover:border-white/35 hover:bg-white/10"
        title={preset.description}
      >
        {preset.label}
      </button>
    ))}
    <button
      onClick={resetModeDefaults}
      className="rounded border border-white/10 bg-transparent px-2 py-1 text-[9px] uppercase tracking-widest text-white/45 transition-colors hover:border-white/25 hover:text-white/75"
    >
      Reset base
    </button>
  </div>
</div>
  </>
);
