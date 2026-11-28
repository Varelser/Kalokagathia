// Layer 1 WP7 Phase C1 — Gaussian splat draw primitive.
//
// A new, independent instanced-quad primitive alongside the
// points draw (components/gpgpuShaderSplats.ts, twins in
// lib/gpgpuSplat.ts): per-splat scale / rotation / opacity
// ride two dedicated parameter textures, the centre is the
// pool position texture, the projected covariance goes
// through the EWA Jacobian at the centre, and the quad is
// expanded along the projected ellipse's principal axes.
//
// What is pinned here (node side):
//  (a) Stock identity: the points draw strings keep their
//      pre-WP7 sha256 pins (buildDrawVert / buildDrawFrag
//      are untouched by this phase — the splat is a separate
//      material), and the default render-output plan is
//      unchanged (no 'splats' branch, plan.splats false).
//  (b) The splat shader strings themselves (sha256 pins),
//      their sort-consumption form (the points draw's
//      uSortEnabled fallback verbatim) and the kaloQuatMat3
//      helper's term-for-term equality with the geometry
//      vertex's copy.
//  (c) The CPU twins against analytic solutions: covariance
//      composition (isotropic / axis-rotated), the EWA
//      Jacobian against finite differences of the true
//      perspective divide, projected ellipses for known
//      covariances (circle for isotropic, axis-aligned and
//      90°-rotated ellipses), and an end-to-end check that
//      points on the 3D ellipsoid project onto the ellipse
//      the twin predicts.
//  (d) The parameter bake (uniform scale / opacity / quat).
//  (e) Key registration: the four new keys' defaults and
//      their presence in the validate-keys fingerprint
//      record.
//  (f) Wiring: the draw assets carry splatGeo / splatMat,
//      the render outputs mount on plan.splats, the plan
//      predicate follows route + key like volumetric's.
// The real-GPU appearance check (ellipse look, sort order
// on screen) is a gate-side item, NOT judged here — this
// file pins the string / numeric / plan level.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7c1-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Stock points-draw pins (the same ones layer1-wp7-color-master
// pins; the builders are untouched by this phase).
const STOCK_VERT_SHA256 = '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529';
const STOCK_FRAG_SHA256 = 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c';
// Splat string pins, measured on this tree at C1 landing.
// VERT re-pinned 2026-11-28 (Phase C2): the attribute colour
// chunk (uAttrTex / uAttrColorEnabled / colour slots +
// kaloAttrChannel) was added to the vertex head and body —
// the C1 form is superseded, the intent (pin the exact splat
// strings) is preserved.
// VERT re-pinned again 2026-11-28 (Phase C3): the columns DC
// colour chunk (uSplatColorTex / uSplatColorEnabled) was
// added to the vertex head and body — same intent.
const SPLAT_VERT_SHA256 = 'c5792ac88f553f01692f55055efce202bea44431f5a36f67cfef11fb49e80f7f';
const SPLAT_FRAG_SHA256 = 'a0aa266887491c1930533efbac350988dfbf677200d8d6aca2865b2d3ff6503a';

await build({
  stdin: {
    contents: `
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { vellumCrackVariantOn, rigidClusterColorVariantOn, shadowMapVariantOn, shadowTunnelVariantOn, liveRuleDisplayVariantOn, lightUnitsVariantOn, spinChannelVariantOn, spriteFrameChannelVariantOn, ageFreeSizeVariantOn, ageFreeOpacityVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { mergedSupplyActive } from './lib/gpgpuMergedSupply.ts';
      export { buildSplatVert, buildSplatFrag, SPLAT_VERT, SPLAT_FRAG } from './components/gpgpuShaderSplats.ts';
      export { buildGeomVertShader } from './components/gpgpuShaderVolumes.ts';
      export { SPLAT_CUTOFF_SIGMA, splatCovariance, splatViewCovariance, splatProjectionJacobian, splatProjectCovariance, splatEllipseFromCov2, splatProjectedEllipse, splatGaussianWeight, splatWithinCutoff, buildSplatParamData } from './lib/gpgpuSplat.ts';
      export { quatFromAxisAngle } from './lib/gpgpuOrient.ts';
      export { getGpgpuRenderOutputPlan, doesGpgpuRouteRenderSplats } from './lib/sceneRenderRoutingPlans.ts';
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
    buildSplatVert, buildSplatFrag, SPLAT_VERT, SPLAT_FRAG, buildGeomVertShader,
    SPLAT_CUTOFF_SIGMA, splatCovariance, splatViewCovariance,
    splatProjectionJacobian, splatProjectCovariance, splatEllipseFromCov2,
    splatProjectedEllipse, splatGaussianWeight, splatWithinCutoff,
    buildSplatParamData, quatFromAxisAngle, getGpgpuRenderOutputPlan,
    doesGpgpuRouteRenderSplats,
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
  check('stock points strings unchanged with splat key on',
    sha256(pointsVert(cfg({ gpgpuSplatEnabled: true }))) === STOCK_VERT_SHA256
      && sha256(pointsFrag(cfg({ gpgpuSplatEnabled: true }))) === STOCK_FRAG_SHA256);

  // ── (e) key registration ───────────────────────────────
  check('splat keys default off / neutral',
    DEFAULT_CONFIG.gpgpuSplatEnabled === false
      && DEFAULT_CONFIG.gpgpuSplatScale === 1
      && DEFAULT_CONFIG.gpgpuSplatOpacity === 1
      && DEFAULT_CONFIG.gpgpuSplatColor === '#ffffff',
    JSON.stringify({
      e: DEFAULT_CONFIG.gpgpuSplatEnabled, s: DEFAULT_CONFIG.gpgpuSplatScale,
      o: DEFAULT_CONFIG.gpgpuSplatOpacity, c: DEFAULT_CONFIG.gpgpuSplatColor,
    }));
  const record = JSON.parse(readFileSync(join(ROOT, 'scripts', 'validate-keys.fingerprint.json'), 'utf8'));
  // Key total re-pinned 2026-11-28 (Phase C2): the two supply
  // keys (gpgpuSplatScaleAttr / gpgpuSplatOpacityAttr) joined
  // the record — 1687 → 1689 total, six splat keys.
  // Re-pinned again 2026-11-28 (WP7 Phase B added the two
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
  check('fingerprint record carries the six splat keys (1738 total)',
    ['gpgpuSplatEnabled', 'gpgpuSplatScale', 'gpgpuSplatOpacity', 'gpgpuSplatColor',
      'gpgpuSplatScaleAttr', 'gpgpuSplatOpacityAttr']
      .every((k) => record.keys.includes(k)) && record.keyCount === 1738,
    `keyCount=${record.keyCount}`);

  // ── (f) plan wiring ────────────────────────────────────
  const route = { enabled: true, resolvedEngine: 'webgl-gpgpu' };
  const planDefault = getGpgpuRenderOutputPlan(cfg({}), route);
  const planExplicitOff = getGpgpuRenderOutputPlan(cfg({
    gpgpuSplatEnabled: false, gpgpuSplatScale: 1, gpgpuSplatOpacity: 1, gpgpuSplatColor: '#ffffff',
  }), route);
  check('default plan has no splats branch',
    planDefault.splats === false && !planDefault.sceneBranches.includes('splats'));
  check('plan at explicit defaults equals the default plan',
    JSON.stringify({ ...planDefault, route: undefined }) === JSON.stringify({ ...planExplicitOff, route: undefined }));
  const planOn = getGpgpuRenderOutputPlan(cfg({ gpgpuSplatEnabled: true }), route);
  check('enabled plan stands the splats branch only',
    planOn.splats === true
      && planOn.sceneBranches.filter((b) => b === 'splats').length === 1
      && planOn.sceneBranches.length === planDefault.sceneBranches.length + 1
      && planOn.pointSprites === planDefault.pointSprites
      && planOn.volumetric === planDefault.volumetric);
  check('splat predicate needs an enabled route',
    doesGpgpuRouteRenderSplats(route, cfg({ gpgpuSplatEnabled: true })) === true
      && doesGpgpuRouteRenderSplats(undefined, cfg({ gpgpuSplatEnabled: true })) === false
      && doesGpgpuRouteRenderSplats({ enabled: false }, cfg({ gpgpuSplatEnabled: true })) === false
      && doesGpgpuRouteRenderSplats(route, cfg({})) === false);

  // ── (b) splat strings ──────────────────────────────────
  check('splat vert pin', sha256(SPLAT_VERT) === SPLAT_VERT_SHA256, sha256(SPLAT_VERT));
  check('splat frag pin', sha256(SPLAT_FRAG) === SPLAT_FRAG_SHA256, sha256(SPLAT_FRAG));
  check('builders return the exported strings',
    buildSplatVert() === SPLAT_VERT && buildSplatFrag() === SPLAT_FRAG);
  check('vert consumes the dedicated parameter textures',
    SPLAT_VERT.includes('uniform sampler2D uSplatParamTex;')
      && SPLAT_VERT.includes('uniform sampler2D uSplatRotTex;')
      && SPLAT_VERT.includes('uniform sampler2D uCenterTex;'));
  check('vert sort consumption is the points fallback form',
    SPLAT_VERT.includes('uSortEnabled ? texture2D(uSortTex, aTexCoord).xy : aTexCoord'));
  check('vert stays in the tree shader dialect (no transpose)',
    !SPLAT_VERT.includes('transpose('));
  check('frag evaluates the Gaussian with the cutoff discard',
    SPLAT_FRAG.includes('exp(-0.5 * d2)') && SPLAT_FRAG.includes('discard'));
  const grabQuat = (s) => {
    const i = s.indexOf('mat3 kaloQuatMat3');
    if (i < 0) return null;
    const tail = '1.0 - 2.0 * (x * x + y * y));';
    const j = s.indexOf(tail, i);
    return s.slice(i, j + tail.length + 1);
  };
  check('kaloQuatMat3 matches the geometry vertex helper term for term',
    grabQuat(SPLAT_VERT) !== null
      && grabQuat(SPLAT_VERT) === grabQuat(buildGeomVertShader({ orientChannel: true })));

  // ── (f) asset / mount wiring (source level) ────────────
  const drawAssetsSrc = readFileSync(join(ROOT, 'components', 'useGpgpuDrawAssets.ts'), 'utf8');
  // WP8 Phase D (2026-11-28): the factory call now passes
  // the spin-channel variant option (default off = the same
  // string buildSplatVert() produced).
  check('draw assets build the splat geometry and material',
    drawAssetsSrc.includes('splatGeo') && drawAssetsSrc.includes('splatMat')
      && drawAssetsSrc.includes('buildSplatVert({ spinChannel: spinChannelVariantOn(drawConfig) })') && drawAssetsSrc.includes('buildSplatParamData')
      && drawAssetsSrc.includes('THREE.NormalBlending'));
  const outputsSrc = readFileSync(join(ROOT, 'components', 'gpgpuRenderOutputs.tsx'), 'utf8');
  check('render outputs mount on plan.splats',
    outputsSrc.includes('plan.splats') && outputsSrc.includes('splatGeo') && outputsSrc.includes('splatMat'));

  // ── (c) covariance twins ───────────────────────────────
  const iso = splatCovariance([2, 2, 2]);
  check('isotropic covariance is 4·I',
    approx(iso[0], 4) && approx(iso[4], 4) && approx(iso[8], 4)
      && approx(iso[1], 0) && approx(iso[2], 0) && approx(iso[5], 0),
    iso.join(','));
  const qz90 = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
  const rotCov = splatCovariance([3, 1, 1], qz90);
  check('z-90° covariance swaps the x/y extents (diag 1,9,1)',
    approx(rotCov[0], 1, 1e-9) && approx(rotCov[4], 9, 1e-9) && approx(rotCov[8], 1, 1e-9)
      && approx(rotCov[1], 0, 1e-9) && approx(rotCov[3], 0, 1e-9),
    rotCov.join(','));

  // Jacobian against finite differences of the true divide.
  const proj = (p, fx, fy) => [fx * p[0] / -p[2], fy * p[1] / -p[2]];
  const tJ = [1.5, -2, -8];
  const J = splatProjectionJacobian(tJ, 1.3, 0.9);
  let fdOk = true;
  for (let col = 0; col < 3; col++) {
    const eps = 1e-6;
    const pp = [...tJ]; pp[col] += eps;
    const pm = [...tJ]; pm[col] -= eps;
    const dp = proj(pp, 1.3, 0.9);
    const dm = proj(pm, 1.3, 0.9);
    for (let row = 0; row < 2; row++) {
      if (!approx((dp[row] - dm[row]) / (2 * eps), J[row * 3 + col], 1e-5)) fdOk = false;
    }
  }
  check('EWA Jacobian matches finite differences of the perspective divide', fdOk);

  // Projected ellipses for known covariances (identity view,
  // fx = fy = 1, centre on the axis at depth 10).
  const IDENTITY_VIEW_COLS = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const circle = splatProjectedEllipse({
    scale: [2, 2, 2], viewColumns: IDENTITY_VIEW_COLS, centerView: [0, 0, -10], fx: 1, fy: 1,
  });
  check('isotropic splat projects to a circle (radii = cutoff·σ/depth)',
    approx(circle.radius1, 0.6, 1e-9) && approx(circle.radius2, 0.6, 1e-9)
      && approx(circle.lambda1, 0.04, 1e-12),
    `r=${circle.radius1},${circle.radius2}`);
  const axisEllipse = splatProjectedEllipse({
    scale: [3, 1, 1], viewColumns: IDENTITY_VIEW_COLS, centerView: [0, 0, -10], fx: 1, fy: 1,
  });
  check('axis-aligned anisotropic ellipse (0.9 × 0.3, angle 0)',
    approx(axisEllipse.radius1, 0.9, 1e-9) && approx(axisEllipse.radius2, 0.3, 1e-9)
      && approx(axisEllipse.axis1[0], 1, 1e-9) && approx(axisEllipse.axis1[1], 0, 1e-9),
    `r=${axisEllipse.radius1},${axisEllipse.radius2} axis=${axisEllipse.axis1}`);
  const rotEllipse = splatProjectedEllipse({
    scale: [3, 1, 1], quat: qz90, viewColumns: IDENTITY_VIEW_COLS, centerView: [0, 0, -10], fx: 1, fy: 1,
  });
  check('z-90° splat projects to the swapped ellipse (axis1 ≈ ±y)',
    approx(rotEllipse.radius1, 0.9, 1e-9) && approx(rotEllipse.radius2, 0.3, 1e-9)
      && approx(Math.abs(rotEllipse.axis1[1]), 1, 1e-9) && approx(rotEllipse.axis1[0], 0, 1e-9),
    `r=${rotEllipse.radius1},${rotEllipse.radius2} axis=${rotEllipse.axis1}`);

  // End-to-end: points on the 3D ellipsoid (Cholesky surface
  // samples) project — through the TRUE nonlinear divide —
  // into the ellipse the twin predicts: every surface point
  // lands inside it (qᵀ Σ′⁻¹ q ≤ 1, up to the linearisation
  // error at this scale / depth — surface points along the
  // view ray map to the interior by construction, only the
  // silhouette contour attains the boundary), and the
  // silhouette is attained (max over the direction grid
  // ≈ 1).
  const e2eScale = [0.06, 0.03, 0.045];
  const e2eQuat = quatFromAxisAngle([1, 2, 3], 0.7);
  const e2eCenter = [0.4, -0.2, -10];
  const e2eFx = 1.2;
  const e2eFy = 0.8;
  const covV = splatViewCovariance(splatCovariance(e2eScale, e2eQuat), IDENTITY_VIEW_COLS);
  const cov2 = splatProjectCovariance(covV, e2eCenter, e2eFx, e2eFy);
  // Cholesky of covV (row-major 3×3, symmetric positive definite).
  const L = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = covV[i * 3 + j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(sum) : sum / L[j][j];
    }
  }
  const det2 = cov2[0] * cov2[2] - cov2[1] * cov2[1];
  const inv2 = [cov2[2] / det2, -cov2[1] / det2, cov2[0] / det2];
  const q0 = proj(e2eCenter, e2eFx, e2eFy);
  let e2eInside = det2 > 0;
  let e2eMaxForm = 0;
  const dirs = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
    if (a !== 0 || b !== 0 || c !== 0) dirs.push([a, b, c]);
  }
  for (const d of dirs) {
    const len = Math.hypot(d[0], d[1], d[2]);
    const u = [d[0] / len, d[1] / len, d[2] / len];
    const off = [
      L[0][0] * u[0] + L[0][1] * u[1] + L[0][2] * u[2],
      L[1][0] * u[0] + L[1][1] * u[1] + L[1][2] * u[2],
      L[2][0] * u[0] + L[2][1] * u[1] + L[2][2] * u[2],
    ];
    const p = [e2eCenter[0] + off[0], e2eCenter[1] + off[1], e2eCenter[2] + off[2]];
    const q = proj(p, e2eFx, e2eFy);
    const dq = [q[0] - q0[0], q[1] - q0[1]];
    const form = inv2[0] * dq[0] * dq[0] + 2 * inv2[1] * dq[0] * dq[1] + inv2[2] * dq[1] * dq[1];
    e2eMaxForm = Math.max(e2eMaxForm, form);
    if (form > 1.03) e2eInside = false;
  }
  check('ellipsoid surface projects inside the predicted ellipse (nonlinear divide)',
    e2eInside, `max form = ${e2eMaxForm}`);
  check('the projected silhouette attains the predicted ellipse',
    e2eMaxForm > 0.9, `max form = ${e2eMaxForm}`);

  // Ellipse helper on a hand-computed covariance.
  const hand = splatEllipseFromCov2([0.09, 0, 0.01]);
  check('ellipse from a diagonal covariance (radii 0.9 / 0.3)',
    approx(hand.radius1, 0.9) && approx(hand.radius2, 0.3) && approx(hand.angle, 0));

  // Gaussian weight / cutoff (the fragment's terms).
  check('Gaussian weight and cutoff terms',
    splatGaussianWeight(0, 0) === 1
      && approx(splatGaussianWeight(SPLAT_CUTOFF_SIGMA, 0), Math.exp(-4.5), 1e-12)
      && splatWithinCutoff(SPLAT_CUTOFF_SIGMA, 0) === true
      && splatWithinCutoff(SPLAT_CUTOFF_SIGMA, 0.01) === false
      && splatWithinCutoff(2.9, 0.5) === true);

  // ── (d) parameter bake ─────────────────────────────────
  const bake = buildSplatParamData({ texSize: 4, scale: [2, 3, 4], opacity: 0.5, quat: [0, 0, 0, 1] });
  check('bake payload shapes', bake.paramData.length === 4 * 4 * 4 && bake.rotData.length === 4 * 4 * 4);
  check('bake writes scale + opacity / quat per texel',
    bake.paramData[0] === 2 && bake.paramData[1] === 3 && bake.paramData[2] === 4 && bake.paramData[3] === 0.5
      && bake.paramData[4 * 15] === 2 && bake.paramData[4 * 15 + 3] === 0.5
      && bake.rotData[0] === 0 && bake.rotData[3] === 1);
  const bakeDefault = buildSplatParamData({ texSize: 2 });
  check('bake defaults are unit scale / full opacity / identity rotation',
    bakeDefault.paramData[0] === 1 && bakeDefault.paramData[1] === 1
      && bakeDefault.paramData[2] === 1 && bakeDefault.paramData[3] === 1
      && bakeDefault.rotData[3] === 1);
} finally {
  unlinkSync(BUNDLE);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
