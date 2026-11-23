// Phase 15 (TD §6) tests: chroma key stage membership and order.
// The shader itself is verified by pixel reads on the real-GPU
// gate flight; here we pin the stack contract: the stage exists
// only while enabled, and it is last in every profile (after
// edge-capture, which must read the un-keyed frame).
// Run: node scripts/phase15-chroma-key.test.mjs

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-chroma-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

await build({
  stdin: {
    contents: `
      export { getOrderedActivePostFxStageIds } from './lib/postFxStack.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const { getOrderedActivePostFxStageIds, DEFAULT_CONFIG } = await import(pathToFileURL(BUNDLE).href);
  const profiles = ['manual', 'touch-feedback', 'particular-glow', 'retro-feedback', 'dream-smear'];
  for (const profile of profiles) {
    const off = getOrderedActivePostFxStageIds({ ...DEFAULT_CONFIG, postFxStackProfile: profile });
    check(`${profile}: chroma-key absent by default`, !off.includes('chroma-key'));
    const on = getOrderedActivePostFxStageIds({ ...DEFAULT_CONFIG, postFxStackProfile: profile, postChromaKeyEnabled: true });
    check(`${profile}: chroma-key present when enabled`, on.includes('chroma-key'));
    check(`${profile}: chroma-key is the last stage`, on[on.length - 1] === 'chroma-key', `last=${on[on.length - 1]}`);
    check(`${profile}: enabling adds exactly one stage`, on.length === off.length + 1, `${off.length} -> ${on.length}`);
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
