// Phase 15 (Unity section 1) collision life — structural checks:
//   - the position shader declares the uniforms, records contact
//     at all six collider resolutions (the sixth is the
//     multi-body mesh SDF push-out, added with the atlas
//     colliders — a real contact site for kill / life-loss),
//     applies the life rate
//     before the age advance, and ORs the kill into doRespawn
//   - defaults inert; WebGPU routing declares the feature so a
//     config using it routes to WebGL instead of dropping it
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-collision-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const pos = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationPosition.ts'), 'utf8');
check('uniforms declared', pos.includes('uniform float uCollisionLifeLoss;') && pos.includes('uniform bool  uCollisionKill;'));
check('contact recorded at 6 sites', (pos.match(/collisionContact = true/g) ?? []).length === 6,
  `sites=${(pos.match(/collisionContact = true/g) ?? []).length}`);
check('tracking gated on an option being live', pos.includes('bool collisionTrack = uCollisionKill || uCollisionLifeLoss > 0.0;'));
const lossIdx = pos.indexOf('age += uCollisionLifeLoss * uDelta;');
const advIdx = pos.indexOf('age += uDelta;');
check('life loss applied before the age advance', lossIdx > 0 && advIdx > lossIdx);
check('kill ORs into doRespawn', pos.includes('if (collisionContact && uCollisionKill) doRespawn = true;'));

await build({
  stdin: {
    contents: `
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const { getWebgpuComputeCapabilityReport, DEFAULT_CONFIG } = await import(pathToFileURL(BUNDLE).href);
  check('defaults inert', DEFAULT_CONFIG.gpgpuCollisionLifeLoss === 0 && DEFAULT_CONFIG.gpgpuCollisionKill === false);
  const base = getWebgpuComputeCapabilityReport(DEFAULT_CONFIG);
  check('default config does not request collision-life', !base.requestedFeatures.includes('collision-life'));
  const on = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuCollisionKill: true });
  check('kill config requests collision-life (routes to WebGL)', on.requestedFeatures.includes('collision-life') && !on.canRunRequestedConfig);
  const on2 = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuCollisionLifeLoss: 2 });
  check('loss config requests collision-life', on2.requestedFeatures.includes('collision-life'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
