import React from 'react';
import { Database, Gamepad2, Grid3x3, History, Search } from 'lucide-react';
import type { ParticleConfig } from '../types';
import { PARAMETER_CATALOG, searchParameters, type ParameterCatalogEntry } from '../lib/parameterCatalog';
import { buildDataLumaMap, buildSampleDataPoints, getDataSourceUpdates, parseDataPoints, type ParsedData } from '../lib/dataSource';
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
    () => ({ kind: config.textureNoiseKind, period: config.textureNoisePeriod, octaves: config.textureNoiseOctaves }),
    [config.textureNoiseKind, config.textureNoisePeriod, config.textureNoiseOctaves],
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
        </div>
        <p className="mt-1 text-[10px] text-white/35">既定（Value／周期4／オクターブ3）は従来の雲ノイズと完全一致します。</p>
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

