import React from 'react';
import { Box, FileDown, Keyboard, Network, Sparkles } from 'lucide-react';
import type { Layer2Type, MotionDagNode, MotionGraphStep, ParticleConfig, PresetRecord } from '../types';
import { MOTION_GROUPS } from '../lib/motionGrouping';
import { isDedicatedSystemMotionType, isPlacementMotionType } from '../lib/motionChain';
import { PARAMETER_CATALOG } from '../lib/parameterCatalog';
import { DEFAULT_GRAPH_LAYOUT, GRAPH_CONNECTION_OPTIONS, GRAPH_EDGES, GRAPH_EMIT_SHAPE_OPTIONS, GRAPH_NODE_WIDTH, GRAPH_SOURCE_OPTIONS, GRAPH_SPRITE_OPTIONS, loadGraphLayout, saveGraphLayout, type GraphNodeId, type GraphOption } from '../lib/graphModel';
import { generatePromptDrafts, type PromptDraft } from '../lib/promptPreset';
import { buildPlyPointCloud, countExportablePoints, type PointCloudCaptureState } from '../lib/pointCloudExport';
import { buildObjFromGrid, buildStlFromGrid, countMeshExport, extractGridPositions } from '../lib/meshExport';
import { buildSvgPointCloud, type SvgPlane } from '../lib/svgExport';
import { PlayDagSection } from './controlPanelDagEditor';
import { Slider, Toggle } from './controlPanelParts';
import { getLastCsgRun, runCsgOperation } from '../lib/csg';
import {
  buildIndexedObjText,
  CsgError,
  type CsgOperand,
  type CsgPrimitiveKind,
  type CsgResultData,
} from '../lib/csgCore';
import { parseFreeformText } from '../lib/csgFreeform';
import { buildMeshOperandFromObj, parseCsgMeshText } from '../lib/csgMeshOperand';
import { importMeshFileToObjText, MESH_OBJ_TEXT_MAX_CHARS } from '../lib/csgMeshImport';
import { checkWatertightGate } from '../lib/csgGate';
import { CsgFreeformEditor } from './csgFreeformEditor';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { DeterministicRenderControls } from './controlPanelPlayTabRender';
import { SectionTitle } from './controlPanelPlayTabShared';

export const PromptDraftSection: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ config, presets, isPublicLibrary, onApplyConfig, onSaveBredPreset }) => {
  const [text, setText] = React.useState('');
  const [drafts, setDrafts] = React.useState<PromptDraft[]>([]);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [savedNames, setSavedNames] = React.useState<Set<string>>(new Set());

  const generate = () => {
    const result = generatePromptDrafts(text, presets, config);
    setDrafts(result.drafts);
    setNotes(result.notes);
    setSavedNames(new Set());
  };

  return (
    <section>
      <SectionTitle icon={<Sparkles size={12} />}>Prompt Draft · 言葉からプリセット</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-3">
        言葉でイメージを書くと、叩き台プリセットを3件作ります。外部AIは使わず、運動の語彙（渦・雲・結晶…）と気分の語彙（儚い・激しい・静か…）をローカルで解釈して、既存プリセットを土台にマクロを当て、種つき変異を加えたものです。解釈内容はすべて下に表示されます。
      </p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') generate(); }}
          placeholder="例: 渦巻いて上昇する儚い雲"
          className="min-w-0 flex-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-xs outline-none focus:border-white/40"
        />
        <button
          onClick={generate}
          className="shrink-0 px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
        >
          叩き台を生成
        </button>
      </div>
      {notes.length > 0 && (
        <ul className="mb-3 space-y-0.5">
          {notes.map((note) => (
            <li key={note} className="text-[10px] text-white/40">・{note}</li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        {drafts.map((draft) => {
          const isSaved = savedNames.has(draft.name);
          return (
            <div key={draft.name} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span className="min-w-0 truncate text-[11px] font-medium">{draft.name}</span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => onApplyConfig?.(draft.config)}
                  disabled={!onApplyConfig}
                  className="px-2.5 py-1 rounded-full border border-white/20 text-[9px] uppercase tracking-wider text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  適用
                </button>
                <button
                  onClick={() => {
                    onSaveBredPreset?.(draft.config, draft.name);
                    setSavedNames((prev) => new Set(prev).add(draft.name));
                  }}
                  disabled={isPublicLibrary || isSaved || !onSaveBredPreset}
                  className="px-2.5 py-1 rounded-full bg-white text-black text-[9px] font-bold uppercase tracking-wider disabled:opacity-40"
                >
                  {isSaved ? '保存済み' : '保存'}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const GraphSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  updateMotionArray?: ControlPanelContentProps['updateMotionArray'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, updateMotionArray, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layout, setLayout] = React.useState(() =>
    loadGraphLayout(typeof window !== 'undefined' ? window.localStorage : undefined),
  );
  const [sizes, setSizes] = React.useState<Partial<Record<GraphNodeId, { w: number; h: number }>>>({});
  const canvasRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const root = canvasRef.current;
    if (!root) return;
    const next: Partial<Record<GraphNodeId, { w: number; h: number }>> = {};
    root.querySelectorAll<HTMLElement>('[data-gnode]').forEach((el) => {
      const id = el.dataset.gnode as GraphNodeId;
      next[id] = { w: el.offsetWidth, h: el.offsetHeight };
    });
    setSizes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [layout, config]);

  const startDrag = (id: GraphNodeId) => (event: React.PointerEvent) => {
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = layout[id];
    const onMove = (ev: PointerEvent) => {
      setLayout((prev) => ({
        ...prev,
        [id]: { x: Math.max(0, origin.x + ev.clientX - startX), y: Math.max(0, origin.y + ev.clientY - startY) },
      }));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLayout((prev) => {
        saveGraphLayout(window.localStorage, prev);
        return prev;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const resetLayout = () => {
    setLayout({ ...DEFAULT_GRAPH_LAYOUT });
    saveGraphLayout(window.localStorage, { ...DEFAULT_GRAPH_LAYOUT });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';

  const paramSlider = (key: keyof ParticleConfig) => {
    const entry = PARAMETER_CATALOG.find((candidate) => candidate.key === key);
    const value = config[key];
    if (!entry || typeof value !== 'number') return null;
    return (
      <Slider
        key={key}
        label={entry.label}
        value={value}
        min={entry.min}
        max={entry.max}
        step={entry.step}
        onChange={(v) => write(key, v)}
      />
    );
  };

  const selectField = (key: keyof ParticleConfig, options: GraphOption[]) => (
    <select
      value={String(config[key])}
      onChange={(event) => write(key, event.target.value)}
      className={selectClass}
      aria-label={key}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-neutral-900">
          {option.label}
        </option>
      ))}
    </select>
  );

  const motionSelect = (key: 'layer2Type' | 'layer3Type') => (
    <select value={String(config[key])} onChange={(event) => write(key, event.target.value)} className={selectClass} aria-label={key}>
      {MOTION_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.ids.map((id) => (
            <option key={id} value={id} className="bg-neutral-900">
              {id}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );


  const motionMixEditor = (layer: 2 | 3) => {
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const countKey = (layer === 2 ? 'layer2SourceCount' : 'layer3SourceCount') as 'layer2SourceCount' | 'layer3SourceCount';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixOn = Boolean(config[mixKey]);
    const sourceCount = Math.max(1, Math.min(8, Math.round(Number(config[countKey]) || 1)));
    const motions = config[motionsKey] as readonly string[];
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Mix · 発生源ごとの動き</span>
          <button
            onClick={() => write(mixKey, !mixOn)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${mixOn ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {mixOn ? 'On' : 'Off'}
          </button>
        </div>
        {mixOn && (
          <div className="mt-1.5 space-y-1">
            {Array.from({ length: sourceCount }, (_, index) => (
              <select
                key={index}
                value={String(motions[index] ?? config[typeKey])}
                onChange={(event) => updateMotionArray?.(motionsKey, index, event.target.value as Layer2Type)}
                className={selectClass}
                aria-label={`${motionsKey}[${index}]`}
              >
                {MOTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.ids.map((id) => (
                      <option key={id} value={id} className="bg-neutral-900">{id}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
            <p className="text-[9px] leading-relaxed text-white/35">発生源ごとに別の運動を配線します（エンジン標準の MotionMix）。</p>
          </div>
        )}
      </div>
    );
  };

  const motionChainEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionChainEnabled' : 'layer3MotionChainEnabled') as 'layer2MotionChainEnabled' | 'layer3MotionChainEnabled';
    const chainKey = (layer === 2 ? 'layer2MotionChain' : 'layer3MotionChain') as 'layer2MotionChain' | 'layer3MotionChain';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const chainOn = Boolean(config[enabledKey]);
    const chain = (config[chainKey] as readonly Layer2Type[]) ?? [];
    const stage1Types: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = stage1Types.some((type) => type && isDedicatedSystemMotionType(type));
    const hasPlacement = chain.some((entry) => isPlacementMotionType(entry));
    const setStage = (stageIndex: number, value: string) => {
      const next: (Layer2Type | null)[] = [chain[0] ?? null, chain[1] ?? null];
      next[stageIndex] = value === '' ? null : (value as Layer2Type);
      if (next[0] === null) next[1] = null;
      write(chainKey, next.filter((entry): entry is Layer2Type => entry !== null));
    };
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Chain · 直列チェーン</span>
          <button
            onClick={() => write(enabledKey, !chainOn)}
            disabled={dedicated}
            title={dedicated ? '第1段が専用システム系のため使えません' : ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${chainOn ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${dedicated ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {chainOn ? 'On' : 'Off'}
          </button>
        </div>
        {dedicated ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">第1段が専用システム系（堆積・成長・体積）のため、このレイヤーではチェーンを使えません。</p>
        ) : chainOn ? (
          <div className="mt-1.5 space-y-1">
            {[0, 1].map((stageIndex) => (
              <select
                key={stageIndex}
                value={String(chain[stageIndex] ?? '')}
                onChange={(event) => setStage(stageIndex, event.target.value)}
                disabled={stageIndex > 0 && !chain[0]}
                className={selectClass}
                aria-label={`${chainKey}[${stageIndex}]`}
              >
                <option value="" className="bg-neutral-900">Stage {stageIndex + 2} · — None —</option>
                {MOTION_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.ids.map((id) => (
                      <option key={id} value={id} className="bg-neutral-900">{id}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ))}
            <p className="text-[9px] leading-relaxed text-white/35">第1段の出力に次のモーションを直列で重ねます（最大3段）。</p>
            {hasPlacement && (
              <p className="text-[9px] leading-relaxed text-white/35">配置系のモーションは前段の形状をそのまま変位させるのではなく、再配置します。</p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const routeEditor = (layer: 2 | 3, kind: 'motion' | 'source') => {
    const other = (layer === 2 ? 3 : 2) as 2 | 3;
    const enabledKey = (layer === 2
      ? (kind === 'motion' ? 'layer2MotionRouteEnabled' : 'layer2SourceRouteEnabled')
      : (kind === 'motion' ? 'layer3MotionRouteEnabled' : 'layer3SourceRouteEnabled')) as 'layer2MotionRouteEnabled' | 'layer3MotionRouteEnabled' | 'layer2SourceRouteEnabled' | 'layer3SourceRouteEnabled';
    const fromKey = (layer === 2
      ? (kind === 'motion' ? 'layer2MotionRouteFrom' : 'layer2SourceRouteFrom')
      : (kind === 'motion' ? 'layer3MotionRouteFrom' : 'layer3SourceRouteFrom')) as 'layer2MotionRouteFrom' | 'layer3MotionRouteFrom' | 'layer2SourceRouteFrom' | 'layer3SourceRouteFrom';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const otherTypeKey = (other === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const otherMixKey = (other === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const on = Boolean(config[enabledKey]);
    const from = (config[fromKey] as 'layer2' | 'layer3' | null) ?? null;
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const ownDedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    const sourceDedicated = kind === 'motion' && isDedicatedSystemMotionType(config[otherTypeKey] as Layer2Type);
    const disabledReason = ownDedicated
      ? '第1段が専用システム系（堆積・成長・体積）のため、このレイヤーでは使えません。'
      : sourceDedicated
        ? 'ルーティング元の第1段が専用システム系のため、借りられるモーションスタックがありません。'
        : null;
    const otherValue = `layer${other}` as 'layer2' | 'layer3';
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">{kind === 'motion' ? 'Motion Route · モーション経路' : 'Source Route · ソース形状'}</span>
          <button
            onClick={() => write(enabledKey, !on)}
            disabled={Boolean(disabledReason)}
            title={disabledReason ?? ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${disabledReason ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {disabledReason ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">{disabledReason}</p>
        ) : on ? (
          <div className="mt-1.5 space-y-1">
            <select
              value={from ?? ''}
              onChange={(event) => write(fromKey, event.target.value === '' ? null : (event.target.value as 'layer2' | 'layer3'))}
              className={selectClass}
              aria-label={fromKey}
            >
              <option value="" className="bg-neutral-900">From · — None —</option>
              <option value={otherValue} className="bg-neutral-900">Layer {other}</option>
            </select>
            {kind === 'motion' ? (
              <p className="text-[9px] leading-relaxed text-white/35">
                相手レイヤーのモーションスタック（第1段＋チェーン）を、そのパラメータのまま自レイヤーの前段に実行します。
                {config[otherMixKey] ? 'ルーティング元が Mix のため、主タイプ（Type）が使われます。' : ''}
              </p>
            ) : (
              <p className="text-[9px] leading-relaxed text-white/35">粒子の初期配置（形・ソース配置・メディアマップ）を相手レイヤーのソース設定で生成します。粒子数やモーションは自レイヤーのままです。</p>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const motionGraphEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionGraphEnabled' : 'layer3MotionGraphEnabled') as 'layer2MotionGraphEnabled' | 'layer3MotionGraphEnabled';
    const graphKey = (layer === 2 ? 'layer2MotionGraph' : 'layer3MotionGraph') as 'layer2MotionGraph' | 'layer3MotionGraph';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const on = Boolean(config[enabledKey]);
    const steps = (config[graphKey] as readonly MotionGraphStep[]) ?? [];
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    const patch = (index: number, part: Partial<MotionGraphStep>) => {
      write(graphKey, steps.map((step, i) => (i === index ? { ...step, ...part } : step)));
    };
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Motion Graph · モーショングラフ</span>
          <button
            onClick={() => write(enabledKey, !on)}
            disabled={dedicated}
            title={dedicated ? '第1段が専用システム系のため使えません' : ''}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'} ${dedicated ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {dedicated ? (
          <p className="mt-1.5 text-[9px] leading-relaxed text-white/35">第1段が専用システム系（堆積・成長・体積）のため、このレイヤーではグラフを使えません。</p>
        ) : on ? (
          <div className="mt-1.5 space-y-1.5">
            {steps.map((step, index) => (
              <div key={index} className="space-y-1 rounded border border-white/10 p-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-white/40">Step {index + 1}</span>
                  <span className="flex gap-1">
                    <button onClick={() => patch(index, { saveBranch: !step.saveBranch })} className={`px-1.5 py-0.5 rounded text-[8px] ${step.saveBranch ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/50'}`}>branch保存</button>
                    <button onClick={() => write(graphKey, steps.filter((_, i) => i !== index))} className="px-1.5 py-0.5 rounded bg-white/10 text-[8px]">✕</button>
                  </span>
                </div>
                <select value={step.motion} onChange={(event) => patch(index, { motion: event.target.value as Layer2Type })} className={selectClass} aria-label={`${graphKey}[${index}].motion`}>
                  {MOTION_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.ids.map((id) => (
                        <option key={id} value={id} className="bg-neutral-900">{id}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="flex gap-1">
                  <select value={step.input} onChange={(event) => patch(index, { input: event.target.value as MotionGraphStep['input'] })} className={selectClass} aria-label={`${graphKey}[${index}].input`}>
                    <option value="prev" className="bg-neutral-900">prev</option>
                    <option value="source" className="bg-neutral-900">source</option>
                    <option value="branch" className="bg-neutral-900">branch</option>
                  </select>
                  <select value={String(step.blend)} onChange={(event) => patch(index, { blend: Number(event.target.value) })} className={selectClass} aria-label={`${graphKey}[${index}].blend`}>
                    {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                      <option key={v} value={String(v)} className="bg-neutral-900">blend {v}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {steps.length < 8 && (
              <button onClick={() => write(graphKey, [...steps, { motion: 'flow', input: 'prev', blend: 1, saveBranch: false }])} className="w-full py-0.5 rounded bg-white/10 text-[9px] uppercase tracking-widest">
                + Step（最大8）
              </button>
            )}
            <p className="text-[9px] leading-relaxed text-white/35">スタックの後段で動くステップ列。branch 保存で分岐し、source / branch から合流できます。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const positionFeedbackEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2PositionFeedbackEnabled' : 'layer3PositionFeedbackEnabled') as 'layer2PositionFeedbackEnabled' | 'layer3PositionFeedbackEnabled';
    const feedbackKey = (layer === 2 ? 'layer2PositionFeedback' : 'layer3PositionFeedback') as 'layer2PositionFeedback' | 'layer3PositionFeedback';
    const decayKey = (layer === 2 ? 'layer2PositionFeedbackDecay' : 'layer3PositionFeedbackDecay') as 'layer2PositionFeedbackDecay' | 'layer3PositionFeedbackDecay';
    const on = Boolean(config[enabledKey]);
    const feedback = typeof config[feedbackKey] === 'number' ? (config[feedbackKey] as number) : 0.85;
    const decay = typeof config[decayKey] === 'number' ? (config[decayKey] as number) : 0.1;
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Position Feedback · 位置フィードバック</span>
          <button
            onClick={() => write(enabledKey, !on)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {on ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              feedback
              <input type="range" min={0} max={1} step={0.05} value={feedback} onChange={(event) => write(feedbackKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{feedback.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              decay
              <input type="range" min={0} max={1} step={0.05} value={decay} onChange={(event) => write(decayKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{decay.toFixed(2)}</span>
            </label>
            <p className="text-[9px] leading-relaxed text-white/35">前フレームの位置を引きずる方式C。点の描画のみ・決定的書き出しでは自動無効。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const warpEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2WarpEnabled' : 'layer3WarpEnabled') as 'layer2WarpEnabled' | 'layer3WarpEnabled';
    const amountKey = (layer === 2 ? 'layer2WarpAmount' : 'layer3WarpAmount') as 'layer2WarpAmount' | 'layer3WarpAmount';
    const scaleKey = (layer === 2 ? 'layer2WarpScale' : 'layer3WarpScale') as 'layer2WarpScale' | 'layer3WarpScale';
    const on = Boolean(config[enabledKey]);
    const amount = typeof config[amountKey] === 'number' ? (config[amountKey] as number) : 18;
    const scale = typeof config[scaleKey] === 'number' ? (config[scaleKey] as number) : 0.012;
    return (
      <div className="mt-2 border-t border-white/10 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-widest text-white/45">Domain Warp · ドメインワープ</span>
          <button
            onClick={() => write(enabledKey, !on)}
            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${on ? 'bg-white text-black' : 'bg-white/10 text-white/50'}`}
          >
            {on ? 'On' : 'Off'}
          </button>
        </div>
        {on ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              amount
              <input type="range" min={0} max={60} step={1} value={amount} onChange={(event) => write(amountKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{amount.toFixed(0)}</span>
            </label>
            <label className="flex items-center gap-1 text-[9px] text-white/50">
              scale
              <input type="range" min={0.002} max={0.05} step={0.001} value={scale} onChange={(event) => write(scaleKey, Number(event.target.value))} className="w-full" />
              <span className="font-mono">{scale.toFixed(3)}</span>
            </label>
            <p className="text-[9px] leading-relaxed text-white/35">入力空間をノイズで歪めてから全モーション段を評価する。</p>
          </div>
        ) : null}
      </div>
    );
  };

  const motionDagEditor = (layer: 2 | 3) => {
    const enabledKey = (layer === 2 ? 'layer2MotionDagEnabled' : 'layer3MotionDagEnabled') as 'layer2MotionDagEnabled' | 'layer3MotionDagEnabled';
    const dagKey = (layer === 2 ? 'layer2MotionDag' : 'layer3MotionDag') as 'layer2MotionDag' | 'layer3MotionDag';
    const outputKey = (layer === 2 ? 'layer2MotionDagOutput' : 'layer3MotionDagOutput') as 'layer2MotionDagOutput' | 'layer3MotionDagOutput';
    const typeKey = (layer === 2 ? 'layer2Type' : 'layer3Type') as 'layer2Type' | 'layer3Type';
    const mixKey = (layer === 2 ? 'layer2MotionMix' : 'layer3MotionMix') as 'layer2MotionMix' | 'layer3MotionMix';
    const motionsKey = (layer === 2 ? 'layer2Motions' : 'layer3Motions') as 'layer2Motions' | 'layer3Motions';
    const ownStage1: Layer2Type[] = config[mixKey] ? [...(config[motionsKey] as readonly Layer2Type[])] : [config[typeKey] as Layer2Type];
    const dedicated = ownStage1.some((type) => type && isDedicatedSystemMotionType(type));
    return (
      <PlayDagSection
        enabled={Boolean(config[enabledKey])}
        nodes={[...((config[dagKey] as readonly MotionDagNode[]) ?? [])]}
        output={typeof config[outputKey] === 'number' ? (config[outputKey] as number) : -1}
        dedicated={dedicated}
        onToggle={(v) => write(enabledKey, v)}
        onChange={(next) => write(dagKey, next)}
        onOutputChange={(next) => write(outputKey, next)}
        layoutKey={`layer${layer}`}
      />
    );
  };

  const nodeCard = (
    id: GraphNodeId,
    title: string,
    stage: string,
    enabled: boolean | null,
    enabledKey: keyof ParticleConfig | null,
    dimmed: boolean,
    children: React.ReactNode,
  ) => {
    const pos = layout[id];
    return (
      <div
        data-gnode={id}
        className={`absolute rounded-xl border border-white/12 bg-[#101014]/95 shadow-lg ${dimmed ? 'opacity-55' : ''}`}
        style={{ left: pos.x, top: pos.y, width: GRAPH_NODE_WIDTH }}
      >
        <div
          onPointerDown={startDrag(id)}
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/10 cursor-move select-none touch-none"
        >
          <span className="text-[11px] font-semibold tracking-wide">{title}</span>
          <span className="flex items-center gap-2">
            <span className="text-[9px] uppercase tracking-widest text-white/40">{stage}</span>
            {enabled !== null && enabledKey && (
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => write(enabledKey, !enabled)}
                className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${
                  enabled ? 'bg-white text-black' : 'bg-white/10 text-white/50'
                }`}
              >
                {enabled ? 'On' : 'Off'}
              </button>
            )}
          </span>
        </div>
        <div className={`p-2.5 ${isPublicLibrary ? 'pointer-events-none opacity-60' : ''}`}>{children}</div>
      </div>
    );
  };

  const edgePath = (from: GraphNodeId, to: GraphNodeId) => {
    const a = layout[from];
    const b = layout[to];
    const ah = sizes[from]?.h ?? 120;
    const bh = sizes[to]?.h ?? 120;
    const x1 = a.x + GRAPH_NODE_WIDTH;
    const y1 = a.y + ah / 2;
    const x2 = b.x;
    const y2 = b.y + bh / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const layer2Off = !config.layer2Enabled;
  const layer3Off = !config.layer3Enabled;

  return (
    <section>
      <SectionTitle icon={<Network size={12} />}>Node Graph · ノードグラフ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        シーンの構成をノードのつながりとして見る編集画面です。各レイヤーは「発生源（Source）→
        動き（Motion）→ 描画（Render）」の直列で、全レイヤーが出力に合流します。ノード内のプルダウンとスライダーは通常のパネルと同じ設定を直接書き換えます（プリセットや保存データの形式は変わりません）。ノードは見出しをドラッグして並べ替えでき、配置はこのブラウザに保存されます。配線の順序そのものはエンジンの構造で固定です。
      </p>
      <div
        ref={canvasRef}
        className="relative w-full overflow-hidden rounded-2xl border border-white/10"
        style={{
          height: 668,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.13) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          backgroundColor: 'rgba(255,255,255,0.02)',
        }}
      >
        <svg className="absolute inset-0 h-full w-full pointer-events-none">
          {GRAPH_EDGES.map(([from, to]) => (
            <path key={`${from}-${to}`} d={edgePath(from, to)} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
          ))}
        </svg>
        {nodeCard('l2-source', 'Layer 2', 'Source', config.layer2Enabled, 'layer2Enabled', layer2Off, (
          <div className="space-y-1">
            {selectField('layer2Source', GRAPH_SOURCE_OPTIONS)}
            {paramSlider('layer2SourceSpread')}
            {routeEditor(2, 'source')}
          </div>
        ))}
        {nodeCard('l2-motion', 'Layer 2', 'Motion', null, null, layer2Off, (
          <div className="space-y-1">
            {motionSelect('layer2Type')}
            {paramSlider('layer2FlowSpeed')}
            {paramSlider('layer2Complexity')}
            {motionMixEditor(2)}
            {motionChainEditor(2)}
            {routeEditor(2, 'motion')}
            {motionGraphEditor(2)}
            {motionDagEditor(2)}
            {positionFeedbackEditor(2)}
            {warpEditor(2)}
          </div>
        ))}
        {nodeCard('l2-render', 'Layer 2', 'Render', null, null, layer2Off, (
          <div className="space-y-1">
            {selectField('layer2SpriteMode', GRAPH_SPRITE_OPTIONS)}
            {selectField('layer2ConnectionStyle', GRAPH_CONNECTION_OPTIONS)}
            {paramSlider('layer2Count')}
            {paramSlider('layer2BaseSize')}
          </div>
        ))}
        {nodeCard('l3-source', 'Layer 3', 'Source', config.layer3Enabled, 'layer3Enabled', layer3Off, (
          <div className="space-y-1">
            {selectField('layer3Source', GRAPH_SOURCE_OPTIONS)}
            {paramSlider('layer3SourceSpread')}
            {routeEditor(3, 'source')}
          </div>
        ))}
        {nodeCard('l3-motion', 'Layer 3', 'Motion', null, null, layer3Off, (
          <div className="space-y-1">
            {motionSelect('layer3Type')}
            {paramSlider('layer3FlowSpeed')}
            {paramSlider('layer3Complexity')}
            {motionMixEditor(3)}
            {motionChainEditor(3)}
            {routeEditor(3, 'motion')}
            {motionGraphEditor(3)}
            {motionDagEditor(3)}
            {positionFeedbackEditor(3)}
            {warpEditor(3)}
          </div>
        ))}
        {nodeCard('l3-render', 'Layer 3', 'Render', null, null, layer3Off, (
          <div className="space-y-1">
            {selectField('layer3SpriteMode', GRAPH_SPRITE_OPTIONS)}
            {selectField('layer3ConnectionStyle', GRAPH_CONNECTION_OPTIONS)}
            {paramSlider('layer3Count')}
            {paramSlider('layer3BaseSize')}
          </div>
        ))}
        {nodeCard('l1-core', 'Layer 1 · Core', 'SDF', config.layer1Enabled, 'layer1Enabled', !config.layer1Enabled, (
          <div className="space-y-1">
            {paramSlider('layer1Count')}
            {paramSlider('layer1SourceCount')}
            {paramSlider('layer1SourceSpread')}
          </div>
        ))}
        {nodeCard('gpgpu', 'GPGPU', 'Compute', config.gpgpuEnabled, 'gpgpuEnabled', !config.gpgpuEnabled, (
          <div className="space-y-1">
            {selectField('gpgpuEmitShape', GRAPH_EMIT_SHAPE_OPTIONS)}
            {paramSlider('gpgpuBounceRadius')}
            {paramSlider('gpgpuSeed')}
          </div>
        ))}
        {nodeCard('output', 'Output', 'Composite', null, null, false, (
          <p className="text-[11px] leading-relaxed text-white/50">
            全レイヤーを合成して描画します。ポストFX（残像・発光など）の調整は FX タブ側です。このノードは構成の終端を示す表示専用です。
          </p>
        ))}
      </div>
      <div className="mt-2 flex justify-end">
        <button onClick={resetLayout} className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest">
          ノード配置をリセット
        </button>
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではノードからの編集はできません。</p>}
    </section>
  );
};

export const ExportSection: React.FC<{
  captureRef?: React.RefObject<PointCloudCaptureState>;
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ captureRef, config, updateConfig }) => {
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [svgPlane, setSvgPlane] = React.useState<SvgPlane>('xy');
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [],
  );

  const requestExport = (format: 'ply' | 'svg' | 'obj' | 'stl') => {
    const state = captureRef?.current;
    if (!state) {
      setStatus('書き出しチャネルが接続されていません。');
      return;
    }
    if (busy) return;
    state.requested = true;
    setBusy(true);
    setStatus('現在の粒子位置を取得しています…');
    const startedAt = state.capturedAt;
    let tries = 0;
    timerRef.current = window.setInterval(() => {
      tries++;
      if (state.capturedAt !== startedAt && state.buffer.current) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setBusy(false);
        const data = state.buffer.current;
        const count = countExportablePoints(data);
        if (count === 0) {
          setStatus('有効な粒子位置が取得できませんでした。');
          return;
        }
        let contents: string;
        let filename: string;
        let mime: string;
        let statusMessage: string;
        if (format === 'ply') {
          contents = buildPlyPointCloud(data);
          filename = 'monosphere-particles.ply';
          mime = 'application/octet-stream';
          statusMessage = `${count.toLocaleString()} 点を PLY に書き出しました（位置 + 年齢）。`;
        } else if (format === 'svg') {
          const built = buildSvgPointCloud(data, { plane: svgPlane });
          contents = built.svg;
          filename = svgPlane === 'xy' ? 'monosphere-particles-front.svg' : 'monosphere-particles-top.svg';
          mime = 'image/svg+xml';
          statusMessage = `${count.toLocaleString()} 点を SVG に書き出しました（${svgPlane === 'xy' ? '前面 XY' : '上面 XZ'}投影、年齢で濃淡）。`;
        } else {
          // Mesh formats reuse this same captured buffer: the particle
          // field is a texSize × texSize grid, so neighbouring texels
          // triangulate directly (see lib/meshExport.ts).
          const grid = extractGridPositions(data, state.texSize);
          if (!grid) {
            setStatus('粒子グリッドの寸法が分からないため、メッシュ化できませんでした。');
            return;
          }
          const stats = countMeshExport(grid.positions, grid.width, grid.height);
          if (stats.faces === 0) {
            setStatus('メッシュ化できる面がありませんでした（有効な粒子がグリッド上で隣接していない可能性があります）。');
            return;
          }
          if (format === 'obj') {
            contents = buildObjFromGrid(grid.positions, grid.width, grid.height);
            filename = 'monosphere-mesh.obj';
          } else {
            contents = buildStlFromGrid(grid.positions, grid.width, grid.height);
            filename = 'monosphere-mesh.stl';
          }
          mime = 'application/octet-stream';
          statusMessage = `${stats.faces.toLocaleString()} 面 / ${stats.vertices.toLocaleString()} 頂点を ${format.toUpperCase()} メッシュに書き出しました（グリッド ${grid.width}×${grid.height}、無効な頂点を含む面は除外）。`;
        }
        const blob = new Blob([contents], { type: mime });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        setStatus(statusMessage);
        return;
      }
      if (tries >= 20) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setBusy(false);
        setStatus('位置を取得できませんでした。GPGPU系の表示（粒子・メタボール等）が有効な状態でお試しください。WebGPU計算が有効な場合は WebGL 経路では書き出せません。');
      }
    }, 200);
  };

  return (
    <section>
      <SectionTitle icon={<FileDown size={12} />}>Export · 書き出し</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        いま表示している GPGPU 粒子の位置を書き出します。PLY は点群（位置＋年齢）で Blender や MeshLab、TouchDesigner などに持ち込めます。SVG は粒子を点として投影したベクター画像で、前面（XY）／上面（XZ）が選べ、年齢が濃淡になります。OBJ／STL は粒子グリッドの隣接関係をそのまま三角形メッシュにしたもので、Blender での加工や 3D プリントに持ち込めます（無効な頂点を含む面と面積ゼロの面は除外されます）。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => requestExport('ply')}
          disabled={busy}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'PLY書き出し（GPGPU粒子）'}
        </button>
        <button
          onClick={() => requestExport('svg')}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'SVG書き出し'}
        </button>
        <select
          value={svgPlane}
          onChange={(event) => setSvgPlane(event.target.value as SvgPlane)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value="xy" className="bg-neutral-900">前面（XY）</option>
          <option value="xz" className="bg-neutral-900">上面（XZ）</option>
        </select>
        <button
          onClick={() => requestExport('obj')}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'OBJ書き出し（メッシュ）'}
        </button>
        <button
          onClick={() => requestExport('stl')}
          disabled={busy}
          className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          {busy ? '取得中…' : 'STL書き出し（メッシュ）'}
        </button>
      </div>
      {status && <p className="text-[11px] text-white/55 mt-3">{status}</p>}
      <DeterministicRenderControls config={config} updateConfig={updateConfig} />
    </section>
  );
};

type CsgOperandKindUi = CsgPrimitiveKind | 'extrude' | 'mesh';

const CSG_PRIMITIVE_OPTIONS: { value: CsgOperandKindUi; label: string }[] = [
  { value: 'cube', label: '立方体' },
  { value: 'sphere', label: '球' },
  { value: 'cylinder', label: '円柱' },
  { value: 'cone', label: '円錐' },
  { value: 'torus', label: 'トーラス' },
  { value: 'extrude', label: '押し出し（断面→立体）' },
  { value: 'mesh', label: 'メッシュ（OBJ読み込み）' },
];

// Phase CC: CSG panel (final CSG brief, 第1弾). Primitives are
// combined in the manifold-3d worker (lib/csg.ts); the result
// can be pushed into the morph path as indexed OBJ text, which
// also makes it the OBJ-mesh / mesh-SDF source (the three share
// gpgpuMorphObjSource). Nothing runs — and no worker or WASM is
// loaded — until the user presses 実行 with CSG enabled.
export const CsgSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [result, setResult] = React.useState<CsgResultData | null>(() => getLastCsgRun()?.result ?? null);
  const [fromCache, setFromCache] = React.useState(false);
  const [meshImportNote, setMeshImportNote] = React.useState<string | null>(null);

  const customParseUi = React.useMemo(
    () => (config.gpgpuCsgExtrudeProfile === 'custom'
      ? parseFreeformText(config.gpgpuCsgExtrudeCustomText)
      : null),
    [config.gpgpuCsgExtrudeProfile, config.gpgpuCsgExtrudeCustomText],
  );

  const usesMeshUi = config.gpgpuCsgPrimitiveA === 'mesh' || config.gpgpuCsgPrimitiveB === 'mesh';
  const meshParseUi = React.useMemo(() => {
    if (!usesMeshUi) return null;
    const mesh = parseCsgMeshText(config.gpgpuCsgMeshObjText);
    if (!mesh) return { ok: false, reason: 'OBJとして読み取れませんでした。' } as const;
    const gate = checkWatertightGate(mesh.positions, mesh.indices);
    return {
      ok: gate.ok || gate.skipped,
      gate,
      vertexCount: mesh.vertexCount,
      triangleCount: mesh.triangleCount,
    } as const;
  }, [usesMeshUi, config.gpgpuCsgMeshObjText]);

  const buildOperand = (
    kind: CsgOperandKindUi,
    size: number,
    offset: readonly [number, number, number],
    customPolygons?: readonly (readonly (readonly [number, number])[])[],
    meshOperand?: CsgOperand | null,
  ): CsgOperand => {
    if (kind === 'mesh') {
      // Built by run() via buildMeshOperandFromObj (raw
      // units + this operand's offset). The fallback is
      // unreachable: run() aborts when the build fails.
      return meshOperand ?? { type: 'mesh', positions: new Float32Array(0), indices: null };
    }
    if (kind === 'extrude') {
      return {
        type: 'extrude',
        spec: {
          profile: config.gpgpuCsgExtrudeProfile,
          size,
          segments: config.gpgpuCsgSegments,
          height: config.gpgpuCsgExtrudeHeight,
          divisions: config.gpgpuCsgExtrudeDivisions,
          twistDegrees: config.gpgpuCsgExtrudeTwist,
          scaleTop: config.gpgpuCsgExtrudeScaleTop,
          offset,
          ...(config.gpgpuCsgExtrudeProfile === 'custom'
            ? { customPolygons: customPolygons ?? [] }
            : {}),
        },
      };
    }
    return {
      type: 'primitive',
      spec: {
        kind,
        size,
        segments: config.gpgpuCsgSegments,
        offset,
      },
    };
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('CSG を計算しています…（初回は WASM の読み込みを含みます）');
    const usesCustom = (config.gpgpuCsgPrimitiveA === 'extrude' || config.gpgpuCsgPrimitiveB === 'extrude')
      && config.gpgpuCsgExtrudeProfile === 'custom';
    const customParse = usesCustom ? parseFreeformText(config.gpgpuCsgExtrudeCustomText) : null;
    if (customParse && !customParse.ok) {
      setStatus(`カスタム断面を読めません: ${customParse.reason}`);
      setBusy(false);
      return;
    }
    const bOffset: readonly [number, number, number] = [
      config.gpgpuCsgOffsetBX,
      config.gpgpuCsgOffsetBY,
      config.gpgpuCsgOffsetBZ,
    ];
    const meshA = config.gpgpuCsgPrimitiveA === 'mesh'
      ? buildMeshOperandFromObj(config.gpgpuCsgMeshObjText, [0, 0, 0])
      : null;
    const meshB = config.gpgpuCsgPrimitiveB === 'mesh'
      ? buildMeshOperandFromObj(config.gpgpuCsgMeshObjText, bOffset)
      : null;
    const meshFail = (meshA && !meshA.ok ? meshA : null) ?? (meshB && !meshB.ok ? meshB : null);
    if (meshFail) {
      setStatus(`メッシュを読めません: ${meshFail.reason}`);
      setBusy(false);
      return;
    }
    const a: CsgOperand = buildOperand(config.gpgpuCsgPrimitiveA, config.gpgpuCsgSizeA, [0, 0, 0], customParse?.polygons,
      meshA && meshA.ok ? meshA.operand : null);
    const b: CsgOperand = buildOperand(config.gpgpuCsgPrimitiveB, config.gpgpuCsgSizeB, bOffset, customParse?.polygons,
      meshB && meshB.ok ? meshB.operand : null);
    try {
      const out = await runCsgOperation(a, b, config.gpgpuCsgOperation, config.gpgpuCsgFinish, config.gpgpuCsgRefineDivisions);
      const cached = getLastCsgRun()?.fromCache ?? false;
      setResult(out);
      setFromCache(cached);
      setStatus(
        `完了: 体積 ${out.volume.toFixed(4)} / ${out.triangles.toLocaleString()} 三角形` +
          `（出力再検査: 閉・オイラー標数 ${out.gate.euler}・成分 ${out.gate.components}・種数 ${out.gate.genus}）` +
          (config.gpgpuCsgFinish === 'hull' ? ' ※仕上げ: ハル（凸包）' : '') +
          (config.gpgpuCsgFinish === 'refine' ? ` ※仕上げ: 細分化（分割数 ${config.gpgpuCsgRefineDivisions}）` : '') +
          (cached ? ' ※同じ被演算子・演算のキャッシュ結果です' : ''),
      );
    } catch (e) {
      setResult(null);
      if (e instanceof CsgError && e.code === 'EMPTY_RESULT') {
        setStatus('演算結果は空でした（体積 0）。被演算子の重なり方を変えてください。');
      } else {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const takeIntoMorph = () => {
    if (!result) return;
    const text = buildIndexedObjText(result.positions, result.indices, 'csg-result');
    updateConfig('gpgpuMorphObjSource', text);
    updateConfig('gpgpuObjMeshEnabled', true);
    setStatus(
      'CSG 結果をモーフ経路へ取り込みました（OBJ メッシュ描画も ON）。' +
        '注意: 中空の結果はメッシュ SDF では中身詰まりとして扱われます。薄い結果は SDF の解像度を 96³ に上げてください。',
    );
  };

  const exportResult = async (format: 'glb' | '3mf' | 'stl') => {
    if (!result || busy) return;
    setBusy(true);
    try {
      const { exportCsgResult } = await import('../lib/csgExport');
      const out = await exportCsgResult(result, format);
      const blob = new Blob([out.bytes], { type: out.mime });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = out.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(
        `CSG 結果を ${format.toUpperCase()} に書き出しました（${out.bytes.byteLength.toLocaleString()} バイト）。` +
          (format === 'glb'
            ? 'GLB は m・Y-up、EXT_mesh_manifold つきです。'
            : format === '3mf'
              ? '3MF は mm・Z-up に変換済みです（スライサでそのまま開けます）。'
              : 'STL は互換用フォーマットです。'),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selectClass =
    'bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40 w-full';
  const selectStyle = { backgroundColor: undefined } as const;

  return (
    <section>
      <SectionTitle icon={<Box size={12} />}>CSG · メッシュ演算</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        プリミティブ同士、または断面の押し出しや読み込んだ OBJ メッシュとの和・差・積を manifold-3d（Worker＋WASM）で計算し、結果をモーフ経路へ取り込めます。
        仕上げにハル（凸包）を選ぶと、結果全体を1つの凸立体に置き換えます（離れた部品同士も橋渡しされます）。
        細分化は形を変えずに三角形を細かく割り、モーフ先としての密度を上げます。
        演算は1回実行型で、同じ被演算子・演算の再実行はキャッシュを返します。完全に一致する形同士の演算は通常より時間がかかる場合があります。
        無効の間は Worker も WASM も読み込まれません。
      </p>
      <Toggle
        label="CSG 有効"
        value={config.gpgpuCsgEnabled}
        options={[
          { label: 'OFF', val: false },
          { label: 'ON', val: true },
        ]}
        onChange={(v) => updateConfig('gpgpuCsgEnabled', v)}
      />
      {config.gpgpuCsgEnabled && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="block mb-1.5 text-[10px] uppercase tracking-widest font-medium text-white/65">被演算子 A</span>
              <select
                value={config.gpgpuCsgPrimitiveA}
                onChange={(e) => updateConfig('gpgpuCsgPrimitiveA', e.target.value as CsgOperandKindUi)}
                className={selectClass}
                style={selectStyle}
              >
                {CSG_PRIMITIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-neutral-900">{o.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block mb-1.5 text-[10px] uppercase tracking-widest font-medium text-white/65">被演算子 B</span>
              <select
                value={config.gpgpuCsgPrimitiveB}
                onChange={(e) => updateConfig('gpgpuCsgPrimitiveB', e.target.value as CsgOperandKindUi)}
                className={selectClass}
                style={selectStyle}
              >
                {CSG_PRIMITIVE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value} className="bg-neutral-900">{o.label}</option>
                ))}
              </select>
            </label>
          </div>
          <Toggle
            label="演算"
            value={config.gpgpuCsgOperation}
            options={[
              { label: '和 A∪B', val: 'union' as const },
              { label: '差 A−B', val: 'difference' as const },
              { label: '積 A∩B', val: 'intersection' as const },
            ]}
            onChange={(v) => updateConfig('gpgpuCsgOperation', v)}
          />
          <Toggle
            label="仕上げ"
            value={config.gpgpuCsgFinish}
            options={[
              { label: 'そのまま', val: 'none' as const },
              { label: 'ハル（凸包）', val: 'hull' as const },
              { label: '細分化', val: 'refine' as const },
            ]}
            onChange={(v) => updateConfig('gpgpuCsgFinish', v)}
          />
          {config.gpgpuCsgFinish === 'refine' && (
            <Slider label="細分化の分割数" value={config.gpgpuCsgRefineDivisions} min={2} max={3} step={1} onChange={(v) => updateConfig('gpgpuCsgRefineDivisions', v)} />
          )}
          <Slider label="A のサイズ" value={config.gpgpuCsgSizeA} min={0.2} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuCsgSizeA', v)} />
          <Slider label="B のサイズ" value={config.gpgpuCsgSizeB} min={0.2} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuCsgSizeB', v)} />
          <Slider label="円分割数" value={config.gpgpuCsgSegments} min={4} max={128} step={4} onChange={(v) => updateConfig('gpgpuCsgSegments', v)} />
          <Slider label="B オフセット X" value={config.gpgpuCsgOffsetBX} min={-3} max={3} step={0.1} onChange={(v) => updateConfig('gpgpuCsgOffsetBX', v)} />
          <Slider label="B オフセット Y" value={config.gpgpuCsgOffsetBY} min={-3} max={3} step={0.1} onChange={(v) => updateConfig('gpgpuCsgOffsetBY', v)} />
          <Slider label="B オフセット Z" value={config.gpgpuCsgOffsetBZ} min={-3} max={3} step={0.1} onChange={(v) => updateConfig('gpgpuCsgOffsetBZ', v)} />
          {(config.gpgpuCsgPrimitiveA === 'extrude' || config.gpgpuCsgPrimitiveB === 'extrude') && (
            <div className="mt-2">
              <label className="block mb-3">
                <span className="block mb-1.5 text-[10px] uppercase tracking-widest font-medium text-white/65">押し出しの断面</span>
                <select
                  value={config.gpgpuCsgExtrudeProfile}
                  onChange={(e) => updateConfig('gpgpuCsgExtrudeProfile', e.target.value as 'square' | 'circle' | 'polygon' | 'custom')}
                  className={selectClass}
                  style={selectStyle}
                >
                  <option value="square" className="bg-neutral-900">四角形</option>
                  <option value="circle" className="bg-neutral-900">円</option>
                  <option value="polygon" className="bg-neutral-900">多角形（辺数＝円分割数）</option>
                  <option value="custom" className="bg-neutral-900">カスタム（自由形）</option>
                </select>
              </label>
              <Slider label="押し出しの高さ" value={config.gpgpuCsgExtrudeHeight} min={0.1} max={4} step={0.05} onChange={(v) => updateConfig('gpgpuCsgExtrudeHeight', v)} />
              <Slider label="ねじり（度）" value={config.gpgpuCsgExtrudeTwist} min={-360} max={360} step={5} onChange={(v) => updateConfig('gpgpuCsgExtrudeTwist', v)} />
              <Slider label="先端スケール" value={config.gpgpuCsgExtrudeScaleTop} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuCsgExtrudeScaleTop', v)} />
              <Slider label="ねじり分割数" value={config.gpgpuCsgExtrudeDivisions} min={0} max={32} step={1} onChange={(v) => updateConfig('gpgpuCsgExtrudeDivisions', v)} />
              <p className="text-[11px] leading-relaxed text-white/45 mt-1">
                押し出しは A・B 共通の設定です。サイズは断面の大きさ（四角形の一辺／円の直径／多角形の外接直径）に使います。
                ねじると体積が変わり、変わり方は分割数に依存します。カスタム断面は座標がそのまま世界単位で、サイズは適用されません。
              </p>
              {config.gpgpuCsgExtrudeProfile === 'custom' && (
                <div className="mt-2">
                  <span className="block mb-1.5 text-[10px] uppercase tracking-widest font-medium text-white/65">カスタム断面（点リスト／SVG）</span>
                  <textarea
                    value={config.gpgpuCsgExtrudeCustomText}
                    onChange={(event) => updateConfig('gpgpuCsgExtrudeCustomText', event.target.value.slice(0, 200_000))}
                    spellCheck={false}
                    rows={5}
                    className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                    placeholder={'点リスト: "0, 1.1" のような行（空行で図形を区切る）／ SVG パス "M ... Z" ／ SVG 文書そのまま'}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 cursor-pointer">
                      SVG／テキストを読み込む
                      <input
                        type="file"
                        accept=".svg,.txt,image/svg+xml,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void f.text().then((t) => updateConfig('gpgpuCsgExtrudeCustomText', t.slice(0, 200_000)));
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <span className="text-[10px] text-white/50">
                      {customParseUi
                        ? customParseUi.ok
                          ? `${customParseUi.polygons.length} 図形・${customParseUi.pointCount} 点（${customParseUi.format === 'points' ? '点リスト' : customParseUi.format === 'svg-path' ? 'SVG パス' : 'SVG 文書'}）`
                          : `読めません: ${customParseUi.reason}`
                        : ''}
                    </span>
                  </div>
                  <CsgFreeformEditor
                    text={config.gpgpuCsgExtrudeCustomText}
                    onChange={(t) => updateConfig('gpgpuCsgExtrudeCustomText', t)}
                  />
                </div>
              )}
            </div>
          )}
          {usesMeshUi && (
            <div className="mt-2">
              <span className="block mb-1.5 text-[10px] uppercase tracking-widest font-medium text-white/65">メッシュ（OBJ／STL／glTF）</span>
              <textarea
                value={config.gpgpuCsgMeshObjText}
                onChange={(event) => updateConfig('gpgpuCsgMeshObjText', event.target.value.slice(0, MESH_OBJ_TEXT_MAX_CHARS))}
                spellCheck={false}
                rows={5}
                className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
                placeholder={'OBJテキスト（v と f を含むもの）。閉じたメッシュだけが演算できます'}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 cursor-pointer">
                  OBJ／テキストを読み込む
                  <input
                    type="file"
                    accept=".obj,.txt,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void f.text().then((t) => updateConfig('gpgpuCsgMeshObjText', t.slice(0, MESH_OBJ_TEXT_MAX_CHARS)));
                      e.target.value = '';
                    }}
                  />
                </label>
                <label className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 cursor-pointer">
                  STL／glTF を読み込む
                  <input
                    type="file"
                    accept=".stl,.glb,.gltf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      void (async () => {
                        const res = await importMeshFileToObjText(f.name, await f.arrayBuffer());
                        if (res.ok) {
                          updateConfig('gpgpuCsgMeshObjText', res.objText);
                          setMeshImportNote(
                            (res.format === 'stl' ? 'STL' : 'glTF') + '「' + f.name + '」を取り込みました（頂点 ' +
                            res.vertexCount.toLocaleString() + '・三角形 ' + res.triangleCount.toLocaleString() +
                            '）。OBJテキストに変換して上の欄に入っています。',
                          );
                        } else {
                          setMeshImportNote('取り込めません: ' + res.reason);
                        }
                      })();
                    }}
                  />
                </label>
                <span className="text-[10px] text-white/50">
                  {meshParseUi
                    ? 'reason' in meshParseUi
                      ? `読めません: ${meshParseUi.reason}`
                      : meshParseUi.gate.skipped
                        ? `頂点 ${meshParseUi.vertexCount}・三角形 ${meshParseUi.triangleCount}（面が多すぎるため閉検査は省略され、Worker 側で判定されます）`
                        : meshParseUi.ok
                          ? `頂点 ${meshParseUi.vertexCount}・三角形 ${meshParseUi.triangleCount}（閉じたメッシュ・種数 ${meshParseUi.gate.genus}）`
                          : `閉じたメッシュではありません: ${meshParseUi.gate.reason}`
                    : ''}
                </span>
              </div>
              {meshImportNote && (
                <p className="text-[11px] leading-relaxed text-white/60 mt-1">{meshImportNote}</p>
              )}
              <p className="text-[11px] leading-relaxed text-white/45 mt-1">
                メッシュは A・B 共通のテキストです。座標はそのまま世界単位で、サイズは適用されません（配置は B のオフセットだけが効きます）。
                頂点は 1e-6 で重なりを同一視してから判定します。開いたメッシュや自己交差するメッシュは、理由を表示して弾きます（自動修復はしません）。
                STL／glTF は読み込み時に OBJ テキストへ変換されます（glTF はノードの変形を座標に焼き付け、最初のメッシュだけを使います。外部ファイルを参照する .gltf は .glb で読み込んでください）。
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              onClick={run}
              disabled={busy}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              {busy ? '計算中…' : 'CSG を実行'}
            </button>
            <button
              onClick={takeIntoMorph}
              disabled={!result || busy}
              className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              結果をモーフへ取り込む
            </button>
            <button
              onClick={() => void exportResult('glb')}
              disabled={!result || busy}
              className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              GLBで書き出し
            </button>
            <button
              onClick={() => void exportResult('3mf')}
              disabled={!result || busy}
              className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              3MFで書き出し
            </button>
            <button
              onClick={() => void exportResult('stl')}
              disabled={!result || busy}
              className="px-4 py-2 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              STLで書き出し
            </button>
            {fromCache && result && <span className="text-[10px] text-white/40">キャッシュ済み結果を表示中</span>}
          </div>
          <p className="text-[11px] leading-relaxed text-white/45 mt-1">
            書き出し: GLB は m・Y-up（EXT_mesh_manifold つき）、3MF はスライサ用に mm・Z-up へ変換して書き出します。STL は互換用です。
          </p>
        </div>
      )}
      {status && <p className="text-[11px] text-white/55 mt-3">{status}</p>}
    </section>
  );
};

export const KeyboardShortcutsSection: React.FC = () => (
  <section>
    <SectionTitle icon={<Keyboard size={12} />}>Keyboard Shortcuts · ショートカット</SectionTitle>
    <ul className="space-y-1.5 text-[11px] leading-relaxed text-white/55">
      <li><span className="font-mono text-white/85">Space</span> — 再生 / 一時停止</li>
      <li><span className="font-mono text-white/85">[</span> / <span className="font-mono text-white/85">]</span> — 前 / 次のプリセット（棚の並び順）</li>
      <li><span className="font-mono text-white/85">F</span> — 全画面表示の切り替え</li>
      <li><span className="font-mono text-white/85">B</span> — コントロールシートの開閉</li>
    </ul>
    <p className="mt-3 text-[11px] leading-relaxed text-white/45">
      入力欄にフォーカスがある間はショートカットは効きません。
    </p>
  </section>
);

