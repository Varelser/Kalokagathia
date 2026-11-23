// Tone grade passes (Phase AD): Posterize, Ordered Dither and
// Halftone as standalone post stages, in the same shape as
// radialBlurPass.ts. The shader math mirrors lib/postFxMath.ts
// expression-for-expression (the CPU twins the unit tests pin):
// posterizeValue, ditherValue / BAYER_4X4, halftoneDot. All
// three are pure functions of the current frame (plus pixel
// position for dither / halftone), so they behave identically
// at any resolution, in the deterministic render and in exports.
// Monochrome by construction: they reshape the frame's own
// tonal values and never introduce colour.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

abstract class TonePass extends Pass {
  protected material: THREE.ShaderMaterial;

  protected constructor(name: string, frag: string, uniforms: Record<string, THREE.IUniform>) {
    super(name);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms: { tDiffuse: { value: null }, ...uniforms },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
  }

  protected syncUniforms(): void {}

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.syncUniforms();
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}

const POSTERIZE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uLevels;
varying vec2 vUv;

float posterizeChannel(float c) {
  return min(1.0, floor(clamp(c, 0.0, 1.0) * uLevels) / max(uLevels - 1.0, 1.0));
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(
    posterizeChannel(src.r),
    posterizeChannel(src.g),
    posterizeChannel(src.b),
    src.a
  );
}
`;

export class PosterizePass extends TonePass {
  levels = 8;

  constructor() {
    super('PosterizePass', POSTERIZE_FRAG, { uLevels: { value: 8 } });
  }

  protected override syncUniforms(): void {
    this.material.uniforms.uLevels.value = this.levels;
  }
}

const DITHER_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uStrength;
uniform float uMode;
uniform vec2 uResolution;
uniform float uAnchorMode;
uniform vec2 uAnchorOffset;
varying vec2 vUv;

// Bayer 4x4 (lib/postFxMath.ts BAYER_4X4), threshold in [0, 1).
float bayerThreshold(vec2 p) {
  int ix = int(mod(p.x, 4.0));
  int iy = int(mod(p.y, 4.0));
  int idx = iy * 4 + ix;
  float v = 0.0;
  if (idx == 0) v = 0.0; else if (idx == 1) v = 8.0;
  else if (idx == 2) v = 2.0; else if (idx == 3) v = 10.0;
  else if (idx == 4) v = 12.0; else if (idx == 5) v = 4.0;
  else if (idx == 6) v = 14.0; else if (idx == 7) v = 6.0;
  else if (idx == 8) v = 3.0; else if (idx == 9) v = 11.0;
  else if (idx == 10) v = 1.0; else if (idx == 11) v = 9.0;
  else if (idx == 12) v = 15.0; else if (idx == 13) v = 7.0;
  else if (idx == 14) v = 13.0; else v = 5.0;
  return (v + 0.5) / 16.0;
}

float ditherChannel(float c, float t) {
  return clamp(floor(clamp(c, 0.0, 1.0) * 7.0 + 0.5 + (t - 0.5) * uStrength) / 7.0, 0.0, 1.0);
}

// Error-diffusion approximation (Phase AW; mirror of
// errorDiffusionValue in lib/postFxMath.ts). A fragment shader
// cannot run the sequential Floyd–Steinberg scan, so the
// incoming error is estimated one tap deep from the
// already-scanned neighbours' quantization errors (scan runs
// top-to-bottom in texture space: neighbours at left and the
// row above), weighted by the FS kernel 7/3/5/1 sixteenths.
float quantError(float c) {
  float v = clamp(c, 0.0, 1.0);
  return v - floor(v * 7.0 + 0.5) / 7.0;
}

float sampleChannel(vec2 px, int ch) {
  vec3 c = texture2D(tDiffuse, clamp(px / uResolution, 0.001, 0.999)).rgb;
  return ch == 0 ? c.r : (ch == 1 ? c.g : c.b);
}

float diffusionChannel(float c, vec2 p, int ch) {
  float est = 0.0;
  est += 0.4375 * quantError(sampleChannel(p + vec2(-1.0, 1.0), ch));
  est += 0.1875 * quantError(sampleChannel(p + vec2(-1.0, 0.0), ch));
  est += 0.3125 * quantError(sampleChannel(p + vec2(0.0, 1.0), ch));
  est += 0.0625 * quantError(sampleChannel(p + vec2(1.0, 1.0), ch));
  float v = clamp(c, 0.0, 1.0) + est * uStrength;
  return clamp(floor(v * 7.0 + 0.5) / 7.0, 0.0, 1.0);
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  if (uMode > 0.5) {
    vec2 p = gl_FragCoord.xy;
    gl_FragColor = vec4(
      diffusionChannel(src.r, p, 0),
      diffusionChannel(src.g, p, 1),
      diffusionChannel(src.b, p, 2),
      src.a
    );
    return;
  }
  // World anchor (Phase 15, ink): offset the pattern coordinates
  // by the world origin's projected position (host-supplied), so
  // the Bayer phase is fixed on the subject instead of the
  // screen. uAnchorMode 0 keeps the legacy screen-fixed pattern
  // bit-identically (the offset is not applied).
  vec2 patternPx = gl_FragCoord.xy;
  if (uAnchorMode > 0.5) patternPx += uAnchorOffset;
  float t = bayerThreshold(patternPx);
  gl_FragColor = vec4(
    ditherChannel(src.r, t),
    ditherChannel(src.g, t),
    ditherChannel(src.b, t),
    src.a
  );
}
`;

export class OrderedDitherPass extends TonePass {
  strength = 1;
  mode: 'bayer' | 'diffusion' = 'bayer';

  /** World anchor (Phase 15): 'screen' is the legacy pattern. */
  anchor: 'screen' | 'world' = 'screen';

  /** Host-wired: the live camera, for the origin projection. */
  viewCamera: THREE.Camera | null = null;

  private width = 1;
  private height = 1;

  private anchorScratch = new THREE.Vector3();

  constructor() {
    super('OrderedDitherPass', DITHER_FRAG, {
      uStrength: { value: 1 },
      uMode: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uAnchorMode: { value: 0 },
      uAnchorOffset: { value: new THREE.Vector2(0, 0) },
    });
  }

  override setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    if (tex.image?.width) this.width = tex.image.width;
    if (tex.image?.height) this.height = tex.image.height;
    // World anchor: project the world origin with the current
    // camera (its matrices are fresh — the composer's scene
    // render already ran this frame) and offset the pattern by
    // the negative projected position, pinning the pattern phase
    // to the origin. Behind the camera (z > 1 in NDC) the anchor
    // falls back to the screen pattern for this frame.
    if (this.anchor === 'world' && this.viewCamera) {
      const p = this.anchorScratch.set(0, 0, 0).project(this.viewCamera);
      if (p.z < 1) {
        this.anchorOffset.set(
          -((p.x * 0.5 + 0.5) * this.width),
          -((p.y * 0.5 + 0.5) * this.height),
        );
        this.anchorActive = true;
      } else {
        this.anchorActive = false;
      }
    } else {
      this.anchorActive = false;
    }
    super.render(renderer, inputBuffer, outputBuffer);
  }

  private anchorOffset = new THREE.Vector2(0, 0);

  private anchorActive = false;

  protected override syncUniforms(): void {
    this.material.uniforms.uStrength.value = this.strength;
    this.material.uniforms.uMode.value = this.mode === 'diffusion' ? 1 : 0;
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(this.width, this.height);
    this.material.uniforms.uAnchorMode.value = this.anchorActive ? 1 : 0;
    (this.material.uniforms.uAnchorOffset.value as THREE.Vector2).copy(this.anchorOffset);
  }
}

const HALFTONE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uCellSize;
uniform float uAngle;
uniform vec2 uResolution;
varying vec2 vUv;

// Mirror of halftoneDot in lib/postFxMath.ts.
float halftoneDot(float luma, vec2 p, float ca, float sa) {
  vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  vec2 cell = (floor(rp / uCellSize) + 0.5) * uCellSize;
  float dist = length(rp - cell);
  float radius = clamp(luma, 0.0, 1.0) * uCellSize * 0.7071067811865476;
  float t = clamp((radius + 0.75 - dist) / 1.5, 0.0, 1.0);
  float dot = t * t * (3.0 - 2.0 * t);
  // Sub-pixel dots fade out with radius (see lib/postFxMath.ts):
  // otherwise pure black would grow faint half-lit centres.
  return dot * clamp(radius * 2.0, 0.0, 1.0);
}

float lumaAtPx(vec2 px) {
  vec3 c = texture2D(tDiffuse, clamp(px / uResolution, 0.001, 0.999)).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// A halftone screen sizes ONE dot per cell from the cell's tone,
// so the tone is sampled at the cell (centre + 4 taps at
// +-0.25 cell along the screen axes, un-rotated back to frame
// pixels) — feeding per-pixel luma instead would let sparse
// content (single particles) draw its own shape rather than a
// dot on the lattice.
float cellLuma(vec2 p, float ca, float sa) {
  vec2 rp = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  vec2 cell = (floor(rp / uCellSize) + 0.5) * uCellSize;
  float q = uCellSize * 0.25;
  float sum = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      if (i != 0 && j != 0) continue;
      vec2 sp = cell + vec2(float(i) * q, float(j) * q);
      vec2 px = vec2(sp.x * ca + sp.y * sa, -sp.x * sa + sp.y * ca);
      sum += lumaAtPx(px);
    }
  }
  return sum / 5.0;
}

void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  float angle = uAngle * 3.141592653589793 / 180.0;
  float ca = cos(angle);
  float sa = sin(angle);
  float luma = cellLuma(gl_FragCoord.xy, ca, sa);
  float dotMask = halftoneDot(luma, gl_FragCoord.xy, ca, sa);
  float v = dotMask * (0.2 + 0.8 * luma);
  gl_FragColor = vec4(vec3(v), src.a);
}
`;

export class HalftonePass extends TonePass {
  cellSize = 8;
  angle = 45;

  private width = 1;
  private height = 1;

  constructor() {
    super('HalftonePass', HALFTONE_FRAG, {
      uCellSize: { value: 8 },
      uAngle: { value: 45 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    });
  }

  override setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    // Prefer the actual input size over the composer's setSize
    // bookkeeping (same approach as edgeDetectPass).
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    if (tex.image?.width) this.width = tex.image.width;
    if (tex.image?.height) this.height = tex.image.height;
    super.render(renderer, inputBuffer, outputBuffer);
  }

  protected override syncUniforms(): void {
    this.material.uniforms.uCellSize.value = this.cellSize;
    this.material.uniforms.uAngle.value = this.angle;
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(this.width, this.height);
  }
}

