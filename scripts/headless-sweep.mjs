// Headless sweep + assert (ink verification base (2); spec:
// kalokagathia-pro/HEADLESS_SWEEP_SPEC.md; case set and assert rules per the
// Round 37 agreement, ledger memo #72, crosschecked by #9).
//
// For each case (preset id), the preset config is loaded into the app via
// the #c= hash route (the same route the visual gates use), a deterministic
// render is exported as a PNG sequence ZIP, and the frames at the case's
// capture times are classified with the verify:thumbs classifier.
//   - abnormal class at the LAST capture time  -> FAIL
//   - REVIEW_BIMODAL at the last time          -> WARN
//   - abnormal only at an earlier time         -> WARN (slow starter)
//   - otherwise                                -> PASS
// Case-side overrides: allowClasses (list), bounds {white_ratio_max,
// black_ratio_max, lit_ratio_min} applied to the last-time channels.
// exit code: 1 when any case FAILs or errors, else 0 (warnings stay 0).
//
// Modes:
//   (default)        capture + classify in one run
//   --capture-only   capture frames + capture.json only (for the iMac
//                    real-GPU flight, where the classifier's skia-canvas
//                    may be unavailable; classify afterwards on the VM)
//   --classify-only <dir>  classify a capture dir and write run-record.json
//
// VM headless captures are PRE-CHECKS only: on software GL the
// deterministic export readback can come back empty (observed 2026-11-22:
// RGBA all zero on SwiftShader while the live view renders). The verdict
// run is the iMac real-GPU dedicated flight (--chrome <Chrome> --metal).
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { chromium } = await import('playwright').catch(() => import('playwright-core'));

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const has = (name) => args.includes(name);

const casesFile = path.resolve(opt('--cases', path.join(here, 'headless-sweep-cases.json')));
const presetsDir = path.resolve(opt('--presets-dir', path.join(here, '..', '..', 'site', 'presets')));
const appUrl = opt('--app-url', process.env.APP_URL || 'http://127.0.0.1:3000/');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(opt('--out', path.join(here, '..', 'sweep-runs', stamp)));
const fps = Number(opt('--fps', '24'));
const seconds = Number(opt('--seconds', '8'));
const settleMs = Number(opt('--settle', '5000'));
const caseTimeoutMs = Number(opt('--timeout', '420000'));
const chromePath = opt('--chrome', '');
const useMetal = has('--metal');
const keepZip = has('--keep-zip');
const captureOnly = has('--capture-only');
const classifyOnlyDir = opt('--classify-only', '');
const pauseMs = Number(opt('--pause-ms', '0'));
const recycleEvery = Number(opt('--recycle-every', '0'));
const slowAbortSec = Number(opt('--slow-abort-sec', '0'));
const limit = Number(opt('--limit', '0'));
const only = opt('--only', '').split(',').map((s) => s.trim()).filter(Boolean);

let classifier = null;
async function getClassifier() {
  if (!classifier) classifier = await import('./verify-thumbs.mjs');
  return classifier;
}

function verdictFor(kase, classes, channels) {
  const { ABNORMAL } = { ABNORMAL: new Set(['BLACK_EMPTY', 'DARK_SPARSE', 'WHITEOUT', 'WHITE_HEAVY']) };
  const times = Object.keys(classes).map(Number).sort((a, b) => a - b);
  const lastT = times[times.length - 1];
  const lastCls = classes[lastT];
  const lastCh = channels[lastT];
  const allowed = new Set(kase.allowClasses || []);
  let status = 'pass';
  let reason = '';
  if (ABNORMAL.has(lastCls) && !allowed.has(lastCls)) {
    status = 'fail';
    reason = `abnormal at ${lastT}s: ${lastCls}`;
  }
  if (status === 'pass' && kase.bounds) {
    const b = kase.bounds;
    if (b.white_ratio_max !== undefined && lastCh.white_ratio > b.white_ratio_max) {
      status = 'fail';
      reason = `white_ratio ${lastCh.white_ratio} > ${b.white_ratio_max}`;
    } else if (b.black_ratio_max !== undefined && lastCh.black_ratio > b.black_ratio_max) {
      status = 'fail';
      reason = `black_ratio ${lastCh.black_ratio} > ${b.black_ratio_max}`;
    } else if (b.lit_ratio_min !== undefined && lastCh.lit_ratio < b.lit_ratio_min) {
      status = 'fail';
      reason = `lit_ratio ${lastCh.lit_ratio} < ${b.lit_ratio_min}`;
    }
  }
  if (status === 'pass') {
    if (lastCls === 'REVIEW_BIMODAL') {
      status = 'warn';
      reason = `REVIEW_BIMODAL at ${lastT}s`;
    } else {
      const early = times.slice(0, -1).find((t) => ABNORMAL.has(classes[t]));
      if (early !== undefined) {
        status = 'warn';
        reason = `abnormal only at ${early}s (${classes[early]}), normal at ${lastT}s`;
      }
    }
  }
  return { status, reason };
}

async function classifyCapture(dir) {
  const cap = JSON.parse(fs.readFileSync(path.join(dir, 'capture.json'), 'utf8'));
  const { channelsFromFile, classifyThumbChannels } = await getClassifier();
  const caseById = new Map((cap.casesMeta || []).map((c) => [c.id, c]));
  const results = [];
  for (const entry of cap.captures) {
    if (entry.error) {
      results.push({ id: entry.id, kind: entry.kind ?? null, baseline: entry.baseline ?? null, status: 'error', error: entry.error, elapsedMs: entry.elapsedMs });
      continue;
    }
    const classes = {};
    const channels = {};
    for (const [t, rel] of Object.entries(entry.frames)) {
      const ch = await channelsFromFile(path.join(dir, rel));
      channels[t] = ch;
      classes[t] = classifyThumbChannels(ch);
    }
    const kase = caseById.get(entry.id) || entry;
    const { status, reason } = verdictFor(kase, classes, channels);
    results.push({
      id: entry.id,
      kind: entry.kind ?? null,
      baseline: entry.baseline ?? null,
      status,
      reason,
      classes,
      channels,
      manifest: entry.manifest ?? null,
      elapsedMs: entry.elapsedMs,
    });
  }
  const summary = { total: results.length, pass: 0, warn: 0, fail: 0, error: 0, byClassLast: {} };
  for (const r of results) {
    summary[r.status] += 1;
    if (r.classes) {
      const ts = Object.keys(r.classes);
      const last = r.classes[ts[ts.length - 1]];
      summary.byClassLast[last] = (summary.byClassLast[last] || 0) + 1;
    }
  }
  const record = {
    tool: 'headless-sweep',
    version: 1,
    note: 'Verdicts are valid only for real-GPU captures (iMac dedicated flight). VM software-GL captures can be empty and must not be judged.',
    capture: { appUrl: cap.appUrl, env: cap.env, params: cap.params, casesFile: cap.casesFile, startedAt: cap.startedAt, finishedAt: cap.finishedAt, pageErrors: cap.pageErrors || [] },
    classifiedAt: new Date().toISOString(),
    summary,
    results,
  };
  fs.writeFileSync(path.join(dir, 'run-record.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('--- headless-sweep summary ---');
  console.log(JSON.stringify(summary));
  for (const st of ['fail', 'error', 'warn']) {
    const ids = results.filter((r) => r.status === st).map((r) => r.id);
    if (ids.length) console.log(`${st}: ${ids.join(', ')}`);
  }
  console.log('run record:', path.join(dir, 'run-record.json'));
  return summary.fail + summary.error > 0 ? 1 : 0;
}

if (classifyOnlyDir) {
  process.exit(await classifyCapture(path.resolve(classifyOnlyDir)));
}

// ---- capture phase ----
const casesDoc = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
let cases = casesDoc.cases;
if (only.length) cases = cases.filter((c) => only.includes(c.id));
if (limit > 0) cases = cases.slice(0, limit);
const casesHash = crypto.createHash('sha256').update(fs.readFileSync(casesFile)).digest('hex');

fs.mkdirSync(path.join(outDir, 'frames'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'dl'), { recursive: true });

const configHash = (name, config) =>
  zlib.deflateRawSync(Buffer.from(JSON.stringify({ name, config }), 'utf8')).toString('base64url');

const launchOpts = { headless: true, args: ['--mute-audio'] };
if (chromePath) launchOpts.executablePath = chromePath;
if (useMetal) launchOpts.args.push('--use-angle=metal');
let browser = null;
let context = null;
let page = null;
const pageErrors = [];
async function launchBrowser() {
  browser = await chromium.launch(launchOpts);
  context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
}
await launchBrowser();

async function loadApp(cfg, name) {
  await page.goto('about:blank');
  await page.goto(appUrl + '?cpu=0#c=' + configHash(name, cfg), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 45000 });
  await page
    .waitForFunction(() => document.body.innerHTML.includes('Deterministic Render'), { timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(settleMs);
}

async function captureCase(kase) {
  const started = Date.now();
  const preset = JSON.parse(fs.readFileSync(path.join(presetsDir, kase.id + '.json'), 'utf8'));
  await loadApp(preset.config, preset.name);
  const downloads = [];
  const saves = [];
  const onDownload = (d) => {
    const p = path.join(outDir, 'dl', `${kase.id}-part${downloads.length + 1}.zip`);
    downloads.push(p);
    saves.push(d.saveAs(p).catch(() => {}));
  };
  page.on('download', onDownload);
  try {
    // The render panel can take a while to appear (and a reused page may
    // still be booting), so the start evaluate is retried for up to 60s
    // while it reports 'no-box'.
    let startedExport = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      startedExport = await page.evaluate(
      ({ secondsVal, fpsVal }) => {
        const boxes = Array.from(document.querySelectorAll('div')).filter((d) =>
          (d.textContent || '').includes('Deterministic Render · 決定的レンダリング'),
        );
        boxes.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        const box = boxes[0];
        if (!box) return 'no-box';
        const slider = box.querySelector('input[type="range"]');
        if (slider) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(slider, String(secondsVal));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const fpsBtn = Array.from(box.querySelectorAll('button')).find(
          (b) => (b.textContent || '').trim() === String(fpsVal),
        );
        if (fpsBtn) fpsBtn.click();
        const zipBtn = Array.from(box.querySelectorAll('button')).find(
          (b) => (b.textContent || '').trim() === 'PNG連番 ZIP',
        );
        if (zipBtn) zipBtn.click();
        const btn = Array.from(box.querySelectorAll('button')).find((b) =>
          (b.textContent || '').trim().startsWith('PNG連番を書き出す'),
        );
        if (!btn) return 'no-btn';
        if (btn.disabled) return 'btn-disabled';
        btn.click();
        return true;
      },
        { secondsVal: seconds, fpsVal: fps },
      );
      if (startedExport === true) break;
      if (startedExport !== 'no-box') break;
      await page.waitForTimeout(3000);
    }
    if (startedExport !== true) throw new Error(`render start unavailable: ${startedExport}`);
    let lastStatus = '';
    // Progress-aware wait: a heavy case may legitimately take many minutes,
    // so the wait only fails when the rendered-frame counter stops advancing
    // for stallMs, or the overall caseTimeoutMs cap is reached.
    const stallMs = 150000;
    let lastCount = -1;
    let lastAdvance = Date.now();
    let stalled = false;
    while (downloads.length < 1 && Date.now() - started < caseTimeoutMs) {
      await page.waitForTimeout(3000);
      lastStatus = await page
        .evaluate(() => {
          const boxes = Array.from(document.querySelectorAll('div')).filter((d) =>
            (d.textContent || '').includes('Deterministic Render · 決定的レンダリング'),
          );
          boxes.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
          const box = boxes[0];
          if (!box) return '';
          const m = (box.textContent || '').match(/レンダリング中… \d+ \/ \d+ フレーム|書き出しました|失敗しました/);
          return m ? m[0] : '';
        })
        .catch(() => '');
      if (typeof lastStatus === 'string' && lastStatus.includes('失敗しました')) break;
      const cm = typeof lastStatus === 'string' ? lastStatus.match(/(\d+) \/ (\d+) フレーム/) : null;
      if (cm) {
        const n = Number(cm[1]);
        if (n > lastCount) {
          lastCount = n;
          lastAdvance = Date.now();
        }
        // Once every frame is rendered the app still needs minutes to
        // encode 192 PNGs and build the ZIP (the status text does not
        // change during that phase), so the stall check no longer
        // applies — only the overall caseTimeoutMs cap does.
        if (n >= Number(cm[2])) lastAdvance = Date.now();
      }
      if (Date.now() - lastAdvance > stallMs) {
        stalled = true;
        break;
      }
    }
    await Promise.all(saves);
    if (!downloads.length) {
      if (stalled) throw new Error(`render stalled (no frame progress for ${Math.round(stallMs / 1000)}s; status: ${lastStatus || 'none'})`);
      throw new Error(`no download (status: ${lastStatus || 'none'})`);
    }
  } finally {
    page.off('download', onDownload);
  }
  const zipPath = downloads[0];
  const xdir = zipPath.replace(/\.zip$/, '-x');
  fs.rmSync(xdir, { recursive: true, force: true });
  fs.mkdirSync(xdir, { recursive: true });
  execSync(`python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" ${JSON.stringify(zipPath)} ${JSON.stringify(xdir)}`);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(xdir, 'render.json'), 'utf8'));
  } catch {}
  const frameNames = fs.readdirSync(xdir).filter((n) => n.endsWith('.png')).sort();
  const mFps = manifest?.fps ?? fps;
  const warmup = manifest?.warmupFrames ?? 30;
  const times = kase.times?.length ? kase.times : [2, 8];
  const frames = {};
  for (const t of times) {
    const idx = Math.round(t * mFps) - warmup - 1;
    if (idx < 0 || idx >= frameNames.length) {
      throw new Error(`frame index ${idx} out of range for t=${t}s (frames=${frameNames.length}, fps=${mFps}, warmup=${warmup})`);
    }
    const rel = path.join('frames', `${kase.id}-t${t}.png`);
    fs.copyFileSync(path.join(xdir, frameNames[idx]), path.join(outDir, rel));
    frames[t] = rel;
  }
  fs.rmSync(xdir, { recursive: true, force: true });
  if (!keepZip) fs.rmSync(zipPath, { force: true });
  return {
    id: kase.id,
    kind: kase.kind ?? null,
    baseline: kase.baseline ?? null,
    allowClasses: kase.allowClasses ?? undefined,
    bounds: kase.bounds ?? undefined,
    frames,
    manifest: manifest ? { fps: mFps, frames: manifest.frames ?? frameNames.length, warmupFrames: warmup } : null,
    elapsedMs: Date.now() - started,
  };
}

const captures = [];
const runStarted = Date.now();
function writeCaptureDoc(finishedAt) {
  const doc = {
    tool: 'headless-sweep-capture',
    version: 1,
    startedAt: new Date(runStarted).toISOString(),
    finishedAt: finishedAt ? new Date().toISOString() : null,
    durationMs: Date.now() - runStarted,
    appUrl,
    env: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      chrome: chromePath || 'playwright-chromium',
      metal: useMetal,
      viewport: { width: 1440, height: 960 },
    },
    params: { fps, seconds, settleMs, caseTimeoutMs, pauseMs, recycleEvery, slowAbortSec },
    casesFile: { path: casesFile, sha256: casesHash, counts: casesDoc.counts ?? null },
    casesMeta: cases,
    pageErrors: pageErrors.slice(0, 20),
    captures,
  };
  fs.writeFileSync(path.join(outDir, 'capture.json'), JSON.stringify(doc, null, 2) + '\n');
}
// Resume: cases whose frames already exist in the out dir are pre-registered.
const resumedIds = new Set();
for (const kase of cases) {
  const times = kase.times?.length ? kase.times : [2, 8];
  const frames = {};
  let allExist = true;
  for (const t of times) {
    const rel = path.join('frames', `${kase.id}-t${t}.png`);
    if (fs.existsSync(path.join(outDir, rel))) frames[t] = rel;
    else allExist = false;
  }
  if (allExist) {
    resumedIds.add(kase.id);
    captures.push({
      id: kase.id,
      kind: kase.kind ?? null,
      baseline: kase.baseline ?? null,
      allowClasses: kase.allowClasses ?? undefined,
      bounds: kase.bounds ?? undefined,
      frames,
      manifest: { fps, frames: Math.round(seconds * fps), warmupFrames: 30 },
      elapsedMs: 0,
      resumed: true,
    });
  }
}
if (resumedIds.size) console.log(`resume: ${resumedIds.size} cases already captured, skipping`);
let doneCount = 0;
let consecutiveErrors = 0;
for (const kase of cases) {
  if (resumedIds.has(kase.id)) continue;
  const t0 = Date.now();
  try {
    // Hard per-case watchdog: a wedged renderer can leave Playwright calls
    // pending forever, so race the case against a timer; on timeout the
    // browser is force-closed (which unblocks the pending calls) and the
    // case is recorded as an error.
    const watchdogMs = 25 * 60 * 1000;
    let watchdogTimer = null;
    const c = await Promise.race([
      captureCase(kase),
      new Promise((_, reject) => {
        watchdogTimer = setTimeout(() => {
          browser.close().catch(() => {});
          reject(new Error(`case watchdog timeout (${Math.round(watchdogMs / 60000)} min)`));
        }, watchdogMs);
      }),
    ]).finally(() => clearTimeout(watchdogTimer));
    captures.push(c);
    console.log(`[${captures.length}/${cases.length}] ${kase.id}: captured (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (err) {
    captures.push({ id: kase.id, kind: kase.kind ?? null, baseline: kase.baseline ?? null, error: String(err).slice(0, 300), elapsedMs: Date.now() - t0 });
    console.log(`[${captures.length}/${cases.length}] ${kase.id}: ERROR ${String(err).slice(0, 160)}`);
    if (!browser.isConnected()) {
      await launchBrowser().catch(() => {});
    }
  }
  doneCount += 1;
  writeCaptureDoc(false);
  const lastCap = captures[captures.length - 1];
  if (lastCap && 'error' in lastCap) consecutiveErrors += 1;
  else consecutiveErrors = 0;
  if (slowAbortSec > 0 && consecutiveErrors >= 3) {
    console.log('ABORT: 3 consecutive case errors — machinery may be broken; stopping the flight here. Re-run to resume.');
    writeCaptureDoc(true);
    await browser.close();
    process.exit(2);
  }
  if (recycleEvery > 0 && doneCount % recycleEvery === 0) {
    await browser.close();
    await launchBrowser();
  }
  if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
}
await browser.close();

writeCaptureDoc(true);
console.log('capture record:', path.join(outDir, 'capture.json'));
const captureErrors = captures.filter((c) => c.error).length;
console.log(`captured ${captures.length - captureErrors}/${captures.length} cases (${captureErrors} errors)`);
if (captureOnly) process.exit(captureErrors > 0 ? 1 : 0);
process.exit(await classifyCapture(outDir));
