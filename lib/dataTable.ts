import React from 'react';

/**
 * Column-preserving data table (Phase AJ).
 *
 * lib/dataSource.ts turns CSV / JSON into a point SHAPE (a luma
 * map) and discards the column structure. This module is the
 * complementary path: the same text is parsed into named numeric
 * columns that the modulation engine can read as time-series
 * signals (a "data column" source). The two paths share no state —
 * registering a table never touches the shape flow.
 *
 * Accepted input:
 * - CSV / TSV / semicolon / whitespace rows. A first row containing
 *   any non-numeric cell is treated as the header (column names);
 *   otherwise columns are named col1..colN.
 * - JSON: an array of objects (keys of the first object are the
 *   columns, in order), or an array of arrays (a leading row of
 *   strings is the header).
 *
 * Cells that do not coerce to a finite number become null. At
 * evaluation time a null holds the previous valid value in the
 * column (or the column minimum when nothing valid precedes it),
 * so a ragged column still yields a continuous signal.
 */

export interface DataTable {
  columns: string[];
  /** Row-major cells, rows[i][j]; null = missing / non-numeric. */
  rows: (number | null)[][];
  /** Per-column min / max over valid cells (0 / 0 when empty). */
  mins: number[];
  maxs: number[];
}

export const DATA_TABLE_MAX_ROWS = 8192;
const DATA_TABLE_PERSIST_ROWS = 2048;

function finalizeTable(columns: string[], rows: (number | null)[][]): DataTable | null {
  if (columns.length === 0 || rows.length === 0) return null;
  const capped = rows.slice(0, DATA_TABLE_MAX_ROWS);
  const mins = columns.map(() => Infinity);
  const maxs = columns.map(() => -Infinity);
  capped.forEach((row) => {
    row.forEach((value, j) => {
      if (value === null) return;
      if (value < mins[j]) mins[j] = value;
      if (value > maxs[j]) maxs[j] = value;
    });
  });
  return {
    columns,
    rows: capped,
    mins: mins.map((v) => (Number.isFinite(v) ? v : 0)),
    maxs: maxs.map((v) => (Number.isFinite(v) ? v : 0)),
  };
}

function coerceCell(cell: string | number | null | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const trimmed = cell.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function parseDelimitedTable(text: string): DataTable | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return null;
  const splitRow = (line: string) => line.split(/[,;\t]+/).map((cell) => cell.trim());
  const firstCells = splitRow(lines[0]);
  const hasHeader = firstCells.some((cell) => cell !== '' && !Number.isFinite(Number(cell)));
  const columns = hasHeader
    ? firstCells.map((cell, i) => (cell ? cell : `col${i + 1}`))
    : firstCells.map((_, i) => `col${i + 1}`);
  const bodyLines = hasHeader ? lines.slice(1) : lines;
  const rows: (number | null)[][] = bodyLines.map((line) => {
    const cells = splitRow(line);
    return columns.map((_, j) => coerceCell(cells[j]));
  });
  return finalizeTable(columns, rows);
}

export function parseDataTable(text: string): DataTable | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[')) {
    try {
      const raw = JSON.parse(trimmed) as unknown;
      if (Array.isArray(raw) && raw.length > 0) {
        const first = raw[0];
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          const columns = Object.keys(first as Record<string, unknown>);
          const rows = raw.map((entry) => {
            const record = (entry ?? {}) as Record<string, unknown>;
            return columns.map((name) => {
              const value = record[name];
              return typeof value === 'number' || typeof value === 'string' ? coerceCell(value) : null;
            });
          });
          const parsed = finalizeTable(columns, rows);
          if (parsed) return parsed;
        } else if (Array.isArray(first)) {
          const headerRow = first.every((cell) => typeof cell === 'string' || cell === null)
            ? (first as (string | null)[])
            : null;
          const hasHeader = headerRow !== null && headerRow.some((cell) => typeof cell === 'string' && cell.trim() !== '' && !Number.isFinite(Number(cell)));
          const width = first.length;
          const columns = hasHeader
            ? (headerRow as (string | null)[]).map((cell, i) => (cell && cell.trim() ? cell.trim() : `col${i + 1}`))
            : Array.from({ length: width }, (_, i) => `col${i + 1}`);
          const body = hasHeader ? raw.slice(1) : raw;
          const rows = body.map((entry) => {
            const cells = Array.isArray(entry) ? entry : [];
            return columns.map((_, j) => {
              const value = cells[j];
              return typeof value === 'number' || typeof value === 'string' ? coerceCell(value) : null;
            });
          });
          const parsed = finalizeTable(columns, rows);
          if (parsed) return parsed;
        }
      }
    } catch {
      // fall through to delimited parsing
    }
  }
  return parseDelimitedTable(trimmed);
}

/**
 * Normalised value of `column` at row `index`: the raw value scaled
 * into [0, 1] by the column's min / max. A constant column yields
 * 0.5. Null cells hold the previous valid value (scanning back at
 * most the whole column); a column with no valid cell at or before
 * the index yields 0.5 (neutral). Unknown column / empty table
 * also yield 0.5.
 */
export function sampleDataColumn(table: DataTable | null, column: string, index: number): number {
  if (!table) return 0.5;
  const j = table.columns.indexOf(column);
  if (j < 0 || table.rows.length === 0) return 0.5;
  const rowIndex = Math.min(table.rows.length - 1, Math.max(0, Math.floor(index)));
  let raw: number | null = null;
  for (let i = rowIndex; i >= 0; i--) {
    const value = table.rows[i][j];
    if (value !== null) {
      raw = value;
      break;
    }
  }
  if (raw === null) return 0.5;
  const min = table.mins[j];
  const max = table.maxs[j];
  if (!(max > min)) return 0.5;
  return Math.min(1, Math.max(0, (raw - min) / (max - min)));
}

/* ---------------- shared store (editor <-> engine) ---------------- */

const STORAGE_KEY = 'kalokagathia.dataTable.v1';

let currentTable: DataTable | null = null;
let tableLoaded = false;
const listeners = new Set<() => void>();

function loadPersistedTable(): DataTable | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DataTable>;
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) return null;
    const columns = parsed.columns.filter((name): name is string => typeof name === 'string');
    const rows = (parsed.rows as unknown[]).slice(0, DATA_TABLE_PERSIST_ROWS).map((row) =>
      Array.isArray(row)
        ? columns.map((_, j) => {
            const value = (row as unknown[])[j];
            return typeof value === 'number' && Number.isFinite(value) ? value : null;
          })
        : columns.map(() => null),
    );
    return finalizeTable(columns, rows);
  } catch {
    return null;
  }
}

function persistTable(table: DataTable | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!table) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const trimmed: DataTable = { ...table, rows: table.rows.slice(0, DATA_TABLE_PERSIST_ROWS) };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full/blocked: the table simply won't persist.
  }
}

function ensureTable(): DataTable | null {
  if (!tableLoaded) {
    tableLoaded = true;
    currentTable = loadPersistedTable();
  }
  return currentTable;
}

export function getDataTable(): DataTable | null {
  return ensureTable();
}

export function setDataTable(table: DataTable | null): void {
  tableLoaded = true;
  currentTable = table;
  persistTable(table);
  listeners.forEach((listener) => listener());
}

export function subscribeDataTable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDataTable(): DataTable | null {
  return React.useSyncExternalStore(subscribeDataTable, getDataTable, getDataTable);
}
