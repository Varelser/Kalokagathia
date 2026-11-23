// Phase 17 stage 2 — vector Boolean (2D) over manifold-3d
// CrossSection, plus the CrossSection extrusion path.
// The worker (workers/csgWorker.ts) cannot run under the plain
// node loader, so this test mirrors its exact operations
// (ofPolygons 'EvenOdd' -> add/subtract/intersect, xor as the
// (A-B)+(B-A) composition, classifyContours normalisation,
// extrude acceptance checks) against the real WASM module and
// the real pure helpers of lib/vectorBoolean.ts:
//
// (a) four ops on overlapping circles: areas within tolerance
//     of the analytic values
// (b) difference keeps the hole (island 1 / hole 1, area exact)
// (c) disjoint intersection is a normal empty result
// (d) same input twice -> byte-identical serialized output
// (e) classification repairs a CCW hole (the spike-2 trap)
// (f) validateContours refuses a self-intersecting contour
// (g) SVG text -> contours -> result SVG -> contours round trip
// (h) contours -> PathGeometry bridge
// (i) crossSectionExtrude: volume = area x height, the hole
//     goes through (volume cross-checked by meshVolume), and
//     the area re-verification the worker performs
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import Module from 'manifold-3d';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17vb-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const relClose = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

await build({
  stdin: {
    contents: `
      export * from './lib/vectorBoolean.ts';
      export { meshVolume } from './lib/csgCore.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

const wasm = await Module();
wasm.setup();
const { CrossSection } = wasm;

// Mirror of the worker's runVectorBoolean.
function runVectorBoolean(m, aContours, bContours, op) {
  const a = CrossSection.ofPolygons(aContours, 'EvenOdd');
  const b = CrossSection.ofPolygons(bContours, 'EvenOdd');
  let result;
  if (op === 'union') result = a.add(b);
  else if (op === 'difference') result = a.subtract(b);
  else if (op === 'intersection') result = a.intersect(b);
  else result = a.subtract(b).add(b.subtract(a)); // xor composition
  if (result.isEmpty()) return { contours: [], area: 0, islandCount: 0, holeCount: 0 };
  const classified = m.classifyContours(result.toPolygons());
  return {
    contours: classified.contours,
    area: result.area(),
    islandCount: classified.islandCount,
    holeCount: classified.holeCount,
  };
}

// Mirror of the worker's runCrossSectionExtrude acceptance path.
function runCrossSectionExtrude(m, contours, height, divisions = 0, twistDegrees = 0, scaleTop = 1) {
  const classified = m.classifyContours(contours);
  if (classified.contours.length === 0 || !(classified.netArea > 0)) throw new Error('EMPTY_RESULT');
  const cs = CrossSection.ofPolygons(classified.contours, 'EvenOdd');
  if (Math.abs(cs.area() - classified.netArea) > 1e-6 * Math.max(1, classified.netArea)) {
    throw new Error('AREA_MISMATCH');
  }
  const solid = cs.extrude(height, divisions, twistDegrees, [scaleTop, scaleTop], true);
  if (solid.isEmpty()) throw new Error('EMPTY_RESULT');
  if (solid.status() !== 'NoError') throw new Error('NOT_MANIFOLD');
  const mesh = solid.getMesh();
  const numProp = mesh.numProp || 3;
  const vertCount = Math.floor(mesh.vertProperties.length / numProp);
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    positions[i * 3] = mesh.vertProperties[i * numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * numProp + 2];
  }
  const indices = new Uint32Array(mesh.triVerts);
  const volume = solid.volume();
  if (twistDegrees === 0 && scaleTop === 1) {
    const expected = cs.area() * height;
    if (Math.abs(volume - expected) > 1e-6 * Math.max(1, Math.abs(expected))) {
      throw new Error('VOLUME_MISMATCH');
    }
  }
  return { positions, indices, volume, triangles: indices.length / 3, area: cs.area() };
}

function circle(cx, cy, r, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
function rect(cx, cy, w, h) {
  return [
    [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
    [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2],
  ];
}

try {
  const m = await import(pathToFileURL(BUNDLE).href);

  // --- (a) four ops, analytic areas --------------------------------
  const A = [circle(0, 0, 1)];
  const B = [circle(1, 0, 1)];
  const inter = (2 * Math.PI) / 3 - Math.sqrt(3) / 2; // r=1, d=1
  const analytic = {
    union: 2 * Math.PI - inter,
    difference: Math.PI - inter,
    intersection: inter,
    xor: 2 * Math.PI - 2 * inter,
  };
  for (const op of ['union', 'difference', 'intersection', 'xor']) {
    const r = runVectorBoolean(m, A, B, op);
    check(`(a) ${op} area`, relClose(r.area, analytic[op], 0.01), `${r.area} vs ${analytic[op]}`);
  }

  // --- (b) difference keeps the hole --------------------------------
  const holed = runVectorBoolean(m, [rect(0, 0, 4, 4)], [rect(0, 0, 2, 2)], 'difference');
  check('(b) hole area exact', Math.abs(holed.area - 12) < 1e-9, String(holed.area));
  check('(b) island/hole counts', holed.islandCount === 1 && holed.holeCount === 1,
    `${holed.islandCount}/${holed.holeCount}`);
  check('(b) hole winding is CW', m.signedContourArea(holed.contours[1]) < 0,
    String(m.signedContourArea(holed.contours[1])));

  // --- (c) disjoint intersection is empty, not an error -------------
  const empty = runVectorBoolean(m, [rect(-2, 0, 1, 1)], [rect(2, 0, 1, 1)], 'intersection');
  check('(c) empty intersection', empty.contours.length === 0 && empty.area === 0,
    JSON.stringify(empty));

  // --- (d) determinism: byte-identical serialized output -----------
  const u1 = runVectorBoolean(m, A, B, 'union');
  const u2 = runVectorBoolean(m, A, B, 'union');
  check('(d) deterministic', m.serializeContours(u1.contours) === m.serializeContours(u2.contours));

  // --- (e) classification repairs a CCW hole ------------------------
  const cls = m.classifyContours([rect(0, 0, 4, 4), rect(0, 0, 2, 2)]); // both CCW
  check('(e) CCW hole classified as hole', cls.islandCount === 1 && cls.holeCount === 1,
    `${cls.islandCount}/${cls.holeCount}`);
  check('(e) net area', Math.abs(cls.netArea - 12) < 1e-9, String(cls.netArea));

  // --- (f) validation ----------------------------------------------
  const bowtie = [[0, 0], [1, 1], [1, 0], [0, 1]];
  check('(f) bowtie refused', m.validateContours([bowtie], 'A').ok === false);
  check('(f) square accepted', m.validateContours([rect(0, 0, 2, 2)], 'A').ok === true);
  check('(f) empty refused', m.validateContours([], 'B').ok === false);

  // --- (g) SVG round trip -------------------------------------------
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + '<rect x="10" y="10" width="80" height="80"/></svg>';
  const contours = m.svgTextToContours(svg);
  check('(g) svg -> contours', !!contours && contours.length === 1, JSON.stringify(contours));
  if (contours) {
    // Normalised against the viewBox frame: the 80/100 rect is
    // 1.6 wide in [-1,1]^2 -> area 2.56.
    check('(g) normalised area', relClose(m.contoursNetArea(contours), 2.56, 1e-6),
      String(m.contoursNetArea(contours)));
    const back = m.svgTextToContours(m.contoursToSvgText(contours));
    check('(g) round trip area', !!back && relClose(m.contoursNetArea(back), 2.56, 1e-4),
      back ? String(m.contoursNetArea(back)) : 'null');
  }
  check('(g) open path yields null', m.svgTextToContours(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10 L90 90"/></svg>',
  ) === null);

  // --- (h) PathGeometry bridge --------------------------------------
  const geom = m.contoursToPathGeometry(holed.contours);
  check('(h) geometry subpaths', !!geom && geom.subpaths.length === 2 && geom.subpaths.every((s) => s.closed),
    geom ? String(geom.subpaths.length) : 'null');
  check('(h) geometry length', !!geom && geom.totalLength > 0, geom ? String(geom.totalLength) : 'null');

  // --- (i) crossSectionExtrude --------------------------------------
  const ext = runCrossSectionExtrude(m, [rect(0, 0, 4, 4), rect(0, 0, 2, 2)], 2);
  check('(i) holed extrude volume = area x height', relClose(ext.volume, 24, 1e-6), String(ext.volume));
  check('(i) meshVolume cross-check', relClose(Math.abs(m.meshVolume(ext.positions, ext.indices)), 24, 1e-6),
    String(m.meshVolume(ext.positions, ext.indices)));
  check('(i) area reported', relClose(ext.area, 12, 1e-9), String(ext.area));
  const plain = runCrossSectionExtrude(m, [rect(0, 0, 4, 4)], 3);
  check('(i) plain extrude volume', relClose(plain.volume, 48, 1e-6), String(plain.volume));

} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
