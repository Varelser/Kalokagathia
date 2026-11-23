// Phase 17 stage 1 — CSG wiring (scene import / result
// chaining / morph backup / B mesh fallback / A offset /
// result history).
// (a) scene import: OBJ source -> normalised display
//     geometry -> indexed OBJ text; the volume survives
//     the round trip (meshVolume cross-check)
// (b) scene import refuses empty / unusable sources
// (c) result chaining: result -> OBJ text -> parsed mesh
//     keeps the volume
// (d) morph take-in backup / restore plans round-trip
// (e) B mesh text fallback: '' -> shared text, set -> B
// (f) A offset: defaults are 0 and offset [0,0,0] is the
//     identity for mesh operand construction
// (g) history: append / cap 8 / newest first / corrupt
//     JSON is "no history" / entry restore keeps volume
// (h) new key defaults (1409-key set additions)
import { build } from 'esbuild';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p17-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const relClose = (a, b, tol = 2e-3) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

await build({
  stdin: {
    contents: `
      export * from './lib/csgSceneImport.ts';
      export * from './lib/csgHistory.ts';
      export { meshVolume } from './lib/csgCore.ts';
      export { buildObjMeshGeometryData } from './lib/objMesh.ts';
      export { parseCsgMeshText, buildMeshOperandFromObj } from './lib/csgMeshOperand.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);

  // A closed cube, side 2, centred on the origin (raw OBJ).
  const CUBE_OBJ = [
    'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1',
    'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
    'f 1 2 3', 'f 1 3 4', 'f 5 7 6', 'f 5 8 7',
    'f 1 5 6', 'f 1 6 2', 'f 2 6 7', 'f 2 7 3',
    'f 3 7 8', 'f 3 8 4', 'f 4 8 5', 'f 4 5 1',
  ].join('\n') + '\n';

  // --- (a) scene import round trip --------------------------------
  const imp = m.buildSceneObjMeshOperandText(CUBE_OBJ);
  check('(a) import ok', imp.ok === true, JSON.stringify(imp));
  if (imp.ok) {
    const display = m.buildObjMeshGeometryData(CUBE_OBJ);
    const displayVolume = m.meshVolume(display.positions, display.indices);
    check('(a) reported volume == display geometry volume', relClose(imp.volume, displayVolume, 1e-9), `${imp.volume} vs ${displayVolume}`);
    // Normalised cube: side 2/sqrt(3) -> |volume| 8/(3*sqrt(3))
    // (meshVolume is signed; the fixture's winding is inward).
    check('(a) volume == normalised cube volume', relClose(Math.abs(imp.volume), 8 / (3 * Math.sqrt(3)), 1e-6), `${imp.volume}`);
    const parsed = m.parseCsgMeshText(imp.objText);
    check('(a) imported text parses back', parsed !== null);
    if (parsed) {
      check('(a) round-trip volume matches', relClose(m.meshVolume(parsed.positions, parsed.indices), imp.volume), `${m.meshVolume(parsed.positions, parsed.indices)} vs ${imp.volume}`);
      check('(a) round-trip counts match', parsed.triangleCount === imp.triangleCount && imp.triangleCount === 12, `${parsed.triangleCount}/${imp.triangleCount}`);
    }
  }

  // --- (b) refusal paths -------------------------------------------
  check('(b) empty source refused', m.buildSceneObjMeshOperandText('').ok === false);
  check('(b) blank source refused', m.buildSceneObjMeshOperandText('   \n').ok === false);
  check('(b) non-OBJ source refused', m.buildSceneObjMeshOperandText('hello world').ok === false);

  // --- (c) result chaining ------------------------------------------
  const cubePositions = new Float32Array([
    -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
  ]);
  const cubeIndices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ]);
  const resultVolume = m.meshVolume(cubePositions, cubeIndices);
  check('(c) fixture |volume| is 8', relClose(Math.abs(resultVolume), 8, 1e-12), `${resultVolume}`);
  const chained = m.buildResultChainOperandText({ positions: cubePositions, indices: cubeIndices });
  const chainedParsed = m.parseCsgMeshText(chained);
  check('(c) chained text parses back', chainedParsed !== null);
  if (chainedParsed) {
    check('(c) chained volume matches result volume', relClose(m.meshVolume(chainedParsed.positions, chainedParsed.indices), resultVolume), `${m.meshVolume(chainedParsed.positions, chainedParsed.indices)} vs ${resultVolume}`);
  }

  // --- (d) backup / restore plans ------------------------------------
  const takeIn = m.planMorphTakeIn('OLD_SOURCE', 'NEW_RESULT');
  check('(d) take-in backs up current source', takeIn.backupObjText === 'OLD_SOURCE');
  check('(d) take-in installs result text', takeIn.morphObjSource === 'NEW_RESULT');
  const restore = m.planMorphRestore(takeIn.backupObjText);
  check('(d) restore returns the original source', restore.morphObjSource === 'OLD_SOURCE');
  const takeInEmpty = m.planMorphTakeIn('', 'NEW_RESULT');
  check('(d) empty current source backs up as empty', takeInEmpty.backupObjText === '' && m.planMorphRestore(takeInEmpty.backupObjText).morphObjSource === '');

  // --- (e) B mesh fallback -------------------------------------------
  check('(e) empty B falls back to shared', m.resolveCsgMeshTextB('SHARED', '') === 'SHARED');
  check('(e) set B wins over shared', m.resolveCsgMeshTextB('SHARED', 'B_ONLY') === 'B_ONLY');
  check('(e) both empty stays empty', m.resolveCsgMeshTextB('', '') === '');

  // --- (f) A offset identity ------------------------------------------
  check('(f) default A offsets are 0', m.DEFAULT_CONFIG.gpgpuCsgOffsetAX === 0 && m.DEFAULT_CONFIG.gpgpuCsgOffsetAY === 0 && m.DEFAULT_CONFIG.gpgpuCsgOffsetAZ === 0);
  const opZero = m.buildMeshOperandFromObj(CUBE_OBJ, [0, 0, 0]);
  const opShift = m.buildMeshOperandFromObj(CUBE_OBJ, [1, 0, 0]);
  check('(f) operand builds ok', opZero.ok === true && opShift.ok === true);
  if (opZero.ok && opShift.ok) {
    const base = m.parseCsgMeshText(CUBE_OBJ);
    let identical = opZero.operand.positions.length === base.positions.length;
    for (let i = 0; i < base.positions.length && identical; i++) {
      if (opZero.operand.positions[i] !== base.positions[i]) identical = false;
    }
    check('(f) offset [0,0,0] is the identity', identical);
    let shifted = opShift.operand.positions.length === base.positions.length;
    for (let i = 0; i < base.positions.length && shifted; i++) {
      const want = base.positions[i] + (i % 3 === 0 ? 1 : 0);
      if (opShift.operand.positions[i] !== want) shifted = false;
    }
    check('(f) offset [1,0,0] shifts x only', shifted);
    check('(f) offset preserves volume magnitude', relClose(Math.abs(m.meshVolume(opShift.operand.positions, opShift.operand.indices)), Math.abs(m.meshVolume(base.positions, base.indices)), 1e-9));
  }

  // --- (g) history -----------------------------------------------------
  check('(g) empty history parses to []', m.parseCsgHistory('').length === 0);
  check('(g) corrupt history parses to []', m.parseCsgHistory('{oops').length === 0);
  check('(g) non-array history parses to []', m.parseCsgHistory('{"a":1}').length === 0);
  check('(g) malformed entries are filtered', m.parseCsgHistory('[{"label":1},null,42]').length === 0);
  const mkEntry = (n) => m.buildCsgHistoryEntry(
    { positions: cubePositions, indices: cubeIndices, volume: resultVolume, triangles: 12 },
    'difference', `entry-${n}`,
  );
  let hist = '';
  for (let n = 1; n <= 10; n++) hist = m.appendCsgHistory(hist, mkEntry(n));
  const entries = m.parseCsgHistory(hist);
  check('(g) history capped at 8', entries.length === 8, `${entries.length}`);
  check('(g) newest first, oldest dropped', entries[0].label === 'entry-10' && entries[7].label === 'entry-3', `${entries[0]?.label}..${entries[7]?.label}`);
  check('(g) entry fields preserved', entries[0].operation === 'difference' && entries[0].triangles === 12 && relClose(entries[0].volume, resultVolume, 1e-12));
  const restored = m.parseCsgMeshText(entries[0].objText);
  check('(g) history entry objText parses back', restored !== null);
  if (restored) {
    check('(g) restored entry volume matches entry volume', relClose(m.meshVolume(restored.positions, restored.indices), entries[0].volume), `${m.meshVolume(restored.positions, restored.indices)} vs ${entries[0].volume}`);
  }
  const corruptAppend = m.appendCsgHistory('{oops', mkEntry(99));
  check('(g) append onto corrupt history starts fresh', m.parseCsgHistory(corruptAppend).length === 1 && m.parseCsgHistory(corruptAppend)[0].label === 'entry-99');

  // --- (h) new key defaults --------------------------------------------
  check('(h) backup key default empty', m.DEFAULT_CONFIG.gpgpuCsgMorphBackupObjText === '');
  check('(h) B mesh key default empty', m.DEFAULT_CONFIG.gpgpuCsgMeshObjTextB === '');
  check('(h) history key default empty', m.DEFAULT_CONFIG.gpgpuCsgHistoryJson === '');
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
