// Grammar 2.0 stage 1, slice 1D-3 — grammar connection:
// the live-rule spawn action (REP mask bit 13, a pulse),
// its live-only classification, and the Aux ruleSpawn mode
// (mode 4, LEVEL 1 ONLY — the REP exists only for the main
// pool). Design: kalokagathia-pro/STAGE1_1D_SPAWN_DESIGN.md
// §4 / §5; implementation record: STAGE1_1D3_IMPL_RECORD.md.
//
// Cases:
//  1 spawn action: parses and is KEPT, serialises, counts
//    as a consumed action; bit 13 = 8192 (bit 12 reserved)
//  2 classification: spawn is live-only — plain conditions
//    go live; snapshot-group / den-without-density fall to
//    'never' (spawn-live-only-*), where a kill rule with
//    the same shape still falls back to the bake
//  3 REP fragment: a spawn-only list builds the REP; the
//    pulse term lands in the mask; no latch-back of bit 13
//  4 CPU twin: matched spawn sets bit 13 for that step
//    only; prevMask bit 13 does NOT latch (true-kill does)
//  5 Aux pure module: mode id 4, level-1 activation, the
//    bit test over the 0..16383 mask range, the intensity-
//    capped gate, the burst velocity distribution
//  6 Aux shader variant: the ruleSpawn text (REP binding +
//    mode-4 branch) exists only in the level-1 variant;
//    the chain builders have no ruleSpawn at all
//  7 identity pins: every stock Aux string stays at its
//    shipped pin; builders with no / stock options return
//    the stock strings; no ruleSpawn text in stock strings
//  8 inheritance: a ruleSpawn spawn is a capture point of
//    the level-1 inheritance write (5 stock + 1); the
//    chain inheritance form ignores the option
//  9 wiring pins: mode id in the passes, the REP texture
//    hand-off from the scene, the variant swap, and the
//    level-1-only registration (types / catalog / panel)
// 10 REP <-> Aux correspondence on the CPU twins: a matched
//    rule's mask passes the gate exactly when the pulse
//    stands and the hash roll is under the intensity cap
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1d3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const count = (s, sub) => s.split(sub).length - 1;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

await build({
  stdin: {
    contents: `
      export {
        parseLiveParticleRules, serializeLiveParticleRules,
        liveRulesHaveConsumedAction, classifyLiveRules,
        buildRuleEvalFragment, evaluateLiveRuleStep,
        LIVE_RULE_SPAWN_BIT, LIVE_RULE_TRUE_KILL_BIT,
        LIVE_RULE_CONSUMED_ACTIONS, LIVE_RULE_CONSUMED_ACTIONS_1D3,
      } from './lib/gpgpuParticleRulesLive.ts';
      export {
        AUX_RULE_SPAWN_MODE_ID, auxRuleSpawnLevel1Active,
        auxRuleMaskHasSpawn, auxRuleSpawnGate, auxRuleSpawnVelocity,
      } from './lib/auxRuleSpawn.ts';
      export {
        AUX_VEL_FRAG, AUX_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
        AUX_EVENT_GLSL, AUX_CHAIN_EVENT_GLSL,
        AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG,
        buildAuxEventGlsl, buildAuxChainEventGlsl,
        buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxChainPosFrag,
        buildAuxInheritFrag,
      } from './components/gpgpuShaderAux.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  parseLiveParticleRules, serializeLiveParticleRules,
  liveRulesHaveConsumedAction, classifyLiveRules,
  buildRuleEvalFragment, evaluateLiveRuleStep,
  LIVE_RULE_SPAWN_BIT, LIVE_RULE_TRUE_KILL_BIT,
  LIVE_RULE_CONSUMED_ACTIONS, LIVE_RULE_CONSUMED_ACTIONS_1D3,
  AUX_RULE_SPAWN_MODE_ID, auxRuleSpawnLevel1Active,
  auxRuleMaskHasSpawn, auxRuleSpawnGate, auxRuleSpawnVelocity,
  AUX_VEL_FRAG, AUX_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG,
  AUX_EVENT_GLSL, AUX_CHAIN_EVENT_GLSL,
  AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG,
  buildAuxEventGlsl, buildAuxChainEventGlsl,
  buildAuxVelFrag, buildAuxPosFrag, buildAuxChainVelFrag, buildAuxChainPosFrag,
  buildAuxInheritFrag,
  APP_STATE_DEFAULT_GPGPU: D,
} = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const rule = (id, action, condition = '', target = { type: 'all' }) => ({
  id, enabled: true, target, condition, action,
});
const J = (v) => JSON.stringify(v);
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };

// ── 1. spawn action: parse / keep / bit ────────────────────
{
  const parsed = parseLiveParticleRules(J([rule('sp1', { type: 'spawn' })]));
  check('1a spawn action parses and is kept', parsed.length === 1 && parsed[0].action.type === 'spawn');
  check('1b spawn serialises back', serializeLiveParticleRules(parsed) === J([rule('sp1', { type: 'spawn' })]));
  check('1c spawn counts as a consumed action',
    liveRulesHaveConsumedAction(J([rule('sp1', { type: 'spawn' })])) === true
    && LIVE_RULE_CONSUMED_ACTIONS_1D3.includes('spawn')
    && LIVE_RULE_CONSUMED_ACTIONS.includes('spawn'));
  check('1d spawn bit is 13 = 8192 (bit 12 stays reserved)',
    LIVE_RULE_SPAWN_BIT === 8192 && LIVE_RULE_SPAWN_BIT === 2 ** 13);
  check('1e default aux modes stay off (identity)',
    D.gpgpuAuxMode === 'none' && D.gpgpuAux2Mode === 'none');
}

// ── 2. classification: spawn is live-only ──────────────────
{
  const live = classifyLiveRules([rule('sp1', { type: 'spawn' }, 'vel > 1')], OPTS);
  check('2a spawn with a live condition classifies live',
    live[0].route === 'live' && live[0].reason === '');
  const snapshotGroup = { id: 'snap1', source: { kind: 'snapshot', indices: [] } };
  const spawnGroup = classifyLiveRules(
    [rule('sp2', { type: 'spawn' }, '', { type: 'group', id: 'snap1' })],
    { ...OPTS, groupDefs: [snapshotGroup] },
  );
  check('2b spawn on a snapshot group is never (spawn-live-only), not baked-fallback',
    spawnGroup[0].route === 'never' && spawnGroup[0].reason === 'spawn-live-only-group-not-shader-resolvable',
    `${spawnGroup[0].route}/${spawnGroup[0].reason}`);
  const killGroup = classifyLiveRules(
    [rule('k2', { type: 'kill' }, '', { type: 'group', id: 'snap1' })],
    { ...OPTS, groupDefs: [snapshotGroup] },
  );
  check('2c the same shape with kill still falls back to the bake',
    killGroup[0].route === 'baked-fallback' && killGroup[0].reason === 'group-not-shader-resolvable');
  const spawnDen = classifyLiveRules(
    [rule('sp3', { type: 'spawn' }, 'den > 0.5')],
    { ...OPTS, densityAvailable: false },
  );
  check('2d spawn reading den without the density pass is never (spawn-live-only)',
    spawnDen[0].route === 'never' && spawnDen[0].reason === 'spawn-live-only-den-without-density-pass',
    `${spawnDen[0].route}/${spawnDen[0].reason}`);
  const spawnDenLive = classifyLiveRules([rule('sp3', { type: 'spawn' }, 'den > 0.5')], OPTS);
  check('2e spawn reading den WITH the density pass classifies live',
    spawnDenLive[0].route === 'live');
  const broken = classifyLiveRules([rule('sp4', { type: 'spawn' }, 'vel >>')], OPTS);
  check('2f spawn with an uncompilable condition is never (condition-uncompilable)',
    broken[0].route === 'never' && broken[0].reason === 'condition-uncompilable');
}

// ── 3. REP fragment: the pulse term ────────────────────────
{
  const frag = buildRuleEvalFragment([rule('sp1', { type: 'spawn' }, 'vel > 1')], OPTS);
  check('3a a spawn-only rule list builds the REP', typeof frag === 'string');
  check('3b the fragment accumulates liveSpawn and adds the 8192.0 pulse term',
    frag.includes('liveSpawn = max(liveSpawn, matched0);')
    && frag.includes('liveSpawn * 8192.0'));
  check('3c bit 13 is never read back from prev (no latch)',
    !frag.includes('prev.r / 8192.0') && frag.includes(`prev.r / ${LIVE_RULE_TRUE_KILL_BIT}.0`));
  const noSpawn = buildRuleEvalFragment([rule('k1', { type: 'kill' })], OPTS);
  check('3d a list without spawn emits no per-rule spawn accumulation',
    typeof noSpawn === 'string' && !noSpawn.includes('liveSpawn = max'));
}

// ── 4. CPU twin: pulse semantics ───────────────────────────
{
  const classified = classifyLiveRules([rule('sp1', { type: 'spawn' }, 'vel > 1')], OPTS);
  const hit = evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 2 } });
  check('4a a matched spawn sets bit 13 in the step mask',
    (hit.mask & LIVE_RULE_SPAWN_BIT) !== 0 && hit.matched.includes('sp1'));
  const miss = evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 0.5 } });
  check('4b an unmatched spawn sets nothing', (miss.mask & LIVE_RULE_SPAWN_BIT) === 0);
  const after = evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 0.5 }, prevMask: LIVE_RULE_SPAWN_BIT });
  check('4c prevMask bit 13 does NOT latch into the next step',
    (after.mask & LIVE_RULE_SPAWN_BIT) === 0);
  const tkClassified = classifyLiveRules([rule('tk1', { type: 'true-kill' }, 'vel > 1')], OPTS);
  const tkAfter = evaluateLiveRuleStep(tkClassified, { slots: [], vars: { vel: 0.5 }, prevMask: LIVE_RULE_TRUE_KILL_BIT });
  check('4d contrast: the true-kill bit 6 still latches through prevMask',
    (tkAfter.mask & LIVE_RULE_TRUE_KILL_BIT) !== 0);
}

// ── 5. Aux pure module ─────────────────────────────────────
{
  check('5a ruleSpawn mode id is 4', AUX_RULE_SPAWN_MODE_ID === 4);
  check('5b level-1 variant engages only on ruleSpawn',
    auxRuleSpawnLevel1Active({ gpgpuAuxMode: 'ruleSpawn' }) === true
    && auxRuleSpawnLevel1Active({ gpgpuAuxMode: 'emit' }) === false
    && auxRuleSpawnLevel1Active({ gpgpuAuxMode: 'none' }) === false);
  check('5c the bit test reads bit 13 across the mask range',
    auxRuleMaskHasSpawn(0) === false
    && auxRuleMaskHasSpawn(3871) === false
    && auxRuleMaskHasSpawn(4096) === false
    && auxRuleMaskHasSpawn(8192) === true
    && auxRuleMaskHasSpawn(8192 + 3871) === true
    && auxRuleMaskHasSpawn(16383) === true
    && auxRuleMaskHasSpawn(NaN) === false);
  check('5d the gate needs the pulse AND a roll under the intensity cap',
    auxRuleSpawnGate(8192, 0.4, 1) === true
    && auxRuleSpawnGate(8192, 0.6, 0.5) === false
    && auxRuleSpawnGate(0, 0.0, 1) === false
    && auxRuleSpawnGate(8192, 0.0, 0) === false);
  check('5e the intensity cap clamps above 1 and rejects non-finite',
    auxRuleSpawnGate(8192, 0.99, 3) === true
    && auxRuleSpawnGate(8192, 0.1, NaN) === false);
  const v = auxRuleSpawnVelocity([0.3, -0.2, 0.1], 0.5, 26);
  const mag = 26 * (0.35 + 0.65 * 0.5);
  const vl = Math.hypot(v[0], v[1], v[2]);
  const hl = Math.hypot(0.3, -0.2, 0.1);
  check('5f burst velocity: hash direction at the legacy speed factor',
    near(vl, mag, 1e-9)
    && near(v[0] / vl, 0.3 / hl, 1e-9) && near(v[1] / vl, -0.2 / hl, 1e-9));
  const fb = auxRuleSpawnVelocity([0, 0, 0], 0, 10);
  check('5g a degenerate hash direction falls back to +Y',
    near(fb[0], 0) && near(fb[1], 10 * 0.35) && near(fb[2], 0));
}

// ── 6. Aux shader variant: level 1 only ────────────────────
{
  const variant = buildAuxEventGlsl({ ruleSpawn: true });
  check('6a the variant declares the REP binding exactly once',
    count(variant, 'uniform sampler2D uMainRuleTex;') === 1);
  check('6b the variant carries the mode-4 branch with the bit test and the capped gate',
    variant.includes('if (uAuxMode == 4) {')
    && variant.includes('mod(floor(ruleData.r / 8192.0), 2.0)')
    && variant.includes('gate < clamp(uAuxIntensity, 0.0, 1.0)'));
  check('6c stock event chunk has no ruleSpawn text',
    !AUX_EVENT_GLSL.includes('uMainRuleTex') && !AUX_EVENT_GLSL.includes('uAuxMode == 4'));
  check('6d vel / pos variants carry the branch; both passes sample the REP',
    buildAuxVelFrag({ ruleSpawn: true }).includes('uAuxMode == 4')
    && buildAuxPosFrag({ ruleSpawn: true }).includes('uAuxMode == 4')
    && count(buildAuxVelFrag({ ruleSpawn: true }), 'uMainRuleTex') >= 1
    && count(buildAuxPosFrag({ ruleSpawn: true }), 'uMainRuleTex') >= 1);
  check('6e the chain builders have no ruleSpawn: option ignored, stock returned',
    buildAuxChainEventGlsl({ ruleSpawn: true }) === AUX_CHAIN_EVENT_GLSL
    && buildAuxChainVelFrag({ ruleSpawn: true }) === AUX_CHAIN_VEL_FRAG
    && buildAuxChainPosFrag({ ruleSpawn: true }) === AUX_CHAIN_POS_FRAG);
  check('6f chain stock strings carry no REP binding and no mode-4 branch',
    !AUX_CHAIN_EVENT_GLSL.includes('uMainRuleTex') && !AUX_CHAIN_EVENT_GLSL.includes('uAuxMode == 4'));
  check('6g ruleSpawn composes with the SDF-splash and emit variants',
    buildAuxEventGlsl({ ruleSpawn: true, sdfSplash: true }).includes('uAuxMode == 4')
    && buildAuxEventGlsl({ ruleSpawn: true, emit: true }).includes('uAuxMode == 4')
    && buildAuxEventGlsl({ ruleSpawn: true, emit: true }).includes('uAuxMode == 5'));
}

// ── 7. identity pins ───────────────────────────────────────
check('7a AUX_VEL_FRAG at shipped v2.01.0 pin',
  sha(AUX_VEL_FRAG) === '9bdf0c431b4330df19bfb24aa96016e6b5d312fd13c5105cc960b56c2df1653e', sha(AUX_VEL_FRAG));
check('7b AUX_POS_FRAG at shipped v2.01.0 pin',
  sha(AUX_POS_FRAG) === 'cfe2304d5b8aa3958fb975c8e35f4aa882cbe7a518e2ed096bc59c238aebab3b', sha(AUX_POS_FRAG));
check('7c chain pair at shipped pins',
  sha(AUX_CHAIN_VEL_FRAG) === '3098cf7589b331209973651e463a7638cf2e8c53f25748d86546d19123338c7b'
  && sha(AUX_CHAIN_POS_FRAG) === 'a0dae2cc056f0e1caf1c04a753ebcdda9f3206432b9f130ea49499ef13988bf4');
check('7d builders with no / stock options return the stock strings',
  buildAuxEventGlsl() === AUX_EVENT_GLSL
  && buildAuxEventGlsl({ ruleSpawn: false }) === AUX_EVENT_GLSL
  && buildAuxVelFrag({ ruleSpawn: false }) === AUX_VEL_FRAG
  && buildAuxPosFrag({ ruleSpawn: false }) === AUX_POS_FRAG
  && buildAuxInheritFrag() === AUX_INHERIT_FRAG
  && buildAuxInheritFrag({ chain: true }) === AUX_CHAIN_INHERIT_FRAG);
check('7e no ruleSpawn text in any stock Aux string',
  ![AUX_VEL_FRAG, AUX_POS_FRAG, AUX_CHAIN_VEL_FRAG, AUX_CHAIN_POS_FRAG, AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG]
    .some((s) => s.includes('uMainRuleTex') || s.includes('uAuxMode == 4')));

// ── 8. inheritance: ruleSpawn spawns are captured ──────────
{
  const stock = buildAuxInheritFrag();
  const variant = buildAuxInheritFrag({ ruleSpawn: true });
  check('8a stock inheritance capture points stay 5',
    count(stock, 'gAuxSpawnSrcUv = srcUv;') === 5, String(count(stock, 'gAuxSpawnSrcUv = srcUv;')));
  check('8b the ruleSpawn branch return is a capture point (5 stock + 1)',
    count(variant, 'gAuxSpawnSrcUv = srcUv;') === 6
    && variant.includes('uMainRuleTex'),
    String(count(variant, 'gAuxSpawnSrcUv = srcUv;')));
  check('8c the chain inheritance form ignores ruleSpawn (no REP on chain sources)',
    buildAuxInheritFrag({ chain: true, ruleSpawn: true }) === AUX_CHAIN_INHERIT_FRAG
    && !buildAuxInheritFrag({ chain: true, ruleSpawn: true }).includes('uMainRuleTex'));
}

// ── 9. wiring pins ─────────────────────────────────────────
{
  const passes = read('components/gpgpuSimulationPasses.ts');
  check('9a the passes map ruleSpawn to mode 4 and fill uMainRuleTex per frame',
    passes.includes('ruleSpawn: 4')
    && passes.includes('velU.uMainRuleTex.value = mainRuleTex')
    && passes.includes('posU.uMainRuleTex.value = mainRuleTex')
    && passes.includes('inhU.uMainRuleTex.value = mainRuleTex'));
  const scene = read('components/sceneGpgpuSystem.tsx');
  check('9b the scene hands the REP texture to the aux passes',
    scene.includes('mainRuleTex: ruleLiveTexture'));
  const assets = read('components/useGpgpuSimulationAssets.ts');
  check('9c the assets wire the ruleSpawn variant (factory + swap) for level 1 only',
    count(assets, 'auxRuleSpawnLevel1Active(config)') >= 3
    && assets.includes('ruleSpawn: auxRuleSpawnLevel1Active(config)')
    && assets.includes('uMainRuleTex:  { value: null }'));
  const types = read('types/configGpgpu.ts');
  const auxModeLine = types.split('\n').find((l) => l.includes('gpgpuAuxMode:'));
  const aux2ModeLine = types.split('\n').find((l) => l.includes('gpgpuAux2Mode:'));
  check('9d the type union offers ruleSpawn on gpgpuAuxMode only',
    auxModeLine.includes("'ruleSpawn'") && !aux2ModeLine.includes('ruleSpawn'));
  const catalog = read('lib/aiControlCatalog.ts');
  const catAux = catalog.split('\n').find((l) => l.includes("key: 'gpgpuAuxMode'"));
  const catAux2 = catalog.split('\n').find((l) => l.includes("key: 'gpgpuAux2Mode'"));
  check('9e the AI catalog lists ruleSpawn for level 1 only',
    catAux.includes('ruleSpawn') && !catAux2.includes('ruleSpawn'));
  const panel = read('components/controlPanelGlobalDisplayGpgpuForcesAuxColor.tsx');
  check('9f the control panel offers ruleSpawn exactly once (the level-1 select)',
    count(panel, 'value="ruleSpawn"') === 1);
}

// ── 10. REP <-> Aux correspondence (CPU twins) ─────────────
{
  const classified = classifyLiveRules([
    rule('sp1', { type: 'spawn' }, 'vel > 1'),
    rule('k1', { type: 'kill' }, 'vel > 100'),
  ], OPTS);
  const fast = evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 2 } });
  const slow = evaluateLiveRuleStep(classified, { slots: [], vars: { vel: 0.5 } });
  check('10a a matched candidate spawns when the gate roll passes',
    auxRuleSpawnGate(fast.mask, 0.2, 1) === true);
  check('10b the same candidate is thinned when the roll fails the cap',
    auxRuleSpawnGate(fast.mask, 0.8, 0.5) === false);
  check('10c an unmatched candidate never spawns, even on a zero roll',
    auxRuleSpawnGate(slow.mask, 0.0, 1) === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
