import React, { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';

export const ScreenshotManager: React.FC<{ config: ParticleConfig; saveTrigger: number }> = ({ config, saveTrigger }) => {
  const { gl, scene, camera } = useThree();
  const prevTrigger = useRef(0);

  useEffect(() => {
    if (saveTrigger === 0 || saveTrigger === prevTrigger.current) return;
    prevTrigger.current = saveTrigger;

    const originalSize = new THREE.Vector2();
    gl.getSize(originalSize);
    const originalPixelRatio = gl.getPixelRatio();
    gl.setPixelRatio(1);
    gl.setSize(originalSize.x * config.exportScale, originalSize.y * config.exportScale, false);

    const prevClearColor = new THREE.Color();
    gl.getClearColor(prevClearColor);
    const prevClearAlpha = gl.getClearAlpha();
    const prevSceneBackground = scene.background;
    const prevAutoClear = gl.autoClear;

    if (config.exportTransparent) {
      scene.background = null;
      gl.setClearColor(0x000000, 0);
    } else {
      const bgColor = new THREE.Color(config.backgroundColor);
      scene.background = bgColor;
      gl.setClearColor(bgColor, 1);
    }

    gl.autoClear = true;
    camera.updateMatrixWorld();
    gl.clear(true, true, true);
    gl.render(scene, camera);

    const dataURL = gl.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `kalokagathia_${Date.now()}.png`;
    link.href = dataURL;
    link.click();

    gl.setPixelRatio(originalPixelRatio);
    gl.setSize(originalSize.x, originalSize.y, false);
    gl.setClearColor(prevClearColor, prevClearAlpha);
    scene.background = prevSceneBackground;
    gl.autoClear = prevAutoClear;
    gl.render(scene, camera);
  }, [saveTrigger, config, gl, scene, camera]);

  return null;
};
