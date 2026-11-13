import type { ParticleConfig } from '../types';
import { normalizeConfig } from './appStateConfig';
import { getHydratedPayload, putStoragePayload } from './storageDb';

export interface CustomProductPackRecord {
  id: string;
  label: string;
  baseProductPackId: string | null;
  baseProductPackLabel: string | null;
  config: ParticleConfig;
  changedKeys: string[];
  createdAt: string;
  updatedAt: string;
}

const CUSTOM_PRODUCT_PACK_STORAGE_KEY = 'monosphere.custom-product-packs.v1';

function buildRecordId() {
  return `custom-product-pack-${Math.random().toString(36).slice(2, 10)}`;
}

function areValuesEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function computeCustomProductPackChangedKeys(config: ParticleConfig, baseConfig: ParticleConfig) {
  return (Object.keys(config) as Array<keyof ParticleConfig>)
    .filter((key) => !areValuesEqual(config[key], baseConfig[key]))
    .map((key) => String(key))
    .sort((a, b) => a.localeCompare(b));
}

export function createCustomProductPackRecord(options: {
  label: string;
  baseProductPackId: string | null;
  baseProductPackLabel: string | null;
  config: ParticleConfig;
  baseConfig: ParticleConfig;
}): CustomProductPackRecord {
  const normalizedConfig = normalizeConfig(options.config);
  const normalizedBase = normalizeConfig(options.baseConfig);
  const timestamp = new Date().toISOString();

  return {
    id: buildRecordId(),
    label: options.label.trim(),
    baseProductPackId: options.baseProductPackId,
    baseProductPackLabel: options.baseProductPackLabel,
    config: normalizedConfig,
    changedKeys: computeCustomProductPackChangedKeys(normalizedConfig, normalizedBase),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function duplicateCustomProductPackRecord(source: CustomProductPackRecord): CustomProductPackRecord {
  const timestamp = new Date().toISOString();
  return {
    ...source,
    id: buildRecordId(),
    label: `${source.label} Copy`,
    config: normalizeConfig(source.config),
    changedKeys: [...source.changedKeys],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function refreshCustomProductPackRecord(
  source: CustomProductPackRecord,
  options: { config: ParticleConfig; baseConfig: ParticleConfig },
): CustomProductPackRecord {
  const normalizedConfig = normalizeConfig(options.config);
  const normalizedBase = normalizeConfig(options.baseConfig);
  return {
    ...source,
    config: normalizedConfig,
    changedKeys: computeCustomProductPackChangedKeys(normalizedConfig, normalizedBase),
    updatedAt: new Date().toISOString(),
  };
}

export function loadCustomProductPackRecords(): CustomProductPackRecord[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    // IndexedDB first once hydration has settled (Phase 1 renewal);
    // localStorage fallback before that and whenever IndexedDB is
    // unavailable — the stored format is the same JSON string in both.
    const raw = getHydratedPayload(CUSTOM_PRODUCT_PACK_STORAGE_KEY)
      ?? window.localStorage.getItem(CUSTOM_PRODUCT_PACK_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') {
        return [];
      }
      const payload = item as Partial<CustomProductPackRecord> & { config?: Partial<ParticleConfig> };
      const config = normalizeConfig(payload.config);
      const baseConfig = normalizeConfig({});
      return [{
        id: typeof payload.id === 'string' ? payload.id : buildRecordId(),
        label: typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : 'Custom Product Pack',
        baseProductPackId: typeof payload.baseProductPackId === 'string' ? payload.baseProductPackId : null,
        baseProductPackLabel: typeof payload.baseProductPackLabel === 'string' ? payload.baseProductPackLabel : null,
        config,
        changedKeys: Array.isArray(payload.changedKeys) && payload.changedKeys.every((entry) => typeof entry === 'string')
          ? [...payload.changedKeys].sort((a, b) => a.localeCompare(b))
          : computeCustomProductPackChangedKeys(config, baseConfig),
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString(),
      }];
    });
  } catch {
    return [];
  }
}

export function saveCustomProductPackRecords(records: CustomProductPackRecord[]) {
  if (typeof window === 'undefined') {
    return;
  }
  // IndexedDB is the primary store (storageDb mirrors back into
  // localStorage while the payload fits the legacy cap, and falls back
  // to a plain localStorage write when IndexedDB is unavailable).
  putStoragePayload(CUSTOM_PRODUCT_PACK_STORAGE_KEY, JSON.stringify(records));
}

export function inferActiveCustomProductPackRecordId(config: ParticleConfig, records: CustomProductPackRecord[]) {
  const normalizedConfig = normalizeConfig(config);
  const normalizedSerialized = JSON.stringify(normalizedConfig);
  return records.find((record) => JSON.stringify(normalizeConfig(record.config)) === normalizedSerialized)?.id ?? null;
}
