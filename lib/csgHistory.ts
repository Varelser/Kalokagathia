/**
 * Phase 17 stage 1: CSG result history (result-based).
 *
 * The history lives in one config string key
 * (gpgpuCsgHistoryJson) as a JSON array, newest first,
 * capped at CSG_HISTORY_MAX entries. Each entry carries
 * the result as indexed OBJ text, so an entry can be put
 * back as operand A or B — that is what makes multi-step
 * chaining possible without a step-list editor.
 *
 * Robustness rule: an empty or corrupt history string is
 * "no history", never an exception. Parsing filters out
 * malformed entries instead of failing the whole list.
 */
import { buildIndexedObjText, type CsgOperationKind } from './csgCore';

export const CSG_HISTORY_MAX = 8;

export interface CsgHistoryEntry {
  /** Operation kind + timestamp, for display. */
  label: string;
  operation: CsgOperationKind;
  /** The result as indexed OBJ text. */
  objText: string;
  volume: number;
  triangles: number;
}

function isCsgHistoryEntry(v: unknown): v is CsgHistoryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.label === 'string' &&
    (e.operation === 'union' || e.operation === 'difference' || e.operation === 'intersection') &&
    typeof e.objText === 'string' &&
    e.objText !== '' &&
    typeof e.volume === 'number' &&
    Number.isFinite(e.volume) &&
    typeof e.triangles === 'number' &&
    Number.isFinite(e.triangles)
  );
}

/** Parse the history key. Empty / corrupt / non-array
 *  input yields an empty list. */
export function parseCsgHistory(json: string): CsgHistoryEntry[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isCsgHistoryEntry).slice(0, CSG_HISTORY_MAX);
}

/** Build one entry from a finished run. The timestamp
 *  label text is supplied by the caller (the panel) so
 *  this function stays deterministic under test. */
export function buildCsgHistoryEntry(
  result: { positions: ArrayLike<number>; indices: ArrayLike<number>; volume: number; triangles: number },
  operation: CsgOperationKind,
  label: string,
): CsgHistoryEntry {
  return {
    label,
    operation,
    objText: buildIndexedObjText(result.positions, result.indices, 'csg-history'),
    volume: result.volume,
    triangles: result.triangles,
  };
}

/** Prepend an entry and re-serialise, dropping the
 *  oldest entries beyond the cap. A corrupt existing
 *  history is replaced by the new entry alone. */
export function appendCsgHistory(json: string, entry: CsgHistoryEntry): string {
  const next = [entry, ...parseCsgHistory(json)].slice(0, CSG_HISTORY_MAX);
  return JSON.stringify(next);
}
