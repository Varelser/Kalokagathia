/**
 * Vertical text layout (Phase BG): pure, canvas-free column
 * layout for the layer-2 TextMap raster. The two text drawing
 * paths — `rasterizeTextCanvas` (lib/mapSourceSupply.ts, the GPU
 * texture supply) and `extractTextLumaMap`
 * (components/controlPanelPartsSourceMediaUtils.ts, the numeric
 * luma grid) — share these functions so the vertical rendering of
 * the pair can never drift, exactly as their horizontal rendering
 * is kept identical.
 *
 * Layout rules (tategaki, column form):
 * - The text is split into columns; column 0 holds the head of
 *   the text and is drawn as the RIGHTMOST column. Columns
 *   proceed right → left.
 * - Inside a column, glyphs are placed one by one, top → bottom,
 *   all upright (no rotation, no tate-chu-yoko, no ruby, no
 *   kinsoku processing).
 * - A newline forces a column break, mirroring the horizontal
 *   layout's line breaks. `columnLength` (> 0) additionally wraps
 *   each newline-separated segment into columns of at most that
 *   many glyphs; 0 keeps every segment in a single column.
 */

/** The vertical-layout inputs shared by both text drawing paths. */
export interface TextLayoutOptions {
  vertical: boolean;
  /** Glyphs per column; 0 = one column per newline segment. */
  columnLength: number;
  /** Gap between columns, as a ratio of the glyph size. */
  columnGap: number;
  /** Extra glyph advance inside a column, as a ratio of the glyph size. */
  letterSpacing: number;
}

/** The subset of the config the layout options are read from
 *  (the layer-2 TextMap settings; ParticleConfig satisfies this). */
export interface TextMapLayoutSource {
  layer2TextMapVertical: boolean;
  layer2TextMapColumnLength: number;
  layer2TextMapColumnGap: number;
  layer2TextMapLetterSpacing: number;
}

export function textLayoutOptionsFromTextMap(source: TextMapLayoutSource): TextLayoutOptions {
  return {
    vertical: source.layer2TextMapVertical,
    columnLength: source.layer2TextMapColumnLength,
    columnGap: source.layer2TextMapColumnGap,
    letterSpacing: source.layer2TextMapLetterSpacing,
  };
}

/** Split a string into glyphs by code point (surrogate pairs and
 *  combining sequences stay in one piece per code point). */
export function splitTextGlyphs(text: string): string[] {
  return Array.from(text || '');
}

function normalizeColumnLength(columnLength: number): number {
  if (!Number.isFinite(columnLength) || columnLength <= 0) return 0;
  return Math.floor(columnLength);
}

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Split text into columns. Column 0 is the head of the text (the
 * rightmost column when drawn). Newlines always break columns;
 * with columnLength > 0 each newline-separated segment is further
 * wrapped into chunks of at most columnLength glyphs. An empty
 * segment yields an empty column (it still occupies its slot,
 * like an empty line in the horizontal layout).
 */
export function layoutTextColumns(text: string, columnLength: number): string[] {
  const limit = normalizeColumnLength(columnLength);
  const segments = (text || '').split(/\n/);
  const columns: string[] = [];
  for (const segment of segments) {
    if (limit <= 0) {
      columns.push(segment);
      continue;
    }
    const glyphs = splitTextGlyphs(segment);
    if (glyphs.length === 0) {
      columns.push('');
      continue;
    }
    for (let i = 0; i < glyphs.length; i += limit) {
      columns.push(glyphs.slice(i, i + limit).join(''));
    }
  }
  return columns;
}

/** Metrics of one vertical raster, in canvas pixels. `padding`
 *  is the clamped padding ratio the horizontal layout also uses
 *  (the usable box is inset by padding on every side). */
export interface VerticalTextMetrics {
  width: number;
  height: number;
  padding: number;
  pxSize: number;
  columnGap: number;
  letterSpacing: number;
}

/** Horizontal distance between neighbouring column centres. */
export function verticalColumnStep(metrics: VerticalTextMetrics): number {
  return metrics.pxSize * (1 + normalizeRatio(metrics.columnGap));
}

/** Total width of the column block (first column's left edge to
 *  the last column's right edge). */
export function verticalColumnsWidth(columnCount: number, metrics: VerticalTextMetrics): number {
  if (columnCount <= 0) return 0;
  return columnCount * metrics.pxSize + (columnCount - 1) * metrics.pxSize * normalizeRatio(metrics.columnGap);
}

/**
 * Centre x of a column. Column 0 is the rightmost column; the
 * whole column block is centred on the canvas width, mirroring
 * how the horizontal layout centres each line.
 */
export function verticalColumnCenterX(columnIndex: number, columnCount: number, metrics: VerticalTextMetrics): number {
  const blockWidth = verticalColumnsWidth(columnCount, metrics);
  const rightColumnCenter = metrics.width / 2 + blockWidth / 2 - metrics.pxSize / 2;
  return rightColumnCenter - columnIndex * verticalColumnStep(metrics);
}

/** Vertical distance between neighbouring glyph centres in a column. */
export function verticalGlyphAdvance(metrics: VerticalTextMetrics): number {
  return metrics.pxSize * (1 + normalizeRatio(metrics.letterSpacing));
}

/** Total height of one column of glyphCount glyphs. */
export function verticalColumnHeight(glyphCount: number, metrics: VerticalTextMetrics): number {
  if (glyphCount <= 0) return 0;
  return glyphCount * metrics.pxSize + (glyphCount - 1) * metrics.pxSize * normalizeRatio(metrics.letterSpacing);
}

/**
 * Centre y of a glyph inside its column. Glyph 0 is the topmost;
 * the column block is centred inside the usable height (the
 * canvas height inset by padding), mirroring how the horizontal
 * layout centres its line block.
 */
export function verticalGlyphCenterY(glyphIndex: number, glyphCount: number, metrics: VerticalTextMetrics): number {
  const usableHeight = metrics.height * (1 - metrics.padding * 2);
  const columnHeight = verticalColumnHeight(glyphCount, metrics);
  const top = metrics.height * metrics.padding + (usableHeight - columnHeight) / 2;
  return top + metrics.pxSize / 2 + glyphIndex * verticalGlyphAdvance(metrics);
}

export interface VerticalGlyphPlacement {
  glyph: string;
  x: number;
  y: number;
  column: number;
  index: number;
}

/**
 * Every glyph placement of a vertical raster, in reading order
 * (column 0 first — the rightmost column — glyphs top → bottom).
 * Both drawing paths iterate this list and fillText each glyph at
 * (x, y) with centre alignment, so their output is the same
 * picture by construction.
 */
export function verticalGlyphPlacements(
  text: string,
  columnLength: number,
  metrics: VerticalTextMetrics,
): VerticalGlyphPlacement[] {
  const columns = layoutTextColumns(text, columnLength);
  const placements: VerticalGlyphPlacement[] = [];
  columns.forEach((column, columnIndex) => {
    const glyphs = splitTextGlyphs(column);
    const x = verticalColumnCenterX(columnIndex, columns.length, metrics);
    glyphs.forEach((glyph, glyphIndex) => {
      placements.push({
        glyph,
        x,
        y: verticalGlyphCenterY(glyphIndex, glyphs.length, metrics),
        column: columnIndex,
        index: glyphIndex,
      });
    });
  });
  return placements;
}
