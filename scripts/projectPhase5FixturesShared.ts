import path from 'node:path';

export interface Phase5FixtureDefinition {
  id: string;
  fileName: string;
  description: string;
  buildPayload: () => Record<string, unknown>;
}

export interface Phase5RealExportManifestEntry {
  fileName: string;
  sha256: string;
  projectName: string;
  projectDataVersion: number;
  manifestSchemaVersion: number;
  serializationSchemaVersion: number;
  presetCount: number;
  sequenceCount: number;
  executionCount: number;
  serializationLayerCount: number;
}

export interface Phase5RealExportManifest {
  generatedAt: string;
  entryCount: number;
  entries: Phase5RealExportManifestEntry[];
}

export interface Phase5ProjectFingerprint {
  projectName: string;
  activePresetId: string | null;
  presetIds: string[];
  sequenceIds: string[];
  sequencePresetIds: string[];
  executionKeys: string[];
  serializationLayerKeys: string[];
}

export const FIXTURE_EXPORTED_AT = '2026-03-31T00:00:00.000Z';
export const PROJECT_DATA_VERSION = 13;
export const PROJECT_MANIFEST_SCHEMA_VERSION = 11;
export const PROJECT_SERIALIZATION_SCHEMA_VERSION = 2;

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    );
  }
  return value;
}

export function stableJsonStringify(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}
`;
}

export function getPhase5FixtureDir(rootDir = process.cwd()): string {
  return path.join(rootDir, 'fixtures', 'project-state', 'phase5');
}

export function getPhase5RealExportFixtureDir(rootDir = process.cwd()): string {
  return path.join(rootDir, 'fixtures', 'project-state', 'real-export');
}

export function getPhase5RealExportManifestPath(rootDir = process.cwd()): string {
  return path.join(getPhase5RealExportFixtureDir(rootDir), 'manifest.json');
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
