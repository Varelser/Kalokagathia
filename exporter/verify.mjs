#!/usr/bin/env node
/**
 * KCB2 verification:
 *  1. Determinism: run the CLI twice per sample, compare SHA-256 of HTML + manifest.
 *  2. Seed reproduction: decode the generated HTML's embedded particle data and
 *     compare positions/ages against the app's real lib/gpgpuInitialData.ts
 *     (executed via Node type stripping from a /tmp copy) for the first 256 particles.
 *  3. Headless render: open each sample in Chromium headless shell (Playwright),
 *     require zero console errors / page errors and a non-trivial count of
 *     non-background pixels read back from the WebGL canvas.
 * Usage: node verify.mjs [--skip-browser]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRESETS = join(homedir(), 'workspace/monosphere-audit/site/presets');
const SAMPLES = [
  'starter-gpgpu-gradient-blackbody',
  'starter-gpgpu-morph-galaxy',
  'starter-kinetix-houdini-flip-mercury',
];
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
};

/* 1. determinism */
for (const id of SAMPLES) {
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    const dir = mkdtempSync(join(tmpdir(), 'kcb2-det-'));
    execFileSync('node', [join(HERE, 'kcb2-export.mjs'), '--preset', join(PRESETS, id + '.json'), '--out', dir], { stdio: 'pipe' });
    hashes.push(sha(readFileSync(join(dir, id + '.html'))) + '/' + sha(readFileSync(join(dir, id + '.manifest.json'))));
  }
  check('determinism ' + id, hashes[0] === hashes[1], hashes[0].slice(0, 16));
}

/* 2. seed reproduction vs the real TS module */
const tsMod = await import('/tmp/kcb2-tscheck/gpgpuInitialData.ts');
for (const id of SAMPLES) {
  const rec = JSON.parse(readFileSync(join(PRESETS, id + '.json'), 'utf8'));
  const cfg = rec.config;
  const html = readFileSync(join(HERE, 'samples', id, id + '.html'), 'utf8');
  const m = /"data":\s*"([A-Za-z0-9+/=]+)"/.exec(html);
  const verts = new Float32Array(Buffer.from(m[1], 'base64').buffer);
  const real = tsMod.buildGpgpuInitialData(256, cfg.gpgpuBounceRadius, cfg.gpgpuEmitShape, cfg.gpgpuSeed, cfg.gpgpuAgeMax ?? 8);
  let maxPosErr = 0; let maxAgeErr = 0;
  const N = Math.min(256, cfg.gpgpuCount);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      // exporter stores fround(fround(pos) / bounceRadius): compare in stored space, bit-exact
      const expected = Math.fround(real.posData[i * 4 + k] / cfg.gpgpuBounceRadius);
      maxPosErr = Math.max(maxPosErr, Math.abs(verts[i * 10 + k] - expected));
    }
    maxAgeErr = Math.max(maxAgeErr, Math.abs(verts[i * 10 + 9] - Math.fround(real.posData[i * 4 + 3] / (cfg.gpgpuAgeMax ?? 8))));
  }
  check('seed-reproduction ' + id, maxPosErr === 0 && maxAgeErr === 0, 'maxPosErr=' + maxPosErr + ' maxAgeErr=' + maxAgeErr + ' over ' + N + ' particles');
}

/* 3. headless render */
if (!process.argv.includes('--skip-browser')) {
  const require = createRequire(join(homedir(), 'workspace/monosphere-audit/project/package.json'));
  const { chromium } = require('playwright-core');
  const shellRoot = join(homedir(), '.cache/ms-playwright');
  let exe = null;
  for (const d of readdirSync(shellRoot)) {
    const cand = join(shellRoot, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
    if (d.startsWith('chromium_headless_shell') && existsSync(cand)) exe = cand;
  }
  if (!exe) { check('headless chromium available', false, 'no chrome-headless-shell found'); }
  else {
    const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
    for (const id of SAMPLES) {
      const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
      const errors = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto('file://' + join(HERE, 'samples', id, id + '.html'));
      await page.waitForTimeout(1500);
      const stats = await page.evaluate(() => {
        const c = document.getElementById('c');
        const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
        if (!gl) return { ok: false };
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let nonBg = 0;
        const bg = [px[0], px[1], px[2]];
        for (let i = 0; i < px.length; i += 16) {
          if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 12) nonBg++;
        }
        return { ok: true, nonBgSamples: nonBg, w, h };
      });
      check('render ' + id, errors.length === 0 && stats.ok && stats.nonBgSamples > 50,
        'consoleErrors=' + errors.length + (errors[0] ? ' (' + errors[0].slice(0, 120) + ')' : '') + ' nonBgSamples=' + stats.nonBgSamples + ' buffer=' + stats.w + 'x' + stats.h);
      await page.close();
    }
    await browser.close();
  }
}
console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
