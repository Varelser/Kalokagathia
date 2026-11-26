// Phase 25 — fluid field WGSL port, structural + fixture checks:
//   - FLUID_WGSL carries the FLUID_ADVECT_FRAG law verbatim
//     (backward trace x80, 5-point Laplacian, decay x60, vortex +
//     perturbation forcing), on a third pipeline dispatched
//     BEFORE the velocity pass
//   - the grid is resident (ping-pong buffers, lazily created —
//     a fluid-off state allocates none), seeded with the same
//     analytic vortex the WebGL runtime uses
//   - the velocity WGSL carries the legacy coupling formula
//     (field.y drives vel.z, x300) behind fu.enabled
//   - the registry supports 'fluid-field' alone, while fluid +
//     flip / fluid + custom-force still route to WebGL
//   - a TS twin of the advection law (the fixture standing in
//     for the CPU mirror the field never had) is self-consistent:
//     zero stays zero, decay-only is the exact per-step factor,
//     diffusion-only decays the peak monotonically, and one
//     forced step from rest matches the analytic forcing.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p25-fluid-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── Structural pins on lib/webgpuCompute.ts ─────────────────────
const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const fluidWgsl = src.slice(src.indexOf('const FLUID_WGSL'), src.indexOf('export const WEBGPU_FLUID_SIZE'));
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
const stepSrc = src.slice(src.indexOf('export function stepWebGPUCompute'));

check('FLUID_WGSL exists', fluidWgsl.length > 500);
check('FLUID_WGSL backward trace x80', fluidWgsl.includes('let backPos = uv - vel * fu.delta * ts * 80.0;'));
check('FLUID_WGSL 5-point Laplacian', fluidWgsl.includes('let lap = vL + vR + vB + vT - 4.0 * advVel;'));
check('FLUID_WGSL diffusion term', fluidWgsl.includes('var newVel = advVel + fu.diffuse * lap;'));
check('FLUID_WGSL decay x60', fluidWgsl.includes('newVel *= 1.0 - fu.decay * fu.delta * 60.0;'));
check('FLUID_WGSL vortex forcing', fluidWgsl.includes('newVel += rot * fu.strength * fu.delta * 2.0;'));
check('FLUID_WGSL perturbation forcing', fluidWgsl.includes('sin(uv.y * 6.2832 + t)') && fluidWgsl.includes('cos(uv.x * 6.2832 - t)') && fluidWgsl.includes('* fu.strength * 0.3 * fu.delta'));
check('FLUID_WGSL output shape (z=0, w=1)', fluidWgsl.includes('fluidOut[idx] = vec4f(newVel, 0.0, 1.0);'));
check('FLUID_WGSL workgroup 8x8', fluidWgsl.includes('@workgroup_size(8, 8)'));
check('third pipeline created', src.includes('const fluidPipeline = device.createComputePipeline({'));
check('grid lazily created (null at init)', src.includes('fluidABuf: null, fluidBBuf: null, fluidPingIsA: true'));
check('ensureFluidGrid seeds both sides', src.includes('function ensureFluidGrid') && src.includes('writeBuffer(state.fluidABuf') && src.includes('writeBuffer(state.fluidBBuf'));
check('fluid dispatch sized 8x8 workgroups', stepSrc.includes('fluidPass.dispatchWorkgroups(WEBGPU_FLUID_SIZE / 8, WEBGPU_FLUID_SIZE / 8)'));
check('fluid dispatch precedes velocity dispatch',
  stepSrc.indexOf('fluidPass.dispatchWorkgroups') > -1 &&
  stepSrc.indexOf('fluidPass.dispatchWorkgroups') < stepSrc.indexOf('velPass.dispatchWorkgroups'));
check('fluid dispatch gated on fluidOn', stepSrc.includes('if (fluidOn) {\n    ensureFluidGrid(state);'));
check('velocity binds fluid at 8/9', stepSrc.includes('{ binding: 8, resource: { buffer: fluidReadBuf } }') && stepSrc.includes('{ binding: 9, resource: { buffer: state.fluidUBuf } }'));
check('fluid uniform writes 0..8', stepSrc.includes('fluidU[0] = delta;') && stepSrc.includes('fluidU[5] = fluid && fluid.extForce ? 1 : 0;') && stepSrc.includes('fluidU[8] = fluidOn ? 1 : 0;'));
check('ping flips after dispatch', stepSrc.includes('state.fluidPingIsA = !state.fluidPingIsA;'));

check('VEL_WGSL fluid binding 8/9 declared', velWgsl.includes('@binding(8) var<storage, read>') && velWgsl.includes('@binding(9) var<uniform>'));
check('VEL_WGSL coupling gated', velWgsl.includes('if (fu.enabled > 0.5) {'));
check('VEL_WGSL coupling uv law', velWgsl.includes('pos.xz / (u.bounceRadius * fu.scale) * 0.5 + 0.5') && velWgsl.includes('clamp(fieldUv, vec2f(0.001), vec2f(0.999))'));
check('VEL_WGSL coupling x300, field.y -> vel.z',
  velWgsl.includes('vel.x += fieldVel.x * fu.influence * u.delta * 300.0;') &&
  velWgsl.includes('vel.z += fieldVel.y * fu.influence * u.delta * 300.0;'));
check('VEL uniform buffer 752 (736 through G10 stage 2; stage 3 appended the particle-rules field at index 184)', src.includes('const VEL_UNIFORM_BYTES = 752;'));

// The WebGL side must stay byte-identical in law: the GLSL
// advection source still carries its original expressions.
const glsl = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationFluid.ts'), 'utf8');
check('GLSL advection untouched (law strings)', glsl.includes('vec2 backPos = uv - vel * uDelta * ts * 80.0;') && glsl.includes('newVel *= 1.0 - uFluidDecay * uDelta * 60.0;'));

// Pass-layer threading + the scene's no-double-run guard.
const passes = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
check('passes thread fluid params from config', passes.includes('enabled: config.gpgpuFluidEnabled,') && passes.includes('extForce: config.gpgpuFluidExtForce,'));
const scene = readFileSync(join(ROOT, 'components/sceneGpgpuSystem.tsx'), 'utf8');
check('scene skips WebGL fluid pass on WebGPU route', scene.includes('if (!fluidFrameUseWebGPU) runFluidAdvectionPass({'));

// ── TS twin fixture of the advection law ────────────────────────
const S = 64;
const wrap = (i) => ((i % S) + S) % S;
function sample(field, u, v) {
  const px = u * S - 0.5, py = v * S - 0.5;
  const bx = Math.floor(px), by = Math.floor(py);
  const fx = px - bx, fy = py - by;
  const at = (x, y) => field[wrap(y) * S + wrap(x)];
  const c00 = at(bx, by), c10 = at(bx + 1, by), c01 = at(bx, by + 1), c11 = at(bx + 1, by + 1);
  return [
    (c00[0] * (1 - fx) + c10[0] * fx) * (1 - fy) + (c01[0] * (1 - fx) + c11[0] * fx) * fy,
    (c00[1] * (1 - fx) + c10[1] * fx) * (1 - fy) + (c01[1] * (1 - fx) + c11[1] * fx) * fy,
  ];
}
function twinStep(field, { delta, diffuse, decay, strength, time, extForce }) {
  const ts = 1 / S;
  const out = new Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const uv = [(x + 0.5) / S, (y + 0.5) / S];
    const vel = field[y * S + x];
    const adv = sample(field, uv[0] - vel[0] * delta * ts * 80, uv[1] - vel[1] * delta * ts * 80);
    const vL = sample(field, uv[0] - ts, uv[1]), vR = sample(field, uv[0] + ts, uv[1]);
    const vB = sample(field, uv[0], uv[1] - ts), vT = sample(field, uv[0], uv[1] + ts);
    let nx = adv[0] + diffuse * (vL[0] + vR[0] + vB[0] + vT[0] - 4 * adv[0]);
    let ny = adv[1] + diffuse * (vL[1] + vR[1] + vB[1] + vT[1] - 4 * adv[1]);
    const dk = 1 - decay * delta * 60;
    nx *= dk; ny *= dk;
    if (extForce) {
      const c = [uv[0] - 0.5, uv[1] - 0.5];
      const r = Math.hypot(c[0], c[1]) + 0.001;
      const denom = r * r + 0.1;
      nx += (-c[1] / denom) * strength * delta * 2;
      ny += (c[0] / denom) * strength * delta * 2;
      const t = time * 0.3;
      nx += Math.sin(uv[1] * 6.2832 + t) * strength * 0.3 * delta;
      ny += Math.cos(uv[0] * 6.2832 - t) * strength * 0.3 * delta;
    }
    out[y * S + x] = [nx, ny];
  }
  return out;
}
const zeroField = () => Array.from({ length: S * S }, () => [0, 0]);
const maxAbs = (f) => Math.max(...f.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));

let f = zeroField();
for (let i = 0; i < 5; i++) f = twinStep(f, { delta: 1 / 60, diffuse: 0.02, decay: 0.01, strength: 1, time: i / 60, extForce: false });
check('twin: zero field stays zero', maxAbs(f) === 0);

f = Array.from({ length: S * S }, () => [0.5, -0.25]);
for (let i = 0; i < 10; i++) f = twinStep(f, { delta: 1 / 60, diffuse: 0, decay: 0.01, strength: 0, time: 0, extForce: false });
const expectDecay = 0.5 * Math.pow(0.99, 10);
check('twin: decay-only matches per-step factor', near(f[0][0], expectDecay, 1e-9) && near(f[0][1], -0.25 * Math.pow(0.99, 10), 1e-9),
  `${f[0]} vs ${expectDecay}`);

f = Array.from({ length: S * S }, (_, i) => [Math.sin(((i % S) / S) * Math.PI * 2) * 0.5, 0]);
let prevMax = maxAbs(f);
let monotonic = true;
for (let i = 0; i < 5; i++) {
  f = twinStep(f, { delta: 0.008, diffuse: 0.5, decay: 0, strength: 0, time: 0, extForce: false });
  const m = maxAbs(f);
  if (!(m < prevMax)) monotonic = false;
  prevMax = m;
}
check('twin: diffusion-only peak decays monotonically', monotonic, `final max ${prevMax}`);

f = twinStep(zeroField(), { delta: 1 / 60, diffuse: 0.02, decay: 0.01, strength: 1, time: 0, extForce: true });
const cell = f[32 * S + 48];
const uvC = [(48 + 0.5) / S, (32 + 0.5) / S];
const cc = [uvC[0] - 0.5, uvC[1] - 0.5];
const rr = Math.hypot(cc[0], cc[1]) + 0.001;
const expX = (-cc[1] / (rr * rr + 0.1)) * (1 / 60) * 2 + Math.sin(uvC[1] * 6.2832) * 0.3 * (1 / 60);
const expY = (cc[0] / (rr * rr + 0.1)) * (1 / 60) * 2 + Math.cos(uvC[0] * 6.2832) * 0.3 * (1 / 60);
check('twin: one forced step from rest matches analytic forcing', near(cell[0], expX, 1e-9) && near(cell[1], expY, 1e-9),
  `${cell} vs [${expX}, ${expY}]`);

// ── Registry behaviour + initial field (bundled imports) ───────
await build({
  stdin: {
    contents: `
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { createFluidInitialFieldData, WEBGPU_FLUID_SIZE } from './lib/webgpuCompute.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const { getWebgpuComputeCapabilityReport, DEFAULT_CONFIG, createFluidInitialFieldData, WEBGPU_FLUID_SIZE } = await import(pathToFileURL(BUNDLE).href);
  const fluidOnly = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuFluidEnabled: true });
  check('fluid-only config can run on WebGPU route', fluidOnly.canRunRequestedConfig && fluidOnly.supportedFeatures.includes('fluid-field'),
    JSON.stringify(fluidOnly.unsupportedFeatures));
  const fluidFlip = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuFluidEnabled: true, gpgpuFlipEnabled: true });
  check('fluid + flip still routes to WebGL (flip unsupported, fluid not blamed)',
    !fluidFlip.canRunRequestedConfig && fluidFlip.unsupportedFeatures.includes('flip') && !fluidFlip.unsupportedFeatures.includes('fluid-field'),
    JSON.stringify(fluidFlip.unsupportedFeatures));
  const fluidCustom = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG, gpgpuFluidEnabled: true, gpgpuCustomForceEnabled: true, gpgpuCustomForceCode: 'x' });
  check('fluid + custom-force still routes to WebGL', !fluidCustom.canRunRequestedConfig && fluidCustom.unsupportedFeatures.includes('custom-force'));
  const plain = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG });
  check('default config does not request fluid-field', !plain.requestedFeatures?.includes('fluid-field') && !plain.unsupportedFeatures.includes('fluid-field'));

  check('WEBGPU_FLUID_SIZE is 64', WEBGPU_FLUID_SIZE === 64);
  const init = createFluidInitialFieldData();
  check('initial field shape', init.length === 64 * 64 * 4);
  const at = (x, y) => { const i = (y * 64 + x) * 4; return [init[i], init[i + 1], init[i + 2], init[i + 3]]; };
  check('initial field centre is rest, w=1', near(at(32, 32)[0], 0, 1e-6) && near(at(32, 32)[1], 0, 1e-6) && at(32, 32)[3] === 1);
  check('initial field is a pure rotation (antisymmetric)', near(at(48, 32)[1], -at(16, 32)[1], 1e-6) && near(at(32, 48)[0], -at(32, 16)[0], 1e-6),
    `${at(48, 32)} / ${at(16, 32)}`);
  check('initial field matches analytic vortex at (48,32)', near(at(48, 32)[1], (0.25 / (Math.pow(Math.sqrt(0.25 * 0.25) + 0.001, 2) + 0.1)) * 0.08, 1e-6),
    `${at(48, 32)[1]}`);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
