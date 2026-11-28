// Grammar 2.0 stage 2, slice E0+E1 — emitter common base
// (lib/gpgpuEmitter.ts) and the shared bake/respawn shape law
// (lib/gpgpuEmitShapes.ts). Design:
// kalokagathia-pro/STAGE2_DESIGN.md §1 / §2 E0+E1.
//
// Cases:
//  1 bake identity: routing buildGpgpuInitialData through the
//    shared law leaves all 7 shapes' seeded arrays bit-
//    identical (sha256 pins measured on this tree BEFORE the
//    refactor), and an explicit identity transform / explicit
//    null options change nothing
//  2 JS twin semantics: exact points for fixed draw vectors,
//    per-shape draw counts (the legacy consumption), and
//    geometric invariants over seeded draws
//  3 the GLSL pair: sha256 pin of EMIT_SHAPE_GLSL, the shape
//    branch structure, and the defining constants shared with
//    the JS twin
//  4 respawn shape selection + shader identity: the default
//    position string is the shipped one (sha256 pin), the
//    shape variant replaces the legacy placement wholesale,
//    the transform variant splices after the placement, and
//    the emitter options follow the config keys
//  5 emitter definition: defaults resolve to the identity,
//    the activity tests, and the transform math (rotation
//    convention, scale, translation, matrix/apply agreement)
//  6 capability: a named respawn shape or a moved emitter
//    frame requests the unsupported 'emitter-respawn-shape'
//    feature (routes to WebGL); defaults do not
//  7 key registration: the 8 new keys sit at their defaults
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2e-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { sampleEmitShape, EMIT_SHAPE_IDS, EMIT_SHAPE_GLSL } from './lib/gpgpuEmitShapes.ts';
      export { resolveEmitterDef, resolveEmitterTransform, emitterTransformIsIdentity, emitterTransformActive, emitterRespawnShapeActive, emitterRotScaleElements, applyEmitterTransform, IDENTITY_EMITTER_TRANSFORM } from './lib/gpgpuEmitter.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildGpgpuInitialData, sampleEmitShape, EMIT_SHAPE_IDS, EMIT_SHAPE_GLSL,
  resolveEmitterDef, resolveEmitterTransform, emitterTransformIsIdentity,
  emitterTransformActive, emitterRespawnShapeActive, emitterRotScaleElements,
  applyEmitterTransform, IDENTITY_EMITTER_TRANSFORM,
  buildPositionFragment, SIM_POS_FRAG, getWebgpuComputeCapabilityReport,
  APP_STATE_DEFAULT_GPGPU,
} = lib;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 1. Bake identity ─────────────────────────────────────
// Pins measured on this tree BEFORE the E1 refactor routed
// the bake through lib/gpgpuEmitShapes.ts (texSize 16,
// radius 100, seed 1234, ageMax 8; light at (10, 20, 30)).
const BAKE_PINS = {
  sphere: ['485ca667bb0c060d738b092fda8a97c3ebc430355d4f70dc05b83ee237c06c29', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
  disc: ['7e219c7efd5f1e09164bb1e6809850679fc7e890c5bb174982077a65bca124d1', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  ring: ['3881b0d5da59346db89d8ef04fe0d6cfd7228124b20a9f05935e4889b6945664', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
  box: ['76f0a6969084bc052f4f15cae6d995d3e9914e5a6439dc40db568edc04d152d2', 'c960655fe5d8bd5819854df08103114b691296f879b7e275e5cc25671554c1dd'],
  shell: ['a28acd5bdb8053ba92e87610c95727e6d0026ce20b41839af36e48a43dd0d554', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  cone: ['c56257a1f8563abd515edc61e02c55de72624c83fcc178adf38dcbf0629aca8c', '441d9319f32062756911f85acc50e52c48c409b87ae5213c740bcceca127feef'],
  light: ['928713b64f5fd64d5d8acd08d1590724dfcad537b6b3c5c39304bb9b06ce1fef', 'd1390093472035da64a864fa01c760b2907407fb5502d16dd5b2c21c50641d41'],
};
for (const shape of Object.keys(BAKE_PINS)) {
  const opts = shape === 'light' ? { lightPos: { x: 10, y: 20, z: 30 } } : null;
  const d = buildGpgpuInitialData(16, 100, shape, 1234, 8, null, opts);
  check(`1 bake bit-identical after the shared-law refactor (${shape})`,
    sha256(Buffer.from(d.posData.buffer)) === BAKE_PINS[shape][0]
    && sha256(Buffer.from(d.velData.buffer)) === BAKE_PINS[shape][1]);
}
{
  const plain = buildGpgpuInitialData(16, 100, 'sphere', 99, 8, null, null);
  const explicitIdentity = buildGpgpuInitialData(16, 100, 'sphere', 99, 8, null, { transform: { ...IDENTITY_EMITTER_TRANSFORM } });
  const explicitNull = buildGpgpuInitialData(16, 100, 'sphere', 99, 8, null, { transform: null });
  check('1 explicit identity transform is a bake no-op',
    Buffer.from(explicitIdentity.posData.buffer).equals(Buffer.from(plain.posData.buffer)));
  check('1 explicit null transform is a bake no-op',
    Buffer.from(explicitNull.posData.buffer).equals(Buffer.from(plain.posData.buffer)));
  // A moved frame changes positions but never velocities.
  const moved = buildGpgpuInitialData(16, 100, 'sphere', 99, 8, null, { transform: { ...IDENTITY_EMITTER_TRANSFORM, posX: 50 } });
  check('1 translated bake shifts x by the offset and keeps velocities',
    approx(moved.posData[0], plain.posData[0] + 50, 1e-4)
    && Buffer.from(moved.velData.buffer).equals(Buffer.from(plain.velData.buffer)));
}

// ── 2. JS twin semantics ─────────────────────────────────
{
  // Fixed draw vectors -> the exact legacy points, computed
  // here from the defining formulas (not via the twin).
  const draws = (arr) => { let i = 0; return () => arr[i++]; };
  const R = 100;
  // disc: theta = 0.25*2PI = PI/2, rad = R*sqrt(0.25) = 50 -> (0, 0, 50)
  const disc = sampleEmitShape('disc', draws([0.25, 0.25]), R);
  check('2 disc fixed draws', approx(disc[0], 0, 1e-9) && disc[1] === 0 && approx(disc[2], 50, 1e-9), disc.join(','));
  // ring: theta = 0, rad = R*(0.85+0.5*0.15), y = 0 -> (rad, 0, 0)
  const ring = sampleEmitShape('ring', draws([0, 0.5, 0.5]), R);
  check('2 ring fixed draws', approx(ring[0], R * 0.925) && ring[1] === 0 && approx(ring[2], 0), ring.join(','));
  // box: theta draw ignored, components from draws 2..4
  const box = sampleEmitShape('box', draws([0.9, 0.5, 0, 1]), R);
  check('2 box fixed draws', box[0] === 0 && box[1] === -R && box[2] === R, box.join(','));
  // shell: theta = 0, phi = acos(0) = PI/2 -> (R, 0, 0)
  const shell = sampleEmitShape('shell', draws([0, 0.5]), R);
  check('2 shell fixed draws', approx(shell[0], R) && approx(shell[1], 0) && approx(shell[2], 0, 1e-9), shell.join(','));
  // sphere: theta = 0, phi = PI/2, rad = R*(0.1+0.5*0.9) = 55 -> (55, 0, 0)
  const sphere = sampleEmitShape('sphere', draws([0, 0.5, 0.5]), R);
  check('2 sphere fixed draws', approx(sphere[0], 55) && approx(sphere[1], 0) && approx(sphere[2], 0, 1e-9), sphere.join(','));
  // cone: theta = 0, h = 0.5R, cr = h -> (50, 0, 0)
  const cone = sampleEmitShape('cone', draws([0, 0.5]), R);
  check('2 cone fixed draws', approx(cone[0], 50) && cone[1] === 0 && approx(cone[2], 0), cone.join(','));
  // light: theta = 0, phi = PI/2, jr = R*0.05*(0.1+0.5*0.9) -> lp + (jr, 0, 0)
  const light = sampleEmitShape('light', draws([0, 0.5, 0.5]), R, { x: 10, y: 20, z: 30 });
  check('2 light fixed draws', approx(light[0], 10 + R * 0.05 * 0.55) && approx(light[1], 20) && approx(light[2], 30, 1e-9), light.join(','));

  // Draw counts are the legacy consumption per shape.
  const counts = { sphere: 3, disc: 2, ring: 3, box: 4, shell: 2, cone: 2, light: 3 };
  for (const [shape, expected] of Object.entries(counts)) {
    let n = 0;
    sampleEmitShape(shape, () => { n += 1; return 0.5; }, R, { x: 0, y: 0, z: 0 });
    check(`2 draw count (${shape})`, n === expected, `got ${n}`);
  }

  // Geometric invariants over seeded draws.
  let s = 42;
  const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let okDisc = true, okShell = true, okRing = true, okBox = true, okCone = true, okLight = true, okSphere = true;
  for (let i = 0; i < 2000; i++) {
    const d = sampleEmitShape('disc', rng, R);
    if (d[1] !== 0 || Math.hypot(d[0], d[2]) > R + 1e-9) okDisc = false;
    const sh = sampleEmitShape('shell', rng, R);
    if (!approx(Math.hypot(...sh), R, 1e-7)) okShell = false;
    const rg = sampleEmitShape('ring', rng, R);
    const rr = Math.hypot(rg[0], rg[2]);
    if (rr < 0.85 * R - 1e-9 || rr > R + 1e-9 || Math.abs(rg[1]) > 0.04 * R + 1e-9) okRing = false;
    const bx = sampleEmitShape('box', rng, R);
    if (bx.some((v) => Math.abs(v) > R)) okBox = false;
    const cn = sampleEmitShape('cone', rng, R);
    const cr = Math.hypot(cn[0], cn[2]);
    if (cn[1] < -R / 2 - 1e-9 || cn[1] > R / 2 + 1e-9 || !approx(cr, cn[1] + R / 2, 1e-7)) okCone = false;
    const li = sampleEmitShape('light', rng, R, { x: 10, y: 20, z: 30 });
    if (Math.hypot(li[0] - 10, li[1] - 20, li[2] - 30) > 0.05 * R + 1e-9) okLight = false;
    const sp = sampleEmitShape('sphere', rng, R);
    const sr = Math.hypot(...sp);
    if (sr < 0.1 * R - 1e-9 || sr > R + 1e-9) okSphere = false;
  }
  check('2 invariants (disc/shell/ring/box/cone/light/sphere)',
    okDisc && okShell && okRing && okBox && okCone && okLight && okSphere,
    `disc=${okDisc} shell=${okShell} ring=${okRing} box=${okBox} cone=${okCone} light=${okLight} sphere=${okSphere}`);
}

// ── 3. The GLSL pair ─────────────────────────────────────
check('3 EMIT_SHAPE_GLSL sha256 pin',
  sha256(EMIT_SHAPE_GLSL) === 'bffaf7e0f36194e1fc5840aa320437dba31bdeca55700fa4db7ef870007875df');
check('3 GLSL branches for all shapes',
  [1, 2, 3, 4, 5, 6].every((id) => EMIT_SHAPE_GLSL.includes(`shape == ${id}`))
  && EMIT_SHAPE_GLSL.includes('vec3 kaloEmitShapePos(int shape, vec4 d, float radius, vec3 lightPos)'));
check('3 defining constants shared with the JS twin',
  ['0.85', '0.15', '0.08', '0.05', '0.1', '0.9', 'sqrt(d.y)'].every((c) => EMIT_SHAPE_GLSL.includes(c)));
check('3 shape ids are the stable 0..6 assignment',
  EMIT_SHAPE_IDS.sphere === 0 && EMIT_SHAPE_IDS.disc === 1 && EMIT_SHAPE_IDS.ring === 2
  && EMIT_SHAPE_IDS.box === 3 && EMIT_SHAPE_IDS.shell === 4 && EMIT_SHAPE_IDS.cone === 5
  && EMIT_SHAPE_IDS.light === 6);

// ── 4. Respawn selection + shader identity ───────────────
check('4 default position string is the shipped one (sha256 pin)',
  sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49');
check('4 default string carries no emitter variant surface',
  !SIM_POS_FRAG.includes('uRespawnShape') && !SIM_POS_FRAG.includes('uEmitterPos')
  && !SIM_POS_FRAG.includes('kaloEmitShapePos'));
{
  const shapeFrag = buildPositionFragment({ emitterShape: true });
  check('4 shape variant places through the shared law',
    shapeFrag.includes('kaloEmitShapePos(uRespawnShape')
    && shapeFrag.includes('vec3 kaloEmitShapePos(int shape')
    && shapeFrag.includes('uniform int uRespawnShape;'));
  check('4 shape variant replaces the legacy placement wholesale',
    !shapeFrag.includes('float jr = r * 0.05;')
    && !shapeFrag.includes('uBounceRadius * (0.05 + hash1(vUv + vec2(age)) * 0.9)'));
  const trFrag = buildPositionFragment({ emitterTransform: true });
  check('4 transform variant splices the transform after the legacy placement',
    trFrag.includes('pos = uEmitterPos + uEmitterRotScale * pos;')
    && trFrag.includes('float jr = r * 0.05;')
    && trFrag.indexOf('float jr = r * 0.05;') < trFrag.indexOf('pos = uEmitterPos + uEmitterRotScale * pos;'));
  const bothFrag = buildPositionFragment({ emitterShape: true, emitterTransform: true });
  check('4 combined variant: law first, transform second',
    bothFrag.indexOf('kaloEmitShapePos(uRespawnShape') >= 0
    && bothFrag.indexOf('kaloEmitShapePos(uRespawnShape') < bothFrag.indexOf('pos = uEmitterPos + uEmitterRotScale * pos;'));
  check('4 unrelated variants stay free of the emitter surface',
    !buildPositionFragment({ particleRulesLive: true }).includes('kaloEmitShapePos')
    && !buildPositionFragment({ grainsProjection: true }).includes('uEmitterPos'));
}

// ── 5. Emitter definition ────────────────────────────────
{
  const defCfg = { ...APP_STATE_DEFAULT_GPGPU };
  const def = resolveEmitterDef(defCfg);
  check('5 defaults resolve to the legacy emitter definition',
    def.shape === 'sphere' && def.respawnShape === 'auto'
    && emitterTransformIsIdentity(def.transform)
    && def.initialVelocity.mode === 'cube' && def.initialVelocity.speed === 2);
  check('5 activity tests at defaults',
    !emitterTransformActive(defCfg) && !emitterRespawnShapeActive(defCfg));
  check('5 activity tests past the line',
    emitterRespawnShapeActive({ ...defCfg, gpgpuRespawnShape: 'disc' })
    && emitterTransformActive({ ...defCfg, gpgpuEmitterScale: 2 })
    && emitterTransformActive({ ...defCfg, gpgpuEmitterRotZ: 15 }));
  check('5 non-finite keys fall back to the identity components',
    emitterTransformIsIdentity(resolveEmitterTransform({ ...defCfg, gpgpuEmitterPosX: NaN, gpgpuEmitterScale: Infinity })));

  // Rotation convention: M = Rx * Ry * Rz, degrees.
  const rotY = { ...IDENTITY_EMITTER_TRANSFORM, rotY: 90 };
  const pY = applyEmitterTransform(rotY, 1, 0, 0);
  check('5 rotY 90 maps +X to -Z', approx(pY[0], 0, 1e-12) && approx(pY[1], 0, 1e-12) && approx(pY[2], -1, 1e-12), pY.join(','));
  const rotZ = { ...IDENTITY_EMITTER_TRANSFORM, rotZ: 90 };
  const pZ = applyEmitterTransform(rotZ, 1, 0, 0);
  check('5 rotZ 90 maps +X to +Y', approx(pZ[0], 0, 1e-12) && approx(pZ[1], 1, 1e-12) && approx(pZ[2], 0, 1e-12), pZ.join(','));
  // Composition order: Rz applies first, so rotZ then rotY
  // takes +X to +Y and leaves it there under the Y rotation.
  const both = { ...IDENTITY_EMITTER_TRANSFORM, rotY: 90, rotZ: 90 };
  const pB = applyEmitterTransform(both, 1, 0, 0);
  check('5 composition order (Rz first)', approx(pB[0], 0, 1e-12) && approx(pB[1], 1, 1e-12) && approx(pB[2], 0, 1e-12), pB.join(','));
  // Scale then translate.
  const st = { ...IDENTITY_EMITTER_TRANSFORM, scale: 2, posX: 10, posY: -5, posZ: 3 };
  const pS = applyEmitterTransform(st, 1, 2, 3);
  check('5 scale + translation', pS[0] === 12 && pS[1] === -1 && pS[2] === 9, pS.join(','));
  // Matrix/apply agreement under a mixed transform, read the
  // way the shader does (column-major mat3 * vec).
  const mixed = { posX: 1, posY: 2, posZ: 3, rotX: 30, rotY: 45, rotZ: 60, scale: 1.5 };
  const e = emitterRotScaleElements(mixed);
  const viaApply = applyEmitterTransform(mixed, 4, -2, 7);
  const viaMat = [
    e[0] * 4 + e[3] * -2 + e[6] * 7 + mixed.posX,
    e[1] * 4 + e[4] * -2 + e[7] * 7 + mixed.posY,
    e[2] * 4 + e[5] * -2 + e[8] * 7 + mixed.posZ,
  ];
  check('5 matrix elements and apply agree (the shader upload path)',
    viaApply.every((v, i) => approx(v, viaMat[i], 1e-12)), `${viaApply} vs ${viaMat}`);
}

// ── 6. Capability ────────────────────────────────────────
{
  const base = { ...APP_STATE_DEFAULT_GPGPU };
  const reportDefault = getWebgpuComputeCapabilityReport(base);
  check('6 defaults do not request the emitter feature',
    !reportDefault.unsupportedFeatures.includes('emitter-respawn-shape'));
  const reportShape = getWebgpuComputeCapabilityReport({ ...base, gpgpuRespawnShape: 'disc' });
  check('6 a named respawn shape routes to WebGL',
    reportShape.unsupportedFeatures.includes('emitter-respawn-shape')
    && reportShape.canRunRequestedConfig === false);
  const reportFrame = getWebgpuComputeCapabilityReport({ ...base, gpgpuEmitterPosY: 25 });
  check('6 a moved emitter frame routes to WebGL',
    reportFrame.unsupportedFeatures.includes('emitter-respawn-shape'));
}

// ── 7. Key registration ──────────────────────────────────
check('7 the 8 new keys sit at their defaults',
  APP_STATE_DEFAULT_GPGPU.gpgpuRespawnShape === 'auto'
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterPosX === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterPosY === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterPosZ === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterRotX === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterRotY === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterRotZ === 0
  && APP_STATE_DEFAULT_GPGPU.gpgpuEmitterScale === 1);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
