// Phase 15 (Abyssal B + C) — unit + structural checks:
//   B: the ladder machine — clean boot stays at 0, a crashed boot
//      advances one step per crash up to 3, survival clears the
//      flag, reset returns to 0; the app wiring consults the
//      ladder for DPR / post stages / CPU fallback.
//   C: bench stats (avg / p99 / max) and the critic pack shape.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.p15-abyssal-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await build({
  stdin: {
    contents: `
      export { SafeMode, SAFE_MODE_LADDER, SAFE_MODE_HEAVY_POST_STAGES } from './lib/safeMode.ts';
      export { Bench, buildCriticPack, CRITIC_DEFAULT_CHECKS } from './lib/benchPack.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const { SafeMode, SAFE_MODE_LADDER, SAFE_MODE_HEAVY_POST_STAGES, Bench, buildCriticPack, CRITIC_DEFAULT_CHECKS } = await import(pathToFileURL(BUNDLE).href);
  const mem = () => { const m = new Map(); return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)) }; };

  const s1 = mem();
  const boot1 = new SafeMode(s1);
  check('B: clean boot stays level 0', boot1.beginLoad().level === 0 && boot1.crashedLastTime === false);
  boot1.markSurvived();
  const boot2 = new SafeMode(s1);
  check('B: survived session does not advance', boot2.beginLoad().level === 0 && boot2.crashedLastTime === false);
  // boot2 never survives -> next boot is a crash
  const boot3 = new SafeMode(s1);
  check('B: crashed boot advances to 1 (pix-cap)', boot3.beginLoad().level === 1 && boot3.crashedLastTime === true);
  const boot4 = new SafeMode(s1);
  check('B: second crash advances to 2 (post-off)', boot4.beginLoad().level === 2 && SAFE_MODE_LADDER[2].post === 'reduced');
  const boot5 = new SafeMode(s1);
  const boot6 = new SafeMode(s1);
  boot5.beginLoad();
  check('B: ladder caps at 3 (fallback)', boot6.beginLoad().level === 3 && SAFE_MODE_LADDER[3].fallback === true);
  boot6.reset();
  const boot7 = new SafeMode(s1);
  check('B: reset returns to 0 with no crash flag', boot7.beginLoad().level === 0 && boot7.crashedLastTime === false);
  check('B: heavy stage list covers bloom/feedback/dof', SAFE_MODE_HEAVY_POST_STAGES.has('bloom') && SAFE_MODE_HEAVY_POST_STAGES.has('feedback') && SAFE_MODE_HEAVY_POST_STAGES.has('depth-of-field'));
  check('B: heavy stage list keeps output-grade/chroma-key', !SAFE_MODE_HEAVY_POST_STAGES.has('output-grade') && !SAFE_MODE_HEAVY_POST_STAGES.has('chroma-key'));

  const bench = new Bench(8);
  check('C: empty bench reports null', bench.report('x').frame === null);
  for (const v of [10, 20, 30, 40]) bench.push(v);
  const rep = bench.report('tour');
  check('C: stats avg/p99/max', rep.frame.n === 4 && rep.frame.avg === 25 && rep.frame.max === 40 && rep.frame.p99 === 40, JSON.stringify(rep.frame));
  bench.reset();
  check('C: reset empties', bench.report().frame === null);

  const pack = buildCriticPack('gate-tour', [{ id: 'p1', preset: 'starter-a' }, { id: 'p2', holdFrames: 60 }]);
  check('C: pack rule hides code from the critic', pack.rule.includes('ONLY the renders'));
  check('C: pack poses indexed with defaults', pack.poses[0].index === 1 && pack.poses[0].holdFrames === 30 && pack.poses[1].holdFrames === 60);
  check('C: pack checks default + pass rule', pack.checks.length === CRITIC_DEFAULT_CHECKS.length && pack.passWhen === 'nothing above minor' && pack.benchReportAttached === true);
} finally {
  try { unlinkSync(BUNDLE); } catch { /* gone */ }
}

const root = readFileSync(join(ROOT, 'components/AppRootLayout.tsx'), 'utf8');
check('B wiring: root boots the ladder', root.includes('bootSafeMode()'));
check('B wiring: level 3 forces the CPU fallback', root.includes('safeMode.step.fallback'));
check('B wiring: banner offers a way back', root.includes('通常モードに戻す'));
const scene = readFileSync(join(ROOT, 'components/AppScene.tsx'), 'utf8');
check('B wiring: DPR range scaled by pixCap', scene.includes('safeMode.step.pixCap'));
check('C wiring: bench probe is diag-gated', scene.includes("get('diag') === '1'") && scene.includes('pushBenchFrame(delta * 1000)'));
const postfx = readFileSync(join(ROOT, 'components/AppScenePostFx.tsx'), 'utf8');
check('B wiring: post stages filtered when reduced', postfx.includes('SAFE_MODE_HEAVY_POST_STAGES.has(stage)'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
