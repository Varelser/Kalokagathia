// Layer 1 WP7 Phase C3 — Gaussian splat column data input.
//
// C1 built the splat primitive (pool form), C2 completed the
// pool supply. C3 adds the second input form: an independent
// column set (one row = one splat) converted render-side by
// lib/gpgpuSplatColumns.ts into the primitive's payloads —
// centre / param / rotation in exactly the pool layouts, plus
// the DC colour payload. Pinned here (node side):
//  (a) the parser and the payload layout: round-trip of every
//      channel (centre, scale, quaternion normalised,
//      opacity clamped, DC colour RAW), defaults, the
//      hold-previous null rule, the row cap, and the layout
//      when N differs from the pool texSize (ceil(√N) grid,
//      zero-filled padding);
//  (b) the sort chain: the columns depth twin
//      (splatColumnsSortEntry) feeding a JS twin of the
//      shared bitonic network over the pow2 sort grid — the
//      first `count` slots are precisely the real splats,
//      far to near, carrying payload uvs; padding sits at
//      the tail;
//  (c) the colour rule: the DC colour is a colour feature —
//      active only in the columns form with colour columns
//      present AND the colour master on; master off leaves
//      the single tint;
//  (d) the default configuration's identity: stock points
//      strings, the default render plan, and the form
//      resolution (no column set / splat key off = pool);
//  (e) source pins for the wiring (draw assets, scene sort
//      call, visual supply branch, render-output geometry).
// The real-GPU appearance (columns splats on screen, sort
// order on screen) is a gate-side item, NOT judged here.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.wp7c3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const arrApprox = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => approx(v, b[i], eps));

// Stock points-draw pins (pre-WP7; the builders are untouched
// by this phase — the splat is a separate material).
const STOCK_VERT_SHA256 = '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529';
const STOCK_FRAG_SHA256 = 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c';
// Splat pins after the C3 DC colour chunk (the C1 test
// carries the same values).
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
      export { SPLAT_COLUMNS_SORT_DEPTH_FRAG } from './components/gpgpuShaderSimulationSort.ts';
      export { buildSplatParamData } from './lib/gpgpuSplat.ts';
      export {
        SPLAT_COLUMNS_MAX_ROWS, SPLAT_COLUMNS_PAD_VIEW_Z,
        parseSplatColumns, buildSplatColumns, createSplatColumnsTextures,
        buildSplatInstanceTexCoords, splatColumnsTexSize, splatColumnsSortTexSize,
        splatColumnsSortEntry, resolveSplatInputForm, splatColumnsColorActive,
        getSplatColumns, setSplatColumns, subscribeSplatColumns,
      } from './lib/gpgpuSplatColumns.ts';
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
    buildSplatVert, SPLAT_VERT, SPLAT_FRAG, SPLAT_COLUMNS_SORT_DEPTH_FRAG,
    buildSplatParamData,
    SPLAT_COLUMNS_MAX_ROWS, SPLAT_COLUMNS_PAD_VIEW_Z,
    parseSplatColumns, buildSplatColumns, createSplatColumnsTextures,
    buildSplatInstanceTexCoords, splatColumnsTexSize, splatColumnsSortTexSize,
    splatColumnsSortEntry, resolveSplatInputForm, splatColumnsColorActive,
    getSplatColumns, setSplatColumns, subscribeSplatColumns,
    getGpgpuRenderOutputPlan,
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

  // ── (d) stock identity / default form ──────────────────
  check('stock points vert pin unchanged', sha256(pointsVert(cfg({}))) === STOCK_VERT_SHA256, sha256(pointsVert(cfg({}))));
  check('stock points frag pin unchanged', sha256(pointsFrag(cfg({}))) === STOCK_FRAG_SHA256, sha256(pointsFrag(cfg({}))));
  check('stock points strings unchanged with splats on (no columns)',
    sha256(pointsVert(cfg({ gpgpuSplatEnabled: true }))) === STOCK_VERT_SHA256
      && sha256(pointsFrag(cfg({ gpgpuSplatEnabled: true }))) === STOCK_FRAG_SHA256);
  check('splat vert pin (C3 DC colour chunk)', sha256(buildSplatVert()) === SPLAT_VERT_SHA256, sha256(buildSplatVert()));
  check('splat frag pin unchanged', sha256(SPLAT_FRAG) === SPLAT_FRAG_SHA256, sha256(SPLAT_FRAG));
  const route = { enabled: true, resolvedEngine: 'webgl-gpgpu' };
  check('default plan has no splats branch', getGpgpuRenderOutputPlan(cfg({}), route).splats === false);
  check('plan gains the splats branch with the key on', getGpgpuRenderOutputPlan(cfg({ gpgpuSplatEnabled: true }), route).splats === true);
  check('store starts empty (pool form is the default path)', getSplatColumns() === null);
  check('form: enabled + no columns = pool', resolveSplatInputForm(cfg({ gpgpuSplatEnabled: true }), null) === 'pool');
  check('form: disabled + columns = pool', resolveSplatInputForm(cfg({}), { count: 3 }) === 'pool');

  // ── (a) parser + payload layout ────────────────────────
  const FULL_CSV = [
    'x,y,z,scaleX,scaleY,scaleZ,quatX,quatY,quatZ,quatW,opacity,colorR,colorG,colorB',
    '1,2,3,0.5,0.6,0.7,0,0,0,2,0.25,2.5,0.5,0.25',
    '-1,0.5,4,1.5,1.5,1.5,0,0,0.70710678,0.70710678,1.7,0.1,0.2,0.3',
    '0,0,0,2,2,2,0,0,0,0,0,1,1,1',
    '5,-5,2.5,0.25,0.5,0.75,1,0,0,0,-0.5,0,0,0',
    '3,3,3,1,1,1,0,1,0,0,0.5,0.9,0.8,0.7',
  ].join('\n');
  const cols = parseSplatColumns(FULL_CSV);
  check('full table parses', !!cols);
  check('count = row count', cols.count === 5, String(cols?.count));
  check('texSize = ceil(sqrt(N))', cols.texSize === 3 && splatColumnsTexSize(5) === 3);
  check('payload lengths = texSize^2 * 4',
    cols.centerData.length === 36 && cols.paramData.length === 36
      && cols.rotData.length === 36 && cols.colorData.length === 36);
  check('hasColor with colour columns present', cols.hasColor === true);
  const texel = (arr, i) => [arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]];
  check('row 0 centre round-trips', arrApprox(texel(cols.centerData, 0), [1, 2, 3, 1]));
  check('row 0 param round-trips (scale + opacity)', arrApprox(texel(cols.paramData, 0), [0.5, 0.6, 0.7, 0.25]));
  check('row 0 quat normalised (0,0,0,2) -> identity', arrApprox(texel(cols.rotData, 0), [0, 0, 0, 1]));
  check('row 0 DC colour is RAW (2.5 not normalised)', arrApprox(texel(cols.colorData, 0), [2.5, 0.5, 0.25, 1]));
  check('row 1 opacity clamped to 1', approx(cols.paramData[1 * 4 + 3], 1));
  check('row 1 quat kept (already unit)', arrApprox(texel(cols.rotData, 1), [0, 0, 0.70710678, 0.70710678], 1e-5));
  check('row 2 zero quat -> identity', arrApprox(texel(cols.rotData, 2), [0, 0, 0, 1]));
  check('row 3 opacity clamped to 0', approx(cols.paramData[3 * 4 + 3], 0));
  check('row 3 quat (1,0,0,0) kept', arrApprox(texel(cols.rotData, 3), [1, 0, 0, 0]));
  check('padding texel: opacity 0, identity rot, colour 0',
    approx(cols.paramData[8 * 4 + 3], 0) && arrApprox(texel(cols.rotData, 8), [0, 0, 0, 1])
      && arrApprox(texel(cols.colorData, 8), [0, 0, 0, 0]) && approx(cols.centerData[8 * 4 + 3], 1));

  // Pool-form layout equivalence: the columns param/rot
  // texel for an authored splat equals buildSplatParamData's
  // uniform bake of the same values.
  const poolBake = buildSplatParamData({ texSize: 1, scale: [0.5, 0.6, 0.7], opacity: 0.25 });
  check('param layout matches the pool bake layout',
    arrApprox(texel(cols.paramData, 0), Array.from(poolBake.paramData))
      && arrApprox(texel(cols.rotData, 0), Array.from(poolBake.rotData)));

  // Textures carry the payloads verbatim.
  const texs = createSplatColumnsTextures(cols);
  check('textures are texSize squares',
    texs.centerTex.image.width === 3 && texs.centerTex.image.height === 3
      && texs.paramTex.image.width === 3 && texs.colorTex.image.height === 3);
  check('texture payloads are the column payloads',
    texs.centerTex.image.data === cols.centerData && texs.paramTex.image.data === cols.paramData
      && texs.rotTex.image.data === cols.rotData && texs.colorTex.image.data === cols.colorData);

  // Defaults / partial columns.
  const minCols = parseSplatColumns(['x,y', '7,8', '9,10', '-1,-2'].join('\n'));
  check('x/y-only table parses', !!minCols && minCols.count === 3);
  check('defaults: z 0, scale 1, opacity 1, quat identity, colour 1, hasColor false',
    !!minCols && minCols.hasColor === false
      && arrApprox(texel(minCols.centerData, 0), [7, 8, 0, 1])
      && arrApprox(texel(minCols.paramData, 0), [1, 1, 1, 1])
      && arrApprox(texel(minCols.rotData, 0), [0, 0, 0, 1])
      && arrApprox(texel(minCols.colorData, 0), [1, 1, 1, 1]));
  const uniCols = parseSplatColumns(['x,y,scale', '0,0,2.5', '1,1,3'].join('\n'));
  check('uniform scale column feeds all axes',
    !!uniCols && arrApprox(texel(uniCols.paramData, 1), [3, 3, 3, 1]));
  const ragged = parseSplatColumns(['x,y', '4,5', ',6', '7,'].join('\n'));
  check('null cells hold the previous valid value',
    !!ragged && approx(ragged.centerData[1 * 4], 4) && approx(ragged.centerData[2 * 4 + 1], 6));
  const partialColor = parseSplatColumns(['x,y,colorG', '0,0,0.25', '1,1,0.75'].join('\n'));
  check('one colour column is enough for hasColor; missing channels default 1',
    !!partialColor && partialColor.hasColor === true
      && arrApprox(texel(partialColor.colorData, 1), [1, 0.75, 1, 1]));
  check('non-point text parses to null', parseSplatColumns('a,b\nfoo,bar') === null);
  check('empty text parses to null', parseSplatColumns('') === null);

  // Layout when N differs from the pool texSize.
  const rows100 = ['x,y,z,opacity'];
  for (let i = 0; i < 100; i++) rows100.push(`${i},${i + 1},${i + 2},${(i % 10) / 10}`);
  const cols100 = parseSplatColumns(rows100.join('\n'));
  check('N=100: texSize 10 (independent of a 128 pool)',
    !!cols100 && cols100.texSize === 10 && cols100.texSize !== 128);
  check('N=100: texel 99 is row 99', !!cols100 && arrApprox(texel(cols100.centerData, 99), [99, 100, 101, 1]));
  check('texSize helper pins', splatColumnsTexSize(0) === 0 && splatColumnsTexSize(1) === 1
    && splatColumnsTexSize(100) === 10 && splatColumnsTexSize(8192) === 91);

  // Row cap.
  const bigTable = {
    columns: ['x', 'y'],
    rows: Array.from({ length: SPLAT_COLUMNS_MAX_ROWS + 808 }, (_, i) => [i, i + 1]),
    mins: [0, 1],
    maxs: [8999, 9000],
  };
  const capped = buildSplatColumns(bigTable);
  check('row cap = SPLAT_COLUMNS_MAX_ROWS', !!capped && capped.count === SPLAT_COLUMNS_MAX_ROWS,
    String(capped?.count));

  // ── (b) sort chain twin ────────────────────────────────
  // Centres in front of the camera (it looks down -z), so
  // viewZ = -z: splat depths are 5, 1, 4, 2, 3.
  const sortCols = parseSplatColumns(['x,y,z', '0,0,-5', '0,0,-1', '0,0,-4', '0,0,-2', '0,0,-3'].join('\n'));
  const IDENTITY_VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const P = splatColumnsSortTexSize(sortCols);
  check('sort grid side is the next pow2 >= payload side', P === 4, String(P));
  // Depth stage twin.
  const depthEntries = [];
  for (let k = 0; k < P * P; k++) depthEntries.push(splatColumnsSortEntry(sortCols, k, IDENTITY_VIEW));
  check('depth entry carries the payload uv',
    arrApprox(depthEntries[2].uv, [2.5 / 3, 0.5 / 3]) && approx(depthEntries[2].viewZ, 4));
  check('slots past count are pad depth',
    depthEntries.slice(5).every((e) => e.viewZ === SPLAT_COLUMNS_PAD_VIEW_Z));
  // Bitonic twin (SORT_BITONIC_FRAG's math, runDepthSortPass's
  // stage loop) over the sort grid.
  const bitonicTwin = (entries, fw) => {
    let data = entries.slice();
    const logN = Math.log2(fw * fw);
    for (let stage = 0; stage < logN; stage++) {
      for (let step = stage; step >= 0; step--) {
        const next = data.slice();
        for (let i = 0; i < fw * fw; i++) {
          const stepSize = Math.pow(2, step);
          const blockSzDir = Math.pow(2, stage + 1);
          const bitInStep = Math.floor(i / stepSize) % 2;
          const l = i + (bitInStep < 0.5 ? stepSize : -stepSize);
          if (l < 0 || l >= fw * fw) { next[i] = data[i]; continue; }
          const origAsc = (Math.floor(i / blockSzDir) % 2) < 0.5;
          let shouldSwap;
          if (i < l) shouldSwap = origAsc ? (data[i].viewZ < data[l].viewZ) : (data[i].viewZ > data[l].viewZ);
          else shouldSwap = origAsc ? (data[i].viewZ > data[l].viewZ) : (data[i].viewZ < data[l].viewZ);
          next[i] = shouldSwap ? data[l] : data[i];
        }
        data = next;
      }
    }
    return data;
  };
  const sorted = bitonicTwin(depthEntries, P);
  const expectedOrder = [0, 2, 4, 3, 1]; // viewZ = 5, 4, 3, 2, 1 -> far to near
  const payloadUvOf = (idx) => [((idx % 3) + 0.5) / 3, (Math.floor(idx / 3) + 0.5) / 3];
  check('first count slots are the real splats, far to near',
    expectedOrder.every((splatIdx, slot) => arrApprox(sorted[slot].uv, payloadUvOf(splatIdx))),
    JSON.stringify(sorted.slice(0, 5).map((e) => e.uv)));
  check('sorted viewZ is descending over the whole grid',
    sorted.every((e, i) => i === 0 || sorted[i - 1].viewZ >= e.viewZ));
  check('tail slots are all padding',
    sorted.slice(5).every((e) => e.viewZ === SPLAT_COLUMNS_PAD_VIEW_Z));
  const coords = buildSplatInstanceTexCoords(sortCols);
  check('instance tex coords live on the sort grid',
    coords.length === 10 && arrApprox([coords[4 * 2], coords[4 * 2 + 1]], [0.5 / 4, 1.5 / 4])
      && arrApprox([coords[0], coords[1]], [0.5 / 4, 0.5 / 4]));
  check('columns depth fragment pins',
    SPLAT_COLUMNS_SORT_DEPTH_FRAG.includes('uSplatCountF')
      && SPLAT_COLUMNS_SORT_DEPTH_FRAG.includes('-1.0e18')
      && SPLAT_COLUMNS_SORT_DEPTH_FRAG.includes('payloadUv')
      && SPLAT_COLUMNS_PAD_VIEW_Z === -1e18);

  // ── (c) colour rule ────────────────────────────────────
  const onCfg = cfg({ gpgpuSplatEnabled: true, gpgpuColorMasterEnabled: true });
  const offCfg = cfg({ gpgpuSplatEnabled: true, gpgpuColorMasterEnabled: false });
  check('DC colour active: columns form + colour + master on',
    splatColumnsColorActive(onCfg, cols) === true);
  check('DC colour off with the colour master off (single tint kept)',
    splatColumnsColorActive(offCfg, cols) === false);
  check('DC colour off without colour columns',
    splatColumnsColorActive(onCfg, minCols) === false);
  check('DC colour off on the pool form',
    splatColumnsColorActive(onCfg, null) === false);
  check('form: enabled + columns = columns', resolveSplatInputForm(onCfg, cols) === 'columns');

  // ── store ──────────────────────────────────────────────
  let notified = 0;
  const unsubscribe = subscribeSplatColumns(() => { notified += 1; });
  setSplatColumns(cols);
  check('store holds the set columns with a bumped version',
    !!getSplatColumns() && getSplatColumns().count === 5 && getSplatColumns().version >= 1 && notified === 1);
  setSplatColumns(null);
  check('store clears', getSplatColumns() === null && notified === 2);
  unsubscribe();

  // ── (e) wiring source pins ─────────────────────────────
  const daSrc = readFileSync(join(ROOT, 'components', 'useGpgpuDrawAssets.ts'), 'utf8');
  check('draw assets build the columns textures / geometry / sort material',
    daSrc.includes('createSplatColumnsTextures(splatColumns)')
      && daSrc.includes('buildSplatInstanceTexCoords(splatColumns)')
      && daSrc.includes('SPLAT_COLUMNS_SORT_DEPTH_FRAG')
      && daSrc.includes('uSplatColorEnabled: { value: false }'));
  const sceneSrc = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');
  check('scene runs the sort pass over the columns centre texture',
    sceneSrc.includes('assets.splatColumnsSortDepthMat')
      && sceneSrc.includes('posTexture: assets.splatColumnsTextures.centerTex')
      && sceneSrc.includes('splatColumnsSortTex,'));
  const vuSrc = readFileSync(join(ROOT, 'components', 'gpgpuVisualUpdates.ts'), 'utf8');
  check('visual supply branches the splat bindings on the columns form',
    vuSrc.includes("splatColumnsForm === 'columns' && !!splatColumnsTextures")
      && vuSrc.includes('splatColumnsTextures.centerTex')
      && vuSrc.includes('splatColumnsColorActive(config, splatColumns)')
      && vuSrc.includes('args.splatColumnsSortTex'));
  const roSrc = readFileSync(join(ROOT, 'components', 'gpgpuRenderOutputs.tsx'), 'utf8');
  check('render outputs mount the columns geometry on the columns form',
    roSrc.includes("splatColumnsForm === 'columns' && splatColumnsGeo ? splatColumnsGeo : splatGeo"));
  const shSrc = readFileSync(join(ROOT, 'components', 'gpgpuShaderSplats.ts'), 'utf8');
  check('splat vertex carries the DC colour chunk',
    shSrc.includes('uniform sampler2D uSplatColorTex;')
      && shSrc.includes('uniform bool      uSplatColorEnabled;')
      && shSrc.includes('splatColor *= texture2D(uSplatColorTex, particleUv).rgb;'));

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
