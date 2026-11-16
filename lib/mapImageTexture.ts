import * as THREE from 'three';

/**
 * Multi-source RGB image textures for the per-property Layer Maps
 * and the raster mask (Phase X).
 *
 * lib/gradImageTexture.ts caches exactly one image (the common
 * map); Phase X can need up to five different images at once
 * (size / opacity / colour / displacement / mask), each with its
 * own fallback to the common source, so this module keeps a small
 * cache keyed by the source string. Decode conventions mirror the
 * gradient image exactly — rows flipped so the image appears
 * upright when sampled with v = worldY, colours raw
 * (NoColorSpace) — so a per-property texture and the common texture
 * built from the same source sample identically.
 *
 * Until a texture is ready — no image set, still decoding, or a
 * decode failure — `ready` stays false and the shader keeps the
 * legacy path for that property (the UI states the fallback).
 */

export interface MapImageTextureState {
  texture: THREE.DataTexture | null;
  ready: boolean;
}

const NOT_READY: MapImageTextureState = { texture: null, ready: false };
const MAX_ENTRIES = 8;

interface MapImageEntry extends MapImageTextureState {
  source: string;
}

const entries = new Map<string, MapImageEntry>();

function evictOverflow(): void {
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entries.get(oldest)?.texture?.dispose();
    entries.delete(oldest);
  }
}

export function getMapImageTexture(source: string): MapImageTextureState {
  if (!source) return NOT_READY;
  const existing = entries.get(source);
  if (existing) return existing;
  const entry: MapImageEntry = { source, texture: null, ready: false };
  entries.set(source, entry);
  evictOverflow();
  if (typeof document === 'undefined') return entry;
  const img = new Image();
  img.onload = () => {
    if (entries.get(source) !== entry) return; // evicted while decoding
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
      // Decode failure: stay not-ready; the property keeps its
      // fallback and the config keeps the source for a later retry.
    }
  };
  img.onerror = () => {
    // Unreadable source: stay not-ready (explicit fallback, see UI).
  };
  img.src = source;
  return entry;
}
