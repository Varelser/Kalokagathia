import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';

const decodeDataUrl = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

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

const diffRatio = (leftBuffer, rightBuffer) => {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error('Canvas sizes do not match');
  }

  let changedChannels = 0;
  for (let i = 0; i < left.data.length; i++) {
    if (Math.abs(left.data[i] - right.data[i]) > 6) changedChannels += 1;
  }

  return changedChannels / left.data.length;
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {

    await page.addInitScript(() => {
      window.__fakeAudio = { bass: 0, treble: 0 };
      window.__setFakeAudioLevels = ({ bass, treble }) => {
        window.__fakeAudio = { bass, treble };
      };

      window.__MONOSPHERE_FAKE_AUDIO_FACTORY__ = () => ({
        frequencyBinCount: 128,
        getByteFrequencyData(data) {
          data.fill(0);
          const bassValue = Math.max(0, Math.min(255, Math.round(window.__fakeAudio.bass * 255)));
          const trebleValue = Math.max(0, Math.min(255, Math.round(window.__fakeAudio.treble * 255)));
          for (let i = 0; i < 10 && i < data.length; i++) data[i] = bassValue;
          for (let i = 80; i < 120 && i < data.length; i++) data[i] = trebleValue;
        },
      });
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('FX')),
      { timeout: 30000 }
    );
    await page.evaluate(() => {
      const fxButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('FX'));
      if (!(fxButton instanceof HTMLButtonElement)) {
        throw new Error('FX tab button not found');
      }
      fxButton.click();
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Start Microphone')),
      { timeout: 30000 }
    );
    await setRangeValue(page, 'Mic Sensitivity', 5);
    await setRangeValue(page, 'Bass Input Gain', 2);
    await setRangeValue(page, 'Treble Input Gain', 2);
    await setRangeValue(page, 'Bass -> Size', 2);
    await setRangeValue(page, 'Treble -> Opacity', 2);
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const pauseButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Pause'));
      if (pauseButton instanceof HTMLButtonElement) pauseButton.click();
    });

    await page.evaluate(() => {
      const micButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Start Microphone'));
      if (!(micButton instanceof HTMLButtonElement)) {
        throw new Error('Start Microphone button not found');
      }
      micButton.click();
    });

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Microphone Active')),
      { timeout: 30000 }
    );

    await page.evaluate(() => window.__setFakeAudioLevels({ bass: 0, treble: 0 }));
    await page.waitForTimeout(500);
    const silentDataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));

    await page.evaluate(() => window.__setFakeAudioLevels({ bass: 0.9, treble: 0.9 }));
    await page.waitForTimeout(1200);
    const activeDataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));

    if (typeof silentDataUrl !== 'string' || typeof activeDataUrl !== 'string') {
      throw new Error('Canvas export failed during audio verification');
    }

    const ratio = diffRatio(decodeDataUrl(silentDataUrl), decodeDataUrl(activeDataUrl));
    const passed = ratio > 0.0025;

    console.log(JSON.stringify({
      appUrl: APP_URL,
      pixelDiffRatio: ratio,
      threshold: 0.0025,
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
