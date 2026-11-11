// Cross-device preset sync via Neon (programme item 8, 2026-11-11).
//
// Opt-in only: nothing in this module makes a network call unless the user
// enabled sync and triggered Push/Pull (or a code issuance/connection) from
// the shelf's "端末間同期 (Sync)" section. When sync is disabled the UI
// section is inert and this module's fetch functions are never invoked.
//
// Privacy model: the sync code is a bearer credential generated locally
// (120 bits of crypto randomness, base32). The browser sends it to the
// site's own relay over HTTPS; the server stores/compares only its SHA-256
// hash and keys all Neon rows by that hash. The raw code never reaches the
// database and is never logged.
//
// Merge algorithm (used identically for every Pull; Push relies on the
// server's ON CONFLICT guard, which is the same newest-wins rule):
//   - Union by preset id: records present on only one side are kept, so a
//     merge never loses a record from either side.
//   - For an id present on both sides, the record with the newer
//     updatedAt wins. The comparison uses the SERVER's updated_at for the
//     remote copy (the row's authoritative stamp) and the local record's
//     own updatedAt for the local copy. An exact timestamp tie keeps the
//     local copy, which prevents flip-flopping between devices.
//   - Deletions propagate as a tombstone list (ids + the time the list was
//     last updated, kept server-side in monosphere_sync_meta). A local
//     record whose id is tombstoned is removed only when its updatedAt is
//     not newer than the tombstone list's updated_at — a record edited
//     after the deletion was recorded survives, and its next Push removes
//     the id from the server's tombstone list (resurrection).
// Bookkeeping: `syncedUpdatedAt` remembers, per preset id, the updatedAt
// that was in sync after the last successful Push/Pull. On Push, ids that
// are in that map but no longer exist locally are exactly the local
// deletions since the last sync, and are sent as tombstones.

import { normalizeConfig } from './appStateConfig';
import { compactPresetRecord } from './presetLibraryPersist';
import type { PresetRecord } from '../types';

export const SYNC_STORAGE_KEY = 'kalokagathia.sync.v1';
export const SYNC_MAX_RECORDS = 2000;
export const SYNC_MAX_PUSH_CHARS = 2_000_000;
const SYNC_FETCH_TIMEOUT_MS = 45_000;

export interface SyncState {
  enabled: boolean;
  /** Display form of the code (grouped base32), or null when not connected. */
  code: string | null;
  lastSyncAt: string | null;
  /** preset id -> updatedAt (ISO) known to be in sync after last Push/Pull. */
  syncedUpdatedAt: Record<string, string>;
}

export const EMPTY_SYNC_STATE: SyncState = {
  enabled: false,
  code: null,
  lastSyncAt: null,
  syncedUpdatedAt: {},
};

export interface SyncStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export function loadSyncState(storage: SyncStorageLike): SyncState {
  try {
    const raw = storage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return { ...EMPTY_SYNC_STATE };
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      enabled: parsed.enabled === true,
      code: typeof parsed.code === 'string' && parsed.code ? parsed.code : null,
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
      syncedUpdatedAt:
        parsed.syncedUpdatedAt && typeof parsed.syncedUpdatedAt === 'object' && !Array.isArray(parsed.syncedUpdatedAt)
          ? (parsed.syncedUpdatedAt as Record<string, string>)
          : {},
    };
  } catch {
    return { ...EMPTY_SYNC_STATE };
  }
}

export function saveSyncState(storage: SyncStorageLike, state: SyncState): void {
  try {
    storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: sync simply will not persist its settings */
  }
}

// --- Sync code --------------------------------------------------------------
// 15 random bytes = 120 bits = exactly 24 base32 characters, displayed in
// six groups of four (XXXX-XXXX-…). Base32 alphabet excludes look-alikes
// 0/1/8/9, so the code is safe to read aloud or type by hand.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateSyncCode(randomBytes?: Uint8Array): string {
  let bytes = randomBytes;
  if (!bytes) {
    bytes = new Uint8Array(15);
    crypto.getRandomValues(bytes);
  }
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  const raw = out.slice(0, 24);
  return (raw.match(/.{1,4}/g) ?? [raw]).join('-');
}

/** Strip grouping/whitespace and uppercase, for comparison and transport. */
export function normalizeSyncCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidSyncCode(input: string): boolean {
  const raw = normalizeSyncCode(input);
  return raw.length >= 12 && raw.length <= 64 && /^[A-Z2-7]+$/.test(raw);
}

/** Canonical display form for a raw or loosely formatted code. */
export function formatSyncCode(input: string): string {
  const raw = normalizeSyncCode(input);
  return (raw.match(/.{1,4}/g) ?? [raw]).join('-');
}

// --- Merge ------------------------------------------------------------------

export interface RemotePreset {
  record: PresetRecord;
  /** Server row stamp (ISO) — authoritative for the remote copy. */
  updatedAt: string;
}

export interface PullMergeResult {
  merged: PresetRecord[];
  added: number;
  updated: number;
  removed: number;
}

function parseTime(value: string | undefined): number {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function mergePulledPresets(
  local: readonly PresetRecord[],
  remote: readonly RemotePreset[],
  deletedIds: readonly string[],
  tombstoneUpdatedAt: string | null,
): PullMergeResult {
  const byId = new Map<string, PresetRecord>();
  const order: string[] = [];
  for (const preset of local) {
    if (!byId.has(preset.id)) order.push(preset.id);
    byId.set(preset.id, preset);
  }
  let added = 0;
  let updated = 0;
  for (const entry of remote) {
    const rec = entry?.record;
    if (!rec || typeof rec.id !== 'string' || typeof rec.name !== 'string' || !rec.config) continue;
    const remoteUpdatedAt = new Date(parseTime(entry.updatedAt) || parseTime(rec.updatedAt) || Date.now()).toISOString();
    const normalized: PresetRecord = {
      id: rec.id,
      name: rec.name,
      config: normalizeConfig(rec.config),
      createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : remoteUpdatedAt,
      updatedAt: remoteUpdatedAt,
    };
    const existing = byId.get(rec.id);
    if (!existing) {
      byId.set(rec.id, normalized);
      order.push(rec.id);
      added += 1;
    } else if (parseTime(remoteUpdatedAt) > parseTime(existing.updatedAt)) {
      byId.set(rec.id, normalized);
      updated += 1;
    }
    // Tie or older remote copy: local wins (documented above).
  }
  let removed = 0;
  const tombstoneTime = parseTime(tombstoneUpdatedAt ?? undefined);
  if (tombstoneTime > 0) {
    for (const id of deletedIds) {
      const existing = byId.get(id);
      if (existing && parseTime(existing.updatedAt) <= tombstoneTime) {
        byId.delete(id);
        removed += 1;
      }
    }
  }
  const merged = order.filter((id) => byId.has(id)).map((id) => byId.get(id) as PresetRecord);
  return { merged, added, updated, removed };
}

/** Ids that were in sync after the last Push/Pull but are gone locally. */
export function computeDeletedIds(state: SyncState, local: readonly PresetRecord[]): string[] {
  const localIds = new Set(local.map((preset) => preset.id));
  return Object.keys(state.syncedUpdatedAt).filter((id) => !localIds.has(id));
}

/** Bookkeeping after a successful Push: every local record is in sync. */
export function stateAfterPush(state: SyncState, local: readonly PresetRecord[]): SyncState {
  const syncedUpdatedAt: Record<string, string> = {};
  for (const preset of local) syncedUpdatedAt[preset.id] = preset.updatedAt;
  return { ...state, lastSyncAt: new Date().toISOString(), syncedUpdatedAt };
}

/** Bookkeeping after a successful Pull merge (see merge rules above). */
export function stateAfterPull(
  state: SyncState,
  merged: readonly PresetRecord[],
  remote: readonly RemotePreset[],
): SyncState {
  const remoteIds = new Set(remote.map((entry) => entry?.record?.id).filter(Boolean));
  const syncedUpdatedAt: Record<string, string> = { ...state.syncedUpdatedAt };
  for (const preset of merged) {
    if (remoteIds.has(preset.id) || preset.id in syncedUpdatedAt) {
      syncedUpdatedAt[preset.id] = preset.updatedAt;
    }
  }
  const mergedIds = new Set(merged.map((preset) => preset.id));
  for (const id of Object.keys(syncedUpdatedAt)) {
    if (!mergedIds.has(id)) delete syncedUpdatedAt[id];
  }
  return { ...state, lastSyncAt: new Date().toISOString(), syncedUpdatedAt };
}

// --- Relay calls (only ever invoked from explicit user actions) -------------

export interface SyncPushResult { stored: number; received: number; deleted: number }
export interface SyncPullResult {
  records: RemotePreset[];
  deletedIds: string[];
  tombstoneUpdatedAt: string | null;
}

async function syncFetch(path: string, payload: unknown): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SYNC_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || json.ok !== true) {
      throw new Error(typeof json.error === 'string' ? json.error : `HTTP ${response.status}`);
    }
    return json;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Push the whole local library (compacted exactly as localStorage persists
 * it) plus locally-deleted ids as tombstones. Throws on cap violations
 * before any network call is made.
 */
export async function pushPresets(
  code: string,
  local: readonly PresetRecord[],
  deletedIds: readonly string[],
): Promise<SyncPushResult> {
  if (local.length > SYNC_MAX_RECORDS) {
    throw new Error(`プリセットが上限（${SYNC_MAX_RECORDS}件）を超えています`);
  }
  const records = local.map(compactPresetRecord);
  if (JSON.stringify(records).length > SYNC_MAX_PUSH_CHARS) {
    throw new Error('ライブラリが大きすぎて同期できません（上限 約2MB）');
  }
  const json = await syncFetch('/api/sync/push', {
    code: normalizeSyncCode(code),
    records,
    deletedIds: [...deletedIds],
  });
  return {
    stored: typeof json.stored === 'number' ? json.stored : records.length,
    received: typeof json.received === 'number' ? json.received : records.length,
    deleted: typeof json.deleted === 'number' ? json.deleted : deletedIds.length,
  };
}

export async function pullPresets(code: string): Promise<SyncPullResult> {
  const json = await syncFetch('/api/sync/pull', { code: normalizeSyncCode(code) });
  const records = Array.isArray(json.records)
    ? (json.records as Array<{ record: PresetRecord; updatedAt: string }>)
        .filter((entry) => entry && typeof entry === 'object' && entry.record)
        .map((entry) => ({ record: entry.record, updatedAt: String(entry.updatedAt ?? '') }))
    : [];
  return {
    records,
    deletedIds: Array.isArray(json.deletedIds) ? json.deletedIds.filter((x): x is string => typeof x === 'string') : [],
    tombstoneUpdatedAt: typeof json.tombstoneUpdatedAt === 'string' ? json.tombstoneUpdatedAt : null,
  };
}
