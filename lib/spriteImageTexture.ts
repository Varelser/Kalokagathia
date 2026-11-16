import * as THREE from 'three';

/**
 * Sprite image for GPGPU point particles (Phase U): the user image
 * becomes the particle's "face". Following the product's monochrome
 * rule, only luminance is kept — the decode bakes
 * luma(rgb) * alpha into every channel of a DataTexture, and the
 * point shader multiplies the sprite alpha by the sampled value.
 *
 * The source travels inside the config as a data URL
 * (`gpgpuSpriteImage`, downscaled to <=256px by the UI), exactly
 * like the gradient image driver (`lib/gradImageTexture.ts`), whose
 * caching / row-flip conventions this module mirrors: rows are
 * flipped while copying so the image appears upright on the sprite
 * (texture v=1 is the image top). Until the texture is ready — no
 * image set, still decoding, or a decode failure — `ready` stays
 * false and the shader keeps the procedural point shapes; the UI
 * states the priority explicitly (no silent fallback).
 */

export interface SpriteImageTextureState {
  texture: THREE.DataTexture | null;
  ready: boolean;
}

const NOT_READY: SpriteImageTextureState = { texture: null, ready: false };

interface SpriteImageEntry extends SpriteImageTextureState {
  source: string;
}

let current: SpriteImageEntry | null = null;

function disposeCurrent(): void {
  if (current?.texture) current.texture.dispose();
  current = null;
}

export function getSpriteImageTexture(source: string): SpriteImageTextureState {
  if (!source) {
    disposeCurrent();
    return NOT_READY;
  }
  if (current && current.source === source) return current;
  disposeCurrent();
  const entry: SpriteImageEntry = { source, texture: null, ready: false };
  current = entry;
  if (typeof document === 'undefined') return entry;
  const img = new Image();
  img.onload = () => {
    if (current !== entry) return; // superseded while decoding
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth || img.width);
      canvas.height = Math.max(1, img.naturalHeight || img.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { width, height } = canvas;
      const imageData = ctx.getImageData(0, 0, width, height);
      const data = new Uint8Array(width * height * 4);
      const rowBytes = width * 4;
      for (let y = 0; y < height; y++) {
        const srcRow = height - 1 - y; // flip: image top lands at v=1
        const src = imageData.data.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes);
        const dstRow = y * rowBytes;
        for (let x = 0; x < width; x++) {
          const i = x * 4;
          const luma = (0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]) * (src[i + 3] / 255);
          data[dstRow + i] = luma;
          data[dstRow + i + 1] = luma;
          data[dstRow + i + 2] = luma;
          data[dstRow + i + 3] = 255;
        }
      }
      const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      entry.texture = tex;
      entry.ready = true;
    } catch {
      // Decode failure: stay not-ready; the procedural point shapes
      // continue and the config keeps the source for a later retry.
    }
  };
  img.onerror = () => {
    // Unreadable source: stay not-ready (explicit fallback, see UI).
  };
  img.src = source;
  return entry;
}
