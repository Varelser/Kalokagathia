import React from 'react';
import { Share2 } from 'lucide-react';
import type { Layer2Type, MotionDagNode, MotionDagNodeKind } from '../types';
import { MOTION_OPTIONS } from './controlPanelMotionCatalog';
import { MOTION_DAG_MAX_NODES } from '../lib/motionDag';

/**
 * Motion DAG editor (free-wiring stage 4): a canvas where layer motion
 * nodes are wired by dragging from an output port to an input port.
 * Registers: 0 = main (input), 1 = source, node i (0-based) = register
 * i + 2, displayed as N{i + 1}. Inputs only accept earlier registers,
 * so the graph is acyclic by construction. Node positions are a view
 * preference kept in localStorage; they never enter the config.
 */

export const DAG_NODE_WIDTH = 168;
const SRC_W = 118;

export function dagRegisterLabel(reg: number): string {
  if (reg === 0) return '入力';
  if (reg === 1) return 'source';
  return `N${reg - 1}`;
}

/** Remove a node and remap register references (deleted -> main, later -> shift down). */
export function removeDagNode(
  nodes: MotionDagNode[],
  output: number,
  index: number,
): { nodes: MotionDagNode[]; output: number } {
  const deletedReg = index + 2;
  const remap = (reg: number) => (reg === deletedReg ? 0 : reg > deletedReg ? reg - 1 : reg);
  const next = nodes
    .filter((_, i) => i !== index)
    .map((node) => ({ ...node, inA: remap(node.inA), inB: remap(node.inB) }));
  let nextOutput = output;
  if (output === deletedReg) nextOutput = next.length + 1;
  else if (output > deletedReg) nextOutput = output - 1;
  return { nodes: next, output: nextOutput };
}

function autoPos(index: number): { x: number; y: number } {
  return { x: 150 + (index % 3) * 196, y: 16 + Math.floor(index / 3) * 142 };
}

const KIND_LABELS: Record<MotionDagNodeKind, string> = {
  motion: 'motion',
  mix: 'mix',
  scale: 'scale',
  source: 'source',
  copy: 'copy',
};

export const MotionDagEditor: React.FC<{
  nodes: MotionDagNode[];
  output: number;
  onChange: (nodes: MotionDagNode[]) => void;
  onOutputChange: (output: number) => void;
  layoutKey: string;
  currentTheme: 'white' | 'black';
}> = ({ nodes, output, onChange, onOutputChange, layoutKey, currentTheme }) => {
  const selectClass = `w-full text-[10px] p-0.5 rounded border-none outline-none cursor-pointer ${
    currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
  }`;
  const storageKey = `kalokagathia.dagLayout.v1.${layoutKey}`;
  const [positions, setPositions] = React.useState<Record<number, { x: number; y: number }>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as Record<number, { x: number; y: number }>) : {};
    } catch {
      return {};
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(positions));
    } catch {
      /* view preference only */
    }
  }, [positions, storageKey]);
  const posOf = (index: number) => positions[index] ?? autoPos(index);
  const effectiveOutput = output >= 0 ? output : nodes.length + 1;

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const canvasPoint = (event: { clientX: number; clientY: number }) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left + el.scrollLeft, y: event.clientY - rect.top + el.scrollTop };
  };

  const [dragNode, setDragNode] = React.useState<{ index: number; dx: number; dy: number } | null>(null);
  const [wireDrag, setWireDrag] = React.useState<{ fromReg: number; x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!dragNode && !wireDrag) return;
    const onMove = (event: PointerEvent) => {
      const point = canvasPoint(event);
      if (dragNode) {
        setPositions((prev) => ({ ...prev, [dragNode.index]: { x: Math.max(140, point.x - dragNode.dx), y: Math.max(4, point.y - dragNode.dy) } }));
      }
      if (wireDrag) setWireDrag({ ...wireDrag, x: point.x, y: point.y });
    };
    const onUp = (event: PointerEvent) => {
      if (wireDrag) {
        const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-dag-input]');
        if (hit) {
          const nodeIndex = Number(hit.getAttribute('data-node'));
          const slot = hit.getAttribute('data-slot') as 'inA' | 'inB';
          if (Number.isFinite(nodeIndex) && wireDrag.fromReg <= nodeIndex + 1) {
            onChange(nodes.map((node, i) => (i === nodeIndex ? { ...node, [slot]: wireDrag.fromReg } : node)));
          }
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
  }, [dragNode, wireDrag, nodes, onChange]);

  const patch = (index: number, part: Partial<MotionDagNode>) => {
    onChange(nodes.map((node, i) => (i === index ? { ...node, ...part } : node)));
  };
  const addNode = (kind: MotionDagNodeKind) => {
    if (nodes.length >= MOTION_DAG_MAX_NODES) return;
    const base: MotionDagNode = { kind, inA: nodes.length + 1, inB: 0, param: kind === 'mix' ? 0.5 : kind === 'scale' ? 1 : 0 };
    if (kind === 'motion') base.motion = 'flow';
    onChange([...nodes, base]);
  };

  const outPortOf = (reg: number): { x: number; y: number } => {
    if (reg === 0) return { x: 8 + SRC_W, y: 16 + 13 };
    if (reg === 1) return { x: 8 + SRC_W, y: 92 + 13 };
    const p = posOf(reg - 2);
    return { x: p.x + DAG_NODE_WIDTH, y: p.y + 13 };
  };
  const inPortOf = (index: number, slot: 'inA' | 'inB'): { x: number; y: number } => {
    const p = posOf(index);
    return { x: p.x, y: p.y + (slot === 'inA' ? 62 : 88) };
  };
  const wirePath = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const bend = Math.max(30, Math.abs(to.x - from.x) / 2);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  };

  const wires: { d: string; key: string }[] = [];
  nodes.forEach((node, index) => {
    wires.push({ d: wirePath(outPortOf(node.inA), inPortOf(index, 'inA')), key: `a${index}` });
    if (node.kind === 'mix') wires.push({ d: wirePath(outPortOf(node.inB), inPortOf(index, 'inB')), key: `b${index}` });
  });

  const inputOptions = (index: number) => {
    const regs: number[] = [];
    for (let r = 0; r <= index + 1; r++) regs.push(r);
    return regs;
  };

  return (
    <div>
      <div
        ref={canvasRef}
        className="relative h-[430px] overflow-auto rounded border border-white/15 bg-black/40"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '18px 18px' }}
      >
        <svg className="pointer-events-none absolute left-0 top-0" width={1400} height={900}>
          {wires.map((wire) => (
            <path key={wire.key} d={wire.d} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={1.4} />
          ))}
          {wireDrag && (
            <line x1={outPortOf(wireDrag.fromReg).x} y1={outPortOf(wireDrag.fromReg).y} x2={wireDrag.x} y2={wireDrag.y} stroke="#fff" strokeWidth={1.4} strokeDasharray="4 3" />
          )}
        </svg>
        {[
          { reg: 0, label: '入力（main）', y: 16 },
          { reg: 1, label: 'source（元の形）', y: 92 },
        ].map((src) => (
          <div key={src.reg} className="absolute rounded border border-white/30 bg-neutral-900 px-2 py-1.5" style={{ left: 8, top: src.y, width: SRC_W }}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/80">{src.label}</div>
            <button
              aria-label={`output of ${src.label}`}
              onPointerDown={(event) => {
                event.preventDefault();
                const point = canvasPoint(event);
                setWireDrag({ fromReg: src.reg, x: point.x, y: point.y });
              }}
              className="absolute right-[-6px] top-[7px] h-3 w-3 cursor-crosshair rounded-full border border-black bg-white"
            />
          </div>
        ))}
        {nodes.map((node, index) => {
          const p = posOf(index);
          const reg = index + 2;
          const isOutput = effectiveOutput === reg;
          return (
            <div
              key={index}
              className={`absolute rounded border bg-neutral-900/95 shadow ${isOutput ? 'border-white' : 'border-white/25'}`}
              style={{ left: p.x, top: p.y, width: DAG_NODE_WIDTH }}
            >
              <div
                className="flex cursor-move items-center justify-between px-2 py-1"
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  const point = canvasPoint(event);
                  setDragNode({ index, dx: point.x - p.x, dy: point.y - p.y });
                }}
              >
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/85">
                  N{index + 1} · {KIND_LABELS[node.kind]}
                </span>
                <span className="flex items-center gap-1">
                  <button
                    onClick={() => onOutputChange(isOutput && output >= 0 ? -1 : reg)}
                    title="このノードをDAGの出力にする"
                    className={`px-1 py-0.5 text-[8px] rounded ${isOutput ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/50'}`}
                  >
                    出力
                  </button>
                  <button
                    onClick={() => {
                      const result = removeDagNode(nodes, output, index);
                      onChange(result.nodes);
                      onOutputChange(result.output);
                    }}
                    className="px-1 py-0.5 text-[8px] rounded bg-white/10 text-white/60"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <button
                aria-label={`output of N${index + 1}`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  const point = canvasPoint(event);
                  setWireDrag({ fromReg: reg, x: point.x, y: point.y });
                }}
                className="absolute right-[-6px] top-[7px] h-3 w-3 cursor-crosshair rounded-full border border-black bg-white"
              />
              <div className="space-y-1 px-2 pb-2">
                <select value={node.kind} onChange={(event) => patch(index, { kind: event.target.value as MotionDagNodeKind })} className={selectClass} aria-label={`dag[${index}].kind`}>
                  {(Object.keys(KIND_LABELS) as MotionDagNodeKind[]).map((kind) => (
                    <option key={kind} value={kind} className="bg-neutral-900">{kind}</option>
                  ))}
                </select>
                {node.kind === 'motion' && (
                  <select value={node.motion ?? 'flow'} onChange={(event) => patch(index, { motion: event.target.value as Layer2Type })} className={selectClass} aria-label={`dag[${index}].motion`}>
                    {MOTION_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} className="bg-neutral-900">{opt.label ?? opt.id}</option>
                    ))}
                  </select>
                )}
                {node.kind === 'mix' && (
                  <label className="flex items-center gap-1 text-[9px] text-white/50">
                    blend
                    <input type="range" min={0} max={1} step={0.05} value={node.param} onChange={(event) => patch(index, { param: Number(event.target.value) })} className="w-full" />
                    <span className="font-mono">{node.param.toFixed(2)}</span>
                  </label>
                )}
                {node.kind === 'scale' && (
                  <label className="flex items-center gap-1 text-[9px] text-white/50">
                    scale
                    <input type="range" min={0} max={3} step={0.1} value={node.param} onChange={(event) => patch(index, { param: Number(event.target.value) })} className="w-full" />
                    <span className="font-mono">{node.param.toFixed(1)}</span>
                  </label>
                )}
                <div className="relative flex items-center gap-1">
                  <span
                    data-dag-input
                    data-node={index}
                    data-slot="inA"
                    className="absolute left-[-14px] top-[3px] h-3 w-3 rounded-full border border-black bg-white/80"
                  />
                  <span className="text-[9px] text-white/50">A</span>
                  <select value={node.inA} onChange={(event) => patch(index, { inA: Number(event.target.value) })} className={selectClass} aria-label={`dag[${index}].inA`}>
                    {inputOptions(index).map((reg) => (
                      <option key={reg} value={reg} className="bg-neutral-900">{dagRegisterLabel(reg)}</option>
                    ))}
                  </select>
                </div>
                {node.kind === 'mix' && (
                  <div className="relative flex items-center gap-1">
                    <span
                      data-dag-input
                      data-node={index}
                      data-slot="inB"
                      className="absolute left-[-14px] top-[3px] h-3 w-3 rounded-full border border-black bg-white/80"
                    />
                    <span className="text-[9px] text-white/50">B</span>
                    <select value={node.inB} onChange={(event) => patch(index, { inB: Number(event.target.value) })} className={selectClass} aria-label={`dag[${index}].inB`}>
                      {inputOptions(index).map((reg) => (
                        <option key={reg} value={reg} className="bg-neutral-900">{dagRegisterLabel(reg)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {(Object.keys(KIND_LABELS) as MotionDagNodeKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => addNode(kind)}
            disabled={nodes.length >= MOTION_DAG_MAX_NODES}
            className="px-2 py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest disabled:opacity-40"
          >
            + {kind}
          </button>
        ))}
        <button
          onClick={() => {
            setPositions({});
            try { localStorage.removeItem(storageKey); } catch { /* noop */ }
          }}
          className="px-2 py-0.5 rounded bg-white/10 text-[9px]"
        >
          自動整列
        </button>
        <span className="text-[9px] text-white/40">{nodes.length} / {MOTION_DAG_MAX_NODES} ノード · 出力: {dagRegisterLabel(effectiveOutput)}</span>
      </div>
      <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">
        出力ポート（右の白丸）から入力ポート（左の丸）へドラッグして配線します。入力は自分より前のノードからしか取れないため、循環は作れません。
      </p>
    </div>
  );
};

export const MotionDagConfig: React.FC<{
  enabled: boolean;
  nodes: MotionDagNode[];
  output: number;
  onToggle: (enabled: boolean) => void;
  onChange: (nodes: MotionDagNode[]) => void;
  onOutputChange: (output: number) => void;
  disabledReason?: string | null;
  currentTheme: 'white' | 'black';
  layoutKey: string;
}> = ({ enabled, nodes, output, onToggle, onChange, onOutputChange, disabledReason, currentTheme, layoutKey }) => (
  <div className="mb-5">
    <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
        <Share2 size={14} />
        <span>Motion DAG</span>
      </div>
      <button
        onClick={() => onToggle(!enabled)}
        disabled={Boolean(disabledReason)}
        className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? 'bg-white' : 'bg-white/20'} ${disabledReason ? 'opacity-40 cursor-not-allowed' : ''}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-black transition-all ${enabled ? 'left-[22px]' : 'left-0.5 bg-white/70'}`} />
      </button>
    </div>
    {disabledReason ? (
      <p className="text-[10px] leading-relaxed text-white/40">{disabledReason}</p>
    ) : enabled ? (
      <MotionDagEditor
        nodes={nodes}
        output={output}
        onChange={onChange}
        onOutputChange={onOutputChange}
        layoutKey={layoutKey}
        currentTheme={currentTheme}
      />
    ) : (
      <p className="text-[10px] leading-relaxed text-white/40">
        ノードを配線してモーションを合成する自由配線（段階④）。モーショングラフの後段で評価されます。
      </p>
    )}
  </div>
);

/** Compact Play-tab section: toggle + count + opens the canvas editor in an overlay. */
export const PlayDagSection: React.FC<{
  enabled: boolean;
  nodes: MotionDagNode[];
  output: number;
  dedicated: boolean;
  onToggle: (enabled: boolean) => void;
  onChange: (nodes: MotionDagNode[]) => void;
  onOutputChange: (output: number) => void;
  layoutKey: string;
}> = ({ enabled, nodes, output, dedicated, onToggle, onChange, onOutputChange, layoutKey }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/45">Motion DAG · モーションDAG</span>
        <button
          onClick={() => onToggle(!enabled)}
          disabled={dedicated}
          title={dedicated ? '第1段が専用システム系のため使えません' : ''}
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${enabled ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${dedicated ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {enabled ? 'On' : 'Off'}
        </button>
      </div>
      {dedicated ? (
        <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">第1段が専用システム系（堆積・成長・体積）のため、このレイヤーではDAGを使えません。</p>
      ) : (
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[9px] text-white/40">{nodes.length} ノード</span>
          <button onClick={() => setOpen(true)} className="px-2 py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest">
            配線エディタを開く
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-full w-full max-w-3xl overflow-auto rounded border border-white/20 bg-neutral-950 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest text-white/60">Motion DAG 配線エディタ</span>
              <button onClick={() => setOpen(false)} className="px-2 py-0.5 rounded bg-white text-[10px] font-bold text-black">閉じる</button>
            </div>
            <MotionDagEditor
              nodes={nodes}
              output={output}
              onChange={onChange}
              onOutputChange={onOutputChange}
              layoutKey={layoutKey}
              currentTheme="black"
            />
          </div>
        </div>
      )}
    </div>
  );
};
