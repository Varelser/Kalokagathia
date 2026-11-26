// Stage 0 S7 (plan A1) — WebGPU route-aware captureState,
// against STAGE0_S7_CROWD_DIAG_ANALYSIS and the fixed design:
// - Freshness contract (pure): no snapshot -> not available +
//   stale; snapshot at the latest frame -> fresh; frame lag
//   beyond the bound or wall-clock age beyond the bound -> stale
// - webgpuCompute wiring (string pins): vel staging buffer with
//   the position twin's allocation rule, velOut copy queued in
//   the step alongside the position copy, staged-pair frame
//   bookkeeping, pair readback with no fallback storage, destroy
// - captureState wiring (string pins): the WebGPU branch runs
//   BEFORE any WebGL readback, reports 'diag-snapshot-not-ready'
//   instead of returning frozen targets, and kicks the refresh
// - WebGL invariance (string pins): the historical WebGL branch
//   lines and its return shape are byte-identical to before
// - DEM guard: the new staging buffer is MAP_READ only, never
//   a storage binding (the DEM storage-buffer cap is untouched)
// Run: node scripts/stage0-webgpu-diag.test.mjs   (from the project root)
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.stage0-diag-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { describeWebGPUDiagSnapshot, WEBGPU_DIAG_STALE_FRAME_LAG, WEBGPU_DIAG_STALE_AGE_MS } from './lib/webgpuDiagSnapshot.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { describeWebGPUDiagSnapshot, WEBGPU_DIAG_STALE_FRAME_LAG, WEBGPU_DIAG_STALE_AGE_MS } = lib;

// ── Freshness contract ──────────────────────────────────────
const snap = (frame, capturedAtMs) => ({
  positions: new Float32Array(4),
  velocities: new Float32Array(4),
  frame,
  capturedAtMs,
});

const none = describeWebGPUDiagSnapshot(null, 7, 1000);
check('no snapshot: route is webgpu', none.route === 'webgpu');
check('no snapshot: available false', none.available === false);
check('no snapshot: stale true', none.stale === true);
check('no snapshot: frame/capturedAtMs null', none.frame === null && none.capturedAtMs === null);
check('no snapshot: latestFrame passes through', none.latestFrame === 7);

const fresh = describeWebGPUDiagSnapshot(snap(10, 1000), 10, 1100);
check('fresh snapshot: available true', fresh.available === true);
check('fresh snapshot: stale false', fresh.stale === false);
check('fresh snapshot: frame/capturedAtMs reported', fresh.frame === 10 && fresh.capturedAtMs === 1000);

const lagOk = describeWebGPUDiagSnapshot(snap(10, 1000), 10 + WEBGPU_DIAG_STALE_FRAME_LAG, 1100);
check('frame lag at the bound: not stale', lagOk.stale === false);
const lagStale = describeWebGPUDiagSnapshot(snap(10, 1000), 10 + WEBGPU_DIAG_STALE_FRAME_LAG + 1, 1100);
check('frame lag past the bound: stale', lagStale.stale === true);
check('stale snapshot is still available (labelled, not hidden)', lagStale.available === true);

const ageOk = describeWebGPUDiagSnapshot(snap(10, 1000), 10, 1000 + WEBGPU_DIAG_STALE_AGE_MS);
check('wall-clock age at the bound: not stale', ageOk.stale === false);
const ageStale = describeWebGPUDiagSnapshot(snap(10, 1000), 10, 1000 + WEBGPU_DIAG_STALE_AGE_MS + 1);
check('wall-clock age past the bound: stale', ageStale.stale === true);

// ── webgpuCompute wiring (string pins) ──────────────────────
const computeSrc = readFileSync(join(ROOT, 'lib', 'webgpuCompute.ts'), 'utf8');

const velStagingBlock = computeSrc.slice(
  computeSrc.indexOf('const velStagingBuf = device.createBuffer({'),
  computeSrc.indexOf('const velStagingBuf = device.createBuffer({') + 200,
);
check('vel staging buffer is created', velStagingBlock.length > 0 && velStagingBlock.includes('size: byteSize'));
check('vel staging is MAP_READ | COPY_DST (same rule as position staging)',
  velStagingBlock.includes('GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST'));
check('vel staging is NOT a storage buffer (DEM cap untouched)',
  !velStagingBlock.includes('STORAGE'));

check('step queues the velOut -> velStagingBuf copy',
  computeSrc.includes('enc.copyBufferToBuffer(velOut, 0, state.velStagingBuf, 0, N * 16);'));
check('step still queues the posOut -> stagingBuf copy',
  computeSrc.includes('enc.copyBufferToBuffer(posOut, 0, state.stagingBuf, 0, N * 16);'));
check('staged pair frame is recorded only when both copies queued',
  computeSrc.includes('state.diagStagedFrame = diagStepFrame;'));
check('a single-copy step invalidates the staged pair',
  computeSrc.includes('state.diagStagedFrame = -1;'));
check('frame counter advances once per step',
  computeSrc.includes('state.diagFrameCounter += 1;'));

check('velocity readback twin is exported',
  computeSrc.includes('export async function readbackWebGPUVelocities('));
check('snapshot refresh is exported',
  computeSrc.includes('export function refreshWebGPUDiagSnapshot(state: WebGPUComputeState): void'));
const refreshBlock = computeSrc.slice(
  computeSrc.indexOf('export function refreshWebGPUDiagSnapshot'),
  computeSrc.indexOf('export function destroyWebGPUCompute'),
);
check('refresh stores the completed pair as diagSnapshot',
  refreshBlock.includes('state.diagSnapshot = { positions, velocities, frame, capturedAtMs: performance.now() };'));
check('refresh holds both pending flags during the pair map',
  refreshBlock.includes('state.readbackPending = true;') && refreshBlock.includes('state.velReadbackPending = true;'));
check('refresh stores no fallback data (no lastResult / fallback in the pair path)',
  !refreshBlock.includes('fallback'));
check('vel staging buffer is destroyed with the state',
  computeSrc.includes('state.velStagingBuf.destroy();'));

// ── captureState wiring (string pins) ───────────────────────
const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
const captureStart = sceneSrc.indexOf('captureState: () => {');
const captureEnd = sceneSrc.indexOf('captureAov:', captureStart);
const captureBlock = sceneSrc.slice(captureStart, captureEnd);
check('captureState block found', captureStart >= 0 && captureEnd > captureStart);

const branchIdx = captureBlock.indexOf("if (ctx.route === 'webgpu') {");
const webglReadIdx = captureBlock.indexOf('gl.readRenderTargetPixels(ctx.posOut');
check('WebGPU branch exists in captureState', branchIdx >= 0);
check('WebGPU branch runs before any WebGL readback', branchIdx >= 0 && webglReadIdx > branchIdx);
check('not-ready error is reported instead of frozen data',
  captureBlock.includes("error: 'diag-snapshot-not-ready'"));
check('captureState kicks the snapshot refresh',
  captureBlock.includes('refreshWebGPUDiagSnapshot(wg);'));
check('captureState returns freshness metadata on the WebGPU route',
  captureBlock.includes('describeWebGPUDiagSnapshot(wg.diagSnapshot, wg.diagFrameCounter, performance.now())'));
check('frame publication carries the route',
  sceneSrc.includes("route: routing.useWebGPU ? 'webgpu' : 'webgl',"));
check('frame publication carries the WebGPU state on the WebGPU route',
  sceneSrc.includes('webgpuState: routing.useWebGPU ? webgpuStateRef.current : null,'));

// ── WebGL invariance (string pins) ──────────────────────────
check('WebGL readback line is byte-identical to the historical branch',
  captureBlock.includes('gl.readRenderTargetPixels(ctx.posOut, 0, 0, ctx.texSize, ctx.texSize, diagPosBufRef.current);'));
check('WebGL velocity readback call is unchanged',
  captureBlock.includes('readbackParticleVelocities({'));
check('WebGL return shape is unchanged (no freshness fields added)',
  captureBlock.includes('return { texSize: state.texSize, stateHash: state.stateHash, stats };'));
check('WebGL no-frame error is unchanged',
  captureBlock.includes("if (!ctx) return { error: 'no-frame-yet' };"));

// ── Diagnostic context contract ─────────────────────────────
const aovSrc = readFileSync(join(ROOT, 'components', 'gpgpuDiagnosticAov.ts'), 'utf8');
check('DiagnosticFrameContext carries the route',
  aovSrc.includes("route?: 'webgl' | 'webgpu';"));
check('DiagnosticFrameContext carries the WebGPU state',
  aovSrc.includes('webgpuState?: WebGPUComputeState | null;'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
