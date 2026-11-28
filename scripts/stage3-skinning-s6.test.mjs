// Grammar 2.0 stage 3, slice S6 — skinning: a state cache
// -> density field (CPU splat of the SPH kernel) ->
// isosurface mesh series (OBJ / STL per frame, one ZIP),
// through lib/stateCacheSkinning.ts. Design:
// kalokagathia-pro/STAGE3_DESIGN.md §2 S6.
//
// The density field is REBUILT from the cached positions:
// no 3D density field exists as data in the codebase (the
// SPH density is a transient shader value, "never stored
// anywhere" — lib/gpgpuDensity.ts; the display metaballs
// keep their field inside a three-stdlib display object).
// The splat kernel is the codebase's own density kernel
// (w = max(0, 1 - q^2)); the surface extraction is naive
// surface nets, chosen because it needs no constant tables
// and its output is verified GEOMETRICALLY here:
//  1. Density assembly: exact kernel values for a single
//     particle (centre / offset / support edge), additivity
//     for two particles, symmetry, skip accounting.
//  2. Isosurface of an analytic sphere field: watertight
//     (every undirected edge shared by exactly 2 faces),
//     signed volume and surface area within tolerance of
//     the analytic sphere, mean vertex radius on the
//     analytic radius, and the radius shrinking
//     monotonically as the iso level rises. An empty field
//     (and a field entirely above the level) yields no
//     faces.
//  3. Splat -> surface: particles filling a ball produce a
//     closed mesh whose volume is in a sane range of the
//     ball's.
//  4. Series: every frame's document equals the document
//     built directly from that frame's mesh; file names
//     follow the mesh series' absolute-frame convention;
//     the ZIP entries are those documents verbatim.
//  5. Refusals state their reason: over-limit particle
//     count, a foreign format, a broken frame buffer, an
//     undersampled kernel (radius < grid spacing), invalid
//     parameters through the config bridge, and the
//     edition gate at the ZIP entry point.
//  6. The config bridge takes the parameters from the
//     skinning keys plus the existing SPH / bounds keys,
//     and the app defaults resolve to a valid parameter
//     set (the keys exist with their recorded defaults).
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s6-bundle-${process.pid}.mjs`);
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
        buildDensityField, extractIsosurface, buildObjFromMesh, buildStlFromMesh,
        resolveStateCacheSkinningFromConfig, validateCacheForSkinning, validateSkinningParams,
        buildSkinningMeshForFrame, buildStateCacheSkinningSeries, buildStateCacheSkinningSeriesZip,
        skinningFileNameForFrame, estimateSkinningNodeVisits,
        SKINNING_ZIP_FILE_NAME, SKINNING_MIN_RESOLUTION, SKINNING_MAX_RESOLUTION,
      } from './lib/stateCacheSkinning.ts';
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
  buildDensityField, extractIsosurface, buildObjFromMesh, buildStlFromMesh,
  resolveStateCacheSkinningFromConfig, validateCacheForSkinning, validateSkinningParams,
  buildSkinningMeshForFrame, buildStateCacheSkinningSeries, buildStateCacheSkinningSeriesZip,
  skinningFileNameForFrame, estimateSkinningNodeVisits,
  SKINNING_ZIP_FILE_NAME, SKINNING_MIN_RESOLUTION, SKINNING_MAX_RESOLUTION, DEFAULT_GPGPU,
} = lib;

/* ---------------- helpers ---------------- */

const meshStats = (mesh) => {
  const nv = mesh.vertices.length / 3;
  const nf = mesh.faces.length / 3;
  const edgeCount = new Map();
  const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  let vol = 0;
  let area = 0;
  let rSum = 0;
  const V = mesh.vertices;
  for (let f = 0; f < nf; f++) {
    const [a, b, c] = [mesh.faces[f * 3], mesh.faces[f * 3 + 1], mesh.faces[f * 3 + 2]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = key(p, q);
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
    }
    const ax = V[a * 3], ay = V[a * 3 + 1], az = V[a * 3 + 2];
    const bx = V[b * 3], by = V[b * 3 + 1], bz = V[b * 3 + 2];
    const cx = V[c * 3], cy = V[c * 3 + 1], cz = V[c * 3 + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  for (let i = 0; i < nv; i++) rSum += Math.hypot(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]);
  const badEdges = [...edgeCount.values()].filter((n) => n !== 2).length;
  return { nv, nf, badEdges, vol, area, meanR: nv ? rSum / nv : 0 };
};

/* ---------------- 1. density assembly ---------------- */

const splatParams = { resolution: 11, extent: 10, isoLevel: 0.3, kernelRadius: 6, restDensity: 2, maxParticles: 8192 };
const at11 = (field, x, y, z) => field.values[x + 11 * (y + 11 * z)];

const one = buildDensityField(new Float32Array([0, 0, 0]), 1, splatParams);
check('splat: centre node is the kernel peak / rest (1/2)', near(at11(one, 5, 5, 5), 0.5, 1e-6), String(at11(one, 5, 5, 5)));
check('splat: node at dist 2 is (1-(2/6)^2)/2', near(at11(one, 6, 5, 5), (1 - 4 / 36) / 2, 1e-6), String(at11(one, 6, 5, 5)));
check('splat: node at the support edge (dist = h) is 0', at11(one, 8, 5, 5) === 0, String(at11(one, 8, 5, 5)));
check('splat: field is symmetric', at11(one, 6, 5, 5) === at11(one, 4, 5, 5) && at11(one, 5, 6, 5) === at11(one, 5, 5, 6));
check('splat: one particle used, none skipped', one.usedParticles === 1 && one.skippedParticles === 0);

const two = buildDensityField(new Float32Array([0, 0, 0, 2, 0, 0]), 2, splatParams);
check(
  'splat: two particles add up',
  near(at11(two, 5, 5, 5), 0.5 + (1 - 4 / 36) / 2, 1e-6) && near(at11(two, 6, 5, 5), (1 - 4 / 36) / 2 + 0.5, 1e-6),
  `${at11(two, 5, 5, 5)} / ${at11(two, 6, 5, 5)}`,
);
const messy = buildDensityField(new Float32Array([0, 0, 0, Number.NaN, 0, 0, 500, 0, 0]), 3, splatParams);
check('splat: non-finite and far-outside particles are skipped, not splatted', messy.usedParticles === 1 && messy.skippedParticles === 2, `used=${messy.usedParticles} skipped=${messy.skippedParticles}`);

/* ---------------- 2. analytic sphere isosurface ---------------- */

const sphereField = (iso) => {
  const res = 21;
  const extent = 10;
  const R = 8;
  const values = new Float32Array(res * res * res);
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const r2 = (x - extent) ** 2 + (y - extent) ** 2 + (z - extent) ** 2;
        values[x + res * (y + res * z)] = (R * R - r2) / (R * R);
      }
    }
  }
  return { resolution: res, extent, spacing: 1, values, usedParticles: 0, skippedParticles: 0 };
};

const radii = [];
for (const iso of [0.25, 0.5]) {
  const mesh = extractIsosurface(sphereField(iso), iso);
  const s = meshStats(mesh);
  const rA = 8 * Math.sqrt(1 - iso);
  const volA = (4 / 3) * Math.PI * rA ** 3;
  const areaA = 4 * Math.PI * rA ** 2;
  radii.push(s.meanR);
  check(`sphere iso=${iso}: faces and vertices exist`, s.nf > 100 && s.nv > 50, `faces=${s.nf} verts=${s.nv}`);
  check(`sphere iso=${iso}: watertight (every edge shared by exactly 2 faces)`, s.badEdges === 0, `bad=${s.badEdges}`);
  check(`sphere iso=${iso}: signed volume positive and within 8% of analytic`, s.vol > 0 && near(s.vol, volA, volA * 0.08), `vol=${s.vol.toFixed(1)} analytic=${volA.toFixed(1)}`);
  check(`sphere iso=${iso}: area within 8% of analytic`, near(s.area, areaA, areaA * 0.08), `area=${s.area.toFixed(1)} analytic=${areaA.toFixed(1)}`);
  check(`sphere iso=${iso}: mean vertex radius within one spacing of analytic`, near(s.meanR, rA, 1), `meanR=${s.meanR.toFixed(2)} analytic=${rA.toFixed(2)}`);
}
check('sphere: higher iso -> smaller radius (monotone)', radii[1] < radii[0], radii.join(' vs '));

const empty = extractIsosurface(
  { resolution: 11, extent: 10, spacing: 2, values: new Float32Array(11 ** 3), usedParticles: 0, skippedParticles: 0 },
  0.3,
);
check('empty field yields an empty mesh', empty.faces.length === 0 && empty.vertices.length === 0);
const full = extractIsosurface(
  { resolution: 11, extent: 10, spacing: 2, values: new Float32Array(11 ** 3).fill(5), usedParticles: 0, skippedParticles: 0 },
  0.3,
);
check('field entirely above the level yields an empty mesh (no sign change)', full.faces.length === 0);

/* ---------------- 3. splat -> surface ---------------- */

const ballParticles = [];
for (let x = -6; x <= 6; x += 2) {
  for (let y = -6; y <= 6; y += 2) {
    for (let z = -6; z <= 6; z += 2) {
      if (x * x + y * y + z * z <= 36) ballParticles.push(x, y, z);
    }
  }
}
const ballParams = { resolution: 21, extent: 10, isoLevel: 0.8, kernelRadius: 4, restDensity: 1, maxParticles: 8192 };
const ballField = buildDensityField(new Float32Array(ballParticles), ballParticles.length / 3, ballParams);
const ballMesh = extractIsosurface(ballField, ballParams.isoLevel);
const bs = meshStats(ballMesh);
const ballVolA = (4 / 3) * Math.PI * 6 ** 3;
// The skin of a splatted field is NOT the particle ball
// itself: the kernel (radius 4) dilates it, so the honest
// bounds are [a shrunken core, the ball dilated by the
// kernel support] — the surface cannot exist beyond
// radius 6 + h because the field is exactly 0 there.
const dilatedVolA = (4 / 3) * Math.PI * (6 + ballParams.kernelRadius) ** 3;
check('ball splat: closed isosurface', bs.nf > 100 && bs.badEdges === 0, `faces=${bs.nf} bad=${bs.badEdges}`);
check(
  'ball splat: volume between half the particle ball and the kernel-dilated ball',
  bs.vol > ballVolA * 0.5 && bs.vol < dilatedVolA,
  `vol=${bs.vol.toFixed(1)} ball=${ballVolA.toFixed(1)} dilated=${dilatedVolA.toFixed(1)}`,
);
check('ball splat: mean radius inside the kernel support', bs.meanR > 5 && bs.meanR < 6 + ballParams.kernelRadius, `meanR=${bs.meanR.toFixed(2)}`);

/* ---------------- 4/5. cache series + refusals ---------------- */

const TEX = 4;
const COUNT = TEX * TEX;
const frameInput = (f) => {
  const positions = new Float32Array(COUNT * 4);
  const velocities = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    // A tight cluster around the origin (spacing 3), so the
    // density field has a clear blob at the test iso level.
    positions[i * 4] = (i % 4) * 3 - 4.5;
    positions[i * 4 + 1] = Math.floor(i / 4) * 3 - 4.5;
    positions[i * 4 + 2] = f * 1.5;
    positions[i * 4 + 3] = i;
    velocities[i * 4 + 3] = 0;
  }
  return { positions, velocities };
};
const assembled = assembleStateCache({ fps: 30, texSize: TEX, startFrame: 10, frames: [frameInput(0), frameInput(1)] });
check('fixture cache assembles', assembled.ok, assembled.ok ? '' : assembled.error);
const cache = assembled.cache;

const seriesParams = { resolution: 16, extent: 12, isoLevel: 0.25, kernelRadius: 8, restDensity: 2, maxParticles: 8192 };
const series = buildStateCacheSkinningSeries(cache, seriesParams, 'obj');
check('series builds', series.ok, series.ok ? '' : series.error);
if (series.ok) {
  check('series has one file per frame', series.files.length === 2);
  check(
    'series file names use the absolute frame number',
    series.files[0].fileName === 'monosphere-skin-0010.obj' && series.files[1].fileName === 'monosphere-skin-0011.obj',
    series.files.map((f) => f.fileName).join(','),
  );
  check('series frames have faces (the cluster reaches the iso level)', series.files.every((f) => f.faces > 0), series.files.map((f) => f.faces).join(','));
  for (const file of series.files) {
    const direct = buildSkinningMeshForFrame(cache, file.frameIndex, seriesParams);
    check(
      `frame ${file.frameIndex} document equals the direct build`,
      file.contents === buildObjFromMesh(direct.mesh) && file.vertices === direct.mesh.vertices.length / 3 && file.faces === direct.mesh.faces.length / 3,
    );
    const stl = buildStlFromMesh(direct.mesh);
    check(`frame ${file.frameIndex} STL document is a well-formed solid`, stl.startsWith('solid ') && stl.trimEnd().endsWith('endsolid monosphere-particles-skin'));
  }
}
check('skinning file name helper agrees', skinningFileNameForFrame(cache, 0, 'stl') === 'monosphere-skin-0010.stl');

const zipped = await buildStateCacheSkinningSeriesZip(cache, seriesParams, { format: 'obj', edition: 'full' });
check('ZIP builds for the full edition', zipped.ok, zipped.ok ? '' : zipped.error);
if (zipped.ok && series.ok) {
  check('ZIP file name', zipped.fileName === SKINNING_ZIP_FILE_NAME && zipped.fileName === 'monosphere-skin-series.zip');
  const zip = await JSZip.loadAsync(zipped.buffer);
  const names = Object.keys(zip.files).sort();
  check('ZIP entries are the series documents verbatim', names.join() === series.files.map((f) => f.fileName).sort().join());
  for (const file of series.files) {
    const text = await zip.file(file.fileName).async('string');
    check(`ZIP entry ${file.fileName} matches the series document`, text === file.contents);
  }
}

const gated = await buildStateCacheSkinningSeriesZip(cache, seriesParams, { format: 'obj', edition: 'public' });
check('public edition is refused at the ZIP entry point', !gated.ok && gated.error.includes('公開版'), gated.ok ? '' : gated.error);

const overLimit = buildStateCacheSkinningSeries(cache, { ...seriesParams, maxParticles: COUNT - 1 }, 'obj');
check('particle count over the key limit is refused with the reason', !overLimit.ok && overLimit.error.includes('上限'), overLimit.ok ? '' : overLimit.error);

const foreign = structuredClone(cache);
foreign.manifest = { ...cache.manifest, format: 'something-else' };
const foreignResult = buildStateCacheSkinningSeries(foreign, seriesParams, 'obj');
check('a foreign format is refused', !foreignResult.ok && foreignResult.error.includes('正本形式'), foreignResult.ok ? '' : foreignResult.error);

const broken = structuredClone(cache);
broken.positions = [cache.positions[0].slice(0, 5), cache.positions[1]];
const brokenResult = validateCacheForSkinning(broken, seriesParams);
check('a broken frame buffer is refused', !brokenResult.ok && brokenResult.error.includes('バッファ長'), brokenResult.ok ? '' : brokenResult.error);

const undersampled = validateSkinningParams({ ...seriesParams, resolution: 8, extent: 150, kernelRadius: 40 });
check('kernel radius below the grid spacing is refused (undersampled field)', !undersampled.ok && undersampled.error.includes('グリッド間隔'), undersampled.ok ? '' : undersampled.error);
check('node-visit estimate is positive and grows with count', estimateSkinningNodeVisits(100, seriesParams) > 0 && estimateSkinningNodeVisits(200, seriesParams) === 2 * estimateSkinningNodeVisits(100, seriesParams));

/* ---------------- 6. config bridge + defaults ---------------- */

const fixtureConfig = {
  stateCacheSkinningResolution: 24,
  stateCacheSkinningIsoLevel: 0.4,
  stateCacheSkinningMaxParticles: 4096,
  gpgpuSphRadius: 40,
  gpgpuSphRestDensity: 2,
  gpgpuBounceRadius: 150,
};
const resolved = resolveStateCacheSkinningFromConfig(fixtureConfig);
check('config bridge resolves', resolved.ok, resolved.ok ? '' : resolved.error);
if (resolved.ok) {
  check(
    'config bridge maps skinning keys + SPH/bounds keys',
    resolved.params.resolution === 24 && resolved.params.isoLevel === 0.4 && resolved.params.maxParticles === 4096
      && resolved.params.kernelRadius === 40 && resolved.params.restDensity === 2 && resolved.params.extent === 150,
    JSON.stringify(resolved.params),
  );
}
for (const [name, patch] of [
  ['resolution below range', { stateCacheSkinningResolution: 4 }],
  ['resolution above range', { stateCacheSkinningResolution: 200 }],
  ['non-integer resolution', { stateCacheSkinningResolution: 16.5 }],
  ['zero iso', { stateCacheSkinningIsoLevel: 0 }],
  ['zero particle limit', { stateCacheSkinningMaxParticles: 0 }],
  ['SPH radius below the grid spacing at the configured resolution', { stateCacheSkinningResolution: 96, gpgpuSphRadius: 2 }],
]) {
  const r = resolveStateCacheSkinningFromConfig({ ...fixtureConfig, ...patch });
  check(`config bridge refuses: ${name}`, !r.ok && typeof r.error === 'string' && r.error.length > 0, r.ok ? '' : r.error);
}

check(
  'app defaults carry the skinning keys with the recorded defaults',
  DEFAULT_GPGPU.stateCacheSkinningResolution === 32
    && DEFAULT_GPGPU.stateCacheSkinningIsoLevel === 0.35
    && DEFAULT_GPGPU.stateCacheSkinningMaxParticles === 8192,
  JSON.stringify({
    r: DEFAULT_GPGPU.stateCacheSkinningResolution,
    i: DEFAULT_GPGPU.stateCacheSkinningIsoLevel,
    m: DEFAULT_GPGPU.stateCacheSkinningMaxParticles,
  }),
);
const defaultResolved = resolveStateCacheSkinningFromConfig(DEFAULT_GPGPU);
check('app defaults resolve to a valid parameter set', defaultResolved.ok, defaultResolved.ok ? '' : defaultResolved.error);
check('resolution bounds are the recorded 8..96', SKINNING_MIN_RESOLUTION === 8 && SKINNING_MAX_RESOLUTION === 96);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
