import React from 'react';
import { Activity, ArrowLeftRight, Monitor } from 'lucide-react';
import type { ParticleConfig, PresetRecord } from '../types';
import { PARAMETER_CATALOG } from '../lib/parameterCatalog';
import { getNoiseLinkStatus, type NoiseLinkStatus } from '../lib/noiseLink';
import { AUDIO_BAND_OPTIONS, ENVELOPE_TRIGGER_OPTIONS, LFO_WAVEFORM_OPTIONS, NOISE_SOURCE_OPTIONS, createStarterModulationRoutes, describeModulationSource, evaluateLfo, fireModulationEnvelope, parseModulationSetupJson, serializeModulationSetup, setModulationSetup, useResolvedModulationSetup, type EnvelopeTrigger, type LfoWaveform, type ModulationChainOp, type ModulationRoute, type ModulationSetup, type ModulationSource, type NoiseSourceId } from '../lib/modulation';
import { compileExpression } from '../lib/expression';
import { EXPRESSION_PARAM_REF_NAMES } from '../lib/expressionParamRefs';
import { useDataTable } from '../lib/dataTable';
import { findUserParameterByName, useUserParameters } from '../lib/userParameters';
import { closeCleanOutput, isCleanOutputOpen, openCleanOutput } from '../lib/cleanOutput';
import { collectGpuDiagnostics, type GpuDiagnosticsReport } from '../lib/gpuDiagnostics';
import { GPU_TIER_LABELS_JA, redetectGpuTier, setGpuTierOverride, type GpuTier } from '../lib/gpuTier';
import { useGpuTierInfo } from '../lib/useGpuTierInfo';
import { setCpuFallbackSetting, useCpuFallback, type CpuFallbackSetting } from '../lib/cpuFallback';
import { getRaymarchDefaults } from '../lib/raymarchDefaults';
import { getMaxGpgpuTexSize } from '../lib/gpuTier';
import { applyTransitionEasing, interpolateConfig } from '../lib/appState';
import { Slider } from './controlPanelParts';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle, TAB_SHORT_LABELS } from './controlPanelPlayTabShared';

export interface StageDeck {
  name: string;
  config: ParticleConfig;
}

export const GpuDiagnosticsSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [report, setReport] = React.useState<GpuDiagnosticsReport | null>(null);
  const [running, setRunning] = React.useState(false);
  const [lightened, setLightened] = React.useState(false);
  const tierInfo = useGpuTierInfo();
  const cpuFallback = useCpuFallback();
  const tierRaymarchDefaults = getRaymarchDefaults(tierInfo.tier);
  const tierGpgpuCap = getMaxGpgpuTexSize(tierInfo.tier);

  const runDiagnostics = async () => {
    setRunning(true);
    try {
      setReport(await collectGpuDiagnostics());
    } finally {
      setRunning(false);
    }
  };

  const applyLighten = () => {
    updateConfig('layer2Count', Math.max(200, Math.floor(config.layer2Count * 0.5)));
    updateConfig('layer3Count', Math.max(200, Math.floor(config.layer3Count * 0.5)));
    updateConfig('gpgpuCount', Math.max(4096, Math.floor(config.gpgpuCount * 0.25)));
    setLightened(true);
  };

  const rows: Array<{ label: string; value: string; warn?: boolean }> = report ? [
    { label: 'WebGL2', value: report.webgl2 ? '対応' : '使えません', warn: !report.webgl2 },
    { label: 'Renderer', value: report.renderer ?? '不明' },
    { label: '描画方式', value: report.softwareRendering ? 'ソフトウェア描画（GPU未使用）' : 'GPU描画', warn: report.softwareRendering },
    { label: 'Float カラーバッファ', value: report.colorBufferFloat ? '対応（GPGPU可）' : report.colorBufferHalfFloat ? 'Half のみ' : 'なし', warn: !report.colorBufferFloat && !report.colorBufferHalfFloat },
    { label: '最大テクスチャ', value: report.maxTextureSize ? `${report.maxTextureSize}px` : '不明' },
    { label: 'Fragment 高精度 float', value: report.fragmentHighp ? '対応' : '非対応', warn: !report.fragmentHighp },
    { label: 'WebGPU', value: report.webgpu === 'supported' ? `対応（${report.webgpuAdapter ?? 'adapter'}）` : report.webgpu === 'no-adapter' ? 'アダプタなし → WebGL にフォールバック' : '非対応 → WebGL にフォールバック' },
  ] : [];

  return (
    <section className="space-y-4">
      <SectionTitle icon={<Monitor size={12} />}>GPU Diagnostics · GPU診断</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45">
        このブラウザと GPU で何が動くかを実測します。WebGL2 が土台で、WebGPU が使えない環境では WebGL に自動で落ちます。ソフトウェア描画の環境では粒子数を下げると滑らかになります。
      </p>
      <div className="space-y-1.5 rounded border border-white/10 bg-black/20 p-3">
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">GPUティア</span>
          <span className="text-right text-white/80">
            {GPU_TIER_LABELS_JA[tierInfo.tier]}
            <span className="text-white/40">（検出: {GPU_TIER_LABELS_JA[tierInfo.detectedTier]}{tierInfo.override ? '・手動で上書き中' : ''}）</span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">Renderer</span>
          <span className="text-right text-white/75">{tierInfo.renderer ?? '不明'}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">レイマーチ既定</span>
          <span className="text-right text-white/75">スケール {tierRaymarchDefaults.renderScale} / ステップ {tierRaymarchDefaults.maxSteps}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 text-[11px]">
          <span className="shrink-0 text-white/40">GPGPU上限テクスチャ</span>
          <span className="text-right text-white/75">{tierGpgpuCap}</span>
        </div>
        <p className="pt-1 text-[11px] leading-relaxed text-white/40">
          ティアは GPU 名からの判定（不明な場合は簡易ベンチマーク）で決まります。重い機能の既定値と推奨警告に使われます。判定が実機と違う場合は手動で上書きできます（新しいレイヤー・プリセットの既定値から反映されます）。
        </p>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {([null, 'entry', 'standard', 'high', 'flagship'] as Array<GpuTier | null>).map((option) => {
            const isActive = tierInfo.override === option;
            return (
              <button
                key={option ?? 'auto'}
                type="button"
                onClick={() => setGpuTierOverride(option)}
                className={`rounded-full border px-2.5 py-1 text-[10px] transition ${isActive ? 'border-amber-200/50 bg-amber-200/15 text-amber-100' : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10'}`}
              >
                {option === null ? '自動' : GPU_TIER_LABELS_JA[option]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => redetectGpuTier()}
            className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[10px] text-white/65 transition hover:bg-white/10"
          >
            再検出
          </button>
        </div>
        <div className="space-y-1.5 border-t border-white/10 pt-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="shrink-0 text-white/40">CPUフォールバック</span>
            <span className="text-right text-white/80">
              {cpuFallback.active ? '有効（CPU表示中）' : '無効'}
              {cpuFallback.active && cpuFallback.fps !== null && (
                <span className="text-white/40"> · {cpuFallback.fps} fps / {cpuFallback.particleCount?.toLocaleString()} 粒子</span>
              )}
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">
            WebGL が実質使えない弱いマシン向けの軽量表示です（Canvas 2D、上限4,000粒子、運動は近似）。「自動」ではソフトウェア描画の検出時に切り替わります。
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {([
              { value: 'auto', label: '自動' },
              { value: 'on', label: 'ON（強制）' },
              { value: 'off', label: 'OFF' },
            ] as Array<{ value: CpuFallbackSetting; label: string }>).map((option) => {
              const isActive = cpuFallback.setting === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCpuFallbackSetting(option.value)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] transition ${isActive ? 'border-amber-200/50 bg-amber-200/15 text-amber-100' : 'border-white/15 bg-white/5 text-white/65 hover:bg-white/10'}`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { void runDiagnostics(); }}
        disabled={running}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 transition hover:bg-white/10 disabled:opacity-40"
      >
        {running ? '診断中…' : report ? '再診断' : '診断する'}
      </button>
      {report && (
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-white/40">{row.label}</span>
              <span className={`text-right ${row.warn ? 'text-amber-200/90' : 'text-white/75'}`}>{row.value}</span>
            </div>
          ))}
          {!report.webgl2 && (
            <p className="pt-1 text-[11px] leading-relaxed text-red-200/85">WebGL2 が使えないため、この環境では描画できません。別のブラウザをお試しください。</p>
          )}
          {report.webgl2 && report.softwareRendering && (
            <div className="space-y-2 pt-1">
              <p className="text-[11px] leading-relaxed text-amber-200/85">
                ソフトウェア描画です。動作はしますが重くなります。粒子数（Layer2/3 を半分、GPGPU を 1/4）を下げる軽量化を適用できます。
              </p>
              <button
                type="button"
                onClick={applyLighten}
                disabled={lightened}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/75 transition hover:bg-white/10 disabled:opacity-40"
              >
                {lightened ? '軽量化を適用しました' : '軽量化を適用'}
              </button>
            </div>
          )}
          {report.webgl2 && !report.softwareRendering && (
            <p className="pt-1 text-[11px] text-white/50">GPU 描画が使えています。この環境では全機能が動作する見込みです。</p>
          )}
        </div>
      )}
    </section>
  );
};

export const CleanOutputSection: React.FC = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    const timer = window.setInterval(() => setIsOpen(isCleanOutputOpen()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const toggle = () => {
    if (isCleanOutputOpen()) {
      closeCleanOutput();
      setIsOpen(false);
      setMessage('出力ウィンドウを閉じました。');
      return;
    }
    const status = openCleanOutput();
    if (status.state === 'open') {
      setIsOpen(true);
      setMessage('出力ウィンドウを開きました。プロジェクター側の画面へドラッグし、映像をクリックすると全画面になります。');
    } else if (status.state === 'blocked') {
      setMessage('ポップアップがブロックされました。ブラウザのポップアップ許可が必要です。');
    } else {
      setMessage('キャンバスが見つかりませんでした。シーンが表示されてから開いてください。');
    }
  };

  return (
    <section>
      <SectionTitle icon={<Monitor size={12} />}>Clean Output · クリーン出力</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-3">
        UI の無いキャンバスだけの別ウィンドウを開きます。メイン画面の描画をそのまま鏡映しするので、操作はすべてこちら側で行い、出力側はプロジェクターや送出先の画面に置くだけです。映像のクリックで全画面を切り替えます（音声は出力されません）。
      </p>
      <button
        onClick={toggle}
        className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors"
      >
        {isOpen ? '出力ウィンドウを閉じる' : '出力ウィンドウを開く'}
      </button>
      {message && <p className="text-[11px] text-white/55 mt-2">{message}</p>}
    </section>
  );
};

export const StageSection: React.FC<{
  config: ParticleConfig;
  presets: PresetRecord[];
  isPublicLibrary: boolean;
  onApplyConfig?: (config: ParticleConfig) => void;
}> = ({ config, presets, isPublicLibrary, onApplyConfig }) => {
  const [deckA, setDeckA] = React.useState<StageDeck | null>(null);
  const [deckB, setDeckB] = React.useState<StageDeck | null>(null);
  const [mix, setMix] = React.useState(0);
  const [fadeSeconds, setFadeSeconds] = React.useState(3);
  const fadeRef = React.useRef<number | null>(null);
  const mixRef = React.useRef(0);
  mixRef.current = mix;

  const stopFade = React.useCallback(() => {
    if (fadeRef.current !== null) {
      cancelAnimationFrame(fadeRef.current);
      fadeRef.current = null;
    }
  }, []);

  React.useEffect(() => stopFade, [stopFade]);

  const applyMix = React.useCallback(
    (nextMix: number, deckAConfig: ParticleConfig | null, deckBConfig: ParticleConfig | null) => {
      const clamped = Math.min(1, Math.max(0, nextMix));
      setMix(clamped);
      if (deckAConfig && deckBConfig && onApplyConfig) {
        onApplyConfig(interpolateConfig(deckAConfig, deckBConfig, clamped));
      }
    },
    [onApplyConfig],
  );

  const loadPreset = (side: 'A' | 'B', presetId: string) => {
    const preset = presets.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    stopFade();
    if (side === 'A') {
      setDeckA({ name: preset.name, config: preset.config });
      if (deckB) applyMix(mixRef.current, preset.config, deckB.config);
    } else {
      setDeckB({ name: preset.name, config: preset.config });
      if (deckA) applyMix(mixRef.current, deckA.config, preset.config);
    }
  };

  const captureCurrent = (side: 'A' | 'B') => {
    stopFade();
    const deck = { name: '現在のシーン', config };
    if (side === 'A') {
      setDeckA(deck);
      if (deckB) applyMix(mixRef.current, deck.config, deckB.config);
    } else {
      setDeckB(deck);
      if (deckA) applyMix(mixRef.current, deckA.config, deck.config);
    }
  };

  const autoFade = (target: number) => {
    if (!deckA || !deckB || !onApplyConfig) return;
    stopFade();
    const from = mixRef.current;
    const durationMs = Math.max(100, fadeSeconds * 1000);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / durationMs);
      const eased = applyTransitionEasing(linear, 'ease-in-out');
      applyMix(from + (target - from) * eased, deckA.config, deckB.config);
      if (linear < 1) {
        fadeRef.current = requestAnimationFrame(tick);
      } else {
        fadeRef.current = null;
      }
    };
    fadeRef.current = requestAnimationFrame(tick);
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';
  const canPerform = Boolean(deckA && deckB && onApplyConfig) && !isPublicLibrary;

  const deckCard = (side: 'A' | 'B', deck: StageDeck | null) => (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[11px] font-semibold tracking-wide">Deck {side}</span>
        {deck && (
          <span className="min-w-0 truncate font-mono text-[9px] uppercase tracking-wider text-white/40">
            {deck.config.layer2Type} / {deck.config.layer3Type}
          </span>
        )}
      </div>
      <select
        value=""
        onChange={(event) => {
          if (event.target.value) loadPreset(side, event.target.value);
        }}
        className={selectClass}
        aria-label={`Deck ${side} にプリセットを読み込む`}
      >
        <option value="" className="bg-neutral-900">
          {deck ? deck.name : 'プリセットを選ぶ…'}
        </option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id} className="bg-neutral-900">
            {preset.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => captureCurrent(side)}
        className="w-full py-1.5 rounded-lg border border-white/15 text-white/60 text-[10px] uppercase tracking-widest hover:bg-white/10 transition-colors"
      >
        現在のシーンを取り込む
      </button>
    </div>
  );

  return (
    <section>
      <SectionTitle icon={<ArrowLeftRight size={12} />}>Stage · A/Bデッキ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのプリセット（または今のシーン）をデッキA／Bに置き、クロスフェーダーで連続的に混ぜる演奏用セクションです。混ぜ合わせはシーケンスのモーフと同じ補間で、数値は滑らかに、種類の切り替えは中点で起こります。フェーダーを動かすとライブの設定が書き換わります（プリセット自体は変わりません）。気に入った中間状態はそのままプリセットとして保存できます。
      </p>
      <div className={isPublicLibrary ? 'pointer-events-none opacity-60' : ''}>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {deckCard('A', deckA)}
          {deckCard('B', deckB)}
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-white/50">
            <span className="min-w-0 truncate" title={deckA?.name}>A {deckA?.name ?? '—'}</span>
            <span className="shrink-0 font-mono text-white/80">{Math.round(mix * 100)}%</span>
            <span className="min-w-0 truncate text-right" title={deckB?.name}>B {deckB?.name ?? '—'}</span>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(mix * 1000)}
            disabled={!canPerform}
            onChange={(event) => {
              stopFade();
              if (deckA && deckB) applyMix(Number(event.target.value) / 1000, deckA.config, deckB.config);
            }}
            className="w-full h-2 bg-current rounded-lg appearance-none cursor-pointer focus:outline-none opacity-70 hover:opacity-100 transition-opacity disabled:cursor-not-allowed"
            style={{ accentColor: 'currentColor' }}
            aria-label="クロスフェーダー"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                stopFade();
                if (deckA && deckB) applyMix(0, deckA.config, deckB.config);
              }}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-40"
            >
              Aに切替
            </button>
            <button
              onClick={() => autoFade(mixRef.current < 0.5 ? 1 : 0)}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest hover:bg-gray-200 transition-colors disabled:opacity-40"
            >
              自動フェード
            </button>
            <button
              onClick={() => {
                stopFade();
                if (deckA && deckB) applyMix(1, deckA.config, deckB.config);
              }}
              disabled={!canPerform}
              className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-40"
            >
              Bに切替
            </button>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-white/40">
              {([1, 2, 4, 8] as const).map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => setFadeSeconds(seconds)}
                  className={`px-2 py-1 rounded-full ${fadeSeconds === seconds ? 'bg-white text-black font-bold' : 'bg-white/10 text-white/60'}`}
                >
                  {seconds}s
                </button>
              ))}
            </span>
          </div>
        </div>
        {!onApplyConfig && <p className="text-[11px] text-white/35 mt-2">このビルドではデッキを適用できません。</p>}
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではステージ操作はできません。</p>}
    </section>
  );
};

const MOD_SELECT_CLASS =
  'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';

/**
 * Parameter editors for one modulation source (Phase AJ refactor:
 * shared by the route's own source and an expression's wrapped
 * input, so both levels expose the same fields).
 */
const SourceParamEditors: React.FC<{
  source: ModulationSource;
  onChange: (source: ModulationSource) => void;
  routeId?: string;
}> = ({ source, onChange, routeId }) => {
  const dataTable = useDataTable();
  const declarations = useUserParameters();
  if (source.kind === 'vnoise') {
    return (
      <div className="grid grid-cols-3 gap-2">
        <Slider label="Seed" value={source.seed} min={0} max={9999} step={1} onChange={(v) => onChange({ ...source, seed: Math.round(v) })} />
        <Slider label="Rate" value={source.rate} min={0.02} max={4} step={0.01} onChange={(v) => onChange({ ...source, rate: v })} />
        <Slider label="Octaves" value={source.octaves} min={1} max={4} step={1} onChange={(v) => onChange({ ...source, octaves: Math.round(v) })} />
      </div>
    );
  }
  if (source.kind === 'envelope') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 items-start">
          <select
            value={source.trigger}
            onChange={(event) => onChange({ ...source, trigger: event.target.value as EnvelopeTrigger })}
            className={MOD_SELECT_CLASS}
            aria-label="エンベロープのトリガ"
          >
            {ENVELOPE_TRIGGER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} className="bg-neutral-900">
                {option.label}
              </option>
            ))}
          </select>
          {source.trigger === 'manual' ? (
            <button
              onClick={() => routeId && fireModulationEnvelope(routeId, performance.now() / 1000)}
              className="px-3 py-1.5 rounded bg-white text-black text-[11px] font-bold hover:bg-gray-200 transition-colors"
            >
              トリガ Trigger
            </button>
          ) : (
            <span className="text-[10px] text-white/40 leading-relaxed">
              {source.trigger === 'audio' ? '音声パルスの立ち上がりで発火します' : 'MIDI ノートオンで発火します'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Slider label="Attack (s)" value={source.attack} min={0.005} max={1} step={0.005} onChange={(v) => onChange({ ...source, attack: v })} />
          <Slider label="Decay (s)" value={source.decay} min={0.05} max={4} step={0.05} onChange={(v) => onChange({ ...source, decay: v })} />
        </div>
      </div>
    );
  }
  if (source.kind === 'data') {
    return (
      <div className="space-y-2">
        {dataTable ? (
          <select
            value={source.column}
            onChange={(event) => onChange({ ...source, column: event.target.value })}
            className={MOD_SELECT_CLASS}
            aria-label="データ列"
          >
            {dataTable.columns.map((name) => (
              <option key={name} value={name} className="bg-neutral-900">
                列 {name}（{dataTable.rows.length} 行）
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[10px] text-white/40 leading-relaxed">
            データ列が未登録です。Play タブの Data Source で CSV／JSON を「信号列として登録」すると、ここで列を選べます（未登録の間は無影響）。
          </p>
        )}
        <Slider label="読取速度 Rate（行/秒）" value={source.rate} min={0.05} max={60} step={0.05} onChange={(v) => onChange({ ...source, rate: v })} />
      </div>
    );
  }
  if (source.kind === 'uparam') {
    // User parameter (Layer 1 WP10 phases A/C): the source reads
    // a declared public parameter by its declared name (label),
    // resolved against the CURRENT config at apply time. The
    // declarations live in their own setup store (Global tab's
    // User Parameters section); until a name resolves the source
    // samples neutral, so an undeclared name is inert — the data
    // column's discipline.
    const resolved = findUserParameterByName(declarations, source.name);
    return (
      <div className="space-y-2">
        {declarations.length > 0 ? (
          <select
            value={resolved ? resolved.label : ''}
            onChange={(event) => onChange({ ...source, name: event.target.value })}
            className={MOD_SELECT_CLASS}
            aria-label="ユーザーパラメータ名"
          >
            <option value="" className="bg-neutral-900">
              （宣言名を選択）
            </option>
            {declarations.map((declaration) => (
              <option key={declaration.id} value={declaration.label} className="bg-neutral-900">
                {declaration.label}（{declaration.key}）
              </option>
            ))}
          </select>
        ) : (
          <p className="text-[10px] text-white/40 leading-relaxed">
            宣言済みパラメータがありません。Global タブの User Parameters でパラメータを宣言すると、ここで名前を選べます（宣言が無い間は無影響）。
          </p>
        )}
        {declarations.length > 0 && !resolved && (
          <p className="text-[10px] text-amber-300/90 leading-relaxed">
            {source.name
              ? `指定された名前「${source.name}」の宣言が見つかりません（無影響のままです）。`
              : '宣言名が未指定です（無影響のままです）。'}
          </p>
        )}
      </div>
    );
  }
  return null;
};

/** CHOP chain editor (Phase AJ): up to four stages per route. */
const ChainEditor: React.FC<{
  route: ModulationRoute;
  onChange: (chain: ModulationChainOp[] | undefined) => void;
}> = ({ route, onChange }) => {
  const chain = route.chain ?? [];
  const [pendingOp, setPendingOp] = React.useState<'spring' | 'trim' | 'filter'>('spring');
  const updateOp = (index: number, patch: Partial<ModulationChainOp>) => {
    onChange(chain.map((op, i) => (i === index ? ({ ...op, ...patch } as ModulationChainOp) : op)));
  };
  const addOp = () => {
    const op: ModulationChainOp =
      pendingOp === 'spring'
        ? { op: 'spring', freq: 2, damping: 0.35 }
        : pendingOp === 'filter'
          ? { op: 'filter', cutoff: 4 }
          : { op: 'trim', low: 0, high: 1, invert: false };
    onChange([...chain, op]);
  };
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-white/40">連鎖 Chain（CHOP）— 源 → 連鎖 → ラグ → 変調先</p>
      {chain.map((op, index) => (
        <div key={index} className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">
              {index + 1}. {op.op === 'spring' ? 'Spring ばね' : op.op === 'filter' ? 'Filter ローパス' : 'Trim 範囲'}
            </span>
            <button
              onClick={() => onChange(chain.filter((_, i) => i !== index))}
              className="text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
            >
              段を削除
            </button>
          </div>
          {op.op === 'spring' && (
            <div className="grid grid-cols-2 gap-2">
              <Slider label="周波数 Freq (Hz)" value={op.freq} min={0.1} max={10} step={0.1} onChange={(v) => updateOp(index, { freq: v })} />
              <Slider label="減衰比 Damping" value={op.damping} min={0} max={2} step={0.05} onChange={(v) => updateOp(index, { damping: v })} />
            </div>
          )}
          {op.op === 'filter' && (
            <Slider label="カットオフ Cutoff (Hz)" value={op.cutoff} min={0.1} max={40} step={0.1} onChange={(v) => updateOp(index, { cutoff: v })} />
          )}
          {op.op === 'trim' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Slider label="下限 Low" value={op.low} min={0} max={1} step={0.01} onChange={(v) => updateOp(index, { low: v })} />
                <Slider label="上限 High" value={op.high} min={0} max={1} step={0.01} onChange={(v) => updateOp(index, { high: v })} />
              </div>
              <label className="flex items-center gap-2 text-[11px] text-white/60">
                <input
                  type="checkbox"
                  checked={op.invert}
                  onChange={(event) => updateOp(index, { invert: event.target.checked })}
                  className="accent-white"
                />
                反転 Invert
              </label>
            </div>
          )}
        </div>
      ))}
      {chain.length < 4 && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select value={pendingOp} onChange={(event) => setPendingOp(event.target.value as 'spring' | 'trim' | 'filter')} className={MOD_SELECT_CLASS} aria-label="追加する段">
            <option value="spring" className="bg-neutral-900">Spring ばね</option>
            <option value="trim" className="bg-neutral-900">Trim 範囲リマップ</option>
            <option value="filter" className="bg-neutral-900">Filter ローパス</option>
          </select>
          <button onClick={addOp} className="px-3 py-1.5 rounded bg-white/10 text-white/70 text-[11px] hover:bg-white/20 transition-colors">
            段を追加
          </button>
        </div>
      )}
    </div>
  );
};

export const ModulationSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  // WP9 Phase C: display the resolved setup (config key
  // `modulationSetup` when authored, the localStorage store
  // otherwise) and write every edit into the config key — the
  // first edit promotes the setup into the work.
  const setup = useResolvedModulationSetup(config.modulationSetup);
  const declarations = useUserParameters();
  // TD §7 face 4: a wiring carried in the config (modulationGraph)
  // wins over the edited setup while applied (the runtime resolves
  // the graph before the setup). The editor below still edits the
  // resolved setup; the carry row moves setups between the two
  // homes.
  const carriedSetup = parseModulationSetupJson(config.modulationGraph);
  const localCarryJson = serializeModulationSetup(setup);
  const [nowSec, setNowSec] = React.useState(0);

  React.useEffect(() => {
    if (!setup.enabled) return;
    const id = window.setInterval(() => setNowSec(performance.now() / 1000), 120);
    return () => window.clearInterval(id);
  }, [setup.enabled]);

  // Noise link status (Phase 6.7): polled a couple of times a second
  // so the user can see whether the Noise tab is actually feeding the
  // Noise modulation sources offered below. Reading the status also
  // opens the BroadcastChannel receiver (lazily, in lib/noiseLink).
  const [noiseStatus, setNoiseStatus] = React.useState<NoiseLinkStatus>({
    receiving: false,
    playing: false,
    master: 0,
  });
  React.useEffect(() => {
    const poll = () => {
      const next = getNoiseLinkStatus();
      setNoiseStatus((prev) =>
        prev.receiving === next.receiving && prev.playing === next.playing && prev.master === next.master
          ? prev
          : next,
      );
    };
    poll();
    const id = window.setInterval(poll, 500);
    return () => window.clearInterval(id);
  }, []);

  const update = (next: ModulationSetup) => updateConfig('modulationSetup', serializeModulationSetup(next));

  const setLfo = (index: number, patch: Partial<{ waveform: LfoWaveform; rate: number }>) => {
    update({ ...setup, lfos: setup.lfos.map((lfo, i) => (i === index ? { ...lfo, ...patch } : lfo)) });
  };

  const parseSource = (value: string): ModulationSource => {
    const [kind, rest] = value.split(/:(.*)/).filter(Boolean);
    if (kind === 'audio') {
      return { kind: 'audio', band: rest as 'bass' | 'treble' | 'pulse' | 'bandA' | 'bandB' };
    }
    if (kind === 'noise') {
      return { kind: 'noise', source: rest as NoiseSourceId };
    }
    if (kind === 'vnoise') {
      // Internal value noise (Phase AC) — generated in-app, not
      // the external Noise app link above.
      return { kind: 'vnoise', seed: 1, rate: 0.35, octaves: 2 };
    }
    if (kind === 'envelope') {
      return { kind: 'envelope', trigger: 'manual', attack: 0.01, decay: 0.6 };
    }
    if (kind === 'expr') {
      // Expression (Phase AJ): wraps an LFO by default; the wrapped
      // source is chosen in the expression block below.
      return { kind: 'expr', text: 'x', input: { kind: 'lfo', index: 0 } };
    }
    if (kind === 'data') {
      return { kind: 'data', column: 'col1', rate: 2 };
    }
    if (kind === 'uparam') {
      // User parameter (Layer 1 WP10 phase C): starts on the
      // first declared name when one exists; the name itself is
      // picked in SourceParamEditors below.
      return { kind: 'uparam', name: declarations[0]?.label ?? '' };
    }
    return { kind: 'lfo', index: Number(rest) || 0 };
  };

  const sourceValue = (source: ModulationSource) =>
    source.kind === 'lfo'
      ? `lfo:${source.index}`
      : source.kind === 'noise'
        ? `noise:${source.source}`
        : source.kind === 'vnoise'
          ? 'vnoise:internal'
          : source.kind === 'envelope'
            ? 'envelope:oneshot'
            : source.kind === 'expr'
              ? 'expr:formula'
              : source.kind === 'data'
                ? 'data:column'
                : source.kind === 'uparam'
                  ? 'uparam:param'
                  : `audio:${source.band}`;

  const addRoute = () => {
    const route: ModulationRoute = {
      id: `route-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      source: { kind: 'lfo', index: 0 },
      target: 'layer2FlowSpeed',
      depth: 0.3,
    };
    update({ ...setup, enabled: true, routes: [...setup.routes, route] });
  };

  const addStarterRoutes = () => {
    const existing = new Set(setup.routes.map((route) => `${describeModulationSource(route.source)}->${route.target}`));
    const additions = createStarterModulationRoutes().filter(
      (route) => !existing.has(`${describeModulationSource(route.source)}->${route.target}`),
    );
    if (additions.length) update({ ...setup, enabled: true, routes: [...setup.routes, ...additions] });
  };

  const updateRoute = (id: string, patch: Partial<ModulationRoute>) => {
    update({ ...setup, routes: setup.routes.map((route) => (route.id === id ? { ...route, ...patch } : route)) });
  };

  const removeRoute = (id: string) => {
    update({ ...setup, routes: setup.routes.filter((route) => route.id !== id) });
  };

  const selectClass =
    'w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40';
  const tabOrder = ['global', 'layer1', 'layer2', 'layer3', 'ambient', 'audio'] as const;

  return (
    <section>
      <SectionTitle icon={<Activity size={12} />}>Modulation · モジュレーション</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        LFO（周期的な信号）や音声の帯域をパラメータに配線し、触っていない間もシーンを揺らし続ける仕組みです。変調は描画直前の実効値だけに重なり、プリセットや保存データは書き換えません。設定はこのブラウザに保存されます。一時停止中は変調も止まります。別タブで開いた Noise アプリの音量も変調元にできます（Noise連携）。
      </p>
      <p className="font-mono text-[10px] text-white/50 mb-4">
        {noiseStatus.receiving
          ? `Noise Link: 受信中 · ${noiseStatus.playing ? '再生中' : '停止中'} · master ${noiseStatus.master.toFixed(2)}`
          : 'Noise Link: 未接続（Noise側で連携を有効にし、再生すると受信します）'}
      </p>
      <div className={isPublicLibrary ? 'pointer-events-none opacity-60' : ''}>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 mb-4 space-y-2">
          {carriedSetup ? (
            <>
              <p className="text-[11px] leading-relaxed text-white/60">
                このプリセットには配線が同梱されています（ルート{carriedSetup.routes.length}件）。同梱がある間は同梱側が優先して鳴ります。下の編集はこのブラウザの設定に対するもので、同梱には触れません。
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    // Load into both homes: the local store (the
                    // original TD §7 target) and, per WP9 Phase C,
                    // the config key the editor actually reads — a
                    // local-only write would be shadowed whenever
                    // `modulationSetup` is authored.
                    setModulationSetup(carriedSetup);
                    update(carriedSetup);
                  }}
                  className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
                >
                  同梱をこのブラウザに読み込む
                </button>
                <button
                  onClick={() => updateConfig('modulationGraph', '')}
                  className="px-3 py-1.5 rounded-full text-white/35 text-[10px] uppercase tracking-widest hover:text-white/80"
                >
                  同梱をやめる
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-white/60">
                配線は通常このブラウザだけの保存です。「同梱」すると現在の配線がプリセットや共有リンクに載り、他の環境でも同じ揺れを再現できます。
              </p>
              <button
                onClick={() => updateConfig('modulationGraph', localCarryJson)}
                disabled={localCarryJson === ''}
                className="px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-40 disabled:hover:bg-white/10"
              >
                現在の配線を同梱する
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => update({ ...setup, enabled: !setup.enabled })}
            className={`px-4 py-2 rounded-full text-[10px] font-bold uppercase tracking-widest transition-colors ${
              setup.enabled ? 'bg-white text-black hover:bg-gray-200' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            {setup.enabled ? 'エンジン ON' : 'エンジン OFF'}
          </button>
          <button
            onClick={addStarterRoutes}
            className="px-4 py-2 rounded-full bg-white/10 text-white/70 text-[10px] font-bold uppercase tracking-widest hover:bg-white/20 transition-colors"
          >
            おすすめセットを追加
          </button>
          {setup.routes.length > 0 && (
            <button
              onClick={() => update({ ...setup, routes: [] })}
              className="px-4 py-2 rounded-full text-white/35 text-[10px] uppercase tracking-widest hover:text-white/80"
            >
              全ルート削除
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {setup.lfos.map((lfo, index) => {
            const level = setup.enabled ? evaluateLfo(lfo, nowSec) : 0.5;
            return (
              <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold">LFO {index + 1}</span>
                  <span className="font-mono text-[10px] text-white/40">{level.toFixed(2)}</span>
                </div>
                <div className="h-1.5 rounded bg-white/10 overflow-hidden">
                  <div className="h-full bg-white/80" style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
                <select
                  value={lfo.waveform}
                  onChange={(event) => setLfo(index, { waveform: event.target.value as LfoWaveform })}
                  className={selectClass}
                  aria-label={`LFO ${index + 1} 波形`}
                >
                  {LFO_WAVEFORM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-neutral-900">
                      {option.label}
                    </option>
                  ))}
                </select>
                <Slider
                  label="Rate Hz"
                  value={lfo.rate}
                  min={0.01}
                  max={2}
                  step={0.01}
                  onChange={(v) => setLfo(index, { rate: v })}
                />
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          {setup.routes.map((route) => (
            <div key={route.id} className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sourceValue(route.source)}
                  onChange={(event) => updateRoute(route.id, { source: parseSource(event.target.value) })}
                  className={selectClass}
                  aria-label="変調元"
                >
                  <optgroup label="LFO">
                    {setup.lfos.map((_, index) => (
                      <option key={index} value={`lfo:${index}`} className="bg-neutral-900">
                        LFO {index + 1}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="音声">
                    {AUDIO_BAND_OPTIONS.map((option) => (
                      <option key={option.value} value={`audio:${option.value}`} className="bg-neutral-900">
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Noise連携">
                    {NOISE_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={`noise:${option.value}`} className="bg-neutral-900">
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="生成 Generated">
                    <option value="vnoise:internal" className="bg-neutral-900">
                      内部ノイズ (Value Noise)
                    </option>
                    <option value="envelope:oneshot" className="bg-neutral-900">
                      エンベロープ (Envelope)
                    </option>
                  </optgroup>
                  <optgroup label="文法 Grammar">
                    <option value="expr:formula" className="bg-neutral-900">
                      式 Expression
                    </option>
                    <option value="data:column" className="bg-neutral-900">
                      データ列 Data Column
                    </option>
                    <option value="uparam:param" className="bg-neutral-900">
                      ユーザーパラメータ User Parameter
                    </option>
                  </optgroup>
                </select>
                <select
                  value={route.target}
                  onChange={(event) => updateRoute(route.id, { target: event.target.value as ModulationRoute['target'] })}
                  className={selectClass}
                  aria-label="変調先パラメータ"
                >
                  {tabOrder.map((tab) => (
                    <optgroup key={tab} label={TAB_SHORT_LABELS[tab] ?? tab}>
                      {PARAMETER_CATALOG.filter((entry) => entry.tab === tab).map((entry) => (
                        <option key={`${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                          {entry.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 items-start">
                <Slider
                  label="深さ Depth"
                  value={route.depth}
                  min={-1}
                  max={1}
                  step={0.05}
                  onChange={(v) => updateRoute(route.id, { depth: v })}
                />
                <button
                  onClick={() => removeRoute(route.id)}
                  className="mt-4 text-white/35 hover:text-white/80 text-[10px] uppercase tracking-widest"
                >
                  削除
                </button>
              </div>
              <Slider
                label="ラグ Lag (s)"
                value={route.lag ?? 0}
                min={0}
                max={2}
                step={0.05}
                onChange={(v) => updateRoute(route.id, { lag: v })}
              />
              {route.source.kind === 'expr' ? (
                <div className="space-y-2">
                  <select
                    value={sourceValue(route.source.input)}
                    onChange={(event) =>
                      updateRoute(route.id, {
                        source: { ...route.source, input: parseSource(event.target.value) } as ModulationSource,
                      })
                    }
                    className={selectClass}
                    aria-label="式の入力信号"
                  >
                    <optgroup label="LFO">
                      {setup.lfos.map((_, index) => (
                        <option key={index} value={`lfo:${index}`} className="bg-neutral-900">
                          入力: LFO {index + 1}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="音声">
                      {AUDIO_BAND_OPTIONS.map((option) => (
                        <option key={option.value} value={`audio:${option.value}`} className="bg-neutral-900">
                          入力: {option.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Noise連携">
                      {NOISE_SOURCE_OPTIONS.map((option) => (
                        <option key={option.value} value={`noise:${option.value}`} className="bg-neutral-900">
                          入力: {option.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="生成 Generated">
                      <option value="vnoise:internal" className="bg-neutral-900">
                        入力: 内部ノイズ (Value Noise)
                      </option>
                      <option value="envelope:oneshot" className="bg-neutral-900">
                        入力: エンベロープ (Envelope)
                      </option>
                      <option value="data:column" className="bg-neutral-900">
                        入力: データ列 Data Column
                      </option>
                      <option value="uparam:param" className="bg-neutral-900">
                        入力: ユーザーパラメータ User Parameter
                      </option>
                    </optgroup>
                  </select>
                  <SourceParamEditors
                    source={route.source.input}
                    routeId={route.id}
                    onChange={(input) => updateRoute(route.id, { source: { ...route.source, input } as ModulationSource })}
                  />
                  <input
                    value={route.source.text}
                    onChange={(event) =>
                      updateRoute(route.id, { source: { ...route.source, text: event.target.value } as ModulationSource })
                    }
                    className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 font-mono text-[11px] outline-none focus:border-white/40"
                    placeholder="x*x, smoothstep(0.2, 0.8, x), 0.5+0.5*sin(t)…"
                    aria-label="式"
                    spellCheck={false}
                  />
                  {(() => {
                    const compiled = compileExpression(route.source.text, EXPRESSION_PARAM_REF_NAMES);
                    return compiled.ok ? (
                      <p className="text-[10px] text-white/40 leading-relaxed">
                        変数 x = 入力信号（0..1）、t = 時刻（秒）。結果は 0..1 に収められます。他のパラメータも参照できます: p_＋キー名（小文字）— 例 p_gpgpuboidsalignment。参照値はそのパラメータの基本値（変調前の値）を範囲で 0..1 に正規化したもので、循環参照にはなりません。
                      </p>
                    ) : (
                      <p className="text-[10px] text-amber-300/90 leading-relaxed">
                        式エラー: {compiled.error} — 修正されるまで入力信号がそのまま通ります。
                      </p>
                    );
                  })()}
                </div>
              ) : (
                <SourceParamEditors
                  source={route.source}
                  routeId={route.id}
                  onChange={(source) => updateRoute(route.id, { source })}
                />
              )}
              <ChainEditor route={route} onChange={(chain) => updateRoute(route.id, { chain })} />
            </div>
          ))}
          <button
            onClick={addRoute}
            className="w-full py-2 rounded-xl border border-dashed border-white/20 text-white/60 text-[11px] hover:bg-white/5 transition-colors"
          >
            ＋ ルートを追加（信号 → パラメータ）
          </button>
        </div>
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドではモジュレーションを編集できません。</p>}
    </section>
  );
};


