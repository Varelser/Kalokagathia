import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:3000/';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clickButtonContaining = async (page, text) => {
  await page.evaluate((targetText) => {
    const button = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes(targetText));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Button not found: ${targetText}`);
    }
    button.click();
  }, text);
};

const clickTab = async (page, text) => {
  await clickButtonContaining(page, text);
  await wait(150);
};

const setToggleOption = async (page, labelText, optionText) => {
  await page.evaluate(({ targetLabel, targetOption }) => {
    const labelNode = Array.from(document.querySelectorAll('div')).find((node) => node.textContent?.trim() === targetLabel);
    const container = labelNode?.closest('div.mb-5');
    const button = Array.from(container?.querySelectorAll('button') || []).find((node) => node.textContent?.trim() === targetOption);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Toggle option not found: ${targetLabel} -> ${targetOption}`);
    }
    button.click();
  }, { targetLabel: labelText, targetOption: optionText });
  await wait(150);
};

const setRangeByLabel = async (page, labelText, value) => {
  await page.evaluate(({ targetLabel, nextValue }) => {
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
  }, { targetLabel: labelText, nextValue: value });
  await wait(120);
};

const getLastCapture = async (page) => page.evaluate(() => window.__capturedVideoExports.at(-1) ?? null);

const recordAndAwaitCapture = async (page) => {
  const previousCount = await page.evaluate(() => window.__capturedVideoExports.length);
  await clickButtonContaining(page, 'Record WebM');
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

      const buildAudioStream = (frequency) => {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioCtor();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gainNode.gain.value = 0.2;
        oscillator.connect(gainNode);
        gainNode.connect(destination);
        oscillator.start();
        audioContext.resume();
        window.__mockAudioContexts = window.__mockAudioContexts || [];
        window.__mockAudioContexts.push({ audioContext, oscillator, gainNode });
        return destination.stream;
      };

      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', {
          value: {},
          configurable: true,
        });
      }

      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints?.audio) {
          throw new Error('Mock getUserMedia only supports audio constraints');
        }
        return buildAudioStream(220);
      };

      class FakeMediaRecorder {
        constructor(stream, options = {}) {
          this.stream = stream;
          this.mimeType = options.mimeType || 'video/webm';
          this.state = 'inactive';
          this.ondataavailable = null;
          this.onstop = null;
          this.onerror = null;

          const audioTracks = typeof stream?.getAudioTracks === 'function' ? stream.getAudioTracks() : [];
          const videoTracks = typeof stream?.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
          window.__capturedVideoExports.push({
            audioTracks: audioTracks.length,
            videoTracks: videoTracks.length,
            mimeType: this.mimeType,
            phase: 'created',
          });
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
    });

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('FX')),
      { timeout: 30000 }
    );
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Record WebM')),
      { timeout: 30000 }
    );

    await setToggleOption(page, 'Recording Mode', 'Current');
    await setRangeByLabel(page, 'Duration Seconds', 1);

    await clickTab(page, 'FX');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Start Microphone')),
      { timeout: 30000 }
    );
    await clickButtonContaining(page, 'Start Microphone');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Microphone Active')),
      { timeout: 30000 }
    );

    await clickTab(page, 'Main');
    const microphoneCapture = await recordAndAwaitCapture(page);
    if (!microphoneCapture || microphoneCapture.audioTracks < 1 || microphoneCapture.videoTracks < 1) {
      throw new Error(`Microphone recording did not contain expected tracks: ${JSON.stringify(microphoneCapture)}`);
    }

    await clickTab(page, 'FX');
    await clickButtonContaining(page, 'Standalone Synth');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Open Standalone Synth')),
      { timeout: 30000 }
    );

    const popupPromise = page.waitForEvent('popup', { timeout: 30000 });
    await clickButtonContaining(page, 'Open Standalone Synth');
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 });

    try {
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Standalone Synth Active')),
        { timeout: 5000 }
      );
    } catch {
      await clickButtonContaining(popup, 'Start Audio');
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Standalone Synth Active')),
        { timeout: 30000 }
      );
    }

    await page.waitForFunction(
      () => document.body.textContent?.includes('Standalone synth connected.'),
      { timeout: 30000 }
    );

    await clickTab(page, 'Main');
    const standaloneCapture = await recordAndAwaitCapture(page);
    if (!standaloneCapture || standaloneCapture.audioTracks < 1 || standaloneCapture.videoTracks < 1) {
      throw new Error(`Standalone synth recording did not contain expected tracks: ${JSON.stringify(standaloneCapture)}`);
    }

    console.log(JSON.stringify({
      appUrl: APP_URL,
      microphoneCapture,
      standaloneCapture,
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
