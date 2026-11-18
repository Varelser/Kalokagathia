// Edge Capture pass (Phase AF): the supply side of the Phase AD
// edge pass. Where EdgeDetectPass draws the Sobel field INTO the
// frame, this pass copies the finished frame's edge field into a
// persistent render target and registers it as the `edge-output`
// map source (lib/mapSourceSupply.ts), so the Layer Maps, the
// raster / kill mask and the feedback mask can sample the
// contours. It is a pass-through — the frame leaves bit-identical
// to how it entered — so supply and display are independent: the
// display edge pass need not be on, and supplying edges never
// changes the picture. Consumers sample the previous frame's
// field (the capture is written during post, after the scene has
// drawn), a one-frame lag stated wherever the source is offered.
// The kernel and threshold convention mirror EdgeDetectPass /
// lib/postFxMath.ts sobelMagnitude exactly; the capture always
// stores the 'only' field (white contours on black).
// Registration timing (Phase BR): the capture texture is
// registered only after the first captured frame completes, so
// consumers see the source as ready only once a real previous
// frame exists. Registering the still-empty target up front
// made an 'edge-output' clip mask discard every particle from
// frame 1 — the finished frame then stayed black and the
// capture never acquired edges (a self-sealing deadlock).

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import { registerEdgeCaptureTexture } from '../lib/mapSourceSupply';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const SOBEL_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexelSize;
uniform float uThreshold;
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
  gl_FragColor = vec4(vec3(e), 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

export class EdgeCapturePass extends Pass {
  threshold = 0.12;

  private captureTarget: THREE.WebGLRenderTarget;

  private sobelMaterial: THREE.ShaderMaterial;

  private copyMaterial: THREE.ShaderMaterial;

  /** True once the capture target has been registered as the
   *  edge supply — set after the first captured frame (Phase
   *  BR), never in the constructor. */
  private captureRegistered = false;

  constructor() {
    super('EdgeCapturePass');
    this.captureTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.sobelMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SOBEL_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uTexelSize: { value: new THREE.Vector2(1, 1) },
        uThreshold: { value: this.threshold },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.copyMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      uniforms: { tDiffuse: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    this.needsSwap = true;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    // 1. Capture the edge field of the finished frame.
    const tex = inputBuffer.texture as THREE.Texture & { image?: { width?: number; height?: number } };
    const w = tex.image?.width ?? this.captureTarget.width;
    const h = tex.image?.height ?? this.captureTarget.height;
    (this.sobelMaterial.uniforms.uTexelSize.value as THREE.Vector2).set(1 / Math.max(1, w), 1 / Math.max(1, h));
    this.sobelMaterial.uniforms.uThreshold.value = this.threshold;
    this.sobelMaterial.uniforms.tDiffuse.value = inputBuffer.texture;
    this.fullscreenMaterial = this.sobelMaterial;
    renderer.setRenderTarget(this.captureTarget);
    renderer.render(this.scene, this.camera);
    // The target now holds a real frame's edge field: publish
    // it as the edge supply (Phase BR — before this capture the
    // source must read as not ready, never as an empty black
    // texture).
    if (!this.captureRegistered) {
      registerEdgeCaptureTexture(this.captureTarget.texture);
      this.captureRegistered = true;
    }

    // 2. Pass the frame through untouched (full vec4 copy).
    this.copyMaterial.uniforms.tDiffuse.value = inputBuffer.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    this.captureTarget.setSize(Math.max(1, width), Math.max(1, height));
  }

  override dispose(): void {
    registerEdgeCaptureTexture(null);
    this.captureRegistered = false;
    this.captureTarget.dispose();
    this.sobelMaterial.dispose();
    this.copyMaterial.dispose();
    super.dispose();
  }
}
