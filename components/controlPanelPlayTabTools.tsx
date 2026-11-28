import React from 'react';
import { Camera, Database, Film, Gamepad2, Grid3x3, History, Search } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { PARAMETER_CATALOG, searchParameters, type ParameterCatalogEntry } from '../lib/parameterCatalog';
import { buildDataLumaMap, buildSampleDataPoints, getDataSourceUpdates, parseDataPoints, type ParsedData } from '../lib/dataSource';
import { parseDataTable, setDataTable, useDataTable } from '../lib/dataTable';
import { parseAttrPointCloud, setAttrPointCloud, useAttrPointCloud } from '../lib/attrPointCloud';
import {
  loadPointCacheFromFiles,
  setPointCache,
  setPointCacheError,
  usePointCache,
  usePointCachePlaybackState,
  usePointCacheStatus,
  POINT_CACHE_MAX_FRAMES,
  POINT_CACHE_MAX_POINTS,
} from '../lib/pointCache';
import { stateCacheExportAllowed, stateCacheToPointCacheData } from '../lib/gpgpuStateCache';
import {
  buildStateCacheFiles,
  loadStateCacheFromFiles,
  runStateCacheCaptureJob,
  stateCacheEditionForPublicLibrary,
} from '../lib/gpgpuStateCacheCapture';
import {
  applyHeldStateCacheFrameAsInitialState,
  getHeldStateCache,
  setHeldStateCache,
  type HeldStateCache,
} from '../lib/gpgpuInitialState';
import { buildPrtFileForFrame, decodePrtFiles } from '../lib/stateCachePrt';
import { buildAlembicFile } from '../lib/stateCacheAlembic';
import { buildStateCacheMeshSeriesZip, type MeshSeriesFormat } from '../lib/stateCacheMeshSeries';
import {
  buildStateCacheSkinningSeriesZip,
  resolveStateCacheSkinningFromConfig,
  type SkinningFormat,
} from '../lib/stateCacheSkinning';
import {
  buildStateCacheTrailGeometryZip,
  resolveStateCacheTrailFromConfig,
  type TrailGeometryFormat,
} from '../lib/stateCacheTrailGeometry';
import { Slider, Toggle } from './controlPanelParts';
import { resolveCacheRetimerFromConfig } from '../lib/cacheRetimer';
import { TEXTURE_DEFINITIONS, TEXTURE_MAP_SIZE, generateTextureMap, getTextureDefinition, type NoiseTextureKind } from '../lib/texturePack';
import type { ControlPanelContentProps } from './controlPanelTabsShared';
import { SectionTitle, TAB_SHORT_LABELS } from './controlPanelPlayTabShared';

export const ParameterSearchSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  onJumpToTab?: ControlPanelContentProps['onJumpToTab'];
}> = ({ config, updateConfig, onJumpToTab }) => {
  const [query, setQuery] = React.useState('');
  const results = React.useMemo(() => searchParameters(query, 30), [query]);
  const write = updateConfig as (key: keyof ParticleConfig, value: number) => void;

  return (
    <section>
      <SectionTitle icon={<Search size={12} />}>Parameter Search · パラメータ検索</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        詳細タブにある数値パラメータ {PARAMETER_CATALOG.length} 件を、名前やキーで横断検索できます。その場で値を変えるか、タブ名を押して本来の場所へ移動できます。⌘K（Ctrl+K）のコマンドパレットからも、プリセットとパラメータを横断検索できます。
      </p>
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="e.g. gravity, bloom, flow speed, 粒子の重さ…"
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs tracking-wide outline-none focus:border-white/40 mb-3"
      />
      {query.trim() && results.length === 0 && (
        <p className="text-[11px] text-white/40">該当するパラメータがありません。</p>
      )}
      <div className="space-y-3">
        {results.map((entry) => {
          const raw = config[entry.key];
          const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : entry.min;
          return (
            <div key={`${entry.tab}:${entry.key}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-medium tracking-wide truncate">
                  {entry.label} <span className="text-white/30 font-mono text-[9px]">{entry.key}</span>
                </span>
                <button
                  onClick={() => onJumpToTab?.(entry.tab)}
                  className="shrink-0 px-2 py-0.5 rounded-full border border-white/20 text-[9px] uppercase tracking-wider text-white/60 hover:bg-white/10 hover:text-white"
                >
                  {TAB_SHORT_LABELS[entry.tab] ?? entry.tab} へ
                </button>
              </div>
              {entry.description && (
                <p className="text-[10px] leading-relaxed text-white/45 mb-1.5">{entry.description}</p>
              )}
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={entry.min}
                  max={entry.max}
                  step={entry.step}
                  value={Math.min(entry.max, Math.max(entry.min, value))}
                  onChange={(event) => write(entry.key, parseFloat(event.target.value))}
                  className="flex-1 h-1 bg-current rounded-lg appearance-none cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
                  style={{ accentColor: 'currentColor' }}
                />
                <span className="font-mono text-[10px] text-white/60 w-16 text-right">
                  {value.toFixed(entry.step < 0.1 ? 3 : 1)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export const XyPadSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
}> = ({ config, updateConfig }) => {
  const [xKey, setXKey] = React.useState<keyof ParticleConfig>('layer2FlowSpeed');
  const [yKey, setYKey] = React.useState<keyof ParticleConfig>('layer2Complexity');
  const padRef = React.useRef<HTMLDivElement | null>(null);
  const write = updateConfig as (key: keyof ParticleConfig, value: number) => void;

  const xEntry = PARAMETER_CATALOG.find((entry) => entry.key === xKey) ?? PARAMETER_CATALOG[0];
  const yEntry = PARAMETER_CATALOG.find((entry) => entry.key === yKey) ?? PARAMETER_CATALOG[1];

  const normalize = (entry: ParameterCatalogEntry) => {
    const raw = config[entry.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : entry.min;
    return Math.min(1, Math.max(0, (value - entry.min) / (entry.max - entry.min || 1)));
  };
  const xRatio = xEntry ? normalize(xEntry) : 0;
  const yRatio = yEntry ? normalize(yEntry) : 0;

  const handlePointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 1 && event.type !== 'pointerdown') return;
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect || !xEntry || !yEntry) return;
    const rx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const ry = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    write(xEntry.key, xEntry.min + rx * (xEntry.max - xEntry.min));
    write(yEntry.key, yEntry.max - ry * (yEntry.max - yEntry.min));
  };

  const selectClass = 'w-full bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40';

  return (
    <section>
      <SectionTitle icon={<Gamepad2 size={12} />}>XY Pad · 演奏パッド</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        2つのパラメータを指先で同時に弾くためのパッドです。横がX、縦がY（上が最大）に対応します。
      </p>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">X axis</span>
          <select value={xKey} onChange={(event) => setXKey(event.target.value as keyof ParticleConfig)} className={selectClass}>
            {PARAMETER_CATALOG.map((entry) => (
              <option key={`x:${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-[9px] uppercase tracking-widest text-white/40 mb-1">Y axis</span>
          <select value={yKey} onChange={(event) => setYKey(event.target.value as keyof ParticleConfig)} className={selectClass}>
            {PARAMETER_CATALOG.map((entry) => (
              <option key={`y:${entry.tab}:${entry.key}`} value={entry.key} className="bg-neutral-900">
                {(TAB_SHORT_LABELS[entry.tab] ?? entry.tab)} · {entry.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={padRef}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        className="relative h-44 rounded-xl border border-white/15 bg-white/5 overflow-hidden touch-none cursor-crosshair select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
        <div
          className="absolute h-4 w-4 -ml-2 -mt-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.8)]"
          style={{ left: `${xRatio * 100}%`, top: `${(1 - yRatio) * 100}%` }}
        />
        <span className="absolute left-2 bottom-1.5 text-[9px] uppercase tracking-widest text-white/30">{xEntry?.label}</span>
        <span className="absolute right-2 top-1.5 text-[9px] uppercase tracking-widest text-white/30">{yEntry?.label}</span>
      </div>
    </section>
  );
};

export const HistorySection: React.FC<{
  entries: ControlPanelContentProps['configHistoryEntries'];
  config: ParticleConfig;
  onApplyConfig?: (config: ParticleConfig) => void;
  onClearConfigHistory?: () => void;
}> = ({ entries, config, onApplyConfig, onClearConfigHistory }) => {
  const currentJson = React.useMemo(() => JSON.stringify(config), [config]);
  if (!entries || entries.length === 0) return null;
  const ordered = [...entries].reverse();
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle icon={<History size={12} />}>History · 履歴</SectionTitle>
        <button
          onClick={onClearConfigHistory}
          className="text-[9px] uppercase tracking-widest text-white/35 hover:text-white/70 -mt-4"
        >
          古い履歴を消す
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4 -mt-2">
        設定が落ち着くたびに自動で記録しています（最大{entries.length > 0 ? 16 : 16}件、このセッション限り）。カードを押すとその状態に戻ります。偶然できた形の回収用です。
      </p>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {ordered.map((entry) => {
          const isCurrent = entry.json === currentJson;
          const time = new Date(entry.capturedAt).toLocaleTimeString('ja-JP', { hour12: false });
          return (
            <button
              key={entry.id}
              onClick={() => onApplyConfig?.(entry.config)}
              className={`shrink-0 w-32 text-left rounded-xl border p-2.5 transition-colors ${
                isCurrent ? 'border-white/45 bg-white/12' : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-white/70">{time}</span>
                {isCurrent && (
                  <span className="px-1.5 py-0.5 rounded bg-white text-black text-[8px] font-bold uppercase tracking-wider">
                    現在
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[9px] uppercase tracking-widest text-white/40 leading-relaxed">
                {entry.config.layer2Type}
                <br />
                {entry.config.layer3Type}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export const DataSourceSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const [text, setText] = React.useState('');
  const [layer, setLayer] = React.useState<2 | 3>(2);
  const [parsed, setParsed] = React.useState<ParsedData | null>(null);
  const [status, setStatus] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;

  const analyze = (input: string) => {
    const result = parseDataPoints(input);
    setParsed(result);
    if (!result) {
      setStatus(input.trim() ? '点を読み取れませんでした。x, y の2列が必要です。' : '');
      return;
    }
    setStatus(
      `${result.points.length.toLocaleString()} 点を読み取りました（X ${result.xRange[0]}〜${result.xRange[1]}、Y ${result.yRange[0]}〜${result.yRange[1]}${result.hasValue ? '、値あり' : ''}）。`,
    );
  };

  const applyParsed = (data: ParsedData) => {
    const map = buildDataLumaMap(data);
    getDataSourceUpdates(layer, map).forEach(([key, value]) => write(key, value));
    setStatus(`Layer ${layer} に適用しました。発生源は画像（データ）になり、現在の運動タイプのままデータの形を取ります。`);
  };

  const applySample = () => {
    const points = buildSampleDataPoints();
    const data: ParsedData = {
      points,
      hasValue: true,
      xRange: [0, 100],
      yRange: [0, 100],
    };
    setParsed(data);
    applyParsed(data);
  };

  // Signal columns (Phase AJ): the same text, parsed again with
  // the column structure preserved, registered for the modulation
  // engine's data-column sources. The shape flow above is untouched.
  const registeredTable = useDataTable();
  const registerColumns = () => {
    const table = parseDataTable(text);
    if (!table) {
      setStatus('列として読み取れませんでした。数値の列が必要です。');
      return;
    }
    setDataTable(table);
    setStatus(
      `信号列として登録しました（列: ${table.columns.join(' / ')}、${table.rows.length.toLocaleString()} 行）。Modulation の「データ列」から列を選んで配線できます。`,
    );
  };

  // Attribute point cloud (Phase AK): the same text, registered
  // as the attribute cloud — x/y/z columns become positions
  // (Morph target 'data'), every column rides the attribute
  // texture for the 'data' attribute source. Independent of the
  // signal-column registration above.
  const registeredCloud = useAttrPointCloud();
  const registerAttrCloud = () => {
    const cloud = parseAttrPointCloud(text);
    if (!cloud) {
      setStatus('属性点群として読み取れませんでした。x, y の2列（数値）が必要です。');
      return;
    }
    setAttrPointCloud(cloud);
    setStatus(
      `属性点群として登録しました（列: ${cloud.table.columns.join(' / ')}、${cloud.table.rows.length.toLocaleString()} 行）。Morph の Data ターゲットと、属性の Data 源で使えます。`,
    );
  };

  return (
    <section>
      <SectionTitle icon={<Database size={12} />}>Data Source · データ発生源</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        CSV や JSON の点データを粒子の形にします。XY が形になり、値（または Z）が明るさになります。画像発生源の仕組みをそのまま使うので、運動や描画は現在の設定が引き継がれます。
      </p>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          analyze(event.target.value);
        }}
        placeholder={'x, y, value\n0, 0, 1\n10, 4, 0.6\n… または JSON 配列'}
        rows={4}
        className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono outline-none focus:border-white/40 mb-3"
      />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => setLayer(Number(event.target.value) as 2 | 3)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value={2} className="bg-neutral-900">Layer 2 に適用</option>
          <option value={3} className="bg-neutral-900">Layer 3 に適用</option>
        </select>
        <button
          onClick={() => parsed && applyParsed(parsed)}
          disabled={!parsed || isPublicLibrary}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
        >
          適用する
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10"
        >
          ファイルを選ぶ
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then((content) => {
              setText(content);
              analyze(content);
            });
            event.target.value = '';
          }}
        />
        <button
          onClick={applySample}
          disabled={isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          サンプル（渦巻銀河）
        </button>
        <button
          onClick={registerColumns}
          disabled={!text.trim() || isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          信号列として登録
        </button>
        {registeredTable && (
          <button
            onClick={() => {
              setDataTable(null);
              setStatus('信号列の登録を解除しました。');
            }}
            disabled={isPublicLibrary}
            className="px-3 py-2 rounded-full text-[10px] uppercase tracking-widest text-white/35 hover:text-white/80 disabled:opacity-30"
          >
            信号列を解除（{registeredTable.columns.length}列・{registeredTable.rows.length.toLocaleString()}行）
          </button>
        )}
        <button
          onClick={registerAttrCloud}
          disabled={!text.trim() || isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          属性点群として登録
        </button>
        {registeredCloud && (
          <button
            onClick={() => {
              setAttrPointCloud(null);
              setStatus('属性点群の登録を解除しました。');
            }}
            disabled={isPublicLibrary}
            className="px-3 py-2 rounded-full text-[10px] uppercase tracking-widest text-white/35 hover:text-white/80 disabled:opacity-30"
          >
            属性点群を解除（{registeredCloud.table.columns.length}列・{registeredCloud.table.rows.length.toLocaleString()}行）
          </button>
        )}
      </div>
      {status && <p className="text-[11px] text-white/55">{status}</p>}
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドでは適用できません。</p>}
      <p className="text-[10px] text-white/30 mt-2">
        現在の Layer {layer} 発生源：{layer === 2 ? config.layer2Source : config.layer3Source}
        {(layer === 2 ? config.layer2MediaLumaMap : config.layer3MediaLumaMap).length > 0 ? '（データ／画像マップあり）' : ''}
      </p>
    </section>
  );
};

// Point cache (Phase BZ): a numbered binary-PLY sequence plus a
// v2 manifest, imported as an animated attribute point cloud.
// Playback follows the shared sequence clock (design A) — the
// transport is the sequence's own Play / Stop; this section is
// the import port plus the three config switches.
export const PointCacheSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const cache = usePointCache();
  const status = usePointCacheStatus();
  const playback = usePointCachePlaybackState();
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = new Map<string, ArrayBuffer>();
    for (const file of Array.from(fileList)) {
      files.set(file.name, await file.arrayBuffer());
    }
    const result = loadPointCacheFromFiles(files);
    if (result.ok) {
      const manifestFile = [...files.keys()].find((n) => n.toLowerCase().endsWith('.json')) ?? 'manifest.json';
      setPointCache(result.cache, manifestFile);
    } else {
      setPointCacheError(result.error);
    }
  };

  const frameTotal = cache?.manifest.frameCount ?? (config.pointCacheBundledSample ? 48 : 0);
  // Retimer (stage 3 S2): validate the configured range
  // against the current source so an invalid range shows
  // its refusal reason here (the driver falls back to the
  // un-retimed mapping while it is invalid).
  const retimerCheck = resolveCacheRetimerFromConfig(config, frameTotal);

  return (
    <section>
      <SectionTitle icon={<Film size={12} />}>Point Cache · ポイントキャッシュ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        連番の binary PLY とマニフェスト（JSON）を一緒に選ぶと、外部で焼いた点群アニメーションを取り込めます。再生はシーケンスの時計に連動し（再生・停止は Sequence のトランスポート）、属性点群として Morph の Data ターゲットや属性の Data 源へ流れます。上限は {POINT_CACHE_MAX_POINTS.toLocaleString()} 点 × {POINT_CACHE_MAX_FRAMES} フレームで、超えるもの・点数が合わないもの・欠けたファイルがあるものは、理由を表示して読み込みません。対応は位置のみです（色や属性のフレーム保持は今後の拡張）。
      </p>
      <Toggle
        label="Point Cache Playback （ポイントキャッシュ再生）"
        value={config.pointCacheEnabled}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => write('pointCacheEnabled', v)}
      />
      <Toggle
        label="Loop （キャッシュのループ）"
        value={config.pointCacheLoop}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => write('pointCacheLoop', v)}
      />
      <Toggle
        label="Bundled Sample （同梱サンプル）"
        value={config.pointCacheBundledSample}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => write('pointCacheBundledSample', v)}
      />
      <Toggle
        label="Retimer （リタイマー）"
        value={config.pointCacheRetimerEnabled}
        options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
        onChange={(v) => write('pointCacheRetimerEnabled', v)}
      />
      <p className="text-[11px] leading-relaxed text-white/45 mb-4 -mt-2">
        リタイマーは再生側だけのフレーム写像です（倍率・区間・逆再生・補間の上書き）。この下の状態キャッシュの再生にも同じ設定が効きます（再生路が共通のため）。シミュレーション自体の timeScale とは別物で、sim には触れません。Off（既定）では従来どおりの再生です。
      </p>
      {config.pointCacheRetimerEnabled && (
        <>
          <Slider
            label="Retimer Rate （再生倍率）"
            value={config.pointCacheRetimerRate}
            min={0.1}
            max={4}
            step={0.05}
            onChange={(v) => write('pointCacheRetimerRate', v)}
          />
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="flex items-center gap-1 text-[10px] text-white/50">
              開始フレーム
              <input type="number" min={0} step={1} value={config.pointCacheRetimerStartFrame}
                onChange={(event) => write('pointCacheRetimerStartFrame', Number(event.target.value))}
                className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40" />
            </label>
            <label className="flex items-center gap-1 text-[10px] text-white/50">
              終了フレーム（-1 = 最終）
              <input type="number" min={-1} step={1} value={config.pointCacheRetimerEndFrame}
                onChange={(event) => write('pointCacheRetimerEndFrame', Number(event.target.value))}
                className="w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40" />
            </label>
          </div>
          <Toggle
            label="Reverse （逆再生）"
            value={config.pointCacheRetimerReverse}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(v) => write('pointCacheRetimerReverse', v)}
          />
          <Toggle
            label="Interpolation （補間）"
            value={config.pointCacheRetimerInterpolation}
            options={[
              { label: 'Inherit （マニフェストどおり）', val: 'inherit' as const },
              { label: 'Linear', val: 'linear' as const },
              { label: 'Nearest', val: 'nearest' as const },
            ]}
            onChange={(v) => write('pointCacheRetimerInterpolation', v)}
          />
          {frameTotal > 0 && !retimerCheck.ok && (
            <p className="text-[11px] text-red-300/90 mb-3">
              リタイマーを適用できません: {retimerCheck.error}（この間はリタイマーなしで再生します）
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          ファイルを選ぶ（マニフェスト＋PLY）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.ply"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {cache && (
          <button
            onClick={() => setPointCache(null)}
            disabled={isPublicLibrary}
            className="px-3 py-2 rounded-full text-[10px] uppercase tracking-widest text-white/35 hover:text-white/80 disabled:opacity-30"
          >
            キャッシュを解除
          </button>
        )}
      </div>
      {status.kind === 'error' && (
        <p className="text-[11px] text-red-300/90">読み込めませんでした: {status.message}</p>
      )}
      {status.kind === 'ready' && (
        <p className="text-[11px] text-white/55">
          {status.bundled ? '同梱サンプル' : status.sourceName}: {status.count.toLocaleString()} 点 × {status.frameCount} フレーム / {status.fps} fps
        </p>
      )}
      {status.kind === 'empty' && config.pointCacheBundledSample && (
        <p className="text-[11px] text-white/55">再生元: 同梱サンプル（512 点 × 48 フレーム / 24 fps）</p>
      )}
      {status.kind === 'empty' && !config.pointCacheBundledSample && (
        <p className="text-[11px] text-white/35">キャッシュは読み込まれていません。</p>
      )}
      {config.pointCacheEnabled && (cache || config.pointCacheBundledSample) && (
        <p className="text-[11px] text-white/55 mt-1">
          {playback.suspended
            ? '属性点群が差し替えられたため、キャッシュ再生は保留中です（再生を切り替えるか、キャッシュを読み直すと再開します）。'
            : playback.running
              ? `再生中: フレーム ${playback.frameFloat.toFixed(1)} / ${frameTotal}`
              : `停止中: フレーム ${playback.frameFloat.toFixed(1)} / ${frameTotal}（Sequence の再生で進みます）`}
        </p>
      )}
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドでは適用できません。</p>}
    </section>
  );
};

// State cache (Grammar 2.0 stage 3, slice S0 wiring): capture
// this app's OWN simulation as a frame-sequence cache through
// a deterministic render job (fixed timestep, one readback
// per stepped frame — lib/gpgpuStateCacheCapture.ts), save it
// as a manifest + binary file pair, and load a saved pair back
// onto the EXISTING point-cache playback path above (no second
// consumer). Capture / save are full-edition features: the
// edition gate is resolved in exactly one place
// (stateCacheEditionForPublicLibrary + stateCacheExportAllowed).
// The Initial State block at the bottom is slice S1: the
// captured / loaded cache is also held as StateCacheData
// (lib/gpgpuInitialState.ts) and one of its frames can be
// applied back into the sim as its initial state — only on
// the explicit button press, and with the public-library
// load gate's convention (disabled in the public build).
// The PRT block below that is slice S3: the held cache
// converts to and from Thinkbox PRT files (one file per
// frame) through lib/stateCachePrt.ts — export goes
// through the same edition gate as the capture / save
// above, import lands on the same held store + playback
// path as the state-cache load.
// The Alembic block at the bottom is slice S4: the user
// picks the export format (杉 decision §4.5-1) — PRT
// above (one frame per file, import included) or Alembic
// here (the whole sequence in ONE .abc file, export only)
// through lib/stateCacheAlembic.ts, under the same
// edition gate.
// The Skinning block below it is slice S6: the held cache's
// frames become isosurface meshes (the density field is
// rebuilt on the CPU from the cached positions with the
// SPH kernel — no density field exists as GPU-side data —
// through lib/stateCacheSkinning.ts) and download as one
// ZIP, a derived artefact under the same edition gate.
// Its parameters are config keys, so this section takes
// config / updateConfig like the Point Cache section.
// The Trail Geometry block at the very bottom is slice
// S7: each particle's trajectory is reconstructed from
// the held cache's frame sequence (the drawing trails'
// histories are GPU render targets / a component-local
// buffer — neither exists as obtainable data) and swept
// into a tube, one OBJ / STL document per particle in one
// ZIP, through lib/stateCacheTrailGeometry.ts — again a
// derived artefact under the same edition gate, and the
// drawing trail modes are not touched.
// The Mesh Series block above it is slice S5:
// the held cache's frames become a time series of
// grid-topology meshes (one OBJ / STL document per frame,
// built by the EXISTING single-frame builders in
// lib/meshExport.ts through lib/stateCacheMeshSeries.ts)
// and download as ONE ZIP — a derived artefact of the
// cache, regenerable at any time, under the same
// edition gate.
export const StateCacheSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [fps, setFps] = React.useState(30);
  const [frames, setFrames] = React.useState(60);
  const [warmupFrames, setWarmupFrames] = React.useState(30);
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [status, setStatus] = React.useState('');
  // Initial State (stage 3, slice S1): the cache this section
  // captured or loaded is also held as StateCacheData
  // (lib/gpgpuInitialState.ts) so one of its frames can be
  // applied back into the sim as its initial state. Mirrors
  // the held store; both are written together in the
  // capture / load handlers below.
  const [held, setHeld] = React.useState<HeldStateCache | null>(() => getHeldStateCache());
  const [initFrame, setInitFrame] = React.useState(0);
  const [initStatus, setInitStatus] = React.useState('');
  // PRT (stage 3, slice S3): one PRT file holds one frame,
  // so export names a single frame of the held cache.
  const [prtFrame, setPrtFrame] = React.useState(0);
  const [prtStatus, setPrtStatus] = React.useState('');
  // Alembic (stage 3, slice S4): one .abc file holds the
  // whole sequence, so export needs no frame choice.
  const [abcStatus, setAbcStatus] = React.useState('');
  // Mesh series (stage 3, slice S5): one mesh document
  // per frame, packed into one ZIP; the only choice is
  // the document format (OBJ / STL, as in the single-frame
  // mesh export).
  const [meshFormat, setMeshFormat] = React.useState<MeshSeriesFormat>('obj');
  const [meshStatus, setMeshStatus] = React.useState('');
  // Skinning (stage 3, slice S6): the held cache's frames
  // become isosurface meshes (density field rebuilt on the
  // CPU from the cached positions, lib/stateCacheSkinning
  // .ts) and download as one ZIP. The parameters live in
  // config keys (stateCacheSkinning* + the SPH / bounds
  // keys), edited below like the retimer's keys.
  const [skinFormat, setSkinFormat] = React.useState<SkinningFormat>('obj');
  const [skinStatus, setSkinStatus] = React.useState('');
  // Trail geometry (stage 3, slice S7): each particle's
  // trajectory is reconstructed from the held cache's
  // frame sequence and swept into a tube, one document
  // per particle in one ZIP (lib/stateCacheTrailGeometry
  // .ts). The parameters live in config keys
  // (stateCacheTrail*), edited below like the skinning
  // keys.
  const [trailFormat, setTrailFormat] = React.useState<TrailGeometryFormat>('obj');
  const [trailStatus, setTrailStatus] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const prtFileRef = React.useRef<HTMLInputElement | null>(null);
  const edition = stateCacheEditionForPublicLibrary(isPublicLibrary);
  const exportAllowed = stateCacheExportAllowed(edition);

  const holdCache = (cache: Parameters<typeof setHeldStateCache>[0], sourceName: string) => {
    setHeldStateCache(cache, sourceName);
    const next = getHeldStateCache();
    setHeld(next);
    // The most-solved frame is the natural resume point.
    setInitFrame(cache.manifest.frameCount - 1);
    setPrtFrame(cache.manifest.frameCount - 1);
    setInitStatus('');
    setPrtStatus('');
    setAbcStatus('');
    setMeshStatus('');
    setSkinStatus('');
    setTrailStatus('');
    return next;
  };

  const handleApplyInitialState = () => {
    const result = applyHeldStateCacheFrameAsInitialState({ frameIndex: initFrame });
    if (!result.ok) {
      setInitStatus(`適用できませんでした: ${result.error}`);
      return;
    }
    setInitStatus(
      `フレーム ${result.frameIndex} を初期状態として適用しました。この状態からシミュレーションが解き直されます（プールの再ベイクではありません。設定を変えると通常どおりベイクから再シードされます）。`,
    );
  };

  const handlePrtExport = async () => {
    const current = getHeldStateCache();
    if (!current || busy) return;
    setBusy(true);
    const result = await buildPrtFileForFrame(current.cache, prtFrame, edition);
    setBusy(false);
    if (!result.ok) {
      setPrtStatus(`書き出せませんでした: ${result.error}`);
      return;
    }
    download(result.fileName, new Blob([result.buffer], { type: 'application/octet-stream' }));
    setPrtStatus(
      `フレーム ${prtFrame} を PRT（${result.fileName}）で保存しました。ID チャンネルは粒子インデックスから生成したものです（正本形式に ID の実体はありません）。`,
    );
  };

  const handleAlembicExport = () => {
    const current = getHeldStateCache();
    if (!current || busy) return;
    const result = buildAlembicFile(current.cache, edition);
    if (!result.ok) {
      setAbcStatus(`書き出せませんでした: ${result.error}`);
      return;
    }
    download(result.fileName, new Blob([result.buffer], { type: 'application/octet-stream' }));
    setAbcStatus(
      `全 ${current.cache.manifest.frameCount} フレームを Alembic（${result.fileName}）で保存しました。.pointIds は粒子インデックスから生成したものです（正本形式に ID の実体はありません）。`,
    );
  };

  const handleMeshSeriesExport = async () => {
    const current = getHeldStateCache();
    if (!current || busy) return;
    setBusy(true);
    const result = await buildStateCacheMeshSeriesZip(current.cache, { format: meshFormat, edition });
    setBusy(false);
    if (!result.ok) {
      setMeshStatus(`書き出せませんでした: ${result.error}`);
      return;
    }
    download(result.fileName, new Blob([result.buffer], { type: 'application/zip' }));
    setMeshStatus(
      `全 ${result.fileCount} フレームの時系列メッシュを ZIP（${result.fileName}）で保存しました（合計 ${result.totalVertices.toLocaleString()} 頂点／${result.totalFaces.toLocaleString()} 面）。中身はフレームごとの ${meshFormat.toUpperCase()} ファイルです。`,
    );
  };

  const handleSkinningExport = async () => {
    const current = getHeldStateCache();
    if (!current || busy) return;
    const resolved = resolveStateCacheSkinningFromConfig(config);
    if (!resolved.ok) {
      setSkinStatus(`書き出せませんでした: ${resolved.error}`);
      return;
    }
    setBusy(true);
    const result = await buildStateCacheSkinningSeriesZip(current.cache, resolved.params, { format: skinFormat, edition });
    setBusy(false);
    if (!result.ok) {
      setSkinStatus(`書き出せませんでした: ${result.error}`);
      return;
    }
    download(result.fileName, new Blob([result.buffer], { type: 'application/zip' }));
    setSkinStatus(
      `全 ${result.fileCount} フレームの等値面メッシュを ZIP（${result.fileName}）で保存しました（合計 ${result.totalVertices.toLocaleString()} 頂点／${result.totalFaces.toLocaleString()} 面）。中身はフレームごとの ${skinFormat.toUpperCase()} ファイルです。`,
    );
  };

  const handleTrailExport = async () => {
    const current = getHeldStateCache();
    if (!current || busy) return;
    const resolved = resolveStateCacheTrailFromConfig(config);
    if (!resolved.ok) {
      setTrailStatus(`書き出せませんでした: ${resolved.error}`);
      return;
    }
    setBusy(true);
    const result = await buildStateCacheTrailGeometryZip(current.cache, resolved.params, { format: trailFormat, edition });
    setBusy(false);
    if (!result.ok) {
      setTrailStatus(`書き出せませんでした: ${result.error}`);
      return;
    }
    download(result.fileName, new Blob([result.buffer], { type: 'application/zip' }));
    const windowNote = result.window.framesUsed < result.window.framesTotal
      ? `履歴は直近 ${result.window.framesUsed} フレーム（フレーム ${result.window.windowStartFrame} から）を使いました。`
      : `履歴は全 ${result.window.framesTotal} フレームを使いました。`;
    setTrailStatus(
      `粒子 ${result.fileCount} 点ぶんのトレイルチューブを ZIP（${result.fileName}）で保存しました（合計 ${result.totalVertices.toLocaleString()} 頂点／${result.totalFaces.toLocaleString()} 面）。中身は粒子ごとの ${trailFormat.toUpperCase()} ファイルです。${windowNote}`,
    );
  };

  const handlePrtFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files: { name: string; buffer: ArrayBuffer }[] = [];
    for (const file of Array.from(fileList)) {
      files.push({ name: file.name, buffer: await file.arrayBuffer() });
    }
    // PRT carries no frame rate; the fps field above is
    // what the imported cache is stamped with.
    const loaded = await decodePrtFiles(files, { fps });
    if (!loaded.ok) {
      setPrtStatus(`読み込めませんでした: ${loaded.error}`);
      return;
    }
    holdCache(loaded.cache, '読み込んだ PRT');
    const notes: string[] = [];
    if (loaded.report.droppedChannels.length > 0) {
      notes.push(`取り込めなかったチャンネル: ${loaded.report.droppedChannels.map((d) => `${d.name}（${d.reason}）`).join('、')}`);
    }
    if (loaded.report.convertedChannels.length > 0) {
      notes.push(`型を変換したチャンネル: ${loaded.report.convertedChannels.map((c) => `${c.name}（${c.fromType} → float32）`).join('、')}`);
    }
    if (loaded.report.filledChannels.length > 0) {
      notes.push(`補ったチャンネル: ${loaded.report.filledChannels.join('、')}`);
    }
    const converted = stateCacheToPointCacheData(loaded.cache);
    if (!converted.ok) {
      setPrtStatus(`読み込みましたが再生できません: ${converted.error}${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`);
      return;
    }
    setPointCache(converted.data, 'PRT');
    setPrtStatus(
      `PRT を読み込みました（${loaded.cache.manifest.count.toLocaleString()} 点 × ${loaded.cache.manifest.frameCount} フレーム）。上の Point Cache セクションで再生を On にすると再生します。${notes.length > 0 ? ` ${notes.join(' ')}` : ''}`,
    );
  };

  const download = (name: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleCapture = async () => {
    if (busy) return;
    setBusy(true);
    setProgress('');
    setStatus('決定性レンダー（固定ステップ）で撮影しています…');
    const result = await runStateCacheCaptureJob(
      { fps, frames, warmupFrames, edition },
      (done, total) => setProgress(`${done} / ${total}`),
    );
    setBusy(false);
    setProgress('');
    if (!result.ok) {
      setStatus(`撮影できませんでした: ${result.error}`);
      return;
    }
    holdCache(result.cache, '撮影した状態キャッシュ');
    const files = buildStateCacheFiles(result.cache);
    download(files.manifestFileName, new Blob([files.manifestText], { type: 'application/json' }));
    download(files.framesFileName, new Blob([files.framesBuffer], { type: 'application/octet-stream' }));
    setStatus(
      `${result.cache.manifest.count.toLocaleString()} 点 × ${result.cache.manifest.frameCount} フレームを保存しました（マニフェスト .json ＋ バイナリ .bin の2ファイル）。読み込むと上の Point Cache の再生路でそのまま再生できます。`,
    );
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = new Map<string, ArrayBuffer>();
    for (const file of Array.from(fileList)) {
      files.set(file.name, await file.arrayBuffer());
    }
    const loaded = loadStateCacheFromFiles(files);
    if (!loaded.ok) {
      setStatus(`読み込めませんでした: ${loaded.error}`);
      return;
    }
    // Held for Initial State (S1) even when the playback
    // conversion below refuses (the playback caps are the
    // point-cache consumer's, not the initial-state path's).
    holdCache(loaded.cache, '読み込んだ状態キャッシュ');
    const converted = stateCacheToPointCacheData(loaded.cache);
    if (!converted.ok) {
      setStatus(`読み込みましたが再生できません: ${converted.error}`);
      return;
    }
    setPointCache(converted.data, '状態キャッシュ');
    setStatus(
      `状態キャッシュを読み込みました（${loaded.cache.manifest.count.toLocaleString()} 点 × ${loaded.cache.manifest.frameCount} フレーム / ${loaded.cache.manifest.fps} fps）。上の Point Cache セクションで再生を On にすると、シーケンスの時計に連動して再生します。`,
    );
  };

  const numberInputClass = 'w-20 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40 disabled:opacity-40';

  return (
    <section>
      <SectionTitle icon={<Camera size={12} />}>State Cache · 状態キャッシュ</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        自分のシミュレーション結果（位置・速度・年齢）を、決定性レンダーの固定ステップでフレームごとに撮影してファイルに保存します。保存はマニフェスト（.json）＋バイナリ（.bin）の2ファイルで、読み込むと上の Point Cache と同じ再生路に乗ります（再シミュレーションなしの再生＝展示・ライブ用途）。撮影中は内部で PNG 連番レンダーも走りますが、その画像は破棄され、残るのはキャッシュの2ファイルだけです。形式の上限は 65,536 点 × 3,600 フレーム、再生側の上限は Point Cache と同じ 8,192 点 × 240 フレームで、超えるものは理由を表示して扱いません（間引きはしません）。撮影・保存は完全版の機能です。
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="flex items-center gap-1 text-[10px] text-white/50">
          fps
          <input type="number" min={1} max={240} step={1} value={fps} disabled={busy}
            onChange={(event) => setFps(Number(event.target.value))} className={numberInputClass} />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-white/50">
          フレーム数
          <input type="number" min={1} max={3600} step={1} value={frames} disabled={busy}
            onChange={(event) => setFrames(Number(event.target.value))} className={numberInputClass} />
        </label>
        <label className="flex items-center gap-1 text-[10px] text-white/50">
          ウォームアップ
          <input type="number" min={0} max={3600} step={1} value={warmupFrames} disabled={busy}
            onChange={(event) => setWarmupFrames(Number(event.target.value))} className={numberInputClass} />
        </label>
        <button
          onClick={() => void handleCapture()}
          disabled={busy || !exportAllowed}
          className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
        >
          {busy ? `撮影中… ${progress}` : '撮影して保存（.json＋.bin）'}
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy || isPublicLibrary}
          className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
        >
          状態キャッシュを読む（.json＋.bin）
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.bin"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </div>
      {status && <p className="text-[11px] text-white/55">{status}</p>}
      {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版では撮影・保存はできません（完全版の機能です）。</p>}
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-1">公開ビルドでは適用できません。</p>}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">Initial State · 初期状態として再開</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          撮影・読み込みで保持した状態キャッシュの任意フレーム（位置・速度・年齢）を、シミュレーションの初期状態としてプールに戻し、そこから解き直します。適用はこのボタンを押したときだけです。キャッシュの粒子数（texSize）が現在のプールと一致しないもの、年齢（age）属性の無いものは、理由を表示して適用しません（リサンプルや年齢の捏造はしません）。速度の w レーン（Kuramoto 位相）は形式に含まれないため、ベイクと同じ 0 から始まります。WebGPU 経路では未対応で、理由を表示して適用しません。
        </p>
        {held ? (
          <>
            <p className="text-[11px] text-white/55 mb-3">
              保持中: {held.sourceName}（{held.cache.manifest.count.toLocaleString()} 点 × {held.cache.manifest.frameCount} フレーム / {held.cache.manifest.fps} fps / texSize {held.cache.manifest.texSize}）
            </p>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <label className="flex items-center gap-1 text-[10px] text-white/50">
                フレーム
                <input type="number" min={0} max={held.cache.manifest.frameCount - 1} step={1} value={initFrame} disabled={busy}
                  onChange={(event) => setInitFrame(Number(event.target.value))} className={numberInputClass} />
              </label>
              <button
                onClick={handleApplyInitialState}
                disabled={busy || isPublicLibrary}
                className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
              >
                このフレームを初期状態として適用
              </button>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください。</p>
        )}
        {initStatus && <p className="text-[11px] text-white/55">{initStatus}</p>}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">PRT · 粒子フォーマット入出力</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          保持中の状態キャッシュを Thinkbox PRT 形式（Krakatoa の粒子ファイル形式、v1.1）で書き出し・読み込みします。PRT は1ファイルに1フレームだけを持つ形式のため、書き出しは指定した1フレーム分です。読み込みは連番の .prt を複数選ぶと、ファイル名の番号順にフレーム列として取り込みます。位置・速度・年齢とカスタム属性が往復します。ID チャンネルは正本形式に実体が無いため、書き出し時に粒子インデックスから生成し、読み込み時は保存しません。PRT にはフレームレートが無いため、読み込んだキャッシュの fps は上の fps 欄の値になります。座標の値は変換せずそのまま通し、座標系はメタデータ（CoordSys）で伝えます。粒子数が平方数でない PRT は、正本形式（texSize の二乗が点数）に取り込めないため、理由を表示して読み込みません（リサンプルはしません）。書き出しは完全版の機能です。
        </p>
        {held ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <label className="flex items-center gap-1 text-[10px] text-white/50">
              フレーム
              <input type="number" min={0} max={held.cache.manifest.frameCount - 1} step={1} value={prtFrame} disabled={busy}
                onChange={(event) => setPrtFrame(Number(event.target.value))} className={numberInputClass} />
            </label>
            <button
              onClick={() => void handlePrtExport()}
              disabled={busy || !exportAllowed}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              このフレームを PRT で保存（.prt）
            </button>
            <button
              onClick={() => prtFileRef.current?.click()}
              disabled={busy || isPublicLibrary}
              className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
            >
              PRT を読む（.prt、複数可）
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください（PRT の読み込みだけなら、そのまま選べます）。</p>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <button
                onClick={() => prtFileRef.current?.click()}
                disabled={busy || isPublicLibrary}
                className="px-3 py-2 rounded-full border border-white/20 text-[10px] uppercase tracking-widest text-white/70 hover:bg-white/10 disabled:opacity-30"
              >
                PRT を読む（.prt、複数可）
              </button>
            </div>
          </>
        )}
        <input
          ref={prtFileRef}
          type="file"
          accept=".prt"
          multiple
          className="hidden"
          onChange={(event) => {
            void handlePrtFiles(event.target.files);
            event.target.value = '';
          }}
        />
        {prtStatus && <p className="text-[11px] text-white/55">{prtStatus}</p>}
        {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版では PRT の書き出しはできません（完全版の機能です）。</p>}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">Alembic · 書き出し</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          保持中の状態キャッシュを Alembic 形式（.abc、Ogawa 形式）で書き出します。書き出し形式は上の PRT とこちらから選べます。PRT と違い、1ファイルに全フレームが Points オブジェクトの時刻サンプル列として入ります。位置・速度・年齢とカスタム属性が入り、座標の値は変換せずそのまま通し、フレームレートは時刻サンプルの間隔（TimeSampling）として伝えます。.pointIds は PRT の ID と同じく粒子インデックスから生成します（正本形式に ID の実体はありません）。Alembic の読み込みには対応していません。書き出しは完全版の機能です。
        </p>
        {held ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <button
              onClick={handleAlembicExport}
              disabled={busy || !exportAllowed}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              全フレームを Alembic で保存（.abc）
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください。</p>
        )}
        {abcStatus && <p className="text-[11px] text-white/55">{abcStatus}</p>}
        {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版では Alembic の書き出しはできません（完全版の機能です）。</p>}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">Mesh Series · 時系列メッシュ書き出し</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          保持中の状態キャッシュの各フレームを、グリッド位相メッシュ（単発のメッシュ書き出しと同じ生成方法）でジオメトリ化し、フレームごとの OBJ／STL ファイルとして書き出します。メッシュはキャッシュから再生成できる派生データで、正本は状態キャッシュのままです。粒子は texSize × texSize のグリッド順（キャッシュの保持順そのまま）で並んでいる前提で面を張ります。キャッシュの粒子数がグリッドの二乗と一致しないものは、理由を表示して書き出しません（並べ替えやリサンプルはしません）。ファイルはフレーム数だけできます（最大 3,600 ファイル）が、ブラウザの複数ダウンロード制限に触れないよう、連番ファイル一式を1つの ZIP にまとめて1回でダウンロードします。フレーム数・粒子数が大きいと ZIP も大きくなります（特に STL はテキスト形式のため大きくなります）。書き出しは完全版の機能です。
        </p>
        {held ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={meshFormat}
              onChange={(event) => setMeshFormat(event.target.value as MeshSeriesFormat)}
              disabled={busy}
              className="bg-white/5 border border-white/10 rounded px-2 py-2 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            >
              <option value="obj" className="bg-neutral-900">OBJ 連番</option>
              <option value="stl" className="bg-neutral-900">STL 連番</option>
            </select>
            <button
              onClick={() => void handleMeshSeriesExport()}
              disabled={busy || !exportAllowed}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              全フレームを時系列メッシュで保存（ZIP）
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください。</p>
        )}
        {meshStatus && <p className="text-[11px] text-white/55">{meshStatus}</p>}
        {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版では時系列メッシュの書き出しはできません（完全版の機能です）。</p>}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">Skinning · 等値面メッシュ書き出し</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          保持中の状態キャッシュの各フレームを、等値面メッシュ（スキニング）としてジオメトリ化し、フレームごとの OBJ／STL ファイルを1つの ZIP にまとめて書き出します。密度場は GPU から読み戻すのではなく、キャッシュの粒子位置から SPH と同じカーネル（半径は SPH 半径キー、割る数は rest density キー）で CPU 上に組み立て直し、対象範囲（跳ね返り半径キーの立方体）の中に等値の面を張ります。表示用のメタボール描画とは独立したデータ生成で、描画には影響しません。メッシュはキャッシュから再生成できる派生データで、正本は状態キャッシュのままです。粒子数が上限を超えるキャッシュや、カーネル半径がグリッド間隔より小さい設定は、理由を表示して書き出しません。等値まで届かないフレームは空のメッシュ（0面）として系列に残ります。フレーム数・解像度が大きいと ZIP も大きくなります。書き出しは完全版の機能です。
        </p>
        <Slider
          label="Skinning Resolution （密度グリッド解像度）"
          value={config.stateCacheSkinningResolution}
          min={8}
          max={96}
          step={1}
          onChange={(v) => write('stateCacheSkinningResolution', v)}
        />
        <Slider
          label="Skinning Iso Level （等値）"
          value={config.stateCacheSkinningIsoLevel}
          min={0.05}
          max={2}
          step={0.05}
          onChange={(v) => write('stateCacheSkinningIsoLevel', v)}
        />
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            粒子数上限
            <input type="number" min={1} step={1} value={config.stateCacheSkinningMaxParticles}
              onChange={(event) => write('stateCacheSkinningMaxParticles', Number(event.target.value))}
              className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40" />
          </label>
        </div>
        {held && !resolveStateCacheSkinningFromConfig(config).ok && (
          <p className="text-[11px] text-red-300/90 mb-3">
            スキニングを適用できません: {(resolveStateCacheSkinningFromConfig(config) as { error: string }).error}
          </p>
        )}
        {held ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={skinFormat}
              onChange={(event) => setSkinFormat(event.target.value as SkinningFormat)}
              disabled={busy}
              className="bg-white/5 border border-white/10 rounded px-2 py-2 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            >
              <option value="obj" className="bg-neutral-900">OBJ 連番</option>
              <option value="stl" className="bg-neutral-900">STL 連番</option>
            </select>
            <button
              onClick={() => void handleSkinningExport()}
              disabled={busy || !exportAllowed}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              全フレームを等値面メッシュで保存（ZIP）
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください。</p>
        )}
        {skinStatus && <p className="text-[11px] text-white/55">{skinStatus}</p>}
        {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版では等値面メッシュの書き出しはできません（完全版の機能です）。</p>}
      </div>
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className="text-[11px] font-bold text-white/70 mb-2">Trail Geometry · トレイルジオメトリ書き出し</p>
        <p className="text-[11px] leading-relaxed text-white/45 mb-3">
          保持中の状態キャッシュから、粒子ごとの軌跡（全フレームにわたる同じ粒子の位置の列）を再構成し、その軌跡に円断面のチューブを沿わせたジオメトリを、粒子ごとの OBJ／STL ファイルとして1つの ZIP にまとめて書き出します。表示側のトレイル（リボン／チューブ描画）の履歴は GPU テクスチャとコンポーネント内バッファに閉じていてデータとして取り出せないため、軌跡はキャッシュから再構成します。描画側のトレイルには一切触れません。チューブの座標系は平行移動フレーム（軌跡に沿ってねじれを運ばない決め方）で、両端は開いています。静止した粒子はチューブにならず空のファイルとして系列に残ります。キャッシュが履歴フレーム上限より長い場合は直近のフレームだけを使い、その範囲を結果に明示します。粒子数が上限を超えるキャッシュは、理由を表示して書き出しません。メッシュはキャッシュから再生成できる派生データで、正本は状態キャッシュのままです。書き出しは完全版の機能です。
        </p>
        <Slider
          label="Trail Radius （チューブ半径）"
          value={config.stateCacheTrailRadius}
          min={0.1}
          max={20}
          step={0.1}
          onChange={(v) => write('stateCacheTrailRadius', v)}
        />
        <Slider
          label="Trail Radial Segments （断面分割数）"
          value={config.stateCacheTrailRadialSegments}
          min={3}
          max={32}
          step={1}
          onChange={(v) => write('stateCacheTrailRadialSegments', v)}
        />
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            粒子数上限
            <input type="number" min={1} step={1} value={config.stateCacheTrailMaxParticles}
              onChange={(event) => write('stateCacheTrailMaxParticles', Number(event.target.value))}
              className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40" />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            履歴フレーム上限
            <input type="number" min={2} step={1} value={config.stateCacheTrailMaxFrames}
              onChange={(event) => write('stateCacheTrailMaxFrames', Number(event.target.value))}
              className="w-24 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40" />
          </label>
        </div>
        {held && !resolveStateCacheTrailFromConfig(config).ok && (
          <p className="text-[11px] text-red-300/90 mb-3">
            トレイルジオメトリを適用できません: {(resolveStateCacheTrailFromConfig(config) as { error: string }).error}
          </p>
        )}
        {held ? (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <select
              value={trailFormat}
              onChange={(event) => setTrailFormat(event.target.value as TrailGeometryFormat)}
              disabled={busy}
              className="bg-white/5 border border-white/10 rounded px-2 py-2 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            >
              <option value="obj" className="bg-neutral-900">OBJ（粒子ごと）</option>
              <option value="stl" className="bg-neutral-900">STL（粒子ごと）</option>
            </select>
            <button
              onClick={() => void handleTrailExport()}
              disabled={busy || !exportAllowed}
              className="px-4 py-2 rounded-full bg-white text-black text-[10px] font-bold uppercase tracking-widest disabled:opacity-30 hover:bg-gray-200 transition-colors"
            >
              全粒子のトレイルをジオメトリで保存（ZIP）
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-white/35 mb-3">保持中の状態キャッシュはありません。上の「撮影して保存」か「状態キャッシュを読む」で用意してください。</p>
        )}
        {trailStatus && <p className="text-[11px] text-white/55">{trailStatus}</p>}
        {!exportAllowed && <p className="text-[11px] text-white/35 mt-1">公開版ではトレイルジオメトリの書き出しはできません（完全版の機能です）。</p>}
      </div>
    </section>
  );
};

export const TextureThumb: React.FC<{ map: number[] }> = ({ map }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const image = ctx.createImageData(TEXTURE_MAP_SIZE, TEXTURE_MAP_SIZE);
    for (let i = 0; i < TEXTURE_MAP_SIZE * TEXTURE_MAP_SIZE; i++) {
      const gray = Math.round(Math.min(1, Math.max(0, map[i] ?? 0)) * 255);
      image.data[i * 4] = gray;
      image.data[i * 4 + 1] = gray;
      image.data[i * 4 + 2] = gray;
      image.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [map]);
  return (
    <canvas
      ref={canvasRef}
      width={TEXTURE_MAP_SIZE}
      height={TEXTURE_MAP_SIZE}
      className="w-full aspect-square rounded bg-black border border-white/10"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

export const TexturePackSection: React.FC<{
  config: ParticleConfig;
  updateConfig: ControlPanelContentProps['updateConfig'];
  isPublicLibrary: boolean;
}> = ({ config, updateConfig, isPublicLibrary }) => {
  const write = updateConfig as (key: keyof ParticleConfig, value: ParticleConfig[keyof ParticleConfig]) => void;
  const [layer, setLayer] = React.useState<2 | 3>(2);
  const [applied, setApplied] = React.useState('');
  // Phase AD: the cloud-noise tile is generated from the config
  // parameters (kind / period / octaves); every other tile is a
  // fixed pattern. The defaults reproduce the pre-AD noise map
  // bit-for-bit.
  const noiseParams = React.useMemo(
    () => ({ kind: config.textureNoiseKind, period: config.textureNoisePeriod, octaves: config.textureNoiseOctaves, seed: config.textureNoiseSeed }),
    [config.textureNoiseKind, config.textureNoisePeriod, config.textureNoiseOctaves, config.textureNoiseSeed],
  );
  const maps = React.useMemo(
    () => TEXTURE_DEFINITIONS.map((definition) => ({ definition, map: generateTextureMap(definition.id, noiseParams) })),
    [noiseParams],
  );

  const applyTexture = (id: string, map: number[]) => {
    getDataSourceUpdates(layer, map).forEach(([key, value]) => write(key, value));
    const definition = getTextureDefinition(id);
    setApplied(`「${definition?.label ?? id}」を Layer ${layer} に適用しました`);
  };

  return (
    <section>
      <SectionTitle icon={<Grid3x3 size={12} />}>Texture Pack · モノクロ質感パック</SectionTitle>
      <p className="text-[11px] leading-relaxed text-white/45 mb-4">
        白黒の模様を粒子の形として使えます。タイルを選ぶと、その模様が選んだレイヤーの発生源（画像）になります。運動や描画は現在の設定のままです。
      </p>
      <div className="flex items-center gap-2 mb-3">
        <select
          value={layer}
          onChange={(event) => setLayer(Number(event.target.value) as 2 | 3)}
          className="bg-white/5 border border-white/10 rounded px-2 py-2 text-xs outline-none focus:border-white/40"
        >
          <option value={2} className="bg-neutral-900">Layer 2 に適用</option>
          <option value={3} className="bg-neutral-900">Layer 3 に適用</option>
        </select>
        {applied && <p className="text-[11px] text-white/55">{applied}</p>}
      </div>
      <div className="mb-3 rounded border border-white/10 bg-black/20 p-2">
        <div className="mb-2 text-[9px] uppercase tracking-widest text-white/40">雲ノイズの生成パラメータ（Phase AD）</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={config.textureNoiseKind}
            onChange={(event) => write('textureNoiseKind', event.target.value as NoiseTextureKind)}
            disabled={isPublicLibrary}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
          >
            <option value="value" className="bg-neutral-900">Value（なめらか）</option>
            <option value="ridge" className="bg-neutral-900">Ridge（稜線）</option>
            <option value="turbulence" className="bg-neutral-900">Turbulence（乱流）</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            周期
            <input
              type="number"
              min={1}
              max={16}
              step={1}
              value={config.textureNoisePeriod}
              disabled={isPublicLibrary}
              onChange={(event) => write('textureNoisePeriod', Number(event.target.value))}
              className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            オクターブ
            <input
              type="number"
              min={1}
              max={5}
              step={1}
              value={config.textureNoiseOctaves}
              disabled={isPublicLibrary}
              onChange={(event) => write('textureNoiseOctaves', Number(event.target.value))}
              className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-white/50">
            シード
            <input
              type="number"
              min={0}
              max={999}
              step={1}
              value={config.textureNoiseSeed}
              disabled={isPublicLibrary}
              onChange={(event) => write('textureNoiseSeed', Number(event.target.value))}
              className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-[11px] outline-none focus:border-white/40 disabled:opacity-40"
            />
          </label>
        </div>
        <p className="mt-1 text-[10px] text-white/35">既定（Value／周期4／オクターブ3／シード0）は従来の雲ノイズと完全一致します。シードを変えると雲の配置が変わります（適用はタイルの再クリックで反映）。</p>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {maps.map(({ definition, map }) => (
          <button
            key={definition.id}
            onClick={() => applyTexture(definition.id, map)}
            disabled={isPublicLibrary}
            title={definition.description}
            className="group text-left disabled:opacity-40"
          >
            <TextureThumb map={map} />
            <span className="block mt-1 text-[10px] text-white/60 group-hover:text-white transition-colors">
              {definition.label}
            </span>
          </button>
        ))}
      </div>
      {isPublicLibrary && <p className="text-[11px] text-white/35 mt-2">公開ビルドでは適用できません。</p>}
      <p className="text-[10px] text-white/30 mt-2">
        現在の Layer {layer} 発生源：{layer === 2 ? config.layer2Source : config.layer3Source}
        {(layer === 2 ? config.layer2MediaLumaMap : config.layer3MediaLumaMap).length > 0 ? '（マップあり）' : ''}
      </p>
    </section>
  );
};

