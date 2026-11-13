// Verified persistence for the preset library (small-fix bundle, 2026-11-11).
// The library lives in localStorage as a RAW ARRAY of preset records under
// PRESET_STORAGE_KEY. Saving used to be fire-and-forget: a quota error was
// only console.warn'd, and a read-back that did not contain the new record
// went unnoticed (seen once during the AI Phase 2 gate). This helper writes
// and then reads back and verifies — the payload must parse as an array and
// contain every record id — so failures can be surfaced to the user instead
// of silently losing presets.
//
// Why compaction is required (diagnosed 2026-11-11 on the iMac gate): the
// starter library holds 444 records with fully-normalized configs, which
// serialize to ~9.1M characters — above both the app's own 4,000,000-char
// read cap (lib/appStateLibrary.ts ignores larger payloads) and the browser
// localStorage quota. ANY change to the library therefore failed to persist
// at all, silently. Records are stored with their configs compacted to the
// keys that differ from DEFAULT_CONFIG; every reader normalizes configs on
// load (normalizeConfig merges the defaults back), so the stored format —
// a raw array of {id, name, config, ...} records — is unchanged and the
// compaction is lossless. The starter library compacts to ~366K characters.

import { DEFAULT_CONFIG } from './appStateConfig';
import { getHydratedPayload, writePayloadVerified } from './storageDb';
import type { ParticleConfig, PresetRecord } from '../types';

export interface PresetStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export type PresetPersistFailureReason =
  | 'serialize'
  | 'too-large'
  | 'write'
  | 'readback-missing'
  | 'readback-invalid'
  | 'readback-mismatch';

export type PresetPersistResult =
  | { ok: true }
  | { ok: false; reason: PresetPersistFailureReason };

// Must stay readable: lib/appStateLibrary.ts ignores payloads above this.
export const MAX_PRESET_PAYLOAD_CHARS = 4_000_000;

const DEFAULT_CONFIG_RECORD = DEFAULT_CONFIG as unknown as Record<string, unknown>;

export function compactPresetConfig(config: ParticleConfig): Partial<ParticleConfig> {
  const source = config as unknown as Record<string, unknown>;
  const compacted: Record<string, unknown> = {};
  for (const [configKey, value] of Object.entries(source)) {
    if (!(configKey in DEFAULT_CONFIG_RECORD)
      || JSON.stringify(value) !== JSON.stringify(DEFAULT_CONFIG_RECORD[configKey])) {
      compacted[configKey] = value;
    }
  }
  return compacted as Partial<ParticleConfig>;
}

export function compactPresetRecord(record: PresetRecord): PresetRecord {
  return { ...record, config: compactPresetConfig(record.config) as ParticleConfig };
}

export function persistPresetRecordsVerified(
  storage: PresetStorageLike,
  key: string,
  presets: readonly PresetRecord[],
): PresetPersistResult {
  let payload: string;
  try {
    payload = JSON.stringify(presets.map(compactPresetRecord));
  } catch {
    return { ok: false, reason: 'serialize' };
  }
  if (payload.length > MAX_PRESET_PAYLOAD_CHARS) {
    return { ok: false, reason: 'too-large' };
  }

  try {
    storage.setItem(key, payload);
  } catch {
    return { ok: false, reason: 'write' };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ok: false, reason: 'readback-missing' };
  }
  if (!raw) {
    return { ok: false, reason: 'readback-missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'readback-invalid' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'readback-invalid' };
  }
  if (parsed.length !== presets.length) {
    return { ok: false, reason: 'readback-mismatch' };
  }
  const ids = new Set(
    parsed.map((record) => (
      record && typeof record === 'object' ? (record as { id?: unknown }).id : undefined
    )),
  );
  for (const preset of presets) {
    if (!ids.has(preset.id)) {
      return { ok: false, reason: 'readback-mismatch' };
    }
  }
  return { ok: true };
}

function verifyPayloadContents(payload: string, presets: readonly PresetRecord[]): PresetPersistResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'readback-invalid' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, reason: 'readback-invalid' };
  }
  if (parsed.length !== presets.length) {
    return { ok: false, reason: 'readback-mismatch' };
  }
  const ids = new Set(
    parsed.map((record) => (
      record && typeof record === 'object' ? (record as { id?: unknown }).id : undefined
    )),
  );
  for (const preset of presets) {
    if (!ids.has(preset.id)) {
      return { ok: false, reason: 'readback-mismatch' };
    }
  }
  return { ok: true };
}

// IndexedDB-backed verified persistence (Phase 1 renewal). The payload is
// built with the exact same compaction as the localStorage path, then
// written through storageDb's writePayloadVerified, which stores it in
// IndexedDB, reads it back and string-compares — the same guarantee the
// synchronous helper gives for localStorage, without the 4,000,000-char
// cap: oversized libraries now persist instead of failing with
// 'too-large'. When IndexedDB is unavailable the call degrades to the
// legacy synchronous localStorage path (cap included). Calls are
// serialized through a module-level chain so rapid successive saves can
// never land in IndexedDB out of order.
let idbPersistChain: Promise<unknown> = Promise.resolve();

export function persistPresetRecordsVerifiedIdb(
  key: string,
  presets: readonly PresetRecord[],
): Promise<PresetPersistResult> {
  const run = async (): Promise<PresetPersistResult> => {
    let payload: string;
    try {
      payload = JSON.stringify(presets.map(compactPresetRecord));
    } catch {
      return { ok: false, reason: 'serialize' };
    }

    const outcome = await writePayloadVerified(key, payload);
    if (outcome === 'idb') {
      const readBack = getHydratedPayload(key);
      if (typeof readBack !== 'string') {
        return { ok: false, reason: 'readback-missing' };
      }
      return verifyPayloadContents(readBack, presets);
    }
    if (outcome === 'failed') {
      return getHydratedPayload(key) === payload
        ? { ok: false, reason: 'write' }
        : { ok: false, reason: 'readback-mismatch' };
    }
    // IndexedDB unavailable: legacy localStorage verified write.
    if (typeof window === 'undefined') {
      return { ok: false, reason: 'write' };
    }
    return persistPresetRecordsVerified(window.localStorage, key, presets);
  };

  const result = idbPersistChain.then(run, run);
  idbPersistChain = result.catch(() => undefined);
  return result;
}
