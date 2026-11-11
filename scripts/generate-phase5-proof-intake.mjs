import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', 'scripts/generate-phase5-proof-intake-entry.ts'],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
