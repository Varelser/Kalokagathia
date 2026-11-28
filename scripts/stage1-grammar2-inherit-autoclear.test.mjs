// Grammar 2.0 stage 1 — spawn inheritance texture reads
// back all-zero even after the attribute-bake fix
// (real-GPU gate C4-1, second measurement: the level-1
// inheritance texture — the very RT the draw samples — was
// zero in every texel, while children visibly spawned and
// mixed toward black).
//
// Root cause (the second gap, after STAGE1_INHERIT_FIX_
// RECORD.md): the inheritance write is a SPARSE write —
// the fragment discards every non-spawning texel so the
// record a slot wrote at its spawn persists until its next
// spawn. But three.js clears the bound render target at
// the start of every render() while renderer.autoClear is
// on (the default, r187), and the two inheritance renders
// in gpgpuSimulationPasses never opted out. Every frame,
// the render first erased the whole texture to (0,0,0,0)
// and then wrote only that frame's spawns; a record lived
// only for the rest of its spawn frame, during which the
// child is still in its fade-in (alpha ~0), so every
// visible child and every later readback saw (0,0,0).
// The codebase's other partial write (the replica merge)
// already carries the save / off / restore discipline for
// exactly this reason; the inheritance passes were the
// only partial write without it.
//
// Proven outside this test (VM software-GL repro with the
// app's own three r187 and assembled shaders, record:
// STAGE1_INHERIT_FIX2_RECORD.md): stock discipline — the
// nonzero texel count stays flat at one frame's spawns
// (~67 of 16384) for 120 frames; with autoClear off only
// around the inheritance render it accumulates monotonic
// to ~49%, every written texel at the parent slot (1,0,0).
//
// The fix: wrap BOTH inheritance renders (level 1 and
// chain) in the merge pass's discipline — save gl.autoClear,
// set it false for the render, restore it after. No shader
// string, key, uniform or guard changes: with inheritance
// absent the wrapped code never runs, and with the colour
// mix off the texture is never sampled, so every config
// that does not use inheritance colour is untouched.
//
// Cases:
//  1 discipline pins: both `gl.setRenderTarget(inherit.target)`
//    renders in the passes file are wrapped save -> off ->
//    render -> restore, in that order; the toggling is
//    scoped (the whole file holds exactly the two new
//    wrapped sites plus the pre-existing merge site)
//  2 guard pins: the level-1 write still runs only under
//    `inherit && inherit.mainAttrTex`, the chain write
//    only under `inherit` — the fix changed nothing about
//    WHEN the passes run
//  3 shader identity: both inheritance fragment strings
//    are byte-identical to their pre-fix sha256 pins, and
//    still carry the sparse-discard semantics that make
//    the discipline necessary
//  4 premise pin: the bundled three still defaults
//    autoClear to true and clears on render — if a future
//    three changes that default, this case fails and the
//    fix's premise must be re-reviewed
import { build } from 'esbuild';
import { readFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s1inhac-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { buildAuxInheritFrag, AUX_INHERIT_FRAG, AUX_CHAIN_INHERIT_FRAG } from './components/gpgpuShaderAux.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
const shaders = await import(pathToFileURL(BUNDLE).href);
unlinkSync(BUNDLE);

const passes = readFileSync(join(ROOT, 'components', 'gpgpuSimulationPasses.ts'), 'utf8');

// ── 1. discipline pins ────────────────────────────────────
const TARGET = 'gl.setRenderTarget(inherit.target);';
const siteIdx = [];
for (let i = passes.indexOf(TARGET); i !== -1; i = passes.indexOf(TARGET, i + 1)) siteIdx.push(i);
check('1a both inheritance renders exist (level 1 + chain)', siteIdx.length === 2,
  `found ${siteIdx.length}`);

const SAVE = 'const prevInheritAutoClear = gl.autoClear;';
const OFF = 'gl.autoClear = false;';
const RENDER = 'gl.render(simScene, simCamera);';
const RESTORE = 'gl.autoClear = prevInheritAutoClear;';
siteIdx.forEach((idx, n) => {
  const seg = passes.slice(idx, idx + 800);
  const at = (tok) => seg.indexOf(tok);
  check(`1b site ${n + 1}: save -> off -> render -> restore, in order`,
    at(SAVE) !== -1 && at(OFF) !== -1 && at(RENDER) !== -1 && at(RESTORE) !== -1
      && at(SAVE) < at(OFF) && at(OFF) < at(RENDER) && at(RENDER) < at(RESTORE),
    JSON.stringify({ save: at(SAVE), off: at(OFF), render: at(RENDER), restore: at(RESTORE) }));
});
check('1c the discipline variable is used at exactly the two sites',
  passes.split('prevInheritAutoClear').length - 1 === 4,
  `found ${passes.split('prevInheritAutoClear').length - 1}`);
check('1d toggling is scoped: autoClear=false appears only at the two wrapped sites + the pre-existing merge site',
  passes.split(OFF).length - 1 === 3,
  `found ${passes.split(OFF).length - 1}`);

// ── 2. guard pins ─────────────────────────────────────────
check('2a level-1 write still gated on inherit && inherit.mainAttrTex',
  passes.includes('if (inherit && inherit.mainAttrTex)'));
check('2b chain write still gated on inherit alone',
  /if \(inherit\) \{\n    const inhU = inherit\.mat\.uniforms;/.test(passes));

// ── 3. shader identity ────────────────────────────────────
const sha = (s) => createHash('sha256').update(s).digest('hex');
check('3a level-1 inheritance fragment is byte-identical to the pre-fix pin',
  sha(shaders.AUX_INHERIT_FRAG) === '5556a8cfb29febe9bde7c6268308d5b7de73b3d39e08ed50d7a51fe3bd054383',
  sha(shaders.AUX_INHERIT_FRAG));
check('3b chain inheritance fragment is byte-identical to the pre-fix pin',
  sha(shaders.AUX_CHAIN_INHERIT_FRAG) === 'b33a3cbe85a8c3af7cf1a8d7504ae4f8b4e6d4777b4d8081ebb5ca926cfec28a',
  sha(shaders.AUX_CHAIN_INHERIT_FRAG));
check('3c builders still return the pinned strings',
  shaders.buildAuxInheritFrag() === shaders.AUX_INHERIT_FRAG
    && shaders.buildAuxInheritFrag({ chain: true }) === shaders.AUX_CHAIN_INHERIT_FRAG);
check('3d both fragments keep the sparse-discard write semantics',
  shaders.AUX_INHERIT_FRAG.includes('discard;') && shaders.AUX_CHAIN_INHERIT_FRAG.includes('discard;')
    && shaders.AUX_INHERIT_FRAG.includes('gAuxSpawnSrcUv = srcUv;')
    && shaders.AUX_CHAIN_INHERIT_FRAG.includes('gAuxSpawnSrcUv = srcUv;'));

// ── 4. premise pin (the bundled three) ────────────────────
const threeSrc = readFileSync(join(ROOT, 'node_modules', 'three', 'build', 'three.module.js'), 'utf8');
check('4a three still defaults renderer.autoClear to true',
  threeSrc.includes('this.autoClear = true;'));
check('4b three still clears the bound target on render while autoClear is on',
  threeSrc.includes('if ( renderer.autoClear || forceClear )'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
