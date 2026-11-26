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
import {
  AUDIO_SCENE_OUTPUTS,
  AUDIO_SCENE_SOURCES,
  AUDIO_SCENE_WEIGHT_KEYS,
  AudioSceneEdge,
  AudioSceneGraph,
  AudioSceneOutputId,
  AudioSceneSourceId,
  AudioSceneWeightKey,
  isDefaultAudioSceneGraph,
  resolveAudioSceneGraph,
  serializeAudioSceneGraph,
} from '../lib/audioSceneGraph';

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
 * Scope: the central particle wiring is graphed in the
 * first tab. The scene systems that read audio*Scale keys
 * directly (burst / screen / camera / hue / line) are the
 * second tab's scene graph (TD §7 stage 2, lib/audioScene
 * Graph.ts); the two graphs are separate config keys.
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

const RoutingGraphEditor: React.FC<ControlPanelContentProps> = ({ config, updateConfig }) => {
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
        Burst / Screen / Camera / Hue / Line への直接の効きは、上の「シーン側」タブで編集できます。
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

/**
 * Scene-side graph editor (TD §7 stage 2, Round 84 gap 5):
 * the direct readers (burst / screen / camera / hue / line)
 * as data, stored in the audioSceneGraph config key ('' =
 * the default graph = the legacy direct formulas). An edge's
 * weight is a constant or a reference to a *Scale key (the
 * camera's legacy input needs key references); the hue node
 * additionally carries its fixed coefficient. The two graphs
 * are separate keys and separate state: editing one never
 * touches the other.
 */

const SCENE_CANVAS_HEIGHT = 300;
const sceneSourceY = (index: number) => 36 + index * ((SCENE_CANVAS_HEIGHT - 72) / (AUDIO_SCENE_SOURCES.length - 1));
const sceneOutputY = (index: number) => 36 + index * ((SCENE_CANVAS_HEIGHT - 72) / (AUDIO_SCENE_OUTPUTS.length - 1));
const sceneSourceLabel = (id: AudioSceneSourceId) => AUDIO_SCENE_SOURCES.find((s) => s.id === id)?.label ?? id;
const weightKeyLabel = (key: AudioSceneWeightKey) => key.replace(/^audio/, '').replace(/Scale$/, '');
const sceneEdgeLabel = (edge: AudioSceneEdge) => {
  if (edge.weightKey) {
    const scale = edge.weightScale ?? 1;
    return scale === 1 ? `× ${weightKeyLabel(edge.weightKey)}` : `× ${weightKeyLabel(edge.weightKey)} × ${scale.toFixed(2)}`;
  }
  return `× ${(edge.weight ?? 0).toFixed(2)}`;
};

interface SceneSelectedEdge {
  output: AudioSceneOutputId;
  from: AudioSceneSourceId;
}

const SceneGraphEditor: React.FC<ControlPanelContentProps> = ({ config, updateConfig }) => {
  const graph = resolveAudioSceneGraph(config.audioSceneGraph);
  const isDefault = isDefaultAudioSceneGraph(graph);
  const [selectedOutput, setSelectedOutput] = React.useState<AudioSceneOutputId>('camera');
  const [selectedEdge, setSelectedEdge] = React.useState<SceneSelectedEdge | null>(null);
  const [pendingFrom, setPendingFrom] = React.useState<AudioSceneSourceId>('bass');

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

  const writeGraph = (next: AudioSceneGraph) => {
    updateConfig('audioSceneGraph', serializeAudioSceneGraph(next));
  };

  const edgesOf = (output: AudioSceneOutputId) => graph.outputs[output]?.edges ?? [];
  const nodeOf = (output: AudioSceneOutputId) => graph.outputs[output];

  const setOutputNode = (output: AudioSceneOutputId, node: { coefficient?: number; edges: AudioSceneEdge[] }) => {
    writeGraph({ outputs: { ...graph.outputs, [output]: node } });
  };

  const replaceEdge = (output: AudioSceneOutputId, from: AudioSceneSourceId, next: AudioSceneEdge) => {
    const node = nodeOf(output);
    setOutputNode(output, {
      coefficient: node?.coefficient,
      edges: edgesOf(output).map((e) => (e.from === from ? next : e)),
    });
  };

  const removeEdge = (output: AudioSceneOutputId, from: AudioSceneSourceId) => {
    const node = nodeOf(output);
    setOutputNode(output, {
      coefficient: node?.coefficient,
      edges: edgesOf(output).filter((e) => e.from !== from),
    });
    setSelectedEdge(null);
  };

  const addEdge = (output: AudioSceneOutputId, from: AudioSceneSourceId) => {
    if (edgesOf(output).some((e) => e.from === from)) return;
    const node = nodeOf(output);
    setOutputNode(output, {
      coefficient: node?.coefficient,
      edges: [...edgesOf(output), { from, weight: 1 }],
    });
    setSelectedEdge({ output, from });
  };

  const outputInfo = AUDIO_SCENE_OUTPUTS.find((o) => o.id === selectedOutput)!;
  const availableSources = AUDIO_SCENE_SOURCES.filter(
    (s) => !edgesOf(selectedOutput).some((e) => e.from === s.id),
  );
  React.useEffect(() => {
    if (availableSources.length > 0 && !availableSources.some((s) => s.id === pendingFrom)) {
      setPendingFrom(availableSources[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOutput, config.audioSceneGraph]);
  const selectedEdgeData = selectedEdge
    ? edgesOf(selectedEdge.output).find((e) => e.from === selectedEdge.from)
    : undefined;

  const outX = width - NODE_WIDTH - 8;

  return (
    <div>
      <div className="mb-4 rounded border border-white/10 bg-black/10 px-3 py-2 text-[10px] uppercase tracking-widest text-white/55">
        Audio Scene Graph
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-white/50">
        音の解析レベル（左）から、シーン側の直接の効き（右）への配線です。重みは数値か、既存のスケールキーへの参照かを選べます
        （Camera の従来式がキー参照を使います）。出力の最終ゲインは従来どおり各スケールキーです。
        Line の入力は中心配線の出力（Bass In / Treble In など）を読みます。
      </p>

      <div ref={wrapRef} className="relative mb-4 overflow-hidden rounded border border-white/10 bg-black/20" style={{ height: SCENE_CANVAS_HEIGHT }}>
        <svg className="absolute inset-0" width={width} height={SCENE_CANVAS_HEIGHT}>
          {AUDIO_SCENE_OUTPUTS.map((output) =>
            edgesOf(output.id).map((edge) => {
              const sourceIndex = AUDIO_SCENE_SOURCES.findIndex((s) => s.id === edge.from);
              const outputIndex = AUDIO_SCENE_OUTPUTS.findIndex((o) => o.id === output.id);
              const x1 = 8 + NODE_WIDTH;
              const y1 = sceneSourceY(sourceIndex);
              const x2 = outX;
              const y2 = sceneOutputY(outputIndex);
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
        {AUDIO_SCENE_SOURCES.map((source, i) => (
          <div key={source.id}
            className="absolute flex items-center rounded border border-white/20 bg-[#1c1c1c] px-2 text-[11px] text-white/85"
            style={{ left: 8, top: sceneSourceY(i) - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT }}>
            {source.label}
          </div>
        ))}
        {AUDIO_SCENE_OUTPUTS.map((output, i) => {
          const active = output.id === selectedOutput;
          return (
            <button key={output.id} type="button"
              onClick={() => setSelectedOutput(output.id)}
              className={`absolute flex items-center rounded border px-2 text-left text-[11px] transition-colors ${
                active ? 'border-white/70 bg-[#2a2a2a] text-white' : 'border-white/15 bg-[#1c1c1c] text-white/75 hover:border-white/40'
              }`}
              style={{ left: outX, top: sceneOutputY(i) - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT }}>
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
        <Slider
          label={`Gain (${weightKeyLabel(outputInfo.gainKey)})`}
          value={config[outputInfo.gainKey]}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) => updateConfig(outputInfo.gainKey, v)}
        />
        {selectedOutput === 'hue' && (
          <Slider
            label="Coefficient (node)"
            value={nodeOf('hue')?.coefficient ?? 1}
            min={-2}
            max={2}
            step={0.05}
            onChange={(v) => {
              const node = nodeOf('hue');
              setOutputNode('hue', { coefficient: v, edges: node?.edges ?? [] });
            }}
          />
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
              {sceneSourceLabel(edge.from)} → {outputInfo.label}
              <span className="float-right text-white/50">{sceneEdgeLabel(edge)}</span>
            </button>
            <button type="button" onClick={() => removeEdge(selectedOutput, edge.from)}
              className="rounded px-2 py-1 text-[11px] text-white/50 transition-colors hover:bg-white/[0.08] hover:text-white">
              削除
            </button>
          </div>
        ))}
        {selectedEdgeData && selectedEdge && (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[11px] text-white/55">重みの種類:</span>
              <button type="button"
                onClick={() => replaceEdge(selectedEdge.output, selectedEdge.from, { from: selectedEdge.from, weight: 1 })}
                className={`rounded px-2 py-1 text-[11px] ${!selectedEdgeData.weightKey ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'}`}>
                定数
              </button>
              <button type="button"
                onClick={() => replaceEdge(selectedEdge.output, selectedEdge.from, { from: selectedEdge.from, weightKey: 'audioBeatScale' })}
                className={`rounded px-2 py-1 text-[11px] ${selectedEdgeData.weightKey ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'}`}>
                キー参照
              </button>
            </div>
            {!selectedEdgeData.weightKey ? (
              <Slider
                label={`Weight: ${sceneSourceLabel(selectedEdge.from)} → ${outputInfo.label}`}
                value={selectedEdgeData.weight ?? 0}
                min={-2} max={2} step={0.05}
                onChange={(v) => replaceEdge(selectedEdge.output, selectedEdge.from, { from: selectedEdge.from, weight: v })}
              />
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-[11px] text-white/55">参照キー:</span>
                  <select
                    value={selectedEdgeData.weightKey}
                    onChange={(e) => replaceEdge(selectedEdge.output, selectedEdge.from, {
                      from: selectedEdge.from,
                      weightKey: e.target.value as AudioSceneWeightKey,
                      weightScale: selectedEdgeData.weightScale,
                    })}
                    className="rounded border border-white/15 bg-[#1c1c1c] px-2 py-1 text-[11px] text-white/80">
                    {AUDIO_SCENE_WEIGHT_KEYS.map((key) => (
                      <option key={key} value={key}>{weightKeyLabel(key)}</option>
                    ))}
                  </select>
                </div>
                <Slider
                  label="Key scale"
                  value={selectedEdgeData.weightScale ?? 1}
                  min={-2} max={2} step={0.05}
                  onChange={(v) => replaceEdge(selectedEdge.output, selectedEdge.from, {
                    from: selectedEdge.from,
                    weightKey: selectedEdgeData.weightKey,
                    weightScale: v,
                  })}
                />
              </div>
            )}
          </div>
        )}
        {availableSources.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <select
              value={pendingFrom}
              onChange={(e) => setPendingFrom(e.target.value as AudioSceneSourceId)}
              className="rounded border border-white/15 bg-[#1c1c1c] px-2 py-1 text-[11px] text-white/80">
              {availableSources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
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
          onClick={() => { updateConfig('audioSceneGraph', ''); setSelectedEdge(null); }}
          className="rounded-md px-3 py-1.5 text-[10px] tracking-wider text-[#a3a3a3] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40">
          既定の配線に戻す
        </button>
        <span className="text-[10px] tracking-wider text-white/40">
          {isDefault ? '現在の配線は既定（従来の固定式）です' : '既定から変更されています（プリセットに保存されます）'}
        </span>
      </div>
    </div>
  );
};

/**
 * The Audio tab's graph view: two tabs over the two graphs —
 * 「中心配線」 (stage 1, audioRoutingGraph) and 「シーン側」
 * (stage 2, audioSceneGraph). Separate keys, separate state.
 */
export const AudioRoutingGraphContent: React.FC<ControlPanelContentProps> = (props) => {
  const [tab, setTab] = React.useState<'routing' | 'scene'>('routing');
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button type="button"
          onClick={() => setTab('routing')}
          className={`rounded px-3 py-1.5 text-[11px] tracking-wider transition-colors ${
            tab === 'routing' ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'
          }`}>
          中心配線
        </button>
        <button type="button"
          onClick={() => setTab('scene')}
          className={`rounded px-3 py-1.5 text-[11px] tracking-wider transition-colors ${
            tab === 'scene' ? 'bg-white/15 text-white' : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'
          }`}>
          シーン側
        </button>
      </div>
      {tab === 'routing' ? <RoutingGraphEditor {...props} /> : <SceneGraphEditor {...props} />}
    </div>
  );
};
