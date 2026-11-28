import React from 'react';
import { Workflow } from 'lucide-react';
import type { ParticleConfig } from '../types';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle } from './controlPanelPlayTabShared';
import {
  pipelineNodeDefinition,
  PIPELINE_NODE_DEFINITIONS,
  type PipelineConversionProposal,
  type PipelineGraph,
  type PipelineGraphNode,
} from '../lib/pipelineGraph';
import { GPGPU_FORCE_CHUNK_NAMES } from '../lib/gpgpuForceOrder';
import { analyzePipelineWebGpuCoverage } from '../lib/pipelineCross';
import { parseGpgpuGroups } from '../lib/gpgpuGroups';
import { normalizeAttrExprs } from '../lib/gpgpuAttributes';
import {
  loadPipelineCore,
  savePipelineGraphToConfig,
} from '../lib/pipelinePersist';
import {
  addPipelineNode,
  applyPipelineConversionForWire,
  connectPipelineNodes,
  defaultPipelineCanvasLayoutStorage,
  disconnectPipelineEdge,
  layoutPipelineCanvasNodes,
  loadPipelineCanvasLayout,
  movePipelineColumnRow,
  persistPipelineCanvasLayout,
  pipelineColumnRows,
  pipelinePaletteKinds,
  projectPipelineCanvas,
  removePipelineNode,
  setPipelineNodeEnabled,
  updatePipelineNode,
  type PipelineCanvasLayout,
} from '../lib/pipelineCanvas';

/**
 * Pipeline canvas section (limit plan stage 5, slice S4):
 * the editable wiring canvas for the pipeline graph, next
 * to the Designer section in the Play tab (the Designer
 * showed the flow read-only; this is the same graph family
 * grown editable, per STAGE4's handover to stage 5).
 *
 * Decisions: STAGE5_DECISIONS.md.
 *   - 分岐A/C: one core, two views. The canvas view and the
 *     column view below edit the SAME graph state, and every
 *     edit saves through savePipelineGraphToConfig (S3),
 *     which writes the graph key and the compiled row-list
 *     keys together. Nothing here writes config keys
 *     directly.
 *   - 分岐B: a rule-box opens into its fine-grained fragment
 *     (a view projection via projectPipelineCanvas — the
 *     stored core keeps the box) and closes back into one
 *     box.
 *   - 分岐D: a type-mismatched wire is refused and the
 *     conversion proposal is shown; the conversion node is
 *     inserted only when the user presses the accept button.
 *   - Node positions are a view preference in localStorage
 *     (the Motion DAG editor's discipline); they never enter
 *     the config.
 *
 * Unused = legacy: with gpgpuPipelineGraph '' and no
 * row-list content the section shows the empty core and
 * writes nothing until the user actually edits.
 */

const NODE_W = 184;

interface Wire {
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
}

interface WireStart {
  from: string;
  fromPort?: string;
}

const KIND_BADGE: Record<string, string> = Object.fromEntries(
  Object.values(PIPELINE_NODE_DEFINITIONS).map((def) => [def.kind, def.label]),
);

export const PipelineCanvasSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;

  const configSlice = React.useMemo(() => ({
    gpgpuPipelineGraph: config.gpgpuPipelineGraph,
    gpgpuParticleRulesLive: config.gpgpuParticleRulesLive,
    gpgpuForceOrder: config.gpgpuForceOrder,
  }), [config.gpgpuPipelineGraph, config.gpgpuParticleRulesLive, config.gpgpuForceOrder]);

  const [graph, setGraph] = React.useState<PipelineGraph>(() => loadPipelineCore(configSlice).graph);
  const loadedFromRef = React.useRef(configSlice);
  // Resync when the config changes from OUTSIDE this section
  // (preset load, row-list adoption): our own saves write
  // exactly the graph we already hold, so they do not reload.
  React.useEffect(() => {
    const prev = loadedFromRef.current;
    if (prev.gpgpuPipelineGraph === configSlice.gpgpuPipelineGraph
      && prev.gpgpuParticleRulesLive === configSlice.gpgpuParticleRulesLive
      && prev.gpgpuForceOrder === configSlice.gpgpuForceOrder) return;
    loadedFromRef.current = configSlice;
    setGraph(loadPipelineCore(configSlice).graph);
    setOpenBoxes([]);
    setPending(null);
  }, [configSlice]);

  const [view, setView] = React.useState<'canvas' | 'column'>('canvas');
  const [openBoxes, setOpenBoxes] = React.useState<string[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [paletteKind, setPaletteKind] = React.useState('expression');
  const [status, setStatus] = React.useState('');
  const [pending, setPending] = React.useState<{ proposal: PipelineConversionProposal; wire: Wire } | null>(null);

  const [layout, setLayout] = React.useState<PipelineCanvasLayout>(() => {
    const storage = defaultPipelineCanvasLayoutStorage();
    return storage ? loadPipelineCanvasLayout(storage) : {};
  });
  const persistLayout = (next: PipelineCanvasLayout) => {
    setLayout(next);
    const storage = defaultPipelineCanvasLayoutStorage();
    if (storage) persistPipelineCanvasLayout(storage, next);
  };

  // 分岐F (S5): WebGPU route coverage for the current graph,
  // attributed per node with reasons. Pure analysis — the
  // configuration always saves; this only surfaces what
  // would be disabled on the WebGPU route and why.
  const webgpuCoverage = React.useMemo(() => analyzePipelineWebGpuCoverage(graph, {
    names: config.gpgpuAttrNames,
    names2: config.gpgpuAttrNames2,
    groupDefs: parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
    attrDynamicActive: (
      (config.gpgpuAttrDynEnabled && normalizeAttrExprs(config.gpgpuAttrExprs).some((e) => e.trim().length > 0))
      || (config.gpgpuAttrFeedbackEnabled && normalizeAttrExprs(config.gpgpuAttrExprs).some((e) => e.trim().length > 0))
      || (config.gpgpuAttrChainEnabled && normalizeAttrExprs(config.gpgpuAttrChainExprs).some((e) => e.trim().length > 0))
    ),
  }), [graph, config.gpgpuAttrNames, config.gpgpuAttrNames2, config.gpgpuGroupsData,
    config.gpgpuAttrDynEnabled, config.gpgpuAttrFeedbackEnabled, config.gpgpuAttrChainEnabled,
    config.gpgpuAttrExprs, config.gpgpuAttrChainExprs]);
  const webgpuDisabled = webgpuCoverage.nodes.filter((n) => n.disabled || n.reasons.length > 0);

  /** One save path for both views: S3's graph save, or a refusal message. */
  const commit = (next: PipelineGraph, message: string) => {
    const result = savePipelineGraphToConfig(next, {
      attrNames: config.gpgpuAttrNames,
      attrNames2: config.gpgpuAttrNames2,
    });
    if (!result.ok || !result.patch) {
      setStatus(`保存できませんでした（${result.reason ?? 'invalid-graph'}）。`);
      return;
    }
    loadedFromRef.current = {
      gpgpuPipelineGraph: result.patch.gpgpuPipelineGraph,
      gpgpuParticleRulesLive: result.patch.gpgpuParticleRulesLive,
      gpgpuForceOrder: result.patch.gpgpuForceOrder,
    };
    setGraph(next);
    write('gpgpuPipelineGraph', result.patch.gpgpuPipelineGraph);
    write('gpgpuParticleRulesLive', result.patch.gpgpuParticleRulesLive);
    write('gpgpuForceOrder', result.patch.gpgpuForceOrder);
    setStatus(message);
  };

  const projection = React.useMemo(
    () => projectPipelineCanvas(graph, openBoxes),
    [graph, openBoxes],
  );
  const positions = React.useMemo(
    () => layoutPipelineCanvasNodes(projection, layout),
    [projection, layout],
  );
  const rows = React.useMemo(() => pipelineColumnRows(graph), [graph]);
  const selected: PipelineGraphNode | null = React.useMemo(
    () => graph.nodes.find((n) => n.id === selectedId) ?? null,
    [graph, selectedId],
  );

  // -- canvas geometry ---------------------------------------------------------
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const canvasPoint = (event: { clientX: number; clientY: number }) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left + el.scrollLeft, y: event.clientY - rect.top + el.scrollTop };
  };
  const [dragNode, setDragNode] = React.useState<{ id: string; dx: number; dy: number } | null>(null);
  const [wireDrag, setWireDrag] = React.useState<{ wire: WireStart; x: number; y: number } | null>(null);

  const portPos = (nodeId: string, direction: 'input' | 'output', index: number) => {
    const p = positions[nodeId] ?? { x: 12, y: 12 };
    return direction === 'output'
      ? { x: p.x + NODE_W, y: p.y + 30 + index * 16 }
      : { x: p.x, y: p.y + 30 + index * 16 };
  };
  const wirePath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const bend = Math.max(30, Math.abs(to.x - from.x) / 2);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  };

  React.useEffect(() => {
    if (!dragNode && !wireDrag) return;
    const onMove = (event: PointerEvent) => {
      const point = canvasPoint(event);
      if (dragNode) {
        persistLayout({
          ...layout,
          [dragNode.id]: { x: Math.max(0, point.x - dragNode.dx), y: Math.max(0, point.y - dragNode.dy) },
        });
      }
      if (wireDrag) setWireDrag({ ...wireDrag, x: point.x, y: point.y });
    };
    const onUp = (event: PointerEvent) => {
      if (wireDrag) {
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-pipeline-input]');
        if (hit) {
          const wire: Wire = {
            ...wireDrag.wire,
            to: hit.getAttribute('data-node') ?? '',
            toPort: hit.getAttribute('data-port') ?? undefined,
          };
          attemptWire(wire);
        }
      }
      setDragNode(null);
      setWireDrag(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragNode, wireDrag, graph, layout]);

  // -- editing actions -----------------------------------------------------------
  const attemptWire = (wire: Wire) => {
    if (isPublicLibrary) return;
    const result = connectPipelineNodes(graph, wire);
    if (result.ok) {
      setPending(null);
      commit(result.graph, '配線しました。');
      return;
    }
    if (result.proposal) {
      setPending({ proposal: result.proposal, wire });
      setStatus('型が合わないため、そのままでは繋げません。下の提案を確認してください。');
      return;
    }
    setPending(null);
    setStatus(`繋げませんでした（${result.reason}）。`);
  };

  const acceptProposal = () => {
    if (!pending) return;
    const next = applyPipelineConversionForWire(graph, pending.wire, pending.proposal);
    if (!next) {
      setStatus('提案を適用できませんでした。');
      return;
    }
    setPending(null);
    commit(next, '変換ノードを挿入して配線しました。変換はキャンバス上に常に見えます。');
  };

  const handleAdd = () => {
    const params = paletteKind === 'force-chunk'
      ? { chunk: GPGPU_FORCE_CHUNK_NAMES.find((name) => !graph.nodes.some((n) => n.params?.chunk === name)) ?? 'wind' }
      : paletteKind === 'expression'
        ? { expr: '' }
        : undefined;
    const result = addPipelineNode(graph, paletteKind, params ? { params } : undefined);
    if (!result) {
      setStatus('ノードを追加できませんでした。');
      return;
    }
    setSelectedId(result.node.id);
    commit(result.graph, `ノード「${result.node.label}」を追加しました。`);
  };

  const handleRemove = (nodeId: string) => {
    const next = removePipelineNode(graph, nodeId);
    if (!next) return;
    setOpenBoxes(openBoxes.filter((id) => id !== nodeId));
    if (selectedId === nodeId) setSelectedId(null);
    commit(next, 'ノードを削除しました。');
  };

  const handleToggle = (node: PipelineGraphNode) => {
    const next = setPipelineNodeEnabled(graph, node.id, !node.enabled);
    if (next) commit(next, `「${node.label}」を${node.enabled ? '無効' : '有効'}にしました。`);
  };

  const handleMoveRow = (nodeId: string, delta: -1 | 1) => {
    const next = movePipelineColumnRow(graph, nodeId, delta);
    if (next) commit(next, '列の順序を変更しました（キャンバスと同じデータです）。');
  };

  const toggleBox = (boxId: string, open: boolean) => {
    setOpenBoxes(open ? [...openBoxes, boxId] : openBoxes.filter((id) => id !== boxId));
  };

  const isFragmentNode = (node: PipelineGraphNode): string | null => {
    for (const boxId of openBoxes) {
      if (node.id === `${boxId}:cond` || node.id === `${boxId}:action`) return boxId;
    }
    return null;
  };

  const canvasHeight = Math.max(
    430,
    ...projection.nodes.map((n) => (positions[n.id]?.y ?? 0) + 130),
  );

  const buttonClass = 'px-3 py-1 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30';
  const smallButtonClass = 'px-2 py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest text-white/70 hover:bg-white/20 disabled:opacity-30';

  return (
    <section>
      <SectionTitle icon={<Workflow size={12} />}>Pipeline Canvas · 配線キャンバス</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        ルールとフォースを型付きの配線で組む編集面です（第5段）。キャンバスと列ビューは同じデータの両方の見え方で、どちらの編集も同じ保存（グラフ＋行リストの両表現）へ反映されます。Rule
        箱は開くと条件・作用の細かいノードに展開し、閉じると1箱に戻ります。型が合わない配線は黙って変換せず、変換ノードの挿入を提案します（入れるかどうかはボタンで決めます）。ノードの位置は表示だけの設定で、構成には入りません。未使用の間は従来の行リスト編集のまま何も変わりません。
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => setView('canvas')}
          className={view === 'canvas' ? 'px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest' : buttonClass}>
          キャンバス
        </button>
        <button onClick={() => setView('column')}
          className={view === 'column' ? 'px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest' : buttonClass}>
          列ビュー
        </button>
        <span className="text-[10px] text-white/40">
          ノード {graph.nodes.length} 件・配線 {graph.edges.length} 件
          {graph.nodes.length === 0 ? '（未使用：従来どおり）' : ''}
        </span>
      </div>

      {view === 'canvas' ? (
        <div>
          <div
            ref={canvasRef}
            className="relative overflow-auto rounded border border-white/10 bg-black/30"
            style={{ height: 430, backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
          >
            <svg className="pointer-events-none absolute left-0 top-0" width={1200} height={canvasHeight}>
              {projection.edges.filter((e) => e.kind === 'data').map((edge) => {
                const fromNode = projection.nodes.find((n) => n.id === edge.from);
                const toNode = projection.nodes.find((n) => n.id === edge.to);
                if (!fromNode || !toNode) return null;
                const fromDef = pipelineNodeDefinition(fromNode.kind);
                const toDef = pipelineNodeDefinition(toNode.kind);
                const fromIndex = Math.max(0, fromDef?.outputs.findIndex((p) => p.name === edge.fromPort) ?? 0);
                const toIndex = Math.max(0, toDef?.inputs.findIndex((p) => p.name === edge.toPort) ?? 0);
                return (
                  <path key={edge.id} d={wirePath(portPos(edge.from, 'output', fromIndex), portPos(edge.to, 'input', toIndex))}
                    fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.2} />
                );
              })}
              {wireDrag && (
                <line x1={portPos(wireDrag.wire.from, 'output', 0).x} y1={portPos(wireDrag.wire.from, 'output', 0).y}
                  x2={wireDrag.x} y2={wireDrag.y} stroke="#fff" strokeWidth={1.2} strokeDasharray="4 3" />
              )}
            </svg>
            {projection.nodes.map((node) => {
              const def = pipelineNodeDefinition(node.kind);
              if (!def) return null;
              const p = positions[node.id] ?? { x: 12, y: 12 };
              const fragmentOf = isFragmentNode(node);
              const isBox = node.kind === 'rule-box';
              const dimmed = !node.enabled || node.dangling === true;
              return (
                <div
                  key={node.id}
                  className={`absolute rounded border bg-neutral-900/95 shadow ${selectedId === node.id ? 'border-white' : 'border-white/25'}`}
                  style={{ left: p.x, top: p.y, width: NODE_W, opacity: dimmed ? 0.5 : 1 }}
                  onClick={() => { if (!fragmentOf) setSelectedId(node.id); }}
                >
                  <div
                    className="flex cursor-move items-center justify-between px-2 py-1"
                    onPointerDown={(event) => {
                      if ((event.target as HTMLElement).closest('button')) return;
                      const point = canvasPoint(event);
                      setDragNode({ id: node.id, dx: point.x - p.x, dy: point.y - p.y });
                    }}
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/85">
                      {KIND_BADGE[node.kind] ?? node.kind}
                    </span>
                    <span className="flex items-center gap-1">
                      {isBox && (
                        <button onClick={() => toggleBox(node.id, true)} disabled={isPublicLibrary}
                          className="px-1 py-0.5 text-[8px] rounded bg-white/10 text-white/60">開く</button>
                      )}
                      {fragmentOf && (
                        <button onClick={() => toggleBox(fragmentOf, false)}
                          className="px-1 py-0.5 text-[8px] rounded bg-white text-black font-bold">閉じる</button>
                      )}
                      {!fragmentOf && (
                        <>
                          <button onClick={() => handleToggle(node)} disabled={isPublicLibrary}
                            className="px-1 py-0.5 text-[8px] rounded bg-white/10 text-white/60">
                            {node.enabled ? '無効化' : '有効化'}
                          </button>
                          <button onClick={() => handleRemove(node.id)} disabled={isPublicLibrary}
                            className="px-1 py-0.5 text-[8px] rounded bg-white/10 text-white/60">✕</button>
                        </>
                      )}
                    </span>
                  </div>
                  <div className="px-2 pb-1 text-[10px] text-white/90">
                    {node.label.length > 26 ? `${node.label.slice(0, 26)}…` : node.label}
                  </div>
                  <div className="relative px-2 pb-2">
                    {def.inputs.map((port, i) => (
                      <div key={port.name} className="flex items-center gap-1 text-[9px] text-white/45">
                        <span
                          data-pipeline-input
                          data-node={node.id}
                          data-port={port.name}
                          className="absolute h-3 w-3 rounded-full border border-black bg-white/80"
                          style={{ left: -7, top: 24 + i * 16 }}
                        />
                        <span>{port.name}</span>
                        <span className="text-white/30">{port.type}</span>
                      </div>
                    ))}
                    {def.outputs.map((port, i) => (
                      <div key={port.name} className="flex items-center justify-end gap-1 text-[9px] text-white/45">
                        <span>{port.name}</span>
                        <span className="text-white/30">{port.type}</span>
                        <button
                          aria-label={`output ${node.id}.${port.name}`}
                          disabled={isPublicLibrary || Boolean(fragmentOf)}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            const point = canvasPoint(event);
                            setWireDrag({ wire: { from: node.id, fromPort: port.name }, x: point.x, y: point.y });
                          }}
                          className="absolute h-3 w-3 cursor-crosshair rounded-full border border-black bg-white"
                          style={{ right: -7, top: 24 + i * 16 }}
                        />
                      </div>
                    ))}
                    {def.inputs.length === 0 && def.outputs.length === 0 && (
                      <div className="text-[9px] text-white/35">ポートなし（保持専用）</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <select value={paletteKind} onChange={(event) => setPaletteKind(event.target.value)}
              disabled={isPublicLibrary} aria-label="追加するノードの種類"
              className="rounded border border-white/15 bg-neutral-900 px-2 py-1 text-[10px] text-white/80">
              {pipelinePaletteKinds().map((kind) => (
                <option key={kind} value={kind} className="bg-neutral-900">
                  {KIND_BADGE[kind] ?? kind}（{kind}）
                </option>
              ))}
            </select>
            <button onClick={handleAdd} disabled={isPublicLibrary} className={smallButtonClass}>+ ノード追加</button>
            <button onClick={() => { persistLayout({}); }} className={smallButtonClass}>自動整列</button>
            <span className="text-[9px] text-white/40">出力ポート（右の白丸）から入力ポート（左の丸）へドラッグして配線します</span>
          </div>

          {graph.edges.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {graph.edges.map((edge) => (
                <div key={edge.id} className="flex flex-wrap items-center gap-2 rounded border border-white/10 px-2 py-1">
                  <span className="text-[10px] text-white/70">
                    {edge.from}{edge.fromPort ? `.${edge.fromPort}` : ''} → {edge.to}{edge.toPort ? `.${edge.toPort}` : ''}
                    <span className="ml-2 text-white/35">{edge.kind}</span>
                  </span>
                  <span className="flex-1" />
                  <button onClick={() => {
                    const next = disconnectPipelineEdge(graph, edge.id);
                    if (next) commit(next, '配線を外しました。');
                  }} disabled={isPublicLibrary} className={smallButtonClass}>外す</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">ルール行（上から評価順）</p>
            {rows.rules.length === 0 && <p className="text-[11px] text-white/35">ルール行はまだありません。</p>}
            {rows.rules.map((node, i) => (
              <div key={node.id} className="flex items-center gap-2 rounded border border-white/10 px-2 py-1.5 mb-1">
                <span className="text-[10px] text-white/35">{i + 1}</span>
                <span className="text-[11px] text-white/85">{node.label}</span>
                <span className="text-[9px] text-white/30">{KIND_BADGE[node.kind] ?? node.kind}</span>
                <span className="flex-1" />
                <button onClick={() => handleMoveRow(node.id, -1)} disabled={isPublicLibrary || i === 0} className={smallButtonClass}>▲</button>
                <button onClick={() => handleMoveRow(node.id, 1)} disabled={isPublicLibrary || i === rows.rules.length - 1} className={smallButtonClass}>▼</button>
                <button onClick={() => handleToggle(node)} disabled={isPublicLibrary} className={smallButtonClass}>{node.enabled ? '無効化' : '有効化'}</button>
                <button onClick={() => handleRemove(node.id)} disabled={isPublicLibrary} className={smallButtonClass}>削除</button>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">フォース列（適用順）</p>
            {rows.forces.length === 0 && <p className="text-[11px] text-white/35">フォース列はまだありません（既定順）。</p>}
            {rows.forces.map((node, i) => (
              <div key={node.id} className="flex items-center gap-2 rounded border border-white/10 px-2 py-1.5 mb-1">
                <span className="text-[10px] text-white/35">{i + 1}</span>
                <span className="text-[11px] text-white/85">{String(node.params?.chunk ?? node.label)}</span>
                <span className="flex-1" />
                <button onClick={() => handleMoveRow(node.id, -1)} disabled={isPublicLibrary || i === 0} className={smallButtonClass}>▲</button>
                <button onClick={() => handleMoveRow(node.id, 1)} disabled={isPublicLibrary || i === rows.forces.length - 1} className={smallButtonClass}>▼</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {graph.nodes.length > 0 && webgpuDisabled.length > 0 && (
        <div className="mt-3 rounded border border-white/20 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-bold text-white/90">
            WebGPU 経路では一部が無効化されます（分岐F）— 構成の保存は常にできます
          </p>
          {webgpuDisabled.map((n) => (
            <p key={n.nodeId} className="text-[11px] leading-relaxed text-white/60">
              {n.ruleId ?? n.nodeId}: {n.reasons.map((r) => r.message).join(' ')}
            </p>
          ))}
        </div>
      )}

      {pending && (
        <div className="mt-3 rounded border-2 border-white/50 bg-white/5 px-3 py-2">
          <p className="text-[11px] font-bold text-white/90">変換ノードの挿入を提案します（分岐D）</p>
          <p className="text-[11px] leading-relaxed text-white/60">
            {pending.proposal.fromType} を {pending.proposal.toType} に直接は繋げません。{pending.proposal.reason}。
            黙って変換はしません — 入れるかどうかはあなたが決めます。
          </p>
          <div className="flex gap-2 mt-2">
            <button onClick={acceptProposal} disabled={isPublicLibrary}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30">
              {pending.proposal.insertNodeKinds.map((k) => KIND_BADGE[k] ?? k).join(' → ') || '変換'}を挿入する
            </button>
            <button onClick={() => setPending(null)} className={buttonClass}>やめる</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="mt-3 rounded border border-white/10 px-3 py-2">
          <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
            選択中: {KIND_BADGE[selected.kind] ?? selected.kind}（{selected.id}）
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" value={selected.label} aria-label="ノードのラベル"
              disabled={isPublicLibrary}
              onChange={(event) => {
                const next = updatePipelineNode(graph, selected.id, { label: event.target.value });
                if (next) setGraph(next);
              }}
              onBlur={() => commit(graph, 'ラベルを変更しました。')}
              className="w-44 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            />
            {selected.kind === 'expression' && (
              <input type="text" value={String(selected.params?.expr ?? '')} aria-label="条件式"
                placeholder="条件式（例: age > 0.5）" disabled={isPublicLibrary}
                onChange={(event) => {
                  const next = updatePipelineNode(graph, selected.id, {
                    params: { ...(selected.params ?? {}), expr: event.target.value },
                  });
                  if (next) setGraph(next);
                }}
                onBlur={() => commit(graph, '条件式を変更しました。')}
                className="w-64 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
              />
            )}
            {selected.kind === 'force-chunk' && (
              <select value={String(selected.params?.chunk ?? '')} aria-label="フォースチャンク"
                disabled={isPublicLibrary}
                onChange={(event) => {
                  const next = updatePipelineNode(graph, selected.id, {
                    params: { ...(selected.params ?? {}), chunk: event.target.value },
                  });
                  if (next) commit(next, 'フォースチャンクを変更しました。');
                }}
                className="rounded border border-white/15 bg-neutral-900 px-2 py-1 text-[10px] text-white/80">
                {GPGPU_FORCE_CHUNK_NAMES.map((name) => (
                  <option key={name} value={name} className="bg-neutral-900">{name}</option>
                ))}
              </select>
            )}
            {selected.kind === 'rule-box' && !openBoxes.includes(selected.id) && (
              <button onClick={() => toggleBox(selected.id, true)} className={smallButtonClass}>箱を開く</button>
            )}
            {selected.kind === 'rule-box' && openBoxes.includes(selected.id) && (
              <button onClick={() => toggleBox(selected.id, false)} className={smallButtonClass}>箱を閉じる</button>
            )}
          </div>
        </div>
      )}

      {status && <p className="text-[11px] text-white/55 mt-3">{status}</p>}
    </section>
  );
};
