import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';
const APP_READY_TIMEOUT = 60000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeDataUrl = (dataUrl) => Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

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

const runWithRetries = async (action, attempts = 3) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await wait(250);
      }
    }
  }
  throw lastError;
};

const clickButton = async (page, label) => {
  await runWithRetries(() => page.evaluate((targetLabel) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const exactButton = buttons.find((node) => node.textContent?.trim() === targetLabel);
    const fallbackButton = buttons.find((node) => node.textContent?.includes(targetLabel));
    const button = exactButton ?? fallbackButton;
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${targetLabel}`);
    }
    button.click();
  }, label));
};

const setRangeValue = async (page, label, value) => {
  await runWithRetries(() => page.evaluate(({ targetLabel, targetValue }) => {
    const spanLabels = Array.from(document.querySelectorAll('span'));
    const divRows = Array.from(document.querySelectorAll('div'));
    const exactLabelNode = spanLabels.find((node) => node.textContent?.trim() === targetLabel);
    const fuzzyRow = divRows.find((row) => row.textContent?.includes(targetLabel));
    const targetRow = exactLabelNode?.closest('div.mb-4') ?? exactLabelNode?.closest('div')?.parentElement ?? fuzzyRow;
    const slider = targetRow?.querySelector('input[type="range"]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`Slider not found for label: ${targetLabel}`);
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(slider, String(targetValue));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, { targetLabel: label, targetValue: value }));
};

const setToggleValue = async (page, label, option) => {
  await runWithRetries(() => page.evaluate(({ targetLabel, targetOption }) => {
    const divs = Array.from(document.querySelectorAll('div'));
    const exactLabelNode = divs.find((node) => node.textContent?.trim() === targetLabel);
    const fuzzyContainer = divs.find((node) => node.textContent?.includes(targetLabel) && Array.from(node.querySelectorAll('button')).some((button) => button.textContent?.trim() === targetOption));
    const targetContainer = exactLabelNode?.closest('div.mb-5') ?? exactLabelNode?.parentElement ?? fuzzyContainer;
    const button = Array.from(targetContainer?.querySelectorAll('button') || []).find((node) => node.textContent?.trim() === targetOption);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Toggle option not found: ${targetLabel} -> ${targetOption}`);
    }
    button.click();
  }, { targetLabel: label, targetOption: option }));
};

const getCanvasDataUrl = async (page) => {
  const dataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));
  if (typeof dataUrl !== 'string') {
    throw new Error('Canvas export failed during collision verification');
  }
  return dataUrl;
};

const getContactMeterValue = async (page) => {
  return page.evaluate(() => {
    const meter = document.querySelector('[data-contact-meter]');
    if (!(meter instanceof HTMLElement)) {
      throw new Error('Contact meter element not found');
    }
    return Number.parseFloat(meter.dataset.contactMeter || '0');
  });
};

const waitForAppReady = async (page) => {
  await page.waitForFunction(
    () => Boolean(document.querySelector('canvas')) && ['Main', 'L2', 'FX'].every((label) => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes(label))),
    { timeout: APP_READY_TIMEOUT }
  );
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const requestFailures = [];

  page.on('pageerror', (error) => {
    pageErrors.push(error.stack || error.message);
  });

  page.on('requestfailed', (request) => {
    requestFailures.push({ url: request.url(), errorText: request.failure()?.errorText || 'unknown' });
  });

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
    await waitForAppReady(page);
    await wait(400);

    await clickButton(page, 'Pause');

    await clickButton(page, 'L2');
    await setToggleValue(page, 'Enable Layer 2', 'On');
    await setRangeValue(page, 'Source Count', 2);
    await setRangeValue(page, 'Source Spread', 0);
    await setToggleValue(page, 'Draw Lines', 'On');

    await clickButton(page, 'Main');
    await setToggleValue(page, 'Layer Repulsion', 'On');
    await setToggleValue(page, 'Collider Mode', 'Per Source');
    await setToggleValue(page, 'Audio Link', 'On');

    await clickButton(page, 'FX');
    await setRangeValue(page, 'Mic Sensitivity', 5);
    await setRangeValue(page, 'Bass Input Gain', 2);
    await setRangeValue(page, 'Treble Input Gain', 2);
    await setRangeValue(page, 'Bass -> Size', 2);
    await setRangeValue(page, 'Treble -> Opacity', 2);
    await clickButton(page, 'Start Microphone');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Microphone Active')),
      { timeout: 30000 }
    );

    await clickButton(page, 'Main');
    await page.waitForTimeout(500);

    await page.evaluate(() => window.__setFakeAudioLevels({ bass: 0, treble: 0 }));
    await page.waitForTimeout(600);
    const contactMeter = await getContactMeterValue(page);
    const baseDataUrl = await getCanvasDataUrl(page);

    await setToggleValue(page, 'Impact FX', 'On');
    await setRangeValue(page, 'Contact Glow', 1.2);
    await setRangeValue(page, 'Contact Size', 1.0);
    await setRangeValue(page, 'Contact Line Boost', 1.0);
    await setRangeValue(page, 'Contact Screen Boost', 0.8);
    await page.waitForTimeout(700);
    const impactDataUrl = await getCanvasDataUrl(page);

    await page.evaluate(() => window.__setFakeAudioLevels({ bass: 1, treble: 0.9 }));
    await page.waitForTimeout(1200);
    const audioReactiveDataUrl = await getCanvasDataUrl(page);

    const impactRatio = diffRatio(decodeDataUrl(baseDataUrl), decodeDataUrl(impactDataUrl));
    const audioReactiveRatio = diffRatio(decodeDataUrl(impactDataUrl), decodeDataUrl(audioReactiveDataUrl));
    const passed = contactMeter > 0.02 && impactRatio > 0.0008 && audioReactiveRatio > 0.0015;

    console.log(JSON.stringify({
      appUrl: APP_URL,
      contactMeter,
      impactFxDiffRatio: impactRatio,
      impactFxThreshold: 0.0008,
      audioReactiveDiffRatio: audioReactiveRatio,
      audioReactiveThreshold: 0.0015,
      pageErrors,
      requestFailures,
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
