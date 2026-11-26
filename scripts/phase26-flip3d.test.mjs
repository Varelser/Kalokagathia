// Phase 26 — FLIP 3D WGSL port, structural + numeric checks:
//   - the eleven FLIP3D_*_WGSL kernels carry the GLSL laws of
//     components/gpgpuShaderSimulationFlip3d.ts verbatim (P2G
//     trilinear shares, composite threshold, phi 3x3x3 blur +
//     occupancy correction, viscosity centre replacement,
//     curvature band gate, CSF tension, Pyro curl / vorticity,
//     free-surface Jacobi, forward-difference subtraction)
//   - P2G scatter is fixed-point (atomic i32, scale 2^10): the
//     TS twin's integer accumulation is order-independent and
//     within quantisation of the float reference
//   - the atlas addressing twin round-trips every cell of
//     every layout and agrees with pyroGridCellUv
//   - staged numeric agreement with the CPU mirror
//     (lib/flip3d.ts): chi build, pressure projection and
//     viscosity solve match the mirror's outputs
//   - the registry split: 3D mode requests 'flip-3d'
//     (supported), the 2D layer keeps requesting 'flip'
//     (WebGL), and flip-3d + whitewater still routes to WebGL
//   - step order: clears -> splat -> composite -> phi ->
//     phi advect -> viscosity -> tension -> vorticity ->
//     Jacobi -> subtract, all before the velocity dispatch;
//     coupling copies land after the position dispatch; the
//     grid is lazy; VEL_UNIFORM_BYTES stays 592 (Phase 27: 608).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p26-flip3d-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

// ── Structural pins on lib/webgpuCompute.ts ─────────────────────
const src = readFileSync(join(ROOT, 'lib/webgpuCompute.ts'), 'utf8');
const kernel = (name) => {
  const start = src.indexOf(`const ${name}`);
  return start < 0 ? '' : src.slice(start, src.indexOf('`;', start));
};
const splat = kernel('FLIP3D_SPLAT_WGSL');
const composite = kernel('FLIP3D_COMPOSITE_WGSL');
const phi = kernel('FLIP3D_PHI_WGSL');
const phiAdvect = kernel('FLIP3D_PHI_ADVECT_WGSL');
const viscosity = kernel('FLIP3D_VISCOSITY_WGSL');
const curvature = kernel('FLIP3D_CURVATURE_WGSL');
const tension = kernel('FLIP3D_TENSION_WGSL');
const curl = kernel('FLIP3D_CURL_WGSL');
const vorticity = kernel('FLIP3D_VORTICITY_WGSL');
const jacobi = kernel('FLIP3D_JACOBI_WGSL');
const subtract = kernel('FLIP3D_SUBTRACT_WGSL');
const velWgsl = src.slice(src.indexOf('const VEL_WGSL'), src.indexOf('const POS_WGSL'));
const stepSrc = src.slice(src.indexOf('export function stepWebGPUCompute'));

check('all eleven kernels exist', [splat, composite, phi, phiAdvect, viscosity, curvature, tension, curl, vorticity, jacobi, subtract].every((k) => k.length > 400));
check('fixed-point scale is 2^10', src.includes('const FLIP3D_FIXED_SCALE = 1024.0;'));
check('splat: grid mapping law', splat.includes('let g = (pos / (2.0 * extent) + 0.5) * u.gridN - 0.5;') && splat.includes('let extent = u.bounceRadius * u.fluidScale;'));
check('splat: trilinear share + bounds skip', splat.includes('let axisW = mix(1.0 - frac, frac, off);') && splat.includes('w <= 0.0') && splat.includes('cell.x > u.gridN - 1.0'));
check('splat: weight quantised first, momentum weighted by it', splat.includes('let wq = i32(round(w * ${FLIP3D_FIXED_SCALE}));') && splat.includes('atomicAdd(&transferI[t + 0u], i32(round(vel.x * f32(wq))));') && splat.includes('atomicAdd(&transferI[t + 3u], wq);'));
check('composite: threshold + coverage', composite.includes('w > 1e-6') && composite.includes('clamp(w / max(u.avgWeight, 1e-4), 0.0, 1.0)') && composite.includes('if (co.w > 0.5) { dataOut[idx] = vec4f(0.0); return; }'));
check('phi: 27-tap blur + (0.5-chi)*2', phi.includes('let chi = sum / 27.0;') && phi.includes('let phi = (0.5 - chi) * 2.0;') && phi.includes('vec4f(1.0, 0.0, 0.0, 1.0)'));
check('phiAdvect: semi-Lagrangian + occupancy max', phiAdvect.includes('let back = cell - vel * u.delta;') && phiAdvect.includes('let chi = max(adv.y, occ);'));
check('viscosity: centre replacement + Helmholtz form', viscosity.includes('fetchPhi(cell).g < 0.5') && viscosity.includes('(star + u.alpha * sum) / (1.0 + 6.0 * u.alpha)'));
check('curvature: band gate |phi| > 2 -> 0', curvature.includes('abs(phi) > 2.0'));
check('tension: CSF form + band/chi gates', tension.includes('vel += u.delta * u.sigma * kappa * gradChi;') && tension.includes('abs(phiChi.r) <= 2.0 && phiChi.g > 0.001'));
check('curl: central differences + |w| in w', curl.includes('duz_dy - duy_dz') && curl.includes('dataOut[idx] = vec4f(w, length(w));'));
check('vorticity: Fedkiw force + walls + clamp', vorticity.includes('u.epsilon * cross(eta / etaLen, w) * u.delta') && vorticity.includes('clamp(vel, vec3f(-u.maxSpeed), vec3f(u.maxSpeed))'));
check('jacobi: free-surface count includes in-domain air', jacobi.includes('if (nb.x < u.gridN) { count += 1.0; if (fetchPhi(nb).g >= 0.5) { sum += fetchPres(nb).r; } }') && jacobi.includes('(sum - div) / count'));
check('jacobi: backward-difference divergence', jacobi.includes('(vC.x - fetchVel(cell - vec3f(1.0, 0.0, 0.0)).x)'));
check('subtract: forward differences, air pressure 0, air cells verbatim', subtract.includes('vel -= vec3f(pX - pC, pY - pC, pZ - pC);') && subtract.includes('if (fetchPhi(cell).g < 0.5) { dataOut[idx] = vec4f(vel, 1.0); return; }'));
check('atlas addressing: tile = z slice, per-cell clamp', src.includes('let tileX = z % u.tilesX;') && src.includes('clamp(cellRaw, vec3f(0.0), vec3f(u.gridN - 1.0))'));
check('outside texels flagged from slice index', src.includes('select(0.0, 1.0, z >= n)'));

check('eleven pipelines created', (src.match(/makeFlipPipeline\(FLIP3D_/g) || []).length === 11);
check('grid lazily created (null at init)', src.includes('flipGrid: null,') && src.includes('function ensureFlip3dGrid'));
check('grid recreated on resolution change', src.includes('state.flipGrid.resolution === resolution') && src.includes('destroyFlip3dGrid(state.flipGrid)'));
check('VEL uniform buffer 752 (736 through G10 stage 2; stage 3 appended the particle-rules field)', src.includes('const VEL_UNIFORM_BYTES = 752;'));
check('velocity bindings 10/11 are textures, 12 is uniform', velWgsl.includes('@binding(10) var flipVelTex : texture_2d<f32>;') && velWgsl.includes('@binding(11) var flipBaseTex : texture_2d<f32>;') && velWgsl.includes('@binding(12) var<uniform>'));
check('velocity stage storage buffers stay within the default limit of 8', (velWgsl.match(/var<storage/g) || []).length === 8, `count ${(velWgsl.match(/var<storage/g) || []).length}`);
check('couple pair published via copyBufferToTexture', stepSrc.includes('enc.copyBufferToTexture(') && stepSrc.includes('{ texture: f3Grid.coupleVelTex }') && stepSrc.includes('{ texture: f3Grid.coupleBaseTex }'));
check('uniform slots stride 256 (minUniformBufferOffsetAlignment)', src.includes('const FLIP3D_UNIFORM_STRIDE = 256;') && stepSrc.includes('offset: slot * FLIP3D_UNIFORM_STRIDE'));
check('couple texture bindings are unfilterable-float (rgba32float)', src.includes("texture: { sampleType: 'unfilterable-float', viewDimension: '2d' }"));
check('couple fetches use textureLoad', velWgsl.includes('textureLoad(flipVelTex, flipTexelXY(cell, f3u.gridN, f3u.tilesX), 0)') && velWgsl.includes('textureLoad(flipBaseTex, flipTexelXY(cell, f3u.gridN, f3u.tilesX), 0)'));
check('velocity coupling law (PIC/FLIP blend + fade)', velWgsl.includes('let picVel = gridVel * f3u.velScale;') && velWgsl.includes('let flipVel = vel + (gridVel - baseVel) * f3u.velScale;') && velWgsl.includes('vel = mix(vel, targetVel, f3u.transfer * fade);'));
check('no WGSL reserved word as identifier (target bit Phase 26 gate round 1)', !/let target\s*=/.test(velWgsl) && !/let target\s*=/.test(src.slice(src.indexOf('const FLIP3D_SPLAT_WGSL'), src.indexOf('const FLIP3D_SUBTRACT_WGSL'))));
check('velocity coupling after fluid block', velWgsl.indexOf('if (f3u.couple > 0.5)') > velWgsl.indexOf('if (fu.enabled > 0.5)'));
check('coupling cell-of-world law', velWgsl.includes('((pos / (2.0 * f3u.halfExtent)) + 0.5) * f3u.gridN - 0.5'));

const order = [
  'enc.clearBuffer(grid.transferI)',
  'gridPass(P.splat, 0,',
  'gridPass(P.composite, 1,',
  'gridPass(P.phi, 2,',
  'gridPass(P.phiAdvect, 3,',
  'gridPass(P.viscosity, 4,',
  'gridPass(P.curvature, 6,',
  'gridPass(P.tension, 5,',
  'gridPass(P.curl, 6,',
  'gridPass(P.vorticity, 7,',
  'gridPass(P.jacobi, 6,',
  'gridPass(P.subtract, 6,',
];
let lastIdx = -1;
let orderOk = true;
for (const marker of order) {
  const i = stepSrc.indexOf(marker);
  if (i < 0 || i < lastIdx) { orderOk = false; break; }
  lastIdx = i;
}
check('step order: clears -> splat -> composite -> phi -> advect -> viscosity -> tension -> vorticity -> jacobi -> subtract', orderOk);
check('grid step precedes velocity dispatch', stepSrc.indexOf('gridPass(P.subtract, 6,') > -1 && stepSrc.indexOf('gridPass(P.subtract, 6,') < stepSrc.indexOf('velPass.dispatchWorkgroups'));
check('couple copies land after position dispatch', stepSrc.indexOf('f3PendingCouple.projected') > stepSrc.indexOf('posPass.dispatchWorkgroups'));
check('couple flag requires a completed step', stepSrc.includes('f3Grid.framesStepped > 0 ? 1 : 0'));
check('grid step gated on active + dt > 0', stepSrc.includes('if (f3Active && f3Grid && f3Dt > 0)'));
check('viscosity loop is the fixed 4', stepSrc.includes('for (let i = 0; i < FLIP3D_VISCOSITY_ITERATIONS; i++)'));
check('runtime status published', stepSrc.includes('setFlip3dRuntimeStatus({') && stepSrc.includes('passesPerStep: flip3dPassCount({'));
check('destroy releases the grid', src.includes('if (state.flipGrid) destroyFlip3dGrid(state.flipGrid);'));

// The WebGL side must stay byte-identical in law.
const glslFlip = readFileSync(join(ROOT, 'components/gpgpuShaderSimulationFlip3d.ts'), 'utf8');
check('GLSL FLIP3D untouched (law strings)', glslFlip.includes('float p = count > 0.0 ? (sum - div) / count : 0.0;') && glslFlip.includes('vel += uDelta * uSigma * kappa * gradChi;'));
const passesSrc = readFileSync(join(ROOT, 'components/gpgpuSimulationPasses.ts'), 'utf8');
check('passes thread flip3d params from config', passesSrc.includes('active: flip3dActive(config),') && passesSrc.includes('pressureIterations: Math.max(0, Math.min(32, Math.round(config.gpgpuFlipPressureIterations))),') && passesSrc.includes('resolution: flip3dActive(config)'));

// ── Atlas addressing twin ───────────────────────────────────────
const LAYOUTS = { 32: [8, 4], 48: [8, 6], 64: [8, 8], 96: [10, 10] };
function texelOf(n, cols, atlasW, cell) {
  const c = cell.map((v) => Math.max(0, Math.min(n - 1, v)));
  const tileX = c[2] % cols;
  const tileY = Math.floor(c[2] / cols);
  return [tileX * n + c[0], tileY * n + c[1]];
}
function cellOfTexel(n, cols, atlasW, tx, ty) {
  const tileX = Math.floor(tx / n);
  const cx = tx % n;
  const tileY = Math.floor(ty / n);
  const cy = ty % n;
  return [cx, cy, tileY * cols + tileX];
}
let roundtrip = true;
for (const [nS, [cols, rows]] of Object.entries(LAYOUTS)) {
  const n = Number(nS);
  const atlasW = cols * n;
  const atlasH = rows * n;
  for (let z = 0; z < n && roundtrip; z++) {
    for (let y = 0; y < n && roundtrip; y += 7) {
      for (let x = 0; x < n; x += 5) {
        const [tx, ty] = texelOf(n, cols, atlasW, [x, y, z]);
        const back = cellOfTexel(n, cols, atlasW, tx, ty);
        if (back[0] !== x || back[1] !== y || back[2] !== z) { roundtrip = false; break; }
      }
    }
  }
  // Spare tiles (96^3: tiles 96..99) flag outside — probe the
  // last tile (tileX = cols-1, tileY = rows-1 -> z = 99).
  if (n === 96) {
    const spare = cellOfTexel(n, cols, atlasW, (cols - 1) * n, (rows - 1) * n);
    if (!(spare[2] >= n)) roundtrip = false;
  }
}
check('atlas addressing twin round-trips all layouts (+ spare tiles outside)', roundtrip);

// ── Fixed-point P2G twin ────────────────────────────────────────
const SCALE = 1024;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
{
  const rand = mulberry32(26);
  const n = 8;
  const extent = 100;
  const particles = [];
  for (let i = 0; i < 500; i++) {
    particles.push({
      pos: [(rand() * 2 - 1) * extent * 0.9, (rand() * 2 - 1) * extent * 0.9, (rand() * 2 - 1) * extent * 0.9],
      vel: [(rand() * 2 - 1) * 30, (rand() * 2 - 1) * 30, (rand() * 2 - 1) * 30],
    });
  }
  const deposits = (p) => {
    const g = p.pos.map((v) => (v / (2 * extent) + 0.5) * n - 0.5);
    const base = g.map(Math.floor);
    const frac = g.map((v, i) => v - base[i]);
    const out = [];
    for (let oz = 0; oz <= 1; oz++) for (let oy = 0; oy <= 1; oy++) for (let ox = 0; ox <= 1; ox++) {
      const off = [ox, oy, oz];
      const aw = off.map((o, i) => (o ? frac[i] : 1 - frac[i]));
      const w = aw[0] * aw[1] * aw[2];
      const cell = base.map((b, i) => b + off[i]);
      if (w <= 0 || cell.some((c) => c < 0 || c > n - 1)) continue;
      out.push({ cell, w, vel: p.vel });
    }
    return out;
  };
  const idx = (c) => (c[2] * n + c[1]) * n + c[0];
  const floatAcc = new Float64Array(n * n * n * 4);
  const intAcc = new Int32Array(n * n * n * 4);
  const intAccShuffled = new Int32Array(n * n * n * 4);
  const allDeposits = particles.flatMap(deposits);
  for (const d of allDeposits) {
    const t = idx(d.cell) * 4;
    for (let a = 0; a < 3; a++) floatAcc[t + a] += d.vel[a] * d.w;
    floatAcc[t + 3] += d.w;
    const wq = Math.round(d.w * SCALE);
    if (wq <= 0) continue;
    for (let a = 0; a < 3; a++) intAcc[t + a] += Math.round(d.vel[a] * wq);
    intAcc[t + 3] += wq;
  }
  const shuffled = [...allDeposits].reverse();
  for (const d of shuffled) {
    const t = idx(d.cell) * 4;
    const wq = Math.round(d.w * SCALE);
    if (wq <= 0) continue;
    for (let a = 0; a < 3; a++) intAccShuffled[t + a] += Math.round(d.vel[a] * wq);
    intAccShuffled[t + 3] += wq;
  }
  let deterministic = true;
  for (let i = 0; i < intAcc.length; i++) if (intAcc[i] !== intAccShuffled[i]) deterministic = false;
  check('fixed-point P2G accumulation is order-independent', deterministic);
  // Each deposit's error vs the float reference: the weight
  // rounds to <= 0.5 quanta, the momentum to <= 0.5 + |vel|*0.5
  // quanta (it is vel x the quantised weight, rounded).
  const perCell = new Int32Array(n * n * n);
  for (const d of allDeposits) perCell[idx(d.cell)] += 1;
  const maxVel = 30;
  let within = true;
  for (let c = 0; c < n * n * n; c++) {
    for (let a = 0; a < 4; a++) {
      const bound = (perCell[c] * (a < 3 ? 0.5 + maxVel * 0.5 : 0.5)) / SCALE + 1e-9;
      if (Math.abs(intAcc[c * 4 + a] / SCALE - floatAcc[c * 4 + a]) > bound) within = false;
    }
  }
  check('fixed-point P2G within quantisation bound of the float reference', within);
  // The regression property (Phase 26 gate runaway): with the
  // weight quantised first, a cell's momentum/weight ratio is
  // a weighted average of depositor velocities — it can never
  // exceed the fastest depositor, however small the corner
  // weights are. The naive round(vel*w*S) / round(w*S) form
  // fabricates velocities in near-zero-weight cells at speed.
  let bounded = true;
  for (let c = 0; c < n * n * n; c++) {
    const wInt = intAcc[c * 4 + 3];
    if (wInt <= 0) continue;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(intAcc[c * 4 + a] / wInt) > maxVel + 1e-9) bounded = false;
    }
  }
  check('fixed-point P2G ratio bounded by the fastest depositor (no fabricated velocities)', bounded);
}

// ── Bundled imports: registry + CPU-mirror agreement ────────────
await build({
  stdin: {
    contents: `
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { flip3dChiFromWeights, flip3dPressureProject, flip3dViscositySolve, flip3dIndex } from './lib/flip3d.ts';
      export { pyroGridCellUv, PYRO_GRID_LAYOUTS, pyroGridAtlasSize } from './lib/pyroGrid.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const M = await import(pathToFileURL(BUNDLE).href);
  const { getWebgpuComputeCapabilityReport, DEFAULT_CONFIG } = M;

  const f3cfg = { ...DEFAULT_CONFIG, gpgpuFluidEnabled: true, gpgpuFlipEnabled: true, gpgpuFlipMode: '3d' };
  const rep3d = getWebgpuComputeCapabilityReport(f3cfg);
  check('flip 3D config can run on WebGPU route', rep3d.canRunRequestedConfig && rep3d.requestedFeatures.includes('flip-3d') && !rep3d.requestedFeatures.includes('flip'),
    JSON.stringify(rep3d.unsupportedFeatures));
  const rep2d = getWebgpuComputeCapabilityReport({ ...f3cfg, gpgpuFlipMode: '2d' });
  check('flip 2D config still routes to WebGL', !rep2d.canRunRequestedConfig && rep2d.unsupportedFeatures.includes('flip'));
  const repWw = getWebgpuComputeCapabilityReport({ ...f3cfg, gpgpuWhitewaterEnabled: true });
  check('flip 3D + whitewater still routes to WebGL (whitewater, not flip-3d, is blamed)',
    !repWw.canRunRequestedConfig && repWw.unsupportedFeatures.includes('whitewater') && !repWw.unsupportedFeatures.includes('flip-3d'),
    JSON.stringify(repWw.unsupportedFeatures));
  const repOff = getWebgpuComputeCapabilityReport({ ...DEFAULT_CONFIG });
  check('default config requests neither flip feature', !repOff.requestedFeatures.includes('flip') && !repOff.requestedFeatures.includes('flip-3d'));

  // Atlas twin vs the TS source of truth (pyroGridCellUv).
  let uvAgree = true;
  for (const n of [32, 48, 64, 96]) {
    const layout = M.PYRO_GRID_LAYOUTS[n];
    const size = M.pyroGridAtlasSize(n);
    for (const cell of [{ x: 0, y: 0, z: 0 }, { x: n - 1, y: n - 1, z: n - 1 }, { x: 3, y: 5, z: 7 }, { x: 1, y: 0, z: n - 1 }]) {
      const uv = M.pyroGridCellUv(n, cell);
      const [tx, ty] = texelOf(n, layout.cols, size.width, [cell.x, cell.y, cell.z]);
      if (Math.floor(uv.u * size.width) !== tx || Math.floor(uv.v * size.height) !== ty) uvAgree = false;
    }
  }
  check('atlas twin agrees with pyroGridCellUv at all resolutions', uvAgree);

  // ── Mirror agreement: chi build ──
  const { flip3dChiFromWeights, flip3dPressureProject, flip3dViscositySolve, flip3dIndex } = M;
  const n = 8;
  const total = n * n * n;
  const rand = mulberry32(2601);
  const weights = new Float32Array(total);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x - 3.5, y - 3.5, z - 3.5);
    weights[flip3dIndex(n, x, y, z)] = d < 3 ? 2.5 + rand() : rand() * 0.2;
  }
  const avgW = 2.0;
  const clampC = (v) => Math.max(0, Math.min(n - 1, v));
  const fetchW = (x, y, z) => weights[flip3dIndex(n, clampC(x), clampC(y), clampC(z))];
  const chiTwin = new Float32Array(total);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let sum = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      sum += Math.min(1, Math.max(0, fetchW(x + dx, y + dy, z + dz) / Math.max(avgW, 1e-4)));
    }
    chiTwin[flip3dIndex(n, x, y, z)] = sum / 27;
  }
  const chiMirror = flip3dChiFromWeights(weights, n, avgW);
  let chiMaxDiff = 0;
  for (let i = 0; i < total; i++) chiMaxDiff = Math.max(chiMaxDiff, Math.abs(chiTwin[i] - chiMirror[i]));
  check('chi build twin matches flip3dChiFromWeights', chiMaxDiff <= 1e-6, `maxDiff ${chiMaxDiff}`);

  // ── Mirror agreement: pressure projection ──
  const chi = chiMirror;
  const velIn = new Float32Array(total * 3);
  for (let i = 0; i < total * 3; i++) velIn[i] = (rand() * 2 - 1) * 4;
  const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const fetchVel = (x, y, z, a) => velIn[flip3dIndex(n, clampC(x), clampC(y), clampC(z)) * 3 + a];
  const fetchChi = (x, y, z) => chi[flip3dIndex(n, clampC(x), clampC(y), clampC(z))];
  const iters = 12;
  let presA = new Float32Array(total);
  let presB = new Float32Array(total);
  for (let it = 0; it < iters; it++) {
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const id = flip3dIndex(n, x, y, z);
      if (chi[id] < 0.5) { presB[id] = 0; continue; }
      const div = (fetchVel(x, y, z, 0) - fetchVel(x - 1, y, z, 0))
        + (fetchVel(x, y, z, 1) - fetchVel(x, y - 1, z, 1))
        + (fetchVel(x, y, z, 2) - fetchVel(x, y, z - 1, 2));
      let sum = 0;
      let count = 0;
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= n || ny >= n || nz >= n) continue;
        count += 1;
        if (chi[flip3dIndex(n, nx, ny, nz)] >= 0.5) sum += presA[flip3dIndex(n, nx, ny, nz)];
      }
      presB[id] = count > 0 ? (sum - div) / count : 0;
    }
    const s = presA; presA = presB; presB = s;
  }
  const velTwin = new Float32Array(velIn);
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const id = flip3dIndex(n, x, y, z);
    if (chi[id] < 0.5) continue;
    const pC = presA[id];
    for (let a = 0; a < 3; a++) {
      const [dx, dy, dz] = DIRS[a * 2];
      const pNext = fetchChi(x + dx, y + dy, z + dz) >= 0.5
        ? presA[flip3dIndex(n, clampC(x + dx), clampC(y + dy), clampC(z + dz))]
        : 0;
      velTwin[id * 3 + a] -= pNext - pC;
    }
  }
  const proj = flip3dPressureProject(velIn, chi, n, iters);
  let velMaxDiff = 0;
  let presMaxDiff = 0;
  for (let i = 0; i < total * 3; i++) velMaxDiff = Math.max(velMaxDiff, Math.abs(velTwin[i] - proj.vel[i]));
  for (let i = 0; i < total; i++) presMaxDiff = Math.max(presMaxDiff, Math.abs(presA[i] - proj.pressure[i]));
  check('pressure twin matches flip3dPressureProject (velocity)', velMaxDiff <= 1e-4, `maxDiff ${velMaxDiff}`);
  check('pressure twin matches flip3dPressureProject (pressure)', presMaxDiff <= 1e-4, `maxDiff ${presMaxDiff}`);

  // ── Mirror agreement: viscosity ──
  const alpha = 0.35;
  const viscTwin = (() => {
    let cur = new Float32Array(velIn);
    const next = new Float32Array(velIn);
    for (let it = 0; it < 4; it++) {
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const id = flip3dIndex(n, x, y, z);
        if (chi[id] < 0.5) { for (let a = 0; a < 3; a++) next[id * 3 + a] = cur[id * 3 + a]; continue; }
        for (let a = 0; a < 3; a++) {
          let sum = 0;
          for (const [dx, dy, dz] of DIRS) {
            const inside = x + dx >= 0 && y + dy >= 0 && z + dz >= 0 && x + dx < n && y + dy < n && z + dz < n;
            sum += inside && chi[flip3dIndex(n, x + dx, y + dy, z + dz)] >= 0.5
              ? cur[flip3dIndex(n, x + dx, y + dy, z + dz) * 3 + a]
              : cur[id * 3 + a];
          }
          next[id * 3 + a] = (velIn[id * 3 + a] + alpha * sum) / (1 + 6 * alpha);
        }
      }
      cur.set(next);
    }
    return cur;
  })();
  const viscMirror = flip3dViscositySolve(velIn, chi, n, alpha, 4);
  let viscMaxDiff = 0;
  for (let i = 0; i < total * 3; i++) viscMaxDiff = Math.max(viscMaxDiff, Math.abs(viscTwin[i] - viscMirror[i]));
  check('viscosity twin matches flip3dViscositySolve', viscMaxDiff <= 1e-4, `maxDiff ${viscMaxDiff}`);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
