/**
 * Grammar 2.0 stage 2, slice B2 (Path Follow as a first-class
 * asset): standalone node test.
 *
 * Pins:
 *  1 asset resolution (lib/gpgpuPathAssets.ts): the legacy
 *    steer string is asset path 0, JSON paths and SVG
 *    subpaths compose after it; caps (8 paths / 64 points);
 *    extended-ness (the variant gate) only when the extended
 *    sources contribute, a path closes, or a path exceeds the
 *    legacy 8-point budget — a legacy-only asset stays
 *    non-extended so every shipped supply path stays in
 *    charge byte for byte.
 *  2 the CPU twins: open-path following delegates to
 *    steering.ts pathFollowTarget exactly; the closed-path
 *    twin walks the loop with wrap-around look-ahead.
 *  3 the combined column supply: with no path, the pack is
 *    B1's pack byte for byte (same layout constants); with
 *    paths, the extended layout appends header/point sections
 *    and the field sections keep their B1 offsets.
 *  4 texture-unit accounting measured from the built shader
 *    strings: the stock velocity / position strings stay
 *    bit-identical (sha256 pins), the asset variants share
 *    the column texture (velocity stays at 16 units; the
 *    position asset variant adds exactly one), and the
 *    live-rules + path combination measures 17 — the same
 *    unresolved combination B1 recorded for live + fields,
 *    pinned here as a known fact, not silently shipped.
 *  5 the capability split: an extended asset in use requests
 *    'path-assets' and it is reported unsupported; the
 *    defaults request nothing.
 *  6 emission sharing (E3): resolveEmissionPath reads asset
 *    path 0, so an extended first path resolves past the old
 *    8-point cap and moves the respawn supply to the column
 *    texture (emissionPathAssetActive).
 *  7 key registration: the 4 new keys sit at their defaults.
 */
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s2b2-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;
const occurrences = (s, sub) => s.split(sub).length - 1;
const eq3 = (a, b) => a.x === b[0] && a.y === b[1] && a.z === b[2];
const eqv = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

await build({
  stdin: {
    contents: `
      export { resolvePathAsset, pathAssetExtended, steeringPathAssetActive, pathAssetIndexForSlot, pathAssetFollowTarget, packPathColumnData, getColumnSupply, PATH_ASSET_COLUMN_LAYOUT, PATH_ASSET_MAX_PATHS, PATH_ASSET_MAX_POINTS, PATH_ASSET_SVG_SAMPLES } from './lib/gpgpuPathAssets.ts';
      export { resolveFieldInstances, packFieldColumnData, columnSectionOffset } from './lib/gpgpuFieldInstances.ts';
      export { resolveEmissionPath, emissionPathAssetActive } from './lib/gpgpuEmissionSource.ts';
      export { pathFollowTarget } from './lib/steering.ts';
      export { buildVelocityFragment, SIM_VEL_FRAG } from './components/gpgpuShaderSimulationVelocity.ts';
      export { buildPositionFragment, SIM_POS_FRAG } from './components/gpgpuShaderSimulationPosition.ts';
      export { buildMainForcesFragment } from './components/gpgpuShaderSimulationVelocityMainForces.ts';
      export { getWebgpuComputeCapabilityReport } from './lib/webgpuComputeFoundation.ts';
      export { APP_STATE_DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  resolvePathAsset, pathAssetExtended, steeringPathAssetActive, pathAssetIndexForSlot,
  pathAssetFollowTarget, packPathColumnData, getColumnSupply, PATH_ASSET_COLUMN_LAYOUT,
  PATH_ASSET_MAX_PATHS, PATH_ASSET_MAX_POINTS, PATH_ASSET_SVG_SAMPLES,
  resolveFieldInstances, packFieldColumnData, columnSectionOffset,
  resolveEmissionPath, emissionPathAssetActive, pathFollowTarget,
  buildVelocityFragment, SIM_VEL_FRAG, buildPositionFragment, SIM_POS_FRAG,
  buildMainForcesFragment, getWebgpuComputeCapabilityReport, APP_STATE_DEFAULT_GPGPU,
} = lib;

const D = APP_STATE_DEFAULT_GPGPU;
const cfg = (patch) => ({ ...D, ...patch });
const JSON_PATH = '[{"name":"long","points":[[0,0,0],[10,0,0],[20,0,0],[30,0,0],[40,0,0],[50,0,0],[60,0,0],[70,0,0],[80,0,0],[90,0,0],[100,0,0],[110,0,0]]}]';
const LINE_SVG = '<svg viewBox="-1 -1 2 2"><path d="M -0.8 0 L 0.8 0"/></svg>';

// ── 1. Resolution ──────────────────────────────────────────
{
  const r = resolvePathAsset(D);
  check('defaults: no asset, not extended, slot -1',
    r.paths.length === 0 && r.extended === false && r.slot === -1
    && !pathAssetExtended(D) && !steeringPathAssetActive(D));
  const legacy = resolvePathAsset(cfg({ gpgpuSteerSeekPath: '0,0,0;10,0,0;20,5,0' }));
  check('legacy only: one path, NOT extended (shipped supply stays in charge)',
    legacy.paths.length === 1 && legacy.paths[0].points.length === 3 && !legacy.paths[0].closed && !legacy.extended);
  const legacy12 = Array.from({ length: 12 }, (_, i) => `${i * 10},0,0`).join(';');
  const r12 = resolvePathAsset(cfg({ gpgpuSteerSeekPath: legacy12 }));
  check('the legacy string keeps its own parser cap (8) and stays non-extended — the raise lives on the JSON/SVG surfaces',
    r12.paths[0].points.length === 8 && r12.extended === false);
  const rj = resolvePathAsset(cfg({ gpgpuSteerSeekPaths: JSON_PATH }));
  check('JSON path: contributes, extended, points past the legacy cap survive',
    rj.paths.length === 1 && rj.paths[0].points.length === 12 && rj.paths[0].name === 'long' && rj.extended === true);
  const comp = resolvePathAsset(cfg({
    gpgpuSteerSeekPath: '1,1,1;2,2,2',
    gpgpuSteerSeekPaths: '[{"points":[[3,3,3],[4,4,4]]}]',
    gpgpuSteerSeekPathSvg: LINE_SVG,
  }));
  check('composition order: legacy, then JSON, then SVG',
    comp.paths.length === 3 && eq3(comp.paths[0].points[0], [1, 1, 1])
    && eq3(comp.paths[1].points[0], [3, 3, 3]) && comp.paths[2].points.length === PATH_ASSET_SVG_SAMPLES);
  const many = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ points: [[i, 0, 0], [i + 1, 0, 0]] })));
  check('cap: 8 paths total', resolvePathAsset(cfg({ gpgpuSteerSeekPaths: many })).paths.length === PATH_ASSET_MAX_PATHS);
  const long = JSON.stringify([{ points: Array.from({ length: 100 }, (_, i) => [i, 0, 0]) }]);
  check('cap: 64 points per path', resolvePathAsset(cfg({ gpgpuSteerSeekPaths: long })).paths[0].points.length === PATH_ASSET_MAX_POINTS);
  const degen = resolvePathAsset(cfg({ gpgpuSteerSeekPaths: '[{"points":[[0,0,0]]},{"points":[[0,0,0],[0,0,0]]},{"points":"0,0,0;5,0,0"}]' }));
  check('sub-2-point paths never join the asset; the string point form is accepted',
    degen.paths.length === 2 && degen.paths[1].points.length === 2 && degen.paths[1].points[1].x === 5);
  const bad = resolvePathAsset(cfg({ gpgpuSteerSeekPaths: 'not json', gpgpuSteerSeekPath: '0,0,0;5,0,0' }));
  check('malformed JSON is ignored, never thrown', bad.paths.length === 1 && !bad.extended);
  const closed = resolvePathAsset(cfg({ gpgpuSteerSeekPaths: '[{"closed":true,"points":[[0,0,0],[10,0,0],[10,10,0]]}]' }));
  check('closed flag from JSON, and closed alone makes the asset extended',
    closed.paths[0].closed === true && closed.extended === true);
  const svg = resolvePathAsset(cfg({ gpgpuSteerSeekPathSvg: LINE_SVG }));
  check('SVG line: 32 samples on the z=0 plane, endpoints scaled by the SVG scale key',
    svg.paths.length === 1 && svg.paths[0].points.length === 32
    && Math.abs(svg.paths[0].points[0].x + 80) < 1e-6 && Math.abs(svg.paths[0].points[31].x - 80) < 1e-6
    && svg.paths[0].points[0].z === 0);
  const rect = resolvePathAsset(cfg({ gpgpuSteerSeekPathSvg: '<svg viewBox="-1 -1 2 2"><rect x="-0.5" y="-0.5" width="1" height="1"/></svg>' }));
  check('SVG rect subpath resolves closed', rect.paths.length === 1 && rect.paths[0].closed === true);
  check('slot resolution clamps to -1..3',
    resolvePathAsset(cfg({ gpgpuSteerSeekPathSlot: 2 })).slot === 2
    && resolvePathAsset(cfg({ gpgpuSteerSeekPathSlot: 9 })).slot === 3
    && resolvePathAsset(cfg({ gpgpuSteerSeekPathSlot: -4 })).slot === -1);
  const steerBase = { gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPaths: JSON_PATH };
  check('steeringPathAssetActive needs steer on + path mode + extended',
    steeringPathAssetActive(cfg(steerBase))
    && !steeringPathAssetActive(cfg({ ...steerBase, gpgpuSteerSeekMode: 'seek' }))
    && !steeringPathAssetActive(cfg({ ...steerBase, gpgpuSteerSeekEnabled: false })));
  check('crowd holds the asset variant back (legacy crowd supply unchanged)',
    !steeringPathAssetActive(cfg({ ...steerBase, gpgpuCrowdEnabled: true })));
}

// ── 2. Selection + CPU twins ───────────────────────────────
{
  check('pathAssetIndexForSlot: equal bands, defensive edges',
    pathAssetIndexForSlot(0, 3) === 0 && pathAssetIndexForSlot(0.5, 3) === 1
    && pathAssetIndexForSlot(0.99, 3) === 2 && pathAssetIndexForSlot(1, 3) === 2
    && pathAssetIndexForSlot(NaN, 3) === 0 && pathAssetIndexForSlot(0.5, 1) === 0
    && pathAssetIndexForSlot(0.5, 0) === 0);
  const pts = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }];
  const open = { name: 'p', points: pts, closed: false, cum: [0, 10, 20], total: 20 };
  check('open-path twin delegates to steering.ts exactly',
    [[{ x: 5, y: -3, z: 0 }, 4], [{ x: 12, y: 4, z: 0 }, 8], [{ x: 0, y: 0, z: 0 }, 0]]
      .every(([pos, la]) => eqv(pathAssetFollowTarget(open, pos, la), pathFollowTarget(pts, pos, la))));
  const square = { name: 'sq', points: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 0, y: 10, z: 0 }], closed: true, cum: [0, 10, 20, 30], total: 30 };
  check('closed-path twin wraps the look-ahead around the loop',
    eq3(pathAssetFollowTarget(square, { x: -5, y: 5, z: 0 }, 20), [10, 5, 0]));
  check('closed-path twin: corner landing and zero look-ahead',
    eq3(pathAssetFollowTarget(square, { x: 5, y: -5, z: 0 }, 5), [10, 0, 0])
    && eq3(pathAssetFollowTarget(square, { x: 5, y: -5, z: 0 }, 0), [5, 0, 0]));
}

// ── 3. Column pack ─────────────────────────────────────────
{
  const L = PATH_ASSET_COLUMN_LAYOUT;
  check('extended layout appends path sections after the B1 sections',
    columnSectionOffset(L, 'fields') === 0 && columnSectionOffset(L, 'layers') === 256
    && columnSectionOffset(L, 'pathHeaders') === 512 && columnSectionOffset(L, 'pathPoints') === 768
    && L.height === 5 && L.width === 256);
  const res = resolveFieldInstances(cfg({ gpgpuFieldInstances: '[{"kind":"vortex","x":10,"radius":50,"strength":30}]' }));
  const a = packFieldColumnData(res);
  const b = packFieldColumnData(res, PATH_ASSET_COLUMN_LAYOUT);
  let same = a.height === 2 && b.height === 5;
  for (let i = 0; i < a.data.length; i++) same = same && b.data[i] === a.data[i];
  for (let i = a.data.length; i < b.data.length; i++) same = same && b.data[i] === 0;
  check('no paths: the extended-layout field pack reproduces B1 byte for byte', same);
  const pres = resolvePathAsset(cfg({
    gpgpuSteerSeekPaths: '[{"points":[[0,0,0],[10,0,0],[10,10,0]]},{"closed":true,"points":[[0,0,0],[0,20,0]]}]',
  }));
  const d = new Float32Array(PATH_ASSET_COLUMN_LAYOUT.width * PATH_ASSET_COLUMN_LAYOUT.height * 4);
  const pack = packPathColumnData(d, PATH_ASSET_COLUMN_LAYOUT, pres);
  const texel = (idx) => [d[idx * 4], d[idx * 4 + 1], d[idx * 4 + 2], d[idx * 4 + 3]];
  const eq4 = (x, y) => x.every((v, i) => v === y[i]);
  check('path pack: headers carry (count, closed, offset), points carry cumulative arc',
    pack.pathCount === 2 && pack.pathPointOffsets.join(',') === '0,3'
    && eq4(texel(512), [3, 0, 0, 0]) && eq4(texel(513), [2, 1, 3, 0])
    && eq4(texel(768), [0, 0, 0, 0]) && eq4(texel(769), [10, 0, 0, 10])
    && eq4(texel(770), [10, 10, 0, 20]) && eq4(texel(771), [0, 0, 0, 0])
    && eq4(texel(772), [0, 20, 0, 20]));
  const d2 = new Float32Array(PATH_ASSET_COLUMN_LAYOUT.width * PATH_ASSET_COLUMN_LAYOUT.height * 4);
  packPathColumnData(d2, PATH_ASSET_COLUMN_LAYOUT, pres);
  check('path pack is deterministic', Array.from(d2).join(',') === Array.from(d).join(','));
  const fieldsOnly = getColumnSupply(cfg({ gpgpuFieldInstances: '[{"kind":"well","strength":10}]' }));
  check('combined supply: fields-only config keeps the B1 supply (height 2)',
    !!fieldsOnly && fieldsOnly.height === 2 && fieldsOnly.pathCount === 0 && getColumnSupply(D) === null);
  const withPaths = getColumnSupply(cfg({ gpgpuSteerSeekPaths: JSON_PATH }));
  check('combined supply: paths raise the extended layout (height 5)',
    !!withPaths && withPaths.height === 5 && withPaths.pathCount === 1
    && withPaths.pointsBase === 768 && withPaths.headersBase === 512);
}

// ── 4. Shader pins + texture units ─────────────────────────
{
  check('stock velocity shader is bit-identical (sha256 pin)',
    sha256(SIM_VEL_FRAG) === '5c1925996726e4f97ff037d8dccfeb848e63a8aca3e755a32736e84c5c49e637', sha256(SIM_VEL_FRAG));
  check('stock position shader is bit-identical (sha256 pin)',
    sha256(SIM_POS_FRAG) === 'f01a1a6ccd9e0df88a5ff7c91157e21607a5b2652790d5beb2148f156f3a1e49', sha256(SIM_POS_FRAG));
  check('stock strings carry no B2 trace; no-option builders return them',
    !SIM_VEL_FRAG.includes('uPathAsset') && !SIM_POS_FRAG.includes('uEmitColTex')
    && buildVelocityFragment('') === SIM_VEL_FRAG && buildPositionFragment() === SIM_POS_FRAG
    && samplerCount(SIM_VEL_FRAG) === 16 && samplerCount(SIM_POS_FRAG) === 10);
  const asset = buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true });
  check('asset velocity variant: shared column texture, still 16 units, spawn-order slot returned',
    samplerCount(asset) === 16 && occurrences(asset, 'uniform sampler2D uColTex;') === 1
    && occurrences(asset, 'uniform sampler2D uSpawnOrderTex;') === 0
    && asset.includes('uniform float uSpawnOrderMaxDist;')
    && asset.includes('uColPathHeadersBase') && asset.includes('uPathAssetSlot')
    && occurrences(asset, 'vec4 kaloColFetch(') === 1);
  const both = buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true, fieldInstances: true });
  check('fields + paths: one column texture serves both, 16 units, one fetch helper',
    samplerCount(both) === 16 && occurrences(both, 'uniform sampler2D uColTex;') === 1
    && occurrences(both, 'vec4 kaloColFetch(') === 1
    && occurrences(both, 'vec3 kaloFieldForce(') === 1 && occurrences(both, 'kaloFieldForce(') === 2);
  const live = buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true, particleRulesLive: true });
  check('live rules + paths measures 17 units unmerged — the combination B1 recorded, pinned as a fact',
    samplerCount(live) === 17, String(samplerCount(live)));
  const liveMerged = buildVelocityFragment('', undefined, { steeringSeek: true, pathAssets: true, particleRulesLive: true, mergedSupply: true });
  check('live rules + paths with the merged supply measures 16 units (stage 2 texture-unit follow-up)',
    samplerCount(liveMerged) === 16 && liveMerged.includes('uniform sampler2D uMergedTex;')
    && !liveMerged.includes('uniform sampler2D uColTex;') && !liveMerged.includes('uniform sampler2D uRuleLiveTex;'),
    String(samplerCount(liveMerged)));
  const crowdMain = buildMainForcesFragment(undefined, { steeringSeek: true, crowd: true, pathAssets: true });
  check('crowd keeps the legacy path supply even with pathAssets on',
    !crowdMain.includes('uColPathHeadersBase') && crowdMain.includes('uSteerSeekPath') && crowdMain.includes('cLane'));
  const posAsset = buildPositionFragment({ emitterPathAsset: true });
  check('position asset variant: the walk reads the column texture, +1 unit',
    samplerCount(posAsset) === 11 && posAsset.includes('uniform sampler2D uEmitColTex;')
    && posAsset.includes('kaloEmitPathPos') && !posAsset.includes('uEmitPathCum'));
  const posLegacy = buildPositionFragment({ emitterPath: true });
  check('position legacy variant untouched (uniform arrays, no column texture)',
    posLegacy.includes('uniform float uEmitPathCum[8];') && !posLegacy.includes('uEmitColTex'));
}

// ── 5. Capability ──────────────────────────────────────────
{
  const use = getWebgpuComputeCapabilityReport(cfg({ gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPaths: JSON_PATH }));
  check("extended asset in use requests 'path-assets' and it is unsupported (WebGL fallback)",
    use.requestedFeatures.includes('path-assets') && use.unsupportedFeatures.includes('path-assets') && use.canRunRequestedConfig === false);
  const idle = getWebgpuComputeCapabilityReport(D);
  check('defaults request nothing', !idle.requestedFeatures.includes('path-assets'));
  const legacy = getWebgpuComputeCapabilityReport(cfg({ gpgpuSteerSeekEnabled: true, gpgpuSteerSeekMode: 'path', gpgpuSteerSeekPath: '0,0,0;10,0,0' }));
  check('legacy-only steering requests nothing', !legacy.requestedFeatures.includes('path-assets'));
}

// ── 6. Emission sharing ────────────────────────────────────
{
  const legacyCfg = cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPath: '0,0,0;10,0,0' });
  const legacy = resolveEmissionPath(legacyCfg);
  check('emission reads asset path 0 (legacy): 2 points, total 10, asset variant off',
    legacy.points.length === 2 && legacy.total === 10 && !emissionPathAssetActive(legacyCfg));
  const extCfg = cfg({ gpgpuEmitSource: 'path', gpgpuSteerSeekPaths: JSON_PATH });
  const ext = resolveEmissionPath(extCfg);
  check('emission reads asset path 0 (extended): 12 points past the old cap, asset variant on',
    ext.points.length === 12 && ext.total === 110 && emissionPathAssetActive(extCfg));
  check('emission asset variant stays off for non-path sources',
    !emissionPathAssetActive(cfg({ gpgpuEmitSource: 'shape', gpgpuSteerSeekPaths: JSON_PATH })));
}

// ── 7. Key registration ────────────────────────────────────
{
  check('keys: the 4 new keys sit at legacy-identical defaults',
    D.gpgpuSteerSeekPaths === '' && D.gpgpuSteerSeekPathSvg === ''
    && D.gpgpuSteerSeekPathSvgScale === 100 && D.gpgpuSteerSeekPathSlot === -1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
