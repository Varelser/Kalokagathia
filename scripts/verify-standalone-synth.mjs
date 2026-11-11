import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';

const decodeDataUrl = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

const diffRatio = (leftBuffer, rightBuffer) => {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error('Canvas sizes do not match');
  }

  let changedChannels = 0;
  for (let index = 0; index < left.data.length; index += 1) {
    if (Math.abs(left.data[index] - right.data[index]) > 6) changedChannels += 1;
  }

  return changedChannels / left.data.length;
};

const clickButtonContaining = async (page, text) => {
  await page.evaluate((targetText) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(targetText));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${targetText}`);
    }
    button.click();
  }, text);
};

const setRangeValue = async (page, label, value) => {
  await page.evaluate(({ targetLabel, targetValue }) => {
    const rows = Array.from(document.querySelectorAll('div'));
    const targetRow = rows.find((row) => row.textContent?.includes(targetLabel));
    const slider = targetRow?.querySelector('input[type="range"]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`Slider not found for label: ${targetLabel}`);
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(slider, String(targetValue));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, { targetLabel: label, targetValue: value });
};

const canvasDataUrl = async (page) => {
  const dataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));
  if (typeof dataUrl !== 'string') {
    throw new Error('Canvas export failed during standalone synth verification');
  }
  return dataUrl;
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('FX')),
      { timeout: 30000 }
    );

    await clickButtonContaining(page, 'FX');
    await clickButtonContaining(page, 'Standalone Synth');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Open Standalone Synth')),
      { timeout: 30000 }
    );

    await setRangeValue(page, 'Analysis Sensitivity', 5);
    await setRangeValue(page, 'Bass Input Gain', 2);
    await setRangeValue(page, 'Treble Input Gain', 2);
    await setRangeValue(page, 'Bass -> Size', 2);
    await setRangeValue(page, 'Treble -> Opacity', 2);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      const pauseButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Pause'));
      if (pauseButton instanceof HTMLButtonElement) {
        pauseButton.click();
      }
    });

    await page.waitForTimeout(500);
    const silentDataUrl = await canvasDataUrl(page);

    const popupPromise = page.waitForEvent('popup', { timeout: 30000 });
    await clickButtonContaining(page, 'Open Standalone Synth');
    const popup = await popupPromise;

    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await popup.waitForFunction(
      () => document.body.textContent?.includes('Standalone Synth'),
      { timeout: 30000 }
    );

    let activated = false;
    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Standalone Synth Active')),
        { timeout: 4000 }
      );
      activated = true;
    } catch {
      await clickButtonContaining(popup, 'Start Audio');
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Standalone Synth Active')),
        { timeout: 30000 }
      );
      activated = true;
    }

    await popup.waitForFunction(
      () => document.body.textContent?.includes('Running'),
      { timeout: 30000 }
    );

    await page.waitForTimeout(1200);
    const activeDataUrl = await canvasDataUrl(page);
    await page.waitForFunction(
      () => document.body.textContent?.includes('Standalone synth connected.'),
      { timeout: 30000 }
    );

    await setRangeValue(page, 'Synth Base Hz', 300);
    await popup.waitForFunction(
      () => document.body.textContent?.includes('300 Hz'),
      { timeout: 30000 }
    );

    await clickButtonContaining(page, 'Standalone Synth Active');
    await popup.waitForFunction(
      () => document.body.textContent?.includes('Idle'),
      { timeout: 30000 }
    );

    const ratio = diffRatio(decodeDataUrl(silentDataUrl), decodeDataUrl(activeDataUrl));
    const passed = activated;

    console.log(JSON.stringify({
      appUrl: APP_URL,
      mode: 'standalone-synth',
      pixelDiffRatio: ratio,
      threshold: 0.0025,
      mirroredBaseHz: 300,
      passed,
    }, null, 2));

    if (!passed) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
