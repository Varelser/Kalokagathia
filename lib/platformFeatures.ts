// Platform / convenience features (2026-11-13 tech batch).
//
// Every helper here is feature-detected: on a browser without the API the
// helper is a silent no-op (or reports "unsupported" so the caller can hide
// its control). Nothing in this file may throw into React render paths.
//
// Covered: persistent-storage request, File System Access save with an
// anchor-download fallback, fullscreen toggling, and a Document
// Picture-in-Picture mirror of the WebGL canvas. The mirror only READS the
// source canvas (captureStream, or drawImage as a fallback) — the renderer
// is never touched.

type SaveFilePickerOptionsLike = {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
};

type FileSystemFileHandleLike = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
};

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsLike) => Promise<FileSystemFileHandleLike>;
};

export function isSaveFilePickerSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (window as WindowWithSavePicker).showSaveFilePicker === 'function';
}

export function isPngClipboardSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof ClipboardItem !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.clipboard
    && typeof navigator.clipboard.write === 'function';
}

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

type DocumentPictureInPictureLike = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

type WindowWithDocumentPip = Window & {
  documentPictureInPicture?: DocumentPictureInPictureLike;
};

export function getDocumentPictureInPicture(): DocumentPictureInPictureLike | null {
  if (typeof window === 'undefined') return null;
  const pip = (window as WindowWithDocumentPip).documentPictureInPicture;
  return pip && typeof pip.requestWindow === 'function' ? pip : null;
}

export function isDocumentPipSupported(): boolean {
  return getDocumentPictureInPicture() !== null;
}

/**
 * Save a blob through the File System Access picker when available
 * (Chrome/Edge desktop), otherwise through the classic anchor download.
 * Returns 'picker' when the picker completed, 'cancelled' when the user
 * dismissed it, and 'download' when the fallback path ran.
 */
export async function saveBlobFile(
  blob: Blob,
  suggestedName: string,
  options?: { description?: string; accept?: Record<string, string[]> },
): Promise<'picker' | 'download' | 'cancelled'> {
  const picker = typeof window !== 'undefined'
    ? (window as WindowWithSavePicker).showSaveFilePicker
    : undefined;
  if (typeof picker === 'function') {
    const dot = suggestedName.lastIndexOf('.');
    const ext = dot > 0 ? suggestedName.slice(dot) : '';
    try {
      const handle = await picker.call(window, {
        suggestedName,
        types: [{
          description: options?.description ?? 'File',
          accept: options?.accept ?? { [blob.type || 'application/octet-stream']: ext ? [ext] : [] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (error) {
      if ((error as DOMException | null)?.name === 'AbortError') return 'cancelled';
      // Any other picker failure falls through to the download path.
    }
  }
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 4000);
  return 'download';
}

let persistRequested = false;

/** Ask the browser to keep this origin's storage (IndexedDB) persistent. */
export function requestPersistentStorageOnce(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    const storage = navigator.storage as StorageManager & {
      persisted?: () => Promise<boolean>;
      persist?: () => Promise<boolean>;
    };
    if (!storage || typeof storage.persist !== 'function' || typeof storage.persisted !== 'function') return;
    storage.persisted()
      .then((already) => (already ? true : storage.persist!()))
      .then((granted) => {
        console.info(`[kalokagathia] storage.persist → ${granted ? 'persistent' : 'best-effort'}`);
      })
      .catch(() => { /* storage API unavailable: stay silent */ });
  } catch {
    /* storage API unavailable: stay silent */
  }
}

export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => { /* not allowed here */ });
    } else if (typeof document.documentElement.requestFullscreen === 'function') {
      void document.documentElement.requestFullscreen().catch(() => { /* not allowed here */ });
    }
  } catch {
    /* fullscreen unavailable: silent no-op */
  }
}

/**
 * Open a Document Picture-in-Picture window mirroring the given canvas.
 * Primary path: captureStream() into a <video> (works regardless of
 * preserveDrawingBuffer). Fallback: a 2D canvas repainted from the source
 * on every animation frame (the same rAF drawImage trick the deck's gloss
 * sampler already relies on). Calls onClose when the PiP window closes.
 * Returns false when Document PiP is unsupported or the open failed.
 */
export async function openCanvasPictureInPicture(
  source: HTMLCanvasElement,
  onClose: () => void,
): Promise<boolean> {
  const pip = getDocumentPictureInPicture();
  if (!pip) return false;
  try {
    if (pip.window) {
      pip.window.close();
      return true;
    }
    const pipWindow = await pip.requestWindow({ width: 520, height: 380 });
    const doc = pipWindow.document;
    doc.title = 'Kalokagathia — Mini View';
    const style = doc.createElement('style');
    style.textContent = 'html,body{margin:0;height:100%;background:#000;overflow:hidden}'
      + 'video,canvas{display:block;width:100%;height:100%;object-fit:contain}';
    doc.head.appendChild(style);

    let stopMirror: (() => void) | null = null;
    const captureStream = (source as HTMLCanvasElement & {
      captureStream?: (fps?: number) => MediaStream;
    }).captureStream;
    if (typeof captureStream === 'function') {
      const video = doc.createElement('video');
      video.muted = true;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = captureStream.call(source, 30);
      doc.body.appendChild(video);
      void video.play().catch(() => { /* autoplay nudge only */ });
    } else {
      const mirror = doc.createElement('canvas');
      mirror.width = source.width || 640;
      mirror.height = source.height || 360;
      doc.body.appendChild(mirror);
      const ctx = mirror.getContext('2d');
      let raf = 0;
      let stopped = false;
      const draw = () => {
        if (stopped) return;
        try {
          if (ctx && source.width > 0) {
            if (mirror.width !== source.width || mirror.height !== source.height) {
              mirror.width = source.width;
              mirror.height = source.height;
            }
            ctx.drawImage(source, 0, 0);
          }
        } catch {
          /* source gone: keep the last frame */
        }
        raf = pipWindow.requestAnimationFrame(draw);
      };
      draw();
      stopMirror = () => {
        stopped = true;
        pipWindow.cancelAnimationFrame(raf);
      };
    }
    pipWindow.addEventListener('pagehide', () => {
      stopMirror?.();
      onClose();
    }, { once: true });
    return true;
  } catch {
    return false;
  }
}
