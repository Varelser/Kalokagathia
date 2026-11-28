// Layer 1 WP7 Phase C2 — Gaussian splat pool supply.
//
// C1 built the splat primitive with a uniform parameter
// bake and unbound centre / sort uniforms. C2 completes the
// pool supply:
//  (1) the depth-sort pass is force-run while splats are on
//      (runDepthSortPass gains a forceSort predicate, passed
//      from the single call site in sceneGpgpuSystem.tsx);
//  (2) syncVisualUniforms supplies the splat material per
//      frame (centre / sort / tint / multipliers, the shared
//      attribute colour drive, the orientation texture
//      override) — gated on the splat key, nothing written
//      while it is off;
//  (3) the parameter bake gains per-particle sources
//      (lib/gpgpuSplatSupply.ts): attribute slots resolved
//      via resolveAttrNameSlot multiply scale / opacity, and
//      the reserved scale source 'velocity' aligns each
//      splat's quaternion to the seeded velocity field with
//      the streak-form elongation;
//  (4) the attribute colour drive in the splat vertex reads
//      the Phase CL colour slots; the supply resolves it
//      from the colour-master-resolved config, so master off
//      leaves the single tint (the three-stage colour rule).
//
// What is pinned here (node side): the lib twins and the
// supply adapter against independently rebuilt bakes, the
// colour-master resolution logic, the stock points strings /
// default plan identity, and source pins for the wiring.
// The real-GPU appearance (ellipse look, sort order on
// screen, orient override on screen) is a gate-side item,
// NOT judged here.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7c2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const arrApprox = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => approx(v, b[i], eps));
const arrEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Stock points-draw pins (pre-WP7; the builders are untouched
// by this phase — the splat is a separate material).
const STOCK_VERT_SHA256 = '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529';
const STOCK_FRAG_SHA256 = 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c';
// Splat VERT pin after the C2 attribute colour chunk (the
// pin the C1 test now carries).
// Re-pinned 2026-11-28 (Phase C3): the columns DC colour
// chunk (uSplatColorTex / uSplatColorEnabled) was added —
// the constant keeps its name and intent (the current splat
// VERT pin), the value follows the C3 string.
const SPLAT_VERT_SHA256_C2 = 'c5792ac88f553f01692f55055efce202bea44431f5a36f67cfef11fb49e80f7f';

await build({
  stdin: {
    contents: `
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { vellumCrackVariantOn, rigidClusterColorVariantOn, shadowMapVariantOn, shadowTunnelVariantOn, liveRuleDisplayVariantOn, lightUnitsVariantOn, spinChannelVariantOn, spriteFrameChannelVariantOn, ageFreeSizeVariantOn, ageFreeOpacityVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { mergedSupplyActive } from './lib/gpgpuMergedSupply.ts';
      export { SPLAT_VERT } from './components/gpgpuShaderSplats.ts';
      export { buildSplatParamData, splatQuatFromDirection, splatStretchMultiplier } from './lib/gpgpuSplat.ts';
      export { buildSplatParamSupply, SPLAT_SCALE_VELOCITY_SOURCE } from './lib/gpgpuSplatSupply.ts';
      export { buildAttributeData, buildAttributeDataExt, normalizeAttrNames, normalizeAttrNames2, normalizeAttrSources, resolveAttrConsumers } from './lib/gpgpuAttributes.ts';
      export { buildGpgpuInitialData } from './lib/gpgpuInitialData.ts';
      export { getAttrPointCloud } from './lib/attrPointCloud.ts';
      export { quatRotateVec } from './lib/gpgpuOrient.ts';
      export { resolveColorMaster } from './lib/appStateConfigNormalization.ts';
      export { getGpgpuRenderOutputPlan } from './lib/sceneRenderRoutingPlans.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    DEFAULT_CONFIG, buildDrawVert, buildDrawFrag,
    vellumCrackVariantOn, rigidClusterColorVariantOn, shadowMapVariantOn,
    shadowTunnelVariantOn, liveRuleDisplayVariantOn, lightUnitsVariantOn,
    spinChannelVariantOn, spriteFrameChannelVariantOn, ageFreeSizeVariantOn,
    ageFreeOpacityVariantOn, mergedSupplyActive,
    SPLAT_VERT, buildSplatParamData, splatQuatFromDirection, splatStretchMultiplier,
    buildSplatParamSupply, SPLAT_SCALE_VELOCITY_SOURCE,
    buildAttributeData, buildAttributeDataExt, normalizeAttrNames,
    normalizeAttrNames2, normalizeAttrSources, resolveAttrConsumers,
    buildGpgpuInitialData, getAttrPointCloud, quatRotateVec,
    resolveColorMaster, getGpgpuRenderOutputPlan,
  } = m;

  const TEX = 256;
  const cfg = (patch) => ({ ...DEFAULT_CONFIG, ...patch });
  const pointsVert = (c) => buildDrawVert({
    vellumCrack: vellumCrackVariantOn(c),
    clusterColor: rigidClusterColorVariantOn(c),
    shadowMap: shadowMapVariantOn(c),
    shadowTunnel: shadowTunnelVariantOn(c),
    ruleDisplay: liveRuleDisplayVariantOn(c),
    ruleDisplayMerged: mergedSupplyActive(c, TEX),
    lightUnits: lightUnitsVariantOn(c),
    spinChannel: spinChannelVariantOn(c),
    spriteFrameChannel: spriteFrameChannelVariantOn(c),
    ageFreeSize: ageFreeSizeVariantOn(c),
  });
  const pointsFrag = (c) => buildDrawFrag({
    vellumCrack: vellumCrackVariantOn(c),
    clusterColor: rigidClusterColorVariantOn(c),
    shadowMap: shadowMapVariantOn(c),
    spinChannel: spinChannelVariantOn(c),
    spriteFrameChannel: spriteFrameChannelVariantOn(c),
    ageFreeOpacity: ageFreeOpacityVariantOn(c),
  });

  // ── (a) stock identity ─────────────────────────────────
  check('stock points vert pin unchanged', sha256(pointsVert(cfg({}))) === STOCK_VERT_SHA256, sha256(pointsVert(cfg({}))));
  check('stock points frag pin unchanged', sha256(pointsFrag(cfg({}))) === STOCK_FRAG_SHA256, sha256(pointsFrag(cfg({}))));
  check('stock points strings unchanged with all C2 supply keys authored',
    sha256(pointsVert(cfg({ gpgpuSplatEnabled: true, gpgpuSplatScaleAttr: 'velocity', gpgpuSplatOpacityAttr: 'b' }))) === STOCK_VERT_SHA256
      && sha256(pointsFrag(cfg({ gpgpuSplatEnabled: true, gpgpuSplatScaleAttr: 'velocity', gpgpuSplatOpacityAttr: 'b' }))) === STOCK_FRAG_SHA256);
  const route = { enabled: true, resolvedEngine: 'webgl-gpgpu' };
  check('default plan has no splats branch', getGpgpuRenderOutputPlan(cfg({}), route).splats === false);
  check('splat vert pin is the C2 form', sha256(SPLAT_VERT) === SPLAT_VERT_SHA256_C2, sha256(SPLAT_VERT));

  // ── (e) key registration ───────────────────────────────
  check('supply keys default to empty (uniform supply)',
    DEFAULT_CONFIG.gpgpuSplatScaleAttr === '' && DEFAULT_CONFIG.gpgpuSplatOpacityAttr === '');
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts', 'validate-keys.fingerprint.json'), 'utf8'));
  // Key total re-pinned 2026-11-28 (WP7 Phase B added the two
  // lighting keys gpgpuShadowMapLightUnit /
  // gpgpuLightVolumeDepthIntersect — 1689 → 1691 total).
  // Re-pinned again 2026-11-28 (WP7 Phase D added the two
  // density keys gpgpuLightVolumeDensity /
  // postShineDensityLayers — 1691 → 1693 total).
  // Re-pinned again 2026-11-28 (WP8 Phase D added the
  // deform stack key gpgpuEmitDeform — 1693 → 1694 total).
  // Re-pinned again 2026-11-28 (WP9 Phase C added the two
  // track/modulation keys sequenceTracks / modulationSetup
  // — 1694 → 1696 total).
  // Re-pinned again 2026-11-28 (WP9 Phase D added the
  // local-time key gpgpuLocalTimeGroups — 1696 → 1697 total).
  // Re-pinned again 2026-11-28 (WP11 Phase B added the six
  // script-bake keys gpgpuScript* — 1697 → 1703 total).
  // Re-pinned again 2026-11-28 (WP11 Phase C added
  // glslSharedSnippets and the six replacement keys —
  // 1703 → 1710 total).
  // Re-pinned again 2026-11-29 (第45期統合の固定値 —
  // 1710 → 1738 total).
  check('fingerprint record carries both supply keys (1738 total)',
    record.keys.includes('gpgpuSplatScaleAttr') && record.keys.includes('gpgpuSplatOpacityAttr')
      && record.keyCount === 1738,
    `keyCount=${record.keyCount}`);

  // ── (b) buildSplatParamData per-particle extensions ────
  {
    const T = 2;
    const uniform = buildSplatParamData({ texSize: T });
    const explicit = buildSplatParamData({ texSize: T, scaleValues: null, opacityValues: null, velData: null, stretch: 0 });
    check('no per-particle input = the C1 uniform bake, bit for bit',
      arrEqual([...uniform.paramData], [...explicit.paramData]) && arrEqual([...uniform.rotData], [...explicit.rotData]));

    const sv = buildSplatParamData({ texSize: T, scale: 2, scaleValues: new Float32Array([2, 0.5, 0, 3]) });
    check('scaleValues multiply the uniform triple per particle',
      approx(sv.paramData[0], 4) && approx(sv.paramData[1], 4) && approx(sv.paramData[4], 1)
        && approx(sv.paramData[8], 0) && approx(sv.paramData[12], 6));

    const ov = buildSplatParamData({ texSize: T, opacity: 0.8, opacityValues: new Float32Array([2, 0.25, 1, 0]) });
    check('opacityValues multiply and clamp to [0, 1]',
      approx(ov.paramData[3], 1) && approx(ov.paramData[7], 0.2) && approx(ov.paramData[11], 0.8) && approx(ov.paramData[15], 0));

    // Velocity stretch: p0 moves +Y at speed 3, p1 at rest,
    // p2 moves −X at speed 2, p3 moves +X at speed 1.
    const vel = new Float32Array([
      0, 3, 0, 0,
      0, 0, 0, 0,
      -2, 0, 0, 0,
      1, 0, 0, 0,
    ]);
    const st = buildSplatParamData({ texSize: T, velData: vel, stretch: 1 });
    const q0 = [st.rotData[0], st.rotData[1], st.rotData[2], st.rotData[3]];
    const q2 = [st.rotData[8], st.rotData[9], st.rotData[10], st.rotData[11]];
    check('stretch aligns +X to the velocity direction',
      arrApprox(quatRotateVec(q0, [1, 0, 0]), [0, 1, 0], 1e-6)
        && arrApprox(quatRotateVec(q2, [1, 0, 0]), [-1, 0, 0], 1e-6),
      JSON.stringify({ q0: quatRotateVec(q0, [1, 0, 0]), q2: quatRotateVec(q2, [1, 0, 0]) }));
    check('stretch elongates X by 1 + strength * speed, Y/Z untouched',
      approx(st.paramData[0], 4) && approx(st.paramData[1], 1) && approx(st.paramData[2], 1)
        && approx(st.paramData[8], 3) && approx(st.paramData[12], 2));
    check('a particle at rest keeps the identity quat and unit scale',
      arrApprox([st.rotData[4], st.rotData[5], st.rotData[6], st.rotData[7]], [0, 0, 0, 1])
        && approx(st.paramData[4], 1));
    const stOff = buildSplatParamData({ texSize: T, velData: vel, stretch: 0 });
    check('stretch 0 never reads velData (uniform bake)',
      arrEqual([...stOff.paramData], [...uniform.paramData]) && arrEqual([...stOff.rotData], [...uniform.rotData]));
    check('splatStretchMultiplier law',
      splatStretchMultiplier(3, 1) === 4 && splatStretchMultiplier(0, 5) === 1 && splatStretchMultiplier(2, 0) === 1);
    check('splatQuatFromDirection edge cases',
      arrApprox(splatQuatFromDirection([0, 0, 0]), [0, 0, 0, 1])
        && arrApprox(splatQuatFromDirection([5, 0, 0]), [0, 0, 0, 1])
        && arrApprox(quatRotateVec(splatQuatFromDirection([0, 0, -2]), [1, 0, 0]), [0, 0, -1], 1e-6));
  }

  // ── (c) the supply adapter ─────────────────────────────
  {
    const T = 8;
    const base = cfg({});
    const plain = buildSplatParamSupply(base, T);
    check('default supply is uniform (slots -1, no velocity mode)',
      plain.scaleSlot === -1 && plain.opacitySlot === -1 && plain.velocityMode === false);
    const uniform = buildSplatParamData({ texSize: T });
    check('default supply arrays equal the uniform bake',
      arrEqual([...plain.paramData], [...uniform.paramData]) && arrEqual([...plain.rotData], [...uniform.rotData]));

    // Independent rebuild of the adapter's local bake.
    const init = buildGpgpuInitialData(T, base.gpgpuBounceRadius, base.gpgpuEmitShape, base.gpgpuSeed, base.gpgpuAgeMax);
    const bakeArgs = {
      texSize: T,
      posData: init.posData,
      velData: init.velData,
      ageMax: base.gpgpuAgeMax,
      bounceRadius: base.gpgpuBounceRadius,
      sphRadius: base.gpgpuSphRadius,
      sphRestDensity: base.gpgpuSphRestDensity,
      speciesCount: base.gpgpuParticleLifeSpecies,
      morphData: null,
      morphWorldScale: base.gpgpuMorphScale * base.gpgpuBounceRadius * 0.48,
      cloud: getAttrPointCloud(),
      names: normalizeAttrNames(base.gpgpuAttrNames),
      sources: normalizeAttrSources(base.gpgpuAttrSources),
      exprs: base.gpgpuAttrExprs,
      colorRawSlots: null,
    };
    const attrBake = buildAttributeData(bakeArgs);

    const byScale = buildSplatParamSupply(cfg({ gpgpuSplatScaleAttr: 'b' }), T);
    let scaleOk = byScale.scaleSlot === 1;
    for (let i = 0; i < T * T && scaleOk; i++) {
      const v = attrBake[i * 4 + 1];
      scaleOk = approx(byScale.paramData[i * 4], v) && approx(byScale.paramData[i * 4 + 1], v)
        && approx(byScale.paramData[i * 4 + 2], v) && approx(byScale.paramData[i * 4 + 3], 1);
    }
    check('scale slot resolves by name and multiplies every axis', scaleOk);

    const byOpacity = buildSplatParamSupply(cfg({ gpgpuSplatOpacityAttr: 'c' }), T);
    let opacityOk = byOpacity.opacitySlot === 2;
    for (let i = 0; i < T * T && opacityOk; i++) {
      opacityOk = approx(byOpacity.paramData[i * 4 + 3], Math.min(Math.max(attrBake[i * 4 + 2], 0), 1))
        && approx(byOpacity.paramData[i * 4], 1);
    }
    check('opacity slot resolves by name and drives opacity only', opacityOk);

    const missing = buildSplatParamSupply(cfg({ gpgpuSplatScaleAttr: 'zzz', gpgpuSplatOpacityAttr: 'zzz' }), T);
    check('unresolvable names fall back to the uniform bake',
      missing.scaleSlot === -1 && missing.opacitySlot === -1
        && arrEqual([...missing.paramData], [...uniform.paramData]));

    // Ext slot (names2): 'f' is slot 5.
    const extCfg = cfg({ gpgpuAttrNames2: ['e', 'f', 'g', 'h'], gpgpuSplatScaleAttr: 'f' });
    const extBake = buildAttributeDataExt({
      ...bakeArgs,
      firstBake: attrBake,
      names2: normalizeAttrNames2(extCfg.gpgpuAttrNames2),
      sources2: normalizeAttrSources(extCfg.gpgpuAttrSources2),
      exprs2: extCfg.gpgpuAttrExprs2,
    });
    const byExt = buildSplatParamSupply(extCfg, T);
    let extOk = byExt.scaleSlot === 5;
    for (let i = 0; i < T * T && extOk; i++) {
      extOk = approx(byExt.paramData[i * 4], extBake[i * 4 + 1]);
    }
    check('ext slot (4..7) resolves across names2 and reads the ext bake', extOk);

    // Velocity mode: quats follow the seeded velocity field.
    const velSupply = buildSplatParamSupply(cfg({ gpgpuSplatScaleAttr: SPLAT_SCALE_VELOCITY_SOURCE }), T);
    let velOk = velSupply.velocityMode === true && velSupply.scaleSlot === -1;
    let moving = 0;
    for (let i = 0; i < T * T && velOk; i++) {
      const vx = init.velData[i * 4];
      const vy = init.velData[i * 4 + 1];
      const vz = init.velData[i * 4 + 2];
      const speed = Math.hypot(vx, vy, vz);
      if (speed <= 1e-6) continue;
      moving += 1;
      const q = [velSupply.rotData[i * 4], velSupply.rotData[i * 4 + 1], velSupply.rotData[i * 4 + 2], velSupply.rotData[i * 4 + 3]];
      const axis = quatRotateVec(q, [1, 0, 0]);
      velOk = arrApprox(axis, [vx / speed, vy / speed, vz / speed], 1e-4)
        && approx(velSupply.paramData[i * 4], 1 + speed, 1e-5)
        && approx(velSupply.paramData[i * 4 + 1], 1);
    }
    check('velocity mode aligns quats to the seeded field and elongates X', velOk && moving > 0, `moving=${moving}`);
    check("the 'velocity' source token is case-insensitive",
      buildSplatParamSupply(cfg({ gpgpuSplatScaleAttr: 'Velocity' }), T).velocityMode === true);
  }

  // ── (d) colour: the three-stage rule ───────────────────
  {
    const colorCfg = cfg({
      gpgpuAttrNames: ['colorR', 'colorG', 'colorB', 'd'],
      gpgpuAttrColorEnabled: true,
      gpgpuSplatEnabled: true,
    });
    check('colour drive active while authored on (master on)',
      resolveAttrConsumers(cfg({ ...colorCfg, gpgpuColorMasterEnabled: true })).colorActive === true);
    const resolvedOff = resolveColorMaster(cfg({ ...colorCfg, gpgpuColorMasterEnabled: false }));
    check('master off resolves the colour drive off (splat keeps its tint)',
      resolvedOff.gpgpuAttrColorEnabled === false && resolveAttrConsumers(resolvedOff).colorActive === false);
    check('the splat tint itself is not a colour feature (survives the master)',
      resolvedOff.gpgpuSplatColor === colorCfg.gpgpuSplatColor && resolvedOff.gpgpuSplatEnabled === true);
  }

  // ── (f) wiring source pins ─────────────────────────────
  {
    const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
    // Pin updated 2026-11-28 (Phase C3): the scene now runs
    // a second sort pass for the splat columns (with its own
    // forceSort: true), so the count covers every forceSort
    // occurrence; the intent — the POOL sort call passes the
    // splat predicate exactly once — is pinned on the
    // predicate string itself.
    check('scene passes the splat predicate to the sort pass, once',
      sceneSrc.split('forceSort: config.gpgpuSplatEnabled').length - 1 === 1);
    const vuSrc = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
    check('sort guard is the widened condition (legacy value while forceSort is off)',
      vuSrc.includes('if ((!config.gpgpuSortEnabled && !forceSort) || !sortRTA || !sortRTB) return null;'));
    check('per-frame splat supply is gated on the splat key',
      vuSrc.includes('if (config.gpgpuSplatEnabled && splatMat)'));
    // Pin updated 2026-11-28 (Phase C3): the centre / sort
    // writes gained the columns-form ternary (the pool value
    // is the else arm, unchanged); the intent — pool bindings
    // plus the baked-rotation restore — is preserved.
    check('splat supply binds centre / sort and restores the baked rotation texture',
      vuSrc.includes('splatColumnsActive ? splatColumnsTextures.centerTex : posTexture')
        && vuSrc.includes('splatColumnsActive ? (args.splatColumnsSortTex ?? null) : finalSortTex')
        && vuSrc.includes('args.orientTexture')
        && vuSrc.includes('splatMat.userData.splatBakedRotTex'));
    check('splat colour supply resolves slots like the points draw',
      vuSrc.includes('splatMat.uniforms.uAttrColorEnabled.value = !!splatAttrTex && !!splatColorSlots'));
    const daSrc = readFileSync(join(ROOT, 'components', 'useGpgpuDrawAssets.ts'), 'utf8');
    check('draw assets rebake the parameter textures from the resolved supply',
      daSrc.includes('buildSplatParamSupply(config, texSize)')
        && daSrc.includes('splatSupplyKey')
        && daSrc.includes('mat.userData.splatBakedRotTex = splatParamTextures.rotTex'));
    check('draw assets carry the attribute colour uniforms, off / -1 at creation',
      daSrc.includes('uAttrColorEnabled: { value: false }') && daSrc.includes('uAttrColorSlotR:   { value: -1 }'));
    const shSrc = readFileSync(join(ROOT, 'components', 'gpgpuShaderSplats.ts'), 'utf8');
    check('splat vertex carries the shared attribute colour chunk',
      shSrc.includes('uniform bool      uAttrColorEnabled;')
        && shSrc.includes('kaloAttrChannel(attrData, uAttrColorSlotR)'));
  }

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
