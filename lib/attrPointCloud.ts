import React from 'react';
import { parseDataTable, type DataTable } from './dataTable';

/**
 * Attribute-preserving point cloud (Phase AK).
 *
 * The third path for imported tabular data, next to the two that
 * already exist: lib/dataSource.ts rasterises points into a luma
 * map (the shape survives, the columns die), and lib/dataTable.ts
 * keeps the columns as time-series signals (no positions). This
 * module keeps BOTH: the parsed table is held as a point cloud —
 * each row is a point with a position (x / y / z columns) and every
 * column retained as a per-point attribute.
 *
 * Two consumers give the retention a use:
 * - the attribute foundation (lib/gpgpuAttributes.ts): a slot
 *   whose source is 'data' reads the column matching the slot's
 *   NAME, per particle (index mod point count);
 * - the morph bake: target 'data' places particles on the cloud's
 *   positions (unit-sphere convention, like the OBJ cloud).
 *
 * The store follows lib/dataTable.ts exactly: module-level shared
 * store, localStorage persistence of the first 2,048 rows.
 */

export interface AttrPointCloud {
  table: DataTable;
  /** Column indices of the position components (zCol -1 = flat). */
  xCol: number;
  yCol: number;
  zCol: number;
  /** Raw positions, rows x 3 (nulls hold the previous valid value
   *  in the column, or 0 when nothing valid precedes them). */
  positions: Float32Array;
  /** Per-column values normalised to [0, 1] by the column range,
   *  row-major (rows x columns), same null-hold rule. A constant
   *  column normalises to 0.5, matching sampleDataColumn. */
  normalized: Float32Array;
  /** positions recentred with bounding-sphere radius 1 — the
   *  morph bake's point-cloud convention (lib/objMorph.ts). */
  unitPositions: Float32Array;
  /** Bumped on every store write; texture / bake signatures key
   *  off it. */
  version: number;
}

export const ATTR_CLOUD_MAX_ROWS = 8192;
const ATTR_CLOUD_PERSIST_ROWS = 2048;

function fillColumn(table: DataTable, col: number, rows: number): Float32Array {
  const out = new Float32Array(rows);
  let last = 0;
  for (let i = 0; i < rows; i++) {
    const value = table.rows[i]?.[col];
    if (typeof value === 'number' && Number.isFinite(value)) last = value;
    out[i] = last;
  }
  return out;
}

function buildCloud(table: DataTable, version: number): AttrPointCloud | null {
  const rows = table.rows.length;
  const cols = table.columns.length;
  if (rows === 0 || cols < 2) return null;
  const find = (name: string) => table.columns.findIndex((c) => c.trim().toLowerCase() === name);
  let xCol = find('x');
  let yCol = find('y');
  let zCol = find('z');
  if (xCol < 0 || yCol < 0 || xCol === yCol) {
    // No usable named position columns: fall back to the first
    // columns in order (the dataSource convention).
    xCol = 0;
    yCol = 1;
    zCol = cols > 2 ? 2 : -1;
  }
  // At least one row must carry a real (x, y) pair, otherwise the
  // text is a table but not a point cloud.
  let hasPoint = false;
  for (let i = 0; i < rows; i++) {
    const x = table.rows[i][xCol];
    const y = table.rows[i][yCol];
    if (typeof x === 'number' && typeof y === 'number') {
      hasPoint = true;
      break;
    }
  }
  if (!hasPoint) return null;

  const xs = fillColumn(table, xCol, rows);
  const ys = fillColumn(table, yCol, rows);
  const zs = zCol >= 0 ? fillColumn(table, zCol, rows) : new Float32Array(rows);
  const positions = new Float32Array(rows * 3);
  for (let i = 0; i < rows; i++) {
    positions[i * 3] = xs[i];
    positions[i * 3 + 1] = ys[i];
    positions[i * 3 + 2] = zs[i];
  }

  const normalized = new Float32Array(rows * cols);
  for (let j = 0; j < cols; j++) {
    const filled = fillColumn(table, j, rows);
    const min = table.mins[j];
    const max = table.maxs[j];
    const span = max - min;
    for (let i = 0; i < rows; i++) {
      normalized[i * cols + j] = span > 0 ? Math.min(1, Math.max(0, (filled[i] - min) / span)) : 0.5;
    }
  }

  // Unit-sphere convention: centre on the range midpoint, scale so
  // the farthest point sits at radius 1 (objMorph's convention).
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < rows; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < rows; i++) {
    const dx = positions[i * 3] - cx;
    const dy = positions[i * 3 + 1] - cy;
    const dz = positions[i * 3 + 2] - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > radius) radius = d;
  }
  const scale = radius > 0 ? 1 / radius : 0;
  const unitPositions = new Float32Array(rows * 3);
  for (let i = 0; i < rows * 3; i += 3) {
    unitPositions[i] = (positions[i] - cx) * scale;
    unitPositions[i + 1] = (positions[i + 1] - cy) * scale;
    unitPositions[i + 2] = (positions[i + 2] - cz) * scale;
  }

  return { table, xCol, yCol, zCol, positions, normalized, unitPositions, version };
}

/** Parse CSV / TSV / JSON text into an attribute point cloud. */
export function parseAttrPointCloud(text: string, version = 0): AttrPointCloud | null {
  const table = parseDataTable(text);
  if (!table) return null;
  return buildCloud(table, version);
}

/**
 * Normalised attribute value of the column named `name` for point
 * `pointIndex` (wrapping over the cloud). A missing column yields
 * 0 — an attribute that was never supplied is absent, not neutral
 * (contrast sampleDataColumn's signal convention of 0.5).
 */
export function sampleAttrColumn(cloud: AttrPointCloud | null, name: string, pointIndex: number): number {
  if (!cloud) return 0;
  const wanted = name.trim().toLowerCase();
  const j = cloud.table.columns.findIndex((c) => c.trim().toLowerCase() === wanted);
  if (j < 0) return 0;
  const rows = cloud.table.rows.length;
  if (rows === 0) return 0;
  const i = ((Math.floor(pointIndex) % rows) + rows) % rows;
  return cloud.normalized[i * cloud.table.columns.length + j];
}

/* ---------------- shared store (editor <-> engine) ---------------- */

const STORAGE_KEY = 'kalokagathia.attrCloud.v1';

let currentCloud: AttrPointCloud | null = null;
let cloudLoaded = false;
let cloudVersion = 0;
const listeners = new Set<() => void>();

function loadPersistedCloud(): AttrPointCloud | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DataTable>;
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    const columns = parsed.columns.filter((name): name is string => typeof name === 'string');
    const rows = (parsed.rows as unknown[]).slice(0, ATTR_CLOUD_PERSIST_ROWS).map((row) =>
      Array.isArray(row)
        ? columns.map((_, j) => {
            const value = (row as unknown[])[j];
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
          })
        : columns.map(() => null),
    );
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
    const table: DataTable = {
      columns,
      rows,
      mins: mins.map((v) => (Number.isFinite(v) ? v : 0)),
      maxs: maxs.map((v) => (Number.isFinite(v) ? v : 0)),
    };
    return buildCloud(table, 0);
  } catch {
    return null;
  }
}

function persistCloud(cloud: AttrPointCloud | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!cloud) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const trimmed: DataTable = { ...cloud.table, rows: cloud.table.rows.slice(0, ATTR_CLOUD_PERSIST_ROWS) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full/blocked: the cloud simply won't persist.
  }
}

function ensureCloud(): AttrPointCloud | null {
  if (!cloudLoaded) {
    cloudLoaded = true;
    currentCloud = loadPersistedCloud();
  }
  return currentCloud;
}

export function getAttrPointCloud(): AttrPointCloud | null {
  return ensureCloud();
}

export function setAttrPointCloud(cloud: AttrPointCloud | null): void {
  cloudLoaded = true;
  cloudVersion += 1;
  currentCloud = cloud ? { ...cloud, version: cloudVersion } : null;
  persistCloud(currentCloud);
  listeners.forEach((listener) => listener());
}

export function subscribeAttrPointCloud(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAttrPointCloud(): AttrPointCloud | null {
  return React.useSyncExternalStore(subscribeAttrPointCloud, getAttrPointCloud, getAttrPointCloud);
}
