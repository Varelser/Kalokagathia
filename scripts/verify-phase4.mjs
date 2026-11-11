import { spawnSync } from 'node:child_process';

const steps = [
  ['npm', ['run', 'build']],
  ['npm', ['run', 'verify:project-state']],
  ['npm', ['run', 'verify:export']],
];

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
