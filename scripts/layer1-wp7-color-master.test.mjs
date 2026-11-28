// Layer 1 WP7 Phase A — Colour master switch
// (Layer 0 decision, item 4: colour is an on/off feature,
// default OFF; with colour off the draw must be completely
// identical to the legacy monochrome rendering).
//
// The master key gpgpuColorMasterEnabled sits in the config
// resolution layer (lib/appStateConfigNormalization.ts:
// resolveColorMaster), in front of every colour feature's
// own key — velocity / age / gradient / attribute / group /
// rigid-cluster colour and the aux inheritance colour mix.
// The draw variant predicates in useGpgpuDrawAssets read
// the resolved config, so the string variants that colour
// can stand (rigid cluster colour on the points draw, aux
// inheritance colour on the aux draw) can never stand
// while the master is off.
//
// What is pinned here (node side):
//  (a) Stock identity: the all-off points / aux draw
//      strings keep their pre-WP7 sha256 pins (the points
//      pins are the same ones stage4-sprite-frame-s3 pins).
//  (b) Resolution semantics: master off forces every
//      colour feature off in the resolved config and
//      leaves non-colour fields (incl. the gpgpuColor
//      tint) untouched; master on returns the config
//      untouched; an already-off config resolves to itself.
//  (c) The core byte-identity: master OFF + every
//      individual colour key ON still produces the stock
//      draw strings through the production composition
//      (resolve -> predicates -> builders), for both the
//      points draw and the aux draw, and likewise through
//      normalizeConfig.
//  (d) Master ON restores the legacy behaviour exactly:
//      the colour variants stand and the strings equal
//      the ones the unresolved config produces.
//  (e) Key registration: the master key defaults to
//      false and is present in the validate-keys
//      fingerprint record.
//  (f) Wiring: useGpgpuDrawAssets routes its variant
//      predicates through the resolved config and both
//      variant-swap effects depend on the master key.
//  (g) Runtime gate (Phase A follow-up): the per-frame
//      uniform sync (syncVisualUniforms in
//      gpgpuVisualUpdates.ts) resolves the config once at
//      its entry, so the colour uniforms it writes every
//      frame (velocity / age / gradient / attribute /
//      group / rigid-cluster colour) also sit under the
//      master — a live panel edit that flips only the
//      master cannot leave colour standing through the
//      uniform path. Pinned by source inspection of the
//      sync plus a replication of its colour uniform
//      expressions over resolved configs.
// The real-GPU appearance check (that colour-off renders
// are visually identical) is a gate-side item, NOT judged
// here — this file pins the string/resolution level.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7a-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Stock draw-string pins, measured on the tree before WP7
// Phase A (the builders are untouched by this phase; the
// points pins match stage4-sprite-frame-s3's stock pins).
const STOCK_VERT_SHA256 = '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529';
const STOCK_FRAG_SHA256 = 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c';
const STOCK_AUX_VERT_SHA256 = '0932ceb93a351e2922697075e070c42682555ac53e85ce35e0db0d5705becdce';
const STOCK_AUX_FRAG_SHA256 = 'a5d97b8366eec57c24959e8d18c3d5aaa3586960fedbf8cf4db4b5e2b153c6b6';
// Variant pins (single colour variant standing, measured
// on the same untouched tree).
// CLUSTER_VERT_SHA256 re-pinned 2026-11-29 (第45期統合):
// the integrated tree's buildDrawVert({clusterColor:true})
// output was verified byte-identical to the product tree
// (v2.26.0) output; the only diff against the layer-1
// lineage string is the cluster colour LUT divisor
// (64.0 → 256.0, the product's rigid-body max-256 change).
const CLUSTER_VERT_SHA256 = 'd234281adafbc9638f8c92f152c2731909dc374262119b7f3cafc5c031f9e9ba';
const INHERIT_AUX_VERT_SHA256 = '0d1a37448ec0e02d25a201acc4a73476866fb1dfc88d288108241bcbb642a39c';

await build({
  stdin: {
    contents: `
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { normalizeConfig, resolveColorMaster, colorMasterEnabled, COLOR_MASTER_FEATURE_KEYS } from './lib/appStateConfigNormalization.ts';
      export { buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { buildAuxDrawVert, buildAuxDrawFrag } from './components/gpgpuShaderAux.ts';
      export { vellumCrackVariantOn, rigidClusterColorVariantOn, shadowMapVariantOn, shadowTunnelVariantOn, liveRuleDisplayVariantOn, lightUnitsVariantOn, spinChannelVariantOn, spriteFrameChannelVariantOn, ageFreeSizeVariantOn, ageFreeOpacityVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { mergedSupplyActive } from './lib/gpgpuMergedSupply.ts';
      export { auxInheritColorActive } from './lib/auxInherit.ts';
      export { resolveAttrConsumers } from './lib/gpgpuAttributes.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    DEFAULT_CONFIG, normalizeConfig, resolveColorMaster, colorMasterEnabled,
    COLOR_MASTER_FEATURE_KEYS, buildDrawVert, buildDrawFrag,
    buildAuxDrawVert, buildAuxDrawFrag,
    vellumCrackVariantOn, rigidClusterColorVariantOn, shadowMapVariantOn,
    shadowTunnelVariantOn, liveRuleDisplayVariantOn, lightUnitsVariantOn,
    spinChannelVariantOn, spriteFrameChannelVariantOn, ageFreeSizeVariantOn,
    ageFreeOpacityVariantOn, mergedSupplyActive, auxInheritColorActive,
    resolveAttrConsumers,
  } = m;

  // The production composition, mirroring useGpgpuDrawAssets:
  // predicates over a config, builders over the predicates.
  const TEX = 256;
  const pointsVert = (cfg) => buildDrawVert({
    vellumCrack: vellumCrackVariantOn(cfg),
    clusterColor: rigidClusterColorVariantOn(cfg),
    shadowMap: shadowMapVariantOn(cfg),
    shadowTunnel: shadowTunnelVariantOn(cfg),
    ruleDisplay: liveRuleDisplayVariantOn(cfg),
    ruleDisplayMerged: mergedSupplyActive(cfg, TEX),
    lightUnits: lightUnitsVariantOn(cfg),
    spinChannel: spinChannelVariantOn(cfg),
    spriteFrameChannel: spriteFrameChannelVariantOn(cfg),
    ageFreeSize: ageFreeSizeVariantOn(cfg),
  });
  const pointsFrag = (cfg) => buildDrawFrag({
    vellumCrack: vellumCrackVariantOn(cfg),
    clusterColor: rigidClusterColorVariantOn(cfg),
    shadowMap: shadowMapVariantOn(cfg),
    spinChannel: spinChannelVariantOn(cfg),
    spriteFrameChannel: spriteFrameChannelVariantOn(cfg),
    ageFreeOpacity: ageFreeOpacityVariantOn(cfg),
  });
  const auxVert = (cfg) => buildAuxDrawVert({ shadowMap: shadowMapVariantOn(cfg), inherit: auxInheritColorActive(cfg) });
  const auxFrag = (cfg) => buildAuxDrawFrag({ shadowMap: shadowMapVariantOn(cfg), inherit: auxInheritColorActive(cfg) });
  // The hook's path: predicates read the resolved config.
  const hookVert = (cfg) => pointsVert(resolveColorMaster(cfg));
  const hookFrag = (cfg) => pointsFrag(resolveColorMaster(cfg));
  const hookAuxVert = (cfg) => auxVert(resolveColorMaster(cfg));
  const hookAuxFrag = (cfg) => auxFrag(resolveColorMaster(cfg));

  const cfg = (patch) => ({ ...DEFAULT_CONFIG, ...patch });
  // Every individual colour feature on, master absent (off).
  const ALL_COLOR_ON = {
    gpgpuVelColorEnabled: true,
    gpgpuAgeColorEnabled: true,
    gpgpuGradEnabled: true,
    gpgpuAttrColorEnabled: true,
    gpgpuGroupColorEnabled: true,
    gpgpuRigidClusterColorEnabled: true,
    gpgpuRigidEnabled: true, // cluster colour's solver half
    gpgpuAuxInheritColor: 0.8, // aux inheritance colour mix
    gpgpuAuxInheritSlots: 1,
  };

  // ── (a) stock identity ─────────────────────────────────
  check('stock points vert pin', sha256(pointsVert(cfg({}))) === STOCK_VERT_SHA256, sha256(pointsVert(cfg({}))));
  check('stock points frag pin', sha256(pointsFrag(cfg({}))) === STOCK_FRAG_SHA256, sha256(pointsFrag(cfg({}))));
  check('stock aux vert pin', sha256(auxVert(cfg({}))) === STOCK_AUX_VERT_SHA256, sha256(auxVert(cfg({}))));
  check('stock aux frag pin', sha256(auxFrag(cfg({}))) === STOCK_AUX_FRAG_SHA256, sha256(auxFrag(cfg({}))));

  // ── (e) key registration ───────────────────────────────
  check('master key defaults to false', DEFAULT_CONFIG.gpgpuColorMasterEnabled === false);
  check('feature key list is the seven colour keys',
    COLOR_MASTER_FEATURE_KEYS.length === 7
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuVelColorEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuAgeColorEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuGradEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuAttrColorEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuGroupColorEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuRigidClusterColorEnabled')
      && COLOR_MASTER_FEATURE_KEYS.includes('gpgpuAuxInheritColor'),
    COLOR_MASTER_FEATURE_KEYS.join(','));
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts', 'validate-keys.fingerprint.json'), 'utf8'));
  check('fingerprint record carries the master key',
    record.keys.includes('gpgpuColorMasterEnabled') && record.keyCount === record.keys.length,
    `keyCount=${record.keyCount}`);

  // ── (b) resolution semantics ───────────────────────────
  check('default config resolves to itself', resolveColorMaster(DEFAULT_CONFIG) === DEFAULT_CONFIG);
  check('master off reported', colorMasterEnabled(cfg({})) === false && colorMasterEnabled(cfg({ gpgpuColorMasterEnabled: true })) === true);
  const resolvedOff = resolveColorMaster(cfg(ALL_COLOR_ON));
  check('master off forces every colour feature off',
    resolvedOff.gpgpuVelColorEnabled === false
      && resolvedOff.gpgpuAgeColorEnabled === false
      && resolvedOff.gpgpuGradEnabled === false
      && resolvedOff.gpgpuAttrColorEnabled === false
      && resolvedOff.gpgpuGroupColorEnabled === false
      && resolvedOff.gpgpuRigidClusterColorEnabled === false
      && resolvedOff.gpgpuAuxInheritColor === 0);
  check('master off leaves non-colour fields untouched',
    resolvedOff.gpgpuColor === DEFAULT_CONFIG.gpgpuColor
      && resolvedOff.gpgpuAuxColor === DEFAULT_CONFIG.gpgpuAuxColor
      && resolvedOff.gpgpuRigidEnabled === true
      && resolvedOff.gpgpuAuxInheritSlots === 1
      && resolvedOff.gpgpuVelColorHueMin === DEFAULT_CONFIG.gpgpuVelColorHueMin);
  const masterOnCfg = cfg({ ...ALL_COLOR_ON, gpgpuColorMasterEnabled: true });
  check('master on returns the config untouched', resolveColorMaster(masterOnCfg) === masterOnCfg);

  // ── (c) core byte-identity: master off, colour keys on ─
  const allOnCfg = cfg(ALL_COLOR_ON);
  check('sanity: unresolved all-on stands the cluster variant',
    rigidClusterColorVariantOn(allOnCfg) === true && auxInheritColorActive(allOnCfg) === true);
  check('master off + colour on: points vert is stock', sha256(hookVert(allOnCfg)) === STOCK_VERT_SHA256, sha256(hookVert(allOnCfg)));
  check('master off + colour on: points frag is stock', sha256(hookFrag(allOnCfg)) === STOCK_FRAG_SHA256, sha256(hookFrag(allOnCfg)));
  check('master off + colour on: aux vert is stock', sha256(hookAuxVert(allOnCfg)) === STOCK_AUX_VERT_SHA256, sha256(hookAuxVert(allOnCfg)));
  check('master off + colour on: aux frag is stock', sha256(hookAuxFrag(allOnCfg)) === STOCK_AUX_FRAG_SHA256, sha256(hookAuxFrag(allOnCfg)));
  const normalizedAllOn = normalizeConfig(ALL_COLOR_ON);
  check('normalizeConfig resolves colour off under master off',
    normalizedAllOn.gpgpuColorMasterEnabled === false
      && normalizedAllOn.gpgpuVelColorEnabled === false
      && normalizedAllOn.gpgpuGradEnabled === false
      && normalizedAllOn.gpgpuAuxInheritColor === 0);
  check('normalized all-on: points vert is stock', sha256(pointsVert(normalizedAllOn)) === STOCK_VERT_SHA256);
  check('normalized all-on: aux vert is stock', sha256(auxVert(normalizedAllOn)) === STOCK_AUX_VERT_SHA256);

  // ── (d) master on restores legacy variants ─────────────
  check('master on: cluster vert equals the legacy variant pin', sha256(hookVert(masterOnCfg)) === CLUSTER_VERT_SHA256, sha256(hookVert(masterOnCfg)));
  check('master on: points vert equals unresolved composition', hookVert(masterOnCfg) === pointsVert(masterOnCfg));
  check('master on: points frag equals unresolved composition', hookFrag(masterOnCfg) === pointsFrag(masterOnCfg));
  check('master on: aux vert equals the legacy inherit pin', sha256(hookAuxVert(masterOnCfg)) === INHERIT_AUX_VERT_SHA256, sha256(hookAuxVert(masterOnCfg)));
  check('master on: aux frag equals unresolved composition', hookAuxFrag(masterOnCfg) === auxFrag(masterOnCfg));
  const normalizedMasterOn = normalizeConfig({ ...ALL_COLOR_ON, gpgpuColorMasterEnabled: true });
  check('normalizeConfig keeps colour on under master on',
    normalizedMasterOn.gpgpuVelColorEnabled === true
      && normalizedMasterOn.gpgpuGradEnabled === true
      && normalizedMasterOn.gpgpuAuxInheritColor === 0.8);
  check('normalizeConfig default: master key present and off',
    normalizeConfig({}).gpgpuColorMasterEnabled === false);

  // ── (f) wiring ─────────────────────────────────────────
  const hookSource = readFileSync(join(ROOT, 'components', 'useGpgpuDrawAssets.ts'), 'utf8');
  check('draw assets resolve the config through the master',
    hookSource.includes('const drawConfig = resolveColorMaster(config);'));
  check('no variant predicate reads the raw config',
    !hookSource.includes('VariantOn(config)') && !hookSource.includes('auxInheritColorActive(config)'),
    '');
  check('both variant-swap effects depend on the master key',
    (hookSource.match(/config\.gpgpuColorMasterEnabled/g) || []).length >= 2,
    `${(hookSource.match(/config\.gpgpuColorMasterEnabled/g) || []).length}`);

  // ── (g) runtime gate: syncVisualUniforms ───────────────
  const visualSource = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
  const syncSource = visualSource.slice(visualSource.indexOf('export function syncVisualUniforms'));
  check('visual updates import the master resolution',
    visualSource.includes("import { resolveColorMaster } from '../lib/appStateConfigNormalization';"));
  check('syncVisualUniforms resolves the config at its entry',
    syncSource.includes('const config = resolveColorMaster(args.config);'));
  check('syncVisualUniforms no longer destructures the raw config',
    !syncSource.includes('const { config,'));
  check('the resolution is the only raw-config read in the sync',
    (syncSource.match(/args\.config/g) || []).length === 1,
    `${(syncSource.match(/args\.config/g) || []).length}`);
  check('resolution precedes the colour uniform writes',
    syncSource.indexOf('const config = resolveColorMaster(args.config);') >= 0
      && syncSource.indexOf('const config = resolveColorMaster(args.config);') < syncSource.indexOf('resolveAttrConsumers(config)')
      && syncSource.indexOf('const config = resolveColorMaster(args.config);') < syncSource.indexOf('uVelColorEnabled'));
  check('colour uniforms read the resolved local config',
    syncSource.includes('drawMat.uniforms.uVelColorEnabled.value = config.gpgpuVelColorEnabled;')
      && syncSource.includes('drawMat.uniforms.uAgeColorEnabled.value = config.gpgpuAgeColorEnabled;')
      && syncSource.includes('drawMat.uniforms.uGradEnabled.value = config.gpgpuGradEnabled;')
      && syncSource.includes('const attrConsumers = resolveAttrConsumers(config);')
      && syncSource.includes('&& !!config.gpgpuRigidClusterColorEnabled && !!config.gpgpuRigidEnabled;'));
  // The config-side colour uniform values the sync computes,
  // replicated expression-for-expression with every texture
  // present (the strongest case for colour standing): the
  // velocity / age / gradient values are the feature keys
  // themselves, the attribute / group values ride
  // resolveAttrConsumers exactly as in the sync, and the
  // cluster value is its clusterOn expression with both
  // textures non-null.
  const colourUniformValues = (c) => {
    const consumers = resolveAttrConsumers(c);
    return {
      vel: !!c.gpgpuVelColorEnabled,
      age: !!c.gpgpuAgeColorEnabled,
      grad: !!c.gpgpuGradEnabled,
      attr: !!consumers.colorActive,
      group: !!consumers.groupColorActive,
      cluster: !!c.gpgpuRigidClusterColorEnabled && !!c.gpgpuRigidEnabled,
    };
  };
  const sameValues = (a, b) => Object.keys(b).every((k) => a[k] === b[k]);
  const ALL_ON = { vel: true, age: true, grad: true, attr: true, group: true, cluster: true };
  const ALL_OFF = { vel: false, age: false, grad: false, attr: false, group: false, cluster: false };
  // Every colour consumer made activatable: colour slot
  // names present and a group reference set.
  const gateCfg = (patch) => cfg({
    ...ALL_COLOR_ON,
    gpgpuAttrNames: ['colorR', 'colorG', 'colorB', 'd'],
    gpgpuGroupRef: 'g1',
    ...patch,
  });
  check('sanity: unresolved all-on config stands every colour uniform value',
    sameValues(colourUniformValues(gateCfg({})), ALL_ON),
    JSON.stringify(colourUniformValues(gateCfg({}))));
  check('master off + colour keys on: every colour uniform value is off',
    sameValues(colourUniformValues(resolveColorMaster(gateCfg({}))), ALL_OFF),
    JSON.stringify(colourUniformValues(resolveColorMaster(gateCfg({})))));
  check('master on: colour uniform values equal the unresolved ones',
    sameValues(colourUniformValues(resolveColorMaster(gateCfg({ gpgpuColorMasterEnabled: true }))), ALL_ON),
    JSON.stringify(colourUniformValues(resolveColorMaster(gateCfg({ gpgpuColorMasterEnabled: true })))));
} finally {
  unlinkSync(BUNDLE);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
