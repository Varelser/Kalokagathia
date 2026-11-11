declare const process: { exitCode?: number };

import { writePhase5Fixtures } from './projectPhase5Fixtures.ts';

export async function main() {
  const result = writePhase5Fixtures();
  console.log(JSON.stringify({
    targetDir: result.targetDir,
    fileCount: result.fileNames.length,
    fileNames: result.fileNames,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
