import React from 'react';
import { Blend, Layers } from 'lucide-react';
import type { ParticleConfig, PresetRecord } from '../types';
import { PARTIAL_GROUPS, applyPartialConfig, blendConfigs, groupKeyCount } from '../lib/presetPartial';

// Partial apply / blend (programme item 9): take only chosen parameter
// groups from another preset, or blend two presets numerically. Lives in
// the Play tab next to Breeding; applies through the same onApplyConfig
// path as every other Play feature.

const selectClass =
  'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';
const buttonClass =
  'rounded border border-white/20 bg-white/10 px-3 py-2 text-[11px] tracking-wider text-white/85 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40';

export const PartialApplySection: React.FC<{
  presets: PresetRecord[];
  config: ParticleConfig;
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
  onSaveBredPreset?: (config: ParticleConfig, name: string) => void;
}> = ({ presets, config, isPublicLibrary, onApplyConfig, onSaveBredPreset }) => {
  const [sourceId, setSourceId] = React.useState<string>('');
  const [groups, setGroups] = React.useState<ReadonlySet<string>>(new Set(['motion']));
  const [blendAId, setBlendAId] = React.useState<string>('');
  const [blendBId, setBlendBId] = React.useState<string>('');
  const [blendT, setBlendT] = React.useState(0.5);
  const [note, setNote] = React.useState('');

  const source = presets.find((p) => p.id === sourceId) ?? presets[0];
  const blendA = presets.find((p) => p.id === blendAId) ?? presets[0];
  const blendB = presets.find((p) => p.id === blendBId) ?? presets[1] ?? presets[0];
  const affected = source ? groupKeyCount(source.config, groups) : 0;

  if (isPublicLibrary || !onApplyConfig) return null;

  const toggleGroup = (id: string) => {
    setGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePartial = () => {
    if (!source || groups.size === 0) return;
    onApplyConfig(applyPartialConfig(config, source.config, groups));
    setNote(`「${source.name}」から ${affected} 項目を適用しました`);
    window.setTimeout(() => setNote(''), 4000);
  };

  const handleBlend = (save: boolean) => {
    if (!blendA || !blendB || blendA.id === blendB.id) return;
    const blended = blendConfigs(blendA.config, blendB.config, blendT);
    if (save && onSaveBredPreset) {
      onSaveBredPreset(blended, `Blend: ${blendA.name} × ${blendB.name} (${blendT.toFixed(2)})`);
      setNote('ブレンド結果をプリセットとして保存しました');
    } else {
      onApplyConfig(blended);
      setNote(`「${blendA.name}」と「${blendB.name}」を ${blendT.toFixed(2)} でブレンドして適用しました`);
    }
    window.setTimeout(() => setNote(''), 4000);
  };

  const presetOptions = (value: string, onChange: (v: string) => void, testid: string) => (
    <select data-testid={testid} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );

  return (
    <section>
      <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
        <Layers size={12} /> Partial Apply & Blend · 部分適用とブレンド
      </h3>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        プリセットの一部だけを今の設定に取り込む「部分適用」と、2つのプリセットを数値で混ぜる「ブレンド」です。部分適用は選んだグループのパラメータだけを上書きし、他は今のまま残ります。
      </p>

      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-white/50">取り込み元プリセット</div>
          {presetOptions(source?.id ?? '', (v) => setSourceId(v), 'partial-source')}
        </div>
        <div className="flex flex-wrap gap-2">
          {PARTIAL_GROUPS.map((g) => (
            <button
              key={g.id}
              type="button"
              data-testid={`partial-group-${g.id}`}
              onClick={() => toggleGroup(g.id)}
              title={g.description}
              className={`rounded-full border px-3 py-1 text-[10px] tracking-wider transition-colors ${
                groups.has(g.id)
                  ? 'border-sky-300/60 bg-sky-300/15 text-sky-200'
                  : 'border-white/15 text-white/60 hover:border-white/35 hover:text-white'
              }`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" data-testid="partial-apply" className={buttonClass} disabled={!source || groups.size === 0} onClick={handlePartial}>
            選択グループだけ適用（{affected} 項目）
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/50">
          <Blend size={11} /> ブレンド（2プリセットを数値で混合）
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-[10px] text-white/40">A</div>
            {presetOptions(blendA?.id ?? '', (v) => setBlendAId(v), 'blend-a')}
          </div>
          <div>
            <div className="mb-1 text-[10px] text-white/40">B</div>
            {presetOptions(blendB?.id ?? '', (v) => setBlendBId(v), 'blend-b')}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-white/50">
            <span>A 1.00</span>
            <span>混合比 {blendT.toFixed(2)}</span>
            <span>B 1.00</span>
          </span>
          <input
            type="range"
            data-testid="blend-t"
            min={0}
            max={1}
            step={0.05}
            value={blendT}
            onChange={(e) => setBlendT(Number(e.target.value))}
            className="w-full accent-white"
          />
        </label>
        <div className="flex items-center gap-3">
          <button type="button" data-testid="blend-apply" className={buttonClass} disabled={!blendA || !blendB || blendA.id === blendB.id} onClick={() => handleBlend(false)}>
            ブレンドを適用
          </button>
          {onSaveBredPreset && (
            <button type="button" data-testid="blend-save" className={buttonClass} disabled={!blendA || !blendB || blendA.id === blendB.id} onClick={() => handleBlend(true)}>
              ブレンド結果を保存
            </button>
          )}
        </div>
      </div>
      {note ? <p className="mt-3 text-[11px] text-emerald-300/90" data-testid="partial-note">{note}</p> : null}
    </section>
  );
};
