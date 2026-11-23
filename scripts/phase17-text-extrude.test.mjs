// Phase 17 stage 3 — text extrusion: glyph outlines from a
// real font (opentype.js) laid out by lib/textExtrude.ts, then
// extruded through the stage-2 CrossSection path. The worker
// (workers/csgWorker.ts) cannot run under the plain node
// loader, so the extrude half mirrors its exact operations
// (classifyContours -> CrossSection.ofPolygons 'EvenOdd' ->
// extrude -> acceptance checks) against the real WASM module,
// exactly like scripts/phase17-vector-boolean.test.mjs (i).
//
// Cases:
// (a) parse: a real TTF parses; garbage bytes are refused
// (b) 'O' keeps its hole through classification (island 1 /
//     hole 1) and the net area is the island minus the hole
// (c) extrude volume = (island - hole area) x depth, cross-
//     checked by meshVolume on the returned mesh
// (d) determinism: same font + string twice -> identical
//     contours, identical SVG, byte-identical OBJ text
// (e) composite glyphs: 'A' (outer + counter), '8' (two holes)
// (f) layout: advance accumulates per glyph (OO > O, and O's
//     advance equals the font's advanceWidth), multi-line
//     stacks (lineCount 2, contours double)
// (g) flatness: a coarser tolerance yields fewer points
// (h) refusals: empty text, whitespace-only text, bad file
//     name gate
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import Module from 'manifold-3d';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17te-bundle-${process.pid}.mjs`);
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const relClose = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

await build({
  stdin: {
    contents: `
      export * from './lib/textExtrude.ts';
      export { classifyContours, serializeContours } from './lib/vectorBoolean.ts';
      export { buildIndexedObjText, meshVolume } from './lib/csgCore.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

const wasm = await Module();
wasm.setup();
const { CrossSection } = wasm;

// Mirror of the worker's runCrossSectionExtrude acceptance path
// (identical to the stage-2 test's mirror).
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

try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const fontBytes = readFileSync(FONT_PATH);
  const fontBuffer = fontBytes.buffer.slice(fontBytes.byteOffset, fontBytes.byteOffset + fontBytes.byteLength);

  // --- (a) parse -------------------------------------------------
  const parsed = m.parseTextExtrudeFont(fontBuffer);
  check('(a) real TTF parses', parsed.ok === true, parsed.ok ? '' : parsed.reason);
  check('(a) unitsPerEm is DejaVu 2048', parsed.ok && parsed.info.unitsPerEm === 2048,
    parsed.ok ? String(parsed.info.unitsPerEm) : '');
  check('(a) family name present', parsed.ok && parsed.info.familyName.length > 0,
    parsed.ok ? parsed.info.familyName : '');
  const garbage = m.parseTextExtrudeFont(new TextEncoder().encode('this is not a font').buffer);
  check('(a) garbage bytes refused', garbage.ok === false && garbage.reason.length > 0);
  const font = parsed.font;

  // --- (b) 'O' hole survives classification ----------------------
  const oLayout = m.layoutTextExtrudeContours(font, 'O', 0.001);
  check('(b) O layout ok', oLayout.ok === true, oLayout.ok ? '' : oLayout.reason);
  const o = oLayout.layout;
  check('(b) O island 1 / hole 1', o.islandCount === 1 && o.holeCount === 1,
    `islands=${o.islandCount} holes=${o.holeCount}`);
  check('(b) O net area positive and below island-only bound', o.netArea > 0.5 && o.netArea < 2.5,
    `netArea=${o.netArea}`);

  // --- (c) extrude volume = net area x depth ---------------------
  const depth = 0.4;
  const solid = runCrossSectionExtrude(m, o.contours, depth);
  check('(c) volume = netArea x depth', relClose(solid.volume, o.netArea * depth),
    `volume=${solid.volume} expected=${o.netArea * depth}`);
  check('(c) meshVolume cross-check agrees', relClose(Math.abs(m.meshVolume(solid.positions, solid.indices)), solid.volume),
    `meshVolume=${m.meshVolume(solid.positions, solid.indices)} volume=${solid.volume}`);
  check('(c) triangles > 0', solid.triangles > 0, String(solid.triangles));
  console.log(`      O: netArea=${o.netArea.toFixed(6)} volume=${solid.volume.toFixed(6)} triangles=${solid.triangles} points=${o.pointCount}`);

  // --- (d) determinism -------------------------------------------
  const o2 = m.layoutTextExtrudeContours(font, 'O', 0.001);
  check('(d) layout twice -> identical contours',
    o2.ok && m.serializeContours(o2.layout.contours) === m.serializeContours(o.contours));
  check('(d) layout twice -> identical SVG', o2.ok && o2.layout.svgText === o.svgText);
  const solid2 = runCrossSectionExtrude(m, o.contours, depth);
  const obj1 = m.buildIndexedObjText(solid.positions, solid.indices, 'text-extrude');
  const obj2 = m.buildIndexedObjText(solid2.positions, solid2.indices, 'text-extrude');
  check('(d) extrude twice -> byte-identical OBJ text', obj1 === obj2,
    `len ${obj1.length} vs ${obj2.length}`);

  // --- (e) composite glyphs --------------------------------------
  const aLayout = m.layoutTextExtrudeContours(font, 'A', 0.001);
  check('(e) A island 1 / hole 1 (counter)',
    aLayout.ok && aLayout.layout.islandCount === 1 && aLayout.layout.holeCount === 1,
    aLayout.ok ? `islands=${aLayout.layout.islandCount} holes=${aLayout.layout.holeCount}` : aLayout.reason);
  const eightLayout = m.layoutTextExtrudeContours(font, '8', 0.001);
  check('(e) 8 island 1 / hole 2',
    eightLayout.ok && eightLayout.layout.islandCount === 1 && eightLayout.layout.holeCount === 2,
    eightLayout.ok ? `islands=${eightLayout.layout.islandCount} holes=${eightLayout.layout.holeCount}` : eightLayout.reason);
  if (aLayout.ok) {
    const aSolid = runCrossSectionExtrude(m, aLayout.layout.contours, depth);
    check('(e) A volume = netArea x depth', relClose(aSolid.volume, aLayout.layout.netArea * depth),
      `volume=${aSolid.volume} expected=${aLayout.layout.netArea * depth}`);
  }

  // --- (f) layout: advance + multi-line --------------------------
  const ooLayout = m.layoutTextExtrudeContours(font, 'OO', 0.001);
  check('(f) OO glyphCount 2 / island 2 / hole 2',
    ooLayout.ok && ooLayout.layout.glyphCount === 2 && ooLayout.layout.islandCount === 2 && ooLayout.layout.holeCount === 2,
    ooLayout.ok ? `glyphs=${ooLayout.layout.glyphCount}` : ooLayout.reason);
  const expectedAdvance = font.charToGlyph('O').advanceWidth / font.unitsPerEm;
  check('(f) O advance equals font advanceWidth (em)',
    Math.abs(o.advanceEm - expectedAdvance) < 1e-9, `advance=${o.advanceEm} expected=${expectedAdvance}`);
  check('(f) OO advance > O advance (glyphs are laid out side by side)',
    ooLayout.ok && ooLayout.layout.advanceEm > o.advanceEm,
    ooLayout.ok ? `${ooLayout.layout.advanceEm} vs ${o.advanceEm}` : '');
  const twoLine = m.layoutTextExtrudeContours(font, 'O\nO', 0.001);
  check('(f) two lines: lineCount 2, contours double',
    twoLine.ok && twoLine.layout.lineCount === 2 && twoLine.layout.islandCount === 2 && twoLine.layout.holeCount === 2,
    twoLine.ok ? `lines=${twoLine.layout.lineCount}` : twoLine.reason);

  // --- (g) flatness ----------------------------------------------
  const coarse = m.layoutTextExtrudeContours(font, 'O', 0.05);
  check('(g) coarser flatness -> fewer points',
    coarse.ok && coarse.layout.pointCount < o.pointCount,
    coarse.ok ? `${coarse.layout.pointCount} vs ${o.pointCount}` : coarse.reason);

  // --- (h) refusals ----------------------------------------------
  check('(h) empty text refused', m.layoutTextExtrudeContours(font, '', 0.001).ok === false);
  check('(h) whitespace-only text refused', m.layoutTextExtrudeContours(font, '   ', 0.001).ok === false);
  check('(h) file name gate: .ttf/.OTF pass, .woff2 refused',
    m.isTextExtrudeFontFileName('a.ttf') && m.isTextExtrudeFontFileName('b.OTF') && !m.isTextExtrudeFontFileName('c.woff2'));
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
