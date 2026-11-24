// Phase 20 stage 1 — OBB shape foundation tests.
// Dedicated tests for lib/rigidObb.ts (new in Phase 20): the
// PCA-fitted oriented bounding box that stage 1's shape
// collision will consume. Nothing here touches the solver —
// the module is pure functions (build / place / SAT / support)
// and the integration into lib/rigidBodies.ts is a later step.
// Written in the identity style of the phase17/19/20 tests
// (esbuild bundle, PASS/FAIL lines, exit code).
//
// Behaviours pinned:
// - construction determinism (same points -> identical OBB)
// - an axis-aligned box cloud recovers the identity axes and
//   the exact half extents, centred on the cloud centre
// - a rotated box cloud recovers the rotated axes
// - every source point lies inside its fitted OBB
// - buildObbForCell reads a FractureCellData table correctly
// - SAT: separated boxes do not hit; overlapping boxes report
//   the penetration depth and the A->B normal; the same for
//   rotated boxes
// - support point is the farthest point along the direction,
//   and the floor support offset matches the half extent for
//   an axis-aligned box
// - placeObb rotates centre + axes by the body quaternion
// - degenerate inputs (single point, collinear, planar) never
//   produce NaN and keep half extents >= OBB_MIN_HALF_EXTENT
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p20obb-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vecNear = (a, b, eps = 1e-9) => a.every((v, i) => near(v, b[i], eps));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

await build({
  stdin: {
    contents: `
      export {
        buildObbFromPoints, buildObbForCell, buildObbsForCells,
        placeObb, obbSatContact, obbSupportPoint, obbFloorSupportOffset,
        obbQuatRotate, OBB_MIN_HALF_EXTENT,
      } from './lib/rigidObb.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const {
  buildObbFromPoints, buildObbForCell, buildObbsForCells,
  placeObb, obbSatContact, obbSupportPoint, obbFloorSupportOffset,
  obbQuatRotate, OBB_MIN_HALF_EXTENT,
} = lib;

// ── Helpers ───────────────────────────────────────────────────
function boxCorners(half, centre = [0, 0, 0]) {
  const pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    pts.push(centre[0] + sx * half[0], centre[1] + sy * half[1], centre[2] + sz * half[2]);
  }
  return pts;
}
function rotateZ(pts, angle) {
  const c = Math.cos(angle); const s = Math.sin(angle);
  const out = [];
  for (let i = 0; i < pts.length; i += 3) {
    out.push(c * pts[i] - s * pts[i + 1], s * pts[i] + c * pts[i + 1], pts[i + 2]);
  }
  return out;
}
const identityObb = (centre, half) => ({
  center: centre, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: half,
});

// ── Construction: axis-aligned ────────────────────────────────
{
  const pts = boxCorners([2, 1, 0.5], [1, 2, 3]);
  const obb = buildObbFromPoints(pts, 8);
  check('aligned: built', !!obb);
  check('aligned: centre is the cloud centre', vecNear(obb.center, [1, 2, 3]));
  check('aligned: half extents exact', vecNear(obb.halfExtents, [2, 1, 0.5]));
  check(
    'aligned: axes are the identity axes',
    vecNear(obb.axes[0].map(Math.abs), [1, 0, 0])
      && vecNear(obb.axes[1].map(Math.abs), [0, 1, 0])
      && vecNear(obb.axes[2].map(Math.abs), [0, 0, 1]),
    JSON.stringify(obb.axes),
  );
  check(
    'aligned: frame is right-handed (axis2 = axis0 x axis1)',
    vecNear(obb.axes[2], [
      obb.axes[0][1] * obb.axes[1][2] - obb.axes[0][2] * obb.axes[1][1],
      obb.axes[0][2] * obb.axes[1][0] - obb.axes[0][0] * obb.axes[1][2],
      obb.axes[0][0] * obb.axes[1][1] - obb.axes[0][1] * obb.axes[1][0],
    ]),
  );
}

// ── Construction: determinism + containment ───────────────────
{
  let rngState = 12345;
  const rnd = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  const cloud = [];
  for (let i = 0; i < 200; i++) cloud.push(rnd() * 4 - 2, rnd() * 2 - 1, rnd() * 6 - 3);
  const a = buildObbFromPoints(cloud, 200);
  const b = buildObbFromPoints(cloud, 200);
  check('determinism: identical OBB for identical input', JSON.stringify(a) === JSON.stringify(b));
  let contained = true;
  for (let i = 0; i < 200; i++) {
    const p = cloud.slice(i * 3, i * 3 + 3);
    const d = [p[0] - a.center[0], p[1] - a.center[1], p[2] - a.center[2]];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(dot(d, a.axes[k])) > a.halfExtents[k] + 1e-9) contained = false;
    }
  }
  check('containment: every point lies inside the fitted OBB', contained);
}

// ── Construction: rotated box ─────────────────────────────────
{
  const angle = Math.PI / 6;
  const pts = rotateZ(boxCorners([2, 1, 0.5]), angle);
  const obb = buildObbFromPoints(pts, 8);
  const c = Math.cos(angle); const s = Math.sin(angle);
  check('rotated: half extents recovered', vecNear(obb.halfExtents, [2, 1, 0.5], 1e-9), JSON.stringify(obb.halfExtents));
  check(
    'rotated: axis0 follows the long axis',
    near(Math.abs(dot(obb.axes[0], [c, s, 0])), 1, 1e-9),
    JSON.stringify(obb.axes[0]),
  );
  check('rotated: centre at origin', vecNear(obb.center, [0, 0, 0]));
}

// ── Construction from a FractureCellData table ────────────────
{
  // Two bodies: body 0 = box corners (half 1,0.5,0.25) as local
  // offsets; body 1 = a single point offset.
  const corners = boxCorners([1, 0.5, 0.25]);
  const localOffsets = new Float32Array([...corners, 0.3, -0.2, 0.1]);
  const assignment = new Int32Array([0, 0, 0, 0, 0, 0, 0, 0, 1]);
  const cells = {
    assignment,
    localOffsets,
    centroids: new Float32Array([0, 0, 0, 0.3, -0.2, 0.1]),
    radii: new Float32Array([1, 0]),
    coreRadii: new Float32Array([0.6, 0]),
    cellCounts: new Int32Array([8, 1]),
    bodyCount: 2,
  };
  const obb0 = buildObbForCell(cells, 0);
  check('cell: body 0 half extents', !!obb0 && vecNear(obb0.halfExtents, [1, 0.5, 0.25]));
  const obb1 = buildObbForCell(cells, 1);
  check(
    'cell: single-point body clamps to the minimum extent',
    !!obb1 && obb1.halfExtents.every((h) => near(h, OBB_MIN_HALF_EXTENT)),
  );
  check('cell: unknown body returns null', buildObbForCell(cells, 7) === null);
  const all = buildObbsForCells(cells);
  check('cell: buildObbsForCells covers every body', all.length === 2 && !!all[0] && !!all[1]);
}

// ── SAT: separated / overlapping ──────────────────────────────
{
  const a = identityObb([0, 0, 0], [1, 1, 1]);
  const far = identityObb([5, 0, 0], [1, 1, 1]);
  check('sat: separated boxes do not hit', obbSatContact(a, far).hit === false);

  const nearB = identityObb([1.5, 0, 0], [1, 1, 1]);
  const hit = obbSatContact(a, nearB);
  check('sat: overlapping boxes hit', hit.hit === true);
  check('sat: depth is the overlap', near(hit.depth, 0.5), String(hit.depth));
  check('sat: normal points A -> B (+x)', vecNear(hit.normal, [1, 0, 0]), JSON.stringify(hit.normal));
  check('sat: contact point sits in the overlap slab', near(hit.point[0], 0.75), JSON.stringify(hit.point));

  const leftB = identityObb([-1.5, 0, 0], [1, 1, 1]);
  const hitL = obbSatContact(a, leftB);
  check('sat: normal flips for B on the -x side', hitL.hit && vecNear(hitL.normal, [-1, 0, 0]));

  // Overlap on y only: the minimum axis must be y.
  const topB = identityObb([0, 1.8, 0], [1, 1, 1]);
  const hitT = obbSatContact(a, topB);
  check('sat: minimum axis wins (y)', hitT.hit && near(hitT.depth, 0.2) && vecNear(hitT.normal, [0, 1, 0]));
}

// ── SAT: rotated boxes ────────────────────────────────────────
{
  const a = identityObb([0, 0, 0], [1, 1, 1]);
  // B: a thin long box rotated 45 deg about z, reaching into A.
  const angle = Math.PI / 4;
  const c = Math.cos(angle); const s = Math.sin(angle);
  const b = {
    center: [1.2, 0, 0],
    axes: [[c, s, 0], [-s, c, 0], [0, 0, 1]],
    halfExtents: [1, 0.2, 0.2],
  };
  const hit = obbSatContact(a, b);
  check('sat rotated: hit', hit.hit === true);
  check('sat rotated: depth is positive and below the thin extent sum', hit.depth > 0 && hit.depth < 1.2, String(hit.depth));
  check('sat rotated: normal is unit length', near(Math.hypot(...hit.normal), 1));
  const bFar = { ...b, center: [4, 0, 0] };
  check('sat rotated: separated when moved away', obbSatContact(a, bFar).hit === false);
}

// ── Support point + floor offset ──────────────────────────────
{
  const obb = identityObb([0, 0, 0], [1, 2, 3]);
  const p = obbSupportPoint(obb, [1, 0, 0]);
  check('support: farthest +x point has x = half extent', near(p[0], 1));
  const diag = obbSupportPoint(obb, [1, 1, 1]);
  check(
    'support: diagonal direction reaches the corner',
    vecNear(diag, [1, 2, 3]),
    JSON.stringify(diag),
  );
  // The support point maximises the dot with the direction.
  const dir = [0.3, -0.8, 0.52];
  const sp = obbSupportPoint(obb, dir);
  const expected = 1 * Math.abs(dir[0]) + 2 * Math.abs(dir[1]) + 3 * Math.abs(dir[2]);
  check('support: dot equals the projection radius', near(dot(sp, dir), expected, 1e-12));
  check(
    'floor: offset along +y is -half extent y',
    near(obbFloorSupportOffset(obb, [0, 1, 0]), -2),
  );
  check(
    'floor: offset along +z is -half extent z',
    near(obbFloorSupportOffset(obb, [0, 0, 1]), -3),
  );
}

// ── Placement ─────────────────────────────────────────────────
{
  const local = identityObb([1, 0, 0], [2, 1, 0.5]);
  // Quaternion for +90 deg about z: [0, 0, sin45, cos45].
  const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  check(
    'quatRotate: +x rotates to +y under +90 deg z',
    vecNear(obbQuatRotate(q, [1, 0, 0]), [0, 1, 0], 1e-12),
  );
  const world = placeObb(local, [10, 0, 0], q);
  check('place: centre rotates then translates', vecNear(world.center, [10, 1, 0], 1e-12), JSON.stringify(world.center));
  check('place: axis0 rotates to +y', vecNear(world.axes[0], [0, 1, 0], 1e-12));
  check('place: half extents carry over', vecNear(world.halfExtents, [2, 1, 0.5]));
  const ident = placeObb(local, [0, 0, 0], [0, 0, 0, 1]);
  check('place: identity quaternion is an identity placement', vecNear(ident.center, [1, 0, 0]) && vecNear(ident.axes[0], [1, 0, 0]));
}

// ── Degenerate inputs ─────────────────────────────────────────
{
  const single = buildObbFromPoints([3, 4, 5], 1);
  check(
    'degenerate: single point -> min-extent box at the point',
    !!single && vecNear(single.center, [3, 4, 5])
      && single.halfExtents.every((h) => near(h, OBB_MIN_HALF_EXTENT)),
  );
  const line = [];
  for (let i = 0; i <= 4; i++) line.push(i, 0, 0);
  const lineObb = buildObbFromPoints(line, 5);
  check(
    'degenerate: collinear points stay finite with clamped extents',
    !!lineObb && lineObb.halfExtents.every((h) => Number.isFinite(h) && h >= OBB_MIN_HALF_EXTENT)
      && lineObb.center.every(Number.isFinite)
      && near(lineObb.halfExtents[0], 2),
    JSON.stringify(lineObb && lineObb.halfExtents),
  );
  const plane = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) plane.push(x, y, 0);
  const planeObb = buildObbFromPoints(plane, 9);
  check(
    'degenerate: planar points stay finite with clamped extents',
    !!planeObb && planeObb.halfExtents.every((h) => Number.isFinite(h) && h >= OBB_MIN_HALF_EXTENT)
      && planeObb.axes.flat().every(Number.isFinite),
  );
  check('degenerate: empty set returns null', buildObbFromPoints([], 0) === null);
  // SAT over degenerate boxes must not NaN.
  const tiny = { center: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfExtents: [OBB_MIN_HALF_EXTENT, OBB_MIN_HALF_EXTENT, OBB_MIN_HALF_EXTENT] };
  const res = obbSatContact(tiny, tiny);
  check('degenerate: SAT of coincident min boxes is finite', res.hit && Number.isFinite(res.depth) && res.normal.every(Number.isFinite));
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
