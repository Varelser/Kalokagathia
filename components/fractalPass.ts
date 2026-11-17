// Escape-time fractal pass (Phase AL): renders the Mandelbrot /
// Julia escape-time field as a monochrome luminance image and
// mixes it over the current frame. A pure function of the frame
// UV (stateless, no history buffer), following the same Pass
// shape as kaleidoscopePass.ts. The iteration is the GLSL twin of
// lib/fractalField.ts (fractalEscape): z -> z^2 + c with the
// smooth escape count nu = iter + 1 - log2(log|z|); the interior
// is white and escaped points darken as sqrt(nu / iterations).
// mix 0 keeps the input frame bit-identical, and the stage only
// exists in the stack while postFractalEnabled is on.

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
uniform float uKind;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uIterations;
uniform vec2 uJulia;
uniform float uMix;
uniform float uAspect;
varying vec2 vUv;

float fractalEscape(vec2 p) {
  vec2 z;
  vec2 c;
  if (uKind > 0.5) {
    z = p;
    c = uJulia;
  } else {
    z = vec2(0.0);
    c = p;
  }
  int maxIter = int(uIterations + 0.5);
  for (int i = 0; i < 256; i++) {
    if (i >= maxIter) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float r2 = dot(z, z);
    if (r2 > 65536.0) {
      float nu = float(i) + 1.0 - log(max(log(sqrt(r2)), 1.0001)) * 1.4426950408889634;
      return max(nu, 0.0);
    }
  }
  return -1.0;
}

void main() {
  vec3 frame = texture2D(tDiffuse, vUv).rgb;
  float halfH = 1.5 / max(uZoom, 0.0001);
  vec2 p = vec2(
    uCenter.x + (vUv.x - 0.5) * 2.0 * halfH * uAspect,
    uCenter.y + (vUv.y - 0.5) * 2.0 * halfH
  );
  float nu = fractalEscape(p);
  float lum = nu < 0.0 ? 1.0 : 1.0 - sqrt(clamp(nu / max(uIterations, 1.0), 0.0, 1.0));
  vec3 fractal = vec3(lum);
  gl_FragColor = vec4(mix(frame, fractal, clamp(uMix, 0.0, 1.0)), 1.0);
}
`;

export class FractalPass extends Pass {
  kind: 'mandelbrot' | 'julia' = 'mandelbrot';

  centerX = -0.5;

  centerY = 0;

  zoom = 1;

  iterations = 64;

  juliaX = -0.8;

  juliaY = 0.156;

  mixAmount = 1;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('FractalPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uKind: { value: 0 },
        uCenter: { value: new THREE.Vector2(this.centerX, this.centerY) },
        uZoom: { value: this.zoom },
        uIterations: { value: this.iterations },
        uJulia: { value: new THREE.Vector2(this.juliaX, this.juliaY) },
        uMix: { value: this.mixAmount },
        uAspect: { value: 1 },
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
    this.material.uniforms.uKind.value = this.kind === 'julia' ? 1 : 0;
    (this.material.uniforms.uCenter.value as THREE.Vector2).set(this.centerX, this.centerY);
    this.material.uniforms.uZoom.value = this.zoom;
    this.material.uniforms.uIterations.value = this.iterations;
    (this.material.uniforms.uJulia.value as THREE.Vector2).set(this.juliaX, this.juliaY);
    this.material.uniforms.uMix.value = this.mixAmount;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override setSize(width: number, height: number): void {
    (this.material.uniforms.uAspect.value as number) = height > 0 ? width / height : 1;
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
