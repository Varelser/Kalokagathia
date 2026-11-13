import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { isPngClipboardSupported, saveBlobFile } from '../lib/platformFeatures';

export const ScreenshotManager: React.FC<{ config: ParticleConfig; saveTrigger: number }> = ({ config, saveTrigger }) => {
  const { gl, scene, camera } = useThree();
  const prevTrigger = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  // Render the scene once at export resolution and snapshot it into a 2D
  // canvas. The snapshot must happen synchronously in the same task as the
  // render: the WebGL drawing buffer (preserveDrawingBuffer=false) is only
  // guaranteed to hold the frame until compositing. Renderer state is fully
  // restored afterwards and a normal frame is re-rendered.
  const captureFrame = React.useCallback((): HTMLCanvasElement | null => {
    const cfg = configRef.current;
    const originalSize = new THREE.Vector2();
    gl.getSize(originalSize);
    const originalPixelRatio = gl.getPixelRatio();
    gl.setPixelRatio(1);
    gl.setSize(originalSize.x * cfg.exportScale, originalSize.y * cfg.exportScale, false);

    const prevClearColor = new THREE.Color();
    gl.getClearColor(prevClearColor);
    const prevClearAlpha = gl.getClearAlpha();
    const prevSceneBackground = scene.background;
    const prevAutoClear = gl.autoClear;

    if (cfg.exportTransparent) {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
    } else {
      const bgColor = new THREE.Color(cfg.backgroundColor);
      scene.background = bgColor;
      gl.setClearColor(bgColor, 1);
    }

    gl.autoClear = true;
    camera.updateMatrixWorld();
    gl.clear(true, true, true);
    gl.render(scene, camera);

    let snapshot: HTMLCanvasElement | null = null;
    try {
      const copy = document.createElement('canvas');
      copy.width = gl.domElement.width;
      copy.height = gl.domElement.height;
      const ctx = copy.getContext('2d');
      if (ctx) {
        ctx.drawImage(gl.domElement, 0, 0);
        snapshot = copy;
      }
    } catch {
      snapshot = null;
    }

    gl.setPixelRatio(originalPixelRatio);
    gl.setSize(originalSize.x, originalSize.y, false);
    gl.setClearColor(prevClearColor, prevClearAlpha);
    scene.background = prevSceneBackground;
    gl.autoClear = prevAutoClear;
    gl.render(scene, camera);
    return snapshot;
  }, [gl, scene, camera]);

  useEffect(() => {
    if (saveTrigger === 0 || saveTrigger === prevTrigger.current) return;
    prevTrigger.current = saveTrigger;

    const snapshot = captureFrame();
    const filename = `kalokagathia_${Date.now()}.png`;
    if (snapshot) {
      snapshot.toBlob((blob) => {
        if (!blob) return;
        // File System Access picker where available; anchor download else.
        void saveBlobFile(blob, filename, {
          description: 'PNG image',
          accept: { 'image/png': ['.png'] },
        });
      }, 'image/png');
      return;
    }
    // 2D snapshot unavailable (exotic browser): keep the original path.
    const dataURL = gl.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataURL;
    link.click();
  }, [saveTrigger, captureFrame, gl]);

  // Copy PNG (tech batch): the deck footer dispatches this event; the
  // clipboard outcome is reported back so the footer can show a note.
  useEffect(() => {
    if (!isPngClipboardSupported()) return undefined;
    const onCopyRequest = () => {
      const report = (ok: boolean) => {
        window.dispatchEvent(new CustomEvent('kalokagathia:copy-png-result', { detail: { ok } }));
      };
      const snapshot = captureFrame();
      if (!snapshot) {
        report(false);
        return;
      }
      snapshot.toBlob((blob) => {
        if (!blob) {
          report(false);
          return;
        }
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(() => report(true))
          .catch(() => report(false));
      }, 'image/png');
    };
    window.addEventListener('kalokagathia:copy-png', onCopyRequest);
    return () => window.removeEventListener('kalokagathia:copy-png', onCopyRequest);
  }, [captureFrame]);

  return null;
};
