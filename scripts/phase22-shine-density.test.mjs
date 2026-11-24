// Phase 22 stage 2 — Shine density attenuation (§4 design).
//
// Identity discipline under test:
//   - buildLightFxFragment(false) is the legacy fragment
//     verbatim: no density uniform, no transmittance locals.
//   - buildLightFxFragment(true) differs ONLY by the two
//     documented insertions (uniforms + log chunk; the ray
//     march loop). Removing the inserted pieces reproduces the
//     legacy string byte-for-byte, which also proves Starglow /
//     Lux are untouched in both forms.
//   - The TS twins of the shader math (log compression,
//     transmittance) behave as hand-computed.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p22s2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { buildLightFxFragment } from './components/lightFxPass.ts';
      export {
        shineDensityLog, shineDensityTransmittance,
        PARTICLE_DENSITY_SCALE, PARTICLE_DENSITY_SPLAT_GAIN, SHINE_DENSITY_GAIN,
      } from './lib/particleDensity.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { buildLightFxFragment } = lib;
const {
  shineDensityLog, shineDensityTransmittance,
  PARTICLE_DENSITY_SCALE, PARTICLE_DENSITY_SPLAT_GAIN, SHINE_DENSITY_GAIN,
} = lib;

const legacy = buildLightFxFragment(false);
const density = buildLightFxFragment(true);

check('legacy fragment has no density code',
  !legacy.includes('uParticleDensity') && !legacy.includes('uShineDensity')
  && !legacy.includes('simDen') && !legacy.includes('float trans'));
check('density fragment declares the uniforms',
  density.includes('uniform sampler2D uParticleDensity;')
  && density.includes('uniform float uShineDensity;')
  && density.includes('uniform float uDensityReady;'));
check('density fragment has the log chunk',
  density.includes('float kaloShineDensityLog(float raw)'));
check('density loop keeps 16 taps', density.includes('for (int i = 0; i < 16; i++)'));
check('density loop weights by transmittance',
  density.includes('acc += highlightAt(suv, uShineThreshold) * w * trans;'));
check('density loop attenuates with the design formula',
  density.includes('trans *= exp(-uShineDensity * 3.0 * kaloShineDensityLog(pd) * dsTap);'));

// Removing the inserted pieces from the density variant must
// reproduce the legacy string byte-for-byte.
const stripped = density
  .replace('uniform sampler2D uParticleDensity;\nuniform float uShineDensity;\nuniform float uDensityReady;\n', '')
  .replace(/\nfloat kaloShineDensityLog\(float raw\) \{\n  return log\(1\.0 \+ raw \* 8\.0\) \* 0\.4551196;\n\}\n/, '')
  .replace(`    vec3 acc = vec3(0.0);
    float trans = 1.0;
    float dsTap = maxS / 15.0;
    for (int i = 0; i < 16; i++) {
      float s = (float(i) / 15.0) * maxS;
      vec2 suv = (lightAc + dir * s) / vec2(uAspect, 1.0);
      float w = s <= dist ? 1.0 : exp(-(s - dist) / max(reach, 0.001));
      acc += highlightAt(suv, uShineThreshold) * w * trans;
      if (uDensityReady > 0.5) {
        float pd = texture2D(uParticleDensity, clamp(suv, 0.001, 0.999)).r;
        trans *= exp(-uShineDensity * 3.0 * kaloShineDensityLog(pd) * dsTap);
      }
    }`, `    vec3 acc = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      float s = (float(i) / 15.0) * maxS;
      vec2 suv = (lightAc + dir * s) / vec2(uAspect, 1.0);
      float w = s <= dist ? 1.0 : exp(-(s - dist) / max(reach, 0.001));
      acc += highlightAt(suv, uShineThreshold) * w;
    }`);
check('density variant minus insertions === legacy verbatim', stripped === legacy,
  `len ${stripped.length} vs ${legacy.length}`);

// --- Math twins, hand-computed ---
check('scale is quarter resolution', PARTICLE_DENSITY_SCALE === 0.25);
check('splat gain is 0.02', PARTICLE_DENSITY_SPLAT_GAIN === 0.02);
check('gain K is 3', SHINE_DENSITY_GAIN === 3.0);
check('log(0) = 0', shineDensityLog(0) === 0);
check('log(1) = 1', near(shineDensityLog(1), 1));
check('log(0.125) = ln2/ln9', near(shineDensityLog(0.125), Math.log(2) / Math.log(9)));
check('transmittance is 1 at strength 0', shineDensityTransmittance(0, 5, 1) === 1);
check('transmittance is 1 at density 0', shineDensityTransmittance(1, 0, 1) === 1);
check('transmittance hand value',
  near(shineDensityTransmittance(1, 1, 0.5), Math.exp(-1.5)));
check('transmittance monotonic in strength',
  shineDensityTransmittance(0.25, 1, 0.5) > shineDensityTransmittance(0.5, 1, 0.5)
  && shineDensityTransmittance(0.5, 1, 0.5) > shineDensityTransmittance(1, 1, 0.5));

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
