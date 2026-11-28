import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import { CUSTOM_FORCE_CTRL_EXAMPLE, CUSTOM_FORCE_EXAMPLE, useCustomForceStatus } from '../lib/gpgpuCustomForce';
import { extractCustomForceControls, resolveCtrlValues } from '../lib/gpgpuCustomForceControls';
import { VEX_PRESETS } from '../lib/gpgpuVexPresets';
import { serializeModulationSetup, useResolvedModulationSetup } from '../lib/modulation';
import type { ParticleConfig } from '../types';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const CustomForceBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const status = useCustomForceStatus();
  const [draft, setDraft] = React.useState(config.gpgpuCustomForceCode);
  const dirty = draft !== config.gpgpuCustomForceCode;
  // KCB1: sliders are generated from the ctrl() declarations of the
  // APPLIED snippet (the draft's declarations take effect on 適用).
  const appliedCtrls = React.useMemo(
    () => extractCustomForceControls(config.gpgpuCustomForceCode),
    [config.gpgpuCustomForceCode],
  );
  const ctrlValues = resolveCtrlValues(appliedCtrls.decls, config.gpgpuCustomForceCtrlValues);
  const draftCtrlCount = React.useMemo(
    () => extractCustomForceControls(draft).decls.length,
    [draft],
  );
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Custom Force (GLSL)" value={config.gpgpuCustomForceEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuCustomForceEnabled', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        速度シミュレーションの最後に自分の GLSL を差し込みます（WebGL 経路）。pos / vel（vec3）、uTime / uDelta（float）が読めます。vel に加算してください。コンパイル確認を通ったコードだけが差し替わります。
        <br />スライダー宣言: <span className="font-mono">float speed = ctrl("speed", 0.0, 5.0, 1.0);</span> のように書くと、適用後にスライダーが自動生成され、値が uniform（uCtrl_speed）として渡ります。
      </div>
      {config.gpgpuCustomForceEnabled && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            rows={7}
            className="mt-2 w-full rounded bg-black/40 border border-white/15 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
            placeholder={'// 例: vel.y += sin(pos.x * 0.05 + uTime) * 20.0 * uDelta;'}
          />
          <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">VEX Deform Presets (名前付き変形)</div>
          <div className="flex flex-wrap gap-2">
            {VEX_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => { setDraft(preset.code); updateConfig('gpgpuCustomForceCode', preset.code); }}
                title={preset.description}
                className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            Kinetix の VEX 変形4種を Custom Force のプリセットとして読み込みます（押すと即適用）。変形先の位置へ速度を寄せる方式で、他のフォースと併用できます。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => updateConfig('gpgpuCustomForceCode', draft)}
              disabled={!dirty}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              適用
            </button>
            <button
              onClick={() => setDraft(CUSTOM_FORCE_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              例を読み込む
            </button>
            <button
              onClick={() => setDraft(CUSTOM_FORCE_CTRL_EXAMPLE)}
              className="px-3 py-1.5 rounded-full border border-white/25 text-white/80 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              ctrl例を読み込む
            </button>
            {dirty && <span className="text-[10px] text-amber-200/80">未適用の変更があります</span>}
          </div>
          {appliedCtrls.decls.length > 0 && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Custom Controls (ctrl宣言)</div>
              {appliedCtrls.decls.map((decl) => (
                <Slider
                  key={decl.id}
                  label={decl.id}
                  value={ctrlValues[decl.id]}
                  min={decl.min}
                  max={decl.max}
                  step={(decl.max - decl.min) / 100}
                  onChange={(v) => updateConfig('gpgpuCustomForceCtrlValues', { ...config.gpgpuCustomForceCtrlValues, [decl.id]: v })}
                />
              ))}
            </div>
          )}
          {!appliedCtrls.ok && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">ctrl宣言エラー: {appliedCtrls.error}</p>
          )}
          {dirty && draftCtrlCount !== appliedCtrls.decls.length && (
            <p className="mt-1 text-[9px] leading-relaxed text-white/40">下書きには ctrl 宣言が {draftCtrlCount} 件あります（「適用」でスライダーに反映されます）。</p>
          )}
          {status.state === 'active' && <p className="mt-2 text-[10px] text-emerald-200/80">カスタムフォース適用中</p>}
          {status.state === 'error' && (
            <p className="mt-2 text-[10px] leading-relaxed text-red-300/90">適用できませんでした（前のシェーダを維持しています）: {status.message}</p>
          )}
        </>
      )}
    </div>
  );
};

// Simple LFO (Kinetix integration B3): Kinetix exposes its modulator
// as one target + speed + amount. The modulation engine underneath is
// Kalokagathia's own (LFO x4 routed to any catalogued parameter); this
// block is only the single-target view of it — it owns one route
// (id below) on LFO 0 with a sine wave, and never touches other routes.

const SIMPLE_LFO_ROUTE_ID = 'kinetix-simple-lfo';
const SIMPLE_LFO_TARGETS: { value: keyof ParticleConfig; label: string }[] = [
  { value: 'gpgpuTurbulence', label: 'Turbulence' },
  { value: 'gpgpuVortexStrength', label: 'Swirl (Vortex Strength)' },
  { value: 'gpgpuMorphStrength', label: 'Morph Strength' },
  { value: 'gpgpuSize', label: 'Particle Size' },
  { value: 'gpgpuWellStrength', label: 'Attractor (Well Strength)' },
];

export const SimpleLfoBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  // WP9 Phase C: resolved setup (config key `modulationSetup`
  // when authored, the localStorage store otherwise); edits
  // write into the config key like the Play tab editor.
  const setup = useResolvedModulationSetup(config.modulationSetup);
  const route = setup.routes.find((r) => r.id === SIMPLE_LFO_ROUTE_ID);
  const lfo = setup.lfos[0] ?? { waveform: 'sine' as const, rate: 0.5 };
  const enabled = !!route;
  const write = (next: { target?: keyof ParticleConfig; rate?: number; depth?: number; on?: boolean }) => {
    const on = next.on ?? enabled;
    const routes = setup.routes.filter((r) => r.id !== SIMPLE_LFO_ROUTE_ID);
    if (on) {
      routes.push({
        id: SIMPLE_LFO_ROUTE_ID,
        source: { kind: 'lfo', index: 0 },
        target: next.target ?? route?.target ?? 'gpgpuTurbulence',
        depth: next.depth ?? route?.depth ?? 0.35,
      });
    }
    const lfos = setup.lfos.slice();
    while (lfos.length < 4) lfos.push({ waveform: 'sine', rate: 0.5 });
    lfos[0] = { waveform: 'sine', rate: next.rate ?? lfo.rate };
    updateConfig('modulationSetup', serializeModulationSetup({ ...setup, enabled: on ? true : setup.enabled, lfos, routes }));
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Simple LFO (簡易LFO)" value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => write({ on: v })} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        1つのパラメータを正弦波で揺らす簡易版です（Kinetix の LFO の見せ方）。実体はモジュレーション基盤の LFO 0 + 専用ルートで、Play タブの詳細なルーティングと併存します。
      </div>
      {enabled && route && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Target</div>
          <select
            value={route.target}
            onChange={(e) => write({ target: e.target.value as keyof ParticleConfig })}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            {SIMPLE_LFO_TARGETS.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <Slider label="Rate (Hz)" value={lfo.rate} min={0.05} max={3} step={0.05} onChange={(v) => write({ rate: v })} />
          <Slider label="Amount (深さ)" value={route.depth} min={0} max={1} step={0.01} onChange={(v) => write({ depth: v })} />
        </>
      )}
    </div>
  );
};
