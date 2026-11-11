import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeLibraryPayload } from './sync-public-library.mjs';

const workspaceRoot = process.cwd();
const targetPath = path.resolve(workspaceRoot, process.argv[2] ?? 'public-library.json');

async function main() {
  const raw = await fs.readFile(targetPath, 'utf8');
  const parsed = JSON.parse(raw);
  const normalized = normalizeLibraryPayload(parsed);
  const normalizedText = `${JSON.stringify(normalized, null, 2)}\n`;
  const normalizedMatch = raw === normalizedText;

  if (!normalizedMatch) {
    throw new Error(`Public library is not normalized. Run: npm run sync:public-library -- ${path.relative(workspaceRoot, targetPath)}`);
  }

  console.log(JSON.stringify({
    target: path.relative(workspaceRoot, targetPath),
    presets: normalized.presets.length,
    sequenceSteps: normalized.presetSequence.length,
    activePresetId: normalized.activePresetId,
    normalizedMatch,
    passed: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
