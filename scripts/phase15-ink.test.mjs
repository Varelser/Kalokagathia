// Phase 15 (ink) — structural + unit checks for the three items:
//   3. reserved palette ramp in the output grade stage
//   4. world-anchored ordered dither
//   5. Motion Review findings model (small version)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-ink-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

// --- ink 3: reserved palette -----------------------------------
const grade = readFileSync(join(ROOT, 'components/outputGradePass.ts'), 'utf8');
check('grade: reserved remap present', grade.includes('mix(vec3(lo), vec3(hi), clamp(color, 0.0, 1.0))'));
check('grade: reserved runs after the brand block', grade.indexOf('if (uReservedEnabled > 0.5)') > grade.indexOf('color = luma < mid'));
const stack = readFileSync(join(ROOT, 'lib/postFxStack.ts'), 'utf8');
check('stack: reserved alone activates output-grade', stack.includes('config.postReservedPaletteEnabled'));

// --- ink 4: stable dither --------------------------------------
const tone = readFileSync(join(ROOT, 'components/toneGradePasses.ts'), 'utf8');
check('dither: anchor branch in shader', tone.includes('if (uAnchorMode > 0.5) patternPx += uAnchorOffset;'));
check('dither: origin projection in pass', tone.includes('.project(this.viewCamera)') && tone.includes('this.anchorActive = true'));
check('dither: screen anchor leaves pattern untouched', tone.includes("anchor: 'screen' | 'world' = 'screen'"));

// --- ink 5 + shared defaults via bundle -------------------------
await build({
  stdin: {
    contents: `
      export { getOrderedActivePostFxStageIds } from './lib/postFxStack.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
      export { deriveLoopFindings, recordMotionReviewFindings, getMotionReviewFindings, clearMotionReviewFindings, MOTION_REVIEW_VISIBLE_RATIO } from './lib/motionReview.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const mod = await import(pathToFileURL(BUNDLE).href);
  const base = mod.DEFAULT_CONFIG;
  check('defaults: reserved off / floor .03 / ceiling .94',
    base.postReservedPaletteEnabled === false && base.postReservedFloor === 0.03 && base.postReservedCeiling === 0.94);
  check('defaults: dither anchor is screen', base.postDitherAnchor === 'screen');
  const off = mod.getOrderedActivePostFxStageIds(base);
  check('output-grade inactive by default', !off.includes('output-grade'));
  const on = mod.getOrderedActivePostFxStageIds({ ...base, postReservedPaletteEnabled: true });
  check('output-grade active with reserved only', on.includes('output-grade'));

  const clean = mod.deriveLoopFindings({
    periodFrames: 120, periodSeconds: 2,
    seamDriftMeanAbsDiff: 0.1, seamDriftMismatchRatio: 0.001,
    seamJumpMeanAbsDiff: 0.4, seamJumpMismatchRatio: 0.01, seamMaxAbsDiff: 6,
  }, '2026-11-23T00:00:00.000Z');
  check('findings: clean loop gives 2 info findings', clean.length === 2 && clean.every((f) => f.severity === 'info'));
  const dirty = mod.deriveLoopFindings({
    periodFrames: 120, periodSeconds: 2,
    seamDriftMeanAbsDiff: 5.2, seamDriftMismatchRatio: 0.31,
    seamJumpMeanAbsDiff: 8.9, seamJumpMismatchRatio: 0.44, seamMaxAbsDiff: 210,
  }, '2026-11-23T00:01:00.000Z');
  check('findings: visible seam gives 2 warn findings', dirty.length === 2 && dirty.every((f) => f.severity === 'warn'));
  check('findings: kinds + frame ranges', dirty[0].kind === 'loop-drift' && dirty[0].frameStart === 0 && dirty[0].frameEnd === 120
    && dirty[1].kind === 'loop-pop' && dirty[1].frameStart === 119 && dirty[1].frameEnd === 0);
  mod.clearMotionReviewFindings();
  mod.recordMotionReviewFindings(clean);
  mod.recordMotionReviewFindings(dirty);
  const stored = mod.getMotionReviewFindings();
  check('store: newest first, accumulates', stored.length === 4 && stored[0].kind === 'loop-drift' && stored[0].severity === 'warn');
  mod.clearMotionReviewFindings();
  check('store: clear empties', mod.getMotionReviewFindings().length === 0);
  check('visible ratio constant is 0.02', mod.MOTION_REVIEW_VISIBLE_RATIO === 0.02);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
