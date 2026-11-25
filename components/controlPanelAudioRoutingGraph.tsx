import React from 'react';
import { Slider } from './controlPanelParts';
import { ControlPanelContentProps } from './controlPanelTabsShared';
import {
  AUDIO_ROUTING_OUTPUTS,
  AUDIO_ROUTING_REGISTERS,
  AUDIO_ROUTING_SOURCES,
  AudioRoutingGraph,
  AudioRoutingOutputId,
  isDefaultAudioRoutingGraph,
  resolveAudioRoutingGraph,
  serializeAudioRoutingGraph,
} from '../lib/audioRouting';

/**
 * Audio routing graph view (TD §7 stage 1 pilot, Phase 33).
 *
 * The graph view of the Audio tab: the five analysed levels
 * (left) feed the ten particle audio inputs (right) through
 * weighted edges. It edits the same wiring that used to be
 * fixed inline in applyParticleAudioUniforms, stored in the
 * audioRoutingGraph config key ('' = the default graph = the
 * legacy wiring). Node positions are a fixed two-layer
 * layout — free placement and drag-wiring are deliberately
 * out of scope for this pilot; edges are added, removed and
 * weighted through the inspector under the canvas.
 *
 * Scope: only the central particle wiring is graphed here.
 * The scene systems that read audio*Scale keys directly
 * (burst / screen / camera / hue) keep their fixed behaviour
 * in both views.
 */

const CANVAS_HEIGHT = 560;
const NODE_WIDTH = 132;
const NODE_HEIGHT = 32;

const sourceY = (index: number) => 36 + index * ((CANVAS_HEIGHT - 72) / (AUDIO_ROUTING_SOURCES.length - 1));
const outputY = (index: number) => 24 + index * ((CANVAS_HEIGHT - 48) / (AUDIO_ROUTING_OUTPUTS.length - 1));
const registerY = (register: number) => {
  const sourceIndex = AUDIO_ROUTING_SOURCES.findIndex((s) => s.register === register);
  if (sourceIndex >= 0) return sourceY(sourceIndex);
  const outputIndex = AUDIO_ROUTING_OUTPUTS.findIndex((o) => o.register === register);
  return outputY(outputIndex);
};
const registerLabel = (register: number) =>
  AUDIO_ROUTING_REGISTERS.find((r) => r.register === register)?.label ?? `#${register}`;

interface SelectedEdge {
  output: AudioRoutingOutputId;
  from: number;
}

export const AudioRoutingGraphContent: React.FC<ControlPanelContentProps> = ({ config, updateConfig }) => {
  const graph = resolveAudioRoutingGraph(config.audioRoutingGraph);
  const isDefault = isDefaultAudioRoutingGraph(graph);
  const [selectedOutput, setSelectedOutput] = React.useState<AudioRoutingOutputId>('shatter');
  const [selectedEdge, setSelectedEdge] = React.useState<SelectedEdge | null>(null);
  const [pendingFrom, setPendingFrom] = React.useState<number>(0);

  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(640);
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(420, el.clientWidth)));
    observer.observe(el);
    setWidth(Math.max(420, el.clientWidth));
    return () => observer.disconnect();
  }, []);

  const writeGraph = (next: AudioRoutingGraph) => {
    updateConfig('audioRoutingGraph', serializeAudioRoutingGraph(next));
  };

  const edgesOf = (output: AudioRoutingOutputId) => graph.edges[output] ?? [];

  const setEdgeWeight = (output: AudioRoutingOutputId, from: number, weight: number) => {
    writeGraph({
      edges: {
        ...graph.edges,
        [output]: edgesOf(output).map((e) => (e.from === from ? { ...e, weight } : e)),
      },
    });
  };

  const removeEdge = (output: AudioRoutingOutputId, from: number) => {
    writeGraph({ edges: { ...graph.edges, [output]: edgesOf(output).filter((e) => e.from !== from) } });
    setSelectedEdge(null);
  };

  const addEdge = (output: AudioRoutingOutputId, from: number) => {
    if (edgesOf(output).some((e) => e.from === from)) return;
    writeGraph({
      edges: { ...graph.edges, [output]: [...edgesOf(output), { from, weight: 1 }] },
    });
    setSelectedEdge({ output, from });
  };

  const outputInfo = AUDIO_ROUTING_OUTPUTS.find((o) => o.id === selectedOutput)!;
  const availableSources = AUDIO_ROUTING_REGISTERS.filter(
    (r) => r.register < outputInfo.register && !edgesOf(selectedOutput).some((e) => e.from === r.register),
  );
  React.useEffect(() => {
    if (availableSources.length > 0 && !availableSources.some((r) => r.register === pendingFrom)) {
      setPendingFrom(availableSources[0].register);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutput, config.audioRoutingGraph]);
  const selectedEdgeData = selectedEdge
    ? edgesOf(selectedEdge.output).find((e) => e.from === selectedEdge.from)
    : undefined;

  const outX = width - NODE_WIDTH - 8;

  return (
    <div>
      <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
        Audio Routing Graph
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-white/50">
        音の解析レベル（左）から粒子への効き（右）への配線です。線を選ぶと下で重みを変えられます。
        出力のゲインは今までどおり各スライダの値（ここでも変更できます）。
        対象は粒子系の中心配線のみで、Burst / Screen / Camera / Hue への直接の効きは節・グラフどちらの表示でも従来どおりです。
      </p>

      <div ref={wrapRef} className="relative mb-4 overflow-hidden rounded border border-white/10 bg-black/20" style={{ height: CANVAS_HEIGHT }}>
        <svg className="absolute inset-0" width={width} height={CANVAS_HEIGHT}>
          {AUDIO_ROUTING_OUTPUTS.map((output) =>
            edgesOf(output.id).map((edge) => {
              const x1 = 8 + NODE_WIDTH;
              const y1 = registerY(edge.from);
              const x2 = outX;
              const y2 = registerY(output.register);
              const bend = Math.max(40, (x2 - x1) / 2);
              const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
              const isSelected = selectedEdge?.output === output.id && selectedEdge?.from === edge.from;
              return (
                <g key={`${output.id}:${edge.from}`}>
                  <path d={path} fill="none" stroke="transparent" strokeWidth={12}
                    style={{ cursor: 'pointer' }}
                    onClick={() => { setSelectedOutput(output.id); setSelectedEdge({ output: output.id, from: edge.from }); }} />
                  <path d={path} fill="none" stroke={isSelected ? '#ffffff' : 'rgba(255,255,255,0.28)'} strokeWidth={isSelected ? 2 : 1.2} pointerEvents="none" />
                </g>
              );
            }),
          )}
        </svg>
        {AUDIO_ROUTING_SOURCES.map((source, i) => (
          <div key={source.id}
            className="absolute flex items-center rounded border border-white/20 bg-[#1c1c1c] px-2 text-[11px] text-white/85"
            style={{ left: 8, top: sourceY(i) - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT }}>
            {source.label}
          </div>
        ))}
        {AUDIO_ROUTING_OUTPUTS.map((output, i) => {
          const active = output.id === selectedOutput;
          return (
            <button key={output.id} type="button"
              onClick={() => setSelectedOutput(output.id)}
              className={`absolute flex items-center rounded border px-2 text-left text-[11px] transition-colors ${
                active ? 'border-white/70 bg-[#2a2a2a] text-white' : 'border-white/15 bg-[#1c1c1c] text-white/75 hover:border-white/40'
              }`}
              style={{ left: outX, top: outputY(i) - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT }}>
              {output.label}
              <span className="ml-auto text-[9px] text-white/40">{edgesOf(output.id).length} in</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-white/55">
          Output: {outputInfo.label}
        </div>
        {outputInfo.gainKey ? (
          <Slider
            label={`Gain (${outputInfo.gainKey.replace(/^audio/, '').replace(/Scale$/, '')})`}
            value={config[outputInfo.gainKey]}
            min={0}
            max={outputInfo.gainKey === 'audioBeatScale' || outputInfo.gainKey === 'audioJitterScale' ? 3 : 4}
            step={0.05}
            onChange={(v) => updateConfig(outputInfo.gainKey!, v)}
          />
        ) : (
          <div className="mb-2 text-[11px] text-white/45">ゲインは 1 固定です（従来どおり）。</div>
        )}

        <div className="mb-2 mt-3 text-[10px] uppercase tracking-widest text-white/55">Inputs</div>
        {edgesOf(selectedOutput).length === 0 && (
          <div className="mb-2 text-[11px] text-white/45">接続がありません（この出力は無音です）。</div>
        )}
        {edgesOf(selectedOutput).map((edge) => (
          <div key={edge.from} className="mb-1 flex items-center gap-2">
            <button type="button"
              onClick={() => setSelectedEdge({ output: selectedOutput, from: edge.from })}
              className={`flex-1 rounded px-2 py-1 text-left text-[11px] ${
                selectedEdge?.output === selectedOutput && selectedEdge?.from === edge.from
                  ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-white/70 hover:bg-white/[0.08]'
              }`}>
              {registerLabel(edge.from)} → {outputInfo.label}
              <span className="float-right text-white/50">× {edge.weight.toFixed(2)}</span>
            </button>
            <button type="button" onClick={() => removeEdge(selectedOutput, edge.from)}
              className="rounded px-2 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white">
              削除
            </button>
          </div>
        ))}
        {selectedEdgeData && selectedEdge && (
          <Slider
            label={`Weight: ${registerLabel(selectedEdge.from)} → ${AUDIO_ROUTING_OUTPUTS.find((o) => o.id === selectedEdge.output)?.label}`}
            value={selectedEdgeData.weight}
            min={-2} max={2} step={0.05}
            onChange={(v) => setEdgeWeight(selectedEdge.output, selectedEdge.from, v)}
          />
        )}
        {availableSources.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <select
              value={pendingFrom}
              onChange={(e) => setPendingFrom(Number(e.target.value))}
              className="rounded border border-white/15 bg-[#1c1c1c] px-2 py-1 text-[11px] text-white/80">
              {availableSources.map((r) => (
                <option key={r.register} value={r.register}>{r.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => addEdge(selectedOutput, pendingFrom)}
              className="rounded bg-white/[0.08] px-3 py-1 text-[11px] text-white/85 transition-colors hover:bg-white/[0.14]">
              接続を追加
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" disabled={isDefault}
          onClick={() => { updateConfig('audioRoutingGraph', ''); setSelectedEdge(null); }}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
          既定の配線に戻す
        </button>
        <span className="text-[10px] tracking-wider text-white/40">
          {isDefault ? '現在の配線は既定（従来の固定配線）です' : '既定から変更されています（プリセットに保存されます）'}
        </span>
      </div>
    </div>
  );
};
