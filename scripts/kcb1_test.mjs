// KCB1 unit tests: ctrl() control declarations for the GPGPU custom
// force (extraction / validation / shader generation / identity).
// Plain Node, no test framework — same style as
// scripts/bench-harness.test.mjs. The TS modules under test are
// bundled with esbuild (a project devDependency) into a temp file.
// Run: node scripts/kcb1_test.mjs   (from the project root)

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.kcb1-test-bundle-${process.pid}.mjs`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

await build({
  stdin: {
    contents: `
      export { extractCustomForceControls, applyCtrlDeclarations, buildCtrlUniformDeclarations,
        resolveCtrlValues, buildCtrlUniformEntries, syncCtrlUniforms, ctrlUniformName } from './lib/gpgpuCustomForceControls.ts';
      export { validateCustomForceCode, buildCustomForceHarness } from './lib/gpgpuCustomForce.ts';
      export { SIM_VEL_FRAG, buildVelocityFragment } from './components/gpgpuShaderSimulationVelocity.ts';
    `,
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});

try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    extractCustomForceControls, applyCtrlDeclarations, buildCtrlUniformDeclarations,
    resolveCtrlValues, buildCtrlUniformEntries, syncCtrlUniforms, ctrlUniformName,
    validateCustomForceCode, buildCustomForceHarness, SIM_VEL_FRAG, buildVelocityFragment,
  } = m;

  // ---- extraction: normal -------------------------------------------------
  {
    const r = extractCustomForceControls('float speed = ctrl("speed", 0.0, 5.0, 1.0);\nfloat k = ctrl("gain_2", -2.5, 1e2, .5);');
    check('extract: two declarations parsed', r.ok && r.decls.length === 2);
    check('extract: values parsed (sign/exponent/short decimal)',
      r.decls[1]?.min === -2.5 && r.decls[1]?.max === 100 && r.decls[1]?.defaultValue === 0.5);
    check('extract: no declaration -> ok with empty list', (() => { const e = extractCustomForceControls('vel.y += 1.0;'); return e.ok && e.decls.length === 0; })());
  }

  // ---- extraction: errors ---------------------------------------------------
  {
    const dup = extractCustomForceControls('ctrl("a", 0, 1, 0) + ctrl("a", 0, 2, 1)');
    check('extract: duplicate id rejected', !dup.ok && /重複/.test(dup.error ?? ''));
    const outOfRange = extractCustomForceControls('ctrl("a", 0, 1, 2)');
    check('extract: default out of range rejected', !outOfRange.ok && /範囲/.test(outOfRange.error ?? ''));
    const badRange = extractCustomForceControls('ctrl("a", 3, 3, 3)');
    check('extract: min >= max rejected', !badRange.ok);
    const malformed = extractCustomForceControls('ctrl("a", 0, 1)');
    check('extract: missing argument rejected as malformed', !malformed.ok && /書式/.test(malformed.error ?? ''));
    const unquoted = extractCustomForceControls('ctrl(a, 0, 1, 0)');
    check('extract: unquoted id rejected as malformed', !unquoted.ok);
    const nonLiteral = extractCustomForceControls('ctrl("a", 0, 1, uTime)');
    check('extract: non-literal argument rejected as malformed', !nonLiteral.ok);
    const reserved = extractCustomForceControls('ctrl("vel", 0, 1, 0)');
    check('extract: reserved id rejected', !reserved.ok && /予約/.test(reserved.error ?? ''));
    const badId = extractCustomForceControls('ctrl("9x", 0, 1, 0)');
    check('extract: id starting with a digit rejected', !badId.ok);
    const many = Array.from({ length: 17 }, (_, i) => `ctrl("c${i}", 0, 1, 0)`).join(' + ');
    check('extract: more than 16 declarations rejected', !extractCustomForceControls(many).ok);
  }

  // ---- validation coexistence (forbidden tokens stay in force) -------------
  {
    check('validate: plain snippet ok', validateCustomForceCode('vel.y += 1.0;').ok);
    check('validate: ctrl snippet ok', validateCustomForceCode('float s = ctrl("s", 0, 5, 1); vel.y += s;').ok);
    const forb = validateCustomForceCode('uniform float x; float s = ctrl("s", 0, 5, 1);');
    check('validate: forbidden token still rejected alongside ctrl', !forb.ok && /uniform/.test(forb.error ?? ''));
    const hash = validateCustomForceCode('#define X 1\nvel.y += 1.0;');
    check('validate: preprocessor still rejected', !hash.ok);
    const dupV = validateCustomForceCode('ctrl("a", 0, 1, 0) + ctrl("a", 0, 1, 0)');
    check('validate: duplicate ctrl rejected through validateCustomForceCode', !dupV.ok);
  }

  // ---- transform / uniforms -------------------------------------------------
  {
    const { decls } = extractCustomForceControls('float s = ctrl("speed", 0, 5, 1);');
    check('transform: call rewritten to uniform reference',
      applyCtrlDeclarations('float s = ctrl("speed", 0, 5, 1);', decls) === 'float s = uCtrl_speed;');
    check('transform: no declarations -> input unchanged',
      applyCtrlDeclarations('vel.y += 1.0;', []) === 'vel.y += 1.0;');
    check('uniform decls: empty -> empty string', buildCtrlUniformDeclarations([]) === '');
    check('uniform decls: one line per control',
      buildCtrlUniformDeclarations(decls) === '  uniform float uCtrl_speed;\n');
    check('uniform name', ctrlUniformName('speed') === 'uCtrl_speed');
    const vals = resolveCtrlValues(decls, { speed: 99 });
    check('resolve: stored value clamped to range', vals.speed === 5);
    check('resolve: missing stored value -> declared default', resolveCtrlValues(decls, {}).speed === 1);
    check('resolve: NaN stored value -> declared default', resolveCtrlValues(decls, { speed: NaN }).speed === 1);
    const uniforms = { uTime: { value: 0 }, uCtrl_stale: { value: 3 } };
    syncCtrlUniforms(uniforms, decls, { speed: 2.5 });
    check('sync: entry created with resolved value', uniforms.uCtrl_speed?.value === 2.5);
    check('sync: stale uCtrl_* entry removed', !('uCtrl_stale' in uniforms));
    const ref = uniforms.uCtrl_speed;
    syncCtrlUniforms(uniforms, decls, { speed: 4 });
    check('sync: existing entry updated in place (no rebuild needed)', uniforms.uCtrl_speed === ref && ref.value === 4);
    check('entries: buildCtrlUniformEntries shape', buildCtrlUniformEntries(decls, {}).uCtrl_speed.value === 1);
  }

  // ---- identity (pre-KCB1 baseline) ---------------------------------------
  // Baseline re-measured at the Phase 15 port (2026-11-23): the original
  // constants were the v1.89 stock shader (len 81505). The v1.96 stock
  // shader legitimately grew (Phases DL/DO/DP), and the pre-port canonical
  // builder was verified to produce exactly the values below, so the
  // KCB1 insertion remains byte-identity-preserving on the current tree.
  // Re-baselined again the same day for Phase 15 §3 (generalised steering
  // avoidance): a strength-0-gated block added +1063 bytes to both the
  // stock shader and the builder output; the other identity checks
  // (empty snippet = stock, declaration-free harness) still pass, which
  // is what proves the ctrl machinery itself alters nothing.
  // Re-baselined a third time for Phase 15 §7 (SPH surface selectivity):
  // a selectivity-0-exact (factor 1.0) weighting added +514 bytes to both.
  {
    check('identity: SIM_VEL_FRAG byte-identical to pre-KCB1 baseline',
      SIM_VEL_FRAG.length === 85344 && sha256(SIM_VEL_FRAG) === 'f55fe995582251261a963657d510a8735dc7ead7395428bacb2b802219cc30a4',
      `len=${SIM_VEL_FRAG.length} sha=${sha256(SIM_VEL_FRAG).slice(0, 12)}…`);
    check('identity: empty snippet returns stock shader', buildVelocityFragment('') === SIM_VEL_FRAG);
    const plain = 'vel.y += sin(pos.x * 0.05 + uTime) * 20.0 * uDelta;';
    const builtPlain = buildVelocityFragment(plain);
    check('identity: declaration-free snippet byte-identical to pre-KCB1 builder',
      builtPlain.length === 85412 && sha256(builtPlain) === '33824939d623b01592d7b81905a89474b1bcf49d0d82cddbff525d4f449e9a98',
      `len=${builtPlain.length} sha=${sha256(builtPlain).slice(0, 12)}…`);
    const harnessPlain = buildCustomForceHarness(plain);
    check('identity: declaration-free harness byte-identical to pre-KCB1 harness',
      harnessPlain.length === 244 && sha256(harnessPlain) === '0e407c7d7257bb8280441baaa0a1a1340d242b29f72ed64d0ab898ca19dc7aa8');
  }

  // ---- shader generation with declarations ----------------------------------
  {
    const code = 'float speed = ctrl("speed", 0.0, 5.0, 1.0);\nvel.xz += vec2(speed) * uDelta;';
    const built = buildVelocityFragment(code);
    check('shader: uniform declaration injected', built.includes('  uniform float uCtrl_speed;\n'));
    check('shader: uniform injected before the stock uniforms (preamble head)',
      built.indexOf('uniform float uCtrl_speed;') > built.indexOf('precision highp float;')
      && built.indexOf('uniform float uCtrl_speed;') < built.indexOf('uniform sampler2D uPosTex;'));
    check('shader: call rewritten in the injected block', built.includes('float speed = uCtrl_speed;') && !built.includes('ctrl('));
    const harness = buildCustomForceHarness(code);
    check('harness: uniform declared and call rewritten',
      harness.includes('uniform float uCtrl_speed;') && harness.includes('float speed = uCtrl_speed;') && !harness.includes('ctrl('));
  }

  // ---- config key wiring (textual: defaults + type) --------------------------
  {
    const defaults = readFileSync(join(ROOT, 'lib/appStateDefaultGpgpu.ts'), 'utf8');
    check('config: default for the new key is the empty record (legacy behaviour)',
      defaults.includes('gpgpuCustomForceCtrlValues: {},'));
    const types = readFileSync(join(ROOT, 'types/configGpgpu.ts'), 'utf8');
    check('config: new key declared in ParticleConfigGpgpu',
      types.includes('gpgpuCustomForceCtrlValues: Record<string, number>;'));
  }
} finally {
  rmSync(BUNDLE, { force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
