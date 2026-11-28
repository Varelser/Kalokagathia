/**
 * Grammar 2.0 stage 2, slice B4 (age free curves): standalone
 * node test.
 *
 * Pins:
 *  1 resolution (lib/gpgpuAgeFreeCurves.ts): the per-target
 *    key mapping, knot normalisation inherited from
 *    lib/freeCurve.ts, the padded uniform arrays (last point
 *    repeated to FREE_CURVE_MAX_POINTS), the variant
 *    predicate (Enabled && FreeEnabled), the free-aware
 *    identity suppression, and the capability predicate —
 *    all inert at the defaults.
 *  2 the CPU twins against hand computation: evaluateFreeCurve
 *    (the lib/freeCurve.ts asset the GLSL twins mirror) and
 *    the new integrateFreeCurve — trapezoids, the partial
 *    segment's quadratic, endpoint hold on both sides, and
 *    the identity integral (exactly x). A JS re-statement of
 *    the generated GLSL algorithms over the padded arrays
 *    agrees with both on a grid.
 *  3 the identity rule: the five stock shader strings
 *    (velocity / position / points vertex / points fragment /
 *    geometry vertex) keep their pre-B4 sha256 pins.
 *  4 the variants: each target's variant string carries the
 *    generated uniform set + evaluation function and the
 *    free evaluation in place of the 5-point one (rotation
 *    also swaps the closed-form integral and the
 *    beyond-max-age tail rate); the stock strings contain
 *    no trace of them.
 *  5 texture-unit accounting measured from the built shader
 *    strings: the B4 variants spend NO sampler (float arrays
 *    only), so every count equals its stock count.
 *  6 the capability split: a standing non-identity free mode
 *    requests 'age-free-curves', reported unsupported
 *    (WebGL fallback); the defaults — and a standing but
 *    identity free mode — request nothing.
 *  7 key registration: the 10 new keys sit at their defaults.
 */
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b4-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { AGE_CURVE_TARGETS, resolveAgeFreeCurve, ageFreeEnabled, ageFreeVariantOn, ageCurveTargetSuppressed, ageFreeCurvesActive, integrateFreeCurve, padFreeCurveArrays, ageFreeEvalGlsl, ageFreeIntegralGlsl } from './lib/gpgpuAgeFreeCurves.ts';
      export { evaluateFreeCurve, normalizeFreeCurvePoints, FREE_CURVE_MAX_POINTS } from './lib/freeCurve.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildDrawVert, buildDrawFrag, DRAW_VERT, DRAW_FRAG } from './components/gpgpuShaderPoints.ts';
      export { buildGeomVertShader, GEOM_VERT } from './components/gpgpuShaderVolumes.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  AGE_CURVE_TARGETS, resolveAgeFreeCurve, ageFreeEnabled, ageFreeVariantOn, ageCurveTargetSuppressed,
  ageFreeCurvesActive, integrateFreeCurve, padFreeCurveArrays, ageFreeEvalGlsl, ageFreeIntegralGlsl,
  evaluateFreeCurve, normalizeFreeCurvePoints, FREE_CURVE_MAX_POINTS,
  buildVelocityFragment, SIM_VEL_FRAG, SIM_POS_FRAG, buildDrawVert, buildDrawFrag, DRAW_VERT, DRAW_FRAG,
  buildGeomVertShader, GEOM_VERT, getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU: D,
} = lib;
const cfg = (over) => ({ ...D, ...over });

// --- 1. resolution + predicates --------------------------------------
{
  check('five targets', AGE_CURVE_TARGETS.length === 5);
  for (const target of AGE_CURVE_TARGETS) {
    const r = resolveAgeFreeCurve(cfg({}), target);
    check(`${target}: default asset is the identity, padded to ${FREE_CURVE_MAX_POINTS}`,
      r.identity && r.points.length === 2 && r.flatT.length === FREE_CURVE_MAX_POINTS && r.flatV.length === FREE_CURVE_MAX_POINTS
      && r.flatT[0] === 0 && r.flatT[1] === 1 && r.flatV.every((v) => v === 1),
      JSON.stringify(r));
    check(`${target}: no variant / no capability / suppressed at defaults`,
      !ageFreeVariantOn(cfg({}), target) && ageCurveTargetSuppressed(cfg({}), target));
  }
  check('no free mode is active at defaults', !ageFreeCurvesActive(cfg({})));

  // Variant needs BOTH switches.
  check('variant needs Enabled && FreeEnabled',
    !ageFreeVariantOn(cfg({ gpgpuAgeCurveSizeFreeEnabled: true }), 'size')
    && !ageFreeVariantOn(cfg({ gpgpuAgeCurveSizeEnabled: true }), 'size')
    && ageFreeVariantOn(cfg({ gpgpuAgeCurveSizeEnabled: true, gpgpuAgeCurveSizeFreeEnabled: true }), 'size'));
  check('ageFreeEnabled reads the per-target switch',
    ageFreeEnabled(cfg({ gpgpuAgeCurveForceFreeEnabled: true }), 'force')
    && !ageFreeEnabled(cfg({ gpgpuAgeCurveForceFreeEnabled: true }), 'size'));

  // Normalisation is inherited from lib/freeCurve.ts: sorting,
  // clamping, duplicate-t collapse.
  const messy = resolveAgeFreeCurve(cfg({ gpgpuAgeCurveSizeFreePoints: [1, 2, 0.5, 9, 0, 0.5, 0.5, 3] }), 'size');
  check('free points normalise (sort / clamp / dedupe)',
    messy.points.length === 3
    && messy.points[0].t === 0 && messy.points[0].v === 0.5
    && messy.points[1].t === 0.5 && messy.points[1].v === 3
    && messy.points[2].t === 1 && messy.points[2].v === 2,
    JSON.stringify(messy.points));
  check('padding repeats the last point',
    messy.flatT[3] === 1 && messy.flatV[3] === 2 && messy.flatT[FREE_CURVE_MAX_POINTS - 1] === 1 && messy.flatV[FREE_CURVE_MAX_POINTS - 1] === 2);
  check('padFreeCurveArrays on a 2-point asset',
    (() => { const p = padFreeCurveArrays([{ t: 0.25, v: 0 }, { t: 0.75, v: 4 }]); return p.flatT[2] === 0.75 && p.flatV[7] === 4; })());

  // Suppression follows the free identity while free mode is on.
  check('suppression: non-identity 5pt + identity free (free on) = suppressed',
    ageCurveTargetSuppressed(cfg({
      gpgpuAgeCurveVelocityEnabled: true, gpgpuAgeCurveVelocityPoints: [2, 2, 2, 2, 2],
      gpgpuAgeCurveVelocityFreeEnabled: true,
    }), 'velocity'));
  check('suppression: identity 5pt + non-identity free (free on) = live',
    !ageCurveTargetSuppressed(cfg({
      gpgpuAgeCurveVelocityEnabled: true,
      gpgpuAgeCurveVelocityFreeEnabled: true, gpgpuAgeCurveVelocityFreePoints: [0, 0, 1, 2],
    }), 'velocity'));
  check('suppression: free switch off keeps the 5pt rule',
    ageCurveTargetSuppressed(cfg({ gpgpuAgeCurveForceEnabled: true }), 'force')
    && !ageCurveTargetSuppressed(cfg({ gpgpuAgeCurveForceEnabled: true, gpgpuAgeCurveForcePoints: [1, 1, 2, 1, 1] }), 'force'));

  // Capability needs a standing, non-identity free mode.
  check('capability predicate: standing non-identity free mode',
    ageFreeCurvesActive(cfg({
      gpgpuAgeCurveOpacityEnabled: true, gpgpuAgeCurveOpacityFreeEnabled: true,
      gpgpuAgeCurveOpacityFreePoints: [0, 0, 1, 1],
    })));
  check('capability predicate: standing identity free mode stays inert',
    !ageFreeCurvesActive(cfg({ gpgpuAgeCurveOpacityEnabled: true, gpgpuAgeCurveOpacityFreeEnabled: true })));
  check('capability predicate: non-identity asset without the switches stays inert',
    !ageFreeCurvesActive(cfg({ gpgpuAgeCurveOpacityFreePoints: [0, 0, 1, 1] })));
}

// --- 2. CPU twins vs hand computation --------------------------------
{
  const ramp = normalizeFreeCurvePoints([0, 0, 1, 2]);
  check('evaluate: ramp knots and midpoint',
    evaluateFreeCurve(ramp, 0) === 0 && evaluateFreeCurve(ramp, 1) === 2 && approx(evaluateFreeCurve(ramp, 0.5), 1));
  check('integral: ramp area is the triangle mean (1 at x=1, 0.25 at x=0.5)',
    approx(integrateFreeCurve(ramp, 1), 1) && approx(integrateFreeCurve(ramp, 0.5), 0.25));
  const tent = normalizeFreeCurvePoints([0, 1, 0.5, 3, 1, 1]);
  check('integral: tent area is two trapezoids (1 + 1 = 2)',
    approx(integrateFreeCurve(tent, 1), 2) && approx(integrateFreeCurve(tent, 0.5), 1));
  const held = normalizeFreeCurvePoints([0.25, 2, 0.75, 2]);
  check('integral: endpoint hold makes a constant 2 integrate to 2x',
    approx(integrateFreeCurve(held, 1), 2) && approx(integrateFreeCurve(held, 0.1), 0.2) && approx(integrateFreeCurve(held, 0.9), 1.8));
  check('evaluate: endpoint hold outside the knot range',
    evaluateFreeCurve(held, 0) === 2 && evaluateFreeCurve(held, 1) === 2);
  const identity = normalizeFreeCurvePoints([0, 1, 1, 1]);
  check('integral: the identity curve integrates to exactly x',
    [0, 0.13, 0.5, 0.87, 1].every((x) => integrateFreeCurve(identity, x) === x));
  check('integral: clamps x to [0, 1]',
    integrateFreeCurve(ramp, -1) === 0 && approx(integrateFreeCurve(ramp, 2), 1));

  // The generated GLSL algorithms, re-stated in JS over the
  // padded arrays, agree with the lib functions on a grid.
  const glslEval = (flatT, flatV, x0) => {
    const xx = Math.min(1, Math.max(0, x0));
    if (xx <= flatT[0]) return flatV[0];
    for (let i = 1; i < FREE_CURVE_MAX_POINTS; i++) {
      if (xx <= flatT[i]) {
        const span = flatT[i] - flatT[i - 1];
        const f = span > 0 ? (xx - flatT[i - 1]) / span : 0;
        return flatV[i - 1] + (flatV[i] - flatV[i - 1]) * f;
      }
    }
    return flatV[FREE_CURVE_MAX_POINTS - 1];
  };
  const glslIntegral = (flatT, flatV, x0) => {
    const xx = Math.min(1, Math.max(0, x0));
    let area = Math.min(xx, flatT[0]) * flatV[0];
    if (xx <= flatT[0]) return area;
    for (let i = 1; i < FREE_CURVE_MAX_POINTS; i++) {
      const t0 = flatT[i - 1];
      const t1 = flatT[i];
      if (xx <= t0) return area;
      const d = Math.min(xx, t1) - t0;
      const span = t1 - t0;
      const f = span > 0 ? d / span : 0;
      area += d * flatV[i - 1] + (flatV[i] - flatV[i - 1]) * d * f * 0.5;
      if (xx <= t1) return area;
    }
    area += (xx - flatT[FREE_CURVE_MAX_POINTS - 1]) * flatV[FREE_CURVE_MAX_POINTS - 1];
    return area;
  };
  const shapes = [
    normalizeFreeCurvePoints([0, 0, 1, 2]),
    normalizeFreeCurvePoints([0, 1, 0.5, 3, 1, 1]),
    normalizeFreeCurvePoints([0.25, 2, 0.75, 0.5]),
    normalizeFreeCurvePoints([0, 4, 0.2, 0, 0.4, 4, 0.6, 0, 0.8, 4, 1, 0]),
    normalizeFreeCurvePoints([0, 1, 1, 1]),
  ];
  let evalAgree = true;
  let integralAgree = true;
  for (const shape of shapes) {
    const { flatT, flatV } = padFreeCurveArrays(shape);
    for (let k = 0; k <= 40; k++) {
      const x = k / 40;
      if (!approx(glslEval(flatT, flatV, x), evaluateFreeCurve(shape, x), 1e-6)) evalAgree = false;
      if (!approx(glslIntegral(flatT, flatV, x), integrateFreeCurve(shape, x), 1e-6)) integralAgree = false;
    }
  }
  check('GLSL eval algorithm agrees with evaluateFreeCurve on a grid', evalAgree);
  check('GLSL integral algorithm agrees with integrateFreeCurve on a grid', integralAgree);
  check('generated GLSL carries the eval + integral functions',
    ageFreeEvalGlsl('rotation').includes('float kaloEvalAgeFreeRotation(float x)')
    && ageFreeIntegralGlsl('rotation').includes('float kaloAgeFreeIntegralRotation(float x)')
    && ageFreeEvalGlsl('size').includes('uniform float uAgeCurveSizeFreeT[8];'));
}

// --- 3. stock shader pins (pre-B4) ------------------------------------
{
  check('stock VEL sha256 pin', sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha256(SIM_VEL_FRAG));
  check('stock POS sha256 pin', sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha256(SIM_POS_FRAG));
  check('stock DRAW_VERT sha256 pin', sha256(DRAW_VERT) === '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529', sha256(DRAW_VERT));
  check('stock DRAW_FRAG sha256 pin', sha256(DRAW_FRAG) === 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c', sha256(DRAW_FRAG));
  check('stock GEOM_VERT sha256 pin', sha256(GEOM_VERT) === '3123bc1869559b312371f2c821248d7fa836410ee6a2b11ce16c10b3ecc669fe', sha256(GEOM_VERT));
  check('stock strings carry no B4 trace',
    !SIM_VEL_FRAG.includes('AgeFree') && !DRAW_VERT.includes('AgeFree')
    && !DRAW_FRAG.includes('AgeFree') && !GEOM_VERT.includes('AgeFree'));
}

// --- 4. variants -------------------------------------------------------
{
  const velFree = buildVelocityFragment('', undefined, { ageFreeVelocity: true });
  check('velocity variant: free evaluation replaces the 5-point call',
    velFree.includes('kaloEvalAgeFreeVelocity(ageNorm)')
    && velFree.includes('uniform float uAgeCurveVelocityFreeT[8];')
    && !velFree.includes('kaloEvalCurve5(ageNorm, uAgeCurveVelocity')
    && velFree.includes('kaloEvalCurve5(ageNorm, uAgeCurveForce'));
  const forceFree = buildVelocityFragment('', undefined, { ageFreeForce: true });
  check('force variant: free evaluation replaces the 5-point call',
    forceFree.includes('kaloEvalAgeFreeForce(ageNorm)')
    && !forceFree.includes('kaloEvalCurve5(ageNorm, uAgeCurveForce')
    && forceFree.includes('kaloEvalCurve5(ageNorm, uAgeCurveVelocity'));
  const bothFree = buildVelocityFragment('', undefined, { ageFreeVelocity: true, ageFreeForce: true });
  check('velocity+force variant: both replaced, one function each',
    bothFree.includes('kaloEvalAgeFreeVelocity(ageNorm)') && bothFree.includes('kaloEvalAgeFreeForce(ageNorm)')
    && (bothFree.match(/float kaloEvalAgeFreeVelocity/g) || []).length === 1
    && (bothFree.match(/float kaloEvalAgeFreeForce/g) || []).length === 1);

  const dv = buildDrawVert({ ageFreeSize: true });
  check('draw vertex variant: size evaluation swaps to the free curve',
    dv.includes('kaloEvalAgeFreeSize(vNormAge)')
    && dv.includes('uniform float uAgeCurveSizeFreeT[8];')
    && !dv.includes('kaloEvalCurve5(vNormAge, uAgeCurveSize'));
  const df = buildDrawFrag({ ageFreeOpacity: true });
  check('draw fragment variant: opacity evaluation swaps to the free curve',
    df.includes('kaloEvalAgeFreeOpacity(vNormAge)')
    && df.includes('uniform float uAgeCurveOpacityFreeT[8];')
    && !df.includes('kaloEvalCurve5(vNormAge, uAgeCurveOpacity'));
  const gv = buildGeomVertShader({ ageFreeRotation: true });
  check('geometry variant: integral + midpoint + tail rate swap to the free curve',
    gv.includes('kaloAgeFreeIntegralRotation(1.0)')
    && gv.includes('kaloAgeFreeIntegralRotation(ageSec / ageMax)')
    && gv.includes('kaloEvalAgeFreeRotation(0.5)')
    && gv.includes('(ageSec - ageMax) * kaloEvalAgeFreeRotation(1.0)')
    && gv.includes('float kaloAgeFreeIntegralRotation(float x)')
    && !gv.includes('uAgeCurveRotation[4]'));
  check('geometry variant composes with the spin override',
    buildGeomVertShader({ ageFreeRotation: true, spinChannel: true })
      .includes('spinAng = texture2D(uSpinTex, aTexCoord).x;'));
}

// --- 5. texture-unit accounting ---------------------------------------
{
  check('sampler counts unchanged by every B4 variant',
    samplerCount(buildVelocityFragment('', undefined, { ageFreeVelocity: true, ageFreeForce: true })) === samplerCount(SIM_VEL_FRAG)
    && samplerCount(buildDrawVert({ ageFreeSize: true })) === samplerCount(DRAW_VERT)
    && samplerCount(buildDrawFrag({ ageFreeOpacity: true })) === samplerCount(DRAW_FRAG)
    && samplerCount(buildGeomVertShader({ ageFreeRotation: true })) === samplerCount(GEOM_VERT),
    `vel ${samplerCount(SIM_VEL_FRAG)} geom ${samplerCount(GEOM_VERT)}`);
  check('velocity fragment stays at the 16-unit floor',
    samplerCount(buildVelocityFragment('', undefined, { ageFreeVelocity: true, ageFreeForce: true })) === 16);
}

// --- 6. capability ------------------------------------------------------
{
  const idle = getWebgpuComputeCapabilityReport(cfg({}));
  check('defaults request no age-free-curves', !idle.requestedFeatures.includes('age-free-curves'));
  const on = getWebgpuComputeCapabilityReport(cfg({
    gpgpuAgeCurveRotationEnabled: true, gpgpuAgeCurveRotationFreeEnabled: true,
    gpgpuAgeCurveRotationFreePoints: [0, 0, 1, 2],
  }));
  check("standing non-identity free mode requests 'age-free-curves', unsupported",
    on.requestedFeatures.includes('age-free-curves') && on.unsupportedFeatures.includes('age-free-curves') && on.canRunRequestedConfig === false);
  const flat = getWebgpuComputeCapabilityReport(cfg({
    gpgpuAgeCurveRotationEnabled: true, gpgpuAgeCurveRotationFreeEnabled: true,
  }));
  check('standing identity free mode requests nothing', !flat.requestedFeatures.includes('age-free-curves'));
}

// --- 7. key defaults -----------------------------------------------------
{
  const caps = ['Size', 'Opacity', 'Velocity', 'Force', 'Rotation'];
  check('10 B4 keys at inert defaults',
    caps.every((cap) => D[`gpgpuAgeCurve${cap}FreeEnabled`] === false
      && JSON.stringify(D[`gpgpuAgeCurve${cap}FreePoints`]) === '[0,1,1,1]'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
