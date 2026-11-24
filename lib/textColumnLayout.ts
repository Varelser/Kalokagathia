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
 *   all upright (no rotation, no tate-chu-yoko, no ruby).
 * - A newline forces a column break, mirroring the horizontal
 *   layout's line breaks. `columnLength` (> 0) additionally wraps
 *   each newline-separated segment into columns of at most that
 *   many glyphs; 0 keeps every segment in a single column.
 *
 * Phase BK adds two opt-in refinements, both OFF by default (the
 * defaults reproduce the Phase BG layout bit-identically):
 * - Kinsoku (禁則): a minimal fixed character set adjusts the
 *   columnLength wrap boundaries only — never newline breaks —
 *   so a wrapped column neither starts with a head-forbidden
 *   glyph nor ends with a tail-forbidden glyph.
 * - Yakumono (約物): position correction only — the four
 *   punctuation glyphs 、。，． are shifted toward the top-right
 *   of their cell. No code-point substitution and no rotation:
 *   substitution would make the bake depend on which vertical
 *   glyph forms a font happens to carry, while a fixed offset
 *   reproduces deterministically in every environment.
 *
 * Phase BP adds two more opt-in refinements, again both OFF by
 * default (the defaults reproduce the Phase BK layout
 * bit-identically; with either on, the layout runs on tokens —
 * one token per cell — instead of raw glyphs):
 * - Tate-chu-yoko (縦中横): a run of 2–4 half-width alphanumeric
 *   glyphs (plus the decimal point) folds into a single cell and
 *   is drawn horizontally at a font scale of min(1, 2/n), under
 *   a fixed glyph-width model (half-width = 0.5em; no font
 *   measurement, so the bake is environment-independent, the
 *   same reasoning as BK's yakumono). A run never splits across
 *   columns.
 * Phase 30 corrects three defects the BP starters exposed
 * (judged 見切れ・不自然 on 2026-11-22):
 * - Fit: `fitVerticalTextMetrics` shrinks the glyph size when
 *   the column block would overflow the raster's usable box
 *   (a 5-cell column at the starter metrics measured 172.8px
 *   against a 128px canvas — the end glyphs fell off-canvas).
 * - Ruby clearance: while ruby is on, the same helper raises
 *   the column gap to RUBY_MIN_COLUMN_GAP so a ruby column
 *   (right edge at centre + 1.0em) clears the neighbouring
 *   column's glyphs (left edge at centre + step − 0.5em).
 * - Tate-chu-yoko runs are drawn at FULL glyph height with a
 *   horizontal squeeze (the CSS text-combine-upright model)
 *   instead of a uniform font shrink, and the squeeze comes
 *   from a fixed per-class advance model (digits 0.56em etc.)
 *   — the old flat 0.5em model under-measured real advances
 *   (Arial digits are 0.556em, capitals up to 0.94em), so runs
 *   rendered up to ~44% wider than their cell.
 *
 * - Ruby (ルビ): Aozora-bunko markup — ｜親文字《るび》, or the
 *   abbreviated 親《るび》 whose parent is exactly the one
 *   preceding glyph — is parsed per newline segment. The parent
 *   glyphs lay out exactly as they would without ruby; the ruby
 *   glyphs are additional placements at a fixed 0.5 scale along
 *   the parent's right side, spread evenly over the parent
 *   span. Invalid markup is not an error: the marker glyphs
 *   pass through as ordinary glyphs. A parent group is never
 *   split across columns.
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
  /** Phase BK: kinsoku adjustment of wrap boundaries (see header). */
  kinsoku: boolean;
  /** Phase BK: yakumono position correction (see header). */
  yakumono: boolean;
  /** Phase BP: tate-chu-yoko run folding (see header). */
  tatechuyoko: boolean;
  /** Phase BP: ruby markup parsing and placement (see header). */
  ruby: boolean;
  /** Text pages (Phase 17, lib/textPageLayout.ts): page the
   *  columns that do not fit one raster into further pages and
   *  draw only the selected page. Omitted / false keeps the
   *  legacy single-raster layout bit-identical. */
  pageEnabled?: boolean;
  /** Text pages (Phase 17): rebalance column lengths before
   *  paging (only consulted while pageEnabled). */
  columnBalance?: boolean;
  /** Text pages (Phase 17): selected page, 0-based (clamped to
   *  the last page). Only consulted while pageEnabled. */
  pageIndex?: number;
}

/** The subset of the config the layout options are read from
 *  (the layer-2 TextMap settings; ParticleConfig satisfies this). */
export interface TextMapLayoutSource {
  layer2TextMapVertical: boolean;
  layer2TextMapColumnLength: number;
  layer2TextMapColumnGap: number;
  layer2TextMapLetterSpacing: number;
  layer2TextMapKinsoku: boolean;
  layer2TextMapYakumono: boolean;
  layer2TextMapTateChuYoko: boolean;
  layer2TextMapRuby: boolean;
  layer2TextMapPageEnabled: boolean;
  layer2TextMapColumnBalance: boolean;
  layer2TextMapPageIndex: number;
}

export function textLayoutOptionsFromTextMap(source: TextMapLayoutSource): TextLayoutOptions {
  return {
    vertical: source.layer2TextMapVertical,
    columnLength: source.layer2TextMapColumnLength,
    columnGap: source.layer2TextMapColumnGap,
    letterSpacing: source.layer2TextMapLetterSpacing,
    kinsoku: source.layer2TextMapKinsoku,
    yakumono: source.layer2TextMapYakumono,
    tatechuyoko: source.layer2TextMapTateChuYoko,
    ruby: source.layer2TextMapRuby,
    pageEnabled: source.layer2TextMapPageEnabled,
    columnBalance: source.layer2TextMapColumnBalance,
    pageIndex: source.layer2TextMapPageIndex,
  };
}

/** The adjustments consumed by the layout functions. All default
 *  to off; all off reproduces the Phase BG behaviour. kinsoku /
 *  yakumono are Phase BK, tatechuyoko / ruby are Phase BP. */
export interface TextColumnAdjustments {
  kinsoku?: boolean;
  yakumono?: boolean;
  tatechuyoko?: boolean;
  ruby?: boolean;
}

/**
 * Kinsoku character sets (Phase BK, fixed minimal set — coverage
 * beyond these glyphs is deliberately not attempted). Judged per
 * code point.
 * - Head-forbidden: may not start a wrapped column (punctuation,
 *   closing brackets, prolonged sound mark, small kana).
 * - Tail-forbidden: may not end a wrapped column (opening
 *   brackets).
 */
export const KINSOKU_HEAD_FORBIDDEN = new Set(splitTextGlyphs(
  '、。，．・：；？！ゝゞヽヾー）〕］｝〉》」』】ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ',
));
export const KINSOKU_TAIL_FORBIDDEN = new Set(splitTextGlyphs(
  '（〔［｛〈《「『【',
));

/**
 * Wrap one newline-separated segment's glyphs into columns of at
 * most `limit` glyphs, adjusting each wrap boundary by the
 * kinsoku rules (deterministic order):
 * 1. Head-forbidden first: while the next column would start
 *    with a head-forbidden glyph, that glyph is pulled into the
 *    current column (which may exceed `limit` by the pulled
 *    count; consecutive forbidden glyphs keep pulling).
 * 2. Tail-forbidden next: while the current column ends with a
 *    tail-forbidden glyph, that glyph is sent to the head of the
 *    next column — unless the column holds a single glyph
 *    (sending it would leave an empty column), or there is no
 *    next column (at the very end of the segment there is no
 *    boundary to adjust, so the glyph stays where the text ends).
 */
function wrapSegmentKinsoku(glyphs: string[], limit: number): string[] {
  const columns: string[] = [];
  let rest = glyphs.slice();
  while (rest.length > 0) {
    const column = rest.slice(0, limit);
    rest = rest.slice(column.length);
    while (rest.length > 0 && KINSOKU_HEAD_FORBIDDEN.has(rest[0])) {
      column.push(rest[0]);
      rest = rest.slice(1);
    }
    while (rest.length > 0 && column.length > 1 && KINSOKU_TAIL_FORBIDDEN.has(column[column.length - 1])) {
      rest = [column.pop() as string, ...rest];
    }
    columns.push(column.join(''));
  }
  return columns;
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

/** Tate-chu-yoko target glyphs (Phase BP, fixed set): half-width
 *  alphanumerics and the decimal point. Judged per code point. */
export const TATECHUYOKO_GLYPHS = new Set(splitTextGlyphs(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.',
));
/** Longest tate-chu-yoko run folded into one cell (Phase BP). */
export const TATECHUYOKO_MAX_RUN = 4;
/**
 * Fixed advance model for tate-chu-yoko runs (Phase 30, in
 * em): digits and the decimal point 0.56 (Arial digits measure
 * 0.556em; the point's real advance is smaller, so the fit
 * errs on the safe side), capitals 0.75 (Arial averages ~0.72;
 * W at 0.94 remains a documented outlier that can still
 * overflow), lowercase 0.58. Like every metric in this file
 * the model is FIXED — no font measurement — so the bake is
 * environment-independent.
 */
export function tatechuyokoModelAdvance(glyph: string): number {
  if ((glyph >= '0' && glyph <= '9') || glyph === '.') return 0.56;
  if (glyph >= 'A' && glyph <= 'Z') return 0.75;
  return 0.58;
}

/** Horizontal squeeze that fits a run into its 1em cell under
 *  the fixed advance model; 1 when the run already fits. */
export function tatechuyokoRunSqueeze(runText: string): number {
  let width = 0;
  for (const glyph of splitTextGlyphs(runText)) width += tatechuyokoModelAdvance(glyph);
  if (width <= 0) return 1;
  return Math.min(1, 1 / width);
}

/** Fixed ruby glyph scale (Phase BP; deliberately not a key). */
export const RUBY_SCALE = 0.5;
/** Ruby offset from the parent column centre, in em: the parent
 *  cell's right edge (0.5) plus the ruby half width (0.25). */
export const RUBY_OFFSET_EM = 0.75;

/** One ruby annotation over a parsed glyph list (Phase BP). */
export interface RubyAnnotation {
  /** Index of the first parent glyph in the parsed glyph list. */
  start: number;
  /** Parent glyph count. */
  length: number;
  /** The ruby string (drawn glyph by glyph). */
  ruby: string;
}

export interface RubyParseResult {
  /** The plain glyph sequence (markup removed where valid). */
  glyphs: string[];
  annotations: RubyAnnotation[];
}

/**
 * Parse the Aozora-bunko ruby markup of one newline-separated
 * segment (Phase BP). Full form: ｜親文字《るび》; abbreviated
 * form: 親《るび》 annotates exactly the one glyph before 《
 * (no character-class guessing). Invalid markup is not an
 * error — the marker glyphs pass through as ordinary glyphs
 * (deterministic fallback): an unclosed 《, a ｜ that no 《…》
 * follows, an empty ruby 《》, or an empty parent ｜《…》.
 * Parsing is per segment, so markup never spans a newline, and
 * a glyph already annotated cannot be annotated twice.
 */
export function parseRubyMarkup(segment: string): RubyParseResult {
  const input = splitTextGlyphs(segment || '');
  const glyphs: string[] = [];
  const annotations: RubyAnnotation[] = [];
  const annotated = new Set<number>();
  const findFrom = (glyph: string, from: number): number => {
    for (let i = from; i < input.length; i++) if (input[i] === glyph) return i;
    return -1;
  };
  let i = 0;
  while (i < input.length) {
    const glyph = input[i];
    if (glyph === '｜') {
      const open = findFrom('《', i + 1);
      const close = open > i + 1 ? findFrom('》', open + 1) : -1;
      if (open > i + 1 && close > open + 1) {
        const start = glyphs.length;
        const parent = input.slice(i + 1, open);
        parent.forEach((parentGlyph) => {
          annotated.add(glyphs.length);
          glyphs.push(parentGlyph);
        });
        annotations.push({ start, length: parent.length, ruby: input.slice(open + 1, close).join('') });
        i = close + 1;
        continue;
      }
      glyphs.push(glyph);
      i += 1;
      continue;
    }
    if (glyph === '《') {
      const close = findFrom('》', i + 1);
      const prev = glyphs.length - 1;
      // The empty-parent form ｜《…》 reaches here with the ｜
      // already emitted as a plain glyph; it stays invalid (the
      // ｜ is the would-be parent), so the 《 passes through too.
      if (close > i + 1 && prev >= 0 && !annotated.has(prev) && input[i - 1] !== '｜') {
        annotated.add(prev);
        annotations.push({ start: prev, length: 1, ruby: input.slice(i + 1, close).join('') });
        i = close + 1;
        continue;
      }
      glyphs.push(glyph);
      i += 1;
      continue;
    }
    glyphs.push(glyph);
    i += 1;
  }
  return { glyphs, annotations };
}

/**
 * One layout token (Phase BP): a single glyph, a tate-chu-yoko
 * run (its text is the whole run; it occupies one cell), or one
 * glyph of a ruby parent group (groupId links the group; ruby
 * is set on the group's first token only).
 */
export interface LayoutToken {
  text: string;
  /** Tate-chu-yoko run only (Phase 30): horizontal squeeze
   *  factor (0..1) the drawing paths apply via a canvas
   *  transform; the run keeps the full glyph height. */
  squeeze?: number;
  groupId?: number;
  ruby?: string;
}

/**
 * Tokenise one segment's parsed glyphs (Phase BP). Ruby parent
 * glyphs are individual tokens and are never folded into runs;
 * the remaining maximal sequences of tate-chu-yoko glyphs fold
 * into runs of at most TATECHUYOKO_MAX_RUN — a leftover of one
 * glyph stays a plain glyph token, a leftover of 2–4 becomes a
 * run (5 → run 4 + plain 1, 6 → run 4 + run 2, …).
 */
export function tokenizeSegment(glyphs: string[], annotations: RubyAnnotation[], tatechuyoko: boolean): LayoutToken[] {
  const groupOf = new Map<number, number>();
  annotations.forEach((annotation, groupId) => {
    for (let k = 0; k < annotation.length; k++) groupOf.set(annotation.start + k, groupId);
  });
  const tokens: LayoutToken[] = [];
  let i = 0;
  while (i < glyphs.length) {
    const groupId = groupOf.get(i);
    if (groupId !== undefined) {
      const annotation = annotations[groupId];
      tokens.push({
        text: glyphs[i],
        groupId,
        ...(i === annotation.start ? { ruby: annotation.ruby } : {}),
      });
      i += 1;
      continue;
    }
    if (tatechuyoko && TATECHUYOKO_GLYPHS.has(glyphs[i])) {
      let end = i;
      while (end < glyphs.length && groupOf.get(end) === undefined && TATECHUYOKO_GLYPHS.has(glyphs[end])) end += 1;
      let pos = i;
      let remaining = end - i;
      while (remaining > TATECHUYOKO_MAX_RUN) {
        const runText = glyphs.slice(pos, pos + TATECHUYOKO_MAX_RUN).join('');
        tokens.push({
          text: runText,
          squeeze: tatechuyokoRunSqueeze(runText),
        });
        pos += TATECHUYOKO_MAX_RUN;
        remaining -= TATECHUYOKO_MAX_RUN;
      }
      if (remaining === 1) {
        tokens.push({ text: glyphs[pos] });
      } else if (remaining >= 2) {
        const runText = glyphs.slice(pos, pos + remaining).join('');
        tokens.push({
          text: runText,
          squeeze: tatechuyokoRunSqueeze(runText),
        });
      }
      i = end;
      continue;
    }
    tokens.push({ text: glyphs[i] });
    i += 1;
  }
  return tokens;
}

function firstGlyphChar(token: LayoutToken): string {
  return splitTextGlyphs(token.text)[0];
}

function lastGlyphChar(token: LayoutToken): string {
  const glyphs = splitTextGlyphs(token.text);
  return glyphs[glyphs.length - 1];
}

/**
 * Keep a column boundary out of a ruby parent group (Phase BP):
 * if the boundary would split a group, the group moves as a
 * whole — its tail is sent to the next column, unless the
 * column holds nothing but that group, in which case the rest
 * of the group is pulled in (the column may exceed the limit,
 * like a kinsoku pull-in).
 */
function fixGroupBoundary(column: LayoutToken[], rest: LayoutToken[]): void {
  while (column.length > 0 && rest.length > 0) {
    const groupId = column[column.length - 1].groupId;
    if (groupId === undefined || rest[0].groupId !== groupId) return;
    if (column.every((token) => token.groupId === groupId)) {
      column.push(rest.shift() as LayoutToken);
    } else {
      rest.unshift(column.pop() as LayoutToken);
    }
  }
}

/**
 * Wrap one segment's tokens into columns of at most `limit`
 * tokens (Phase BP). With kinsoku on, the wrap boundaries are
 * adjusted by the same rules as wrapSegmentKinsoku, judged on
 * each token's first / last glyph (a run token's edge glyphs
 * are never in the kinsoku sets, so runs behave as ordinary
 * single glyphs there, as the brief fixes).
 */
function wrapSegmentTokens(tokens: LayoutToken[], limit: number, kinsoku: boolean): LayoutToken[][] {
  const columns: LayoutToken[][] = [];
  let rest = tokens.slice();
  while (rest.length > 0) {
    const column = rest.slice(0, limit);
    rest = rest.slice(column.length);
    if (kinsoku) {
      while (rest.length > 0 && KINSOKU_HEAD_FORBIDDEN.has(firstGlyphChar(rest[0]))) {
        column.push(rest[0]);
        rest = rest.slice(1);
      }
      while (rest.length > 0 && column.length > 1 && KINSOKU_TAIL_FORBIDDEN.has(lastGlyphChar(column[column.length - 1]))) {
        rest = [column.pop() as LayoutToken, ...rest];
      }
    }
    fixGroupBoundary(column, rest);
    columns.push(column);
  }
  return columns;
}

/**
 * Token-level column layout (Phase BP): the split the BP
 * placements consume. Every token occupies exactly one cell —
 * a run counts as one glyph, each ruby parent glyph counts as
 * itself. Newlines break columns exactly as in the glyph
 * layout; an empty segment yields an empty column.
 */
export function layoutTextColumnsTokenized(text: string, columnLength: number, adjustments?: TextColumnAdjustments): LayoutToken[][] {
  const limit = normalizeColumnLength(columnLength);
  const tatechuyoko = adjustments?.tatechuyoko === true;
  const ruby = adjustments?.ruby === true;
  const kinsoku = adjustments?.kinsoku === true;
  const segments = (text || '').split(/\n/);
  const columns: LayoutToken[][] = [];
  for (const segment of segments) {
    const parsed = ruby
      ? parseRubyMarkup(segment)
      : { glyphs: splitTextGlyphs(segment), annotations: [] as RubyAnnotation[] };
    const tokens = tokenizeSegment(parsed.glyphs, parsed.annotations, tatechuyoko);
    if (limit <= 0 || tokens.length === 0) {
      columns.push(tokens);
      continue;
    }
    columns.push(...wrapSegmentTokens(tokens, limit, kinsoku));
  }
  return columns;
}

/**
 * Split text into columns. Column 0 is the head of the text (the
 * rightmost column when drawn). Newlines always break columns;
 * with columnLength > 0 each newline-separated segment is further
 * wrapped into chunks of at most columnLength glyphs. An empty
 * segment yields an empty column (it still occupies its slot,
 * like an empty line in the horizontal layout).
 *
 * With `kinsoku` on (Phase BK), the wrap boundaries inside each
 * segment are adjusted by wrapSegmentKinsoku; newline breaks are
 * never adjusted (the writer chose those breaks explicitly).
 * With kinsoku off (the default) the split is exactly the Phase
 * BG one — the adjustment pass is not entered at all.
 *
 * With tate-chu-yoko or ruby on (Phase BP, via `adjustments`),
 * the split runs on tokens instead: runs fold into single
 * glyphs' worth of text and ruby markup is removed (the parent
 * glyphs remain), so each column string is the plain text that
 * will be drawn.
 */
export function layoutTextColumns(text: string, columnLength: number, kinsoku = false, adjustments?: TextColumnAdjustments): string[] {
  if (adjustments?.tatechuyoko === true || adjustments?.ruby === true) {
    const merged: TextColumnAdjustments = {
      ...adjustments,
      kinsoku: kinsoku || adjustments.kinsoku === true,
    };
    return layoutTextColumnsTokenized(text, columnLength, merged)
      .map((column) => column.map((token) => token.text).join(''));
  }
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
    if (kinsoku) {
      columns.push(...wrapSegmentKinsoku(glyphs, limit));
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
  /** Phase BP: font scale for this placement (a ruby glyph at
   *  RUBY_SCALE); omitted means 1. The drawing paths swap the
   *  font only when this is present and not 1. */
  scale?: number;
  /** Phase 30: horizontal squeeze for a tate-chu-yoko run
   *  placement (the run draws at full glyph height under a
   *  canvas transform); omitted means 1. */
  squeeze?: number;
  /** Phase BP: this placement is a ruby annotation glyph. Its
   *  `index` is the parent group's first cell index. */
  ruby?: boolean;
}

/**
 * Yakumono position correction (Phase BK): the punctuation
 * glyphs whose horizontal form sits at the bottom-left of the
 * cell are shifted toward the top-right of the cell in vertical
 * writing — x +0.30em, y −0.30em (em = pxSize). Position only:
 * no code-point substitution, no rotation (see the header).
 */
export const YAKUMONO_OFFSET_GLYPHS = new Set(splitTextGlyphs('、。，．'));
export const YAKUMONO_OFFSET_EM = 0.3;

/**
 * Every glyph placement of a vertical raster, in reading order
 * (column 0 first — the rightmost column — glyphs top → bottom).
 * Both drawing paths iterate this list and fillText each glyph at
 * (x, y) with centre alignment, so their output is the same
 * picture by construction.
 *
 * `adjustments` carries the Phase BK opt-ins: kinsoku is handed
 * to the column split, yakumono shifts the correction-table
 * glyphs inside their cells. Omitted / both off, the placements
 * are exactly the Phase BG ones.
 *
 * With tate-chu-yoko or ruby on (Phase BP), the placements are
 * built from the token layout instead: a run is one placement
 * whose glyph is the whole run string, carrying its font scale;
 * ruby glyphs are extra placements along the parent's right
 * side, spread evenly over the parent span (the span uses
 * verticalGlyphAdvance via the centre-Y function, and the ruby
 * x is cell-based — a yakumono shift of the parent does not
 * propagate to its ruby). With both BP adjustments off this
 * token path is not entered at all.
 */
export function verticalGlyphPlacements(
  text: string,
  columnLength: number,
  metrics: VerticalTextMetrics,
  adjustments?: TextColumnAdjustments,
): VerticalGlyphPlacement[] {
  const yakumono = adjustments?.yakumono === true;
  if (adjustments?.tatechuyoko !== true && adjustments?.ruby !== true) {
    const columns = layoutTextColumns(text, columnLength, adjustments?.kinsoku === true);
    const placements: VerticalGlyphPlacement[] = [];
    columns.forEach((column, columnIndex) => {
      const glyphs = splitTextGlyphs(column);
      const x = verticalColumnCenterX(columnIndex, columns.length, metrics);
      glyphs.forEach((glyph, glyphIndex) => {
        const offset = yakumono && YAKUMONO_OFFSET_GLYPHS.has(glyph) ? metrics.pxSize * YAKUMONO_OFFSET_EM : 0;
        placements.push({
          glyph,
          x: x + offset,
          y: verticalGlyphCenterY(glyphIndex, glyphs.length, metrics) - offset,
          column: columnIndex,
          index: glyphIndex,
        });
      });
    });
    return placements;
  }
  const tokenColumns = layoutTextColumnsTokenized(text, columnLength, adjustments);
  return verticalGlyphPlacementsFromTokenColumns(tokenColumns, metrics, adjustments);
}

/**
 * Placements of an already-split token column list (Phase BP
 * placement rules, shared with lib/textPageLayout.ts): column 0
 * is the rightmost column, tokens run top → bottom, a
 * tate-chu-yoko run is one placement carrying its font scale,
 * and ruby glyphs are extra placements along the parent's right
 * side. `verticalGlyphPlacements` builds its token path on this
 * exact function, so a caller that supplies the unmodified
 * layout columns gets bit-identical placements.
 */
export function verticalGlyphPlacementsFromTokenColumns(
  tokenColumns: LayoutToken[][],
  metrics: VerticalTextMetrics,
  adjustments?: TextColumnAdjustments,
): VerticalGlyphPlacement[] {
  const yakumono = adjustments?.yakumono === true;
  const placements: VerticalGlyphPlacement[] = [];
  tokenColumns.forEach((tokens, columnIndex) => {
    const x = verticalColumnCenterX(columnIndex, tokenColumns.length, metrics);
    tokens.forEach((token, tokenIndex) => {
      const offset = yakumono && YAKUMONO_OFFSET_GLYPHS.has(token.text) ? metrics.pxSize * YAKUMONO_OFFSET_EM : 0;
      const placement: VerticalGlyphPlacement = {
        glyph: token.text,
        x: x + offset,
        y: verticalGlyphCenterY(tokenIndex, tokens.length, metrics) - offset,
        column: columnIndex,
        index: tokenIndex,
      };
      if (token.squeeze !== undefined) placement.squeeze = token.squeeze;
      placements.push(placement);
    });
    // Ruby annotations of this column: one placement per ruby
    // glyph, spread evenly over the parent span.
    let scan = 0;
    while (scan < tokens.length) {
      const token = tokens[scan];
      if (token.ruby === undefined || token.groupId === undefined) {
        scan += 1;
        continue;
      }
      let end = scan;
      while (end + 1 < tokens.length && tokens[end + 1].groupId === token.groupId) end += 1;
      const rubyGlyphs = splitTextGlyphs(token.ruby);
      const spanTop = verticalGlyphCenterY(scan, tokens.length, metrics) - metrics.pxSize / 2;
      const spanBottom = verticalGlyphCenterY(end, tokens.length, metrics) + metrics.pxSize / 2;
      rubyGlyphs.forEach((glyph, j) => {
        placements.push({
          glyph,
          x: x + metrics.pxSize * RUBY_OFFSET_EM,
          y: spanTop + ((j + 0.5) / rubyGlyphs.length) * (spanBottom - spanTop),
          column: columnIndex,
          index: scan,
          scale: RUBY_SCALE,
          ruby: true,
        });
      });
      scan = end + 1;
    }
  });
  return placements;
}

/**
 * Minimum column gap (em ratio) while ruby is on (Phase 30):
 * a ruby column's right edge sits at the parent centre +
 * 1.0em (RUBY_OFFSET_EM 0.75 + the ruby half width 0.25),
 * and the neighbouring column's glyphs start at centre +
 * step − 0.5em. A step of 1.6em (gap 0.6) leaves a 0.1em
 * clearance; the BP default gap 0.4 (step 1.4em) overlapped
 * the neighbour by 0.1em.
 */
export const RUBY_MIN_COLUMN_GAP = 0.6;

/**
 * Fit a vertical raster's metrics to its text (Phase 30): the
 * shared correction both drawing paths apply before placing
 * glyphs, so their pictures stay identical by construction.
 *
 * 1. Ruby clearance: with ruby on, the column gap is raised
 *    to at least RUBY_MIN_COLUMN_GAP (see above).
 * 2. Block fit: when the tallest column is higher than the
 *    usable height, or the drawn column block is wider than
 *    the usable width, pxSize shrinks by the exact factor
 *    that makes the block fit. Content that already fits
 *    returns the metrics object UNCHANGED (identity) — the
 *    correction only ever touches layouts that previously
 *    overflowed off-canvas.
 *
 * `maxDrawnColumns` bounds the width fit for the paged path
 * (a page draws at most that many columns); omit it when the
 * whole column list is drawn. The cell counts come from the
 * same split the placements use (tokens while a BP adjustment
 * is on, glyphs otherwise; kinsoku pull-ins included, since
 * the real split is measured).
 */
export function fitVerticalTextMetrics(
  text: string,
  columnLength: number,
  metrics: VerticalTextMetrics,
  adjustments?: TextColumnAdjustments,
  maxDrawnColumns?: number,
): VerticalTextMetrics {
  let fitted = metrics;
  if (adjustments?.ruby === true && normalizeRatio(metrics.columnGap) < RUBY_MIN_COLUMN_GAP) {
    fitted = { ...fitted, columnGap: RUBY_MIN_COLUMN_GAP };
  }
  const tokenMode = adjustments?.tatechuyoko === true || adjustments?.ruby === true;
  const columns = tokenMode
    ? layoutTextColumnsTokenized(text, columnLength, adjustments)
    : layoutTextColumns(text, columnLength, adjustments?.kinsoku === true)
      .map((column) => splitTextGlyphs(column));
  if (columns.length === 0) return fitted;
  const maxCells = columns.reduce((max, column) => Math.max(max, column.length), 0);
  const drawnColumns = Math.max(1, Math.min(
    columns.length,
    maxDrawnColumns !== undefined && Number.isFinite(maxDrawnColumns) && maxDrawnColumns >= 1
      ? Math.floor(maxDrawnColumns)
      : columns.length,
  ));
  const padding = Number.isFinite(fitted.padding) ? fitted.padding : 0;
  const usableHeight = fitted.height * (1 - padding * 2);
  const usableWidth = fitted.width * (1 - padding * 2);
  let scale = 1;
  const columnHeight = verticalColumnHeight(maxCells, fitted);
  if (columnHeight > usableHeight && columnHeight > 0) {
    scale = Math.min(scale, usableHeight / columnHeight);
  }
  const blockWidth = verticalColumnsWidth(drawnColumns, fitted);
  if (blockWidth > usableWidth && blockWidth > 0) {
    scale = Math.min(scale, usableWidth / blockWidth);
  }
  if (scale < 1) {
    fitted = { ...fitted, pxSize: Math.max(1, fitted.pxSize * scale) };
  }
  return fitted;
}
