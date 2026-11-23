// Phase 17 E1b regression — CSG chaining ("result becomes
// operand A") against curved (sphere) operands.
//
// Bug (real-GPU gate E1b, 2026-11-23): the first boolean's
// result passed gate (c), but feeding it back as a mesh
// operand and running a second boolean against a sphere
// produced a result whose own gate (c) failed ("辺の共有が
// 崩れています", badEdges 96..505, Euler 50..373) even though
// Manifold reported NoError and the volume matched an
// independent computation. Cube opponents chained fine.
//
// Root cause (measured in VM, see PHASE17_E1B_FIX_RECORD.md):
// Manifold's getMesh() output for the second boolean is an
// unmerged triangulation — the same geometric point appears
// under several vertex indices, split by one float32 ulp
// (~3e-8) or exactly duplicated, with sliver triangles that
// collapse under the gate's own 1e-6 weld. For a fully
// coincident surface (union with the very sphere that carved
// the operand) the result additionally carries zero-volume
// ghost shells inside Manifold (decompose() separates them).
//
// Fix: lib/csgPrimitive.ts manifoldToResultData materialises
// the gate's 1e-6 weld at extraction (weldMeshVertices in
// lib/csgGate.ts — a no-op for meshes with nothing to merge),
// and, only when the welded mesh still fails gate (c),
// retries after dropping zero-volume decompose() parts. The
// gate itself (census + verdict) is unchanged.
//
// Cases:
// (a) chain vs sphere: union / difference / intersection all
//     pass gate (c); volumes cross-checked by meshVolume
// (b) two chain steps in a row pass gate (c)
// (c) the gate E1a/E1b configuration: cube - sphere, then
//     union with an offset sphere (volume 8.5300) and with
//     the coincident sphere (volume 10.0476, ghost shells
//     dropped, 302 triangles)
// (d) weld no-op: a clean primitive boolean is extracted
//     byte-identically to the raw getMesh() output
// (e) broken meshes are still rejected: a missing face fails
//     the gate, a real crack (vertex displaced 1e-4, far
//     above the weld tolerance) is not rescued by the weld,
//     a holed mesh operand still throws at construction
//     (gate (b)), and a vertex-pinched pair of tetrahedra
//     still fails the gate's Euler rule
// (f) the CrossSection extrude extraction (stage-2/3 path
//     through the same manifoldToResultData) still passes
//     gate (c) with volume = area x height
// (g) the same chain cases THROUGH the OBJ text hand-off
//     (buildIndexedObjText -> parseCsgMeshText -> operand).
//     The first fix's cases above pass raw float arrays and
//     never cross the text format; the E1b re-gate showed
//     the hand-off itself was lossy: coordinates were
//     written with toFixed(6), a 1e-6 rounding that turned
//     exactly coincident faces into weld-scale slivers and
//     the coincident-sphere union still failed gate (c)
//     with badEdges=413 (VM reproduction, browser-identical
//     numbers). buildIndexedObjText now writes the shortest
//     decimal that round-trips the float32 bit-exactly, and
//     these cases pin the text path end to end — chain text
//     and history text alike.
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import Module from 'manifold-3d';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17cc-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const relClose = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

await build({
  stdin: {
    contents: `
      export { buildCsgOperand, runCsgBoolean, manifoldToResultData } from './lib/csgPrimitive.ts';
      export { checkWatertightGate, weldMeshVertices } from './lib/csgGate.ts';
      export { meshVolume, buildIndexedObjText } from './lib/csgCore.ts';
      export { buildResultChainOperandText } from './lib/csgSceneImport.ts';
      export { buildMeshOperandFromObj, parseCsgMeshText } from './lib/csgMeshOperand.ts';
      export { buildCsgHistoryEntry, appendCsgHistory, parseCsgHistory } from './lib/csgHistory.ts';
      export { parseObjGeometry } from './lib/objMorph.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const lib = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);
const { buildCsgOperand, runCsgBoolean, manifoldToResultData, checkWatertightGate, weldMeshVertices, meshVolume,
  buildIndexedObjText, buildResultChainOperandText, buildMeshOperandFromObj, parseCsgMeshText,
  buildCsgHistoryEntry, appendCsgHistory, parseCsgHistory, parseObjGeometry } = lib;

const wasm = await Module();
wasm.setup();
const { CrossSection } = wasm;

const prim = (kind, offset, size = 2, segments = 32) => ({
  type: 'primitive',
  spec: { kind, size, segments, offset },
});
const meshOp = (d) => ({ type: 'mesh', positions: d.positions, indices: d.indices });
const run = (a, b, op) => manifoldToResultData(runCsgBoolean(buildCsgOperand(wasm, a), buildCsgOperand(wasm, b), op));

// ---- (a) chain vs sphere, all three operations
const d1 = run(prim('sphere', [0, 0, 0]), prim('sphere', [0.5, 0, 0]), 'union');
check('step1 sphere∪sphere passes gate (c)', d1.gate.ok, d1.gate.reason);
check('step1 census unchanged (V398 E1188 F792)', d1.gate.vertices === 398 && d1.gate.edges === 1188 && d1.gate.faces === 792,
  `V=${d1.gate.vertices} E=${d1.gate.edges} F=${d1.gate.faces}`);
for (const op of ['union', 'difference', 'intersection']) {
  const d2 = run(meshOp(d1), prim('sphere', [0.5, 0, 0]), op);
  check(`chained ${op} vs sphere passes gate (c)`, d2.gate.ok, d2.gate.reason);
  if (op === 'difference') {
    // The difference against a constituent sphere is the
    // worst ghost case (22 decompose parts, one real solid);
    // its volume is the gate report's external value.
    check('chained difference volume 1.5176 (gate-report external value)', relClose(d2.volume, 1.5176, 1e-4), `vol=${d2.volume}`);
    check('chained difference is the single real solid', d2.gate.components === 1, `comp=${d2.gate.components}`);
  }
  check(`chained ${op} volume matches meshVolume cross-check`, relClose(meshVolume(d2.positions, d2.indices), d2.volume, 1e-4),
    `meshVolume=${meshVolume(d2.positions, d2.indices)} volume=${d2.volume}`);
  check(`chained ${op} euler = 2, one component`, d2.gate.euler === 2 && d2.gate.components === 1,
    `euler=${d2.gate.euler} comp=${d2.gate.components}`);
}
// Symmetric placements that produced the worst splits at the gate.
for (const off of [[0, 0.5, 0], [-0.5, 0, 0]]) {
  const d2 = run(meshOp(d1), prim('sphere', off), 'union');
  check(`chained union vs sphere@${off} passes gate (c)`, d2.gate.ok, d2.gate.reason);
}

// ---- (b) two chain steps
const step2 = run(meshOp(d1), prim('sphere', [0, 0.5, 0]), 'union');
const step3 = run(meshOp(step2), prim('sphere', [0, 0, 0.5]), 'difference');
check('second chain step passes gate (c)', step2.gate.ok, step2.gate.reason);
check('third chain step passes gate (c)', step3.gate.ok, step3.gate.reason);
check('third step volume matches meshVolume', relClose(meshVolume(step3.positions, step3.indices), step3.volume, 1e-4));

// ---- (c) gate E1a/E1b configuration
const e1a = run(prim('cube', [0, 0, 0]), prim('sphere', [1, 0, 0]), 'difference');
check('E1a cube-sphere volume 5.9524', relClose(e1a.volume, 5.9524, 1e-4), `vol=${e1a.volume}`);
const e1bOffset = run(meshOp(e1a), prim('sphere', [0.5, 0, 0]), 'union');
check('E1b chained union (offset sphere) passes gate (c)', e1bOffset.gate.ok, e1bOffset.gate.reason);
check('E1b chained union volume 8.5300 (gate-report external value)', relClose(e1bOffset.volume, 8.5300, 1e-4), `vol=${e1bOffset.volume}`);
const e1bCoincident = run(meshOp(e1a), prim('sphere', [1, 0, 0]), 'union');
check('E1b chained union (coincident sphere) passes gate (c)', e1bCoincident.gate.ok, e1bCoincident.gate.reason);
check('E1b coincident volume 10.0476', relClose(e1bCoincident.volume, 10.0476, 1e-4), `vol=${e1bCoincident.volume}`);
check('E1b coincident result is the single real solid (302 tris, euler 2, 1 component)',
  e1bCoincident.triangles === 302 && e1bCoincident.gate.euler === 2 && e1bCoincident.gate.components === 1,
  `tris=${e1bCoincident.triangles} euler=${e1bCoincident.gate.euler} comp=${e1bCoincident.gate.components}`);

// ---- (d) weld no-op identity on a clean primitive boolean
{
  const m = runCsgBoolean(buildCsgOperand(wasm, prim('cube', [0, 0, 0])), buildCsgOperand(wasm, prim('sphere', [1, 0, 0])), 'difference');
  const raw = m.getMesh();
  const data = manifoldToResultData(m);
  const samePos = data.positions.length === raw.vertProperties.length &&
    data.positions.every((v, i) => v === raw.vertProperties[i]);
  const sameIdx = data.indices.length === raw.triVerts.length &&
    data.indices.every((v, i) => v === raw.triVerts[i]);
  check('clean extraction is byte-identical to raw getMesh output', samePos && sameIdx);
}

// ---- (e) broken meshes are still rejected
{
  // One face removed from a valid sphere result.
  const holed = new Uint32Array(d1.indices.slice(3));
  const gHoled = checkWatertightGate(d1.positions, holed);
  check('gate rejects a mesh with a missing face', !gHoled.ok && gHoled.badEdges === 3,
    `ok=${gHoled.ok} badEdges=${gHoled.badEdges}`);

  // A real crack: split one vertex of the (passing) chained
  // union into a copy displaced by 1e-4 (100x the weld
  // tolerance) and re-point one adjacent face at the copy.
  // The faces around the split no longer share their edges,
  // and welding must not rescue it.
  const splitVertex = step2.indices[0];
  const crackedPos = new Float32Array(step2.positions.length + 3);
  crackedPos.set(step2.positions);
  const copyIndex = step2.positions.length / 3;
  crackedPos[copyIndex * 3] = step2.positions[splitVertex * 3] + 1e-4;
  crackedPos[copyIndex * 3 + 1] = step2.positions[splitVertex * 3 + 1];
  crackedPos[copyIndex * 3 + 2] = step2.positions[splitVertex * 3 + 2];
  const crackedIdx = new Uint32Array(step2.indices);
  crackedIdx[0] = copyIndex;
  const gCrackedRaw = checkWatertightGate(crackedPos, crackedIdx);
  const rewelded = weldMeshVertices(crackedPos, crackedIdx);
  const gCrackedWelded = checkWatertightGate(rewelded.positions, rewelded.indices);
  check('gate rejects a 1e-4 split-vertex crack', !gCrackedRaw.ok && gCrackedRaw.badEdges > 0,
    `ok=${gCrackedRaw.ok} badEdges=${gCrackedRaw.badEdges}`);
  check('weld does not rescue a 1e-4 crack', !gCrackedWelded.ok && rewelded.mergedVertices === 0,
    `ok=${gCrackedWelded.ok} merged=${rewelded.mergedVertices}`);

  // Gate (b): a holed mesh operand still throws at construction.
  let threw = false;
  try {
    buildCsgOperand(wasm, { type: 'mesh', positions: d1.positions, indices: holed });
  } catch {
    threw = true;
  }
  check('holed mesh operand still throws at construction (gate b)', threw);

  // Two tetrahedra pinched at one vertex: every edge is shared
  // by exactly two faces, but the Euler characteristic (3 for
  // one component) is impossible for a closed manifold.
  const tetIdx = [0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3];
  const posA = [0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, 0.5, 1];
  const posB = [0, 0, 0, -1, 0, 0, -0.5, -1, 0, -0.5, -0.5, -1];
  const idxB = [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0].map((v) => (v === 0 ? 0 : v + 3));
  const pinchPos = new Float32Array([...posA, ...posB.slice(3)]);
  const pinchIdx = new Uint32Array([...tetIdx, ...idxB]);
  const gPinch = checkWatertightGate(pinchPos, pinchIdx);
  check('gate rejects a vertex-pinched pair of tetrahedra (Euler rule)', !gPinch.ok && gPinch.badEdges === 0,
    `ok=${gPinch.ok} badEdges=${gPinch.badEdges} euler=${gPinch.euler} comp=${gPinch.components}`);
}

// ---- (f) CrossSection extrude extraction still passes
{
  const cs = CrossSection.ofPolygons([[[0, 0], [2, 0], [2, 2], [0, 2]]], 'EvenOdd');
  const solid = cs.extrude(0.5, 0, 0, [1, 1], true);
  const data = manifoldToResultData(solid);
  check('crossSection extrude passes gate (c)', data.gate.ok, data.gate.reason);
  check('crossSection extrude volume = area x height (2)', relClose(data.volume, 2, 1e-6), `vol=${data.volume}`);
}

// ---- (g) chain cases through the OBJ text hand-off
const operandFromText = (text) => {
  const r = buildMeshOperandFromObj(text, [0, 0, 0]);
  if (!r.ok) throw new Error(`operand build refused: ${r.reason}`);
  return r.operand;
};
const runViaChainText = (data, b, op) =>
  manifoldToResultData(runCsgBoolean(buildCsgOperand(wasm, operandFromText(buildResultChainOperandText(data))), buildCsgOperand(wasm, b), op));
{
  // The format itself: tricky float32 values (a 1-ulp pair
  // from the fix record, thirds, large/small magnitudes)
  // survive buildIndexedObjText -> parseObjGeometry
  // bit-exactly, and the writer is deterministic.
  const tricky = new Float32Array([
    0.1, 1 / 3, -0.36736685,
    -0.36736682, 123456.789, 1e-7,
    2.5, -1, 0.99999994,
    0.5, -0.25, 3.4028235e38 * 0.5,
  ]);
  const trickyIdx = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const text1 = buildIndexedObjText(tricky, trickyIdx, 'roundtrip');
  const text2 = buildIndexedObjText(tricky, trickyIdx, 'roundtrip');
  check('OBJ text writer is deterministic', text1 === text2);
  const back = parseObjGeometry(text1);
  check('OBJ text round-trip is bit-exact for float32 coordinates',
    back !== null && back.vertices.length === tricky.length &&
    tricky.every((v, i) => back.vertices[i] === v),
    back ? `verts=${back.vertices.length}` : 'parse returned null');

  // The re-gate's failing case, through the chain text:
  // (cube - sphere) unioned with the coincident sphere.
  const coincidentText = runViaChainText(e1a, prim('sphere', [1, 0, 0]), 'union');
  check('TEXT chain: coincident union passes gate (c)', coincidentText.gate.ok, coincidentText.gate.reason);
  check('TEXT chain: coincident volume 10.0476 (external cross-check)', relClose(coincidentText.volume, 10.0476, 1e-4), `vol=${coincidentText.volume}`);
  check('TEXT chain: coincident result matches the raw path (302 tris, euler 2, 1 component)',
    coincidentText.triangles === 302 && coincidentText.gate.euler === 2 && coincidentText.gate.components === 1,
    `tris=${coincidentText.triangles} euler=${coincidentText.gate.euler} comp=${coincidentText.gate.components}`);

  // The same result arriving via the HISTORY text (the
  // history serialises through the same writer, then the
  // entry is put back as an operand).
  const historyJson = appendCsgHistory('', buildCsgHistoryEntry(
    { positions: e1a.positions, indices: e1a.indices, volume: e1a.volume, triangles: e1a.triangles },
    'difference', 'test-entry',
  ));
  const entries = parseCsgHistory(historyJson);
  check('TEXT history: entry survives serialise/parse', entries.length === 1);
  if (entries.length === 1) {
    const viaHistory = manifoldToResultData(runCsgBoolean(
      buildCsgOperand(wasm, operandFromText(entries[0].objText)),
      buildCsgOperand(wasm, prim('sphere', [1, 0, 0])), 'union'));
    check('TEXT history: coincident union passes gate (c)', viaHistory.gate.ok, viaHistory.gate.reason);
    check('TEXT history: coincident volume 10.0476', relClose(viaHistory.volume, 10.0476, 1e-4), `vol=${viaHistory.volume}`);
  }

  // E1b offset union through the text.
  const offsetText = runViaChainText(e1a, prim('sphere', [0.5, 0, 0]), 'union');
  check('TEXT chain: E1b offset union passes gate (c)', offsetText.gate.ok, offsetText.gate.reason);
  check('TEXT chain: E1b offset volume 8.5300', relClose(offsetText.volume, 8.5300, 1e-4), `vol=${offsetText.volume}`);

  // Union @0.5 through the text, then a SECOND text
  // hand-off in a row (two chain steps, both via text).
  const chainT1 = runViaChainText(d1, prim('sphere', [0.5, 0, 0]), 'union');
  check('TEXT chain: union @0.5 passes gate (c)', chainT1.gate.ok, chainT1.gate.reason);
  check('TEXT chain: union @0.5 volume matches meshVolume', relClose(meshVolume(chainT1.positions, chainT1.indices), chainT1.volume, 1e-4),
    `meshVolume=${meshVolume(chainT1.positions, chainT1.indices)} volume=${chainT1.volume}`);
  const chainT2 = runViaChainText(chainT1, prim('sphere', [0, 0, 0.5]), 'difference');
  check('TEXT chain: second text hand-off passes gate (c)', chainT2.gate.ok, chainT2.gate.reason);
  check('TEXT chain: second hand-off volume matches meshVolume', relClose(meshVolume(chainT2.positions, chainT2.indices), chainT2.volume, 1e-4),
    `meshVolume=${meshVolume(chainT2.positions, chainT2.indices)} volume=${chainT2.volume}`);

  // The parsed operand of a clean result keeps its counts
  // (the parse-side weld finds nothing new to merge).
  const parsedE1a = parseCsgMeshText(buildResultChainOperandText(e1a));
  check('TEXT chain: parsed operand keeps 302 triangles', parsedE1a !== null && parsedE1a.triangleCount === 302,
    parsedE1a ? `tris=${parsedE1a.triangleCount}` : 'parse returned null');
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
