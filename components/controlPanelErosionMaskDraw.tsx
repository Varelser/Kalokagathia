import React from 'react';
import type { ParticleConfig } from '../types';
import { getTerrainDerivedMaps, terrainDerivedMapLuma } from '../lib/terrainDerivedMaps';

/**
 * Hand-drawn erosion mask (Round 83 gap 1): painting on this
 * canvas writes the same 129x129 luma grid shape the image
 * capture produces, into its own config key — the bake cannot
 * tell whether the grid was captured or painted. Strokes add
 * value with a distance falloff (overlaps build up density);
 * the eraser takes value back toward 0. The grid is committed
 * to the config on stroke end (pointer up), so a drag does not
 * rebake per move — the bake's own cache identity (the grid
 * hash) decides when to re-carve. Row 0 is the fz = -E side,
 * the derived-map / image-capture row convention. The terrain
 * underlay is display-only and never enters the data.
 */
const SIDE = 129;
const DISPLAY = 258;

export const ErosionMaskDrawBlock: React.FC<{
  config: ParticleConfig;
  updateConfig: <K extends keyof ParticleConfig>(key: K, value: ParticleConfig[K]) => void;
}> = ({ config, updateConfig }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const gridRef = React.useRef<Float32Array>(new Float32Array(SIDE * SIDE));
  const drawingRef = React.useRef(false);
  const [brush, setBrush] = React.useState<'small' | 'large'>('small');
  const [tool, setTool] = React.useState<'paint' | 'erase'>('paint');
  const [underlay, setUnderlay] = React.useState(false);
  const [invertPreview, setInvertPreview] = React.useState(false);
  const [hasContent, setHasContent] = React.useState(false);
  const brushRef = React.useRef(brush);
  brushRef.current = brush;
  const toolRef = React.useRef(tool);
  toolRef.current = tool;

  // Sync from the config (preset load / clear elsewhere).
  const configGrid = config.gpgpuMorphTerrainErosionMaskDrawnGrid;
  React.useEffect(() => {
    const g = new Float32Array(SIDE * SIDE);
    if (Array.isArray(configGrid) && configGrid.length === SIDE * SIDE) {
      for (let i = 0; i < g.length; i++) {
        const v = configGrid[i];
        g[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      }
    }
    gridRef.current = g;
    setHasContent(g.some((v) => v > 0));
  }, [configGrid]);

  const redraw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(DISPLAY, DISPLAY);
    let under: Float32Array | null = null;
    let underSize = 0;
    if (underlay) {
      try {
        const maps = getTerrainDerivedMaps(config);
        under = terrainDerivedMapLuma(maps, 'slope');
        underSize = maps.size;
      } catch {
        under = null;
      }
    }
    const g = gridRef.current;
    for (let y = 0; y < DISPLAY; y++) {
      const gy = Math.min(SIDE - 1, Math.floor((y / DISPLAY) * SIDE));
      for (let x = 0; x < DISPLAY; x++) {
        const gx = Math.min(SIDE - 1, Math.floor((x / DISPLAY) * SIDE));
        let v = g[gy * SIDE + gx];
        if (invertPreview) v = 1 - v;
        let base = 24;
        if (under && underSize > 0) {
          const ux = Math.min(underSize - 1, Math.floor((x / DISPLAY) * underSize));
          const uy = Math.min(underSize - 1, Math.floor((y / DISPLAY) * underSize));
          base = Math.round(24 + under[uy * underSize + ux] * 60);
        }
        const o = (y * DISPLAY + x) * 4;
        img.data[o] = Math.round(base + v * (255 - base));
        img.data[o + 1] = Math.round(base + v * (255 - base));
        img.data[o + 2] = Math.round(base + v * (255 - base));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [underlay, invertPreview, config]);

  React.useEffect(() => { redraw(); }, [redraw, configGrid]);

  const applyAt = React.useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const gx = ((clientX - rect.left) / rect.width) * SIDE;
    const gy = ((clientY - rect.top) / rect.height) * SIDE;
    const radius = brushRef.current === 'large' ? 6 : 2;
    const g = gridRef.current;
    const r = Math.ceil(radius);
    for (let j = Math.max(0, Math.floor(gy) - r); j <= Math.min(SIDE - 1, Math.floor(gy) + r); j++) {
      for (let i = Math.max(0, Math.floor(gx) - r); i <= Math.min(SIDE - 1, Math.floor(gx) + r); i++) {
        const d = Math.hypot(i + 0.5 - gx, j + 0.5 - gy);
        if (d > radius) continue;
        const fall = 1 - d / (radius + 0.5);
        const idx = j * SIDE + i;
        if (toolRef.current === 'paint') {
          g[idx] = Math.min(1, g[idx] + 0.3 * fall);
        } else {
          g[idx] = Math.max(0, g[idx] - 0.45 * fall);
        }
      }
    }
    redraw();
  }, [redraw]);

  const commit = React.useCallback(() => {
    const arr = Array.from(gridRef.current, (v) => Math.round(v * 1000) / 1000);
    setHasContent(arr.some((v) => v > 0));
    updateConfig('gpgpuMorphTerrainErosionMaskDrawnGrid', arr);
  }, [updateConfig]);

  const clearAll = React.useCallback(() => {
    gridRef.current = new Float32Array(SIDE * SIDE);
    redraw();
    setHasContent(false);
    updateConfig('gpgpuMorphTerrainErosionMaskDrawnGrid', []);
  }, [redraw, updateConfig]);

  const btn = 'rounded border border-white/20 px-2 py-1 text-[9px] uppercase tracking-widest hover:bg-white/10';
  const btnOn = 'rounded border border-white/60 bg-white/15 px-2 py-1 text-[9px] uppercase tracking-widest';
  return (
    <div className="mt-1">
      <canvas
        ref={canvasRef}
        width={DISPLAY}
        height={DISPLAY}
        className="w-full cursor-crosshair rounded border border-white/20"
        style={{ aspectRatio: '1 / 1', touchAction: 'none' }}
        onPointerDown={(e) => {
          drawingRef.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          applyAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => { if (drawingRef.current) applyAt(e.clientX, e.clientY); }}
        onPointerUp={() => { if (drawingRef.current) { drawingRef.current = false; commit(); } }}
        onPointerCancel={() => { drawingRef.current = false; }}
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button type="button" className={tool === 'paint' ? btnOn : btn} onClick={() => setTool('paint')}>Draw （描く）</button>
        <button type="button" className={tool === 'erase' ? btnOn : btn} onClick={() => setTool('erase')}>Erase （消す）</button>
        <button type="button" className={brush === 'small' ? btnOn : btn} onClick={() => setBrush('small')}>Brush S （細）</button>
        <button type="button" className={brush === 'large' ? btnOn : btn} onClick={() => setBrush('large')}>Brush L （太）</button>
        <button type="button" className={btn} onClick={clearAll}>Clear （全消去）</button>
        <button type="button" className={underlay ? btnOn : btn} onClick={() => setUnderlay((v) => !v)}>Terrain （下敷き）</button>
        <button type="button" className={invertPreview ? btnOn : btn} onClick={() => setInvertPreview((v) => !v)}>Invert （表示反転）</button>
      </div>
      <div className="mt-1 text-[9px] leading-relaxed text-white/40">
        {hasContent
          ? '描画済み: 129×129 の輝度グリッド。明るい所ほど帯域（Low–High）の対象になります。ストロークを離した時点で反映されます。'
          : '未描画: この状態では手描きマスクは無効（マスクなし）として扱われます。'}
      </div>
    </div>
  );
};
