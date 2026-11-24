import React from 'react';

import type { ParticleConfig } from '../types';
import {
  PCG_DEFAULT_GRAPH,
  PCG_GRAPH_MAX_NODES,
  PCG_NODE_OPS,
  addPcgNode,
  removePcgNode,
  resolvePcgGraph,
  serializePcgGraph,
  type PcgNode,
  type PcgNodeKind,
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
  const [addKind, setAddKind] = React.useState<PcgNodeKind>('filter');
  const [addOp, setAddOp] = React.useState<string>(PCG_NODE_OPS.filter[0]);
  const nodes = resolvePcgGraph(config.gpgpuPcgGraphData);
  const isDefault = config.gpgpuPcgGraphData === '';
  const atMaxNodes = nodes.length >= PCG_GRAPH_MAX_NODES;
  const atMinNodes = nodes.length <= 1;

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
  const changeAddKind = (kind: PcgNodeKind) => {
    setAddKind(kind);
    setAddOp(PCG_NODE_OPS[kind][0]);
  };
  const addNode = () => {
    // addPcgNode validates the result; null = refused (cap reached
    // or unknown kind/op) and leaves the graph untouched.
    const next = addPcgNode(nodes, addKind, addOp);
    if (next) commit(next);
  };
  const removeNode = (index: number) => {
    // removePcgNode re-points inputs at the preceding node and
    // validates; null = refused (last node) and leaves it untouched.
    const next = removePcgNode(nodes, index);
    if (next) commit(next);
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
                      <button
                        type="button"
                        className="px-1 text-[9px] opacity-70 hover:opacity-100 disabled:opacity-30"
                        disabled={atMinNodes}
                        title={atMinNodes ? '最後の1ノードは削除できません（空グラフは既定グラフに戻ります）' : 'このノードを削除（入力参照は直前ノードへ付け直し）'}
                        onClick={() => removeNode(index)}
                      >
                        削除
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
              <div className="rounded border border-white/10 px-2 py-1">
                <div className="flex flex-wrap items-center gap-2 text-[9px]">
                  <span className="opacity-80">ノード追加（末尾へ）</span>
                  <select
                    value={addKind}
                    onChange={(e) => changeAddKind(e.target.value as PcgNodeKind)}
                    className="bg-white/10 px-1"
                    aria-label="追加するノードの種類"
                  >
                    {(Object.keys(PCG_NODE_OPS) as PcgNodeKind[]).map((kind) => (
                      <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                  <select
                    value={addOp}
                    onChange={(e) => setAddOp(e.target.value)}
                    className="bg-white/10 px-1"
                    aria-label="追加するノードの処理"
                  >
                    {PCG_NODE_OPS[addKind].map((op) => (
                      <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-1 opacity-70 hover:opacity-100 disabled:opacity-30"
                    disabled={atMaxNodes}
                    title={atMaxNodes ? `ノード数の上限 ${PCG_GRAPH_MAX_NODES} に達しています` : '選択したノードを末尾に追加（入力は直前ノード）'}
                    onClick={addNode}
                  >
                    追加
                  </button>
                  <span className="opacity-50">ノード数 {nodes.length} / {PCG_GRAPH_MAX_NODES}</span>
                </div>
                <div className="mt-1 text-[9px] leading-relaxed text-white/40">
                  追加したノードの入力は直前ノードを参照します。同種の処理を重ねて追加でき、IDは自動で一意になります。
                  上限 {PCG_GRAPH_MAX_NODES} ノードで追加は止まります。下限は1ノードで、最後の1つは削除できません
                  （空グラフは無効として既定グラフに戻るため）。削除すると後続ノードの入力は直前ノードへ付け直されます。
                </div>
              </div>
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
