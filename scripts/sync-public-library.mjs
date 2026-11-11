import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PRESET_LIBRARY_VERSION = 1;
const DEFAULT_BLEND_DURATION = 1.5;

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTimestamp(value) {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : new Date().toISOString();
}

function normalizePresetRecord(value) {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;

  return {
    id: value.id,
    name: value.name,
    config: isObject(value.config) ? value.config : {},
    createdAt: normalizeTimestamp(value.createdAt),
    updatedAt: normalizeTimestamp(value.updatedAt),
  };
}

function normalizeSequenceItem(value, validPresetIds) {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || typeof value.presetId !== 'string') return null;
  if (!validPresetIds.has(value.presetId)) return null;

  return {
    id: value.id,
    presetId: value.presetId,
    label: typeof value.label === 'string' && value.label.trim().length > 0 ? value.label : 'Keyframe',
    holdSeconds: typeof value.holdSeconds === 'number' ? Math.max(0.2, value.holdSeconds) : 2,
    transitionSeconds: typeof value.transitionSeconds === 'number' ? Math.max(0.05, value.transitionSeconds) : DEFAULT_BLEND_DURATION,
    transitionEasing: value.transitionEasing === 'linear' || value.transitionEasing === 'ease-in' || value.transitionEasing === 'ease-out' || value.transitionEasing === 'ease-in-out'
      ? value.transitionEasing
      : 'ease-in-out',
    screenSequenceDriveMode: value.screenSequenceDriveMode === 'inherit' || value.screenSequenceDriveMode === 'on' || value.screenSequenceDriveMode === 'off'
      ? value.screenSequenceDriveMode
      : 'inherit',
    screenSequenceDriveStrengthMode: value.screenSequenceDriveStrengthMode === 'inherit' || value.screenSequenceDriveStrengthMode === 'override'
      ? value.screenSequenceDriveStrengthMode
      : 'inherit',
    screenSequenceDriveStrengthOverride: typeof value.screenSequenceDriveStrengthOverride === 'number'
      ? Math.max(0, Math.min(1.5, value.screenSequenceDriveStrengthOverride))
      : null,
    screenSequenceDriveMultiplier: typeof value.screenSequenceDriveMultiplier === 'number'
      ? Math.max(0, Math.min(2, value.screenSequenceDriveMultiplier))
      : 1,
    keyframeConfig: isObject(value.keyframeConfig) ? value.keyframeConfig : null,
  };
}

export function normalizeLibraryPayload(payload) {
  if (!isObject(payload)) {
    throw new Error('Library payload must be a JSON object.');
  }

  if (!Array.isArray(payload.presets)) {
    throw new Error('Library payload must include a presets array.');
  }

  if (!Array.isArray(payload.presetSequence)) {
    throw new Error('Library payload must include a presetSequence array.');
  }

  const presets = payload.presets
    .map(normalizePresetRecord)
    .filter(Boolean);

  const presetIds = new Set(presets.map((preset) => preset.id));
  const presetSequence = payload.presetSequence
    .map((item) => normalizeSequenceItem(item, presetIds))
    .filter(Boolean);

  const activePresetId = typeof payload.activePresetId === 'string' && presetIds.has(payload.activePresetId)
    ? payload.activePresetId
    : presets[0]?.id ?? null;

  return {
    version: typeof payload.version === 'number' ? payload.version : PRESET_LIBRARY_VERSION,
    exportedAt: normalizeTimestamp(payload.exportedAt),
    currentConfig: isObject(payload.currentConfig) ? payload.currentConfig : {},
    activePresetId,
    presetBlendDuration: typeof payload.presetBlendDuration === 'number'
      ? Math.max(0.2, payload.presetBlendDuration)
      : DEFAULT_BLEND_DURATION,
    sequenceLoopEnabled: typeof payload.sequenceLoopEnabled === 'boolean' ? payload.sequenceLoopEnabled : true,
    presets,
    presetSequence,
  };
}

function printUsage() {
  console.log('Usage: npm run sync:public-library -- <source-json> [target-json]');
}

export async function runSyncPublicLibraryCli(argv = process.argv.slice(2)) {
  const [sourceArg, targetArg] = argv;

  if (!sourceArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const workspaceRoot = process.cwd();
  const sourcePath = path.resolve(workspaceRoot, sourceArg);
  const targetPath = path.resolve(workspaceRoot, targetArg ?? 'public-library.json');

  const raw = await fs.readFile(sourcePath, 'utf8');
  const payload = normalizeLibraryPayload(JSON.parse(raw));
  const output = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, output, 'utf8');

  console.log(JSON.stringify({
    source: path.relative(workspaceRoot, sourcePath),
    target: path.relative(workspaceRoot, targetPath),
    presets: payload.presets.length,
    sequenceSteps: payload.presetSequence.length,
    activePresetId: payload.activePresetId,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSyncPublicLibraryCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
