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

const getLastFrameExport = async (page) => page.evaluate(() => window.__capturedFrameExports.at(-1) ?? null);

const exportFramesAndAwaitDownload = async (page) => {
  const previousCount = await page.evaluate(() => window.__capturedFrameExports.length);
  await clickButtonByText(page, 'Export PNG Frames');
  await page.waitForFunction(
    (count) => {
      const hasNewCapture = window.__capturedFrameExports.length > count;
      const hasSuccessNotice = Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('PNG frame export complete'));
      const hasErrorNotice = Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('PNG frame export failed'));
      return hasNewCapture || hasSuccessNotice || hasErrorNotice;
    },
    previousCount,
    { timeout: 120000 }
  );

  const exportState = await page.evaluate(() => ({
    captures: window.__capturedFrameExports,
    success: Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('PNG frame export complete')),
    error: Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('PNG frame export failed')),
  }));

  if (exportState.error) {
    throw new Error(`PNG frame export reported failure: ${JSON.stringify(exportState)}`);
  }

  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('span, div')).some((node) => node.textContent?.includes('PNG frame export complete')),
    { timeout: 120000 }
  );
  return getLastFrameExport(page);
};

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.__capturedFrameExports = [];
      window.__frameBlobUrls = new Map();

      HTMLCanvasElement.prototype.toBlob = function toBlobMock(callback, type) {
        const blob = new Blob([`fake-${type || 'image/png'}-${Date.now()}`], { type: type || 'image/png' });
        setTimeout(() => callback(blob), 0);
      };

      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function patchedCreateObjectURL(blob) {
        const url = originalCreateObjectURL(blob);
        if (blob instanceof Blob) {
          window.__frameBlobUrls.set(url, {
            type: blob.type || 'application/octet-stream',
            size: blob.size,
          });
        }
        return url;
      };

      const originalAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function patchedAnchorClick(...args) {
        if (this.download && typeof this.href === 'string' && window.__frameBlobUrls.has(this.href)) {
          window.__capturedFrameExports.push(window.__frameBlobUrls.get(this.href));
        }
        return originalAnchorClick.apply(this, args);
      };
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Export PNG Frames')),
      { timeout: 30000 }
    );
    await wait(500);

    await setToggleOption(page, 'Recording Mode', 'Current');
    await setRangeByLabel(page, 'Frame Rate', 12);
    await setRangeByLabel(page, 'Duration Seconds', 1);
    const currentExport = await exportFramesAndAwaitDownload(page);
    if (!currentExport || currentExport.size <= 0) {
      throw new Error(`Current frame export failed: ${JSON.stringify(currentExport)}`);
    }

    await setPresetNameAndSave(page, 'Frame Alpha');
    await addPresetToSequence(page, 'Frame Alpha');
    const sequenceExportCountBefore = await page.evaluate(() => window.__capturedFrameExports.length);
    await setRangeByLabel(page, 'Frame Rate', 12);
    await setRangeByLabel(page, 'Hold Seconds', 0.2);
    await setRangeByLabel(page, 'Transition Seconds', 0.05);
    await setToggleOption(page, 'Recording Mode', 'Sequence');
    const sequenceExport = await exportFramesAndAwaitDownload(page);
    const sequenceExportCountAfter = await page.evaluate(() => window.__capturedFrameExports.length);

    if (!sequenceExport || sequenceExport.size <= 0) {
      throw new Error(`Sequence frame export failed: ${JSON.stringify(sequenceExport)}`);
    }

    if (sequenceExportCountAfter <= sequenceExportCountBefore) {
      throw new Error('Sequence frame export did not produce a new zip');
    }

    console.log(JSON.stringify({
      appUrl: APP_URL,
      currentExport,
      sequenceExport,
      totalExports: sequenceExportCountAfter,
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
