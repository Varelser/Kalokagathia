// Displace pass (Phase AD): image-driven screen warp in the
// TouchDesigner Displace idiom — the source image's channels
// offset where the frame is sampled from, with mid-grey meaning
// "no shift". The channel pairing mirrors pickDisplacePair in
// lib/postFxMath.ts (default 'red-green': R drives X, G drives
// Y). The image is the existing gradient-image input
// (gpgpuGradImageSource, decoded by lib/gradImageTexture.ts);
// while no image is ready the pass samples the frame at the
// unmodified UV, i.e. it is an exact pass-through rather than a
// silent visual change. Sits before 'feedback' in every stack
// profile, so feedback smears the displaced frame.

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
uniform sampler2D tMap;
uniform bool uMapReady;
uniform float uAmount;
uniform int uChannel;
varying vec2 vUv;

// Channel indices follow DISPLACE_CHANNELS in lib/postFxMath.ts:
// 0 red-green, 1 luma, 2 red, 3 green, 4 blue.
vec2 displacePair(vec3 c) {
  if (uChannel == 2) return vec2(c.r);
  if (uChannel == 3) return vec2(c.g);
  if (uChannel == 4) return vec2(c.b);
  if (uChannel == 1) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return vec2(l);
  }
  return c.rg;
}

void main() {
  vec2 offset = vec2(0.0);
  if (uMapReady) {
    vec3 mapColor = texture2D(tMap, vUv).rgb;
    offset = (displacePair(mapColor) - 0.5) * uAmount;
  }
  vec4 src = texture2D(tDiffuse, clamp(vUv + offset, 0.001, 0.999));
  gl_FragColor = src;
}
`;

export class DisplacePass extends Pass {
  amount = 0.1;
  channelIndex = 0;
  mapTexture: THREE.Texture | null = null;
  mapReady = false;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('DisplacePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tMap: { value: null },
        uMapReady: { value: false },
        uAmount: { value: this.amount },
        uChannel: { value: 0 },
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
    this.material.uniforms.tMap.value = this.mapTexture;
    this.material.uniforms.uMapReady.value = this.mapReady && this.mapTexture !== null;
    this.material.uniforms.uAmount.value = this.amount;
    this.material.uniforms.uChannel.value = this.channelIndex;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
