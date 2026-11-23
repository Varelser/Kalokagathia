import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import { AGE_CURVE_POINT_MAX, AGE_CURVE_PRESETS, normalizeAgeCurvePoints } from '../lib/ageCurve';
import { extractLumaMap, extractTextLumaMap } from './controlPanelPartsSourceMediaUtils';
import { textLayoutOptionsFromTextMap } from '../lib/textColumnLayout';
import {
  afMapSource,
  getNoiseFieldLuma,
  getPathRasterLuma,
  isAfMapSource,
  parseAfMapSource,
  parsePathRasterFillMode,
  pathRasterStrokeRadius,
  rasterizePathGeometryLuma,
  PATH_RASTER_FILL_EVENODD_SOURCE,
  PATH_RASTER_FILL_NONZERO_SOURCE,
  type AfMapSourceKind,
} from '../lib/mapSourceSupply';
import {
  TERRAIN_DERIVED_KINDS,
  getTerrainDerivedMapCanvas,
  isTerrainDerivedSource,
  parseTerrainDerivedSource,
  terrainDerivedSource,
  terrainOptionsFromConfig,
  type TerrainDerivedMapKind,
} from '../lib/terrainDerivedMaps';
import { combineLumaMaps, normalizeMaskBoolOp } from '../lib/shapeBoolean';
import {
  contoursToPathGeometry,
  contoursToSvgText,
  normalizeVectorBoolOp,
  svgTextToContours,
  validateContours,
} from '../lib/vectorBoolean';
import { runVectorBoolean } from '../lib/csg';
import { saveBlobFile } from '../lib/platformFeatures';
import type { ParticleConfig } from '../types';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

/**
 * One age curve (Phase U): an enable toggle, five sliders at the
 * fixed age positions t = 0 / .25 / .5 / .75 / 1, and preset chips
 * that write a whole point list at once. Deliberately NOT a curve
 * editor — the five sliders are the whole surface.
 */
export const AgeCurveBlock: React.FC<{
  title: string;
  enabled: boolean;
  points: number[];
  onToggle: (v: boolean) => void;
  onPoints: (v: number[]) => void;
}> = ({ title, enabled, points, onToggle, onPoints }) => {
  const clean = normalizeAgeCurvePoints(points);
  const labels = ['t=0', 't=0.25', 't=0.5', 't=0.75', 't=1'];
  return (
    <div className="mb-3">
      <Toggle label={title} value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={onToggle} />
      {enabled && (
        <>
          <div className="mb-2 mt-1 flex flex-wrap gap-1.5">
            {AGE_CURVE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => onPoints([...preset.points])}
                className="rounded-full border border-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {clean.map((value, i) => (
            <Slider
              key={labels[i]}
              label={labels[i]}
              value={value}
              min={0}
              max={AGE_CURVE_POINT_MAX}
              step={0.05}
              onChange={(v) => {
                const next = [...clean];
                next[i] = v;
                onPoints(next);
              }}
            />
          ))}
        </>
      )}
    </div>
  );
};

/** Load an image file element from a picked file (shared helper). */
async function loadPickedImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image load failed'));
      el.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render a numeric luma grid as a grayscale PNG data URL
 *  (Phase BF: the Boolean-combined mask's image side, so the
 *  draw clip follows the combined grid exactly like an imported
 *  mask image — the dual representation the supplies all use). */
function lumaMapDataUrl(map: ArrayLike<number>, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = Math.round(Math.min(1, Math.max(0, map[i] || 0)) * 255);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Downscale an image to <= maxPx and return a JPEG data URL. */

export function downscaledDataUrl(img: HTMLImageElement, maxPx: number): string {
  const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.87);
}

/**
 * One per-property Layer Map source (Phase X): same import flow
 * as the common gradient image (downscaled data URL in config),
 * with an explicit "未設定 = 共通マップ" state instead of a
 * silent fallback.
 */

const DERIVED_KIND_LABELS: Record<TerrainDerivedMapKind, string> = {
  normal: '法線',
  slope: '勾配',
  curvature: '曲率',
};

const AF_SOURCE_KIND_LABELS: Record<AfMapSourceKind, string> = {
  text: '文字',
  path: 'パス',
  edge: 'エッジ',
  noise: 'ノイズ場（静的スライス）',
};

const AF_SOURCE_KINDS: readonly AfMapSourceKind[] = ['text', 'path', 'edge', 'noise'];

/** Internal supply picker (Phase AF): the current text, the
 *  authored SVG path and the post chain's edge field as map /
 *  mask sources. Like the terrain derived supply, choosing one
 *  stores a sentinel that resolves live — the assignment tracks
 *  the text / path / frame instead of freezing a picture. The
 *  edge supply reads the previous frame's field (one frame of
 *  lag) and works whether or not the edge display is on. */

const AfSourceButtons: React.FC<{
  source: string;
  onPick: (kind: AfMapSourceKind) => void;
  /** Phase AF2: fill variants of the path supply. Optional —
   *  blocks that cannot capture a numeric grid for the fill
   *  still offer them through the plain source string. */
  onPickFill?: (mode: 'evenodd' | 'nonzero') => void;
}> = ({ source, onPick, onPickFill }) => (
  <div className="mt-2 flex flex-wrap items-center gap-1.5">
    <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">内部供給</span>
    {AF_SOURCE_KINDS.map((kind) => {
      const active = parseAfMapSource(source) === kind
        && (kind !== 'path' || parsePathRasterFillMode(source) === 'none');
      return (
        <button
          key={kind}
          onClick={() => onPick(kind)}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest transition-colors ${active ? 'border-white/70 bg-white/20 text-white' : 'border-white/15 text-white/60 hover:bg-white/10'}`}
        >
          {AF_SOURCE_KIND_LABELS[kind]}
        </button>
      );
    })}
    {onPickFill && (
      <>
        {(['evenodd', 'nonzero'] as const).map((mode) => {
          const fillSource = mode === 'evenodd' ? PATH_RASTER_FILL_EVENODD_SOURCE : PATH_RASTER_FILL_NONZERO_SOURCE;
          const active = source === fillSource;
          return (
            <button
              key={mode}
              onClick={() => onPickFill(mode)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest transition-colors ${active ? 'border-white/70 bg-white/20 text-white' : 'border-white/15 text-white/60 hover:bg-white/10'}`}
            >
              {mode === 'evenodd' ? 'パス塗り（偶奇）' : 'パス塗り（非ゼロ）'}
            </button>
          );
        })}
      </>
    )}
  </div>
);

/** Small picker row for the terrain derived maps (Phase AE):
 *  choosing one stores the sentinel source, which resolves to
 *  the live bake — the assignment tracks the terrain parameters
 *  instead of freezing a picture. */

const DerivedSourceButtons: React.FC<{
  source: string;
  onPick: (kind: TerrainDerivedMapKind) => void;
}> = ({ source, onPick }) => (
  <div className="mt-2 flex flex-wrap items-center gap-1.5">
    <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">地形派生</span>
    {TERRAIN_DERIVED_KINDS.map((kind) => {
      const active = parseTerrainDerivedSource(source) === kind;
      return (
        <button
          key={kind}
          onClick={() => onPick(kind)}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest transition-colors ${active ? 'border-white/70 bg-white/20 text-white' : 'border-white/15 text-white/60 hover:bg-white/10'}`}
        >
          {DERIVED_KIND_LABELS[kind]}
        </button>
      );
    })}
  </div>
);

/**
 * Terrain derived maps (Phase AE): previews + PNG export of the
 * normal / slope / curvature bakes of the CURRENT field, and the
 * slope force that runs particles downhill along the same bake.
 * The previews are regenerated from the pure bake whenever the
 * field parameters change (deterministic — same params, same
 * picture, bit for bit).
 */

export const TerrainDerivedMapsBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const amp = config.gpgpuMorphTerrainAmplitude;
  const freq = config.gpgpuMorphTerrainFrequency;
  const octaves = config.gpgpuMorphTerrainOctaves;
  const terrainSeed = config.gpgpuMorphTerrainSeed;
  const seed = config.gpgpuSeed;
  const previews = React.useMemo(() => {
    const terrain = { amplitude: amp, frequency: freq, octaves, seed: terrainSeed };
    const out = {} as Record<TerrainDerivedMapKind, string>;
    for (const kind of TERRAIN_DERIVED_KINDS) {
      const canvas = getTerrainDerivedMapCanvas(kind, terrain, seed);
      out[kind] = canvas ? canvas.toDataURL('image/png') : '';
    }
    return out;
  }, [amp, freq, octaves, terrainSeed, seed]);
  const exportPng = (kind: TerrainDerivedMapKind) => {
    const canvas = getTerrainDerivedMapCanvas(kind, terrainOptionsFromConfig(config), seed);
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) void saveBlobFile(blob, `kalokagathia-terrain-${kind}.png`, { description: 'PNG image', accept: { 'image/png': ['.png'] } });
    }, 'image/png');
  };
  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Derived Maps （派生マップ・Phase AE）</div>
      <div className="flex flex-wrap gap-2">
        {TERRAIN_DERIVED_KINDS.map((kind) => (
          <div key={kind} className="flex flex-col items-center gap-1">
            {previews[kind]
              ? <img src={previews[kind]} alt="" className="h-16 w-16 rounded border border-white/20 object-cover" />
              : <div className="h-16 w-16 rounded border border-white/20" />}
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/50">{DERIVED_KIND_LABELS[kind]} {kind}</div>
            <button
              onClick={() => exportPng(kind)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              PNG 書き出し
            </button>
          </div>
        ))}
      </div>
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Slope Force （勾配フォース）</div>
      <Toggle label="Slope Force （斜面を流れる）" value={config.gpgpuSlopeForceEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuSlopeForceEnabled', v)} />
      {config.gpgpuSlopeForceEnabled && (
        <Slider label="Strength （強さ）" value={config.gpgpuSlopeForceStrength} min={0} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuSlopeForceStrength', v)} />
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        派生マップは高度場から決定的に生成されます（同じ地形パラメータではビット一致）。勾配はこの地形の最大斜度で、曲率は平坦が中グレーになるよう正規化しています。各マップは Layer Maps とラスタマスクのソース選択にある「地形派生」ボタンからも割り当てでき、そちらは画像ではなく地形パラメータに追随する内部供給です。勾配フォースは地形メッシュ有効・平面モードのときだけ効きます（トンネルでは無力）。
      </div>
    </div>
  );
};

export const MapSourceBlock: React.FC<{
  title: string;
  source: string;
  onSource: (v: string) => void;
  config: ParticleConfig;
  updateConfig: GlobalDisplayEffectsSharedProps['updateConfig'];
}> = ({ title, source, onSource, config, updateConfig }) => {
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadPickedImage(file);
      const url = downscaledDataUrl(img, 256);
      if (url) onSource(url);
    } catch {
      // Unreadable file: keep the previous source untouched.
    }
  };
  return (
    <div className="mb-2 mt-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/50">{title}</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            {!isTerrainDerivedSource(source) && !isAfMapSource(source) && <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />}
            <button
              onClick={() => onSource('')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <DerivedSourceButtons source={source} onPick={(kind) => onSource(terrainDerivedSource(kind))} />
      <AfSourceButtons
        source={source}
        onPick={(kind) => onSource(afMapSource(kind))}
        onPickFill={(mode) => onSource(mode === 'evenodd' ? PATH_RASTER_FILL_EVENODD_SOURCE : PATH_RASTER_FILL_NONZERO_SOURCE)}
      />
      {parseAfMapSource(source) === 'path' && (
        <Slider label="Path Stroke Width （パスの線幅）" value={config.gpgpuPathRasterStrokeWidth} min={0.005} max={0.2} step={0.005} onChange={(v) => updateConfig('gpgpuPathRasterStrokeWidth', v)} />
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {isTerrainDerivedSource(source)
          ? `地形派生マップ（${DERIVED_KIND_LABELS[parseTerrainDerivedSource(source) ?? 'slope']}）を設定済み: 地形パラメータに追随する内部供給です。`
          : isAfMapSource(source)
          ? parseAfMapSource(source) === 'text'
            ? '文字ラスタを設定済み: 現在のテキスト設定（レイヤー2 TextMap）に追随する内部供給です。'
            : parseAfMapSource(source) === 'path'
              ? parsePathRasterFillMode(source) !== 'none'
                ? `パス塗り（${parsePathRasterFillMode(source) === 'evenodd' ? '偶奇' : '非ゼロ'}ルール）を設定済み: SVG パスの閉領域を塗った内部供給です。線幅は輪郭の太さとして効きます。`
                : 'パスラスタを設定済み: 現在の SVG パス（モーフの SVG ソース）に追随する内部供給です。SVG が未設定の間は効きません。'
              : parseAfMapSource(source) === 'noise'
              ? 'ノイズ場（静的スライス）を設定済み: ノイズ場マップの定義（Scale／Kind／Octaves）で決まる静止した断面を供給する内部供給です。式ではなく場の定義キーで形が決まり、Evolve（時間発展）は供給には効きません。'
              : 'エッジ出力を設定済み: ポストの輪郭（前フレームのエッジ場）を供給する内部供給です。エッジ表示の ON/OFF とは独立に働きます。'
          : source ? '専用画像を設定済み: このプロパティは共通マップではなくこの画像を使います。' : '未設定: このプロパティは共通マップを使います。'}
      </div>
    </div>
  );
};

/**
 * Raster mask source (Phase X): importing an image stores both
 * the data URL (for the draw shader's fragment clip and the
 * preview) and the numeric luma map captured at <=128px (for the
 * deterministic bake and media placement), following the
 * layer2MediaLumaMap precedent. Clearing removes both.
 */

export const MaskSourceBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMaskSource;
  // Vector Boolean (Phase 17 stage 2): transient run state only;
  // the durable outputs live in the gpgpuVectorBool* keys.
  const [vectorBusy, setVectorBusy] = React.useState(false);
  const [vectorStatus, setVectorStatus] = React.useState('');
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadPickedImage(file);
      const url = downscaledDataUrl(img, 256);
      if (!url) return;
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const scale = Math.min(1, 128 / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      const map = extractLumaMap(img, w, h);
      updateConfig('gpgpuMaskSource', url);
      updateConfig('gpgpuMaskMap', map);
      updateConfig('gpgpuMaskMapWidth', w);
      updateConfig('gpgpuMaskMapHeight', h);
    } catch {
      // Unreadable file: keep the previous mask untouched.
    }
  };
  const clear = () => {
    updateConfig('gpgpuMaskSource', '');
    updateConfig('gpgpuMaskMap', []);
    updateConfig('gpgpuMaskMapWidth', 0);
    updateConfig('gpgpuMaskMapHeight', 0);
  };
  // Terrain derived supply (Phase AE): the sentinel source makes
  // the draw clip / kill mask follow the live terrain bake; the
  // numeric luma map is captured from the same bake (128px, the
  // image-import convention) for the bake / placement consumers.
  const applyDerived = (kind: TerrainDerivedMapKind) => {
    const canvas = getTerrainDerivedMapCanvas(kind, terrainOptionsFromConfig(config), config.gpgpuSeed);
    updateConfig('gpgpuMaskSource', terrainDerivedSource(kind));
    if (canvas) {
      const map = extractLumaMap(canvas, 128, 128);
      updateConfig('gpgpuMaskMap', map);
      updateConfig('gpgpuMaskMapWidth', 128);
      updateConfig('gpgpuMaskMapHeight', 128);
    }
  };
  // Internal supply (Phase AF): text and path capture their
  // numeric luma grid at assignment time (128px, the image-import
  // convention) for the bake / placement consumers, exactly like
  // the terrain derived supply; the GPU consumers (draw clip /
  // kill / Layer Maps) resolve the live sentinel texture. The
  // edge field is a live frame product and has no numeric grid:
  // bake / placement consumers keep their legacy behaviour while
  // the GPU consumers sample the captured field. The noise field
  // (Phase BJ) is a pure function of its definition keys, so it
  // captures its static slice the same way text and path do.
  const applyAf = (kind: AfMapSourceKind) => {
    updateConfig('gpgpuMaskSource', afMapSource(kind));
    if (kind === 'noise') {
      const luma = getNoiseFieldLuma(config, 128);
      updateConfig('gpgpuMaskMap', Array.from(luma));
      updateConfig('gpgpuMaskMapWidth', 128);
      updateConfig('gpgpuMaskMapHeight', 128);
    } else if (kind === 'text') {
      const map = extractTextLumaMap(
        config.layer2TextMapText,
        128,
        128,
        config.layer2TextMapFontFamily,
        config.layer2TextMapWeight,
        config.layer2TextMapSize,
        config.layer2TextMapPadding,
        config.layer2TextMapInvert,
        textLayoutOptionsFromTextMap(config),
      );
      updateConfig('gpgpuMaskMap', map);
      updateConfig('gpgpuMaskMapWidth', 128);
      updateConfig('gpgpuMaskMapHeight', 128);
    } else if (kind === 'path') {
      const luma = getPathRasterLuma(config, 128);
      if (luma) {
        updateConfig('gpgpuMaskMap', Array.from(luma));
        updateConfig('gpgpuMaskMapWidth', 128);
        updateConfig('gpgpuMaskMapHeight', 128);
      } else {
        updateConfig('gpgpuMaskMap', []);
        updateConfig('gpgpuMaskMapWidth', 0);
        updateConfig('gpgpuMaskMapHeight', 0);
      }
    } else {
      updateConfig('gpgpuMaskMap', []);
      updateConfig('gpgpuMaskMapWidth', 0);
      updateConfig('gpgpuMaskMapHeight', 0);
    }
  };
  // Path fill supply (Phase AF2): same capture convention as the
  // stroke raster, with the fill mode carried by the source
  // string and the numeric grid rasterised with that fill rule.
  const applyAfFill = (mode: 'evenodd' | 'nonzero') => {
    updateConfig('gpgpuMaskSource', mode === 'evenodd' ? PATH_RASTER_FILL_EVENODD_SOURCE : PATH_RASTER_FILL_NONZERO_SOURCE);
    const luma = getPathRasterLuma(config, 128, mode);
    if (luma) {
      updateConfig('gpgpuMaskMap', Array.from(luma));
      updateConfig('gpgpuMaskMapWidth', 128);
      updateConfig('gpgpuMaskMapHeight', 128);
    } else {
      updateConfig('gpgpuMaskMap', []);
      updateConfig('gpgpuMaskMapWidth', 0);
      updateConfig('gpgpuMaskMapHeight', 0);
    }
  };
  // Boolean operand capture (Phase BF): the same capture paths
  // as the mask supplies above, writing the operand grid (B)
  // instead of the mask itself. Only the numeric grid is stored
  // — B has no live source, it is a frozen capture by design.
  const setOperand = (map: number[], width: number, height: number) => {
    updateConfig('gpgpuMaskBoolOperandMap', map);
    updateConfig('gpgpuMaskBoolOperandWidth', width);
    updateConfig('gpgpuMaskBoolOperandHeight', height);
  };
  const clearOperand = () => setOperand([], 0, 0);
  const handleOperandFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadPickedImage(file);
      const iw = img.naturalWidth || 1;
      const ih = img.naturalHeight || 1;
      const scale = Math.min(1, 128 / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      setOperand(extractLumaMap(img, w, h), w, h);
    } catch {
      // Unreadable file: keep the previous operand untouched.
    }
  };
  const captureOperandDerived = (kind: TerrainDerivedMapKind) => {
    const canvas = getTerrainDerivedMapCanvas(kind, terrainOptionsFromConfig(config), config.gpgpuSeed);
    if (canvas) setOperand(extractLumaMap(canvas, 128, 128), 128, 128);
  };
  const captureOperandText = () => {
    setOperand(
      extractTextLumaMap(
        config.layer2TextMapText,
        128,
        128,
        config.layer2TextMapFontFamily,
        config.layer2TextMapWeight,
        config.layer2TextMapSize,
        config.layer2TextMapPadding,
        config.layer2TextMapInvert,
        textLayoutOptionsFromTextMap(config),
      ),
      128,
      128,
    );
  };
  const captureOperandPathFill = (mode: 'evenodd' | 'nonzero') => {
    const luma = getPathRasterLuma(config, 128, mode);
    if (luma) setOperand(Array.from(luma), 128, 128);
  };
  // Boolean composition (Phase BF): combine A (the current mask
  // map) with the stored operand B under the selected op and
  // write the result back as the mask — numeric grid plus a
  // rendered data URL, the same dual representation the image
  // import stores, so the GPU clip follows the combined grid.
  // B is kept, so another op can be composed onto the result.
  const applyBool = () => {
    const combined = combineLumaMaps(
      config.gpgpuMaskMap,
      config.gpgpuMaskMapWidth,
      config.gpgpuMaskMapHeight,
      config.gpgpuMaskBoolOperandMap,
      config.gpgpuMaskBoolOperandWidth,
      config.gpgpuMaskBoolOperandHeight,
      normalizeMaskBoolOp(config.gpgpuMaskBoolOp),
    );
    if (!combined) return;
    updateConfig('gpgpuMaskMap', Array.from(combined));
    updateConfig('gpgpuMaskSource', lumaMapDataUrl(combined, config.gpgpuMaskMapWidth, config.gpgpuMaskMapHeight));
  };
  // Vector Boolean composition (Phase 17 stage 2): the geometric
  // counterpart of the raster Boolean above. A is the morph SVG
  // source, B is the vector-B SVG text; both are parsed into
  // contours in the same normalised frame, validated on this
  // thread, and composed in the CSG worker (CrossSection) only
  // on this button press. A result that fails validation is
  // reported and never written to the result key.
  const applyVectorBool = async () => {
    if (vectorBusy) return;
    const aContours = svgTextToContours(config.gpgpuMorphSvgSource);
    if (!aContours) {
      setVectorStatus('A（モーフ SVG ソース）に閉じた図形がありません。先に SVG を設定してください。');
      return;
    }
    const bContours = svgTextToContours(config.gpgpuVectorBoolSourceB);
    if (!bContours) {
      setVectorStatus('B の SVG テキストに閉じた図形がありません。');
      return;
    }
    const va = validateContours(aContours, 'A');
    if (!va.ok) {
      setVectorStatus(va.reason);
      return;
    }
    const vb = validateContours(bContours, 'B');
    if (!vb.ok) {
      setVectorStatus(vb.reason);
      return;
    }
    setVectorBusy(true);
    setVectorStatus('合成中…');
    try {
      const result = await runVectorBoolean(aContours, bContours, normalizeVectorBoolOp(config.gpgpuVectorBoolOp));
      if (result.contours.length === 0) {
        updateConfig('gpgpuVectorBoolResultSvg', '');
        setVectorStatus('合成結果は空です（面積 0）。結果 SVG はクリアしました。');
        return;
      }
      updateConfig('gpgpuVectorBoolResultSvg', contoursToSvgText(result.contours));
      setVectorStatus(
        `合成しました: 面積 ${result.area.toFixed(4)}、島 ${result.islandCount}、穴 ${result.holeCount}、輪郭 ${result.contours.length}。`,
      );
    } catch (e) {
      setVectorStatus(e instanceof Error ? e.message : 'ベクタ合成に失敗しました。');
    } finally {
      setVectorBusy(false);
    }
  };
  // Take the stored vector result into the mask: the result
  // contours become a PathGeometry and are rasterised with the
  // even-odd fill (holes stay holes) through the same supply
  // function the path fill uses, then stored like applyBool.
  const takeVectorResultIntoMask = () => {
    const contours = svgTextToContours(config.gpgpuVectorBoolResultSvg);
    if (!contours) {
      setVectorStatus('取り込めるベクタ合成結果がありません。先に合成してください。');
      return;
    }
    const geom = contoursToPathGeometry(contours);
    if (!geom) {
      setVectorStatus('ベクタ合成結果をパスへ変換できませんでした。');
      return;
    }
    const luma = rasterizePathGeometryLuma(geom, 128, pathRasterStrokeRadius(config), 'evenodd');
    updateConfig('gpgpuMaskMap', Array.from(luma));
    updateConfig('gpgpuMaskMapWidth', 128);
    updateConfig('gpgpuMaskMapHeight', 128);
    updateConfig('gpgpuMaskSource', lumaMapDataUrl(luma, 128, 128));
    setVectorStatus('ベクタ合成結果をマスクに取り込みました（128×128、偶奇ルールで塗り）。');
  };
  return (
    <div className="mb-2 mt-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          マスク画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {(source || config.gpgpuMaskMap.length > 0) && (
          <>
            {source && !isTerrainDerivedSource(source) && !isAfMapSource(source) && <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />}
            <button
              onClick={clear}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <DerivedSourceButtons source={source} onPick={applyDerived} />
      <AfSourceButtons source={source} onPick={applyAf} onPickFill={applyAfFill} />
      {parseAfMapSource(source) === 'path' && (
        <Slider label="Path Stroke Width （パスの線幅）" value={config.gpgpuPathRasterStrokeWidth} min={0.005} max={0.2} step={0.005} onChange={(v) => updateConfig('gpgpuPathRasterStrokeWidth', v)} />
      )}
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {isTerrainDerivedSource(source)
          ? `地形派生マップ（${DERIVED_KIND_LABELS[parseTerrainDerivedSource(source) ?? 'slope']}）をマスクに供給中: 描画 clip と Kill は地形パラメータに追随し、輝度マップ（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}）はベイク用に選択時点の地形から抽出済みです。`
          : isAfMapSource(source)
          ? parseAfMapSource(source) === 'text'
            ? `文字ラスタをマスクに供給中: 描画 clip と Kill は現在のテキスト設定に追随し、輝度マップ（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}）はベイク用に選択時点の文字から抽出済みです。文字を変えたら選び直してください。`
            : parseAfMapSource(source) === 'path'
              ? parsePathRasterFillMode(source) !== 'none'
                ? config.gpgpuMaskMap.length > 0
                  ? `パス塗り（${parsePathRasterFillMode(source) === 'evenodd' ? '偶奇' : '非ゼロ'}ルール）をマスクに供給中: 描画 clip と Kill は現在の SVG パスの閉領域に追随し、輝度マップ（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}）はベイク用に選択時点のパスから抽出済みです。パスを変えたら選び直してください。`
                  : 'パス塗りをマスクに供給中: ただし SVG ソースが未設定（または図形なし）のため、パスが設定されるまでマスクは効きません。'
                : config.gpgpuMaskMap.length > 0
                ? `パスラスタをマスクに供給中: 描画 clip と Kill は現在の SVG パスに追随し、輝度マップ（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}）はベイク用に選択時点のパスから抽出済みです。パスを変えたら選び直してください。`
                : 'パスラスタをマスクに供給中: ただし SVG ソースが未設定（または図形なし）のため、パスが設定されるまでマスクは効きません。'
              : parseAfMapSource(source) === 'noise'
              ? `ノイズ場（静的スライス）をマスクに供給中: 描画 clip と Kill はノイズ場マップの定義（Scale／Kind／Octaves）に追随し、輝度マップ（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}）はベイク用に選択時点の場から抽出済みです。場の定義を変えたら選び直してください。供給は静止した断面で、Evolve は効きません。`
              : 'エッジ出力をマスクに供給中: 描画 clip と Kill はポストの輪郭（前フレームのエッジ場、閾値はエッジ表示と共用）に追随します。生きたフレーム由来のため輝度マップは無く、ベイクとメディア配置には効きません。エッジ表示の ON/OFF とは独立です。'
          : source
          ? `マスク設定済み（輝度マップ ${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight} を取り込み時に抽出）。白い領域が残り、黒い領域が間引かれます。`
          : config.gpgpuMaskMap.length > 0
            ? `輝度マップのみ設定済み（${config.gpgpuMaskMapWidth}×${config.gpgpuMaskMapHeight}、プリセット由来）。ベイクとメディア配置には効きますが、描画時のフラグメント clip には画像本体が必要です。`
            : 'マスク画像が未設定のため、Mode を切り替えてもマスクは効きません。'}
      </div>
      {/* Boolean composition (Phase BF): soft Boolean ops over
          the captured luminance grids — A is the current mask,
          B is the stored operand. Capture-time, like every
          supply above; nothing is recomputed per frame. */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/50">Boolean 合成（マスク同士の和・差・積・排他 — Phase BF）</div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
            B の画像を開く
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void handleOperandFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <button
            onClick={captureOperandText}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            現在のテキストを B に
          </button>
          <button
            onClick={() => captureOperandPathFill('evenodd')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            パス塗り（偶奇）を B に
          </button>
          <button
            onClick={() => captureOperandPathFill('nonzero')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            パス塗り（非ゼロ）を B に
          </button>
          {config.gpgpuMaskBoolOperandMap.length > 0 && (
            <button
              onClick={clearOperand}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              B をクリア
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-bold uppercase tracking-widest text-white/40">地形を B に</span>
          {TERRAIN_DERIVED_KINDS.map((kind) => (
            <button
              key={kind}
              onClick={() => captureOperandDerived(kind)}
              className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              {DERIVED_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={config.gpgpuMaskBoolOp}
            onChange={(e) => updateConfig('gpgpuMaskBoolOp', normalizeMaskBoolOp(e.target.value))}
            className="cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="union">Union（和）</option>
            <option value="difference">Difference（差 A−B）</option>
            <option value="intersection">Intersection（積）</option>
            <option value="xor">XOR（排他）</option>
          </select>
          <button
            onClick={applyBool}
            disabled={config.gpgpuMaskMap.length === 0}
            className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            合成してマスクに適用
          </button>
        </div>
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          {`合成は取り込み方式です。A（現在のマスク）は合成結果に置き換わり、B は保持されるので演算を変えて再合成できます。演算は輝度のソフト Boolean（二値では通常の真理表と一致）で、B の寸法が A と違う場合は A に合わせてリサンプルします。`
            + (config.gpgpuMaskBoolOperandMap.length > 0
              ? ` B は ${config.gpgpuMaskBoolOperandWidth}×${config.gpgpuMaskBoolOperandHeight} を取り込み済み。`
              : ' B は未取り込みのため空集合として合成します（union / difference / xor は A のまま、intersection は全域 0）。')}
        </div>
      </div>
      {/* Vector Boolean composition (Phase 17 stage 2): closed
          vector shapes composed geometrically (CrossSection in
          the CSG worker), not on a luminance grid — contours
          stay smooth and holes stay holes. A is the morph SVG
          source; B is the SVG text below. */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-white/50">ベクタ合成（閉図形同士の Boolean — Phase 17）</div>
        <div className="text-[9px] leading-relaxed text-white/40">
          {`A はモーフ SVG ソース（${config.gpgpuMorphSvgSource ? '設定済み' : '未設定'}）。A・B とも閉じた図形だけが対象で、それぞれ自身の枠で正規化されてから合成されます。`}
        </div>
        <textarea
          value={config.gpgpuVectorBoolSourceB}
          onChange={(e) => updateConfig('gpgpuVectorBoolSourceB', e.target.value)}
          placeholder="B の SVG テキスト（<svg>…</svg> または path の d 文字列）"
          rows={3}
          className="mt-2 w-full rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[10px] leading-relaxed text-white/90 outline-none focus:border-white/40"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={config.gpgpuVectorBoolOp}
            onChange={(e) => updateConfig('gpgpuVectorBoolOp', normalizeVectorBoolOp(e.target.value))}
            className="cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="union">Union（和）</option>
            <option value="difference">Difference（差 A−B）</option>
            <option value="intersection">Intersection（積）</option>
            <option value="xor">XOR（排他）</option>
          </select>
          <button
            onClick={() => void applyVectorBool()}
            disabled={vectorBusy}
            className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ベクタ合成する
          </button>
          <button
            onClick={takeVectorResultIntoMask}
            disabled={vectorBusy || !config.gpgpuVectorBoolResultSvg}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            結果をマスクに取り込む
          </button>
        </div>
        {vectorStatus && (
          <div className="mt-1 text-[9px] leading-relaxed text-white/50">{vectorStatus}</div>
        )}
        <div className="mt-1 text-[9px] leading-relaxed text-white/40">
          合成はボタン押下時のみ CSG ワーカーで実行され、結果は SVG として保持されます（未使用時はワーカーも WASM も読みません）。検証（自己交差・面積）を通らない結果は理由を表示し、結果 SVG には書きません。
        </div>
      </div>
    </div>
  );
};

/**
 * Image source controls for the gradient 'image' driver (Phase A).
 * The picked image is downscaled to <=256px and stored in the config
 * as a data URL (gpgpuGradImageSource), so — like the SVG morph
 * source — it persists with presets / projects. The point shader
 * samples the image by particle position (world XY over the bounce
 * sphere). While no image is set the driver falls back to the life
 * gradient; the status line below states that explicitly instead of
 * falling back silently.
 */

export const GradImageBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuGradImageSource;
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image load failed'));
        el.src = url;
      });
      const scale = Math.min(1, 256 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      updateConfig('gpgpuGradImageSource', canvas.toDataURL('image/jpeg', 0.87));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          画像を開く
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        {source && (
          <>
            <img src={source} alt="" className="h-8 w-8 rounded border border-white/20 object-cover" />
            <button
              onClick={() => updateConfig('gpgpuGradImageSource', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? '画像を設定済み: 粒子は自分の位置（XY 平面、バウンス範囲全体に画像を広げる）で画像の色を拾います。画像は 256px 以下に縮小され、config に保持されます。'
          : '画像が未設定のため、いまは Life グラデーションで代替しています。画像を設定すると、粒子が位置ごとに画像の色を拾うようになります。'}
      </div>
    </div>
  );
};

/**
 * SVG import controls for the morph 'svg' target (Pro-2). The SVG
 * source text is stored in the config itself (gpgpuMorphSvgSource),
 * so — like the TextMap text — it survives reloads with the project
 * and travels with presets. The point cloud is re-sampled from the
 * source at bake time; the status line below runs the same sampler
 * so what it reports is what the bake will use.
 */
