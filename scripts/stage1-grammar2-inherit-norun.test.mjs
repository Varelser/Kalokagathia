// Grammar 2.0 stage 1 — spawn inheritance colour silently
// broken on an inheritance-only config (real-GPU gate
// finding, C4: with InheritColor=1 the children/grandchildren
// did not shift toward the parent's red slots at all; every
// channel's lit slightly DECREASED vs the off probe, the
// signature of mixing toward black).
//
// Root cause: the level-1 inheritance write reads the
// parent's attribute slots 0/1/2 out of the final attribute
// texture (the scene's simAttrTex) and the passes suppress
// the write while that texture is null
// (`if (inherit && inherit.mainAttrTex)`). The attribute
// bake in useGpgpuRuntime stood only for the legacy
// consumers, an effective baked rule list, or the live REP;
// inheritance was never registered as a consumer, so the
// C4 config (attribute expressions set, no consumer key, no
// rules) left attrTexRef null, the inheritance texture
// stayed all-zero, and the draw colour mix blended the
// children toward (0,0,0).
//
// The fix: useGpgpuRuntime resolves the shared predicate
// auxInheritAttrBakeStands (lib/auxInherit.ts) — colour mix
// active AND an aux mode selected, the exact conditions
// under which the write can run and its product is read —
// and stands the bake whenever it holds. With inheritance
// unset (colour mix 0, the default) the predicate is false
// and the standing condition reduces exactly to the
// pre-fix one.
//
// Cases:
//  1 the gate regression chain, end to end on the lib
//    layer: the C4 config's preconditions hold (no legacy
//    consumer, no baked rules, no live REP), the PRE-fix
//    standing condition is false (the bug), the POST-fix
//    condition is true; the colour-off probe stands nothing
//  2 predicate precision: the default config, colour on
//    with mode 'none', slots off, and velocity-scale-only
//    configs do NOT stand the bake; every event mode with
//    the colour mix on does
//  3 identity: with inheritance unset (or its near-miss
//    states), the standing condition equals the pre-fix
//    condition across consumer combinations
//  4 wiring pin: the runtime resolves inheritAttrStands
//    through auxInheritAttrBakeStands and the
//    attrSignature condition includes it; the scene /
//    passes consumption side is unchanged
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1inherit-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
      export { resolveAttrConsumers } from './lib/gpgpuAttributes.ts';
      export { resolveParticleRules } from './lib/gpgpuParticleRules.ts';
      export { liveRuleEvalStands } from './lib/gpgpuParticleRulesLive.ts';
      export { parseGpgpuGroups } from './lib/gpgpuGroups.ts';
      export { auxInheritSlotsEnabled, auxInheritColorActive, auxInheritAttrBakeStands } from './lib/auxInherit.ts';
      export { resolveAuxChainLevels } from './lib/auxChain.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  APP_STATE_DEFAULT_GPGPU, resolveAttrConsumers, resolveParticleRules,
  liveRuleEvalStands, parseGpgpuGroups,
  auxInheritSlotsEnabled, auxInheritColorActive, auxInheritAttrBakeStands,
  resolveAuxChainLevels,
} = lib;

// The scene's own build options for the REP fragment (the
// pre-fix standing condition includes the REP predicate
// since the earlier fix; this test's pre-fix baseline is
// the condition as it stood after that fix).
const sceneOptions = (cfg) => ({
  names: cfg.gpgpuAttrNames,
  names2: cfg.gpgpuAttrNames2,
  groupDefs: parseGpgpuGroups(cfg.gpgpuGroupsData ?? ''),
  densityAvailable: true,
});

// The standing conditions, transcribed from useGpgpuRuntime:
// pre-fix (legacy consumers, baked rules, or the live REP)
// and post-fix (plus the inheritance predicate).
const standsPreFix = (cfg) => resolveAttrConsumers(cfg).anyActive
  || resolveParticleRules(cfg.gpgpuParticleRules ?? '').length > 0
  || liveRuleEvalStands(cfg.gpgpuParticleRulesLive ?? '', sceneOptions(cfg));
const standsPostFix = (cfg) => standsPreFix(cfg) || auxInheritAttrBakeStands(cfg);

// The gate C4 base: app defaults for every key the harness
// does not name (batch_common BASE), plus the INH_BASE keys
// of gate_batch_c_re2.mjs verbatim.
const BASE_CFG = { ...APP_STATE_DEFAULT_GPGPU };
const INH_BASE = {
  ...BASE_CFG,
  gpgpuGravity: 0.35, gpgpuTurbulence: 0.3, gpgpuCount: 16384,
  gpgpuAgeEnabled: true, gpgpuAgeMax: 4, gpgpuAgeFadeIn: 0.08, gpgpuAgeFadeOut: 0.25,
  gpgpuAttrExprs: ['1', '0', '0', ''],
  gpgpuAuxMode: 'deathBurst', gpgpuAuxCount: 8192, gpgpuAuxIntensity: 1.6,
  gpgpuAuxLife: 0.8, gpgpuAuxSpeed: 30, gpgpuAuxSize: 1.2, gpgpuAuxColor: '#00ff00',
  gpgpuAuxDepth: 2, gpgpuAux2Mode: 'deathBurst', gpgpuAux2Count: 8192,
  gpgpuAux2Life: 0.8, gpgpuAux2Speed: 30, gpgpuAux2Size: 1.2, gpgpuAux2Color: '#0000ff',
  gpgpuAuxInheritSlots: 1,
};
const INH_ON = { ...INH_BASE, gpgpuAuxInheritColor: 1 };
const INH_OFF = { ...INH_BASE, gpgpuAuxInheritColor: 0 };

// --- 1. the gate regression chain -------------------------------------
{
  check('1 [c4-on] bug preconditions: no legacy consumer, no baked rules, no live REP',
    !resolveAttrConsumers(INH_ON).anyActive
    && resolveParticleRules(INH_ON.gpgpuParticleRules ?? '').length === 0
    && !liveRuleEvalStands(INH_ON.gpgpuParticleRulesLive ?? '', sceneOptions(INH_ON)));
  check('1 [c4-on] inheritance colour mix is active (the reader exists)',
    auxInheritSlotsEnabled(INH_ON) && auxInheritColorActive(INH_ON));
  check('1 [c4-on] chain level 2 stands (grandchildren read the copied texels)',
    resolveAuxChainLevels(INH_ON).some((l) => l.level === 2));
  check('1 [c4-on] PRE-fix condition leaves the bake down (the bug)',
    standsPreFix(INH_ON) === false);
  check('1 [c4-on] POST-fix condition stands the bake -> simAttrTex non-null -> inherit write runs',
    standsPostFix(INH_ON) === true);
  check('1 [c4-off] colour mix off: predicate false, bake stays down (nothing reads the texture)',
    auxInheritAttrBakeStands(INH_OFF) === false && standsPostFix(INH_OFF) === false);
}

// --- 2. predicate precision -------------------------------------------
{
  const cases = {
    'app default (slots on, colour 0, mode none)': [{ ...BASE_CFG }, false],
    'colour on, mode none (write pass cannot run)': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'none' }, false],
    'colour on, deathBurst': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'deathBurst' }, true],
    'colour on, bounceSplash': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'bounceSplash' }, true],
    'colour on, sparkTrail': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'sparkTrail' }, true],
    'colour on, birthBurst': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'birthBurst' }, true],
    'colour on (partial 0.5), emit (1D-2)': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 0.5, gpgpuAuxMode: 'emit' }, true],
    'colour on, ruleSpawn (1D-3)': [
      { ...BASE_CFG, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'ruleSpawn' }, true],
    'slots off, colour on, sparkTrail (draw variant off too)': [
      { ...BASE_CFG, gpgpuAuxInheritSlots: 0, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'sparkTrail' }, false],
    'vel scale 2 only (colour 0): not an attr consumer': [
      { ...BASE_CFG, gpgpuAuxInheritVelScale: 2, gpgpuAuxMode: 'sparkTrail' }, false],
    'vel scale 0 only (colour 0): not an attr consumer': [
      { ...BASE_CFG, gpgpuAuxInheritVelScale: 0, gpgpuAuxMode: 'sparkTrail' }, false],
  };
  for (const [name, [cfg, expected]] of Object.entries(cases)) {
    check(`2 [${name}] stands === ${expected}`,
      auxInheritAttrBakeStands(cfg) === expected);
    // The predicate must never stand the bake without the
    // reader (the draw colour variant) existing.
    check(`2 [${name}] stands implies the colour-mix reader is active`,
      !auxInheritAttrBakeStands(cfg) || auxInheritColorActive(cfg));
  }
}

// --- 3. identity with inheritance unset --------------------------------
{
  const liveRule = (id, action, condition = '', extra = {}) => ({
    id, enabled: true, target: { type: 'all' }, condition, action, ...extra,
  });
  const combos = {
    'neither consumer nor rules': { ...BASE_CFG },
    'legacy size consumer on': { ...BASE_CFG, gpgpuAttrSizeSlot: 0, gpgpuAttrSizeAmount: 0.5 },
    'legacy group consumer on': { ...BASE_CFG, gpgpuGroupEnabled: true },
    'baked rules on': {
      ...BASE_CFG,
      gpgpuParticleRules: JSON.stringify([liveRule('b1', { type: 'kill' }, '')]),
    },
    'live rules on': {
      ...BASE_CFG,
      gpgpuParticleRulesLive: JSON.stringify([liveRule('k1', { type: 'kill' }, '')]),
    },
    'aux running, inheritance unset (colour 0, vel scale 1)': {
      ...BASE_CFG, gpgpuAuxMode: 'sparkTrail', gpgpuAuxCount: 8192,
    },
    'colour on but mode none': { ...BASE_CFG, gpgpuAuxInheritColor: 1 },
    'slots off, colour on, sparkTrail': {
      ...BASE_CFG, gpgpuAuxInheritSlots: 0, gpgpuAuxInheritColor: 1, gpgpuAuxMode: 'sparkTrail',
    },
    'vel scale only, sparkTrail': {
      ...BASE_CFG, gpgpuAuxInheritVelScale: 2, gpgpuAuxMode: 'sparkTrail',
    },
  };
  for (const [name, cfg] of Object.entries(combos)) {
    check(`3 [${name}] inherit unset: post-fix condition === pre-fix condition`,
      standsPostFix(cfg) === standsPreFix(cfg),
      `pre=${standsPreFix(cfg)} post=${standsPostFix(cfg)}`);
  }
}

// --- 4. wiring pin ------------------------------------------------------
{
  const src = readFileSync(join(ROOT, 'components', 'useGpgpuRuntime.ts'), 'utf8');
  check('4a runtime imports auxInheritAttrBakeStands from the inherit lib',
    src.includes("import { auxInheritAttrBakeStands, auxInheritSlotsEnabled } from '../lib/auxInherit';"));
  check('4b runtime resolves inheritAttrStands through the shared predicate',
    src.includes('const inheritAttrStands = auxInheritAttrBakeStands(config);'));
  check('4c attrSignature standing condition includes inheritAttrStands',
    src.includes('attrConsumers.anyActive || particleRules.length > 0 || liveRepStands || inheritAttrStands'));
  const passesSrc = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');
  check('4d passes still guard the inherit write on mainAttrTex (the texture this fix stands)',
    passesSrc.includes('if (inherit && inherit.mainAttrTex)'));
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  check('4e scene still feeds simAttrTex as the write\'s mainAttrTex',
    sceneSrc.includes('mainAttrTex: simAttrTex'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
