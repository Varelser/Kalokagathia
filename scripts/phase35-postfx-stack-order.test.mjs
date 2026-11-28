// Phase 35 (TD §7 stage 3) — user-declared PostFx stage
// order. The stage adds a declaration layer over the
// profile orders in lib/postFxStack.ts: the
// postFxStackOrder key ('' = profile order). This test
// pins: the metadata covers exactly the 28 stages, every
// profile order is a permutation of the same set, an unset
// key resolves to the profile order and the ordered active
// list matches the legacy profile filtering, a custom
// order is honoured with total correction, and the
// serialize/normalize round-trip holds.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p35-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { getPostFxProfileOrder, normalizePostFxStackOrder, resolvePostFxStackOrder, serializePostFxStackOrder, isProfilePostFxStackOrder, getActivePostFxStageIds, getOrderedActivePostFxStageIds } from './lib/postFxStack.ts';
      export { POST_FX_STAGE_META } from './lib/postFxStageMeta.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const {
  getPostFxProfileOrder, normalizePostFxStackOrder, resolvePostFxStackOrder,
  serializePostFxStackOrder, isProfilePostFxStackOrder, getActivePostFxStageIds,
  getOrderedActivePostFxStageIds, POST_FX_STAGE_META, DEFAULT_CONFIG,
} = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const PROFILES = ['manual', 'touch-feedback', 'particular-glow', 'retro-feedback', 'dream-smear'];
const MANUAL = getPostFxProfileOrder('manual');

// --- set coverage -------------------------------------------------------
check('profile orders are 28-stage permutations of one set',
  PROFILES.every((p) => {
    const order = getPostFxProfileOrder(p);
    return order.length === 28 && new Set(order).size === 28
      && [...order].sort().join(',') === [...MANUAL].sort().join(',');
  }));
check('meta covers exactly the 28 stages',
  POST_FX_STAGE_META.length === 28
  && POST_FX_STAGE_META.map((m) => m.id).sort().join(',') === [...MANUAL].sort().join(','));

// --- identity with the key unset ----------------------------------------
check('default config: postFxStackOrder is empty and resolves to the profile order',
  DEFAULT_CONFIG.postFxStackOrder === ''
  && resolvePostFxStackOrder(DEFAULT_CONFIG).join(',') === MANUAL.join(','));
{
  // A config with several stages active: the ordered list
  // must equal the legacy "profile order filtered to
  // active" computed independently here.
  const cfg = {
    ...DEFAULT_CONFIG,
    postBloomEnabled: true, postNoiseEnabled: true, postVignetteEnabled: true,
    postGlitchEnabled: true, postExposure: 1.4,
  };
  const active = new Set(getActivePostFxStageIds(cfg));
  const legacy = MANUAL.filter((s) => active.has(s));
  check('unset key: ordered active list equals legacy profile filtering',
    getOrderedActivePostFxStageIds(cfg).join(',') === legacy.join(',')
    && legacy.length >= 4, legacy.join(','));
  const retro = { ...cfg, postFxStackProfile: 'retro-feedback' };
  const retroActive = new Set(getActivePostFxStageIds(retro));
  check('unset key: a non-default profile is honoured as before',
    getOrderedActivePostFxStageIds(retro).join(',')
    === getPostFxProfileOrder('retro-feedback').filter((s) => retroActive.has(s)).join(','));
}

// --- custom order ---------------------------------------------------------
{
  const cfg = {
    ...DEFAULT_CONFIG,
    postBloomEnabled: true, postNoiseEnabled: true, postVignetteEnabled: true,
    postGlitchEnabled: true, postExposure: 1.4,
  };
  const active = new Set(getActivePostFxStageIds(cfg));
  const custom = [...MANUAL].reverse();
  const withCustom = { ...cfg, postFxStackOrder: custom.join(',') };
  check('custom order: ordered active list follows the declared order',
    getOrderedActivePostFxStageIds(withCustom).join(',')
    === custom.filter((s) => active.has(s)).join(','));
  check('custom order wins over the profile',
    resolvePostFxStackOrder(withCustom).join(',') === custom.join(',')
    && !isProfilePostFxStackOrder(withCustom.postFxStackOrder, 'manual'));
}
check('total correction: unknown, duplicate and missing ids',
  normalizePostFxStackOrder('bloom,bogus-id,bloom,noise', MANUAL).join(',')
  === ['bloom', 'noise', ...MANUAL.filter((s) => s !== 'bloom' && s !== 'noise')].join(','));
check('serialize: profile order stores as empty, custom order round-trips',
  serializePostFxStackOrder(MANUAL, 'manual') === ''
  && serializePostFxStackOrder('', 'manual') === ''
  && normalizePostFxStackOrder(
    serializePostFxStackOrder([...MANUAL].reverse(), 'manual'),
    MANUAL,
  ).join(',') === [...MANUAL].reverse().join(','));
check('serialize against another profile uses that profile as the base',
  serializePostFxStackOrder(getPostFxProfileOrder('dream-smear'), 'dream-smear') === ''
  && serializePostFxStackOrder(getPostFxProfileOrder('dream-smear'), 'manual') !== '');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
