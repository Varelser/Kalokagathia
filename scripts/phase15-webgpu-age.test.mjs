// Phase 15 (UE5 #18) WebGPU age port — structural checks:
//   - the registry lists 'age' as supported; an age-only config
//     can run on the WebGPU route, while age + a WebGL-only
//     lifecycle feature (kill conditions) still routes to WebGL
//   - POS_WGSL defines dmHash11 (it was missing — the module
//     could not compile), carries the respawn law with the WebGL
//     hash, and the uniform writes match the struct tail
//   - the velocity WGSL has the kick's respawn-frame trigger
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-wgpu-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const posWgsl = src.slice(src.indexOf('const POS_WGSL'), src.indexOf('export type WebGPUComputeState'));
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
check('POS_WGSL defines dmHash11 (was missing)', posWgsl.includes('fn dmHash11(n: f32) -> f32'));
check('POS_WGSL respawn uses the WebGL hash', posWgsl.includes('fn hash1Age(p: vec2f) -> f32') && posWgsl.includes('p.x * 127.1 + p.y * 311.7'));
check('POS_WGSL age advance + wrap', posWgsl.includes('if (u.ageEnabled > 0.5)') && posWgsl.includes('age += u.delta;') && posWgsl.includes('if (age > u.ageMax)'));
check('POS_WGSL emit-light variant', posWgsl.includes('u.emitLightEnabled > 0.5') && posWgsl.includes('let jr = r * 0.05;'));
check('POS_WGSL replica restart age', posWgsl.includes('age = replicaIdx * u.ageReplicaStep * u.ageMax + u.replicaAgeBase;'));
check('POS struct tail fields', posWgsl.includes('emitLightPosZ : f32'));
check('uniform buffer grew to 128 bytes', src.includes('const POS_UNIFORM_BYTES = 128;'));
check('step writes pos age indices 21-29', src.includes('posU[21] = f && f.ageEnabled ? 1 : 0;') && src.includes('posU[29] = f ? f.emitLightPos.z : 0;'));
check('VEL_WGSL kick respawn trigger', velWgsl.includes('if (u.ageEnabled > 0.5 && posIn[idx].w < u.delta * 1.5) { kickEnv = 1.0; }'));
check('step writes vel age index 98', src.includes('velU[98] = f && f.ageEnabled ? 1 : 0;'));

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
  const ageOnly = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuAgeEnabled: true });
  check('age-only config can run on WebGPU route', ageOnly.canRunRequestedConfig && ageOnly.supportedFeatures.includes('age'),
    JSON.stringify(ageOnly.unsupportedFeatures));
  const ageKill = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuAgeEnabled: true, gpgpuKillBoundary: true });
  check('age + kill conditions still routes to WebGL', !ageKill.canRunRequestedConfig && ageKill.unsupportedFeatures.includes('kill-conditions'));
  const ageFluid = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuAgeEnabled: true, gpgpuFluidEnabled: true });
  check('age + fluid still routes to WebGL', !ageFluid.canRunRequestedConfig && ageFluid.unsupportedFeatures.includes('fluid-field'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
