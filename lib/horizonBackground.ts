import * as THREE from 'three';
import type { ParticleConfig } from '../types';

/**
 * Horizon background (Phase I): Trapcode Horizon equivalents —
 * gradient and image backgrounds behind the particle scene.
 *
 * The background travels as a THREE.Texture in `scene.background`
 * (set by components/HorizonBackground.tsx). That placement is the
 * whole integration strategy: every existing background consumer
 * already speaks `scene.background` —
 *  - the EffectComposer renders it as part of the scene, so PostFx
 *    (Bloom, LightFX, output grade) applies over the finished
 *    background exactly as it does over the legacy solid colour;
 *  - the deterministic renderer's transparent mode nulls
 *    `scene.background` for its matte capture, and its UnMult mode
 *    forces it to black — so neither transparent path can ever
 *    double-print the Horizon background;
 *  - stream mode's transparent variant attaches no background at
 *    all, and its solid variants override the colour — Horizon is
 *    suppressed in both (see isHorizonSuppressed);
 *  - the still-capture manager keeps the texture for opaque shots
 *    and nulls it for transparent ones.
 * With backgroundMode 'solid' (the default) nothing here runs and
 * the rendered background is the legacy colour, byte for byte.
 *
 * Gradient textures are baked on a 512×512 canvas (linear at the
 * configured angle, or radial centre -> edge) and cached by their
 * full parameter key. Image textures decode the config's data URL
 * (downscaled by the UI) and are baked onto a canvas of the frame's
 * aspect with the cover / fit already applied, so the background
 * renderer's stretch lands them pixel-true.
 */

export type HorizonGradientPreset = {
  id: string;
  name: string;
  colorA: string;
  colorB: string;
  type: 'linear' | 'radial';
  angle: number;
  /** Tone the backgroundColor logic should follow while this preset
   *  is active (same convention as KINETIX_STAGE_BACKGROUNDS). */
  tone: 'black' | 'white';
};

/** Monochrome-first gradient presets (colour discipline: the
 *  Horizon defaults stay in the white/grey family; arbitrary colours
 *  remain available through the two colour pickers). */
export const HORIZON_GRADIENT_PRESETS: HorizonGradientPreset[] = [
  { id: 'obsidian-fade', name: 'Obsidian Fade', colorA: '#000000', colorB: '#232830', type: 'linear', angle: 90, tone: 'black' },
  { id: 'ash-fall', name: 'Ash Fall', colorA: '#2e333b', colorB: '#050607', type: 'linear', angle: 90, tone: 'black' },
  { id: 'paper-fade', name: 'Paper Fade', colorA: '#c9ced6', colorB: '#f4f5f7', type: 'linear', angle: 90, tone: 'white' },
  { id: 'mist-radial', name: 'Mist Radial', colorA: '#3a4048', colorB: '#000000', type: 'radial', angle: 90, tone: 'black' },
  { id: 'halo-radial', name: 'Halo Radial', colorA: '#e8eaee', colorB: '#565d66', type: 'radial', angle: 90, tone: 'white' },
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(value: string | undefined): boolean {
  return typeof value === 'string' && HEX6.test(value);
}

/**
 * Whether the Horizon background should actually be rendered for
 * this config in a normal (non-stream) view: gradient mode is always
 * active; image mode needs a source — without one the solid
 * background shows and the UI says so explicitly.
 */
export function isHorizonActive(config: ParticleConfig): boolean {
  if (config.backgroundMode === 'gradient') return true;
  if (config.backgroundMode === 'image') return Boolean(config.backgroundImageSource);
  return false;
}

/** Backgrounds never apply over a stream surface: the transparent
 *  variant must stay a clean matte and the solid variants key
 *  against their override colour. */
export function isHorizonSuppressed(transparentBackground: boolean, backgroundOverrideColor?: string): boolean {
  return transparentBackground || backgroundOverrideColor !== undefined;
}

// ---------------------------------------------------------------------------
// Gradient texture (baked, cached)

const GRADIENT_SIZE = 512;

interface GradientEntry {
  key: string;
  texture: THREE.CanvasTexture;
}

let gradientEntry: GradientEntry | null = null;

export function getHorizonGradientTexture(config: ParticleConfig): THREE.CanvasTexture {
  const colorA = isValidHex(config.backgroundGradientColorA) ? config.backgroundGradientColorA : '#000000';
  const colorB = isValidHex(config.backgroundGradientColorB) ? config.backgroundGradientColorB : '#232830';
  const type = config.backgroundGradientType === 'radial' ? 'radial' : 'linear';
  const angle = Number.isFinite(config.backgroundGradientAngle) ? config.backgroundGradientAngle : 90;
  const key = `${colorA}|${colorB}|${type}|${angle}`;
  if (gradientEntry && gradientEntry.key === key) return gradientEntry.texture;
  if (gradientEntry) gradientEntry.texture.dispose();

  const canvas = document.createElement('canvas');
  canvas.width = GRADIENT_SIZE;
  canvas.height = GRADIENT_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = GRADIENT_SIZE / 2;
    if (type === 'radial') {
      // Centre (A) -> edge (B); the radius reaches the corners so the
      // corners are fully B (the texture is stretched to the frame,
      // so on wide frames the radial reads as an ellipse — the usual
      // horizon-glow shape).
      const grad = ctx.createRadialGradient(half, half, 0, half, half, half * Math.SQRT2);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      ctx.fillStyle = grad;
    } else {
      // Angle in screen space (x right, y up): the gradient axis runs
      // from centre - dir to centre + dir, A at the start, B at the
      // end. Canvas y is flipped relative to screen y.
      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = -Math.sin(rad);
      const grad = ctx.createLinearGradient(half - dx * half, half - dy * half, half + dx * half, half + dy * half);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);
      ctx.fillStyle = grad;
    }
    ctx.fillRect(0, 0, GRADIENT_SIZE, GRADIENT_SIZE);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  gradientEntry = { key, texture };
  return texture;
}

// ---------------------------------------------------------------------------
// Image texture (decoded, cached by source string)

export interface HorizonImageTextureState {
  texture: THREE.CanvasTexture | null;
  ready: boolean;
}

const IMAGE_NOT_READY: HorizonImageTextureState = { texture: null, ready: false };

interface ImageEntry extends HorizonImageTextureState {
  key: string;
}

let imageEntry: ImageEntry | null = null;

function disposeImageEntry(): void {
  if (imageEntry?.texture) imageEntry.texture.dispose();
  imageEntry = null;
}

const IMAGE_BAKE_WIDTH = 1280;

/**
 * Decode the background image and bake it onto a canvas of the
 * frame's aspect: 'cover' draws it filling the frame (overflow
 * cropped), 'fit' draws it whole over the fallback colour
 * (letterbox). Baking the aspect in is what makes both fits exact —
 * a background texture is stretched to the frame, so a pre-fitted
 * canvas of the same aspect lands pixel-true. The frame aspect is
 * quantised to 0.01 in the cache key so window drags do not rebake
 * every pixel.
 */
export function getHorizonImageTexture(
  source: string,
  fit: 'cover' | 'fit',
  frameAspect: number,
  fallbackColor: string,
): HorizonImageTextureState {
  if (!source) {
    disposeImageEntry();
    return IMAGE_NOT_READY;
  }
  const safeAspect = frameAspect > 0 && Number.isFinite(frameAspect) ? Math.round(frameAspect * 100) / 100 : 1;
  const key = `${source}|${fit}|${safeAspect}|${fallbackColor}`;
  if (imageEntry && imageEntry.key === key) return imageEntry;
  disposeImageEntry();
  const entry: ImageEntry = { key, texture: null, ready: false };
  imageEntry = entry;
  if (typeof document === 'undefined') return entry;
  const img = new Image();
  img.onload = () => {
    if (imageEntry !== entry) return; // superseded while decoding
    try {
      const width = IMAGE_BAKE_WIDTH;
      const height = Math.max(1, Math.round(IMAGE_BAKE_WIDTH / safeAspect));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = fallbackColor;
      ctx.fillRect(0, 0, width, height);
      const imageAspect = (img.naturalWidth || img.width || 1) / Math.max(1, img.naturalHeight || img.height || 1);
      const frameAspectNow = width / height;
      let drawW = width;
      let drawH = height;
      if (fit === 'cover') {
        if (imageAspect > frameAspectNow) drawW = height * imageAspect;
        else drawH = width / imageAspect;
      } else {
        if (imageAspect > frameAspectNow) drawH = width / imageAspect;
        else drawW = height * imageAspect;
      }
      ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      entry.texture = tex;
      entry.ready = true;
    } catch {
      // Decode failure: stay not-ready; the solid background remains
      // and the config keeps the source, so a later edit can retry.
    }
  };
  img.onerror = () => {
    // Unreadable source: stay not-ready (solid fallback, UI states it).
  };
  img.src = source;
  return entry;
}

// ---------------------------------------------------------------------------
// Equirect image texture (Phase N, decoded, cached by source string)
//
// The 360° path deliberately does NOT bake the frame aspect: the
// source is decoded at its native size and handed to three.js with
// EquirectangularReflectionMapping, so scene.background renders it
// on the inside of the background sphere and the visible slice
// follows the camera. A 2:1 source maps cleanly; any other aspect
// is simply stretched over the sphere (never an error). Horizontal
// wrapping is Repeat so the seam at the back of the sphere joins —
// an equirect source whose left/right edges match shows no seam.

interface EquirectEntry extends HorizonImageTextureState {
  key: string;
}

let equirectEntry: EquirectEntry | null = null;

function disposeEquirectEntry(): void {
  if (equirectEntry?.texture) equirectEntry.texture.dispose();
  equirectEntry = null;
}

export function getHorizonEquirectTexture(source: string): HorizonImageTextureState {
  if (!source) {
    disposeEquirectEntry();
    return IMAGE_NOT_READY;
  }
  if (equirectEntry && equirectEntry.key === source) return equirectEntry;
  disposeEquirectEntry();
  const entry: EquirectEntry = { key: source, texture: null, ready: false };
  equirectEntry = entry;
  if (typeof document === 'undefined') return entry;
  const img = new Image();
  img.onload = () => {
    if (equirectEntry !== entry) return; // superseded while decoding
    try {
      const width = Math.max(1, img.naturalWidth || img.width || 1);
      const height = Math.max(1, img.naturalHeight || img.height || 1);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, width, height);
      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      entry.texture = tex;
      entry.ready = true;
    } catch {
      // Decode failure: stay not-ready; the solid background remains.
    }
  };
  img.onerror = () => {
    // Unreadable source: stay not-ready (solid fallback, UI states it).
  };
  img.src = source;
  return entry;
}

/** Yaw offset (degrees, config) -> scene.backgroundRotation.y
 *  (radians). Non-finite input falls back to 0. */
export function horizonEquirectYawRadians(yaw: number | undefined): number {
  const deg = Number.isFinite(yaw) ? (yaw as number) : 0;
  return (deg * Math.PI) / 180;
}
