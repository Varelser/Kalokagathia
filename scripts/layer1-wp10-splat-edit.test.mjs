// Layer 1 WP10 Phase D1 — S8 splat column edit grammar.
//
// The surface decision is deferred (Phase D material,
// branch 1 = option (c)); D1 lands the grammar only, in
// lib/gpgpuSplatEdit.ts: selection / delete / duplicate /
// transforms over the columns store's rows, as pure
// functions. An edit is a row-level operation on the
// retained source table, rebuilt through buildSplatColumns
// (the single conversion point). Pinned here (node side):
//  (a) selection: predicate / channel range / index range /
//      explicit indices / inversion, over resolved values;
//  (b) the invariants: input never mutated (payloads and
//      source table), every source column preserved in
//      order, untouched columns verbatim (nulls included),
//      result version = source + 1, empty selection is the
//      identity no-op;
//  (c) delete / duplicate semantics, the empty result, and
//      the row cap at the rebuild;
//  (d) transforms apply to the EFFECTIVE splat: touched
//      channels are materialised from the payloads first
//      (ragged cells resolve before the transform), missing
//      channel columns are appended under canonical names,
//      positional-fallback tables edit in place;
//  (e) rebuild compatibility: an edited set's payloads are
//      exactly buildSplatColumns(its table)'s payloads, and
//      the C3 consumers (textures, instance coords, sort
//      twin) accept the result unchanged.
// No wiring is pinned: the grammar writes no store and no
// persistence. The edit surface itself is a later decision.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp10d1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const arrApprox = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => approx(v, b[i], eps));
const arrExact = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const setEq = (s, arr) => s.size === arr.length && arr.every((v) => s.has(v));

await build({
  stdin: {
    contents: `
      export {
        SPLAT_COLUMNS_MAX_ROWS,
        parseSplatColumns, buildSplatColumns, createSplatColumnsTextures,
        buildSplatInstanceTexCoords, splatColumnsSortEntry,
      } from './lib/gpgpuSplatColumns.ts';
      export {
        splatRowView, splatChannelValue,
        emptySplatSelection, allSplatRows, sanitizeSplatSelection,
        selectSplatRows, selectSplatRowIndices, selectSplatRowRange,
        selectSplatChannelRange, invertSplatSelection,
        deleteSplatRows, duplicateSplatRows,
        translateSplatRows, rotateSplatRows, scaleSplatRows,
        setSplatOpacity, multiplySplatOpacity, multiplySplatColor,
      } from './lib/gpgpuSplatEdit.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    SPLAT_COLUMNS_MAX_ROWS,
    parseSplatColumns, buildSplatColumns, createSplatColumnsTextures,
    buildSplatInstanceTexCoords, splatColumnsSortEntry,
    splatRowView, splatChannelValue,
    emptySplatSelection, allSplatRows, sanitizeSplatSelection,
    selectSplatRows, selectSplatRowIndices, selectSplatRowRange,
    selectSplatChannelRange, invertSplatSelection,
    deleteSplatRows, duplicateSplatRows,
    translateSplatRows, rotateSplatRows, scaleSplatRows,
    setSplatOpacity, multiplySplatOpacity, multiplySplatColor,
  } = m;

  const texel = (arr, i) => [arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]];
  const snapshot = (cols) => JSON.stringify({
    table: cols.table, count: cols.count, texSize: cols.texSize,
    hasColor: cols.hasColor, version: cols.version,
    center: Array.from(cols.centerData), param: Array.from(cols.paramData),
    rot: Array.from(cols.rotData), color: Array.from(cols.colorData),
  });
  // (e) the edited set is exactly what the single conversion
  // point builds from its own retained table.
  const rebuildsIdentically = (cols) => {
    const again = buildSplatColumns(cols.table);
    return !!again && again.count === cols.count && again.texSize === cols.texSize
      && again.hasColor === cols.hasColor
      && arrExact(Array.from(again.centerData), Array.from(cols.centerData))
      && arrExact(Array.from(again.paramData), Array.from(cols.paramData))
      && arrExact(Array.from(again.rotData), Array.from(cols.rotData))
      && arrExact(Array.from(again.colorData), Array.from(cols.colorData));
  };
  const columnsPreserved = (src, out) =>
    src.table.columns.every((name, i) => out.table.columns[i] === name);

  const FULL_CSV = [
    'x,y,z,scaleX,scaleY,scaleZ,quatX,quatY,quatZ,quatW,opacity,colorR,colorG,colorB,note',
    '1,2,3,0.5,0.6,0.7,0,0,0,2,0.25,2.5,0.5,0.25,10',
    '-1,0.5,4,1.5,1.5,1.5,0,0,0.70710678,0.70710678,1.7,0.1,0.2,0.3,20',
    '0,0,0,2,2,2,0,0,0,0,0,1,1,1,30',
    '5,-5,2.5,0.25,0.5,0.75,1,0,0,0,-0.5,0,0,0,40',
    '3,3,3,1,1,1,0,1,0,0,0.5,0.9,0.8,0.7,50',
  ].join('\n');
  const base = parseSplatColumns(FULL_CSV, 7);
  check('base parses (5 rows, colour, extra note column)', !!base && base.count === 5 && base.hasColor === true);
  const baseSnap = snapshot(base);

  // ── (a) selection ──────────────────────────────────────
  const view0 = splatRowView(base, 0);
  check('row view carries the resolved payload values',
    arrApprox(view0.center, [1, 2, 3]) && arrApprox(view0.scale, [0.5, 0.6, 0.7])
      && arrApprox(view0.quat, [0, 0, 0, 1]) && approx(view0.opacity, 0.25)
      && arrApprox(view0.color, [2.5, 0.5, 0.25]) && view0.row === base.table.rows[0]);
  check('channel value reads the view',
    approx(splatChannelValue(view0, 'z'), 3) && approx(splatChannelValue(view0, 'opacity'), 0.25)
      && approx(splatChannelValue(view0, 'colorR'), 2.5));
  check('predicate selection over resolved opacity (clamped at build)',
    setEq(selectSplatRows(base, (r) => r.opacity < 0.3), [0, 2, 3]));
  check('channel range selection (x in [0, 3])',
    setEq(selectSplatChannelRange(base, 'x', 0, 3), [0, 2, 4]));
  check('index range selection [1, 4) and open-ended range',
    setEq(selectSplatRowRange(base, 1, 4), [1, 2, 3]) && setEq(selectSplatRowRange(base, 3), [3, 4]));
  check('explicit indices are sanitised (dupes, out of range dropped)',
    setEq(selectSplatRowIndices(base, [4, 0, 0, 99, -1, 2.9]), [0, 2, 4]));
  check('sanitize keeps only real rows',
    setEq(sanitizeSplatSelection(base, [1, 5, -2]), [1]));
  check('inversion is the complement within the set',
    setEq(invertSplatSelection(base, new Set([0, 2])), [1, 3, 4]));
  check('all / empty selections',
    allSplatRows(base).size === 5 && emptySplatSelection().size === 0);

  // ── (b) empty selection is the identity ────────────────
  const none = emptySplatSelection();
  check('empty selection: every operation returns the input itself',
    deleteSplatRows(base, none) === base && duplicateSplatRows(base, none) === base
      && translateSplatRows(base, none, [1, 1, 1]) === base
      && rotateSplatRows(base, none, [0, 0, 1, 0]) === base
      && scaleSplatRows(base, none, [2, 2, 2]) === base
      && setSplatOpacity(base, none, 0.5) === base
      && multiplySplatOpacity(base, none, 2) === base
      && multiplySplatColor(base, none, [2, 2, 2]) === base);

  // ── (c) delete ─────────────────────────────────────────
  const deleted = deleteSplatRows(base, new Set([1]));
  check('delete removes the row and keeps the order of the rest',
    !!deleted && deleted.count === 4
      && arrApprox(texel(deleted.centerData, 0), [1, 2, 3, 1])
      && arrApprox(texel(deleted.centerData, 1), [0, 0, 0, 1])
      && arrApprox(texel(deleted.centerData, 2), [5, -5, 2.5, 1])
      && arrApprox(texel(deleted.centerData, 3), [3, 3, 3, 1]));
  check('delete: every source column preserved, untouched columns follow their rows',
    !!deleted && arrExact(deleted.table.columns, base.table.columns)
      && arrExact(deleted.table.rows.map((r) => r[14]), [10, 30, 40, 50]));
  check('delete: version bumps by one', !!deleted && deleted.version === 8);
  check('delete: result rebuilds identically', !!deleted && rebuildsIdentically(deleted));
  check('delete all rows returns null', deleteSplatRows(base, allSplatRows(base)) === null);

  // Untouched columns keep nulls verbatim; the surviving
  // rows' derivation follows the edited table (documented
  // hold-previous re-derivation).
  const raggedNote = buildSplatColumns({
    columns: ['x', 'y', 'note'],
    rows: [[4, 5, 1], [null, 6, null], [7, 8, 3]],
    mins: [4, 5, 1],
    maxs: [7, 8, 3],
  });
  const raggedDeleted = deleteSplatRows(raggedNote, new Set([0]));
  check('delete: nulls in untouched columns survive verbatim',
    !!raggedDeleted && raggedDeleted.count === 2
      && raggedDeleted.table.rows[0][2] === null && raggedDeleted.table.rows[1][2] === 3
      && arrApprox(texel(raggedDeleted.centerData, 1), [7, 8, 0, 1]));

  // ── (c) duplicate ──────────────────────────────────────
  const duplicated = duplicateSplatRows(base, new Set([2, 0]));
  check('duplicate appends copies in row order',
    !!duplicated && duplicated.count === 7
      && arrApprox(texel(duplicated.centerData, 5), texel(base.centerData, 0))
      && arrApprox(texel(duplicated.centerData, 6), texel(base.centerData, 2))
      && arrApprox(texel(duplicated.paramData, 5), texel(base.paramData, 0))
      && arrApprox(texel(duplicated.rotData, 6), texel(base.rotData, 2))
      && arrApprox(texel(duplicated.colorData, 5), texel(base.colorData, 0)));
  check('duplicate: appended rows carry their source row cells',
    !!duplicated && arrExact(duplicated.table.rows.map((r) => r[14]), [10, 20, 30, 40, 50, 10, 30]));
  check('duplicate: result rebuilds identically', !!duplicated && rebuildsIdentically(duplicated));
  const bigTable = {
    columns: ['x', 'y'],
    rows: Array.from({ length: SPLAT_COLUMNS_MAX_ROWS }, (_, i) => [i, i + 1]),
    mins: [0, 1],
    maxs: [SPLAT_COLUMNS_MAX_ROWS - 1, SPLAT_COLUMNS_MAX_ROWS],
  };
  const bigBase = buildSplatColumns(bigTable);
  const bigDup = duplicateSplatRows(bigBase, new Set([0]));
  check('duplicate at the cap keeps the count at the cap (rebuild truncates)',
    !!bigDup && bigDup.count === SPLAT_COLUMNS_MAX_ROWS, String(bigDup?.count));

  // ── (d) translate ──────────────────────────────────────
  const moved = translateSplatRows(base, new Set([0, 4]), [10, -1, 0.5]);
  check('translate shifts only the selected centres',
    !!moved && arrApprox(texel(moved.centerData, 0), [11, 1, 3.5, 1])
      && arrApprox(texel(moved.centerData, 4), [13, 2, 3.5, 1])
      && arrExact(Array.from(moved.centerData.slice(4, 16)), Array.from(base.centerData.slice(4, 16))));
  check('translate leaves rotation and param payloads untouched',
    !!moved && arrExact(Array.from(moved.rotData), Array.from(base.rotData))
      && arrExact(Array.from(moved.paramData), Array.from(base.paramData)));
  check('translate: no columns appended when x/y/z exist, result rebuilds identically',
    !!moved && arrExact(moved.table.columns, base.table.columns) && rebuildsIdentically(moved));

  // Ragged centre cells: the transform applies to the
  // effective (held) position, and the touched channel is
  // materialised fully numeric.
  const ragged = parseSplatColumns(['x,y', '4,5', ',6', '7,'].join('\n'));
  const raggedMoved = translateSplatRows(ragged, allSplatRows(ragged), [10, 0, 0]);
  check('translate materialises ragged cells to their effective values first',
    !!raggedMoved && arrApprox(texel(raggedMoved.centerData, 0), [14, 5, 0, 1])
      && arrApprox(texel(raggedMoved.centerData, 1), [14, 6, 0, 1])
      && arrApprox(texel(raggedMoved.centerData, 2), [17, 6, 0, 1])
      && raggedMoved.table.rows.every((r) => typeof r[0] === 'number'));

  // A missing z channel is appended under its canonical
  // name; a positional-fallback table edits in place.
  const flat = parseSplatColumns(['x,y', '1,2', '3,4'].join('\n'));
  const lifted = translateSplatRows(flat, new Set([0]), [0, 0, 7]);
  check('translate appends a missing z column and lifts the centre',
    !!lifted && arrExact(lifted.table.columns, ['x', 'y', 'z'])
      && arrApprox(texel(lifted.centerData, 0), [1, 2, 7, 1])
      && arrApprox(texel(lifted.centerData, 1), [3, 4, 0, 1]));
  const positional = parseSplatColumns(['1,2,3', '4,5,6'].join('\n'));
  const positionalMoved = translateSplatRows(positional, new Set([0]), [1, 1, 1]);
  check('positional-fallback table edits in place (no columns appended)',
    !!positionalMoved && arrExact(positionalMoved.table.columns, positional.table.columns)
      && arrApprox(texel(positionalMoved.centerData, 0), [2, 3, 4, 1]));

  // ── (d) rotate ─────────────────────────────────────────
  const SQ = Math.SQRT1_2;
  const turned = rotateSplatRows(base, new Set([0]), [0, 0, SQ, SQ]);
  check('rotate moves the centre on the rotation and premultiplies the orientation',
    !!turned && arrApprox(texel(turned.centerData, 0), [-2, 1, 3, 1], 1e-5)
      && arrApprox(texel(turned.rotData, 0), [0, 0, SQ, SQ], 1e-5));
  check('rotate leaves unselected rows bit-identical',
    !!turned && arrExact(Array.from(turned.centerData.slice(4)), Array.from(base.centerData.slice(4)))
      && arrExact(Array.from(turned.rotData.slice(4)), Array.from(base.rotData.slice(4))));
  const turnedTwice = rotateSplatRows(base, new Set([1]), [0, 0, SQ, SQ]);
  check('rotate composes with an existing orientation (90z over 90z = 180z)',
    !!turnedTwice && arrApprox(texel(turnedTwice.rotData, 1), [0, 0, 1, 0], 1e-5)
      && arrApprox(texel(turnedTwice.centerData, 1), [-0.5, -1, 4, 1], 1e-5));
  const pivotBase = parseSplatColumns(['x,y', '2,0'].join('\n'));
  const pivoted = rotateSplatRows(pivotBase, new Set([0]), [0, 0, SQ, SQ], [1, 0, 0]);
  check('rotate honours the pivot', !!pivoted && arrApprox(texel(pivoted.centerData, 0), [1, 1, 0, 1], 1e-5));
  check('rotate: result rebuilds identically', !!turned && rebuildsIdentically(turned));

  // ── (d) scale ──────────────────────────────────────────
  const scaled = scaleSplatRows(base, new Set([3]), [2, 3, 4]);
  check('scale multiplies centre offsets and the per-axis scale channels',
    !!scaled && arrApprox(texel(scaled.centerData, 3), [10, -15, 10, 1])
      && arrApprox(texel(scaled.paramData, 3), [0.5, 1.5, 3, 0]));
  check('scale leaves unselected rows bit-identical',
    !!scaled && arrExact(Array.from(scaled.centerData.slice(0, 12)), Array.from(base.centerData.slice(0, 12))));
  const uniformScale = parseSplatColumns(['x,y,scale', '0,0,2', '3,4,5'].join('\n'));
  const uniformScaled = scaleSplatRows(uniformScale, new Set([0]), [2, 2, 2]);
  check('scale on a uniform-scale table appends per-axis columns with resolved values',
    !!uniformScaled && columnsPreserved(uniformScale, uniformScaled)
      && arrExact(uniformScaled.table.columns, ['x', 'y', 'scale', 'z', 'scaleX', 'scaleY', 'scaleZ'])
      && arrApprox(texel(uniformScaled.paramData, 0), [4, 4, 4, 1])
      && arrApprox(texel(uniformScaled.paramData, 1), [5, 5, 5, 1])
      && rebuildsIdentically(uniformScaled));

  // ── (d) opacity / colour ───────────────────────────────
  const opSet = setSplatOpacity(base, new Set([2]), 0.3);
  check('set opacity writes the selected row only',
    !!opSet && approx(opSet.paramData[2 * 4 + 3], 0.3)
      && arrExact(Array.from(opSet.paramData.slice(0, 8)), Array.from(base.paramData.slice(0, 8))));
  const opMul = multiplySplatOpacity(base, new Set([0, 4]), 3);
  check('multiply opacity applies to the effective value, payload clamp at the rebuild',
    !!opMul && approx(opMul.paramData[0 * 4 + 3], 0.75) && approx(opMul.paramData[4 * 4 + 3], 1));
  const colMul = multiplySplatColor(base, new Set([0]), [2, 1, 0.5]);
  check('multiply colour is RAW (never clamped)',
    !!colMul && arrApprox(texel(colMul.colorData, 0), [5, 0.5, 0.125, 1])
      && arrExact(Array.from(colMul.colorData.slice(4)), Array.from(base.colorData.slice(4))));
  const plain = parseSplatColumns(['x,y', '0,0', '1,1'].join('\n'));
  const plainColored = multiplySplatColor(plain, new Set([1]), [0.5, 0.25, 2]);
  check('colour edit on a colourless table appends the colour columns and gains hasColor',
    !!plainColored && plainColored.hasColor === true
      && arrExact(plainColored.table.columns, ['x', 'y', 'colorR', 'colorG', 'colorB'])
      && arrApprox(texel(plainColored.colorData, 0), [1, 1, 1, 1])
      && arrApprox(texel(plainColored.colorData, 1), [0.5, 0.25, 2, 1])
      && rebuildsIdentically(plainColored));

  // ── (e) consumers accept an edited set ─────────────────
  const editedTex = createSplatColumnsTextures(moved);
  check('edited set feeds the payload textures verbatim',
    editedTex.centerTex.image.width === moved.texSize
      && editedTex.centerTex.image.data === moved.centerData
      && editedTex.colorTex.image.data === moved.colorData);
  check('edited set feeds instance coords and the sort twin',
    buildSplatInstanceTexCoords(moved).length === moved.count * 2
      && approx(splatColumnsSortEntry(moved, 0, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).viewZ, -3.5));

  // ── (b) the input survived every operation above ───────
  check('input SplatColumns is bit-identical after all operations', snapshot(base) === baseSnap);

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
