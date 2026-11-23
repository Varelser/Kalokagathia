// Unit tests for lib/captureExport.ts (KCB3: still-image JPEG/WebP +
// aspect-ratio presets). Plain Node, no test framework — same style as
// scripts/bench-harness.test.mjs; the TS lib is bundled with esbuild
// the same way the generate-phase5-*.mjs scripts bundle their entries.
// Run: node scripts/kcb3-capture-export.test.mjs   (from the project root)

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tempDir = mkdtempSync(path.join(tmpdir(), 'kalokagathia-kcb3-test-'));
const outfile = path.join(tempDir, 'captureExport.bundle.mjs');

let lib;
try {
  await build({
    entryPoints: [path.resolve('lib/captureExport.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: false,
    logLevel: 'silent',
  });
  lib = await import(pathToFileURL(outfile).href);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

const {
  CAPTURE_ASPECT_PRESETS,
  CAPTURE_IMAGE_FORMATS,
  DEFAULT_CAPTURE_EXPORT_OPTIONS,
  buildCaptureFilename,
  captureAcceptMap,
  captureAspectRatio,
  captureFormatSpec,
  captureOutputSize,
  captureQualityArg,
  centerCropRect,
  isCaptureAspectPreset,
  isCaptureImageFormat,
  isFullFrameRect,
  isIdentityCaptureOptions,
  normalizeCaptureQuality,
} = lib;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
const rectEq = (r, sx, sy, sw, sh) => r.sx === sx && r.sy === sy && r.sw === sw && r.sh === sh;
const rectStr = (r) => `{${r.sx},${r.sy},${r.sw},${r.sh}}`;

// ---- format specs / mime ---------------------------------------------------
{
  const png = captureFormatSpec('png');
  check('png spec', png.mimeType === 'image/png' && png.extension === '.png' && png.supportsQuality === false && png.description === 'PNG image');
  const jpeg = captureFormatSpec('jpeg');
  check('jpeg spec', jpeg.mimeType === 'image/jpeg' && jpeg.extension === '.jpg' && jpeg.supportsQuality === true);
  const webp = captureFormatSpec('webp');
  check('webp spec', webp.mimeType === 'image/webp' && webp.extension === '.webp' && webp.supportsQuality === true);
  check('format list', JSON.stringify(CAPTURE_IMAGE_FORMATS) === JSON.stringify(['png', 'jpeg', 'webp']));
  check('accept maps', JSON.stringify(captureAcceptMap('png')) === JSON.stringify({ 'image/png': ['.png'] })
    && JSON.stringify(captureAcceptMap('jpeg')) === JSON.stringify({ 'image/jpeg': ['.jpg'] })
    && JSON.stringify(captureAcceptMap('webp')) === JSON.stringify({ 'image/webp': ['.webp'] }));
  check('filenames', buildCaptureFilename(1730000000000, 'png') === 'kalokagathia_1730000000000.png'
    && buildCaptureFilename(1730000000000, 'jpeg') === 'kalokagathia_1730000000000.jpg'
    && buildCaptureFilename(1730000000000, 'webp') === 'kalokagathia_1730000000000.webp');
  check('format guard', isCaptureImageFormat('png') && isCaptureImageFormat('webp') && !isCaptureImageFormat('gif') && !isCaptureImageFormat('PNG'));
}

// ---- quality ----------------------------------------------------------------
{
  check('quality passthrough', normalizeCaptureQuality(0.92, 'jpeg') === 0.92 && normalizeCaptureQuality(0, 'webp') === 0);
  check('quality clamps high', normalizeCaptureQuality(1.5, 'jpeg') === 1);
  check('quality clamps low', normalizeCaptureQuality(-0.2, 'jpeg') === 0);
  check('quality NaN falls back to default', normalizeCaptureQuality(NaN, 'jpeg') === 0.92 && normalizeCaptureQuality(Infinity, 'webp') === 0.92);
  check('quality arg: png is undefined (legacy call shape)', captureQualityArg({ format: 'png', aspect: 'original', quality: 0.5 }) === undefined);
  check('quality arg: jpeg normalised', captureQualityArg({ format: 'jpeg', aspect: 'original', quality: 2 }) === 1
    && captureQualityArg({ format: 'webp', aspect: '1:1', quality: 0.8 }) === 0.8);
}

// ---- aspect ratios ------------------------------------------------------------
{
  check('aspect preset list', JSON.stringify(CAPTURE_ASPECT_PRESETS) === JSON.stringify(['original', '16:9', '9:16', '1:1', '4:5', '21:9']));
  check('original ratio is null', captureAspectRatio('original') === null);
  check('ratio values', Math.abs(captureAspectRatio('16:9') - 16 / 9) < 1e-12
    && captureAspectRatio('9:16') === 9 / 16
    && captureAspectRatio('1:1') === 1
    && captureAspectRatio('4:5') === 0.8
    && Math.abs(captureAspectRatio('21:9') - 21 / 9) < 1e-12);
  check('aspect guard', isCaptureAspectPreset('4:5') && !isCaptureAspectPreset('3:2') && !isCaptureAspectPreset(5));
}

// ---- crop: identity / same-ratio ---------------------------------------------
{
  check('original keeps full frame', rectEq(centerCropRect(1920, 1080, 'original'), 0, 0, 1920, 1080));
  check('original keeps odd sizes', rectEq(centerCropRect(1919, 1079, 'original'), 0, 0, 1919, 1079));
  check('16:9 on a 16:9 frame is full', rectEq(centerCropRect(1920, 1080, '16:9'), 0, 0, 1920, 1080));
  check('1:1 on a square is full', rectEq(centerCropRect(500, 500, '1:1'), 0, 0, 500, 500));
  check('full-frame rect detection', isFullFrameRect(centerCropRect(1920, 1080, 'original'), 1920, 1080)
    && !isFullFrameRect(centerCropRect(1920, 1080, '1:1'), 1920, 1080));
}

// ---- crop: each preset ----------------------------------------------------------
{
  const r169 = centerCropRect(1000, 1000, '16:9');
  check('16:9 on square crops height (floored)', rectEq(r169, 0, 219, 1000, 562), rectStr(r169));
  const r916 = centerCropRect(1920, 1080, '9:16');
  check('9:16 on 1920x1080 crops width (floored)', rectEq(r916, 656, 0, 607, 1080), rectStr(r916));
  check('1:1 on landscape', rectEq(centerCropRect(1920, 1080, '1:1'), 420, 0, 1080, 1080));
  check('1:1 on portrait', rectEq(centerCropRect(1080, 1920, '1:1'), 0, 420, 1080, 1080));
  check('4:5 on square', rectEq(centerCropRect(1000, 1000, '4:5'), 100, 0, 800, 1000));
  check('4:5 on 1920x1080', rectEq(centerCropRect(1920, 1080, '4:5'), 528, 0, 864, 1080));
  const r219 = centerCropRect(1920, 1080, '21:9');
  check('21:9 on 1920x1080 crops height (floored)', rectEq(r219, 0, 129, 1920, 822), rectStr(r219));
}

// ---- crop: rounding / edges -------------------------------------------------------
{
  check('odd leftover floors the origin', rectEq(centerCropRect(101, 100, '1:1'), 0, 0, 100, 100)
    && rectEq(centerCropRect(100, 101, '1:1'), 0, 0, 100, 100));
  check('source smaller than target frame still crops by ratio', rectEq(centerCropRect(4, 3, '16:9'), 0, 0, 4, 2));
  check('tiny width clamps crop height to 1px', rectEq(centerCropRect(1, 100, '21:9'), 0, 49, 1, 1));
  check('tiny height clamps crop width to 1px', rectEq(centerCropRect(100, 1, '9:16'), 49, 0, 1, 1));
  check('large source', rectEq(centerCropRect(8000, 4000, '9:16'), 2875, 0, 2250, 4000));
  check('fractional source is floored first', rectEq(centerCropRect(100.7, 50.2, 'original'), 0, 0, 100, 50));
  check('degenerate sources give a zero rect', rectEq(centerCropRect(0, 100, '1:1'), 0, 0, 0, 0)
    && rectEq(centerCropRect(-5, 100, '1:1'), 0, 0, 0, 0)
    && rectEq(centerCropRect(NaN, 100, '1:1'), 0, 0, 0, 0));
}

// ---- crop: bounds + ratio invariant over a size matrix ------------------------------
{
  const sizes = [[1920, 1080], [1080, 1920], [1000, 1000], [640, 480], [333, 777], [128, 96]];
  let boundsOk = true;
  let ratioOk = true;
  for (const [w, h] of sizes) {
    for (const preset of CAPTURE_ASPECT_PRESETS) {
      const r = centerCropRect(w, h, preset);
      if (!(r.sx >= 0 && r.sy >= 0 && r.sw >= 1 && r.sh >= 1 && r.sx + r.sw <= w && r.sy + r.sh <= h)) boundsOk = false;
      const target = captureAspectRatio(preset);
      // Floor rounding can shift the ratio by up to ~target/sh; allow that
      // plus a small epsilon instead of a fixed tolerance.
      if (target !== null && Math.abs(r.sw / r.sh - target) > target / r.sh + 0.01) ratioOk = false;
      const out = captureOutputSize(w, h, preset);
      if (out.width !== r.sw || out.height !== r.sh) boundsOk = false;
    }
  }
  check('crop stays in bounds and matches output size across matrix', boundsOk);
  check('crop ratio within rounding tolerance across matrix', ratioOk);
}

// ---- identity condition --------------------------------------------------------------
{
  check('defaults are the identity options', DEFAULT_CAPTURE_EXPORT_OPTIONS.format === 'png' && DEFAULT_CAPTURE_EXPORT_OPTIONS.aspect === 'original');
  check('identity: png + original', isIdentityCaptureOptions({ format: 'png', aspect: 'original', quality: 0.5 }) === true);
  check('not identity: jpeg + original', isIdentityCaptureOptions({ format: 'jpeg', aspect: 'original', quality: 0.92 }) === false);
  check('not identity: png + 16:9', isIdentityCaptureOptions({ format: 'png', aspect: '16:9', quality: 0.92 }) === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
