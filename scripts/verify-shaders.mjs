// Shader compile audit (added 2026-11-08).
//
// Drives the real app in headless Chromium and counts EVERY WebGL shader
// compile and program link, while exercising the surfaces that build
// shader programs: the GPGPU simulation (incl. SPH and fluid advection),
// the full post-processing chain, and a strided tour of the preset shelf
// (which mounts the per-family scene systems). Any compile or link failure
// fails the audit — this is the check that caught the vnoise missing-
// argument bug and the undeclared uniforms in the deposition and
// reaction-diffusion shaders, all of which failed on every GLSL compiler
// while the app appeared to "run".
//
// Prerequisites: the app must already be running (APP_URL, default
// http://127.0.0.1:3000/), and a Playwright Chromium must be available
// (`npx playwright install chromium` once). CHROMIUM_PATH can point at a
// specific Chromium executable. Under software GL the tour takes a few
// minutes; TOUR_SETTLE_MS / TOUR_LIMIT / TOUR_STRIDE tune the coverage.
//
// Extended coverage (opt-in):
// - TOUR_ALL=1 tours EVERY shelf preset instead of the strided sample.
// - SWEEP_TYPES=1 additionally sweeps every motion type (197) and every
//   source type (16) on Layer 2 through the Node Graph selects, so types
//   no preset uses are compile-checked too. Failures are attributed to
//   the preset or type that introduced them.
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';
const SETTLE_MS = Number(process.env.TOUR_SETTLE_MS || 2000);
const TOUR_ALL = process.env.TOUR_ALL === '1';
const TOUR_STRIDE = TOUR_ALL ? 1 : Number(process.env.TOUR_STRIDE || 12);
const TOUR_LIMIT = TOUR_ALL ? Number.MAX_SAFE_INTEGER : Number(process.env.TOUR_LIMIT || 34);
const SWEEP_TYPES = process.env.SWEEP_TYPES === '1';
const SWEEP_SETTLE_MS = Number(process.env.SWEEP_SETTLE_MS || 1500);
// Resume an interrupted sweep: skip the first N motion types (their
// results must already be known — the log prints progress every 50).
const SWEEP_START = Number(process.env.SWEEP_START || 0);
// Same idea for the preset tour: skip the first N tour picks.
const TOUR_START = Number(process.env.TOUR_START || 0);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const auditInitScript = () => {
  const audit = { compiles: 0, links: 0, fails: [] };
  window.__shaderAudit = audit;
  const sources = new Map();
  for (const Ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctor) continue;
    const proto = Ctor.prototype;
    if (proto.__auditPatched) continue;
    proto.__auditPatched = true;
    const origSource = proto.shaderSource;
    proto.shaderSource = function (shader, src) {
      sources.set(shader, String(src));
      return origSource.call(this, shader, src);
    };
    const origCompile = proto.compileShader;
    proto.compileShader = function (shader) {
      const r = origCompile.call(this, shader);
      if (this.getShaderParameter(shader, this.COMPILE_STATUS)) {
        audit.compiles += 1;
      } else {
        audit.fails.push({
          kind: 'compile',
          log: (this.getShaderInfoLog(shader) || '').slice(0, 300),
          srcHead: (sources.get(shader) || '').replace(/\s+/g, ' ').slice(0, 240),
        });
      }
      return r;
    };
    const origLink = proto.linkProgram;
    proto.linkProgram = function (program) {
      const r = origLink.call(this, program);
      if (this.getProgramParameter(program, this.LINK_STATUS)) {
        audit.links += 1;
      } else {
        audit.fails.push({ kind: 'link', log: (this.getProgramInfoLog(program) || '').slice(0, 300), srcHead: '' });
      }
      return r;
    };
  }
};

const toggleOn = (page, label) => page.evaluate((lbl) => {
  const el = [...document.querySelectorAll('label, div, span')].find((e) => e.children.length === 0 && e.textContent.trim() === lbl)
    ?? [...document.querySelectorAll('label, div, span')].find((e) => e.textContent.trim() === lbl);
  if (!el) return `label not found: ${lbl}`;
  let node = el;
  for (let i = 0; i < 7 && node; i += 1) {
    node = node.parentElement;
    const btns = node ? [...node.querySelectorAll('button')] : [];
    const onBtn = btns.find((b) => b.textContent.trim() === 'On');
    const offBtn = btns.find((b) => b.textContent.trim() === 'Off');
    if (onBtn && offBtn) {
      const isOn = onBtn.className.includes('bg-white') && !onBtn.className.includes('bg-white/10');
      if (!isOn) onBtn.click();
      return `on: ${lbl}`;
    }
  }
  return `toggle not found: ${lbl}`;
}, label);

const main = async () => {
  const launchOptions = { headless: true, args: ['--use-gl=swiftshader'] };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const consoleErrors = [];
  const resourceFailures = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('response', (r) => { if (r.status() >= 400) resourceFailures.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => resourceFailures.push(`failed ${r.url()}`));
  await page.addInitScript(auditInitScript);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'Main', exact: true }).first().waitFor({ timeout: 60000 });
  await wait(4000);
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Main')?.click(); });
  await wait(1200);

  const toggles = [
    'GPGPU Enabled', 'SPH Fluid', 'Fluid Advection',
    'Bloom', 'Chromatic Aberration', 'Depth of Field', 'Noise', 'Vignette',
    'Brightness / Contrast', 'Feedback (GPU)', 'Kaleidoscope / Mirror', 'Slit Scan (temporal bands)',
  ];
  for (const label of toggles) {
    const status = await toggleOn(page, label);
    if (!status.startsWith('on:')) {
      throw new Error(`audit surface shrank: ${status}`);
    }
    await wait(500);
  }
  // Brightness/Contrast only compiles its stage at a nonzero value.
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('label, div, span')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Brightness');
    let node = el;
    for (let i = 0; i < 6 && node; i += 1) {
      node = node.parentElement;
      const input = node?.querySelector('input[type="range"]');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
        setter.call(input, '0.25');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
  });
  await wait(2500);

  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Play')?.click(); });
  await wait(1500);
  const names = await page.evaluate(() => [...new Set(
    [...document.querySelectorAll('button')]
      .map((b) => b.textContent.replace(/\s+/g, ' ').trim())
      .filter((t) => t.length > 24),
  )]);
  const picks = names.filter((_, i) => i % TOUR_STRIDE === 0).slice(0, TOUR_LIMIT);
  console.log(`verify:shaders — ${picks.length} presets on tour (of ${names.length} tiles), GPGPU + full post chain enabled`);
  const failsBefore = async () => page.evaluate(() => window.__shaderAudit.fails.length);
  let toured = TOUR_START;
  for (const name of picks.slice(TOUR_START)) {
    const before = await failsBefore();
    const consoleBefore = consoleErrors.length;
    await page.evaluate((n) => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === n)?.click();
    }, name);
    await wait(SETTLE_MS);
    const after = await failsBefore();
    if (after > before) console.log(`tour: +${after - before} shader failure(s) at preset "${name.slice(0, 60)}"`);
    if (consoleErrors.length > consoleBefore) {
      console.log(`tour: +${consoleErrors.length - consoleBefore} console error(s) at preset "${name.slice(0, 60)}"`);
      console.log(`  first: ${consoleErrors[consoleBefore].replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    toured += 1;
    if (toured % 25 === 0) console.log(`tour: ${toured}/${picks.length} presets`);
  }

  if (SWEEP_TYPES) {
    // Sweep every motion type and source type on Layer 2 via the Node
    // Graph selects: the selects enumerate the engine's own unions, so
    // the sweep can never drift from the type list.
    const sweepPlan = await page.evaluate(() => {
      const selects = [...document.querySelectorAll('select')].map((s) => ({
        el: s,
        values: [...s.options].map((o) => o.value).filter(Boolean),
      }));
      const motion = selects.find((s) => s.values.includes('rossler') && s.values.includes('clifford'));
      const source = selects.find(
        (s) => s !== motion && s.values.includes('sphere') && s.values.includes('center') && s.values.length >= 8 && s.values.length <= 24,
      );
      window.__sweepSelects = { motion: motion?.el ?? null, source: source?.el ?? null };
      return {
        motion: motion ? motion.values : null,
        source: source ? source.values : null,
      };
    });
    if (!sweepPlan.motion || !sweepPlan.source) {
      throw new Error('audit surface shrank: node graph selects not found for type sweep');
    }
    const sweepOne = async (which, value) => {
      const before = await failsBefore();
      await page.evaluate(([w, v]) => {
        const el = window.__sweepSelects[w];
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, [which, value]);
      await wait(SWEEP_SETTLE_MS);
      const after = await failsBefore();
      if (after > before) console.log(`sweep: +${after - before} shader failure(s) at ${which} type "${value}"`);
    };
    console.log(`verify:shaders — sweeping ${sweepPlan.motion.length} motion types and ${sweepPlan.source.length} source types on Layer 2`);
    let done = SWEEP_START;
    for (const value of sweepPlan.motion.slice(SWEEP_START)) {
      await sweepOne('motion', value);
      done += 1;
      if (done % 25 === 0) console.log(`sweep: ${done}/${sweepPlan.motion.length} motion types`);
    }
    for (const value of sweepPlan.source) {
      await sweepOne('source', value);
    }
    console.log('verify:shaders — type sweep complete');
  }

  const audit = await page.evaluate(() => window.__shaderAudit);
  await browser.close();

  // A resource-load console error (e.g. a stray 404) is reported as a
  // warning with its URL: it must stay visible, but it is not a shader
  // verdict. Shader compile/link failures and real console/page errors
  // remain hard failures.
  const hardConsoleErrors = consoleErrors.filter((e) => !e.startsWith('Failed to load resource'));
  console.log(`compiles ok: ${audit.compiles} | links ok: ${audit.links} | failures: ${audit.fails.length} | console errors: ${hardConsoleErrors.length} | resource warnings: ${resourceFailures.length}`);
  resourceFailures.forEach((w) => console.log('resource warning:', w));
  if (audit.fails.length > 0 || hardConsoleErrors.length > 0) {
    const seen = new Set();
    for (const fail of audit.fails) {
      const key = `${fail.kind}|${fail.log.slice(0, 100)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`--- ${fail.kind} failure ---`);
      console.log('log:', fail.log.replace(/\s+/g, ' '));
      if (fail.srcHead) console.log('src:', fail.srcHead);
    }
    hardConsoleErrors.slice(0, 5).forEach((e) => console.log('console error:', e.replace(/\s+/g, ' ').slice(0, 200)));
    console.log('verify:shaders — FAIL');
    process.exit(1);
  }
  console.log('verify:shaders — PASS');
};

main().catch((error) => {
  console.error('verify:shaders — ERROR', error);
  process.exit(1);
});
