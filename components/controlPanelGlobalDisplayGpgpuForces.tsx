import React from 'react';

import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { GlobalDisplayGpgpuForcesCoreSection } from './controlPanelGlobalDisplayGpgpuForcesCore';
import { GlobalDisplayGpgpuForcesMorphSection } from './controlPanelGlobalDisplayGpgpuForcesMorph';
import { GlobalDisplayGpgpuForcesAuxColorSection } from './controlPanelGlobalDisplayGpgpuForcesAuxColor';
import { GlobalDisplayGpgpuForcesMapsSection } from './controlPanelGlobalDisplayGpgpuForcesMaps';
import { GpgpuForceOrderGraph } from './controlPanelGpgpuForceOrderGraph';

// TD §7 stage 2 (Phase 34): the forces unit coexists as the
// classic slider sections (節) and the force-order graph
// (グラフ), switched here at the unit level — the same
// coexistence pattern as the Audio tab in stage 1.
const FORCES_VIEW_STORAGE_KEY = 'kalokagathia.gpgpuForcesView.v1';
type ForcesView = 'panel' | 'graph';
const loadForcesView = (): ForcesView => {
  try {
    return localStorage.getItem(FORCES_VIEW_STORAGE_KEY) === 'graph' ? 'graph' : 'panel';
  } catch {
    return 'panel';
  }
};

export const GlobalDisplayGpgpuForcesSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => {
  const [view, setView] = React.useState<ForcesView>(loadForcesView);
  const changeView = (next: ForcesView) => {
    setView(next);
    try { localStorage.setItem(FORCES_VIEW_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  };
  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-white/45">Forces 表示</span>
        <span className="flex items-center gap-1 rounded-md bg-[#171717] p-1" title="フォース節の表示: 節（スライダ）/ グラフ（適用順）">
          {(['panel', 'graph'] as ForcesView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={`rounded px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                view === v ? 'bg-white/[0.14] text-white' : 'text-[#a3a3a3] hover:text-white'
              }`}
            >
              {v === 'panel' ? '節' : 'グラフ'}
            </button>
          ))}
        </span>
      </div>
      {view === 'graph' ? (
        <GpgpuForceOrderGraph config={config} updateConfig={updateConfig} />
      ) : (
        <>
          <GlobalDisplayGpgpuForcesCoreSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuForcesMorphSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuForcesAuxColorSection config={config} updateConfig={updateConfig} />
          <GlobalDisplayGpgpuForcesMapsSection config={config} updateConfig={updateConfig} />
        </>
      )}
    </>
  );
};
