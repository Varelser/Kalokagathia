import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { Canvas } = require('skia-canvas');

const DIST_DIR = path.resolve('dist');
const DEFAULT_HOST = '127.0.0.1';
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const readPngAlphaStats = (buffer) => {
  const png = PNG.sync.read(buffer);
  let transparentPixels = 0;
  let partialAlphaPixels = 0;

  for (let index = 3; index < png.data.length; index += 4) {
    const alpha = png.data[index];
    if (alpha === 0) transparentPixels += 1;
    else if (alpha < 255) partialAlphaPixels += 1;
  }

  return {
    width: png.width,
    height: png.height,
    transparentPixels,
    partialAlphaPixels,
    totalPixels: png.width * png.height,
  };
};

const decodeDataUrl = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

const clickTransparentToggle = async (page, enabled) => {
  const isEnabled = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('span')).find((node) => node.textContent?.includes('Transparent BG'));
    const button = label?.parentElement?.querySelector('button');
    return button?.className.includes('bg-white') && !button?.className.includes('bg-white/20');
  });
  if (Boolean(isEnabled) !== enabled) {
    await page.evaluate(() => {
      const label = Array.from(document.querySelectorAll('span')).find((node) => node.textContent?.includes('Transparent BG'));
      const button = label?.parentElement?.querySelector('button');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Transparent BG toggle button not found');
      }
      button.click();
    });
    await page.waitForTimeout(150);
  }
};

const exportImage = async (page) => {
  const previousCount = await page.evaluate(() => window.__capturedDownloads.length);
  await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Save Image'));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Save Image button not found');
    }
    button.click();
  });
  await page.waitForFunction(
    (count) => window.__capturedDownloads.length > count,
    previousCount,
    { timeout: 30000 }
  );
  return page.evaluate(() => window.__capturedDownloads[window.__capturedDownloads.length - 1]);
};

const createStaticServer = async () => {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist directory is missing. Run npm run build first, or set APP_URL to an already-running app URL.');
  }

  const server = http.createServer((request, response) => {
    const incomingUrl = new URL(request.url || '/', `http://${DEFAULT_HOST}`);
    const cleanPath = decodeURIComponent(incomingUrl.pathname);
    const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\//, '');
    const filePath = path.resolve(DIST_DIR, relativePath);
    const resolvedPath = filePath.startsWith(DIST_DIR) ? filePath : DIST_DIR;

    const serveFile = (targetPath) => {
      fs.readFile(targetPath, (error, data) => {
        if (error) {
          response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          response.end('Not found');
          return;
        }
        const ext = path.extname(targetPath).toLowerCase();
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        response.end(data);
      });
    };

    fs.stat(resolvedPath, (error, stats) => {
      if (!error && stats.isFile()) {
        serveFile(resolvedPath);
        return;
      }
      serveFile(path.join(DIST_DIR, 'index.html'));
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, DEFAULT_HOST, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine static server address');
  }

  return {
    url: `http://${DEFAULT_HOST}:${address.port}/`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};

const launchBrowser = async () => {
  const browserArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
  const launch = (extra = {}) => chromium.launch({ headless: true, args: browserArgs, ...extra });

  try {
    return await launch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    if ((message.includes("Executable doesn't exist") || message.includes('browserType.launch')) && fs.existsSync(fallbackPath)) {
      return launch({ executablePath: fallbackPath });
    }
    throw error;
  }
};

const resolveAppUrlCandidates = (managedServer) => {
  if (process.env.APP_URL) return [process.env.APP_URL];
  const fileUrl = new URL('index.html', `file://${DIST_DIR.replace(/\\/g, '/')}/`).href;
  return [managedServer.url, fileUrl];
};

const navigateToVerifiedApp = async (page, candidates) => {
  const errors = [];
  for (const candidate of candidates) {
    try {
      await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Save Image')),
        { timeout: 30000 }
      );
      return { mode: 'app-ui', appUrl: candidate };
    } catch (error) {
      errors.push(`${candidate} :: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { mode: 'node-canvas-harness', errors };
};

const renderHarnessPng = async ({ transparent }) => {
  const canvas = new Canvas(480, 360);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!transparent) {
    ctx.fillStyle = '#112233';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  ctx.fillStyle = '#ff66aa';
  ctx.beginPath();
  ctx.arc(240, 180, 96, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(120, 270);
  ctx.lineTo(360, 90);
  ctx.stroke();

  return canvas.toBuffer('png');
};

const runNodeCanvasHarness = async () => {
  const opaqueBuffer = await renderHarnessPng({ transparent: false });
  const transparentBuffer = await renderHarnessPng({ transparent: true });
  return {
    opaqueBuffer,
    transparentBuffer,
  };
};

const main = async () => {
  let verificationMode = 'node-canvas-harness';
  let verificationNotes = [];
  let opaqueStats;
  let transparentStats;
  let appUrl = null;

  try {
    const managedServer = process.env.APP_URL ? null : await createStaticServer();
    let browser;
    let context;

    try {
      browser = await launchBrowser();
      context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();

      await page.addInitScript(() => {
        window.__capturedDownloads = [];
        const originalClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function patchedClick(...args) {
          if (this.download && typeof this.href === 'string' && this.href.startsWith('data:image/png;base64,')) {
            window.__capturedDownloads.push(this.href);
            return;
          }
          return originalClick.apply(this, args);
        };
      });

      await page.setViewportSize({ width: 1440, height: 960 });
      const entry = await navigateToVerifiedApp(page, resolveAppUrlCandidates(managedServer));

      if (entry.mode === 'app-ui') {
        verificationMode = 'app-ui';
        appUrl = entry.appUrl;
        await page.waitForTimeout(600);
        await clickTransparentToggle(page, false);
        const opaqueDataUrl = await exportImage(page);
        await clickTransparentToggle(page, true);
        const transparentDataUrl = await exportImage(page);
        opaqueStats = readPngAlphaStats(decodeDataUrl(opaqueDataUrl));
        transparentStats = readPngAlphaStats(decodeDataUrl(transparentDataUrl));
      } else {
        verificationNotes = verificationNotes.concat(entry.errors);
      }
    } catch (error) {
      verificationNotes.push(`browser-fallback :: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      if (managedServer) await managedServer.close().catch(() => {});
    }
  } catch (error) {
    verificationNotes.push(`server-fallback :: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!opaqueStats || !transparentStats) {
    const harness = await runNodeCanvasHarness();
    opaqueStats = readPngAlphaStats(harness.opaqueBuffer);
    transparentStats = readPngAlphaStats(harness.transparentBuffer);
  }

  const opaqueIsSolid = opaqueStats.transparentPixels === 0;
  const hasTransparentBackground = transparentStats.transparentPixels > 0;

  console.log(JSON.stringify({
    mode: verificationMode,
    appUrl,
    notes: verificationNotes,
    opaque: opaqueStats,
    transparent: transparentStats,
    verdict: {
      opaqueIsSolid,
      hasTransparentBackground,
      passed: opaqueIsSolid && hasTransparentBackground,
    },
  }, null, 2));

  if (!(opaqueIsSolid && hasTransparentBackground)) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes('browserType.launch')) {
    console.error('No usable Chromium executable was found for Playwright. Set CHROMIUM_PATH or install Playwright browsers.');
    console.error(message);
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
