import React from 'react';
import { Link2, List, Route, Workflow } from 'lucide-react';
import type { Layer2Type, MotionGraphStep } from '../types';
import { isPlacementMotionType, MOTION_CHAIN_MAX_EXTRA_STAGES } from '../lib/motionChain';
import { MOTION_OPTIONS } from './controlPanelMotionCatalog';
import { MotionSelector } from './controlPanelMotionSelector';

export { MotionSelector, MOTION_OPTIONS };

export const MotionChainConfig: React.FC<{
  enabled: boolean;
  chain: Layer2Type[];
  onToggle: (enabled: boolean) => void;
  onChange: (chain: Layer2Type[]) => void;
  disabledReason?: string | null;
  currentTheme: 'white' | 'black';
}> = ({ enabled, chain, onToggle, onChange, disabledReason, currentTheme }) => {
  const selectClass = `text-[10px] uppercase font-bold p-1 rounded border-none outline-none cursor-pointer ${
    currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
  }`;
  const setStage = (stageIndex: number, value: string) => {
    const next: (Layer2Type | null)[] = [chain[0] ?? null, chain[1] ?? null];
    next[stageIndex] = value === '' ? null : (value as Layer2Type);
    if (next[0] === null) next[1] = null;
    onChange(next.filter((entry): entry is Layer2Type => entry !== null));
  };
  const hasPlacement = chain.some((entry) => isPlacementMotionType(entry));
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
          <Link2 size={14} />
          <span>Motion Chain</span>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? 'bg-white' : 'bg-white/20'}`}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? ''}
        >
          <div className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      {disabledReason ? (
        <p className="text-[9px] leading-relaxed text-white/35">{disabledReason}</p>
      ) : enabled ? (
        <div className="space-y-2">
          {Array.from({ length: MOTION_CHAIN_MAX_EXTRA_STAGES }).map((_, stageIndex) => (
            <div key={stageIndex} className="flex items-center justify-between bg-white/5 p-2 rounded border border-white/10">
              <span className="text-[10px] font-mono opacity-80">Stage {stageIndex + 2}</span>
              <select
                value={chain[stageIndex] ?? ''}
                onChange={(e) => setStage(stageIndex, e.target.value)}
                disabled={stageIndex > 0 && !chain[stageIndex - 1]}
                className={selectClass}
              >
                <option value="">— None —</option>
                {MOTION_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}
          {hasPlacement && (
            <p className="text-[9px] leading-relaxed text-white/35">配置系のモーションは前段の形状をそのまま変位させるのではなく、再配置します。</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

export const PerSourceMotionConfig: React.FC<{
  count: number;
  motions: Layer2Type[];
  onChange: (index: number, val: Layer2Type) => void;
  currentTheme: 'white' | 'black';
}> = ({ count, motions, onChange, currentTheme }) => (
  <div className="mb-5 space-y-2">
    <div className="text-[10px] uppercase tracking-widest font-medium opacity-70 mb-2 flex items-center gap-2">
      <List size={12} /> Configure Motions
    </div>
    {Array.from({ length: Math.min(count, 20) }).map((_, idx) => (
      <div key={idx} className="flex items-center justify-between bg-white/5 p-2 rounded border border-white/10">
        <span className="text-[10px] font-mono opacity-80">Source {idx + 1}</span>
        <select
          value={motions[idx] || 'flow'}
          onChange={(e) => onChange(idx, e.target.value as Layer2Type)}
          className={`text-[10px] uppercase font-bold p-1 rounded border-none outline-none cursor-pointer ${
            currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
          }`}
        >
          {MOTION_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.label}</option>
          ))}
        </select>
      </div>
    ))}
  </div>
);

export const LayerRouteConfig: React.FC<{
  title: string;
  enabled: boolean;
  from: 'layer2' | 'layer3' | null;
  layerIndex: 2 | 3;
  onToggle: (enabled: boolean) => void;
  onChange: (from: 'layer2' | 'layer3' | null) => void;
  disabledReason?: string | null;
  note?: string | null;
  currentTheme: 'white' | 'black';
}> = ({ title, enabled, from, layerIndex, onToggle, onChange, disabledReason, note, currentTheme }) => {
  const selectClass = `text-[10px] uppercase font-bold p-1 rounded border-none outline-none cursor-pointer ${
    currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
  }`;
  const otherLayer = layerIndex === 2 ? 3 : 2;
  const otherValue = `layer${otherLayer}` as 'layer2' | 'layer3';
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
          <Route size={14} />
          <span>{title}</span>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? 'bg-white' : 'bg-white/20'}`}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? ''}
        >
          <div className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      {disabledReason ? (
        <p className="text-[9px] leading-relaxed text-white/35">{disabledReason}</p>
      ) : enabled ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between bg-white/5 p-2 rounded border border-white/10">
            <span className="text-[10px] font-mono opacity-80">From</span>
            <select
              value={from ?? ''}
              onChange={(e) => onChange(e.target.value === '' ? null : (e.target.value as 'layer2' | 'layer3'))}
              className={selectClass}
            >
              <option value="">— None —</option>
              <option value={otherValue}>Layer {otherLayer}</option>
            </select>
          </div>
          {note && (
            <p className="text-[9px] leading-relaxed text-white/35">{note}</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

const GRAPH_INPUT_LABELS: { value: MotionGraphStep['input']; label: string }[] = [
  { value: 'prev', label: 'prev（直前の結果）' },
  { value: 'source', label: 'source（元の形）' },
  { value: 'branch', label: 'branch（保存した形）' },
];

export const MotionGraphConfig: React.FC<{
  enabled: boolean;
  steps: MotionGraphStep[];
  onToggle: (enabled: boolean) => void;
  onChange: (steps: MotionGraphStep[]) => void;
  disabledReason?: string | null;
  currentTheme: 'white' | 'black';
}> = ({ enabled, steps, onToggle, onChange, disabledReason, currentTheme }) => {
  const selectClass = `text-[10px] uppercase font-bold p-1 rounded border-none outline-none cursor-pointer ${
    currentTheme === 'white' ? 'bg-black text-white' : 'bg-white text-black'
  }`;
  const patch = (index: number, part: Partial<MotionGraphStep>) => {
    onChange(steps.map((step, i) => (i === index ? { ...step, ...part } : step)));
  };
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
        <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
          <Workflow size={14} />
          <span>Motion Graph</span>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`w-10 h-5 rounded-full relative transition-colors ${enabled ? 'bg-white' : 'bg-white/20'}`}
          disabled={Boolean(disabledReason)}
          title={disabledReason ?? ''}
        >
          <div className={`absolute top-1 w-3 h-3 rounded-full bg-black transition-all ${enabled ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      {disabledReason ? (
        <p className="text-[9px] leading-relaxed text-white/35">{disabledReason}</p>
      ) : enabled ? (
        <div className="space-y-2">
          {steps.map((step, index) => (
            <div key={index} className="rounded border border-white/10 bg-white/5 p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono text-white/50">Step {index + 1}</span>
                <span className="flex gap-1">
                  <button onClick={() => move(index, -1)} className="px-1.5 text-[10px] bg-white/10 rounded" title="上へ">↑</button>
                  <button onClick={() => move(index, 1)} className="px-1.5 text-[10px] bg-white/10 rounded" title="下へ">↓</button>
                  <button onClick={() => patch(index, { saveBranch: !step.saveBranch })} className={`px-1.5 text-[9px] rounded ${step.saveBranch ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/50'}`} title="このステップの開始時に現在の形を branch に保存">
                    {step.saveBranch ? 'branch保存: On' : 'branch保存: Off'}
                  </button>
                  <button onClick={() => onChange(steps.filter((_, i) => i !== index))} className="px-1.5 text-[10px] bg-white/10 rounded" title="削除">✕</button>
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-white/45">Motion</span>
                <select value={step.motion} onChange={(e) => patch(index, { motion: e.target.value as Layer2Type })} className={selectClass}>
                  {MOTION_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-white/45">Input</span>
                <select value={step.input} onChange={(e) => patch(index, { input: e.target.value as MotionGraphStep['input'] })} className={selectClass}>
                  {GRAPH_INPUT_LABELS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] text-white/45">Blend {step.blend.toFixed(2)}</span>
                <input
                  type="range" min={0} max={1} step={0.05} value={step.blend}
                  onChange={(e) => patch(index, { blend: Number(e.target.value) })}
                  className="w-28 accent-white"
                />
              </div>
            </div>
          ))}
          {steps.length < 8 && (
            <button
              onClick={() => onChange([...steps, { motion: 'flow', input: 'prev', blend: 1, saveBranch: false }])}
              className="w-full py-1 text-[10px] uppercase font-bold bg-white/10 rounded hover:bg-white/20"
            >
              + Step を追加（最大8）
            </button>
          )}
          <p className="text-[9px] leading-relaxed text-white/35">
            自レイヤーのスタック（第1段＋チェーン）の後段で動くステップ列です。branch に保存した形や source（元の形）を後段で合流できます（blend は合流の強さ）。
          </p>
        </div>
      ) : null}
    </div>
  );
};

export const WarpConfig: React.FC<{
  enabled: boolean;
  amount: number;
  scale: number;
  onToggle: (enabled: boolean) => void;
  onChange: (amount: number, scale: number) => void;
  disabledReason?: string | null;
}> = ({ enabled, amount, scale, onToggle, onChange, disabledReason }) => (
  <div className="mb-5">
    <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
        <Workflow size={14} />
        <span>Domain Warp</span>
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
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="w-16 uppercase">amount</span>
          <input type="range" min={0} max={60} step={1} value={amount} onChange={(event) => onChange(Number(event.target.value), scale)} className="w-full" />
          <span className="w-8 font-mono text-right">{amount.toFixed(0)}</span>
        </label>
        <label className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="w-16 uppercase">scale</span>
          <input type="range" min={0.002} max={0.05} step={0.001} value={scale} onChange={(event) => onChange(amount, Number(event.target.value))} className="w-full" />
          <span className="w-8 font-mono text-right">{scale.toFixed(3)}</span>
        </label>
        <p className="text-[9px] leading-relaxed text-white/35">
          モーションを評価する空間そのものをノイズで歪めます（ドメインワープ）。ルート・本流・チェーン・グラフ・DAGの全段に効き、形が有機的にうねります。
        </p>
      </div>
    ) : (
      <p className="text-[10px] leading-relaxed text-white/40">
        ドメインワープ：入力空間を歪めてからモーションを評価する理論レイヤー。
      </p>
    )}
  </div>
);

export const PositionFeedbackConfig: React.FC<{
  enabled: boolean;
  feedback: number;
  decay: number;
  onToggle: (enabled: boolean) => void;
  onChange: (feedback: number, decay: number) => void;
  disabledReason?: string | null;
}> = ({ enabled, feedback, decay, onToggle, onChange, disabledReason }) => (
  <div className="mb-5">
    <div className="mb-2 flex items-center justify-between border border-white/20 p-2 rounded bg-white/5">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-white/80">
        <Route size={14} />
        <span>Position Feedback</span>
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
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="w-16 uppercase">feedback</span>
          <input type="range" min={0} max={1} step={0.05} value={feedback} onChange={(event) => onChange(Number(event.target.value), decay)} className="w-full" />
          <span className="w-8 font-mono text-right">{feedback.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2 text-[10px] text-white/60">
          <span className="w-16 uppercase">decay</span>
          <input type="range" min={0} max={1} step={0.05} value={decay} onChange={(event) => onChange(feedback, Number(event.target.value))} className="w-full" />
          <span className="w-8 font-mono text-right">{decay.toFixed(2)}</span>
        </label>
        <p className="text-[9px] leading-relaxed text-white/35">
          前フレームの最終位置を引きずります（feedback が大きいほど残像・蓄積が強く、decay は元の形への復帰力）。点の描画にのみ効きます。決定的書き出しでは自動で無効になります。
        </p>
      </div>
    ) : (
      <p className="text-[10px] leading-relaxed text-white/40">
        方式C：前フレームの位置を混合して蓄積・残像・緩和を生むフィードバック（段階④）。
      </p>
    )}
  </div>
);
