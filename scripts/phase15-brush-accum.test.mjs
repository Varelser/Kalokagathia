// Phase 15 (2D section 6) brush accumulation — structural checks:
//   - stage id in the union, present in all 5 profiles immediately
//     after 'feedback', gated on the enable key in the stack
//   - the pass isolates the brush mesh via layer 1, accumulates
//     with max(lines, prev * decay) into a ping-pong pair, and
//     max-blends over the frame (no double-draw of the live stroke)
//   - the brush mesh enables layer 1 and carries the lookup name
//   - defaults keep the stage absent (bit-identical output)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, '.p15-brush-bundle.mjs');
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const out = await build({
  stdin: {
    contents: `
      export { getOrderedActivePostFxStageIds } from './lib/postFxStack.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
writeFileSync(BUNDLE, out.outputFiles[0].text);
try {
  const mod = await import(BUNDLE);
  const base = mod.DEFAULT_CONFIG;
  const profiles = ['manual', 'touch-feedback', 'particular-glow', 'retro-feedback', 'dream-smear'];
  for (const p of profiles) {
    const off = mod.getOrderedActivePostFxStageIds({ ...base, postFxStackProfile: p });
    check(`${p}: stage absent by default`, !off.includes('brush-accum'));
    const on = mod.getOrderedActivePostFxStageIds({ ...base, postFxStackProfile: p, layer1BrushAccumEnabled: true });
    const fi = on.indexOf('feedback');
    check(`${p}: stage immediately after feedback when on`, on[fi + 1] === 'brush-accum', on.join(','));
  }
  check('defaults: disabled / decay 0.92 / strength 1',
    base.layer1BrushAccumEnabled === false && base.layer1BrushAccumDecay === 0.92 && base.layer1BrushAccumStrength === 1);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

const pass = readFileSync(join(ROOT, 'components/brushAccumPass.ts'), 'utf8');
check('pass isolates via camera layer mask', pass.includes('layers.mask = 1 << BRUSH_ACCUM_LAYER'));
check('pass restores camera mask + background', pass.includes('layers.mask = prevMask') && pass.includes('background = prevBackground'));
check('accumulation is max(lines, decayed history)', pass.includes('max(lines, prev)'));
check('blend is max(frame, accum) — no double-draw', pass.includes('max(current, acc)'));
check('ping-pong swap present', pass.includes('this.readTarget = this.writeTarget'));
const lineRender = readFileSync(join(ROOT, 'components/sceneLineSystemRender.tsx'), 'utf8');
check('brush mesh named for lookup', lineRender.includes('name={BRUSH_ACCUM_OBJECT_NAME}'));
check('brush mesh enables layer 1', lineRender.includes('node.layers.enable(BRUSH_ACCUM_LAYER)'));
const stack = readFileSync(join(ROOT, 'lib/postFxStack.ts'), 'utf8');
check('stack gates the stage on the enable key', stack.includes("if (config.layer1BrushAccumEnabled)"));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
