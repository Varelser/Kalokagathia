import * as THREE from 'three';

/**
 * RGB colour map for the Kinetix Color 'image' gradient driver
 * (Phase A — the driver id 4 reserved in B2).
 *
 * The user image travels inside the config as a data URL
 * (`gpgpuGradImageSource`, downscaled to <=256px by the UI), so the
 * decode + GPU upload lives here, cached by the source string. The
 * GPGPU point shader samples this texture by particle position
 * (world XY mapped over the bounce sphere). Until the texture is
 * ready — no image set, still decoding, or a decode failure — the
 * shader falls back to the life LUT, and the UI states that
 * explicitly (no silent fallback).
 *
 * Rows are flipped while copying so the image appears upright when
 * sampled with v = worldY (canvas row 0 is the image top, texture
 * v=0 is the first uploaded row). Colours pass through raw
 * (NoColorSpace), exactly like the gradient LUT texture, so both
 * colour sources live in the same working space as uColor.
 */

export interface GradImageTextureState {
  texture: THREE.DataTexture | null;
  ready: boolean;
}

const NOT_READY: GradImageTextureState = { texture: null, ready: false };

interface GradImageEntry extends GradImageTextureState {
  source: string;
}

let current: GradImageEntry | null = null;

function disposeCurrent(): void {
  if (current?.texture) current.texture.dispose();
  current = null;
}

export function getGradImageTexture(source: string): GradImageTextureState {
  if (!source) {
    disposeCurrent();
    return NOT_READY;
  }
  if (current && current.source === source) return current;
  disposeCurrent();
  const entry: GradImageEntry = { source, texture: null, ready: false };
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
        data.set(imageData.data.subarray(srcRow * rowBytes, (srcRow + 1) * rowBytes), y * rowBytes);
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
      // Decode failure: stay not-ready; the life fallback continues
      // and the config keeps the source, so a later edit can retry.
    }
  };
  img.onerror = () => {
    // Unreadable source: stay not-ready (explicit life fallback).
  };
  img.src = source;
  return entry;
}
