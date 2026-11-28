// Limit plan stage 4, slice S5 — DOF particle tracking +
// velocity-buffer motion blur (the DOF+MB pair; design
// kalokagathia-pro/STAGE4_DESIGN_MATERIALS.md §3.2 案A and
// §0 RT budget, STAGE4_PREP_INVENTORY.md §3).
//
// What is pinned here (node side):
//  (a) OFF identity: the six new keys default to
//      postMbEnabled=false / postMbStrength=1 /
//      postMbSamples=8 / postMbParticleOnly=false /
//      postDofTrackParticles=false / postDofTrackZone=0,
//      both predicates are false at the defaults, the
//      'motion-blur' stage is absent from the default
//      active set, and the strings this slice could have
//      touched but must not change (stock points draw
//      strings, the shadow receiver chunk) keep their
//      pre-slice sha256 pins (cross-checked against the
//      S4 record). The DOF stage's effective focus at the
//      defaults is the config value verbatim.
//  (b) Stage registration: 'motion-blur' sits immediately
//      after 'depth-of-field' in every profile order, the
//      meta covers it, safe mode drops it at level >= 2,
//      and enabling MB (with a usable strength) activates
//      exactly that one extra stage, ordered right after
//      depth-of-field when both are on.
//  (c) MB math (CPU twins): screen velocity under a known
//      view-projection (static -> exactly zero, uniform
//      motion -> the projected travel, behind-camera ->
//      zero), gather offsets (zero velocity -> all-zero
//      offsets; span = vel * strength, symmetric about the
//      current pixel since the fix round 2 — see (f)), and
//      the gather over synthetic fields (constant field ->
//      identity; linear field -> the value at the mean
//      offset, which is the centre for a symmetric gather;
//      a step edge smears only along the velocity
//      direction). The GLSL offset twin is transcribed
//      independently here and compared over the domain.
//  (d) DOF tracking supply: zone resolution, centroid over
//      a synthetic position buffer (with and without the
//      species channel), view depth along a known camera,
//      and the effective-focus resolution (tracked wins
//      while on; config value on every fallback path).
//  (e) RT budget: the velocity target size is exactly half
//      resolution (one RT), the splat/reduction/stage
//      programs declare only their recorded samplers, and
//      the stage fragment gathers with the offset twin and
//      the compile-time loop bound — no frame-history
//      texture exists anywhere in the MB path.
//  (f) Gate fix round 2 (STAGE4_FIX5_MB_CHAIN_RECORD): the
//      capture's texture supply comes from the sim frame
//      store (the GpgpuSystem publishes the sim's own output
//      targets — the diagnostic AOV's route), never from the
//      draw material's uniforms; the published source carries
//      its render target for the diag hook; the capture diag
//      counters and the half-float velocity statistics the
//      hook reports behave as recorded.
//  (g) Gate fix round 3 (STAGE4_FIX8_MB_BINDING_RECORD): the
//      pass binds the velocity source inside its own render()
//      (it reads the shared store at composite time), the
//      React-render assignment in AppScenePostFx is gone, and
//      the pass records every render's binding (ready flag +
//      texture dimensions) into the pass diag state the
//      ?diag=1 hook exposes as captureMotionBlurPassStats.
//      The old (b) pin only fixed the STRING
//      'useMotionVelocitySource()' in AppScenePostFx — it
//      never proved the assignment reached the composer's
//      pass instance, and the stage ran starved on the real
//      GPU behind it.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s5-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const samplerCount = (s) => (s.match(/uniform\s+sampler2D/g) || []).length;
const readSrc = (rel) => readFileSync(join(ROOT, rel), 'utf8');

await build({
  stdin: {
    contents: `
      export {
        MOTION_BLUR_REFERENCE_DT, MOTION_BLUR_MAX_SAMPLES,
        resolveMotionBlurSettings, motionBlurOn,
        screenVelocityUv, motionBlurSampleOffsets, gatherMotionBlur,
        motionBlurPointDiameterWorld, motionBlurPointSizePx, velocityTargetSize,
        MOTION_BLUR_OFFSET_GLSL, MOTION_BLUR_FRAG,
        VELOCITY_SPLAT_VERT, VELOCITY_SPLAT_FRAG,
        halfFloatBitsToFloat, motionVelocityStatsFromReadback,
        setMotionSimFrameSource, getMotionSimFrameSource,
        noteMotionCaptureFrame, noteMotionCaptureSkip, noteMotionCapturePublished,
        getMotionCaptureDiagState,
        noteMotionBlurPassRender, getMotionBlurPassDiagState,
      } from './lib/motionBlur.ts';
      export {
        dofTrackOn, resolveDofTrackZone, particleZoneCentroid,
        viewDepthOfPoint, resolveEffectiveDofFocusDistance,
        DOF_TRACK_REDUCTION_VERT, DOF_TRACK_REDUCTION_FRAG,
      } from './lib/dofTracking.ts';
      export {
        getActivePostFxStageIds, getOrderedActivePostFxStageIds, getPostFxProfileOrder,
      } from './lib/postFxStack.ts';
      export { POST_FX_STAGE_META } from './lib/postFxStageMeta.ts';
      export { SAFE_MODE_HEAVY_POST_STAGES } from './lib/safeMode.ts';
      export { DRAW_VERT, DRAW_FRAG } from './components/gpgpuShaderPoints.ts';
      export { LIGHT_SHADOW_GLSL } from './lib/lightShadowMap.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const M = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  MOTION_BLUR_REFERENCE_DT, MOTION_BLUR_MAX_SAMPLES,
  resolveMotionBlurSettings, motionBlurOn,
  screenVelocityUv, motionBlurSampleOffsets, gatherMotionBlur,
  motionBlurPointDiameterWorld, motionBlurPointSizePx, velocityTargetSize,
  MOTION_BLUR_OFFSET_GLSL, MOTION_BLUR_FRAG,
  VELOCITY_SPLAT_VERT, VELOCITY_SPLAT_FRAG,
  halfFloatBitsToFloat, motionVelocityStatsFromReadback,
  setMotionSimFrameSource, getMotionSimFrameSource,
  noteMotionCaptureFrame, noteMotionCaptureSkip, noteMotionCapturePublished,
  getMotionCaptureDiagState,
  noteMotionBlurPassRender, getMotionBlurPassDiagState,
  dofTrackOn, resolveDofTrackZone, particleZoneCentroid,
  viewDepthOfPoint, resolveEffectiveDofFocusDistance,
  DOF_TRACK_REDUCTION_VERT, DOF_TRACK_REDUCTION_FRAG,
  getActivePostFxStageIds, getOrderedActivePostFxStageIds, getPostFxProfileOrder,
  POST_FX_STAGE_META, SAFE_MODE_HEAVY_POST_STAGES,
  DRAW_VERT, DRAW_FRAG, LIGHT_SHADOW_GLSL, DEFAULT_CONFIG,
} = M;

// --- (a) OFF identity -------------------------------------------------------
check('(a) new keys default off / neutral',
  DEFAULT_CONFIG.postMbEnabled === false && DEFAULT_CONFIG.postMbStrength === 1
  && DEFAULT_CONFIG.postMbSamples === 8 && DEFAULT_CONFIG.postMbParticleOnly === false
  && DEFAULT_CONFIG.postDofTrackParticles === false && DEFAULT_CONFIG.postDofTrackZone === 0);
check('(a) predicates false at defaults',
  motionBlurOn(DEFAULT_CONFIG) === false && dofTrackOn(DEFAULT_CONFIG) === false);
check('(a) motion-blur stage absent at defaults',
  !getActivePostFxStageIds(DEFAULT_CONFIG).includes('motion-blur')
  && !getOrderedActivePostFxStageIds(DEFAULT_CONFIG).includes('motion-blur'));
check('(a) stock draw strings keep pre-slice pins',
  sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529'
  && sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c');
check('(a) shadow receiver chunk keeps pre-slice pin',
  sha256(LIGHT_SHADOW_GLSL) === '9c360940c43835bf96ca8883d887d199270df54796d49ae2539b15d210323695');
check('(a) effective DOF focus at defaults is the config value',
  resolveEffectiveDofFocusDistance(DEFAULT_CONFIG, null) === DEFAULT_CONFIG.postDofFocusDistance
  && resolveEffectiveDofFocusDistance(DEFAULT_CONFIG, 123) === DEFAULT_CONFIG.postDofFocusDistance);

// --- (b) stage registration ---------------------------------------------------
const PROFILES = ['manual', 'touch-feedback', 'particular-glow', 'retro-feedback', 'dream-smear'];
check('(b) motion-blur immediately after depth-of-field in every profile',
  PROFILES.every((p) => {
    const o = getPostFxProfileOrder(p);
    return o.indexOf('motion-blur') === o.indexOf('depth-of-field') + 1;
  }));
check('(b) stage meta covers motion-blur',
  POST_FX_STAGE_META.some((m) => m.id === 'motion-blur'));
check('(b) safe mode drops motion-blur at level >= 2',
  SAFE_MODE_HEAVY_POST_STAGES.has('motion-blur'));
{
  const on = { ...DEFAULT_CONFIG, postMbEnabled: true };
  const activeOn = getActivePostFxStageIds(on);
  const activeOff = getActivePostFxStageIds(DEFAULT_CONFIG);
  check('(b) enabling MB adds exactly the motion-blur stage',
    activeOn.includes('motion-blur') && activeOn.length === activeOff.length + 1
    && activeOn.filter((s) => s !== 'motion-blur').join(',') === activeOff.join(','));
  const both = { ...DEFAULT_CONFIG, postMbEnabled: true, postDofEnabled: true };
  const ordered = getOrderedActivePostFxStageIds(both);
  check('(b) ordered active list places motion-blur right after depth-of-field',
    ordered.indexOf('motion-blur') === ordered.indexOf('depth-of-field') + 1, ordered.join(','));
  check('(b) MB on with zero strength inserts no stage',
    !getActivePostFxStageIds({ ...DEFAULT_CONFIG, postMbEnabled: true, postMbStrength: 0 }).includes('motion-blur'));
}
check('(b) AppScene mounts the captures only behind the predicates (source pin)',
  readSrc('components/AppScene.tsx').includes('motionBlurOn(effectiveConfig) && <ParticleVelocityCapture')
  && readSrc('components/AppScene.tsx').includes('dofTrackOn(effectiveConfig) && <DofTrackCapture'));
check('(b) motion-blur stage is mounted by the post stack (source pin)',
  readSrc('components/AppScenePostFx.tsx').includes("case 'motion-blur':"));

// --- (c) MB settings + math ---------------------------------------------------
check('(c) settings resolution clamps',
  resolveMotionBlurSettings({ postMbEnabled: true, postMbStrength: 99, postMbSamples: 1000 }).strength === 4
  && resolveMotionBlurSettings({ postMbEnabled: true, postMbStrength: -2 }).strength === 0
  && resolveMotionBlurSettings({ postMbEnabled: true, postMbSamples: 1000 }).samples === 16
  && resolveMotionBlurSettings({ postMbEnabled: true, postMbSamples: 0 }).samples === 1
  && resolveMotionBlurSettings({ postMbEnabled: true, postMbSamples: 5.6 }).samples === 6);
check('(c) settings resolution falls back on non-finite / non-number',
  resolveMotionBlurSettings({ postMbStrength: Number.NaN }).strength === 1
  && resolveMotionBlurSettings({ postMbStrength: 'x' }).strength === 1
  && resolveMotionBlurSettings({ postMbSamples: Number.POSITIVE_INFINITY }).samples === 8
  && resolveMotionBlurSettings({}).enabled === false
  && resolveMotionBlurSettings({ postMbEnabled: 1 }).enabled === false);
{
  // Orthographic-ish view-proj: ndc = (x/10, y/10, ...), w = 1.
  const vp = new Array(16).fill(0);
  vp[0] = 0.1; vp[5] = 0.1; vp[10] = 1; vp[15] = 1;
  const still = screenVelocityUv([3, -2, 0], [0, 0, 0], vp);
  check('(c) static particle has exactly zero screen velocity', still[0] === 0 && still[1] === 0);
  const moving = screenVelocityUv([0, 0, 0], [60, -30, 0], vp);
  // Sim units (G4-4 fix round): the position pass integrates
  // pos += vel * uDelta * uSpeed * 60, so vel is world units
  // per 1/60 s frame and the reference-frame travel is
  // vel * dt * 60 (= vel at dt = 1/60), not vel * dt.
  check('(c) uniform motion projects to vel*dt*60 in UV (sim units)',
    near(moving[0], 60 * (MOTION_BLUR_REFERENCE_DT * 60) * 0.1 * 0.5, 1e-12)
    && near(moving[1], -30 * (MOTION_BLUR_REFERENCE_DT * 60) * 0.1 * 0.5, 1e-12),
    JSON.stringify(moving));
  const sped = screenVelocityUv([0, 0, 0], [60, 0, 0], vp, MOTION_BLUR_REFERENCE_DT, 2);
  check('(c) the speed factor scales the travel like uSpeed does',
    near(sped[0], 2 * 60 * (MOTION_BLUR_REFERENCE_DT * 60) * 0.1 * 0.5, 1e-12),
    JSON.stringify(sped));
  // Perspective: w = -z; a point behind the camera resolves to zero.
  const persp = new Array(16).fill(0);
  persp[0] = 1; persp[5] = 1; persp[11] = -1;
  const behind = screenVelocityUv([0, 0, 5], [10, 0, 0], persp);
  check('(c) behind-camera point resolves to zero velocity', behind[0] === 0 && behind[1] === 0);
  const ahead = screenVelocityUv([0, 0, -10], [60, 0, 0], persp);
  check('(c) perspective travel divides by depth',
    near(ahead[0], (60 * (MOTION_BLUR_REFERENCE_DT * 60) / 10) * 0.5, 1e-12), JSON.stringify(ahead));
}
check('(c) zero velocity yields all-zero offsets',
  motionBlurSampleOffsets([0, 0], 2, 8).every(([x, y]) => x === 0 && y === 0));
{
  // Symmetric gather (fix round 2): the span is vel*strength
  // CENTRED on uv — endpoints at ±vel*strength/2, the middle
  // sample of an odd count exactly at uv.
  const offs = motionBlurSampleOffsets([0.2, -0.1], 2, 5);
  check('(c) offsets span vel*strength symmetrically about uv, centre sample at uv',
    offs.length === 5
    && near(offs[0][0], -0.2) && near(offs[0][1], 0.1)
    && offs[2][0] === 0 && offs[2][1] === 0
    && near(offs[4][0], 0.2) && near(offs[4][1], -0.1)
    && offs.every((o, i) => near(o[0], 0.2 * 2 * (i / 4 - 0.5)) && near(o[1], -0.1 * 2 * (i / 4 - 0.5))));
  check('(c) offsets are antisymmetric about the centre sample',
    offs.every((o, i) => near(o[0], -offs[4 - i][0]) && near(o[1], -offs[4 - i][1])));
  check('(c) single sample gathers at uv only',
    motionBlurSampleOffsets([0.3, 0.3], 1, 1).length === 1
    && motionBlurSampleOffsets([0.3, 0.3], 1, 1)[0][0] === 0
    && motionBlurSampleOffsets([0.3, 0.3], 1, 1)[0][1] === 0);
}
{
  const constant = () => [0.7, 0.2, 0.1];
  const g = gatherMotionBlur(constant, [0.5, 0.5], [0.4, 0.4], 3, 8);
  check('(c) gather over a constant field is the identity',
    near(g[0], 0.7, 1e-12) && near(g[1], 0.2, 1e-12) && near(g[2], 0.1, 1e-12));
  const linear = (u) => [u];
  const gl2 = gatherMotionBlur(linear, [0.5, 0.5], [0.2, 0], 1, 5);
  check('(c) gather over a linear field equals the value at the mean offset (the centre)',
    near(gl2[0], 0.5, 1e-12), String(gl2[0]));
  // Step edge at u=0.5, motion along +u: the symmetric
  // samples straddle the edge (two dark, three bright), so
  // the edge pixel is diluted to 3/5; motion along v
  // (perpendicular) changes nothing.
  const step = (u) => [u >= 0.5 ? 1 : 0];
  const along = gatherMotionBlur(step, [0.5, 0.5], [0.4, 0], 1, 5)[0];
  const across = gatherMotionBlur(step, [0.5, 0.5], [0, 0.4], 1, 5)[0];
  check('(c) step edge smears only along the velocity direction',
    near(along, 0.6, 1e-12) && across === 1, `along=${along} across=${across}`);
}
{
  // Independent transcription of the GLSL offset twin.
  const glslOffset = (vx, vy, strength, t) => [vx * strength * (t - 0.5), vy * strength * (t - 0.5)];
  let ok = true;
  for (const [vx, vy] of [[0, 0], [0.2, -0.1], [-0.35, 0.42], [1, 1]]) {
    for (const strength of [0, 0.5, 1, 4]) {
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const cpu = motionBlurSampleOffsets([vx, vy], strength, 9)[i];
        const gpu = glslOffset(vx, vy, strength, t);
        if (!near(cpu[0], gpu[0], 1e-12) || !near(cpu[1], gpu[1], 1e-12)) ok = false;
      }
    }
  }
  check('(c) GLSL offset twin agrees with the CPU offsets over the domain', ok);
  check('(c) offset GLSL chunk carries the recorded symmetric formula',
    MOTION_BLUR_OFFSET_GLSL.includes('return velUv * strength * (t - 0.5);'));
}

// --- (d) DOF tracking supply ----------------------------------------------------
check('(d) zone resolution clamps and falls back',
  resolveDofTrackZone(2) === 2 && resolveDofTrackZone(99) === 3 && resolveDofTrackZone(-1) === 0
  && resolveDofTrackZone(1.6) === 2 && resolveDofTrackZone('x') === 0 && resolveDofTrackZone(Number.NaN) === 0);
check('(d) track predicate needs both keys',
  dofTrackOn({ postDofEnabled: true, postDofTrackParticles: true }) === true
  && dofTrackOn({ postDofEnabled: true, postDofTrackParticles: false }) === false
  && dofTrackOn({ postDofEnabled: false, postDofTrackParticles: true }) === false);
{
  // 4 texels: zones [0, 1, 1, 0] via the species channel.
  const pos = new Float32Array([
    0, 0, 0, 0,
    10, 0, -20, 0,
    20, 6, -40, 0,
    4, 4, 4, 0,
  ]);
  const species = new Uint8Array([0, 1, 1, 0]);
  const z1 = particleZoneCentroid(pos, species, 1);
  check('(d) centroid of a zone averages only its texels',
    z1 !== null && z1.count === 2 && near(z1.centroid[0], 15) && near(z1.centroid[1], 3) && near(z1.centroid[2], -30));
  const zAll = particleZoneCentroid(pos, null, 0);
  check('(d) without a species channel every texel is zone 0',
    zAll !== null && zAll.count === 4 && near(zAll.centroid[0], 8.5));
  check('(d) an empty zone resolves to null',
    particleZoneCentroid(pos, species, 3) === null
    && particleZoneCentroid(pos, null, 2) === null);
}
check('(d) view depth is the forward-axis distance',
  near(viewDepthOfPoint([0, 0, -30], [0, 0, 0], [0, 0, -1]), 30)
  && near(viewDepthOfPoint([5, 0, -30], [0, 0, 0], [0, 0, -2]), 30)
  && near(viewDepthOfPoint([0, 0, 10], [0, 0, 0], [0, 0, -1]), -10)
  && Number.isNaN(viewDepthOfPoint([0, 0, 0], [0, 0, 0], [0, 0, 0])));
{
  const cfg = { postDofEnabled: true, postDofTrackParticles: true, postDofFocusDistance: 0.02 };
  check('(d) tracked depth wins while tracking is on',
    resolveEffectiveDofFocusDistance(cfg, 42.5) === 42.5);
  check('(d) every fallback path returns the config value',
    resolveEffectiveDofFocusDistance(cfg, null) === 0.02
    && resolveEffectiveDofFocusDistance(cfg, Number.NaN) === 0.02
    && resolveEffectiveDofFocusDistance(cfg, -3) === 0.02
    && resolveEffectiveDofFocusDistance({ ...cfg, postDofTrackParticles: false }, 42.5) === 0.02);
}

// --- (e) RT / sampler budget ----------------------------------------------------
check('(e) velocity target is exactly half resolution',
  (() => { const s = velocityTargetSize(1920, 1080); return s.width === 960 && s.height === 540; })()
  && (() => { const s = velocityTargetSize(801, 601); return s.width === 400 && s.height === 300; })()
  && (() => { const s = velocityTargetSize(1, 1); return s.width === 1 && s.height === 1; })());
check('(e) capture creates exactly one half-res target (source pin)',
  readSrc('components/ParticleVelocityCapture.tsx').includes('velocityTargetSize(bufferWidth, bufferHeight)')
  && readSrc('components/ParticleVelocityCapture.tsx').includes('new THREE.WebGLRenderTarget(width, height')
  && readSrc('components/DofTrackCapture.tsx').includes('new THREE.WebGLRenderTarget(1, 1'));
check('(e) splat program declares exactly the pos/vel sampler pair',
  samplerCount(VELOCITY_SPLAT_VERT) === 2 && samplerCount(VELOCITY_SPLAT_FRAG) === 0);
check('(e) reduction program declares exactly the pos/species sampler pair',
  samplerCount(DOF_TRACK_REDUCTION_VERT) === 2 && samplerCount(DOF_TRACK_REDUCTION_FRAG) === 0);
check('(e) stage fragment declares only tDiffuse + tVelocity',
  samplerCount(MOTION_BLUR_FRAG) === 2
  && MOTION_BLUR_FRAG.includes('uniform sampler2D tDiffuse;')
  && MOTION_BLUR_FRAG.includes('uniform sampler2D tVelocity;'));
check('(e) stage gathers symmetrically along the velocity with the twin (no history texture)',
  MOTION_BLUR_FRAG.includes('kaloMotionBlurOffset(velUv, uStrength, t)')
  && MOTION_BLUR_FRAG.includes(`i < ${MOTION_BLUR_MAX_SAMPLES}`)
  && !/prev|history|lastFrame/i.test(MOTION_BLUR_FRAG)
  && !/prev|history|lastFrame/i.test(VELOCITY_SPLAT_VERT + VELOCITY_SPLAT_FRAG));
check('(e) splat diameter / pixel size twins follow their formulas',
  near(motionBlurPointDiameterWorld(2, 100), 4)
  && motionBlurPointDiameterWorld(0, 100) === 0
  && near(motionBlurPointSizePx(4, 800, 40), 80)
  && motionBlurPointSizePx(4, 800, 0) === 0);
check('(e) reference dt is the recorded 1/60 frame',
  MOTION_BLUR_REFERENCE_DT === 1 / 60);
check('(e) splat forward projection uses sim units (vel * uSpeed * dt * 60)',
  VELOCITY_SPLAT_VERT.includes('uniform float uSpeed;')
  && VELOCITY_SPLAT_VERT.includes('vel * uSpeed * (uReferenceDt * 60.0)'));
check('(e) capture feeds gpgpuSpeed to the splat uSpeed uniform (source pin)',
  readSrc('components/ParticleVelocityCapture.tsx').includes('uSpeed: { value: 1 }')
  && readSrc('components/ParticleVelocityCapture.tsx').includes('config.gpgpuSpeed'));

// --- (f) fix round 2: capture supply route + diag stats -------------------------
check('(f) stage fragment centres a single sample (t = 0.5)',
  MOTION_BLUR_FRAG.includes('n <= 1.0 ? 0.5 :'));
{
  const cap = readSrc('components/ParticleVelocityCapture.tsx');
  check('(f) capture reads the sim frame store, never the draw material uniforms',
    cap.includes('getMotionSimFrameSource()')
    && !cap.includes('uniforms?.uPosTex')
    && !cap.includes('uniforms?.uVelTex'));
  check('(f) capture publishes its render target for the diag readback',
    cap.includes('target: rt'));
  check('(f) capture records every skip in the diag state',
    cap.includes("noteMotionCaptureSkip('no-points')")
    && cap.includes("noteMotionCaptureSkip('no-sim-frame')")
    && cap.includes("noteMotionCaptureSkip('zero-diameter')")
    && cap.includes("noteMotionCaptureSkip('bad-buffer')")
    && cap.includes('noteMotionCapturePublished()'));
  const sys = readSrc('components/sceneGpgpuSystem.tsx');
  check('(f) the frame loop publishes the sim output targets to the store (source pin)',
    sys.includes('setMotionSimFrameSource({ posTexture: posOut.texture, velTexture: velOut.texture })'));
  check('(f) the diag hook exposes the velocity field stats (source pin)',
    sys.includes('captureMotionVelocityStats'));
}
{
  const pos = { id: 'pos' };
  const vel = { id: 'vel' };
  check('(f) sim frame store starts empty and round-trips by identity',
    getMotionSimFrameSource() === null
    && (setMotionSimFrameSource({ posTexture: pos, velTexture: vel }), getMotionSimFrameSource()?.posTexture === pos)
    && (setMotionSimFrameSource(null), getMotionSimFrameSource() === null));
}
{
  const before = getMotionCaptureDiagState();
  noteMotionCaptureFrame();
  noteMotionCaptureSkip('no-sim-frame');
  noteMotionCaptureFrame();
  noteMotionCapturePublished();
  const after = getMotionCaptureDiagState();
  check('(f) capture diag counters count frames, skips and publishes',
    after.framesSeen === before.framesSeen + 2
    && after.framesPublished === before.framesPublished + 1
    && after.skips['no-sim-frame'] === before.skips['no-sim-frame'] + 1
    && after.lastSkipReason === null);
}
check('(f) half-float decode pins',
  halfFloatBitsToFloat(0x0000) === 0
  && halfFloatBitsToFloat(0x3c00) === 1
  && halfFloatBitsToFloat(0xbc00) === -1
  && halfFloatBitsToFloat(0x3800) === 0.5
  && halfFloatBitsToFloat(0x4000) === 2
  && Number.isNaN(halfFloatBitsToFloat(0x7e00))
  && halfFloatBitsToFloat(0x7c00) === Infinity);
{
  // Half bits: 1.0=0x3c00, 0.5=0x3800, 2.0=0x4000, 0=0x0000.
  // texel0: vel (1, 0), coverage 1  -> covered, |v| = 1
  // texel1: vel (0.5, 0), coverage 0 -> not covered
  // texel2: vel (0, -2), coverage 1 -> covered, |v| = 2
  // texel3: all zero                -> not covered
  const data = new Uint16Array([
    0x3c00, 0x0000, 0x0000, 0x3c00,
    0x3800, 0x0000, 0x0000, 0x0000,
    0x0000, 0xc000, 0x0000, 0x3c00,
    0x0000, 0x0000, 0x0000, 0x0000,
  ]);
  const stats = motionVelocityStatsFromReadback(data);
  check('(f) velocity stats aggregate covered texels only',
    stats.texelCount === 4 && stats.coveredTexels === 2
    && near(stats.coverageRate, 0.5) && near(stats.maxAbsVelUv, 2) && near(stats.meanAbsVelUv, 1.5),
    JSON.stringify(stats));
  const empty = motionVelocityStatsFromReadback(new Uint16Array(0));
  check('(f) velocity stats over an empty readback are zero',
    empty.texelCount === 0 && empty.coverageRate === 0 && empty.maxAbsVelUv === 0 && empty.meanAbsVelUv === 0);
}

// --- (g) fix round 3: pass-side binding moved into render() ---------------------
{
  const pass = readSrc('components/motionBlurPass.ts');
  check('(g) the pass reads the velocity store inside render() (source pin)',
    pass.includes('getMotionVelocitySource()')
    && pass.includes('noteMotionBlurPassRender('));
  check('(g) AppScenePostFx no longer assigns the velocity texture (source pin)',
    !readSrc('components/AppScenePostFx.tsx').includes('motionBlurPass.velocityTexture')
    && !readSrc('components/AppScenePostFx.tsx').includes('useMotionVelocitySource'));
  check('(g) the diag hook exposes the pass binding stats (source pin)',
    readSrc('components/sceneGpgpuSystem.tsx').includes('captureMotionBlurPassStats'));
}
{
  const before = getMotionBlurPassDiagState();
  noteMotionBlurPassRender(true, 640, 360);
  noteMotionBlurPassRender(false, null, null);
  const after = getMotionBlurPassDiagState();
  check('(g) pass diag state counts renders and keeps the last (unbound) record',
    before.renders === 0 && after.renders === 2
    && after.lastVelocityReady === false
    && after.lastTextureWidth === null && after.lastTextureHeight === null);
  noteMotionBlurPassRender(true, 320, 180);
  const bound = getMotionBlurPassDiagState();
  check('(g) pass diag state keeps the bound texture dimensions',
    bound.renders === 3 && bound.lastVelocityReady === true
    && bound.lastTextureWidth === 320 && bound.lastTextureHeight === 180);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
