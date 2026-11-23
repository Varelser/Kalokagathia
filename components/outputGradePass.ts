// Output grade pass (Kinetix integration B2): final-stage exposure
// multiplier plus an optional ACES filmic tone curve, mirroring the
// Kinetix output stage (ACESFilmicToneMapping + exposure on the
// renderer). Implemented as a shader pass instead of touching the
// renderer so the stage only exists when the user opts in — with the
// defaults (exposure 1.0, 'legacy', brand duotone off) the stage is
// inactive and the composer output is unchanged. The ACES curve is
// the standard Narkowicz fit, re-implemented here. Pro-2 adds the
// brand monochrome duotone to the same stage (see FRAG).

import { Pass } from 'postprocessing';
import * as THREE from 'three';

// Matches postprocessing's shared fullscreen vertex shader convention
// (see feedbackPass.ts): vUv is derived from clip-space position.
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform float uAces;
uniform float uBrandEnabled;
uniform vec3 uBrandColor;
uniform float uBrandMid;
uniform float uReservedEnabled;
uniform float uReservedFloor;
uniform float uReservedCeiling;
varying vec2 vUv;

vec3 acesFilmic(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;
  if (uAces > 0.5) {
    color = acesFilmic(color);
  }
  if (uBrandEnabled > 0.5) {
    // Brand monochrome (Pro-2): single-colour duotone. Luminance is
    // remapped through a black -> brand -> white ramp; the ramp's
    // midpoint sits at the brand colour's own luminance so a bright
    // brand colour keeps its dark tones and a dark one keeps its
    // highlights, instead of crushing one end of the monochrome scale.
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float mid = clamp(uBrandMid, 0.02, 0.98);
    color = luma < mid
      ? mix(vec3(0.0), uBrandColor, luma / mid)
      : mix(uBrandColor, vec3(1.0), (luma - mid) / (1.0 - mid));
  }
  if (uReservedEnabled > 0.5) {
    // Reserved palette ramp (Phase 15, ink): the finished frame is
    // remapped into [floor, ceiling] as the stage's last word, so
    // the extremes of the range stay reserved — no pixel can reach
    // pure white or pure black, whatever the earlier stages did.
    float lo = clamp(uReservedFloor, 0.0, 0.45);
    float hi = clamp(uReservedCeiling, 0.55, 1.0);
    color = mix(vec3(lo), vec3(hi), clamp(color, 0.0, 1.0));
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

export class OutputGradePass extends Pass {
  exposure = 1.0;

  aces = false;

  brandEnabled = false;

  brandColor = new THREE.Color('#c8372d');

  reservedEnabled = false;

  reservedFloor = 0.03;

  reservedCeiling = 0.94;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('OutputGradePass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: this.exposure },
        uAces: { value: 0 },
        uBrandEnabled: { value: 0 },
        uBrandColor: { value: new THREE.Color('#c8372d') },
        uBrandMid: { value: 0.18 },
        uReservedEnabled: { value: 0 },
        uReservedFloor: { value: 0.03 },
        uReservedCeiling: { value: 0.94 },
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
    this.material.uniforms.uExposure.value = this.exposure;
    this.material.uniforms.uAces.value = this.aces ? 1 : 0;
    this.material.uniforms.uBrandEnabled.value = this.brandEnabled ? 1 : 0;
    (this.material.uniforms.uBrandColor.value as THREE.Color).copy(this.brandColor);
    this.material.uniforms.uBrandMid.value =
      0.2126 * this.brandColor.r + 0.7152 * this.brandColor.g + 0.0722 * this.brandColor.b;
    this.material.uniforms.uReservedEnabled.value = this.reservedEnabled ? 1 : 0;
    this.material.uniforms.uReservedFloor.value = this.reservedFloor;
    this.material.uniforms.uReservedCeiling.value = this.reservedCeiling;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
