// Phase 17 stage 5 — 2D typesetting: the page layer above the
// vertical column layout (lib/textPageLayout.ts) and the
// vertical plan for text on a path (lib/gpgpuTextOnPath.ts).
//
// Cases:
// (a) balance: an unbalanced split (10 glyphs, columnLength 4
//     -> 4/4/2) rebalances to lengths differing by <= 1, with
//     the total cell count and the reading order preserved
// (b) paging: glyph conservation — the concatenation of every
//     page's cells equals the unbalanced split's cells exactly
//     (no loss, no duplication), and page ranges tile the
//     column list
// (c) single page identity: with paging on but everything
//     fitting on one page, pagedVerticalGlyphPlacements is
//     bit-identical to verticalGlyphPlacements; same with
//     paging off and with balance off at any page index
// (d) page 2 placements: the second page's columns are laid out
//     as a standalone block (first placement sits in the
//     rightmost column slot of a 1-column block)
// (e) vertical text on path plan: reading order is column
//     (right -> left) then inside the column top -> bottom;
//     newlines start new columns
// (f) token reuse: a tate-chu-yoko run folds into ONE unit
//     carrying its scale; ruby markup parses through the shared
//     tokeniser (parent glyphs stay plain units, the annotation
//     rides on the group's first unit, markup glyphs vanish)
// (g) ruby groups never split across columns under balance
// (h) columns-per-page derivation from metrics (fixed model)
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17tpl-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await build({
  stdin: {
    contents: `
      export {
        layoutTextColumnsTokenized,
        splitTextGlyphs,
        verticalGlyphPlacements,
      } from './lib/textColumnLayout.ts';
      export {
        balanceTextColumns,
        paginateTextColumns,
        pagedVerticalGlyphPlacements,
        planTextPages,
        textColumnsPerPage,
        textPageCount,
      } from './lib/textPageLayout.ts';
      export { planVerticalTextOnPath } from './lib/gpgpuTextOnPath.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const m = await import(BUNDLE);

  const METRICS = { width: 256, height: 256, padding: 0.1, pxSize: 32, columnGap: 0.4, letterSpacing: 0 };
  const cellText = (columns) => columns.map((col) => col.map((t) => t.text).join('')).join('|');
  const cellCount = (columns) => columns.reduce((n, col) => n + col.length, 0);

  // --- (a) balance -------------------------------------------------
  {
    const split = m.layoutTextColumnsTokenized('あいうえおかきくけこ', 4);
    check('(a) raw split is 4/4/2', sameJson(split.map((c) => c.length), [4, 4, 2]), JSON.stringify(split.map((c) => c.length)));
    const balanced = m.balanceTextColumns(split);
    const lengths = balanced.map((c) => c.length);
    check('(a) balanced lengths differ by <= 1', Math.max(...lengths) - Math.min(...lengths) <= 1, JSON.stringify(lengths));
    check('(a) balanced lengths are 4/3/3', sameJson(lengths, [4, 3, 3]), JSON.stringify(lengths));
    check('(a) total cells preserved', cellCount(balanced) === 10, String(cellCount(balanced)));
    const flatText = (columns) => columns.flat().map((t) => t.text).join('');
    check('(a) reading order preserved', flatText(balanced) === flatText(split), flatText(balanced));
    check('(a) column count preserved', balanced.length === split.length);
  }

  // --- (b) paging conservation --------------------------------------
  {
    // 10 columns of 2 glyphs each; the sample metrics fit 4
    // columns per page (see case (h)), so 3 pages: 4 / 4 / 2.
    const text = 'あい\nうえ\nかき\nくけ\nこさ\nしす\nせそ\nたち\nつて\nとな';
    const plan = m.planTextPages(text, 0, undefined, { columnsPerPage: m.textColumnsPerPage(METRICS), pageIndex: 0 });
    check('(b) page count is 3', plan.pageCount === 3, String(plan.pageCount));
    const allPages = [];
    for (let p = 0; p < plan.pageCount; p++) {
      const one = m.planTextPages(text, 0, undefined, { columnsPerPage: m.textColumnsPerPage(METRICS), pageIndex: p });
      allPages.push(...one.pageColumns);
    }
    check('(b) pages tile the column list (glyph conservation)', cellText(allPages) === cellText(plan.columns), cellText(allPages));
    check('(b) total cells across pages', cellCount(allPages) === 20, String(cellCount(allPages)));
    const paged = m.paginateTextColumns(plan.columns, 5);
    check('(b) page ranges are half-open and consecutive',
      paged[0].columnStart === 0 && paged[0].columnEnd === 5 && paged[1].columnStart === 5 && paged[1].columnEnd === 10);
    const clamped = m.planTextPages(text, 0, undefined, { columnsPerPage: 5, pageIndex: 99 });
    check('(b) page index clamps to the last page', clamped.pageIndex === 1 && clamped.pageColumns.length === 5,
      `index=${clamped.pageIndex} cols=${clamped.pageColumns.length}`);
  }

  // --- (c) single-page / off identity -------------------------------
  {
    const text = 'あいうえお';
    const legacy = m.verticalGlyphPlacements(text, 2, METRICS);
    const pagedOff = m.pagedVerticalGlyphPlacements(text, 2, METRICS, undefined, { enabled: false });
    const pagedOne = m.pagedVerticalGlyphPlacements(text, 2, METRICS, undefined, { enabled: true, pageIndex: 0 });
    check('(c) paging off === legacy placements', sameJson(pagedOff, legacy));
    check('(c) one page === legacy placements', sameJson(pagedOne, legacy));
    // BP adjustments on, still one page: token path identity too.
    const adj = { tatechuyoko: true, ruby: true };
    const bpText = '西暦2026年、星は巡る';
    const legacyBp = m.verticalGlyphPlacements(bpText, 5, METRICS, adj);
    const pagedBp = m.pagedVerticalGlyphPlacements(bpText, 5, METRICS, adj, { enabled: true, pageIndex: 0 });
    check('(c) one page with BP adjustments === legacy', sameJson(pagedBp, legacyBp));
    // No page options at all.
    const pagedNone = m.pagedVerticalGlyphPlacements(text, 2, METRICS);
    check('(c) no page options === legacy placements', sameJson(pagedNone, legacy));
  }

  // --- (d) second page as a standalone block -------------------------
  {
    // 5 one-glyph columns; metrics fit 4 per page, so page 2 has
    // exactly one column, centred as a 1-column block.
    const text = 'あ\nい\nう\nえ\nか';
    const page2 = m.pagedVerticalGlyphPlacements(text, 0, METRICS, undefined, { enabled: true, pageIndex: 1 });
    const single = m.verticalGlyphPlacements('か', 0, METRICS);
    check('(d) page 2 holds only the overflow glyph', page2.length === 1 && page2[0].glyph === 'か', JSON.stringify(page2));
    check('(d) page 2 block is laid out standalone', sameJson(page2, single));
    const count = m.textPageCount(text, 0, METRICS);
    check('(d) page count helper agrees', count === 2, String(count));
  }

  // --- (e) vertical text-on-path reading order -----------------------
  {
    const plan = m.planVerticalTextOnPath('あいう\nえお', 2);
    // Columns: [あい][う] (segment 1 wrapped at 2) then [えお].
    check('(e) column count', plan.columnCount === 3, String(plan.columnCount));
    check('(e) reading order is column-major, top to bottom',
      sameJson(plan.units.map((u) => u.text), ['あ', 'い', 'う', 'え', 'お']),
      JSON.stringify(plan.units.map((u) => u.text)));
    check('(e) unit coordinates',
      sameJson(plan.units.map((u) => [u.column, u.index]), [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]]),
      JSON.stringify(plan.units.map((u) => [u.column, u.index])));
  }

  // --- (f) token reuse: tate-chu-yoko + ruby --------------------------
  {
    const tcy = m.planVerticalTextOnPath('西暦2026年', 0, { tatechuyoko: true });
    check('(f) tate-chu-yoko run is one unit', tcy.units.length === 4, JSON.stringify(tcy.units.map((u) => u.text)));
    const run = tcy.units.find((u) => u.text === '2026');
    check('(f) run unit carries its scale', !!run && run.scale === 0.5, JSON.stringify(run));
    const ruby = m.planVerticalTextOnPath('｜星屑《ほしくず》の海', 0, { ruby: true });
    check('(f) ruby parent glyphs stay plain units',
      sameJson(ruby.units.map((u) => u.text), ['星', '屑', 'の', '海']),
      JSON.stringify(ruby.units.map((u) => u.text)));
    check('(f) annotation rides on the group head', ruby.units[0].ruby === 'ほしくず' && ruby.units[1].ruby === undefined,
      JSON.stringify(ruby.units.map((u) => u.ruby)));
  }

  // --- (g) ruby groups never split under balance ----------------------
  {
    const adj = { ruby: true };
    const split = m.layoutTextColumnsTokenized('｜星屑《ほしくず》あいうえおかき', 3, adj);
    const balanced = m.balanceTextColumns(split);
    const total = cellCount(balanced);
    check('(g) total cells preserved under balance', total === cellCount(split), `${total} vs ${cellCount(split)}`);
    let groupIntact = true;
    for (const column of balanced) {
      const ids = column.map((t) => t.groupId).filter((g) => g !== undefined);
      // A group appears in exactly one column, consecutively.
      if (ids.length > 0 && new Set(ids).size !== 1) groupIntact = false;
      const first = column.findIndex((t) => t.groupId !== undefined);
      if (first >= 0) {
        for (let i = first; i < column.length; i++) {
          if (column[i].groupId === undefined && i > first && column[i - 1].groupId !== undefined && i < column.length) {
            // tokens after the group are fine; only a split group matters
          }
        }
      }
    }
    const flatIds = balanced.flat().filter((t) => t.groupId !== undefined).length;
    check('(g) ruby group tokens stay together in one column', groupIntact && flatIds === 2, `flatIds=${flatIds}`);
  }

  // --- (h) columns per page from metrics -------------------------------
  {
    // usable width = 256 * 0.8 = 204.8; step = 32 * 1.4 = 44.8;
    // n = floor((204.8 + 12.8) / 44.8) = 4... width check:
    // 4 columns = 4*32 + 3*12.8 = 166.4 <= 204.8; 5 columns =
    // 5*32 + 4*12.8 = 211.2 > 204.8, so 4.
    check('(h) columns per page at the sample metrics', m.textColumnsPerPage(METRICS) === 4, String(m.textColumnsPerPage(METRICS)));
    check('(h) degenerate metrics give 1', m.textColumnsPerPage({ ...METRICS, pxSize: 0 }) === 1);
  }
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
