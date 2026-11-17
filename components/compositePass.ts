// Composite pass (Phase AM): two-layer compositing in the
// post chain — the current frame (A) blended with a second
// layer (B) under one of eight blend modes, mixed toward the
// blend by uMix. B is an AF supply texture resolved by the
// host (AppScenePostFx) from the postCompositeSource key:
// 'text-raster' / 'path-raster' read the layer-2 AF maps,
// 'edge-output' reads the previous frame's edge-detect capture.
// With no B texture ready the pass is a bit-identical
// passthrough (uHasB 0), and the stage only exists in the
// stack while postCompositeEnabled is on. The blend math is
// the GLSL twin of lib/compositeBlend.ts.

import { Pass } from 'postprocessing';
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tLayer;
uniform float uHasB;
uniform float uMode;
uniform float uMix;
varying vec2 vUv;

vec3 blendMode(vec3 a, vec3 b, float mode) {
  int m = int(mode + 0.5);
  if (m == 1) return a * b;                                    // multiply
  if (m == 2) return 1.0 - (1.0 - a) * (1.0 - b);              // screen
  if (m == 3) {                                                // overlay
    return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
  }
  if (m == 4) return a + (2.0 * b - 1.0) * a * (1.0 - a);      // soft-light (Pegtop)
  if (m == 5) return abs(a - b);                               // difference
  if (m == 6) return min(a + b, 1.0);                          // add
  if (m == 7) return max(a - b, 0.0);                          // subtract
  return b;                                                    // normal
}

void main() {
  vec3 frame = texture2D(tDiffuse, vUv).rgb;
  if (uHasB < 0.5) {
    gl_FragColor = vec4(frame, 1.0);
    return;
  }
  vec3 layer = texture2D(tLayer, vUv).rgb;
  vec3 blended = blendMode(frame, layer, uMode);
  gl_FragColor = vec4(mix(frame, blended, clamp(uMix, 0.0, 1.0)), 1.0);
}
`;

export class CompositePass extends Pass {
  /** Second layer texture; null = passthrough. */
  sourceTexture: THREE.Texture | null = null;

  /** Blend mode index (lib/compositeBlend.ts list order). */
  modeIndex = 0;

  mixAmount = 1;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('CompositePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tLayer: { value: null },
        uHasB: { value: 0 },
        uMode: { value: 0 },
        uMix: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.material.uniforms.tLayer.value = this.sourceTexture;
    this.material.uniforms.uHasB.value = this.sourceTexture ? 1 : 0;
    this.material.uniforms.uMode.value = this.modeIndex;
    this.material.uniforms.uMix.value = this.mixAmount;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
