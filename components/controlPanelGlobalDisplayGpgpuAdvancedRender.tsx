import React from 'react';

import { Slider, Toggle } from './controlPanelParts';
import type { GlobalDisplayEffectsSharedProps } from './controlPanelGlobalDisplayEffectsShared';
import { OBJ_GEOM_TRIANGLE_BUDGET, describeObjGeomSource } from '../lib/objMesh';

export const GlobalDisplayGpgpuAdvancedRenderSection: React.FC<GlobalDisplayEffectsSharedProps> = ({
  config,
  updateConfig,
}) => (
  <>
    {/* Instanced Geometry */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle
        label="Geometry Mode"
        value={config.gpgpuGeomMode}
        options={[{ label: 'Point', val: 'point' }, { label: 'Cube', val: 'cube' }, { label: 'Tetra', val: 'tetra' }, { label: 'Octa', val: 'octa' }, { label: 'Icosa', val: 'icosa' }, { label: 'Torus', val: 'torus' }, { label: 'Cone', val: 'cone' }, { label: 'OBJ', val: 'obj' }]}
        onChange={(v) => updateConfig('gpgpuGeomMode', v)}
      />
      {config.gpgpuGeomMode === 'point' && (
        <>
          <div className="mb-1 mt-2 text-[9px] uppercase tracking-widest opacity-60">Point Shape</div>
          <select
            value={config.gpgpuPointShape}
            onChange={(e) => updateConfig('gpgpuPointShape', e.target.value as typeof config.gpgpuPointShape)}
            className="mb-3 w-full cursor-pointer rounded border border-white/20 bg-black/40 px-2 py-1.5 text-[11px] text-white/90 outline-none focus:border-white/40"
          >
            <option value="soft">Soft (従来のグロー)</option>
            <option value="sphere">Sphere</option>
            <option value="ring">Ring</option>
            <option value="star">Star</option>
            <option value="hexagon">Hexagon</option>
            <option value="diamond">Diamond</option>
            <option value="flare">Flare</option>
            <option value="cloud">Cloud</option>
            <option value="bokeh">Bokeh</option>
            <option value="crosshair">Crosshair</option>
            <option value="iris">Iris</option>
            <option value="lightning">Lightning</option>
          </select>
          <SpriteImageBlock config={config} updateConfig={updateConfig} />
        </>
      )}
      {config.gpgpuGeomMode === 'obj' && (
        <ObjGeomSourceNote source={config.gpgpuMorphObjSource} />
      )}
      {config.gpgpuGeomMode !== 'point' && (
        <>
          <Slider label="Geom Scale" value={config.gpgpuGeomScale} min={0.1} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuGeomScale', v)} />
          <Toggle label="Velocity Align" value={config.gpgpuGeomVelocityAlign} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuGeomVelocityAlign', v)} />
          <Slider label="Env Reflect (Crystal)" value={config.gpgpuGeomEnvReflect} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuGeomEnvReflect', v)} />
          <Slider label="IBL Intensity （環境光・Phase AL）" value={config.gpgpuGeomIblIntensity} min={0} max={2} step={0.01} onChange={(v) => updateConfig('gpgpuGeomIblIntensity', v)} />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            背景（画像は equirect、グラデーションは環境ベイク）を照明としてサンプルし、拡散＋反射でジオメトリへ足します。0 の間は従来の見た目のままです。
          </div>
          <Slider label="Spin Speed" value={config.gpgpuGeomSpinSpeed} min={0} max={3} step={0.05} onChange={(v) => updateConfig('gpgpuGeomSpinSpeed', v)} />
          <Slider label="Spin Random （自転ランダム範囲）" value={config.gpgpuGeomSpinRandom} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuGeomSpinRandom', v)} />
          <Slider label="Mesh Stretch" value={config.gpgpuGeomStretch} min={0} max={2} step={0.05} onChange={(v) => updateConfig('gpgpuGeomStretch', v)} />
        </>
      )}
    </div>

    {/* Metaballs (Marching Cubes isosurface) */}
    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Metaballs (MC Surface)" value={config.gpgpuMetaballEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMetaballEnabled', v)} />
      {config.gpgpuMetaballEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Marching Cubes isosurface — nearby particles merge into a smooth blob mesh.
          </div>
          <Slider label="Resolution" value={config.gpgpuMetaballResolution} min={16} max={48} step={2} onChange={(v) => updateConfig('gpgpuMetaballResolution', Math.round(v))} />
          <Slider label="Blob Strength" value={config.gpgpuMetaballStrength} min={0.1} max={5} step={0.05} onChange={(v) => updateConfig('gpgpuMetaballStrength', v)} />
          <Slider label="Iso Level" value={config.gpgpuMetaballIsoLevel} min={10} max={200} step={5} onChange={(v) => updateConfig('gpgpuMetaballIsoLevel', v)} />
          <Slider label="Decay (Subtract)" value={config.gpgpuMetaballSubtract} min={0} max={100} step={1} onChange={(v) => updateConfig('gpgpuMetaballSubtract', v)} />
          <Slider label="Opacity" value={config.gpgpuMetaballOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballOpacity', v)} />
          <Slider label="Metalness" value={config.gpgpuMetaballMetalness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballMetalness', v)} />
          <Slider label="Roughness" value={config.gpgpuMetaballRoughness} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuMetaballRoughness', v)} />
          <Slider label="Update Skip (Frames)" value={config.gpgpuMetaballUpdateSkip} min={1} max={10} step={1} onChange={(v) => updateConfig('gpgpuMetaballUpdateSkip', Math.round(v))} />
          <Slider label="Particle Limit" value={config.gpgpuMetaballParticleLimit} min={64} max={4096} step={64} onChange={(v) => updateConfig('gpgpuMetaballParticleLimit', v)} />
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[10px] text-white/60 uppercase tracking-wider">Color</label>
            <input
              type="color"
              value={config.gpgpuMetaballColor}
              onChange={(e) => updateConfig('gpgpuMetaballColor', e.target.value)}
              className="w-8 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
            />
          </div>
          <div className="mt-2">
            <Toggle label="Wireframe" value={config.gpgpuMetaballWireframe} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuMetaballWireframe', v)} />
          </div>
        </>
      )}
    </div>

    {/* Volumetric Ray Marching */}

    <div className="mt-4 border-t border-white/10 pt-4">
      <Toggle label="Volumetric (Ray March)" value={config.gpgpuVolumetricEnabled} options={[{ label: 'On', val: true }, { label: 'Off', val: false }]} onChange={(v) => updateConfig('gpgpuVolumetricEnabled', v)} />
      {config.gpgpuVolumetricEnabled && (
        <>
          <div className="mt-1 mb-2 text-[9px] text-white/40 leading-relaxed">
            Ray-marched sphere sprites — each particle rendered as a volumetric density cloud.
          </div>
          <Slider label="Radius" value={config.gpgpuVolumetricRadius} min={1} max={60} step={0.5} onChange={(v) => updateConfig('gpgpuVolumetricRadius', v)} />
          <Slider label="Density" value={config.gpgpuVolumetricDensity} min={0.1} max={10} step={0.1} onChange={(v) => updateConfig('gpgpuVolumetricDensity', v)} />
          <Slider label="Opacity" value={config.gpgpuVolumetricOpacity} min={0} max={1} step={0.01} onChange={(v) => updateConfig('gpgpuVolumetricOpacity', v)} />
          <Slider label="Steps (quality)" value={config.gpgpuVolumetricSteps} min={4} max={32} step={2} onChange={(v) => updateConfig('gpgpuVolumetricSteps', Math.round(v))} />
          <div className="mt-2 flex items-center gap-3">
            <label className="text-[10px] text-white/60 uppercase tracking-wider">Color</label>
            <input
              type="color"
              value={config.gpgpuVolumetricColor}
              onChange={(e) => updateConfig('gpgpuVolumetricColor', e.target.value)}
              className="w-8 h-6 rounded border border-white/20 bg-transparent cursor-pointer"
            />
          </div>
        </>
      )}
    </div>
  </>
);

/**
 * OBJ geometry source note (Phase AO): the 'obj' geometry mode
 * reads the imported OBJ document (the same source the morph
 * system and the OBJ mesh display use). The note states which of
 * the four source states applies — including the octahedron
 * fallback cases — instead of letting the shape change silently.
 */
const ObjGeomSourceNote: React.FC<{ source: string }> = ({ source }) => {
  const info = React.useMemo(() => describeObjGeomSource(source), [source]);
  const text =
    info.state === 'empty'
      ? 'OBJ ソースが未設定のため、粒子形状は八面体（Octa）で描かれます。Morph 節で OBJ を取り込むと、その形状が粒子の形になります。'
      : info.state === 'invalid'
        ? 'OBJ ソースを解析できないため、粒子形状は八面体（Octa）で描かれます。'
        : info.state === 'over-budget'
          ? `OBJ の三角形数 ${info.triangleCount} が予算 ${OBJ_GEOM_TRIANGLE_BUDGET} を超えるため、粒子形状は八面体（Octa）で描かれます（OBJ メッシュ表示とモーフは従来どおり使えます）。`
          : `取り込み OBJ（${info.triangleCount} 三角形）を粒子の形として使います。半径は組み込み形状と同じ級（0.7）に揃えてあります。`;
  return (
    <div className="mt-2 rounded border border-white/10 bg-white/5 p-2">
      <div className="text-[9px] leading-relaxed text-white/50">{text}</div>
    </div>
  );
};

/**
 * Sprite image controls (Phase U). Same placement manners as the
 * gradient image block: the picked image is downscaled to <=256px
 * and stored in the config as a data URL (gpgpuSpriteImage), so it
 * persists with presets / projects. PNG is used (not JPEG) so an
 * alpha channel survives — the sprite's shape is the image's
 * luminance times its alpha. While a sprite image is set it takes
 * priority over the Point Shape above; the status line says so
 * explicitly instead of switching silently.
 */
const SpriteImageBlock: React.FC<GlobalDisplayEffectsSharedProps> = ({ config, updateConfig }) => {
  const source = config.gpgpuSpriteImage;
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
      updateConfig('gpgpuSpriteImage', canvas.toDataURL('image/png'));
    } catch {
      // Unreadable file: keep the previous source untouched.
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  return (
    <div className="mb-3 rounded border border-white/10 bg-white/5 p-2">
      <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Sprite Image（スプライト画像）</div>
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
              onClick={() => updateConfig('gpgpuSpriteImage', '')}
              className="rounded-full border border-white/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/10"
            >
              クリア
            </button>
          </>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {source
          ? 'スプライト画像を設定済み: 粒子の形は Point Shape より優先され、画像の輝度（×透明度）がそのまま粒子の濃淡になります（モノクロ）。画像は 256px 以下に縮小され、config に保持されます。'
          : 'スプライト画像が未設定のため、粒子の形は上の Point Shape の手続き形状です。画像を設定すると、画像そのものが粒子の形になります。'}
      </div>
      {source && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 text-[9px] uppercase tracking-widest opacity-60">Sprite Sheet（フリップブック）</div>
          <Slider label="Sheet Columns" value={config.gpgpuSpriteSheetCols} min={1} max={16} step={1} onChange={(v) => updateConfig('gpgpuSpriteSheetCols', v)} />
          <Slider label="Sheet Rows" value={config.gpgpuSpriteSheetRows} min={1} max={16} step={1} onChange={(v) => updateConfig('gpgpuSpriteSheetRows', v)} />
          <Toggle
            label="Frame Drive"
            value={config.gpgpuSpriteFrameMode}
            options={[{ label: 'Age', val: 'age' }, { label: 'FPS', val: 'fps' }, { label: 'Random', val: 'random' }]}
            onChange={(v) => updateConfig('gpgpuSpriteFrameMode', v)}
          />
          {config.gpgpuSpriteFrameMode === 'fps' && (
            <Slider label="Frame FPS" value={config.gpgpuSpriteFrameFps} min={0.1} max={60} step={0.1} onChange={(v) => updateConfig('gpgpuSpriteFrameFps', v)} />
          )}
          <Toggle
            label="Loop"
            value={config.gpgpuSpriteLoop}
            options={[{ label: 'On', val: true }, { label: 'Off', val: false }]}
            onChange={(v) => updateConfig('gpgpuSpriteLoop', v)}
          />
          <div className="mt-1 text-[9px] leading-relaxed text-white/40">
            画像を列×行のシートとして分割し、フレームを進めます（左上から右へ、下の行へ）。1×1 が従来の単一画像と完全一致です。年齢駆動は寿命でシートを一周、FPS は固定レート、Random は粒子ごとに1枚固定です。
          </div>
        </div>
      )}
    </div>
  );
};
