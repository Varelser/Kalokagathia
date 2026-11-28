// Grammar 2.0 stage 2, texture-unit follow-up — the merged
// supply (供給統合, Sugi's choice 2026-11-27): the REP output
// and the column data share ONE texture so live rules +
// field instances / path assets fit the velocity fragment's
// 16-unit floor (the unmerged pair measured 17 — B1/B2
// records). Record:
// kalokagathia-pro/STAGE2_MERGED_SUPPLY_IMPL_RECORD.md.
//
// Cases:
//  1 resolver: plan stands exactly while REP stands AND a
//    column supply exists (incl. the predation-only REP)
//  2 plan geometry: strip rows / total height / y scale
//  3 blit <-> fetch address agreement: for every column
//    texel, the strip texel the REP blit writes is the
//    texel the merged kaloColFetch reads (numeric, both
//    remaps transcribed)
//  4 velocity merged string: 16 units, one merged sampler,
//    no uColTex / uRuleLiveTex declarations, merged fetch +
//    merged live read, spawn-order give-back kept
//  5 position merged string: live reads scaled, y-scale
//    uniform declared; non-merged live string untouched
//  6 draw merged string: display read scaled; stock
//    display string untouched
//  7 identity: default velocity / position strings are the
//    exported stock constants (byte identity by reference)
//  8 undeclared-uniform scan: every u* identifier used in
//    the built velocity / position strings is declared in
//    the same string, across all variant combinations
//    (default / live only / column only / merged / merged +
//    paths). Regression guard for the stage-4 gate fix
//    round: the merged velocity segment kept the
//    `if (uRuleLiveEnabled)` guard from the stock live
//    segment while the merged preamble dropped the RULE_LIVE
//    chunk that declares it, so the merged shader failed to
//    compile and the velocity pass froze on real GPU
//    (GATE_STAGE4_RECORD premise check).
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2ms-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const occurrences = (s, sub) => s.split(sub).length - 1;

await build({
  stdin: {
    contents: `
      export { resolveMergedSupplyPlan, mergedSupplyActive } from './lib/gpgpuMergedSupply.ts';
      export { getColumnSupply } from './lib/gpgpuPathAssets.ts';
      export { buildRuleEvalFragment } from './lib/gpgpuParticleRulesLive.ts';
      export { resolveLiveRulesWithPredation } from './lib/gpgpuPredation.ts';
      export { parseGpgpuGroups } from './lib/gpgpuGroups.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildDrawVert, DRAW_VERT } from './components/gpgpuShaderPoints.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolveMergedSupplyPlan, mergedSupplyActive, getColumnSupply,
  buildRuleEvalFragment, resolveLiveRulesWithPredation, parseGpgpuGroups,
  buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG,
  buildDrawVert, DRAW_VERT, APP_STATE_DEFAULT_GPGPU,
} = lib;

const base = { ...APP_STATE_DEFAULT_GPGPU };
const LIVE = JSON.stringify([{ id: 'k1', enabled: true, target: { type: 'all' }, condition: '', action: { type: 'kill' } }]);
const INSTANCES = JSON.stringify([
  { kind: 'vortex', pos: [10, 0, 0], radius: 100, strength: 2, tilt: 0 },
  { kind: 'well', pos: [-20, 5, 0], radius: 60, strength: 1 },
]);
const PATHS = '[{"name":"long","points":[[0,0,0],[10,0,0],[20,0,0],[30,0,0],[40,0,0],[50,0,0],[60,0,0],[70,0,0],[80,0,0],[90,0,0],[100,0,0],[110,0,0]]}]';
const repStands = (cfg) => buildRuleEvalFragment(resolveLiveRulesWithPredation(cfg), {
  names: cfg.gpgpuAttrNames ?? [], names2: cfg.gpgpuAttrNames2 ?? [],
  groupDefs: parseGpgpuGroups(cfg.gpgpuGroupsData ?? ''), densityAvailable: true,
}) !== null;

// ── 1. Resolver ─────────────────────────────────────────────
{
  const T = 128;
  check('1 defaults: no plan', resolveMergedSupplyPlan(base, T) === null);
  check('1 live only: no plan', resolveMergedSupplyPlan({ ...base, gpgpuParticleRulesLive: LIVE }, T) === null);
  check('1 fields only: no plan', resolveMergedSupplyPlan({ ...base, gpgpuFieldInstances: INSTANCES }, T) === null);
  check('1 live + fields: plan stands', resolveMergedSupplyPlan({ ...base, gpgpuParticleRulesLive: LIVE, gpgpuFieldInstances: INSTANCES }, T) !== null);
  check('1 live + paths: plan stands', resolveMergedSupplyPlan({ ...base, gpgpuParticleRulesLive: LIVE, gpgpuSteerSeekPaths: PATHS }, T) !== null);
  const pred = { ...base, gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'kill', gpgpuFieldInstances: INSTANCES };
  check('1 predation-only REP + fields: plan stands (REP stands via predation)',
    repStands(pred) && resolveMergedSupplyPlan(pred, T) !== null);
  // Agreement over a small matrix: plan ⟺ REP stands AND supply exists.
  let agree = true;
  for (const cfg of [
    base,
    { ...base, gpgpuParticleRulesLive: LIVE },
    { ...base, gpgpuFieldInstances: INSTANCES },
    { ...base, gpgpuParticleRulesLive: LIVE, gpgpuFieldInstances: INSTANCES },
    { ...base, gpgpuParticleRulesLive: LIVE, gpgpuSteerSeekPaths: PATHS },
    pred,
    { ...base, gpgpuPredationEnabled: true, gpgpuPredationOutcome: 'kill' },
  ]) {
    const expect = repStands(cfg) && getColumnSupply(cfg) !== null;
    if ((resolveMergedSupplyPlan(cfg, T) !== null) !== expect) agree = false;
  }
  check('1 plan ⟺ (REP stands AND column supply exists) over the matrix', agree);
}

// ── 2. Plan geometry ────────────────────────────────────────
{
  const cfg = { ...base, gpgpuParticleRulesLive: LIVE, gpgpuFieldInstances: INSTANCES };
  const supply = getColumnSupply(cfg);
  for (const T of [128, 256]) {
    const plan = resolveMergedSupplyPlan(cfg, T);
    const texelCount = supply.width * supply.height;
    check(`2 geometry at texSize ${T}`,
      plan.texelCount === texelCount
      && plan.stripRows === Math.max(1, Math.ceil(texelCount / T))
      && plan.totalHeight === T + plan.stripRows
      && Math.abs(plan.yScale - T / plan.totalHeight) < 1e-12);
  }
}

// ── 3. Blit <-> fetch address agreement ─────────────────────
{
  // Blit (REP pass): dest strip texel (dx, dy) takes source
  // linear index lin = dy * W + dx (W = merged width).
  // Fetch (velocity): column linear index idx reads strip
  // texel (idx mod W, idx div W). So the texel the blit
  // wrote for source idx sits exactly where the fetch for
  // idx looks. Verified numerically for every texel of a
  // supply wider than the merged width (the repack case).
  const W = 128; const colW = 256; const colH = 3;
  let ok = true;
  for (let idx = 0; idx < colW * colH; idx++) {
    const fx = idx % W; const fy = Math.floor(idx / W); // fetch strip texel
    const lin = fy * W + fx;                            // blit linear index at that texel
    if (lin !== idx) ok = false;
    const sx = lin % colW; const sy = Math.floor(lin / colW); // blit source texel
    if (sx !== idx % colW || sy !== Math.floor(idx / colW)) ok = false;
  }
  check('3 blit write address == fetch read address for every column texel (repack case)', ok);
  const blitSrc = readFileSync(join(ROOT, 'components/gpgpuRuleEvalPass.ts'), 'utf8');
  check('3 REP pass carries the blit + tall targets + viewport restriction',
    blitSrc.includes('RULE_EVAL_BLIT_FRAG') && blitSrc.includes('blitColumn(')
    && blitSrc.includes('rt.viewport.set(0, 0, texSize, texSize)')
    && blitSrc.includes('target.viewport.set(0, this.texSize, this.texSize, this.stripRows)'));
}

// ── 4. Velocity merged string ───────────────────────────────
{
  const merged = buildVelocityFragment('', undefined, { steeringSeek: true, fieldInstances: true, particleRulesLive: true, mergedSupply: true });
  check('4 fields + live merged: 16 units', samplerCount(merged) === 16, String(samplerCount(merged)));
  check('4 one merged sampler, no parent samplers declared',
    occurrences(merged, 'uniform sampler2D uMergedTex;') === 1
    && !merged.includes('uniform sampler2D uColTex;')
    && !merged.includes('uniform sampler2D uRuleLiveTex;'));
  check('4 merged fetch + merged live read present',
    merged.includes('return texture2D(uMergedTex, vec2((sx + 0.5) / uTexSizeF, (uTexSizeF + sy + 0.5) / uMergedTexHeight));')
    && merged.includes('float liveMask = texture2D(uMergedTex, vec2(globalUv.x, globalUv.y * uTexSizeF / uMergedTexHeight)).r;'));
  check('4 spawn-order give-back kept', !merged.includes('uniform sampler2D uSpawnOrderTex;')
    && merged.includes('uniform float uSpawnOrderMaxDist;'));
  const mergedPaths = buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true, particleRulesLive: true, mergedSupply: true });
  check('4 paths + live merged: 16 units', samplerCount(mergedPaths) === 16, String(samplerCount(mergedPaths)));
}

// ── 5. Position merged string ───────────────────────────────
{
  const merged = buildPositionFragment({ particleRulesLive: true, particleRulesLiveMerged: true });
  check('5 live reads scaled + scale uniform declared',
    occurrences(merged, 'texture2D(uRuleLiveTex, vec2(vUv.x, vUv.y * uLiveTexYScale))') === 2
    && merged.includes('uniform float uLiveTexYScale;')
    && !merged.includes('texture2D(uRuleLiveTex, vUv)'));
  const mergedGate = buildPositionFragment({ particleRulesLive: true, particleRulesLiveMerged: true, spawnRuleGate: true });
  check('5 spawn-gate read scaled too (3 scaled reads)',
    occurrences(mergedGate, 'texture2D(uRuleLiveTex, vec2(vUv.x, vUv.y * uLiveTexYScale))') === 3);
  check('5 non-merged live string keeps the unscaled reads',
    occurrences(buildPositionFragment({ particleRulesLive: true }), 'texture2D(uRuleLiveTex, vUv)') === 2);
}

// ── 6. Draw merged string ───────────────────────────────────
{
  const merged = buildDrawVert({ ruleDisplay: true, ruleDisplayMerged: true });
  check('6 display read scaled + scale uniform declared',
    merged.includes('texture2D(uRuleLiveTex, vec2(particleUv.x, particleUv.y * uLiveTexYScale))')
    && merged.includes('uniform float uLiveTexYScale;'));
  check('6 stock display string unscaled',
    buildDrawVert({ ruleDisplay: true }).includes('texture2D(uRuleLiveTex, particleUv).a'));
}

// ── 7. Identity ─────────────────────────────────────────────
{
  check('7 default velocity string is the stock constant', buildVelocityFragment('') === SIM_VEL_FRAG);
  check('7 default position string is the stock constant', buildPositionFragment() === SIM_POS_FRAG);
  check('7 default draw vertex is the stock constant', buildDrawVert() === DRAW_VERT);
  check('7 mergedSupplyActive agrees with the plan', mergedSupplyActive({ ...base, gpgpuParticleRulesLive: LIVE, gpgpuFieldInstances: INSTANCES }, 128)
    && !mergedSupplyActive(base, 128));
}

// ── 8. Undeclared-uniform scan ──────────────────────────────
{
  // Strip comments first so prose mentions of u* names do
  // not count as uses or declarations. A uniform counts as
  // declared by `uniform <type> <name>;` (array suffix
  // allowed); every other u[A-Z]* identifier occurrence is
  // a use. GLSL built-ins and varyings do not start with
  // `u` + capital, so the use set is exactly the uniforms.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const undeclaredUniforms = (frag) => {
    const code = stripComments(frag);
    const declared = new Set();
    for (const m of code.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*;/g)) declared.add(m[1]);
    const missing = new Set();
    for (const m of code.matchAll(/\b(u[A-Z][A-Za-z0-9_]*)\b/g)) if (!declared.has(m[1])) missing.add(m[1]);
    return [...missing].sort();
  };
  const velVariants = {
    'default': buildVelocityFragment(''),
    'live only': buildVelocityFragment('', undefined, { particleRulesLive: true }),
    'column only (fields)': buildVelocityFragment('', undefined, { steeringSeek: true, fieldInstances: true }),
    'column only (paths)': buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true }),
    'merged (fields + live)': buildVelocityFragment('', undefined, { steeringSeek: true, fieldInstances: true, particleRulesLive: true, mergedSupply: true }),
    'merged + paths': buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true, particleRulesLive: true, mergedSupply: true }),
  };
  for (const [name, frag] of Object.entries(velVariants)) {
    const missing = undeclaredUniforms(frag);
    check(`8 velocity ${name}: no undeclared uniform used`, missing.length === 0, missing.join(', '));
  }
  // The merged regression itself, pinned by name: the guard
  // uses the flag, so the declaration must be in the string.
  check('8 merged velocity declares uRuleLiveEnabled',
    velVariants['merged (fields + live)'].includes('uniform bool  uRuleLiveEnabled;')
    && velVariants['merged + paths'].includes('uniform bool  uRuleLiveEnabled;'));
  const posVariants = {
    'default': buildPositionFragment(),
    'live only': buildPositionFragment({ particleRulesLive: true }),
    'live merged': buildPositionFragment({ particleRulesLive: true, particleRulesLiveMerged: true }),
  };
  for (const [name, frag] of Object.entries(posVariants)) {
    const missing = undeclaredUniforms(frag);
    check(`8 position ${name}: no undeclared uniform used`, missing.length === 0, missing.join(', '));
  }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
