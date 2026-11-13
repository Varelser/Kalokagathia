import { useEffect, useState } from 'react';

/**
 * IndexedDB payload storage (Phase 1 renewal, 2026-11-13).
 *
 * The app's large payloads — the persisted project snapshot, the preset
 * library, the preset sequence and the custom product packs — used to live
 * only in localStorage, where a 4,000,000-character cap (and the browser
 * quota behind it) made oversized saves silently fail or get pruned. They
 * now live primarily in IndexedDB, which has no such practical cap for
 * this app's data:
 *
 *   DB:      `kalokagathia` (version 1)
 *   Store:   `payloads`, keyPath `key`
 *   Record:  { key, value, updatedAt, sourceVersion } — `value` is the
 *            EXACT JSON string localStorage used to hold for that key, so
 *            migration is a verbatim copy and verification is a string
 *            comparison.
 *
 * Migration (one-time, asynchronous, never blocks first paint):
 * for each migrated key, if IndexedDB has no value and localStorage has
 * one, the localStorage string is copied verbatim, read back, and only
 * marked migrated when the strings match exactly. localStorage data is
 * NEVER deleted or truncated by the migration.
 *
 * Read path: IndexedDB first (via the in-memory cache filled by
 * hydration), localStorage fallback. Write path: IndexedDB, plus a
 * localStorage mirror while the payload is safely under the old cap
 * (see putStoragePayload / the per-caller notes). When IndexedDB is
 * unavailable (private mode, old browser, …) everything degrades to the
 * previous localStorage-only behaviour.
 *
 * Small keys (BYOK credentials, folds, AI usage, GPU tier, …) are NOT
 * migrated and keep using localStorage directly.
 */

export const IDB_DATABASE_NAME = 'kalokagathia';
export const IDB_DATABASE_VERSION = 1;
export const IDB_PAYLOAD_STORE = 'payloads';
export const IDB_MIGRATION_FLAG_KEY = 'kalokagathia.idbMigrated.v1';

/** Payloads at or below this size are still mirrored into localStorage. */
export const LS_MIRROR_MAX_CHARS = 4_000_000;

export const PROJECT_PAYLOAD_KEY = 'monosphere-project-v3';
export const PRESETS_PAYLOAD_KEY = 'monosphere-presets-v1';
export const PRESET_SEQUENCE_PAYLOAD_KEY = 'monosphere-preset-sequence-v1';
export const CUSTOM_PRODUCT_PACKS_PAYLOAD_KEY = 'monosphere.custom-product-packs.v1';

export const MIGRATED_PAYLOAD_KEYS: readonly string[] = [
  PROJECT_PAYLOAD_KEY,
  PRESETS_PAYLOAD_KEY,
  PRESET_SEQUENCE_PAYLOAD_KEY,
  CUSTOM_PRODUCT_PACKS_PAYLOAD_KEY,
];

interface PayloadRecord {
  key: string;
  value: string;
  updatedAt: string;
  sourceVersion: number;
}

const payloadCache = new Map<string, string | null>();
let hydrationSettled = false;
let idbAvailable = false;
let hydrationPromise: Promise<boolean> | null = null;
const settleListeners = new Set<() => void>();

function notifySettled() {
  for (const listener of [...settleListeners]) {
    listener();
  }
}

function readLocalStorageRaw(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorageRaw(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = window.indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_PAYLOAD_STORE)) {
          db.createObjectStore(IDB_PAYLOAD_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_PAYLOAD_STORE, 'readonly');
      const request = tx.objectStore(IDB_PAYLOAD_STORE).get(key);
      request.onsuccess = () => {
        const record = request.result as PayloadRecord | undefined;
        resolve(record && typeof record.value === 'string' ? record.value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, key: string, value: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_PAYLOAD_STORE, 'readwrite');
      const record: PayloadRecord = {
        key,
        value,
        updatedAt: new Date().toISOString(),
        sourceVersion: 1,
      };
      tx.objectStore(IDB_PAYLOAD_STORE).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Runs (once) the migration + cache fill. Resolves true when IndexedDB is
 * usable and the cache now reflects the authoritative payloads; resolves
 * false when IndexedDB is unavailable and callers must use localStorage
 * exactly as before. Either way the promise marks hydration "settled" so
 * write paths that gate on it can proceed.
 */
export function ensureStorageHydration(): Promise<boolean> {
  if (hydrationSettled) {
    return Promise.resolve(idbAvailable);
  }
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      let available = false;
      try {
        const db = await openDatabase();
        if (db) {
          const migratedKeys: string[] = [];
          for (const key of MIGRATED_PAYLOAD_KEYS) {
            let value = await idbGet(db, key);
            if (value === null) {
              const localValue = readLocalStorageRaw(key);
              if (localValue !== null) {
                const written = await idbPut(db, key, localValue);
                const readBack = written ? await idbGet(db, key) : null;
                if (readBack === localValue) {
                  value = localValue;
                  migratedKeys.push(key);
                }
              }
            }
            payloadCache.set(key, value);
          }
          available = true;
          if (migratedKeys.length > 0) {
            try {
              const previous = readLocalStorageRaw(IDB_MIGRATION_FLAG_KEY);
              const previousKeys = previous
                ? ((JSON.parse(previous) as { keys?: unknown }).keys as unknown)
                : null;
              const keys = new Set<string>([
                ...(Array.isArray(previousKeys) ? previousKeys.filter((k): k is string => typeof k === 'string') : []),
                ...migratedKeys,
              ]);
              writeLocalStorageRaw(
                IDB_MIGRATION_FLAG_KEY,
                JSON.stringify({ version: 1, keys: [...keys], at: new Date().toISOString() }),
              );
            } catch {
              // The flag is bookkeeping only; the cache above is the truth.
            }
          }
        }
      } catch {
        available = false;
      }
      idbAvailable = available;
      hydrationSettled = true;
      notifySettled();
      return available;
    })();
  }
  return hydrationPromise;
}

export function isStorageHydrationSettled(): boolean {
  return hydrationSettled;
}

export function isIndexedDbAvailable(): boolean {
  return hydrationSettled && idbAvailable;
}

/**
 * The authoritative payload for a migrated key once hydration has settled
 * with IndexedDB available: a string when a payload exists, null when it
 * provably does not. Returns undefined while hydration is pending or when
 * IndexedDB is unavailable — callers must then use the localStorage path,
 * exactly as before this layer existed.
 */
export function getHydratedPayload(key: string): string | null | undefined {
  if (!hydrationSettled || !idbAvailable) {
    return undefined;
  }
  return payloadCache.has(key) ? (payloadCache.get(key) ?? null) : null;
}

// Writes are serialized through one chain, and every write waits for
// hydration to settle first, so an early write can never race the
// migration copy or clobber a not-yet-read IndexedDB value with a
// pre-hydration placeholder.
let writeChain: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): void {
  writeChain = writeChain.then(task).catch(() => {
    // Individual failures are handled inside each task; the chain itself
    // must never stay rejected.
  });
}

/**
 * Writes a payload to IndexedDB and (by default) mirrors it into
 * localStorage while it fits safely under the old cap. Payloads above the
 * cap are stored in IndexedDB only — that is the point of the migration.
 * When IndexedDB is unavailable, falls back to a direct localStorage
 * write with the legacy semantics of the former direct writers
 * (best-effort setItem, errors swallowed).
 */
export function putStoragePayload(key: string, value: string, options?: { mirror?: boolean }): void {
  if (typeof window === 'undefined') return;
  payloadCache.set(key, value);
  const mirror = options?.mirror !== false;
  enqueueWrite(async () => {
    const available = await ensureStorageHydration();
    if (available) {
      const db = await openDatabase();
      if (db) {
        await idbPut(db, key, value);
      }
      if (mirror && value.length <= LS_MIRROR_MAX_CHARS) {
        writeLocalStorageRaw(key, value);
      }
    } else if (mirror) {
      writeLocalStorageRaw(key, value);
    }
  });
}

export type VerifiedWriteOutcome = 'idb' | 'unavailable' | 'failed';

/**
 * Writes a payload to IndexedDB and verifies it by reading it back and
 * comparing strings. On success the localStorage mirror is updated on a
 * best-effort basis when the payload fits the old cap (a mirror failure
 * never turns an IndexedDB success into a failure). Returns
 * 'unavailable' when IndexedDB cannot be used, so the caller can run its
 * legacy localStorage path instead.
 */
export async function writePayloadVerified(key: string, value: string): Promise<VerifiedWriteOutcome> {
  if (typeof window === 'undefined') return 'unavailable';
  const available = await ensureStorageHydration();
  if (!available) return 'unavailable';
  const db = await openDatabase();
  if (!db) return 'unavailable';
  payloadCache.set(key, value);
  const written = await idbPut(db, key, value);
  if (!written) return 'failed';
  const readBack = await idbGet(db, key);
  if (readBack !== value) return 'failed';
  if (value.length <= LS_MIRROR_MAX_CHARS) {
    writeLocalStorageRaw(key, value);
  }
  return 'idb';
}

/**
 * React hook mirroring the lazyStarterLibrary pattern: kicks off
 * hydration when `enabled` and returns true once hydration has settled
 * (with or without IndexedDB), false while it is still in flight or when
 * disabled. Persist effects must not write before this returns true for
 * their key's scope, so they cannot clobber IndexedDB with pre-hydration
 * placeholder state.
 */
export function useStorageHydrated(enabled: boolean): boolean {
  const [settled, setSettled] = useState<boolean>(() => hydrationSettled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const onSettled = () => {
      if (!cancelled) setSettled(true);
    };
    settleListeners.add(onSettled);
    // The listener covers a settle that happens after this effect runs;
    // the promise covers one that already happened (it resolves
    // immediately once settled). No synchronous setState is needed.
    ensureStorageHydration()
      .then(() => {
        if (!cancelled) setSettled(true);
      })
      .catch(() => {
        if (!cancelled) setSettled(true);
      });
    return () => {
      cancelled = true;
      settleListeners.delete(onSettled);
    };
  }, [enabled]);

  return enabled ? settled : false;
}
