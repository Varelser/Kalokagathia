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
  for (let i = 0; i < left.data.length; i++) {
    if (Math.abs(left.data[i] - right.data[i]) > 6) changedChannels += 1;
  }

  return changedChannels / left.data.length;
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

const main = async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(() => {
      window.__sharedAudioGain = 0;
      window.__setSharedAudioLevel = (nextGain) => {
        window.__sharedAudioGain = nextGain;
        if (window.__sharedAudioGainNode && window.__sharedAudioContext) {
          window.__sharedAudioGainNode.gain.setValueAtTime(nextGain, window.__sharedAudioContext.currentTime);
        }
      };

      window.__MONOSPHERE_FAKE_SHARED_STREAM_FACTORY__ = () => {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        const audioContext = new AudioCtor();
        const destination = audioContext.createMediaStreamDestination();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = '#fff';
          ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
        }

        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 180;
        gainNode.gain.value = window.__sharedAudioGain;
        oscillator.connect(gainNode);
        gainNode.connect(destination);
        oscillator.start();
        audioContext.resume();

        window.__sharedAudioContext = audioContext;
        window.__sharedAudioGainNode = gainNode;

        const videoStream = canvas.captureStream(12);
        return new MediaStream([
          ...videoStream.getVideoTracks(),
          ...destination.stream.getAudioTracks(),
        ]);
      };
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

    await page.evaluate(() => {
      const sharedButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Shared Tab / System'));
      if (!(sharedButton instanceof HTMLButtonElement)) {
        throw new Error('Shared audio mode toggle not found');
      }
      sharedButton.click();
    });

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Start Shared Audio')),
      { timeout: 30000 }
    );

    await setRangeValue(page, 'Analysis Sensitivity', 5);
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
      const startButton = Array.from(document.querySelectorAll('button')).find((node) => node.textContent?.includes('Start Shared Audio'));
      if (!(startButton instanceof HTMLButtonElement)) {
        throw new Error('Start Shared Audio button not found');
      }
      startButton.click();
    });

    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('button')).some((node) => node.textContent?.includes('Shared Audio Active')),
      { timeout: 30000 }
    );

    await page.waitForFunction(
      () => document.body.textContent?.includes('Shared audio connected.'),
      { timeout: 30000 }
    );

    await page.evaluate(() => window.__setSharedAudioLevel(0));
    await page.waitForTimeout(500);
    const silentDataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));

    await page.evaluate(() => window.__setSharedAudioLevel(0.35));
    await page.waitForTimeout(1200);
    const activeDataUrl = await page.evaluate(() => document.querySelector('canvas')?.toDataURL('image/png'));

    if (typeof silentDataUrl !== 'string' || typeof activeDataUrl !== 'string') {
      throw new Error('Canvas export failed during shared audio verification');
    }

    const ratio = diffRatio(decodeDataUrl(silentDataUrl), decodeDataUrl(activeDataUrl));
    const passed = ratio > 0.0025;

    console.log(JSON.stringify({
      appUrl: APP_URL,
      mode: 'shared-audio',
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
