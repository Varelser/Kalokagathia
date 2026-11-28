// Layer 1 gate item 12 follow-up: the chroma key Core / Edge
// separation (lib/chromaKeyMath.ts + components/chromaKeyPass.ts).
//
// The shipped Phase 15 keyer used one smoothstep for the matte
// and failed gate item 12 on criterion (2): the particle
// region's alpha >= 247 share was 0.8407 against the >= 0.95
// line (the fringe ring where sprite colour mixes with the
// key background was keyed away with the background). The fix
// separates the systems per the standard practice in the
// Layer 1 material: Edge matte = the legacy loose clip kept
// verbatim, Core matte = a strong clip derived from the same
// authored parameters with the keyed-out region eroded by one
// texel, final alpha = max(core, edge), and a despill stage
// with luminance compensation.
//
// The gate criteria themselves are NOT re-judged here (the
// real-GPU re-measure is the gate side's separated follow-up,
// and the judgement lines do not move). This test pins the CPU
// twin on a synthetic scene that mimics the gate's region
// definitions and thresholds (record §項目12): key-green
// background, soft sprite discs (the finished frame's fringe
// is a coverage mix, as the gate record describes), regions
// split by the control's 8-bit key-green match.
//
// Pins:
// (a) structure: the pass takes its fragment from
//     lib/chromaKeyMath.ts, keeps its authored defaults, and
//     the fragment carries the core/edge/despill stages.
// (b) synthetic-scene criteria, gate-shaped: (1) background
//     region alpha <= 8 share >= 0.95; (2) particle region
//     alpha >= 247 share >= 0.95 under the new keyer while
//     the legacy keyer stays below 0.95 on the same scene;
//     (3) the control is uniformly opaque (by construction,
//     share 1.0 >= 0.999) and solid interiors keep
//     alpha >= 247 at >= 0.999.
// (c) pointwise floor: the new alpha never drops below the
//     legacy alpha anywhere on the scene.
// (d) mixing-ratio contrast: per particle colour, the coverage
//     at which the matte first reaches >= 247/255 is strictly
//     lower for the new per-pixel matte than for the legacy
//     one (the range the legacy keyer failed is recorded).
// (e) adjacency seal: a particle-region fringe pixel the
//     per-pixel keyer fully keys out is sealed to >= 247/255
//     when it touches solid foreground, and stays transparent
//     in isolation; an isolated pixel inside the core ramp
//     keeps a partial alpha (gradation is preserved).
// (f) despill: spill = 0 leaves RGB untouched; with spill the
//     key-direction excess shrinks while the Rec.709 luminance
//     is preserved exactly (and the uncompensated form is
//     shown to lose luminance, as the material warns).
// (g) item 12 follow-up (V3): the one-texel erosion is gated
//     on the pixel's own matte. The first re-measure recovered
//     criterion (2) to 1.0000 but dropped criterion (1) to
//     0.9343: the unconditional 3x3 max wrote neighbour core
//     values into background pixels no sprite had touched
//     (arithmetically 97.2% of the alpha >= 247 background
//     failures could only have arrived that way — see
//     LAYER1_ITEM12_FOLLOWUP_INVESTIGATION.md). Pins: an
//     untouched key-colour pixel surrounded by solid white
//     keeps alpha <= 8/255, and a point-particle-dominated
//     scene (many tiny discs, measured with integer 8-bit
//     semantics per the investigation's note) holds both
//     criteria shapes at >= 0.99.
// Run: node scripts/layer1-chroma-core-edge.test.mjs

import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.layer1-chroma-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

await build({
  stdin: {
    contents: `
      export {
        CHROMA_KEY_FRAGMENT,
        CHROMA_KEY_DEFAULTS,
        applyChromaKeyImage,
        chromaKeyDistance,
        chromaEdgeMatte,
        chromaCoreClip,
        legacyChromaKeyAlpha,
        despillChromaColor,
        chromaSmoothstep,
      } from './lib/chromaKeyMath.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const M = await import(pathToFileURL(BUNDLE).href);
  const {
    CHROMA_KEY_FRAGMENT, CHROMA_KEY_DEFAULTS, applyChromaKeyImage,
    chromaKeyDistance, chromaEdgeMatte, chromaCoreClip, legacyChromaKeyAlpha,
    despillChromaColor, chromaSmoothstep,
  } = M;

  const KEY = [0, 1, 0];
  const SIM = 0.08;
  const SMOOTH = 0.04;
  const SPILL = 0.5;
  const ALPHA_HI = 247 / 255;
  const ALPHA_LO = 8 / 255;
  const params = { keyColor: KEY, similarity: SIM, smoothness: SMOOTH, spill: SPILL };

  // ---------- (a) structure ----------
  const passSrc = readFileSync(join(ROOT, 'components', 'chromaKeyPass.ts'), 'utf8');
  check('a1: pass imports the fragment from lib/chromaKeyMath',
    passSrc.includes("from '../lib/chromaKeyMath'") && passSrc.includes('CHROMA_KEY_FRAGMENT'));
  check('a2: pass keeps authored defaults',
    passSrc.includes('similarity = 0.08') && passSrc.includes('smoothness = 0.04')
    && passSrc.includes('spill = 0.5') && passSrc.includes("'#00ff00'"));
  check('a3: no inline legacy fragment left in the pass', !passSrc.includes('smoothstep(uSimilarity'));
  check('a4: fragment carries edge + core + max + erosion + compensated despill',
    CHROMA_KEY_FRAGMENT.includes('chromaEdgeMatte')
    && CHROMA_KEY_FRAGMENT.includes('chromaCoreClip')
    && CHROMA_KEY_FRAGMENT.includes('float alpha = max(core, edge);')
    && CHROMA_KEY_FRAGMENT.includes('uTexelSize')
    && CHROMA_KEY_FRAGMENT.includes('removedLum')
    && CHROMA_KEY_FRAGMENT.includes('(1.0 - edge)'));
  check('a5: module defaults match the pass defaults',
    CHROMA_KEY_DEFAULTS.similarity === SIM && CHROMA_KEY_DEFAULTS.smoothness === SMOOTH
    && CHROMA_KEY_DEFAULTS.spill === SPILL
    && CHROMA_KEY_DEFAULTS.keyColor[0] === 0 && CHROMA_KEY_DEFAULTS.keyColor[1] === 1
    && CHROMA_KEY_DEFAULTS.keyColor[2] === 0);

  // ---------- synthetic scene (gate-shaped) ----------
  const W = 160;
  const H = 120;
  const discs = [
    { cx: 30, cy: 30, r: 9, color: [1, 1, 1], name: 'white' },
    { cx: 72, cy: 28, r: 8, color: [0.5, 0.5, 0.5], name: 'grey' },
    { cx: 116, cy: 32, r: 10, color: [0.25, 0.45, 1], name: 'blue' },
    { cx: 32, cy: 80, r: 8, color: [1, 0.2, 0.2], name: 'red' },
    { cx: 74, cy: 82, r: 9, color: [0.15, 0.15, 0.17], name: 'dark' },
    { cx: 118, cy: 84, r: 8, color: [0.55, 0.85, 0.35], name: 'greenish' },
    { cx: 52, cy: 54, r: 3, color: [1, 1, 1], name: 'white-small' },
    { cx: 96, cy: 58, r: 3, color: [0.25, 0.45, 1], name: 'blue-small' },
    { cx: 140, cy: 58, r: 2.5, color: [0.5, 0.5, 0.5], name: 'grey-small' },
  ];
  const raw = new Float32Array(W * H * 3);
  const solid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let bestC = 0;
      let bestColor = KEY;
      for (const d of discs) {
        const distC = Math.hypot(x - d.cx, y - d.cy);
        const c = 1 - chromaSmoothstep(0.55 * d.r, d.r, distC);
        if (c > bestC) { bestC = c; bestColor = d.color; }
      }
      const i = y * W + x;
      raw[i * 3] = KEY[0] + (bestColor[0] - KEY[0]) * bestC;
      raw[i * 3 + 1] = KEY[1] + (bestColor[1] - KEY[1]) * bestC;
      raw[i * 3 + 2] = KEY[2] + (bestColor[2] - KEY[2]) * bestC;
      solid[i] = bestC >= 0.99 ? 1 : 0;
    }
  }
  // The control export is an 8-bit PNG: quantize before both
  // the region split and the keyer input, as on the gate flight.
  const img = new Float32Array(W * H * 3);
  for (let i = 0; i < img.length; i++) img[i] = Math.round(raw[i] * 255) / 255;

  const isBackground = (i) => img[i * 3] <= 8 / 255 && img[i * 3 + 1] >= 247 / 255 && img[i * 3 + 2] <= 8 / 255;
  let bgCount = 0;
  let particleCount = 0;
  let solidCount = 0;
  for (let i = 0; i < W * H; i++) {
    if (isBackground(i)) bgCount += 1; else particleCount += 1;
    if (solid[i]) solidCount += 1;
  }
  check('scene: both regions are non-trivial', bgCount > 1000 && particleCount > 500,
    `bg=${bgCount} particle=${particleCount} solid=${solidCount}`);

  const keyed = applyChromaKeyImage(img, W, H, params);
  let bgOk = 0;
  let particleOk = 0;
  let particleLegacyOk = 0;
  let solidOk = 0;
  let floorHeld = true;
  for (let i = 0; i < W * H; i++) {
    const a = keyed[i * 4 + 3];
    const color = [img[i * 3], img[i * 3 + 1], img[i * 3 + 2]];
    const legacy = legacyChromaKeyAlpha(chromaKeyDistance(color, KEY), SIM, SMOOTH);
    if (a < legacy - 1e-12) floorHeld = false;
    if (isBackground(i)) {
      if (a <= ALPHA_LO) bgOk += 1;
    } else {
      if (a >= ALPHA_HI) particleOk += 1;
      if (legacy >= ALPHA_HI) particleLegacyOk += 1;
    }
    if (solid[i] && a >= ALPHA_HI) solidOk += 1;
  }
  const frac1 = bgOk / bgCount;
  const frac2 = particleOk / particleCount;
  const frac2Legacy = particleLegacyOk / particleCount;
  const frac3Solid = solidOk / solidCount;
  console.log(`  scene fractions: (1) bg alpha<=8: ${frac1.toFixed(4)}  (2) particle alpha>=247: ${frac2.toFixed(4)}  legacy (2): ${frac2Legacy.toFixed(4)}  solid interiors: ${frac3Solid.toFixed(4)}`);
  check('b1: criterion (1) shape — background region alpha <= 8 share >= 0.95', frac1 >= 0.95, `${frac1.toFixed(4)}`);
  check('b2: criterion (2) shape — particle region alpha >= 247 share >= 0.95 (new keyer)', frac2 >= 0.95, `${frac2.toFixed(4)}`);
  check('b3: contrast — the legacy keyer fails criterion (2) on the same scene', frac2Legacy < 0.95, `${frac2Legacy.toFixed(4)}`);
  check('b4: criterion (3) shape — solid interiors keep alpha >= 247 at >= 0.999', frac3Solid >= 0.999, `${frac3Solid.toFixed(4)}`);
  check('c: pointwise floor — new alpha >= legacy alpha everywhere', floorHeld);

  // ---------- (d) mixing-ratio contrast ----------
  console.log('  mixing-ratio contrast (first coverage reaching alpha >= 247/255):');
  for (const d of discs.slice(0, 6)) {
    let cLegacy = null;
    let cNew = null;
    for (let c = 0.005; c <= 1.0001 && (cLegacy === null || cNew === null); c += 0.0025) {
      const color = [
        KEY[0] + (d.color[0] - KEY[0]) * c,
        KEY[1] + (d.color[1] - KEY[1]) * c,
        KEY[2] + (d.color[2] - KEY[2]) * c,
      ];
      const dist = chromaKeyDistance(color, KEY);
      if (cLegacy === null && legacyChromaKeyAlpha(dist, SIM, SMOOTH) >= ALPHA_HI) cLegacy = c;
      const perPixel = Math.max(chromaCoreClip(dist, SIM, SMOOTH), chromaEdgeMatte(dist, SIM, SMOOTH));
      if (cNew === null && perPixel >= ALPHA_HI) cNew = c;
    }
    console.log(`    ${d.name}: legacy ${cLegacy?.toFixed(3)} -> new ${cNew?.toFixed(3)} (legacy failed below ${cLegacy?.toFixed(3)})`);
    check(`d: ${d.name} — new matte reaches >= 247 at strictly lower coverage`, cNew !== null && cLegacy !== null && cNew < cLegacy,
      `legacy=${cLegacy?.toFixed(3)} new=${cNew?.toFixed(3)}`);
  }

  // ---------- (e) adjacency seal + isolated gradation ----------
  const tiny = (center, fill) => {
    const a = new Float32Array(3 * 3 * 3);
    for (let i = 0; i < 9; i++) { a[i * 3] = fill[0]; a[i * 3 + 1] = fill[1]; a[i * 3 + 2] = fill[2]; }
    a[4 * 3] = center[0]; a[4 * 3 + 1] = center[1]; a[4 * 3 + 2] = center[2];
    return applyChromaKeyImage(a, 3, 3, params)[4 * 4 + 3];
  };
  // Blue fringe at coverage 0.035: in the particle region by
  // the gate's 8-bit definition (B = 9/255 > 8), yet the
  // per-pixel keyer leaves it at ~0 alpha.
  const fringeBlue = [0.25 * 0.035, 1 - 0.55 * 0.035, 0.035];
  const fringeDist = chromaKeyDistance(fringeBlue, KEY);
  const fringePerPixel = Math.max(chromaCoreClip(fringeDist, SIM, SMOOTH), chromaEdgeMatte(fringeDist, SIM, SMOOTH));
  check('e1: the fringe pixel is particle-region and per-pixel alpha is ~0',
    fringeBlue[2] > 8 / 255 && fringePerPixel <= ALPHA_LO, `perPixel=${fringePerPixel.toFixed(4)}`);
  check('e2: touching solid foreground seals it to >= 247/255', tiny(fringeBlue, [1, 1, 1]) >= ALPHA_HI);
  check('e3: in isolation it stays transparent', tiny(fringeBlue, KEY) <= ALPHA_LO);
  // Gradation: an isolated pixel at distance 0.05 sits inside
  // the core ramp and keeps a strictly partial alpha.
  const mid = [0.05 / Math.SQRT2, 1, 0.05 / Math.SQRT2];
  const midAlpha = tiny(mid, KEY);
  check('e4: isolated mid-ramp pixel keeps a partial alpha', midAlpha > 0 && midAlpha < 1, `alpha=${midAlpha.toFixed(4)}`);

  // ---------- (f) despill ----------
  const noSpill = applyChromaKeyImage(img, W, H, { ...params, spill: 0 });
  let rgbUntouched = true;
  for (let i = 0; i < W * H * 4; i++) {
    if (i % 4 !== 3 && Math.abs(noSpill[i] - img[(i - (i % 4)) / 4 * 3 + (i % 4)]) > 0) rgbUntouched = false;
  }
  check('f1: spill = 0 leaves the RGB untouched', rgbUntouched);

  const LUMA = [0.2126, 0.7152, 0.0722];
  const lum = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
  const kdOf = (k) => {
    const v = [k[0] + 0.00001, k[1] + 0.00001, k[2] + 0.00001];
    const len = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / len, v[1] / len, v[2] / len];
  };
  const excessOf = (c, k) => {
    const kd = kdOf(k);
    const grey = (c[0] + c[1] + c[2]) * 0.3333333;
    return Math.max((c[0] * kd[0] + c[1] * kd[1] + c[2] * kd[2]) - grey * (kd[0] + kd[1] + kd[2]), 0);
  };
  let lumPreserved = true;
  let excessShrinks = true;
  let uncompensatedDrops = true;
  for (const P of [[1, 1, 1], [0.25, 0.45, 1], [0.5, 0.5, 0.5]]) {
    for (const c of [0.03, 0.05, 0.08]) {
      const color = [KEY[0] + (P[0] - KEY[0]) * c, KEY[1] + (P[1] - KEY[1]) * c, KEY[2] + (P[2] - KEY[2]) * c];
      const edge = chromaEdgeMatte(chromaKeyDistance(color, KEY), SIM, SMOOTH);
      const weight = 1 - edge;
      if (weight <= 0 || excessOf(color, KEY) <= 0) continue;
      const out = despillChromaColor(color, KEY, SPILL, weight);
      if (Math.abs(lum(out) - lum(color)) > 1e-9) lumPreserved = false;
      if (!(excessOf(out, KEY) < excessOf(color, KEY))) excessShrinks = false;
      // The uncompensated form (subtract only) must lose
      // luminance — the reason compensation is mandatory.
      const kd = kdOf(KEY);
      const amount = excessOf(color, KEY) * SPILL * weight;
      const bare = [color[0] - kd[0] * amount, color[1] - kd[1] * amount, color[2] - kd[2] * amount];
      if (!(lum(bare) < lum(color) - 1e-6)) uncompensatedDrops = false;
    }
  }
  check('f2: despill preserves Rec.709 luminance exactly (compensation)', lumPreserved);
  check('f3: despill reduces the key-direction excess', excessShrinks);
  check('f4: without compensation the luminance would drop (contrast)', uncompensatedDrops);
  const keyedOut = despillChromaColor(KEY, KEY, SPILL, 1);
  check('f5: pure key colour despills to finite values', keyedOut.every(Number.isFinite));
  const opaqueOut = despillChromaColor([1, 1, 1], KEY, SPILL, 0);
  check('f6: zero key-likeness weight leaves the colour untouched',
    opaqueOut[0] === 1 && opaqueOut[1] === 1 && opaqueOut[2] === 1);

  // ---------- (g) erosion gate (V3) + point-particle scene ----------
  // The defect in one pixel: a pure key-colour centre (own
  // matte exactly 0) surrounded by solid white. Under the
  // unconditional 3x3 max this centre inherited core = 1;
  // gated on its own matte it must stay transparent.
  check('g1: untouched key-colour pixel surrounded by solid stays transparent',
    tiny(KEY, [1, 1, 1]) <= ALPHA_LO, `alpha=${tiny(KEY, [1, 1, 1]).toFixed(4)}`);

  // Point-particle scene: many tiny soft discs (the gate
  // flight's actual regime — 16,384 point particles against
  // a few large discs here would understate the perimeter
  // density that drove the background failure). Measured
  // with integer semantics: the scene is built and split in
  // 8-bit integers, as the gate's analysis reads the export.
  const PW = 320;
  const PH = 240;
  let lcg = 123456789;
  const rnd = () => (lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const palette = discs.slice(0, 6).map((d) => d.color);
  const points = [];
  for (let k = 0; k < 700; k++) {
    points.push({
      cx: 2 + rnd() * (PW - 5),
      cy: 2 + rnd() * (PH - 5),
      r: 1.1 + rnd() * 1.2,
      color: palette[k % palette.length],
    });
  }
  const praw = new Float64Array(PW * PH * 3);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      let bestC = 0;
      let bestColor = KEY;
      for (const d of points) {
        const distC = Math.hypot(x - d.cx, y - d.cy);
        if (distC > d.r) continue;
        const c = 1 - chromaSmoothstep(0.55 * d.r, d.r, distC);
        if (c > bestC) { bestC = c; bestColor = d.color; }
      }
      const i = y * PW + x;
      praw[i * 3] = KEY[0] + (bestColor[0] - KEY[0]) * bestC;
      praw[i * 3 + 1] = KEY[1] + (bestColor[1] - KEY[1]) * bestC;
      praw[i * 3 + 2] = KEY[2] + (bestColor[2] - KEY[2]) * bestC;
    }
  }
  const pint = new Float64Array(PW * PH * 3);
  const pimg = new Float64Array(PW * PH * 3);
  for (let i = 0; i < pint.length; i++) {
    pint[i] = Math.round(praw[i] * 255);
    pimg[i] = pint[i] / 255;
  }
  const isBgInt = (i) => pint[i * 3] <= 8 && pint[i * 3 + 1] >= 247 && pint[i * 3 + 2] <= 8;
  let pBg = 0;
  let pParticle = 0;
  for (let i = 0; i < PW * PH; i++) {
    if (isBgInt(i)) pBg += 1; else pParticle += 1;
  }
  check('g2: point scene is point-dominated (particle region is a small share)',
    pParticle > 1000 && pParticle < PW * PH * 0.15, `bg=${pBg} particle=${pParticle}`);
  const pkeyed = applyChromaKeyImage(pimg, PW, PH, params);
  let pBgOk = 0;
  let pParticleOk = 0;
  for (let i = 0; i < PW * PH; i++) {
    const a = pkeyed[i * 4 + 3];
    if (isBgInt(i)) {
      if (a <= ALPHA_LO) pBgOk += 1;
    } else if (a >= ALPHA_HI) pParticleOk += 1;
  }
  const pFrac1 = pBgOk / pBg;
  const pFrac2 = pParticleOk / pParticle;
  console.log(`  point scene fractions: (1) bg alpha<=8: ${pFrac1.toFixed(4)}  (2) particle alpha>=247: ${pFrac2.toFixed(4)}`);
  check('g3: point scene criterion (1) shape holds at >= 0.99', pFrac1 >= 0.99, `${pFrac1.toFixed(4)}`);
  check('g4: point scene criterion (2) shape holds at >= 0.99', pFrac2 >= 0.99, `${pFrac2.toFixed(4)}`);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
