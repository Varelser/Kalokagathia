import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickButtonByText = async (page, text) => {
  await page.evaluate((targetText) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(targetText));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${targetText}`);
    }
    button.click();
  }, text);
};

const setPresetNameAndSave = async (page, name) => {
  await page.locator('input[placeholder="New preset name"]').fill(name);
  await clickButtonByText(page, 'Save New');
  await page.waitForFunction(
    (targetName) => Array.from(document.querySelectorAll('div')).some((node) => node.textContent?.includes(targetName)),
    name,
    { timeout: 30000 }
  );
};

const addPresetToSequence = async (page, presetName) => {
  await page.evaluate((targetName) => {
    const presetLabel = Array.from(document.querySelectorAll('div')).find((node) => node.textContent?.trim() === targetName);
    const card = presetLabel?.closest('div.rounded.border');
    const addButton = Array.from(card?.querySelectorAll('button') || []).find((node) => node.getAttribute('title') === 'Add to sequence');
    if (!(addButton instanceof HTMLButtonElement)) {
      throw new Error(`Add to sequence button not found for preset: ${targetName}`);
    }
    addButton.click();
  }, presetName);
  await wait(150);
};

const setToggleOption = async (page, labelText, optionText) => {
  await page.evaluate(({ labelText: targetLabel, optionText: targetOption }) => {
    const labelNode = Array.from(document.querySelectorAll('div')).find((node) => node.textContent?.trim() === targetLabel);
    const container = labelNode?.closest('div.mb-5');
    const button = Array.from(container?.querySelectorAll('button') || []).find((node) => node.textContent?.trim() === targetOption);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Toggle option not found: ${targetLabel} -> ${targetOption}`);
    }
    button.click();
  }, { labelText, optionText });
  await wait(150);
};

const setRangeByLabel = async (page, labelText, value) => {
  await page.evaluate(({ labelText: targetLabel, value: nextValue }) => {
    const labelNode = Array.from(document.querySelectorAll('span')).find((node) => node.textContent?.trim() === targetLabel);
    const wrapper = labelNode?.closest('div.mb-4');
    const slider = wrapper?.querySelector('input[type="range"]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error(`Slider not found: ${targetLabel}`);
    }
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (!valueSetter) {
      throw new Error(`Value setter not found for slider: ${targetLabel}`);
    }
    valueSetter.call(slider, String(nextValue));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, { labelText, value });
  await wait(100);
};

const getLastCapture = async (page) => page.evaluate(() => window.__capturedVideoExports.at(-1) ?? null);

const recordAndAwaitDownload = async (page) => {
  const previousCount = await page.evaluate(() => window.__capturedVideoExports.length);
  await clickButtonByText(page, 'Record WebM');
  await page.waitForFunction(
    (count) => window.__capturedVideoExports.length > count,
    previousCount,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('Video exported.')),
    { timeout: 30000 }
  );
  return getLastCapture(page);
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.__capturedVideoExports = [];

      HTMLCanvasElement.prototype.captureStream = function captureStreamMock() {
        return {
          getTracks() {
            return [{ stop() {} }];
          },
        };
      };

      class FakeMediaRecorder {
        constructor(stream, options = {}) {
          this.stream = stream;
          this.mimeType = options.mimeType || 'video/webm';
          this.state = 'inactive';
          this.ondataavailable = null;
          this.onstop = null;
          this.onerror = null;
        }

        static isTypeSupported(candidate) {
          return typeof candidate === 'string' && candidate.startsWith('video/webm');
        }

        start() {
          this.state = 'recording';
          setTimeout(() => {
            if (typeof this.ondataavailable === 'function') {
              this.ondataavailable({
                data: new Blob(['fake-webm-payload'], { type: this.mimeType }),
              });
            }
          }, 40);
        }

        stop() {
          if (this.state === 'inactive') return;
          this.state = 'inactive';
          setTimeout(() => {
            if (typeof this.onstop === 'function') {
              this.onstop();
            }
          }, 20);
        }

        addEventListener() {}
        removeEventListener() {}
      }

      window.MediaRecorder = FakeMediaRecorder;

      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function patchedCreateObjectURL(blob) {
        if (blob instanceof Blob && blob.type.startsWith('video/webm')) {
          window.__capturedVideoExports.push({
            type: blob.type,
            size: blob.size,
          });
        }
        return originalCreateObjectURL(blob);
      };
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Record WebM')),
      { timeout: 30000 }
    );
    await wait(500);

    await setToggleOption(page, 'Recording Mode', 'Current');
    await setRangeByLabel(page, 'Duration Seconds', 1);
    const currentCapture = await recordAndAwaitDownload(page);
    if (!currentCapture || currentCapture.size <= 0 || !currentCapture.type.startsWith('video/webm')) {
      throw new Error(`Current mode recording failed: ${JSON.stringify(currentCapture)}`);
    }

    await setPresetNameAndSave(page, 'Video Alpha');
    await addPresetToSequence(page, 'Video Alpha');
    const sequenceCaptureCountBefore = await page.evaluate(() => window.__capturedVideoExports.length);
    await setRangeByLabel(page, 'Hold Seconds', 0.2);
    await setRangeByLabel(page, 'Transition Seconds', 0.05);
    await setToggleOption(page, 'Recording Mode', 'Sequence');
    const sequenceCapture = await recordAndAwaitDownload(page);
    const sequenceCaptureCountAfter = await page.evaluate(() => window.__capturedVideoExports.length);

    if (!sequenceCapture || sequenceCapture.size <= 0 || !sequenceCapture.type.startsWith('video/webm')) {
      throw new Error(`Sequence mode recording failed: ${JSON.stringify(sequenceCapture)}`);
    }

    if (sequenceCaptureCountAfter <= sequenceCaptureCountBefore) {
      throw new Error('Sequence recording did not produce a new capture');
    }

    console.log(JSON.stringify({
      appUrl: APP_URL,
      currentCapture,
      sequenceCapture,
      totalCaptures: sequenceCaptureCountAfter,
      passed: true,
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
