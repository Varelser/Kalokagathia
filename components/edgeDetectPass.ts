// Edge Detect pass (Phase AD): a Sobel gradient pass over the
// finished frame — the entry point to outline extraction
// (vectorising the contours is Phase AF's territory, not this
// pass). The kernel weights mirror sobelMagnitude in
// lib/postFxMath.ts. Two modes: 'overlay' draws the edges in
// white over the source frame (per-channel max, so lines never
// darken the image), 'only' shows the edge field alone on
// black. Pure function of the current frame: identical at any
// resolution, in the deterministic render and in exports.

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
uniform vec2 uTexelSize;
uniform float uThreshold;
uniform float uModeOnly;
varying vec2 vUv;

float lumaAt(vec2 uv) {
  vec3 c = texture2D(tDiffuse, clamp(uv, 0.001, 0.999)).rgb;
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 t = uTexelSize;
  float n0 = lumaAt(vUv + vec2(-t.x, -t.y));
  float n1 = lumaAt(vUv + vec2(0.0, -t.y));
  float n2 = lumaAt(vUv + vec2(t.x, -t.y));
  float n3 = lumaAt(vUv + vec2(-t.x, 0.0));
  float n5 = lumaAt(vUv + vec2(t.x, 0.0));
  float n6 = lumaAt(vUv + vec2(-t.x, t.y));
  float n7 = lumaAt(vUv + vec2(0.0, t.y));
  float n8 = lumaAt(vUv + vec2(t.x, t.y));
  float gx = -n0 - 2.0 * n3 - n6 + n2 + 2.0 * n5 + n8;
  float gy = -n0 - 2.0 * n1 - n2 + n6 + 2.0 * n7 + n8;
  float mag = length(vec2(gx, gy)) / 4.0;
  float e = smoothstep(uThreshold, uThreshold + 0.08, mag);
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 only = vec3(e);
  vec3 over = max(src.rgb, vec3(e));
  gl_FragColor = vec4(mix(over, only, uModeOnly), src.a);
}
`;

export class EdgeDetectPass extends Pass {
  threshold = 0.12;
  mode: 'overlay' | 'only' = 'overlay';

  private material: THREE.ShaderMaterial;
  private width = 1;
  private height = 1;

  constructor() {
    super('EdgeDetectPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: this.threshold },
        uModeOnly: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.material;
    this.needsSwap = true;
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
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    const w = tex.image?.width ?? this.width;
    const h = tex.image?.height ?? this.height;
    (this.material.uniforms.uTexelSize.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    this.material.uniforms.uThreshold.value = this.threshold;
    this.material.uniforms.uModeOnly.value = this.mode === 'only' ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
