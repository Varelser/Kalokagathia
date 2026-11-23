/**
 * Text pages (Phase 17): the page layer above the vertical
 * column layout (lib/textColumnLayout.ts). Pure functions only —
 * no canvas, no config reads — exactly like the layer below.
 *
 * The layer below lays a whole string out as ONE raster of
 * columns. This layer adds the two things a long vertical text
 * needs beyond that:
 * - Column balance: the column split (columnLength chunks) can
 *   leave the last column much shorter than the rest. Balancing
 *   redistributes the tokens over the SAME number of columns,
 *   preserving reading order, so the column lengths differ as
 *   little as the token blocks allow.
 * - Paging: a page holds the columns that fit one raster (the
 *   count is derived from the raster metrics — the usable width
 *   divided by the column step). Columns beyond the first page
 *   form further pages, and the drawing paths render only the
 *   selected page's columns, laid out as a standalone column
 *   block by the shared placement function.
 *
 * Identity contract: with paging off, or when everything fits
 * on one page, the drawing paths use the legacy
 * `verticalGlyphPlacements` untouched — the paged placements are
 * only produced for page 2 and beyond (or a balanced split).
 * Balancing runs on TOKENS (one token = one cell), so a
 * tate-chu-yoko run stays a single cell, and a ruby parent group
 * is one indivisible block that never splits across columns.
 * No font measurement anywhere: every size comes from the fixed
 * metrics model of the layer below.
 */
import {
  layoutTextColumnsTokenized,
  verticalGlyphPlacements,
  verticalGlyphPlacementsFromTokenColumns,
  type LayoutToken,
  type TextColumnAdjustments,
  type VerticalGlyphPlacement,
  type VerticalTextMetrics,
} from './textColumnLayout';

/** The page options the drawing paths hand in (from the
 *  layer-2 TextMap page keys). All optional; `enabled` off (or
 *  the whole object omitted) is the legacy layout. */
export interface TextPageOptions {
  enabled?: boolean;
  balance?: boolean;
  pageIndex?: number;
}

function normalizeColumnsPerPage(columnsPerPage: number): number {
  if (!Number.isFinite(columnsPerPage) || columnsPerPage < 1) return 1;
  return Math.floor(columnsPerPage);
}

export function clampTextPageIndex(pageIndex: number, pageCount: number): number {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  if (!Number.isFinite(pageIndex) || pageIndex < 0) return 0;
  return Math.min(count - 1, Math.floor(pageIndex));
}

/**
 * How many columns fit one raster of the given metrics: the
 * largest n whose column block width (n glyph cells plus the
 * gaps between them, the `verticalColumnsWidth` formula) stays
 * inside the usable width (the raster width inset by padding on
 * both sides, the same usable box the layout centres into).
 * Always at least 1.
 */
export function textColumnsPerPage(metrics: VerticalTextMetrics): number {
  const pxSize = metrics.pxSize;
  if (!Number.isFinite(pxSize) || pxSize <= 0) return 1;
  const gap = Number.isFinite(metrics.columnGap) && metrics.columnGap > 0 ? metrics.columnGap : 0;
  const padding = Number.isFinite(metrics.padding) ? Math.max(0, Math.min(0.35, metrics.padding)) : 0;
  const usableWidth = metrics.width * (1 - padding * 2);
  const n = Math.floor((usableWidth + pxSize * gap) / (pxSize * (1 + gap)));
  return Math.max(1, n);
}

interface TokenBlock {
  tokens: LayoutToken[];
}

/** Partition a flat token sequence into indivisible blocks:
 *  a ruby parent group (consecutive tokens sharing a groupId)
 *  is one block; every other token is its own block. */
function tokenBlocks(flat: LayoutToken[]): TokenBlock[] {
  const blocks: TokenBlock[] = [];
  let i = 0;
  while (i < flat.length) {
    const groupId = flat[i].groupId;
    if (groupId === undefined) {
      blocks.push({ tokens: [flat[i]] });
      i += 1;
      continue;
    }
    let end = i;
    while (end + 1 < flat.length && flat[end + 1].groupId === groupId) end += 1;
    blocks.push({ tokens: flat.slice(i, end + 1) });
    i = end + 1;
  }
  return blocks;
}

/**
 * Redistribute a token column list over the same number of
 * columns so the column lengths (in cells) differ as little as
 * the blocks allow, preserving reading order and the total cell
 * count. The per-column targets differ by at most one cell; a
 * block that would straddle a target boundary moves whole to
 * the next column, so a column can only overshoot its target by
 * a block that had nowhere else to go (a ruby group larger than
 * the target, or the final column taking the remainder).
 * Columns that hold no tokens contribute nothing and can
 * disappear from the result's tail; the result never has more
 * columns than the input.
 */
export function balanceTextColumns(columns: LayoutToken[][]): LayoutToken[][] {
  const columnCount = columns.length;
  if (columnCount <= 1) return columns.map((column) => column.slice());
  const flat: LayoutToken[] = [];
  columns.forEach((column) => flat.push(...column));
  const total = flat.length;
  if (total === 0) return columns.map(() => []);
  const base = Math.floor(total / columnCount);
  const rest = total - base * columnCount;
  const targets: number[] = [];
  for (let c = 0; c < columnCount; c++) targets.push(base + (c < rest ? 1 : 0));
  const result: LayoutToken[][] = columns.map(() => []);
  let col = 0;
  let colLength = 0;
  for (const block of tokenBlocks(flat)) {
    if (col < columnCount - 1 && colLength > 0 && colLength + block.tokens.length > targets[col]) {
      col += 1;
      colLength = 0;
    }
    result[col].push(...block.tokens);
    colLength += block.tokens.length;
  }
  return result;
}

/** One page of a paginated column list. `columnStart` /
 *  `columnEnd` are the half-open range into the (possibly
 *  balanced) full column list. */
export interface TextPage<T> {
  index: number;
  columnStart: number;
  columnEnd: number;
  columns: T[][];
}

/** Split a column list into consecutive pages of at most
 *  `columnsPerPage` columns each. An empty column list yields a
 *  single empty page, so the page count is always ≥ 1. */
export function paginateTextColumns<T>(columns: T[][], columnsPerPage: number): TextPage<T>[] {
  const perPage = normalizeColumnsPerPage(columnsPerPage);
  if (columns.length === 0) return [{ index: 0, columnStart: 0, columnEnd: 0, columns: [] }];
  const pages: TextPage<T>[] = [];
  for (let start = 0; start < columns.length; start += perPage) {
    const slice = columns.slice(start, start + perPage);
    pages.push({ index: pages.length, columnStart: start, columnEnd: start + slice.length, columns: slice });
  }
  return pages;
}

/** The full page plan of a vertical text: the (possibly
 *  balanced) column list, its pages, and the selected page. */
export interface TextPagePlan {
  /** Column list after the optional balance (the layout split
   *  itself when balance is off). */
  columns: LayoutToken[][];
  pages: TextPage<LayoutToken>[];
  pageCount: number;
  /** The selected page index, clamped into range. */
  pageIndex: number;
  /** The selected page's columns. */
  pageColumns: LayoutToken[][];
}

export function planTextPages(
  text: string,
  columnLength: number,
  adjustments: TextColumnAdjustments | undefined,
  options: { balance?: boolean; columnsPerPage: number; pageIndex?: number },
): TextPagePlan {
  const split = layoutTextColumnsTokenized(text, columnLength, adjustments);
  const columns = options.balance === true ? balanceTextColumns(split) : split;
  const pages = paginateTextColumns(columns, options.columnsPerPage);
  const pageIndex = clampTextPageIndex(options.pageIndex ?? 0, pages.length);
  return {
    columns,
    pages,
    pageCount: pages.length,
    pageIndex,
    pageColumns: pages[pageIndex].columns,
  };
}

/** Total page count of a vertical text at the given metrics
 *  (what the panel displays next to the page selector). */
export function textPageCount(
  text: string,
  columnLength: number,
  metrics: VerticalTextMetrics,
  adjustments?: TextColumnAdjustments,
  balance?: boolean,
): number {
  return planTextPages(text, columnLength, adjustments, {
    balance,
    columnsPerPage: textColumnsPerPage(metrics),
  }).pageCount;
}

/**
 * The placements the drawing paths use: the legacy
 * `verticalGlyphPlacements` verbatim while paging is off or
 * everything fits on one page (bit-identical to before this
 * layer existed); otherwise the selected page's columns laid
 * out as a standalone block by the shared placement function.
 */
export function pagedVerticalGlyphPlacements(
  text: string,
  columnLength: number,
  metrics: VerticalTextMetrics,
  adjustments?: TextColumnAdjustments,
  page?: TextPageOptions,
): VerticalGlyphPlacement[] {
  if (page?.enabled !== true) {
    return verticalGlyphPlacements(text, columnLength, metrics, adjustments);
  }
  const plan = planTextPages(text, columnLength, adjustments, {
    balance: page.balance,
    columnsPerPage: textColumnsPerPage(metrics),
    pageIndex: page.pageIndex,
  });
  if (plan.pageCount <= 1 && page.balance !== true) {
    return verticalGlyphPlacements(text, columnLength, metrics, adjustments);
  }
  return verticalGlyphPlacementsFromTokenColumns(plan.pageColumns, metrics, adjustments);
}
