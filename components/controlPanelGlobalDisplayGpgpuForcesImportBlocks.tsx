import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import { SAMPLE_SVG_STAR, sampleSvgPointCloud } from '../lib/svgMorph';
import { SAMPLE_OBJ_SPHERE, SAMPLE_OBJ_TORUS_KNOT, parseObjGeometry, isObjClosedMesh } from '../lib/objMorph';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';

export const MorphSvgImportBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphSvgSource;
  const cloud = React.useMemo(() => (source ? sampleSvgPointCloud(source) : null), [source]);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    updateConfig('gpgpuMorphSvgSource', text.slice(0, 200_000));
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          SVG ファイルを開く
          <input
            type="file"
            accept=".svg,image/svg+xml,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => updateConfig('gpgpuMorphSvgSource', SAMPLE_SVG_STAR)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (星)
        </button>
        {source && (
          <button
            onClick={() => updateConfig('gpgpuMorphSvgSource', '')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            クリア
          </button>
        )}
      </div>
      <textarea
        value={source}
        onChange={(event) => updateConfig('gpgpuMorphSvgSource', event.target.value.slice(0, 200_000))}
        spellCheck={false}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
        placeholder={'<svg viewBox="0 0 100 100"><path d="M ..."/></svg> を貼り付け'}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? cloud
            ? `輪郭を ${cloud.length / 2} 点にサンプリングしました（弧長均等）。パス基本コマンド M/L/H/V/C/S/Q/T/A/Z と基本図形に対応。塗りつぶしは輪郭として扱います。`
            : '読み取れる図形がありません（path 等の図形要素が必要です）。'
          : 'SVG を取り込むと、その輪郭点群へ粒子が集まります（ロゴ・リビール用）。ソースは config に保持され、再読み込みでも消えません。'}
      </div>
    </div>
  );
};

/**
 * OBJ import controls for the morph 'obj' target (Phase J). Like the
 * SVG source, the OBJ source text is stored in the config itself
 * (gpgpuMorphObjSource), so it survives reloads with the project and
 * travels with presets. The surface cloud is re-sampled from the
 * source at bake time; the status line below runs the same parser so
 * what it reports is what the bake will use. When the source is empty
 * or unusable the bake falls back to a sphere shell — the status line
 * states that explicitly instead of failing silently.
 */

export const MorphObjImportBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphObjSource;
  const geometry = React.useMemo(() => (source ? parseObjGeometry(source) : null), [source]);
  const sampleMode = config.gpgpuMorphObjSampleMode;
  // Volume needs a closed mesh to define an interior; the sampler
  // falls back to surface otherwise, and this block says so up front
  // (same verdict function the sampler itself uses).
  const volumeFallsBack = sampleMode === 'volume' && geometry !== null && !isObjClosedMesh(geometry);
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    updateConfig('gpgpuMorphObjSource', text.slice(0, 200_000));
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-2 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10">
          OBJ ファイルを開く
          <input
            type="file"
            accept=".obj,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button
          onClick={() => updateConfig('gpgpuMorphObjSource', SAMPLE_OBJ_SPHERE)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (球)
        </button>
        <button
          onClick={() => updateConfig('gpgpuMorphObjSource', SAMPLE_OBJ_TORUS_KNOT)}
          className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/10"
        >
          サンプル (結び目)
        </button>
        {source && (
          <button
            onClick={() => updateConfig('gpgpuMorphObjSource', '')}
            className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
          >
            クリア
          </button>
        )}
      </div>
      <textarea
        value={source}
        onChange={(event) => updateConfig('gpgpuMorphObjSource', event.target.value.slice(0, 200_000))}
        spellCheck={false}
        rows={4}
        className="w-full rounded border border-white/15 bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/85 outline-none focus:border-white/40"
        placeholder={'v 0 0 0 / f 1 2 3 ... の OBJ テキストを貼り付け'}
      />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? geometry
            ? `頂点 ${geometry.vertexCount}・面 ${geometry.faceCount}（三角形 ${geometry.triangleCount}）を読み取りました。8,192 点にサンプリングします（決定的）。`
            : '読み取れる頂点/面がありません（v と f の行が必要です）。現在は球シェルで代替しています。'
          : 'OBJ を取り込むと、その点群へ粒子が集まります（3Dモデル・ロゴ立体用）。未設定の間は球シェルで代替しています。ソースは config に保持され、再読み込みでも消えません。'}
      </div>
      <div className="mb-1 mt-3 text-[9px] uppercase tracking-widest opacity-60">Sample Mode （サンプリング方式）</div>
      <select
        value={sampleMode}
        onChange={(e) => updateConfig('gpgpuMorphObjSampleMode', e.target.value as typeof config.gpgpuMorphObjSampleMode)}
        className="mb-2 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
      >
        <option value="surface">Surface （表面・面積重み）</option>
        <option value="vertices">Vertices （頂点そのもの）</option>
        <option value="volume">Volume （内部を充填・閉メッシュのみ）</option>
      </select>
      <Slider label="Normal Speed （法線初速）" value={config.gpgpuMorphObjNormalSpeed} min={0} max={80} step={1} onChange={(v) => updateConfig('gpgpuMorphObjNormalSpeed', v)} />
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {sampleMode === 'vertices'
          ? '頂点そのものに粒子を置きます（疎なモデルでは頂点の粗さがそのまま見えます）。'
          : sampleMode === 'volume'
            ? volumeFallsBack
              ? 'このメッシュは閉じていないため（内部を定義できません）、Volume は Surface にフォールバックしています。'
              : '閉メッシュの内部を一様に充填します（中身のある立体になります）。'
            : '表面を面積重みで一様にサンプリングします（Phase J からの従来方式）。'}
        {' '}法線初速は、配置時（開始時とリスポーン時）にサンプル法線の方向へ粒子を放つ初速です。常時かかる力ではないので、膨らんだ粒子はモーフの引力で形に戻ります。0 で無効です。
      </div>
    </div>
  );
};

/**
 * Dedicated terrain texture image controls (Phase V). Same
 * placement manners as the sprite image block: the picked image is
 * downscaled to <=256px and stored in the config as a data URL
 * (gpgpuTerrainTextureImage), so it persists with presets. While a
 * dedicated image is set it takes precedence over the Horizon
 * background image; while it is empty the background image is used
 * exactly as before Phase V — the status line says which source is
 * live instead of switching silently.
 */

export const TerrainTextureImageBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuTerrainTextureImage;
  const fallback = config.backgroundImageSource;
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
      updateConfig('gpgpuTerrainTextureImage', canvas.toDataURL('image/png'));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Terrain Texture Image（地形専用画像）</div>
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
              onClick={() => updateConfig('gpgpuTerrainTextureImage', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? '地形専用画像を設定済み: 背景画像より優先して面の map になります。画像は 256px 以下に縮小され、config に保持されます。'
          : fallback
            ? '専用画像は未設定のため、Horizon 背景画像を流用しています。専用画像を設定するとそちらが優先されます。'
            : '専用画像も背景画像も未設定のため、設定されるまでは単色陰影で表示します。'}
      </div>
    </div>
  );
};

/**
 * OBJ Mesh controls (Phase V): the polygon face of the imported
 * OBJ. The data source is the morph import's gpgpuMorphObjSource —
 * shared, never duplicated — so this block carries only the mesh
 * system's own keys. With no usable source the scene component
 * draws nothing; the status line here says so explicitly, using
 * the same parser verdict as the renderer.
 */

export const ObjMeshBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuMorphObjSource;
  const geometry = React.useMemo(() => (source ? parseObjGeometry(source) : null), [source]);
  const enabled = config.gpgpuObjMeshEnabled;
  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="OBJ Mesh （OBJメッシュ描画）" value={enabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuObjMeshEnabled', v)} />
      {enabled && (
        <>
          {!geometry && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              OBJ が未設定（または読み取れる頂点/面がない）ため、何も描きません。Morph の OBJ 取り込みで OBJ を設定してください（データ源はモーフと共有です）。
            </div>
          )}
          {geometry && (
            <div className="mt-1 text-[9px] leading-relaxed text-white/40">
              {`頂点 ${geometry.vertexCount}・三角形 ${geometry.triangleCount} のメッシュを描きます。`}
            </div>
          )}
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Display （表示形態）</div>
          <Toggle label="Display" value={config.gpgpuObjMeshDisplay} options={[{ label: 'Wireframe', val: 'wireframe' as const }, { label: 'Solid', val: 'solid' as const }]} onChange={(v) => updateConfig('gpgpuObjMeshDisplay', v)} />
          <Slider label="Repeat （反復）" value={config.gpgpuObjMeshRepeat} min={1} max={64} step={1} onChange={(v) => updateConfig('gpgpuObjMeshRepeat', Math.round(v))} />
          <Toggle label="Repeat Mode （反復配置）" value={config.gpgpuObjMeshRepeatMode} options={[{ label: 'Grid', val: 'grid' as const }, { label: 'Radial', val: 'radial' as const }]} onChange={(v) => updateConfig('gpgpuObjMeshRepeatMode', v)} />
          <Slider label="Repeat Rotation （反復ごとの回転°）" value={config.gpgpuObjMeshRepeatRotation} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuObjMeshRepeatRotation', v)} />
          <Slider label="Repeat Scale Step （反復ごとの拡縮比）" value={config.gpgpuObjMeshRepeatScaleStep} min={0.5} max={1.5} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshRepeatScaleStep', v)} />
          <Toggle label="Deform （頂点変形・Phase 30)" value={config.gpgpuObjMeshDeformMode} options={[{ label: 'Off', val: 'off' as const }, { label: 'Wave （波）', val: 'wave' as const }, { label: 'Twist （ねじり）', val: 'twist' as const }, { label: 'Bend （曲げ）', val: 'bend' as const }]} onChange={(v) => updateConfig('gpgpuObjMeshDeformMode', v)} />
          {config.gpgpuObjMeshDeformMode !== 'off' && (
            <>
              <Slider label="Deform Amount （変形の深さ）" value={config.gpgpuObjMeshDeformAmount} min={0} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshDeformAmount', v)} />
              <Slider label="Deform Frequency （周波数）" value={config.gpgpuObjMeshDeformFrequency} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshDeformFrequency', v)} />
              <Slider label="Deform Speed （位相速度）" value={config.gpgpuObjMeshDeformSpeed} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshDeformSpeed', v)} />
            </>
          )}
          <Slider label="Scale （大きさ）" value={config.gpgpuObjMeshScale} min={0.25} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshScale', v)} />
          <Slider label="Position X" value={config.gpgpuObjMeshPosX} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosX', v)} />
          <Slider label="Position Y" value={config.gpgpuObjMeshPosY} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosY', v)} />
          <Slider label="Position Z" value={config.gpgpuObjMeshPosZ} min={-200} max={200} step={1} onChange={(v) => updateConfig('gpgpuObjMeshPosZ', v)} />
          <Slider label="Rotation Y （回転°）" value={config.gpgpuObjMeshRotY} min={-180} max={180} step={5} onChange={(v) => updateConfig('gpgpuObjMeshRotY', v)} />
          <Slider label="Opacity （不透明度）" value={config.gpgpuObjMeshOpacity} min={0.05} max={1} step={0.05} onChange={(v) => updateConfig('gpgpuObjMeshOpacity', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            取り込み済み OBJ をポリゴンメッシュとして描きます（Trapcode Mir 型）。正規化と寸法はモーフ点群と一致するため、点群と重ねて表示できます。Repeat は格子状の複製で、モーフの複製文法（Replicas）とは独立です。
          </div>
        </>
      )}
    </div>
  );
};
