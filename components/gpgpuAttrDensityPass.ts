import * as THREE from 'three';
import { buildDensityFragment, DENSITY_SAMPLES } from '../lib/gpgpuDensity';

/**
 * Density supply pass (Phase 22 stage 1).
 *
 * Renders the per-particle density texture (R = den, the
 * definition in lib/gpgpuDensity.ts) from a position texture.
 * The wiring (sceneGpgpuSystem) builds this pass ONLY while a
 * compiled attribute expression (dynamic / chain / feedback)
 * actually reads `den`, runs it on the attribute passes'
 * interval cadence from the same position snapshot those
 * passes read, and disposes it otherwise — so a config that
 * never reads den pays nothing and renders bit-identically.
 */
const DENSITY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class GpgpuAttrDensityPass {
  private rt: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;

  constructor(texSize: number) {
    this.rt = new THREE.WebGLRenderTarget(texSize, texSize, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null as THREE.Texture | null },
        uTexSizeF: { value: texSize },
        uStride: { value: (texSize * texSize) / DENSITY_SAMPLES },
        uRadius: { value: 40 },
        uRestDensity: { value: 2.0 },
      },
      vertexShader: DENSITY_VERT,
      fragmentShader: buildDensityFragment(),
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  run(
    gl: THREE.WebGLRenderer,
    posTex: THREE.Texture,
    radius: number,
    restDensity: number,
  ): THREE.Texture {
    this.mat.uniforms.uPosTex.value = posTex;
    this.mat.uniforms.uRadius.value = radius;
    this.mat.uniforms.uRestDensity.value = restDensity;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.rt);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    return this.rt.texture;
  }

  dispose(): void {
    this.rt.dispose();
    this.mat.dispose();
    this.geo.dispose();
  }
}
