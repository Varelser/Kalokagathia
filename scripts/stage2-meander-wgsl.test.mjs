// Grammar 2.0 stage 2, B7 follow-up — Meander on the WebGPU
// route: the WGSL velocity pass gains the wander term (both
// homes: inside the Particle Life block and the standalone
// block after it), the REP gate consumption (mask bit 14),
// the uniform tail (indices 188-191, buffer 768 bytes), the
// pass-layer supply, and the retirement of the B7-era
// 'meander-standalone' capability gap declaration.
// Approved by Sugi 2026-11-27 ("WGSL への徘徊（Meander）
// 実装の可否 実装して"). Record:
// kalokagathia-pro/STAGE2_MEANDER_WGSL_IMPL_RECORD.md.
//
// Cases:
//  1 uniform tail + byte total
//  2 velU supply indices
//  3 the WGSL law vs the CPU twin (meanderVector), transcribed
//    exactly as the B7 test transcribed the GLSL term
//  4 guards + exactly-once structure (in-block yields while
//    the standalone stands; standalone block sits after the
//    Particle Life block's friction)
//  5 REP gate consumption (bit 16384 -> livePermitMeander,
//    both applications multiplied by it)
//  6 capability: nothing requests 'meander-standalone'
//    anymore, defaults included
//  7 pass-layer supply wiring (source)
//  8 identity: GLSL default shader pins untouched (the WebGL
//    route did not move), POS_WGSL pin untouched
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2mw-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const count = (s, sub) => s.split(sub).length - 1;

await build({
  stdin: {
    contents: `
      export { meanderVector, meanderPhaseForIndex } from './lib/particleLifeBehavior.ts';
      export { dmHash11 } from './lib/gpgpuRandom.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { meanderVector, meanderPhaseForIndex, dmHash11, getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU } = lib;

const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
const posWgsl = src.slice(src.indexOf('const POS_WGSL'), src.indexOf('export type WebGPUComputeState'));

// ── 1. Uniform tail + byte total ────────────────────────────
{
  const tail = velWgsl.slice(velWgsl.indexOf('particleRulesPad2'));
  check('1 meander uniform fields appended after the G10 pads',
    tail.includes('meanderAmount : f32') && tail.includes('meanderScale : f32')
    && tail.includes('meanderStandaloneEnabled : f32') && tail.includes('meanderPad0 : f32'));
  check('1 velocity uniform buffer is 768 bytes',
    src.includes('const VEL_UNIFORM_BYTES = 768;'));
}

// ── 2. velU supply indices ──────────────────────────────────
{
  check('2 velU[188] = amount (absent force params read 0)',
    src.includes('velU[188] = f ? (f.particleLifeMeanderAmount ?? 0) : 0;'));
  check('2 velU[189] = scale (absent reads the legacy default 1)',
    src.includes('velU[189] = f ? (f.particleLifeMeanderScale ?? 1) : 1;'));
  check('2 velU[190] = standalone flag',
    src.includes('velU[190] = f && f.meanderStandaloneEnabled ? 1 : 0;'));
}

// ── 3. The WGSL law vs the CPU twin ─────────────────────────
{
  // WGSL transcription: plHash(n) is the same dmHash11
  // composition the GLSL block uses (B7 test section 2), the
  // phase is plHash(f32(idx) + 17.17) * 6.2831853.
  const wgslTerm = (idx, pos, scaleKey, time) => {
    const phase = dmHash11((idx + 17.17) * 3.71 + 17.17) * 6.2831853;
    const s = 0.02 * Math.max(scaleKey, 0.001);
    const t = time * 0.7;
    return {
      x: Math.sin(pos.y * s + phase + t),
      y: Math.sin(pos.z * s + phase * 1.7 + t),
      z: Math.sin(pos.x * s + phase * 2.3 + t),
    };
  };
  let maxErr = 0;
  for (const [idx, pos, scale, time] of [
    [0, { x: 1, y: 2, z: 3 }, 1, 0.5],
    [17, { x: -4, y: 0.25, z: 9 }, 2, 2.0],
    [123, { x: 40, y: -17, z: 3.5 }, 0.5, 11.3],
    [4095, { x: 0, y: 0, z: 0 }, 5, 0],
  ]) {
    const g = wgslTerm(idx, pos, scale, time);
    const c = meanderVector(pos, meanderPhaseForIndex(idx), scale, time);
    maxErr = Math.max(maxErr, Math.abs(g.x - c.x), Math.abs(g.y - c.y), Math.abs(g.z - c.z));
  }
  check('3 WGSL term transcription agrees with the CPU twin (meanderVector)',
    maxErr < 1e-5, String(maxErr));
  check('3 both WGSL applications carry the transcribed constants',
    count(velWgsl, 'plHash(f32(idx) + 17.17) * 6.2831853') === 2
    && count(velWgsl, '0.02 * max(u.meanderScale, 0.001)') === 2
    && count(velWgsl, 'sin(pos.z * mScale + mPhase * 1.7 + mTime)') === 2
    && count(velWgsl, 'sin(pos.x * mScale + mPhase * 2.3 + mTime)') === 2);
}

// ── 4. Guards + exactly-once structure ──────────────────────
{
  check('4 in-block term yields while the standalone stands',
    velWgsl.includes('if (u.meanderStandaloneEnabled < 0.5 && u.meanderAmount > 0.0)'));
  check('4 standalone block guard',
    velWgsl.includes('if (u.meanderStandaloneEnabled > 0.5 && u.meanderAmount > 0.0)'));
  const frictionAt = velWgsl.indexOf('vel *= pow(clamp(u.particleLifeFriction, 0.0, 1.0), u.delta * 60.0);');
  const standaloneAt = velWgsl.indexOf('if (u.meanderStandaloneEnabled > 0.5 && u.meanderAmount > 0.0)');
  const inBlockAt = velWgsl.indexOf('if (u.meanderStandaloneEnabled < 0.5 && u.meanderAmount > 0.0)');
  check('4 standalone block sits after the Particle Life friction; in-block term before it',
    inBlockAt > 0 && frictionAt > inBlockAt && standaloneAt > frictionAt,
    `inBlock=${inBlockAt} friction=${frictionAt} standalone=${standaloneAt}`);
  check('4 exactly two meander applications exist in the WGSL pass',
    count(velWgsl, 'vel += mVec * u.meanderAmount * u.delta * 30.0 * livePermitMeander;') === 2);
}

// ── 5. REP gate consumption ─────────────────────────────────
{
  check('5 livePermitMeander declared and read from mask bit 14 (16384)',
    velWgsl.includes('var livePermitMeander = 1.0;')
    && velWgsl.includes('livePermitMeander = select(0.0, 1.0, (liveMask & 16384u) != 0u);'));
}

// ── 6. Capability ───────────────────────────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  const on = getWebgpuComputeCapabilityReport({ ...base, gpgpuMeanderEnabled: true, gpgpuParticleLifeMeanderAmount: 1.5 });
  check('6 standalone config requests no meander gap feature',
    !on.requestedFeatures.includes('meander-standalone') && !on.unsupportedFeatures.includes('meander-standalone'));
  const legacy = getWebgpuComputeCapabilityReport({ ...base, gpgpuParticleLifeEnabled: true, gpgpuParticleLifeMeanderAmount: 1 });
  check('6 legacy in-block config requests no meander gap feature either',
    !legacy.requestedFeatures.includes('meander-standalone'));
  const foundationSrc = readFileSync(join(ROOT, 'lib/webgpuComputeFoundation.ts'), 'utf8');
  check('6 foundation no longer pushes the retired feature',
    !foundationSrc.includes("features.push('meander-standalone')"));
}

// ── 7. Pass-layer supply wiring ─────────────────────────────
{
  const passesSrc = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
  check('7 the WebGPU force params carry amount / scale verbatim from the config keys',
    passesSrc.includes('particleLifeMeanderAmount: config.gpgpuParticleLifeMeanderAmount,')
    && passesSrc.includes('particleLifeMeanderScale: config.gpgpuParticleLifeMeanderScale,'));
  check('7 the standalone flag comes from the single resolution point',
    passesSrc.includes('meanderStandaloneEnabled: meanderStandaloneActive(config),')
    && passesSrc.includes("import { meanderStandaloneActive } from '../lib/gpgpuMeander';"));
}

// ── 8. Identity: the WebGL route and POS_WGSL did not move ──
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  check('8 POS_WGSL sha256 pin unchanged',
    sha(posWgsl) === '3f96681e29281d8c76d01ca73d5ace96f23950aa3ce375dacf92caa5c66d42bd', sha(posWgsl));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
