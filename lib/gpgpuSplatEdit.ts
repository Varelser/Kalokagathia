import type { DataTable } from './dataTable';
import { ATTR_COLOR_COLUMN_NAMES } from './attrPointCloud';
import {
  buildSplatColumns,
  type SplatColumns,
} from './gpgpuSplatColumns';

// ── Splat column edit grammar (Layer 1 WP10 Phase D1) ─────
// The edit operations for the columns form of the splat
// draw (S8): selection, deletion, duplication and transforms
// over the column store's rows, as pure functions in lib.
// The surface decision (list panel vs direct manipulation)
// is deferred (WP10 Phase D material, branch 1 = option
// (c)); this module is the grammar only — no wiring, no
// panel, no store writes. The caller decides whether a
// result goes back through setSplatColumns.
//
// Shape of an edit: an operation is expressed as a row-level
// operation on the RETAINED SOURCE TABLE (SplatColumns.table
// holds every source column), and the result is rebuilt
// through buildSplatColumns — the single conversion point —
// so an edited set obeys exactly the C3 payload discipline
// (layout, padding, clamps, quaternion normalisation) and
// flows into the draw through the same path as an unedited
// one. Invariants pinned by scripts/layer1-wp10-splat-edit:
//  - Purity: the input SplatColumns (payloads AND source
//    table) is never mutated; a result is a fresh object
//    with version = source version + 1.
//  - Column preservation: every source column survives, in
//    order. Columns an operation does not touch keep their
//    cells verbatim (nulls included).
//  - Materialisation: a channel an operation DOES touch is
//    first materialised to its resolved (payload) values
//    for every row, so the operation applies to the
//    effective splat, not to a raw possibly-null cell. A
//    channel column the table lacks is appended under its
//    canonical name (z / scaleX… / quatX… / opacity /
//    colorR…), holding the resolved values.
//  - Delete / duplicate act on the raw table rows: the
//    table is the document, so the hold-previous derivation
//    of surviving ragged rows follows the table's own
//    semantics after rows are removed or appended.
//  - Row scope: operations act on the first `count` rows —
//    the rows that ARE splats. Source rows past the row cap
//    are not splats and are not carried into an edited
//    table.
//  - No persistence: the grammar holds no storage, mirroring
//    the store's own in-memory-only rule (the source text's
//    persistence belongs to the Layer 3 import side).
//  - An empty selection is a no-op: every operation returns
//    the input object itself.

export type SplatVec3 = readonly [number, number, number];
export type SplatQuat = readonly [number, number, number, number];

/** A set of row indices into a SplatColumns (0 ≤ i < count). */
export type SplatSelection = ReadonlySet<number>;

/** The resolved (payload) values of one splat row — what a
 *  selection predicate sees. `row` is the raw source row. */
export interface SplatRowView {
  index: number;
  center: [number, number, number];
  scale: [number, number, number];
  quat: [number, number, number, number];
  opacity: number;
  color: [number, number, number];
  row: readonly (number | null)[];
}

const texel = (data: Float32Array, i: number): [number, number, number, number] => [
  data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3],
];

/** The resolved view of row `index` (payload values). */
export function splatRowView(columns: SplatColumns, index: number): SplatRowView {
  const center = texel(columns.centerData, index);
  const param = texel(columns.paramData, index);
  const quat = texel(columns.rotData, index);
  const color = texel(columns.colorData, index);
  return {
    index,
    center: [center[0], center[1], center[2]],
    scale: [param[0], param[1], param[2]],
    quat: [quat[0], quat[1], quat[2], quat[3]],
    opacity: param[3],
    color: [color[0], color[1], color[2]],
    row: columns.table.rows[index] ?? [],
  };
}

/* ---------------- selection ---------------- */

export function emptySplatSelection(): SplatSelection {
  return new Set<number>();
}

/** Every row of the set. */
export function allSplatRows(columns: SplatColumns): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < columns.count; i++) out.add(i);
  return out;
}

/** Keep the indices that name a real row of this set. */
export function sanitizeSplatSelection(columns: SplatColumns, indices: Iterable<number>): Set<number> {
  const out = new Set<number>();
  for (const raw of indices) {
    const i = Math.floor(raw);
    if (Number.isFinite(i) && i >= 0 && i < columns.count) out.add(i);
  }
  return out;
}

/** Select the rows a predicate accepts (resolved values). */
export function selectSplatRows(
  columns: SplatColumns,
  predicate: (row: SplatRowView) => boolean,
): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < columns.count; i++) {
    if (predicate(splatRowView(columns, i))) out.add(i);
  }
  return out;
}

/** Select an explicit index list (sanitised to real rows). */
export function selectSplatRowIndices(columns: SplatColumns, indices: Iterable<number>): Set<number> {
  return sanitizeSplatSelection(columns, indices);
}

/** Select the index range [start, end) (end defaults to the
 *  row count; both ends clamp to the set). */
export function selectSplatRowRange(columns: SplatColumns, start: number, end?: number): Set<number> {
  const lo = Math.max(0, Math.floor(start));
  const hi = Math.min(columns.count, end === undefined ? columns.count : Math.floor(end));
  const out = new Set<number>();
  for (let i = lo; i < hi; i++) out.add(i);
  return out;
}

export type SplatChannelName =
  | 'x' | 'y' | 'z'
  | 'scaleX' | 'scaleY' | 'scaleZ'
  | 'opacity'
  | 'colorR' | 'colorG' | 'colorB';

/** One resolved channel value of a row view. */
export function splatChannelValue(row: SplatRowView, channel: SplatChannelName): number {
  switch (channel) {
    case 'x': return row.center[0];
    case 'y': return row.center[1];
    case 'z': return row.center[2];
    case 'scaleX': return row.scale[0];
    case 'scaleY': return row.scale[1];
    case 'scaleZ': return row.scale[2];
    case 'opacity': return row.opacity;
    case 'colorR': return row.color[0];
    case 'colorG': return row.color[1];
    case 'colorB': return row.color[2];
  }
}

/** Select the rows whose resolved channel value lies in
 *  [min, max] (inclusive). */
export function selectSplatChannelRange(
  columns: SplatColumns,
  channel: SplatChannelName,
  min: number,
  max: number,
): Set<number> {
  return selectSplatRows(columns, (row) => {
    const v = splatChannelValue(row, channel);
    return v >= min && v <= max;
  });
}

/** The complement of a selection within this set. */
export function invertSplatSelection(columns: SplatColumns, selection: SplatSelection): Set<number> {
  const keep = sanitizeSplatSelection(columns, selection);
  const out = new Set<number>();
  for (let i = 0; i < columns.count; i++) if (!keep.has(i)) out.add(i);
  return out;
}

/* ---------------- table surgery internals ---------------- */

interface WorkingTable {
  columns: string[];
  rows: (number | null)[][];
}

/** A deep copy of the live rows (first `count`) to edit. */
function workingTable(columns: SplatColumns): WorkingTable {
  return {
    columns: columns.table.columns.slice(),
    rows: columns.table.rows.slice(0, columns.count).map((row) => row.slice()),
  };
}

function findColumn(table: WorkingTable, name: string): number {
  return table.columns.findIndex((c) => c.trim().toLowerCase() === name);
}

/**
 * Write `values` (one resolved value per row) into the
 * channel column `existing` — or append a new column under
 * `appendName` when the table has none — and return the
 * column index. Every row's cell is set, so the channel is
 * fully materialised after the call.
 */
function materializeChannel(
  table: WorkingTable,
  existing: number,
  appendName: string,
  values: ArrayLike<number>,
): number {
  let idx = existing;
  if (idx < 0) {
    table.columns.push(appendName);
    idx = table.columns.length - 1;
  }
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    while (row.length < idx) row.push(null);
    row[idx] = values[i];
  }
  return idx;
}

/** The channel column indices, resolved with exactly the
 *  buildSplatColumns rules (name match, positional fallback
 *  for the centre when x / y are not named). */
function channelColumns(table: WorkingTable) {
  let x = findColumn(table, 'x');
  let y = findColumn(table, 'y');
  let z = findColumn(table, 'z');
  if (x < 0 || y < 0 || x === y) {
    x = 0;
    y = 1;
    z = table.columns.length > 2 ? 2 : -1;
  }
  return {
    x, y, z,
    scaleX: findColumn(table, 'scalex'),
    scaleY: findColumn(table, 'scaley'),
    scaleZ: findColumn(table, 'scalez'),
    quatX: findColumn(table, 'quatx'),
    quatY: findColumn(table, 'quaty'),
    quatZ: findColumn(table, 'quatz'),
    quatW: findColumn(table, 'quatw'),
    opacity: findColumn(table, 'opacity'),
    color: ATTR_COLOR_COLUMN_NAMES.map((name) => findColumn(table, name)),
  };
}

function makeDataTable(columns: string[], rows: (number | null)[][]): DataTable | null {
  if (columns.length === 0 || rows.length === 0) return null;
  const mins = columns.map(() => Infinity);
  const maxs = columns.map(() => -Infinity);
  rows.forEach((row) => {
    row.forEach((value, j) => {
      if (value === null) return;
      if (value < mins[j]) mins[j] = value;
      if (value > maxs[j]) maxs[j] = value;
    });
  });
  return {
    columns,
    rows,
    mins: mins.map((v) => (Number.isFinite(v) ? v : 0)),
    maxs: maxs.map((v) => (Number.isFinite(v) ? v : 0)),
  };
}

/** Rebuild an edited working table through the single
 *  conversion point, at the next version. */
function finishEdit(source: SplatColumns, table: WorkingTable): SplatColumns | null {
  const dataTable = makeDataTable(table.columns, table.rows);
  if (!dataTable) return null;
  return buildSplatColumns(dataTable, source.version + 1);
}

/** The resolved per-row values of one payload channel
 *  component, as a plain array over the live rows. */
function payloadChannel(columns: SplatColumns, data: Float32Array, component: number): number[] {
  const out = new Array<number>(columns.count);
  for (let i = 0; i < columns.count; i++) out[i] = data[i * 4 + component];
  return out;
}

/* ---------------- row set operations ---------------- */

/**
 * Remove the selected rows. Returns null when no rows
 * remain (the empty set has no column form, the
 * buildSplatColumns rule). Surviving rows keep their raw
 * cells, so a ragged column's hold-previous derivation
 * follows the edited table.
 */
export function deleteSplatRows(columns: SplatColumns, selection: SplatSelection): SplatColumns | null {
  const keep = sanitizeSplatSelection(columns, selection);
  if (keep.size === 0) return columns;
  const table = workingTable(columns);
  table.rows = table.rows.filter((_, i) => !keep.has(i));
  return finishEdit(columns, table);
}

/**
 * Append a copy of each selected row (in row order) at the
 * end of the table. The rebuild applies the row cap, so
 * duplicating at the cap keeps the count at the cap.
 */
export function duplicateSplatRows(columns: SplatColumns, selection: SplatSelection): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const table = workingTable(columns);
  const ordered = [...chosen].sort((a, b) => a - b);
  for (const i of ordered) table.rows.push(table.rows[i].slice());
  return finishEdit(columns, table);
}

/* ---------------- transforms ---------------- */

/** Translate the selected rows' centres by `offset`. */
export function translateSplatRows(
  columns: SplatColumns,
  selection: SplatSelection,
  offset: SplatVec3,
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const xs = payloadChannel(columns, columns.centerData, 0);
  const ys = payloadChannel(columns, columns.centerData, 1);
  const zs = payloadChannel(columns, columns.centerData, 2);
  for (const i of chosen) {
    xs[i] += offset[0];
    ys[i] += offset[1];
    zs[i] += offset[2];
  }
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.x, 'x', xs);
  materializeChannel(table, ch.y, 'y', ys);
  materializeChannel(table, ch.z, 'z', zs);
  return finishEdit(columns, table);
}

function normalizeQuat(q: SplatQuat): [number, number, number, number] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len <= 1e-12) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Hamilton product a ⊗ b (apply b, then a). */
function multiplyQuat(a: SplatQuat, b: SplatQuat): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Rotate vector `v` by unit quaternion `q`. */
function rotateVecByQuat(v: SplatVec3, q: SplatQuat): [number, number, number] {
  // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

/**
 * Rotate the selected rows around `pivot` (default the
 * origin) by the quaternion `rotation`: centres move on the
 * rotation, and each splat's orientation is premultiplied
 * (q' = rotation ⊗ q), so the splat turns with the frame.
 */
export function rotateSplatRows(
  columns: SplatColumns,
  selection: SplatSelection,
  rotation: SplatQuat,
  pivot: SplatVec3 = [0, 0, 0],
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const rot = normalizeQuat(rotation);
  const xs = payloadChannel(columns, columns.centerData, 0);
  const ys = payloadChannel(columns, columns.centerData, 1);
  const zs = payloadChannel(columns, columns.centerData, 2);
  const qxs = payloadChannel(columns, columns.rotData, 0);
  const qys = payloadChannel(columns, columns.rotData, 1);
  const qzs = payloadChannel(columns, columns.rotData, 2);
  const qws = payloadChannel(columns, columns.rotData, 3);
  for (const i of chosen) {
    const moved = rotateVecByQuat(
      [xs[i] - pivot[0], ys[i] - pivot[1], zs[i] - pivot[2]],
      rot,
    );
    xs[i] = moved[0] + pivot[0];
    ys[i] = moved[1] + pivot[1];
    zs[i] = moved[2] + pivot[2];
    const composed = multiplyQuat(rot, [qxs[i], qys[i], qzs[i], qws[i]]);
    qxs[i] = composed[0];
    qys[i] = composed[1];
    qzs[i] = composed[2];
    qws[i] = composed[3];
  }
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.x, 'x', xs);
  materializeChannel(table, ch.y, 'y', ys);
  materializeChannel(table, ch.z, 'z', zs);
  materializeChannel(table, ch.quatX, 'quatX', qxs);
  materializeChannel(table, ch.quatY, 'quatY', qys);
  materializeChannel(table, ch.quatZ, 'quatZ', qzs);
  materializeChannel(table, ch.quatW, 'quatW', qws);
  return finishEdit(columns, table);
}

/**
 * Scale the selected rows around `pivot` (default the
 * origin) by per-axis `factors`: centre offsets from the
 * pivot and the per-axis scale channels are multiplied by
 * the same factors. Orientations are unchanged — exact for
 * uniform factors; for non-uniform factors the payload form
 * (Σ = R·diag(s²)·Rᵀ) cannot express the shear a true
 * non-uniform frame scale would induce, so the scale
 * channels take the factors and the orientation stays.
 */
export function scaleSplatRows(
  columns: SplatColumns,
  selection: SplatSelection,
  factors: SplatVec3,
  pivot: SplatVec3 = [0, 0, 0],
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const xs = payloadChannel(columns, columns.centerData, 0);
  const ys = payloadChannel(columns, columns.centerData, 1);
  const zs = payloadChannel(columns, columns.centerData, 2);
  const sxs = payloadChannel(columns, columns.paramData, 0);
  const sys = payloadChannel(columns, columns.paramData, 1);
  const szs = payloadChannel(columns, columns.paramData, 2);
  for (const i of chosen) {
    xs[i] = pivot[0] + (xs[i] - pivot[0]) * factors[0];
    ys[i] = pivot[1] + (ys[i] - pivot[1]) * factors[1];
    zs[i] = pivot[2] + (zs[i] - pivot[2]) * factors[2];
    sxs[i] *= factors[0];
    sys[i] *= factors[1];
    szs[i] *= factors[2];
  }
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.x, 'x', xs);
  materializeChannel(table, ch.y, 'y', ys);
  materializeChannel(table, ch.z, 'z', zs);
  materializeChannel(table, ch.scaleX, 'scaleX', sxs);
  materializeChannel(table, ch.scaleY, 'scaleY', sys);
  materializeChannel(table, ch.scaleZ, 'scaleZ', szs);
  return finishEdit(columns, table);
}

/**
 * Set the selected rows' opacity. The authored value is
 * written verbatim; the rebuild's payload clamp ([0, 1])
 * applies, the C3 convention.
 */
export function setSplatOpacity(
  columns: SplatColumns,
  selection: SplatSelection,
  value: number,
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const opacities = payloadChannel(columns, columns.paramData, 3);
  for (const i of chosen) opacities[i] = value;
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.opacity, 'opacity', opacities);
  return finishEdit(columns, table);
}

/** Multiply the selected rows' opacity by `factor` (the
 *  payload clamp applies at the rebuild). */
export function multiplySplatOpacity(
  columns: SplatColumns,
  selection: SplatSelection,
  factor: number,
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const opacities = payloadChannel(columns, columns.paramData, 3);
  for (const i of chosen) opacities[i] *= factor;
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.opacity, 'opacity', opacities);
  return finishEdit(columns, table);
}

/**
 * Multiply the selected rows' DC colour by per-channel
 * `factors`. Colour values are RAW (the Phase CL rule) and
 * are never clamped. On a table without colour columns the
 * edit appends them (resolved colour 1 per channel), so the
 * result gains hasColor.
 */
export function multiplySplatColor(
  columns: SplatColumns,
  selection: SplatSelection,
  factors: SplatVec3,
): SplatColumns | null {
  const chosen = sanitizeSplatSelection(columns, selection);
  if (chosen.size === 0) return columns;
  const rs = payloadChannel(columns, columns.colorData, 0);
  const gs = payloadChannel(columns, columns.colorData, 1);
  const bs = payloadChannel(columns, columns.colorData, 2);
  for (const i of chosen) {
    rs[i] *= factors[0];
    gs[i] *= factors[1];
    bs[i] *= factors[2];
  }
  const table = workingTable(columns);
  const ch = channelColumns(table);
  materializeChannel(table, ch.color[0], 'colorR', rs);
  materializeChannel(table, ch.color[1], 'colorG', gs);
  materializeChannel(table, ch.color[2], 'colorB', bs);
  return finishEdit(columns, table);
}
