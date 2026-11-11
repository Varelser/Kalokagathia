import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
// JSZip is loaded lazily inside startFrameExport (export-time only), so it
// stays out of the initial bundle.
import * as THREE from 'three';
import type { Notice } from './audioControllerTypes';

type UseFrameExportArgs = {
  handleStartSequencePlayback: () => void;
  presetSequenceLength: number;
  rendererRef: MutableRefObject<THREE.WebGLRenderer | null>;
  sequenceLoopEnabled: boolean;
  sequenceSinglePassDuration: number;
  setSequenceLoopEnabled: (value: boolean) => void;
  stopSequencePlayback: () => void;
  videoDurationSeconds: number;
  videoExportMode: 'current' | 'sequence';
  videoFps: number;
};

export function useFrameExport({
  handleStartSequencePlayback,
  presetSequenceLength,
  rendererRef,
  sequenceLoopEnabled,
  sequenceSinglePassDuration,
  setSequenceLoopEnabled,
  stopSequencePlayback,
  videoDurationSeconds,
  videoExportMode,
  videoFps,
}: UseFrameExportArgs) {
  const [frameNotice, setFrameNotice] = useState<Notice | null>(null);
  const [isFrameExporting, setIsFrameExporting] = useState(false);
  const recordingLoopRestoreRef = useRef<boolean | null>(null);
  const recordingModeRef = useRef<'current' | 'sequence'>('current');
  const frameExportAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const dismissFrameNotice = useCallback(() => {
    setFrameNotice(null);
  }, []);

  const showFrameNotice = useCallback((message: string) => {
    setFrameNotice({ tone: 'error', message });
  }, []);

  const stopFrameExport = useCallback(() => {
    frameExportAbortRef.current.cancelled = true;
    setIsFrameExporting(false);

    if (recordingModeRef.current === 'sequence') {
      stopSequencePlayback();
    }

    if (recordingLoopRestoreRef.current !== null) {
      setSequenceLoopEnabled(recordingLoopRestoreRef.current);
      recordingLoopRestoreRef.current = null;
    }
  }, [setSequenceLoopEnabled, stopSequencePlayback]);

  const startFrameExport = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer) {
      setFrameNotice({ tone: 'error', message: 'Renderer is not ready yet.' });
      return;
    }

    const canvas = renderer.domElement;
    const targetDuration = videoExportMode === 'sequence'
      ? sequenceSinglePassDuration
      : Math.max(0.5, videoDurationSeconds);

    if (targetDuration <= 0) {
      setFrameNotice({ tone: 'error', message: 'Set a valid frame export duration first.' });
      return;
    }

    if (videoExportMode === 'sequence' && presetSequenceLength === 0) {
      setFrameNotice({ tone: 'error', message: 'Add at least one sequence step before exporting PNG frames.' });
      return;
    }

    dismissFrameNotice();
    frameExportAbortRef.current = { cancelled: false };
    recordingModeRef.current = videoExportMode;
    recordingLoopRestoreRef.current = sequenceLoopEnabled;
    setIsFrameExporting(true);

    if (videoExportMode === 'sequence') {
      setSequenceLoopEnabled(false);
      handleStartSequencePlayback();
    }

    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const frameCount = Math.max(1, Math.round(targetDuration * Math.max(1, videoFps)));
      const frameDelay = 1000 / Math.max(1, videoFps);

      for (let index = 0; index < frameCount; index += 1) {
        if (frameExportAbortRef.current.cancelled) {
          setFrameNotice({ tone: 'success', message: `PNG frame export stopped at ${index} frames.` });
          return;
        }

        await new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Canvas PNG export failed'));
              return;
            }

            blob.arrayBuffer()
              .then((buffer) => {
                zip.file(`frame-${String(index + 1).padStart(4, '0')}.png`, buffer);
                resolve(buffer);
              })
              .catch(reject);
          }, 'image/png');
        });

        if (index < frameCount - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, frameDelay));
        }
      }

      const archive = await zip.generateAsync({
        type: 'blob',
        mimeType: 'application/zip',
        compression: 'STORE',
      });
      const url = window.URL.createObjectURL(archive);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `kalokagathia-${videoExportMode}-frames-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setFrameNotice({ tone: 'success', message: `PNG frame export complete: ${frameCount} frames.` });
    } catch (error) {
      console.error('PNG frame export failed:', error);
      setFrameNotice({ tone: 'error', message: 'PNG frame export failed.' });
    } finally {
      if (videoExportMode === 'sequence') {
        stopSequencePlayback();
      }
      if (recordingLoopRestoreRef.current !== null) {
        setSequenceLoopEnabled(recordingLoopRestoreRef.current);
        recordingLoopRestoreRef.current = null;
      }
      setIsFrameExporting(false);
    }
  }, [
    dismissFrameNotice,
    handleStartSequencePlayback,
    presetSequenceLength,
    rendererRef,
    sequenceLoopEnabled,
    sequenceSinglePassDuration,
    setSequenceLoopEnabled,
    stopSequencePlayback,
    videoDurationSeconds,
    videoExportMode,
    videoFps,
  ]);

  useEffect(() => () => {
    frameExportAbortRef.current.cancelled = true;
  }, []);

  return {
    dismissFrameNotice,
    frameNotice,
    isFrameExporting,
    showFrameNotice,
    startFrameExport,
    stopFrameExport,
  };
}
