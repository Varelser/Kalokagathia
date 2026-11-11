import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/generate-phase5-refresh-closeout-entry.ts'], {
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
