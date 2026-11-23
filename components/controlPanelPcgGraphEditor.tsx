import React from 'react';

import type { ParticleConfig } from '../types';
import {
  PCG_DEFAULT_GRAPH,
  resolvePcgGraph,
  serializePcgGraph,
  type PcgNode,
} from '../lib/pcgGraph';
import { Toggle } from './controlPanelParts';
import type { UpdateConfig } from './controlPanelGlobalDisplayEffectsShared';

/**
 * PCG rule graph editor (Phase 18 stage 3, 2nd step): a dedicated
 * minimal editor whose skeleton follows the Motion DAG editor
 * (node rows in execution order) but with NO free pin wiring —
 * the preceding-register reference IS the node order, so rows are
 * reordered with up/down buttons. The existing DagEditor and the
 * Motion DAG are not touched. Closed by default; while the graph
 * is disabled or untouched ('' = default graph) the scatter bake
 * is bit-identical to the legacy fixed-order pipeline.
 */

const KIND_LABELS: Record<PcgNode['kind'], string> = {
  sampler: 'Sampler（候補生成）',
  filter: 'Filter（受理フィルタ）',
  transformer: 'Transformer（変換）',
};

const OP_LABELS: Record<string, string> = {
  candidates: '候補点生成＋受理サンプリング',
  density: '密度',
  'height-band': '高度帯',
  slope: '斜度',
  species: '種別ゾーン分割',
  'align-normal': '法線整列＋仕上げ',
};

export const PcgGraphEditorBlock: React.FC<{
  config: ParticleConfig;
  updateConfig: UpdateConfig;
}> = ({ config, updateConfig }) => {
  const [open, setOpen] = React.useState(false);
  const nodes = resolvePcgGraph(config.gpgpuPcgGraphData);
  const isDefault = config.gpgpuPcgGraphData === '';

  const commit = (next: PcgNode[]) => {
    updateConfig('gpgpuPcgGraphData', serializePcgGraph(next));
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    // Register references follow position: re-point each node's
    // input at the node directly before it (the default wiring),
    // so a reorder never leaves a forward reference behind.
    commit(next.map((n, i) => (i === 0 ? { ...n, input: undefined } : { ...n, input: next[i - 1].id })));
  };
  const toggleNode = (index: number) => {
    commit(nodes.map((n, i) => (i === index ? { ...n, enabled: !n.enabled } : n)));
  };
  const setParam = (index: number, key: 'attempts' | 'strength', value: number) => {
    commit(nodes.map((n, i) => (i === index ? { ...n, params: { ...n.params, [key]: value } } : n)));
  };

  return (
    <div className="mt-2">
      <Toggle
        label="PCG Graph （ルールグラフ）"
        value={config.gpgpuPcgGraphEnabled}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => updateConfig('gpgpuPcgGraphEnabled', v)}
      />
      {config.gpgpuPcgGraphEnabled && (
        <>
          <button
            type="button"
            className="mt-1 text-[9px] uppercase tracking-widest opacity-70 hover:opacity-100"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? '▼ ノード列を閉じる' : '▶ ノード列を開く（PCGエディタ）'}
          </button>
          {open && (
            <div className="mt-1 space-y-1">
              {nodes.map((node, index) => (
                <div key={node.id} className="rounded border border-white/10 px-2 py-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px]">
                      {index + 1}. {KIND_LABELS[node.kind]}: {OP_LABELS[node.op] ?? node.op}
                      <span className="opacity-50">（入力: {index === 0 ? '地形候補' : nodes[index - 1].id}）</span>
                    </span>
                    <span className="flex gap-1">
                      <button type="button" className="px-1 text-[9px] opacity-70 hover:opacity-100" onClick={() => move(index, -1)}>↑</button>
                      <button type="button" className="px-1 text-[9px] opacity-70 hover:opacity-100" onClick={() => move(index, 1)}>↓</button>
                      <button type="button" className="px-1 text-[9px] opacity-70 hover:opacity-100" onClick={() => toggleNode(index)}>
                        {node.enabled ? '有効' : '無効'}
                      </button>
                    </span>
                  </div>
                  {node.kind === 'sampler' && (
                    <label className="mt-1 flex items-center gap-2 text-[9px] opacity-80">
                      Attempts（再抽選回数）
                      <input
                        type="number" min={1} max={10} step={1}
                        value={node.params?.attempts ?? 5}
                        onChange={(e) => setParam(index, 'attempts', Math.round(Number(e.target.value) || 5))}
                        className="w-14 bg-white/10 px-1"
                      />
                    </label>
                  )}
                  {(node.kind === 'filter' || node.op === 'align-normal') && (
                    <label className="mt-1 flex items-center gap-2 text-[9px] opacity-80">
                      Strength（強さ 0..1）
                      <input
                        type="number" min={0} max={1} step={0.05}
                        value={node.params?.strength ?? 1}
                        onChange={(e) => setParam(index, 'strength', Number(e.target.value))}
                        className="w-14 bg-white/10 px-1"
                      />
                    </label>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="text-[9px] opacity-70 hover:opacity-100"
                onClick={() => commit(PCG_DEFAULT_GRAPH.map((n) => ({ ...n })))}
              >
                既定グラフに戻す
              </button>
              <div className="text-[9px] leading-relaxed text-white/40">
                {isDefault
                  ? '現在は既定グラフです（従来の固定順序とビット同一）。'
                  : 'カスタムグラフが有効です。ノードは自分より前のノードの出力だけを参照します（先行レジスタ参照）。'}
              </div>
            </div>
          )}
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            散布の処理順（候補生成→密度・高度帯・斜度の受理→種別・法線整列）をノード列で並べ替えるグラフです（Phase 18 段階3）。既定グラフ・OFF では従来の散布と完全に同一です。
          </div>
        </>
      )}
    </div>
  );
};
