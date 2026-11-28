// Motion Blur pass (limit plan stage 4, slice S5): the
// 'motion-blur' post stage. Velocity-buffer gathering per
// design §3.2 案A — the fragment shader (lib/motionBlur.ts
// MOTION_BLUR_FRAG) averages samples taken symmetrically
// along the captured screen-space velocity, centred on the
// current pixel; it is NOT a frame history blend. Same Pass
// shape as radialBlurPass.ts.
// Stateless across frames: the velocity field arrives via
// the shared store (ParticleVelocityCapture publishes it)
// and the pass reads that store itself in render() — see the
// binding note there. With no source published the stage is
// a bit-identical passthrough.

import { Pass } from 'postprocessing';
import * as THREE from 'three';
import { MOTION_BLUR_FRAG, getMotionVelocitySource, noteMotionBlurPassRender } from '../lib/motionBlur';

// Matches postprocessing's shared fullscreen vertex shader
// convention (see feedbackPass.ts).
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export class MotionBlurPass extends Pass {
  strength = 1;

  samples = 8;

  particleOnly = false;

  velocityTexture: THREE.Texture | null = null;

  private material: THREE.ShaderMaterial;

  constructor() {
    super('MotionBlurPass');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: MOTION_BLUR_FRAG,
      uniforms: {
        tDiffuse: { value: null },
        tVelocity: { value: null },
        uStrength: { value: this.strength },
        uSamplesFloat: { value: this.samples },
        uParticleOnly: { value: 0 },
        uVelocityReady: { value: 0 },
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
    // Binding (stage-4 gate fix round 3,
    // STAGE4_FIX8_MB_BINDING_RECORD): the velocity source is
    // read from the shared store HERE, at composite time —
    // not assigned from React render in AppScenePostFx. The
    // store is module-level, so whatever the capture has
    // published by the time this frame is composited is what
    // gets bound, and the React-side hop that starved the
    // stage on the real GPU (this.velocityTexture still null
    // at render, uVelocityReady stuck at 0, the stage a
    // permanent passthrough while the capture published a
    // healthy field) no longer exists. The field stays as
    // the record of the last binding, and every render is
    // noted into the pass diag state the ?diag=1 hook reads.
    const source = getMotionVelocitySource();
    const tex = source ? source.texture : null;
    this.velocityTexture = tex;
    this.material.uniforms.tDiffuse.value = inputBuffer.texture;
    this.material.uniforms.tVelocity.value = tex;
    this.material.uniforms.uStrength.value = this.strength;
    this.material.uniforms.uSamplesFloat.value = this.samples;
    this.material.uniforms.uParticleOnly.value = this.particleOnly ? 1 : 0;
    this.material.uniforms.uVelocityReady.value = tex ? 1 : 0;
    noteMotionBlurPassRender(tex !== null, source ? source.width : null, source ? source.height : null);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.material.dispose();
    super.dispose();
  }
}
