// Clean output window: opens a separate browser window that shows ONLY
// the rendered canvas — no panels, no chrome — for projectors and stage
// sends. The popup mirrors the live main canvas through
// HTMLCanvasElement.captureStream, so it follows every change in the
// control window with no second render pass and no state sync. The user
// drags the popup to the target display and clicks the video (or presses
// the fullscreen affordance) to fill it. Audio is not mirrored (the app
// is a visual instrument; audio-reactive inputs stay in the main window).

export type CleanOutputStatus =
  | { state: 'closed' }
  | { state: 'open' }
  | { state: 'blocked' }
  | { state: 'no-canvas' };

let outputWindow: Window | null = null;
let outputStream: MediaStream | null = null;

export function isCleanOutputOpen(): boolean {
  return outputWindow !== null && !outputWindow.closed;
}

export function closeCleanOutput(): void {
  if (outputWindow && !outputWindow.closed) {
    outputWindow.close();
  }
  outputWindow = null;
  outputStream?.getTracks().forEach((track) => track.stop());
  outputStream = null;
}

export function openCleanOutput(): CleanOutputStatus {
  if (isCleanOutputOpen() && outputWindow) {
    outputWindow.focus();
    return { state: 'open' };
  }
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    return { state: 'no-canvas' };
  }
  const popup = window.open('', 'monosphere-clean-output', 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
  if (!popup) {
    return { state: 'blocked' };
  }
  outputWindow = popup;

  const doc = popup.document;
  doc.title = 'Monosphere — Clean Output';
  doc.body.style.margin = '0';
  doc.body.style.background = '#000';
  doc.body.style.overflow = 'hidden';
  doc.body.style.cursor = 'none';

  const video = doc.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.width = '100vw';
  video.style.height = '100vh';
  video.style.objectFit = 'contain';
  video.style.background = '#000';
  video.style.display = 'block';
  doc.body.appendChild(video);

  outputStream?.getTracks().forEach((track) => track.stop());
  outputStream = canvas.captureStream(60);
  video.srcObject = outputStream;
  void video.play().catch(() => undefined);

  video.addEventListener('click', () => {
    if (doc.fullscreenElement) {
      void doc.exitFullscreen().catch(() => undefined);
    } else {
      void doc.documentElement.requestFullscreen().catch(() => undefined);
    }
  });
  popup.addEventListener('beforeunload', () => {
    if (outputWindow === popup) {
      outputWindow = null;
    }
    outputStream?.getTracks().forEach((track) => track.stop());
    outputStream = null;
  });
  return { state: 'open' };
}
