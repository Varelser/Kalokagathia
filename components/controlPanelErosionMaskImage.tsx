import React from 'react';
import type { ParticleConfig } from '../types';
import { extractLumaMap } from './controlPanelPartsSourceMediaUtils';

/**
 * Erosion mask image capture (Phase 30, §11-2 T2): importing an
 * image captures its luma grid at 129x129 (the erosion grid
 * size) into the config on assignment — the raster-mask
 * convention (Phase X) — so the deterministic bake consumes
 * numbers, never an async image decode. Row 0 of the grid is
 * the image's top row, which the bake reads as the fz = -E
 * side, matching the derived-map row convention. Clearing
 * removes the grid; mode 'image' without a grid resolves to
 * no mask (the identity) in the bake.
 */
export const ErosionMaskImageBlock: React.FC<{
  config: ParticleConfig;
  updateConfig: <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => void;
}> = ({ config, updateConfig }) => {
  const grid = config.gpgpuMorphTerrainErosionMaskImageGrid;
  const captured = Array.isArray(grid) && grid.length === 129 * 129;
  const [status, setStatus] = React.useState('');
  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('image load failed'));
        img.src = url;
      });
      const map = extractLumaMap(img, 129, 129);
      URL.revokeObjectURL(url);
      if (map.length !== 129 * 129) {
        setStatus('読み込みに失敗しました（画像をデコードできませんでした）。');
        return;
      }
      updateConfig('gpgpuMorphTerrainErosionMaskImageGrid', map);
      setStatus('マスク画像を取り込みました（129×129 の輝度グリッド）。');
    } catch {
      setStatus('読み込みに失敗しました（画像をデコードできませんでした）。');
    }
  };
  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <label className="cursor-pointer rounded border border-white/20 px-2 py-1 text-[9px] uppercase tracking-widest hover:bg-white/10">
          Mask Image （マスク画像を選ぶ）
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { void handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        {captured && (
          <button
            type="button"
            className="rounded border border-white/20 px-2 py-1 text-[9px] uppercase tracking-widest hover:bg-white/10"
            onClick={() => { updateConfig('gpgpuMorphTerrainErosionMaskImageGrid', []); setStatus(''); }}
          >
            Clear （消す）
          </button>
        )}
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {captured
          ? '取り込み済み: 129×129 の輝度グリッド。明るい所ほど帯域（Low–High）の対象になります。'
          : '未取り込み: この状態では画像マスクは無効（マスクなし）として扱われます。'}
        {status ? ` ${status}` : ''}
      </div>
    </div>
  );
};
