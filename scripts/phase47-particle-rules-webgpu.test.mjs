// G10 stage 3 — particle rules on the WebGPU (WGSL) route:
//   - the capability registry now lists 'particle-rules' as
//     supported, so a rules config stays on the WebGPU route
//     (stage 1-2 routed it to WebGL)
//   - VEL_WGSL decodes the baked permit mask from the attribute
//     texture's slot 3 and multiplies the five gated forces
//   - POS_WGSL binds the attribute texture (binding 5) and
//     consumes the kill bit through the age placement law
//   - the JS uniform writes land on the appended struct fields
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p47-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
const posWgsl = src.slice(src.indexOf('const POS_WGSL'), src.indexOf('export type WebGPUComputeState'));

// ── VEL_WGSL consumption ──
check('W1 vel struct tail field', velWgsl.includes('particleRulesEnabled : f32'));
check('W2 vel mask decode (+0.5 / u32 precedent)', velWgsl.includes('u32(textureLoad(attrTex,') && velWgsl.includes('.a + 0.5)'));
check('W3 vel permit bits 1/2/4/8/16', ['(ruleMask & 1u) != 0u', '(ruleMask & 2u) != 0u', '(ruleMask & 4u) != 0u', '(ruleMask & 8u) != 0u', '(ruleMask & 16u) != 0u'].every((s) => velWgsl.includes(s)));
check('W4 gravity multiplied by permit', velWgsl.includes('u.gravity * u.delta * 9.8 * rulePermitGravity'));
check('W5 turbulence multiplied by permit', velWgsl.includes('u.turbulence * 18.0 * u.delta * rulePermitTurbulence'));
check('W6 curl multiplied by permit', velWgsl.includes('u.curlStrength * 20.0 * u.delta * rulePermitCurl'));
check('W7 wind multiplied by permit', velWgsl.includes('u.delta * 30.0 * rulePermitWind'));
check('W8 morph relaxation multiplied by permit', velWgsl.includes('clamp(mf + u.delta * 6.0, 0.0, 1.0) * rulePermitMorph'));
check('W9 permits default to 1 (no-rule identity)', velWgsl.includes('var rulePermitGravity = 1.0;') && velWgsl.includes('if (u.particleRulesEnabled > 0.5)'));

// ── POS_WGSL consumption ──
check('P1 pos struct tail field', posWgsl.includes('particleRuleKillEnabled : f32'));
check('P2 pos attr binding 5', posWgsl.includes('@group(0) @binding(5) var attrTex : texture_2d<f32>;'));
check('P3 pos kill bit 32', posWgsl.includes('(ruleMask & 32u) != 0u'));
check('P4 kill uses the age placement law', posWgsl.includes('u.bounceRadius * (0.05 + hash1Age(vUv + vec2f(age)) * 0.9)'));
check('P5 kill runs outside the age switch', posWgsl.indexOf('u.particleRuleKillEnabled > 0.5') > posWgsl.indexOf('if (u.ageEnabled > 0.5)'));

// ── JS plumbing ──
check('J1 vel uniform bytes 752', src.includes('const VEL_UNIFORM_BYTES = 752;'));
check('J2 vel write at index 184', src.includes('velU[184] = f && f.particleRulesEnabled ? 1 : 0;'));
check('J3 pos uniform bytes stay 128', src.includes('const POS_UNIFORM_BYTES = 128;'));
check('J4 pos write at index 30', src.includes('posU[30] = f && f.particleRuleKillEnabled ? 1 : 0;'));
check('J5 pos BGL binding 5 texture', src.includes("{ binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } }"));
check('J6 pos BG binding 5 attr view', src.includes('{ binding: 5, resource: state.attrTexture.createView() }'));
check('J7 force params carry the flags', src.includes('particleRulesEnabled?: boolean;') && src.includes('particleRuleKillEnabled?: boolean;'));

// ── Pass layer + capability (behavioral, via esbuild bundle) ──
const passesSrc = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
check('S1 passes feed both flags', passesSrc.includes('particleRulesEnabled: !!args.attrTex && hasEffectiveParticleRules(') && passesSrc.includes('particleRuleKillEnabled: !!args.attrTex && hasEffectiveParticleRules('));
check('S2 passes keep the replica-stack suppression', passesSrc.includes("particleRulesHaveAction(config.gpgpuParticleRules ?? '', 'kill') && !args.suppressGroupKill,\n        audioBlast: blast,"));

try {
  await build({
    stdin: {
      contents: `
        export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
        export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
        export { createParticleRule, serializeParticleRules } from './lib/gpgpuParticleRules.ts';
      `,
      resolveDir: ROOT, loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
  });
  const { getWebgpuComputeCapabilityReport, DEFAULT_CONFIG, createParticleRule, serializeParticleRules } = await import(pathToFileURL(BUNDLE).href);
  const rulesText = serializeParticleRules([createParticleRule({ action: { type: 'kill' } })]);
  check('C0 fixture rule serializes', typeof rulesText === 'string' && rulesText.length > 0);
  const withRules = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuParticleRules: rulesText });
  check('C1 rules config requests particle-rules', withRules.requestedFeatures.includes('particle-rules'), JSON.stringify(withRules.requestedFeatures));
  check('C2 particle-rules no longer unsupported', !withRules.unsupportedFeatures.includes('particle-rules'), JSON.stringify(withRules.unsupportedFeatures));
  const noRules = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuParticleRules: '' });
  check('C3 empty rules do not request the feature', !noRules.requestedFeatures.includes('particle-rules'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
