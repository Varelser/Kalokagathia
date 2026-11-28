// Grammar 2.0 stage 1, external-force general form
// (slice 1C follow-up) — the user's registered custom force
// (the GLSL snippet in gpgpuCustomForceCode) as a live
// force-gate target under REP mask bit 12. Design decision:
// bit 12 (the slot the slice-1C record reserved); see
// kalokagathia-pro/STAGE1_EXTFORCE_IMPL_RECORD.md.
//
// Cases:
//  1 constants + parse/validate: bit 12 = 4096, the full
//    permit is 24351 (7967 at this slice; stage 2 B7's
//    meander permit bit 14 joined it), 'custom' parses as
//    a gate target and unknown targets still drop quietly
//  2 permit semantics on the CPU twin: an unmatched custom
//    gate rule removes bit 12 only; 'all' never restricts
//    custom; custom and G10 gates are independent
//  3 the registered force's own validation discipline
//    (existing custom-force validation: valid ok, forbidden
//    tokens rejected — a broken snippet never activates)
//  4 REP fragment + WGSL twin: fgCustom local, its init
//    follows the restricted table, the mask term is
//    fgCustom * 4096.0 in both twins; the REP targets'
//    initial .r is the new full permit
//  5 velocity consumption: grpCustom local + bit-12
//    extraction in the live segment; the tail injection is
//    wrapped (snapshot + mix by grpCustom) only in the live
//    variant; the historical injection is unchanged without
//    it; no snippet -> nothing to wrap
//  6 identity: default velocity / position strings stay
//    the shipped v2.22.0 strings; the stock strings carry
//    no grpCustom; the registration key's default is ''
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1x-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { parseLiveParticleRules, resolveLiveParticleRules, validateLiveParticleRule, classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment, buildRuleEvalWgsl, liveRulesWgslCoverable, LIVE_RULE_CUSTOM_FORCE_BIT, LIVE_RULE_MASK_FULL_PERMIT } from './lib/gpgpuParticleRulesLive.ts';
      export { validateCustomForceCode, CUSTOM_FORCE_EXAMPLE } from './lib/gpgpuCustomForce.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  parseLiveParticleRules, resolveLiveParticleRules, validateLiveParticleRule,
  classifyLiveRules, evaluateLiveRuleStep, buildRuleEvalFragment,
  buildRuleEvalWgsl, liveRulesWgslCoverable,
  LIVE_RULE_CUSTOM_FORCE_BIT, LIVE_RULE_MASK_FULL_PERMIT,
} = lib;
const { validateCustomForceCode, CUSTOM_FORCE_EXAMPLE } = lib;
const { buildVelocityFragment, SIM_VEL_FRAG, SIM_POS_FRAG } = lib;
const { APP_STATE_DEFAULT_GPGPU } = lib;

const NAMES = ['a', 'b', 'c', 'd'];
const NAMES2 = ['i', 'j', 'k', 'l'];
const OPTS = { names: NAMES, names2: NAMES2, groupDefs: [], densityAvailable: true };
const rule = (id, action, condition = '', target = { type: 'all' }, extra = {}) => ({
  id, enabled: true, target, condition, action, ...extra,
});
const J = (v) => JSON.stringify(v);
const classify = (rules, opts = {}) => classifyLiveRules(resolveLiveParticleRules(J(rules)), { ...OPTS, ...opts });
const ZEROS = [0, 0, 0, 0, 0, 0, 0, 0];
const step = (classified, vars = {}) => evaluateLiveRuleStep(classified, {
  slots: ZEROS,
  vars: { vel: 0, age: 0, rad: 0, t: 0, state: 0, den: 0, sdf: 1e6, ...vars },
});
const hasBit = (mask, bit) => (mask & bit) !== 0;
const SNIPPET = 'vel += vec3(sin(pos.y * 0.05 + uTime), 0.0, cos(pos.x * 0.05)) * 12.0 * uDelta;';

// --- 1. constants + parse/validate ---------------------------------------------
{
  check('1a custom-force bit is 12 (4096); full permit is 24351 (7967 at this slice; stage 2 B7 added the meander permit)',
    LIVE_RULE_CUSTOM_FORCE_BIT === 4096 && LIVE_RULE_MASK_FULL_PERMIT === 24351);
  const parsed = parseLiveParticleRules(J([rule('x', { type: 'force-gate', force: 'custom' })]));
  check("1b force-gate target 'custom' parses and is kept",
    parsed.length === 1 && parsed[0].action.type === 'force-gate' && parsed[0].action.force === 'custom',
    J(parsed));
  const validated = validateLiveParticleRule(rule('x', { type: 'force-gate', force: 'custom' }));
  check('1c validateLiveParticleRule accepts the custom target',
    validated !== null && validated.action.force === 'custom');
  const dropped = parseLiveParticleRules(J([rule('x', { type: 'force-gate', force: 'bogus' })]));
  check('1d an unknown force target still drops the rule quietly',
    dropped.length === 0, J(dropped));
}

// --- 2. permit semantics (CPU twin) ----------------------------------------------
{
  const none = step(classify([]));
  check('2a no rules: every permit stands, custom included (mask 24351)',
    none.mask === 24351, String(none.mask));
  const gated = classify([rule('x', { type: 'force-gate', force: 'custom' }, 'vel > 0.5')]);
  const hit = step(gated, { vel: 1 });
  const miss = step(gated, { vel: 0 });
  check('2b matched custom gate rule keeps bit 12; unmatched loses only bit 12',
    hasBit(hit.mask, 4096) && !hasBit(miss.mask, 4096) && miss.mask === 24351 - 4096,
    `${hit.mask}/${miss.mask}`);
  const allRule = classify([rule('x', { type: 'force-gate', force: 'all' }, 'vel > 100')]);
  const allMiss = step(allRule, { vel: 0 });
  check("2c an 'all' gate rule never restricts custom (unmatched loses the G10 five only)",
    hasBit(allMiss.mask, 4096) && allMiss.mask === 24351 - 31, String(allMiss.mask));
  const both = classify([
    rule('c', { type: 'force-gate', force: 'custom' }, 'vel > 0.5'),
    rule('g', { type: 'force-gate', force: 'gravity' }, 'age > 0.5'),
  ]);
  const bothMiss = step(both, { vel: 0, age: 0 });
  const mixed = step(both, { vel: 1, age: 0 });
  check('2d custom and G10 gates restrict independently',
    bothMiss.mask === 24351 - 4096 - 1 && hasBit(mixed.mask, 4096) && !hasBit(mixed.mask, 1),
    `${bothMiss.mask}/${mixed.mask}`);
}

// --- 3. the registered force's own validation ------------------------------------
{
  check('3a the documented example snippet validates',
    validateCustomForceCode(CUSTOM_FORCE_EXAMPLE).ok === true);
  check('3b a snippet writing gl_FragColor is rejected (never activates)',
    validateCustomForceCode('gl_FragColor = vec4(1.0);').ok === false);
  check('3c a snippet with a preprocessor directive is rejected',
    validateCustomForceCode('#define X 1\nvel += vec3(1.0);').ok === false);
}

// --- 4. REP fragment + WGSL twin + REP initial state ------------------------------
{
  const frag = buildRuleEvalFragment(resolveLiveParticleRules(J([
    rule('x', { type: 'force-gate', force: 'custom' }, 'vel > 0.5'),
  ])), OPTS);
  check('4a REP fragment: fgCustom starts denied for a restricted custom force, mask term present',
    typeof frag === 'string' && frag.includes('float fgCustom = 0.0;') && frag.includes('fgCustom * 4096.0'));
  const fragOpen = buildRuleEvalFragment(resolveLiveParticleRules(J([
    rule('k', { type: 'kill' }),
  ])), OPTS);
  check('4b REP fragment: fgCustom starts permitted when no rule names custom',
    typeof fragOpen === 'string' && fragOpen.includes('float fgCustom = 1.0;'));
  const wgsl = buildRuleEvalWgsl(resolveLiveParticleRules(J([
    rule('x', { type: 'force-gate', force: 'custom' }, 'vel > 0.5'),
  ])), OPTS);
  check('4c WGSL twin: var fgCustom init + identical mask term',
    typeof wgsl === 'string' && wgsl.includes('var fgCustom = 0.0;') && wgsl.includes('fgCustom * 4096.0'));
  check('4d a plain custom gate rule stays WGSL-coverable (the bit is computed; its consumer is WebGL-side)',
    liveRulesWgslCoverable(resolveLiveParticleRules(J([
      rule('x', { type: 'force-gate', force: 'custom' }, 'vel > 0.5'),
    ])), OPTS) === true);
  const passSrc = readFileSync(join(ROOT, 'components', 'gpgpuRuleEvalPass.ts'), 'utf8');
  check('4e REP targets initialise at the new full permit (24351)',
    passSrc.includes('gl_FragColor = vec4(24351.0, 0.0, 0.0, 0.0);'));
}

// --- 5. velocity consumption -------------------------------------------------------
{
  const velLive = buildVelocityFragment('', undefined, { particleRulesLive: true });
  check('5a live segment declares grpCustom and extracts bit 12',
    velLive.includes('float grpCustom = 1.0;')
    && velLive.includes('grpCustom *= mod(floor(liveMask / 4096.0), 2.0);'));
  const stock = buildVelocityFragment(SNIPPET);
  check('5b without the live variant the injection is the historical unwrapped block',
    stock.includes('{ // custom force (user GLSL)') && !stock.includes('velPreCustomForce')
    && stock.includes(SNIPPET));
  const gated = buildVelocityFragment(SNIPPET, undefined, { particleRulesLive: true });
  check('5c live variant wraps the snippet: snapshot, body, mix by grpCustom',
    gated.includes('vec3 velPreCustomForce = vel;')
    && gated.includes(SNIPPET)
    && gated.includes('vel = mix(velPreCustomForce, vel, grpCustom);')
    && gated.indexOf('vec3 velPreCustomForce = vel;') < gated.indexOf(SNIPPET)
    && gated.indexOf(SNIPPET) < gated.indexOf('vel = mix(velPreCustomForce, vel, grpCustom);'));
  check('5d live variant with no snippet wraps nothing',
    !velLive.includes('velPreCustomForce'));
}

// --- 6. identity -------------------------------------------------------------------
{
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  check('6a default velocity string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637',
    sha(SIM_VEL_FRAG));
  check('6b default position string is the shipped v2.25.0 string (統合時点)',
    sha(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49',
    sha(SIM_POS_FRAG));
  check('6c stock strings carry no grpCustom / wrap locals',
    !SIM_VEL_FRAG.includes('grpCustom') && !SIM_VEL_FRAG.includes('velPreCustomForce'));
  check("6d the registration key's default stays '' (no new key added)",
    APP_STATE_DEFAULT_GPGPU.gpgpuCustomForceCode === '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
