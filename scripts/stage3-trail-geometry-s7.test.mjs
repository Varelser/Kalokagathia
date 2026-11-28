// Grammar 2.0 stage 3, slice S7 — trail geometry: a state
// cache -> per-particle trajectories -> tube geometry
// documents (OBJ / STL, one per particle, one ZIP),
// through lib/stateCacheTrailGeometry.ts. Design:
// kalokagathia-pro/STAGE3_DESIGN.md §2 S7.
//
// The trajectories are RECONSTRUCTED from the canonical
// cache: none of the drawing-side trail histories exists
// as obtainable data (the GPU Trail / Ribbon / Tube modes
// keep theirs in a render-target ring no readback reads;
// the Smooth Tube's CPU ring buffer is a component-local
// React ref). The geometry is verified ANALYTICALLY here:
//  1. A straight trajectory sweeps an exact cylinder:
//     ring vertices at the exact radius around the axis,
//     the first ring's vertices at the exact positions the
//     parallel-transport frame predicts, outward face
//     normals, and vertex / face counts from the formulas.
//  2. Radius and radial-segment parameters are reflected
//     exactly; a circular arc keeps every ring vertex at
//     the tube radius from its station centre; a vertical
//     trajectory (the fixed-up frame's flip case) is
//     exact too.
//  3. Degenerate trajectories do not break: stationary
//     points collapse, an exact fold-back keeps finite
//     exact-radius rings, a non-finite sample breaks the
//     trajectory into runs instead of being bridged.
//  4. Extraction reads the particle's column of the frame
//     sequence; the series emits one document per
//     particle (a resting particle gets an empty document,
//     staying particle-aligned), the trailing window uses
//     the MOST RECENT frames and states so, and the ZIP
//     entries are the series documents verbatim.
//  5. Refusals state their reason: over-limit particle
//     count, a foreign format, a broken frame buffer, a
//     cache shorter than 2 frames, a workload over the
//     safety cap, invalid parameters through the config
//     bridge, and the edition gate at the ZIP entry point.
//  6. The config bridge takes the parameters from the
//     trail keys only, and the app defaults resolve to a
//     valid parameter set.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s7-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps) => Math.abs(a - b) <= eps;

await build({
  stdin: {
    contents: `
      export { assembleStateCache } from './lib/gpgpuStateCache.ts';
      export {
        buildTubeFromTrajectory, extractTrajectory,
        buildObjFromTrailMesh, buildStlFromTrailMesh,
        resolveStateCacheTrailFromConfig, validateTrailParams, validateCacheForTrailGeometry,
        buildTrailGeometryForParticle, buildStateCacheTrailGeometrySeries, buildStateCacheTrailGeometryZip,
        trailFileNameForParticle, trailFrameWindow, estimateTrailRingVertices,
        TRAIL_GEOMETRY_ZIP_FILE_NAME, TRAIL_MIN_RADIAL_SEGMENTS, TRAIL_MAX_RADIAL_SEGMENTS,
        TRAIL_MIN_SEGMENT, TRAIL_MAX_RING_VERTICES,
      } from './lib/stateCacheTrailGeometry.ts';
      export { APP_STATE_DEFAULT_GPGPU as DEFAULT_GPGPU } from './lib/appStateDefaultGpgpu.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  assembleStateCache,
  buildTubeFromTrajectory, extractTrajectory,
  buildObjFromTrailMesh, buildStlFromTrailMesh,
  resolveStateCacheTrailFromConfig, validateTrailParams, validateCacheForTrailGeometry,
  buildTrailGeometryForParticle, buildStateCacheTrailGeometrySeries, buildStateCacheTrailGeometryZip,
  trailFileNameForParticle, trailFrameWindow, estimateTrailRingVertices,
  TRAIL_GEOMETRY_ZIP_FILE_NAME, TRAIL_MIN_RADIAL_SEGMENTS, TRAIL_MAX_RADIAL_SEGMENTS,
  TRAIL_MIN_SEGMENT, TRAIL_MAX_RING_VERTICES, DEFAULT_GPGPU,
} = lib;

const flat = (pts) => new Float32Array(pts.flat());
const ringCentroid = (mesh, station, radialSegments) => {
  const c = [0, 0, 0];
  for (let s = 0; s < radialSegments; s++) {
    const o = (station * radialSegments + s) * 3;
    c[0] += mesh.vertices[o] / radialSegments;
    c[1] += mesh.vertices[o + 1] / radialSegments;
    c[2] += mesh.vertices[o + 2] / radialSegments;
  }
  return c;
};
const allFinite = (arr) => [...arr].every(Number.isFinite);

/* ---------------- 1. straight tube (analytic) ---------------- */

const straight = buildTubeFromTrajectory(flat([[0, 0, 0], [10, 0, 0], [20, 0, 0]]), 3, 2, 4);
check('straight: stats', straight.stats.inputPoints === 3 && straight.stats.stations === 3 && straight.stats.runs === 1
  && straight.stats.collapsedPoints === 0 && straight.stats.nonFinitePoints === 0, JSON.stringify(straight.stats));
check('straight: vertex / face counts from the formulas (3 stations x 4, 2 segments x 4 x 2)',
  straight.mesh.vertices.length / 3 === 12 && straight.mesh.faces.length / 3 === 16,
  `v=${straight.mesh.vertices.length / 3} f=${straight.mesh.faces.length / 3}`);
{
  // First ring: tangent +X, initial normal +Y (the least
  // aligned axis), binormal +Z. theta = 0, pi/2, pi, 3pi/2.
  const expected = [[0, 2, 0], [0, 0, 2], [0, -2, 0], [0, 0, -2]];
  const okRing = expected.every((e, s) => {
    const o = s * 3;
    return near(straight.mesh.vertices[o], e[0], 1e-6)
      && near(straight.mesh.vertices[o + 1], e[1], 1e-6)
      && near(straight.mesh.vertices[o + 2], e[2], 1e-6);
  });
  check('straight: first ring vertices are the exact frame predictions', okRing,
    [...straight.mesh.vertices.slice(0, 12)].join(','));
  let okAxis = true;
  for (let i = 0; i < 12; i++) {
    const y = straight.mesh.vertices[i * 3 + 1];
    const z = straight.mesh.vertices[i * 3 + 2];
    if (!near(Math.hypot(y, z), 2, 1e-5)) okAxis = false;
    if (![0, 10, 20].includes(straight.mesh.vertices[i * 3])) okAxis = false;
  }
  check('straight: every vertex is at the tube radius from the axis', okAxis);
  // Outward normals: face normal . (centroid - axis point) > 0.
  const V = straight.mesh.vertices;
  let outward = true;
  for (let f = 0; f < straight.mesh.faces.length / 3; f++) {
    const [a, b, c] = [straight.mesh.faces[f * 3], straight.mesh.faces[f * 3 + 1], straight.mesh.faces[f * 3 + 2]];
    const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
    const wx = V[c * 3] - V[a * 3], wy = V[c * 3 + 1] - V[a * 3 + 1], wz = V[c * 3 + 2] - V[a * 3 + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const cx = (V[a * 3] + V[b * 3] + V[c * 3]) / 3;
    const cy = (V[a * 3 + 1] + V[b * 3 + 1] + V[c * 3 + 1]) / 3;
    const cz = (V[a * 3 + 2] + V[b * 3 + 2] + V[c * 3 + 2]) / 3;
    if (!(nx * 0 + ny * cy + nz * cz > 0)) outward = false;
  }
  check('straight: every face normal points away from the centreline', outward);
}
const straightAgain = buildTubeFromTrajectory(flat([[0, 0, 0], [10, 0, 0], [20, 0, 0]]), 3, 2, 4);
check('straight: deterministic (same input, identical output)',
  straightAgain.mesh.vertices.every((v, i) => v === straight.mesh.vertices[i])
  && straightAgain.mesh.faces.every((v, i) => v === straight.mesh.faces[i]));

/* ---------------- 2. parameters / arc / vertical ---------------- */

const wide = buildTubeFromTrajectory(flat([[0, 0, 0], [10, 0, 0]]), 2, 3, 6);
check('params: counts follow radius / segments (2 stations x 6, 1 segment x 6 x 2)',
  wide.mesh.vertices.length / 3 === 12 && wide.mesh.faces.length / 3 === 12,
  `v=${wide.mesh.vertices.length / 3} f=${wide.mesh.faces.length / 3}`);
{
  let ok = true;
  for (let st = 0; st < 2; st++) {
    const c = ringCentroid(wide.mesh, st, 6);
    for (let s = 0; s < 6; s++) {
      const o = (st * 6 + s) * 3;
      const d = Math.hypot(wide.mesh.vertices[o] - c[0], wide.mesh.vertices[o + 1] - c[1], wide.mesh.vertices[o + 2] - c[2]);
      if (!near(d, 3, 1e-5)) ok = false;
    }
  }
  check('params: every ring vertex is at the configured radius from its centre', ok);
}

const arcPts = [];
const ARC_R = 10;
const ARC_STEPS = 32;
for (let i = 0; i <= ARC_STEPS; i++) {
  const a = (Math.PI * i) / ARC_STEPS;
  arcPts.push([ARC_R * Math.cos(a), ARC_R * Math.sin(a), 0]);
}
const arc = buildTubeFromTrajectory(flat(arcPts), arcPts.length, 1.5, 6);
check('arc: counts (33 stations x 6, 32 segments x 6 x 2)',
  arc.mesh.vertices.length / 3 === 33 * 6 && arc.mesh.faces.length / 3 === 32 * 6 * 2,
  `v=${arc.mesh.vertices.length / 3} f=${arc.mesh.faces.length / 3}`);
{
  let okRadius = true;
  let okOrigin = true;
  for (let st = 0; st <= ARC_STEPS; st++) {
    const centre = arcPts[st];
    for (let s = 0; s < 6; s++) {
      const o = (st * 6 + s) * 3;
      const vx = arc.mesh.vertices[o], vy = arc.mesh.vertices[o + 1], vz = arc.mesh.vertices[o + 2];
      if (!near(Math.hypot(vx - centre[0], vy - centre[1], vz - centre[2]), 1.5, 1e-4)) okRadius = false;
      const dOrigin = Math.hypot(vx, vy, vz);
      if (dOrigin < ARC_R - 1.5 - 1e-3 || dOrigin > ARC_R + 1.5 + 1e-3) okOrigin = false;
    }
  }
  check('arc: every ring vertex is at the tube radius from its station centre', okRadius);
  check('arc: the tube stays within radius +/- tube radius of the origin', okOrigin);
  check('arc: all vertices finite', allFinite(arc.mesh.vertices));
}

const vertical = buildTubeFromTrajectory(flat([[0, 0, 0], [0, 10, 0], [0, 20, 0]]), 3, 1, 4);
{
  let ok = allFinite(vertical.mesh.vertices);
  for (let i = 0; i < vertical.mesh.vertices.length / 3; i++) {
    const x = vertical.mesh.vertices[i * 3];
    const z = vertical.mesh.vertices[i * 3 + 2];
    if (!near(Math.hypot(x, z), 1, 1e-5)) ok = false;
  }
  check('vertical: exact radius around the Y axis, no frame flip', ok && vertical.mesh.faces.length / 3 === 16);
}

/* ---------------- 3. degenerate trajectories ---------------- */

const resting = buildTubeFromTrajectory(flat([[5, 5, 5], [5, 5, 5], [5, 5, 5], [5, 5, 5]]), 4, 2, 4);
check('resting: no tube, collapses counted, no NaN',
  resting.mesh.vertices.length === 0 && resting.mesh.faces.length === 0
  && resting.stats.stations === 0 && resting.stats.runs === 0 && resting.stats.collapsedPoints === 3,
  JSON.stringify(resting.stats));

const dup = buildTubeFromTrajectory(flat([[0, 0, 0], [0, 0, 0], [10, 0, 0]]), 3, 2, 4);
check('duplicates: one collapse, a 2-station tube',
  dup.stats.collapsedPoints === 1 && dup.stats.stations === 2 && dup.mesh.faces.length / 3 === 8,
  JSON.stringify(dup.stats));

const fold = buildTubeFromTrajectory(flat([[0, 0, 0], [10, 0, 0], [0, 0, 0]]), 3, 2, 4);
{
  let okRadius = allFinite(fold.mesh.vertices);
  for (let st = 0; st < 3; st++) {
    const c = ringCentroid(fold.mesh, st, 4);
    for (let s = 0; s < 4; s++) {
      const o = (st * 4 + s) * 3;
      const d = Math.hypot(fold.mesh.vertices[o] - c[0], fold.mesh.vertices[o + 1] - c[1], fold.mesh.vertices[o + 2] - c[2]);
      if (!near(d, 2, 1e-4)) okRadius = false;
    }
  }
  check('fold-back (exact 180 deg): finite, exact-radius rings, 16 faces',
    okRadius && fold.mesh.faces.length / 3 === 16, `faces=${fold.mesh.faces.length / 3}`);
}
const reversal = buildTubeFromTrajectory(flat([[0, 0, 0], [10, 0, 0], [20, 0, 0], [10, 0, 0], [0, 0, 0]]), 5, 2, 4);
check('reversal path: finite, 4 segments of tube',
  allFinite(reversal.mesh.vertices) && reversal.mesh.faces.length / 3 === 32 && reversal.stats.stations === 5);

const single = buildTubeFromTrajectory(flat([[1, 2, 3]]), 1, 2, 4);
check('single point: empty mesh, no stations', single.mesh.vertices.length === 0 && single.stats.stations === 0);

const brokenPts = buildTubeFromTrajectory(
  flat([[0, 0, 0], [10, 0, 0], [Number.NaN, 0, 0], [30, 0, 0], [40, 0, 0]]), 5, 2, 4,
);
check('non-finite break: two runs, never bridged (4 stations, 16 faces), all finite',
  brokenPts.stats.nonFinitePoints === 1 && brokenPts.stats.runs === 2 && brokenPts.stats.stations === 4
  && brokenPts.mesh.faces.length / 3 === 16 && allFinite(brokenPts.mesh.vertices),
  JSON.stringify(brokenPts.stats));
const edgeBroken = buildTubeFromTrajectory(
  flat([[Number.NaN, 0, 0], [0, 0, 0], [10, 0, 0], [Number.POSITIVE_INFINITY, 0, 0]]), 4, 2, 4,
);
check('non-finite at the edges: one run of 2 stations',
  edgeBroken.stats.nonFinitePoints === 2 && edgeBroken.stats.runs === 1 && edgeBroken.stats.stations === 2);

/* ---------------- 4. cache extraction + series ---------------- */

const TEX = 4;
const COUNT = TEX * TEX;
const frameInput = (f, restIndex = -1) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    if (i === restIndex) {
      positions[i * 4] = 7;
      positions[i * 4 + 1] = 7;
      positions[i * 4 + 2] = 7;
    } else {
      positions[i * 4] = f * 10;
      positions[i * 4 + 1] = i;
      positions[i * 4 + 2] = -f;
    }
  }
  return { positions, velocities };
};
const assembled = assembleStateCache({
  fps: 30, texSize: TEX, startFrame: 10,
  frames: [frameInput(0), frameInput(1), frameInput(2)],
});
check('fixture cache assembles', assembled.ok, assembled.ok ? '' : assembled.error);
const cache = assembled.cache;

const traj5 = extractTrajectory(cache, 5);
check('extraction: particle column across frames, in order',
  traj5.length === 9 && [...traj5].every((v, i) => v === [0, 5, 0, 10, 5, -1, 20, 5, -2][i]),
  [...traj5].join(','));
const trajSub = extractTrajectory(cache, 5, 1, 3);
check('extraction: sub-range', trajSub.length === 6 && trajSub[0] === 10 && trajSub[3] === 20);

const seriesParams = { radius: 1, radialSegments: 4, maxParticles: 256, maxFrames: 240 };
const series = buildStateCacheTrailGeometrySeries(cache, seriesParams, 'obj');
check('series builds', series.ok, series.ok ? '' : series.error);
if (series.ok) {
  check('series has one file per particle', series.files.length === COUNT);
  check('series file names use the padded particle index',
    series.files[0].fileName === 'monosphere-trail-0000.obj' && series.files[15].fileName === 'monosphere-trail-0015.obj',
    series.files.map((f) => f.fileName).join(','));
  check('series window covers the whole cache', series.window.framesTotal === 3 && series.window.framesUsed === 3
    && series.window.windowStartIndex === 0 && series.window.windowStartFrame === 10, JSON.stringify(series.window));
  const file5 = series.files[5];
  check('moving particle: 3 stations x 4 vertices, 16 faces', file5.vertices === 12 && file5.faces === 16,
    `v=${file5.vertices} f=${file5.faces}`);
  for (const file of series.files) {
    const direct = buildTrailGeometryForParticle(cache, file.particleIndex, seriesParams);
    check(`particle ${file.particleIndex} document equals the direct build`,
      file.contents === buildObjFromTrailMesh(direct.mesh)
      && file.vertices === direct.mesh.vertices.length / 3
      && file.faces === direct.mesh.faces.length / 3);
  }
  const stl = buildStlFromTrailMesh(buildTrailGeometryForParticle(cache, 5, seriesParams).mesh);
  check('STL document is a well-formed solid', stl.startsWith('solid ') && stl.trimEnd().endsWith('endsolid monosphere-particle-trail'));
  check('OBJ document header names the trail tube', file5.contents.startsWith('# Monosphere GPGPU particle trail (tube geometry)'));
}
check('trail file name helper agrees', trailFileNameForParticle(7, 'stl') === 'monosphere-trail-0007.stl');

const zipped = await buildStateCacheTrailGeometryZip(cache, seriesParams, { format: 'obj', edition: 'full' });
check('ZIP builds for the full edition', zipped.ok, zipped.ok ? '' : zipped.error);
if (zipped.ok && series.ok) {
  check('ZIP file name', zipped.fileName === TRAIL_GEOMETRY_ZIP_FILE_NAME && zipped.fileName === 'monosphere-trail-geometry.zip');
  const zip = await JSZip.loadAsync(zipped.buffer);
  const names = Object.keys(zip.files).sort();
  check('ZIP entries are the series documents verbatim', names.join() === series.files.map((f) => f.fileName).sort().join());
  for (const file of series.files) {
    const text = await zip.file(file.fileName).async('string');
    check(`ZIP entry ${file.fileName} matches the series document`, text === file.contents);
  }
  check('ZIP totals are the series sums',
    zipped.totalVertices === series.files.reduce((n, f) => n + f.vertices, 0)
    && zipped.totalFaces === series.files.reduce((n, f) => n + f.faces, 0));
}

/* ---------------- trailing window + resting particle ---------------- */

const longAssembled = assembleStateCache({
  fps: 30, texSize: TEX, startFrame: 0,
  frames: [0, 1, 2, 3, 4].map((f) => frameInput(f, 3)),
});
check('long fixture cache assembles', longAssembled.ok, longAssembled.ok ? '' : longAssembled.error);
const longCache = longAssembled.cache;
const windowParams = { ...seriesParams, maxFrames: 3 };
const windowed = buildStateCacheTrailGeometrySeries(longCache, windowParams, 'obj');
check('windowed series builds', windowed.ok, windowed.ok ? '' : windowed.error);
if (windowed.ok) {
  check('window states the most recent frames (5 total, 3 used, start index 2)',
    windowed.window.framesTotal === 5 && windowed.window.framesUsed === 3
    && windowed.window.windowStartIndex === 2 && windowed.window.windowStartFrame === 2,
    JSON.stringify(windowed.window));
  const direct = buildTrailGeometryForParticle(longCache, 5, windowParams);
  const c0 = ringCentroid(direct.mesh, 0, 4);
  check('window: first station is centred on frame 2 (the window start), not frame 0',
    near(c0[0], 20, 1e-4) && near(c0[1], 5, 1e-4) && near(c0[2], -2, 1e-4), c0.join(','));
  const restFile = windowed.files[3];
  check('resting particle: empty document, kept in the series, collapses recorded',
    restFile.vertices === 0 && restFile.faces === 0 && restFile.stats.stations === 0
    && restFile.stats.collapsedPoints === 2 && restFile.contents.startsWith('# Monosphere GPGPU particle trail'),
    JSON.stringify(restFile.stats));
}
check('trailFrameWindow helper agrees', trailFrameWindow(longCache, windowParams).windowStartIndex === 2);

/* ---------------- 5. refusals ---------------- */

const gated = await buildStateCacheTrailGeometryZip(cache, seriesParams, { format: 'obj', edition: 'public' });
check('public edition is refused at the ZIP entry point', !gated.ok && gated.error.includes('公開版'), gated.ok ? '' : gated.error);

const overLimit = buildStateCacheTrailGeometrySeries(cache, { ...seriesParams, maxParticles: COUNT - 1 }, 'obj');
check('particle count over the key limit is refused with the reason (no silent subset)',
  !overLimit.ok && overLimit.error.includes('上限') && overLimit.error.includes('stateCacheTrailMaxParticles'),
  overLimit.ok ? '' : overLimit.error);

const foreign = structuredClone(cache);
foreign.manifest = { ...cache.manifest, format: 'something-else' };
const foreignResult = buildStateCacheTrailGeometrySeries(foreign, seriesParams, 'obj');
check('a foreign format is refused', !foreignResult.ok && foreignResult.error.includes('正本形式'), foreignResult.ok ? '' : foreignResult.error);

const broken = structuredClone(cache);
broken.positions = [cache.positions[0].slice(0, 5), cache.positions[1], cache.positions[2]];
const brokenResult = validateCacheForTrailGeometry(broken, seriesParams);
check('a broken frame buffer is refused', !brokenResult.ok && brokenResult.error.includes('バッファ長'), brokenResult.ok ? '' : brokenResult.error);

const oneFrame = assembleStateCache({ fps: 30, texSize: TEX, startFrame: 0, frames: [frameInput(0)] });
check('one-frame fixture assembles', oneFrame.ok, oneFrame.ok ? '' : oneFrame.error);
if (oneFrame.ok) {
  const shortResult = buildStateCacheTrailGeometrySeries(oneFrame.cache, seriesParams, 'obj');
  check('a cache shorter than 2 frames is refused (no trajectory)', !shortResult.ok && shortResult.error.includes('2 未満'), shortResult.ok ? '' : shortResult.error);
}

// Workload cap: a hand-built cache whose shape passes the
// other checks (validate reads manifest + buffers only).
const bigCount = 2000;
const bigFrames = 100;
const bigCache = {
  manifest: {
    format: 'statecache-manifest-v1', version: 1, fps: 30, count: bigCount, texSize: 45,
    frameCount: bigFrames, startFrame: 0, loop: false, interpolation: 'linear',
    coordinates: { up: 'y', unit: 'world' }, attributes: [], frameHashes: [],
  },
  positions: Array.from({ length: bigFrames }, () => new Float32Array(bigCount * 3)),
  velocities: [],
  attrFrames: [],
};
const bigParams = { radius: 1, radialSegments: 32, maxParticles: 8192, maxFrames: 240 };
check('workload estimate exceeds the cap for the big shape',
  estimateTrailRingVertices(bigCount, bigFrames, bigParams) > TRAIL_MAX_RING_VERTICES,
  String(estimateTrailRingVertices(bigCount, bigFrames, bigParams)));
const bigResult = validateCacheForTrailGeometry(bigCache, bigParams);
check('a workload over the safety cap is refused with the reason', !bigResult.ok && bigResult.error.includes('安全上限'), bigResult.ok ? '' : bigResult.error);
check('workload estimate grows linearly with count',
  estimateTrailRingVertices(200, 10, seriesParams) === 2 * estimateTrailRingVertices(100, 10, seriesParams));

/* ---------------- 6. config bridge + defaults ---------------- */

const fixtureConfig = {
  stateCacheTrailRadius: 2.5,
  stateCacheTrailRadialSegments: 12,
  stateCacheTrailMaxParticles: 512,
  stateCacheTrailMaxFrames: 120,
};
const resolved = resolveStateCacheTrailFromConfig(fixtureConfig);
check('config bridge resolves', resolved.ok, resolved.ok ? '' : resolved.error);
if (resolved.ok) {
  check('config bridge maps the four trail keys',
    resolved.params.radius === 2.5 && resolved.params.radialSegments === 12
    && resolved.params.maxParticles === 512 && resolved.params.maxFrames === 120,
    JSON.stringify(resolved.params));
}
for (const [name, patch] of [
  ['zero radius', { stateCacheTrailRadius: 0 }],
  ['negative radius', { stateCacheTrailRadius: -1 }],
  ['radial segments below range', { stateCacheTrailRadialSegments: 2 }],
  ['radial segments above range', { stateCacheTrailRadialSegments: 33 }],
  ['non-integer radial segments', { stateCacheTrailRadialSegments: 4.5 }],
  ['zero particle limit', { stateCacheTrailMaxParticles: 0 }],
  ['frame limit below 2', { stateCacheTrailMaxFrames: 1 }],
]) {
  const r = resolveStateCacheTrailFromConfig({ ...fixtureConfig, ...patch });
  check(`config bridge refuses: ${name}`, !r.ok && typeof r.error === 'string' && r.error.length > 0, r.ok ? '' : r.error);
}
check('validateTrailParams accepts the recorded default shape',
  validateTrailParams({ radius: 2, radialSegments: 8, maxParticles: 256, maxFrames: 240 }).ok);

check(
  'app defaults carry the trail keys with the recorded defaults',
  DEFAULT_GPGPU.stateCacheTrailRadius === 2
    && DEFAULT_GPGPU.stateCacheTrailRadialSegments === 8
    && DEFAULT_GPGPU.stateCacheTrailMaxParticles === 256
    && DEFAULT_GPGPU.stateCacheTrailMaxFrames === 240,
  JSON.stringify({
    r: DEFAULT_GPGPU.stateCacheTrailRadius,
    s: DEFAULT_GPGPU.stateCacheTrailRadialSegments,
    p: DEFAULT_GPGPU.stateCacheTrailMaxParticles,
    f: DEFAULT_GPGPU.stateCacheTrailMaxFrames,
  }),
);
const defaultResolved = resolveStateCacheTrailFromConfig(DEFAULT_GPGPU);
check('app defaults resolve to a valid parameter set', defaultResolved.ok, defaultResolved.ok ? '' : defaultResolved.error);
check('radial segment bounds are the recorded 3..32', TRAIL_MIN_RADIAL_SEGMENTS === 3 && TRAIL_MAX_RADIAL_SEGMENTS === 32);
check('collapse epsilon is the recorded 1e-6', TRAIL_MIN_SEGMENT === 1e-6);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
