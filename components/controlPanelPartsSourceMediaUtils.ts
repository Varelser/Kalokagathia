import { fitVerticalTextMetrics, verticalGlyphPlacements, type TextLayoutOptions } from '../lib/textColumnLayout';
import { pagedVerticalGlyphPlacements, textColumnsPerPage } from '../lib/textPageLayout';

export const MEDIA_SAMPLE_SIZE = 64;

export function extractLumaMap(source: CanvasImageSource, width: number, height: number, flipHorizontal = false) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [] as number[];
  ctx.clearRect(0, 0, width, height);
  if (flipHorizontal) {
    // Mirror view, as users expect from a camera (roadmap 8B).
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const map = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = i * 4;
    const r = imageData[base] / 255;
    const g = imageData[base + 1] / 255;
    const b = imageData[base + 2] / 255;
    const a = imageData[base + 3] / 255;
    map[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  return map;
}

export function extractTextLumaMap(
  text: string,
  width: number,
  height: number,
  fontFamily: string,
  fontWeight: number,
  size: number,
  padding: number,
  invert: boolean,
  // Vertical layout (Phase BG): optional; omitted or
  // vertical=false runs the legacy horizontal layout verbatim.
  layout?: TextLayoutOptions,
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [] as number[];

  ctx.fillStyle = invert ? '#ffffff' : '#000000';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = invert ? '#000000' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = (text || 'TEXT').split(/\n/).slice(0, 4);
  const clampedSize = Math.max(0.2, Math.min(1.4, size || 0.76));
  const clampedPadding = Math.max(0, Math.min(0.35, padding || 0.1));
  const pxSize = Math.max(12, Math.floor(clampedSize * Math.min(width, height)));
  ctx.font = `${Math.max(100, Math.min(900, fontWeight || 700))} ${pxSize}px ${fontFamily || 'Arial'}`;

  if (layout?.vertical) {
    // Vertical layout (Phase BG): glyphs placed one by one from
    // the shared pure layout (lib/textColumnLayout.ts) — columns
    // right → left, glyphs top → bottom, all upright. Draws
    // identically to rasterizeTextCanvas' vertical branch.
    const rawTextMetrics = {
      width,
      height,
      padding: clampedPadding,
      pxSize,
      columnGap: layout.columnGap,
      letterSpacing: layout.letterSpacing,
    };
    const textAdjustments = { kinsoku: layout.kinsoku, yakumono: layout.yakumono, tatechuyoko: layout.tatechuyoko, ruby: layout.ruby };
    // Phase 30: the same fit correction as rasterizeTextCanvas
    // (lib/mapSourceSupply.ts) — the pair stay identical.
    const textMetrics = fitVerticalTextMetrics(
      text || 'TEXT',
      layout.columnLength,
      rawTextMetrics,
      textAdjustments,
      layout.pageEnabled ? textColumnsPerPage(rawTextMetrics) : undefined,
    );
    const fittedPxSize = textMetrics.pxSize;
    // Text pages (Phase 17): same page branch as
    // rasterizeTextCanvas — only the selected page's columns,
    // resolving to the legacy placements when one page suffices.
    const placements = layout.pageEnabled
      ? pagedVerticalGlyphPlacements(text || 'TEXT', layout.columnLength, textMetrics, textAdjustments, {
        enabled: true,
        balance: layout.columnBalance,
        pageIndex: layout.pageIndex,
      })
      : verticalGlyphPlacements(text || 'TEXT', layout.columnLength, textMetrics, textAdjustments);
    // Phase BP: same per-placement font swap as
    // rasterizeTextCanvas (lib/mapSourceSupply.ts) — a placement
    // with a font scale swaps the font for its own draw and
    // restores it; scale-free placements draw exactly as before.
    const scaledWeight = Math.max(100, Math.min(900, fontWeight || 700));
    const scaledFamily = fontFamily || 'Arial';
    const baseFont = `${scaledWeight} ${fittedPxSize}px ${scaledFamily}`;
    ctx.font = baseFont;
    placements.forEach((placement) => {
      if (placement.squeeze !== undefined && placement.squeeze !== 1) {
        ctx.save();
        ctx.translate(placement.x, placement.y);
        ctx.scale(placement.squeeze, 1);
        ctx.fillText(placement.glyph, 0, 0);
        ctx.restore();
      } else if (placement.scale !== undefined && placement.scale !== 1) {
        ctx.font = `${scaledWeight} ${fittedPxSize * placement.scale}px ${scaledFamily}`;
        ctx.fillText(placement.glyph, placement.x, placement.y);
        ctx.font = baseFont;
      } else {
        ctx.fillText(placement.glyph, placement.x, placement.y);
      }
    });
  } else {
    const usableHeight = height * (1 - clampedPadding * 2);
    const lineHeight = usableHeight / Math.max(1, lines.length);
    lines.forEach((line, index) => {
      const y = height * clampedPadding + lineHeight * (index + 0.5);
      ctx.fillText(line, width / 2, y, width * (1 - clampedPadding * 2));
    });
  }

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const map = new Array<number>(width * height);
  for (let i = 0; i < width * height; i++) {
    const base = i * 4;
    const r = imageData[base] / 255;
    const g = imageData[base + 1] / 255;
    const b = imageData[base + 2] / 255;
    const a = imageData[base + 3] / 255;
    map[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
  }
  return map;
}
