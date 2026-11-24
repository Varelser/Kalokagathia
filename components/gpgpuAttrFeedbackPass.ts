import * as THREE from 'three';
import type { GpgpuAttrPassExtraBindings } from './gpgpuAttrDynPass';

/**
 * Attribute feedback pass (Phase BV).
 *
 * Ping-pong variant of GpgpuAttrDynPass (Phase BO). Where the
 * BO pass owns ONE render target and always reads the bake,
 * this pass owns TWO and feeds its own previous output back as
 * uPrev, which is what the feedback fragment's `p` variable
 * samples (lib/expressionGlslFeedback.ts).
 *
 * State lifecycle (the reset definition Phase BV ships):
 *   - after construction, and whenever the caller reports a new
 *     bake texture object (rebake / reseed), the next run binds
 *     uPrev to the bake itself, so p == x on the first frame —
 *     no clear / copy pass is needed;
 *   - every later run binds uPrev to the texture written by the
 *     previous run and writes into the other target;
 *   - the returned texture is stable between runs (consumers
 *     hold it exactly like the BO pass's output).
 *
 * The state is therefore a pure function of (bake, expression
 * set, evaluation count since reset, sim clock series) — under
 * the deterministic renderer (fixed dt, remounted scene, clock
 * restarted at mount) two exports from the same config agree
 * bit-for-bit, the same envelope BO proved for the stateless
 * pass, extended by the evaluation-count term (brief J3: with
 * an interval the state advances per evaluation, not per
 * frame).
 *
 * The wiring (sceneGpgpuSystem) owns the lifecycle: it builds
 * this pass only while feedback is enabled with at least one
 * compilable p-referencing expression, rebuilds it when the
 * signature (enabled / exprs / names / interval / texSize)
 * changes, and disposes it otherwise. While it exists it takes
 * over the stage-2 re-evaluation from the BO pass (the two
 * never run in the same frame).
 *
 * Ported verbatim from the Phase BU spike
 * (phasebu-work/project-copy/components/gpgpuAttrFeedbackPass.ts);
 * the only changes are this header and the module's place in
 * the production tree.
 */
const ATTR_FEEDBACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class GpgpuAttrFeedbackPass {
  private rts: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readIdx = 0;
  private mat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geo: THREE.PlaneGeometry;
  private lastBake: THREE.Texture | null = null;
  private hasState = false;

  constructor(texSize: number, fragmentShader: string) {
    const makeRt = () => new THREE.WebGLRenderTarget(texSize, texSize, {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.rts = [makeRt(), makeRt()];
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSrc: { value: null as THREE.Texture | null },
        uPrev: { value: null as THREE.Texture | null },
        // Phase 18 stage 1: ext / sim bindings, sampled only
        // when the fragment declares them (see gpgpuAttrDynPass).
        uSrc2: { value: null as THREE.Texture | null },
        uPosTex: { value: null as THREE.Texture | null },
        uVelTex: { value: null as THREE.Texture | null },
        uAgeDenom: { value: 1 },
        uRadiusDenom: { value: 1 },
        uDenTex: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
      },
      vertexShader: ATTR_FEEDBACK_VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.geo = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /**
   * Advance the feedback state by one evaluation and return
   * the texture consumers should read. `bake` is the stage-1
   * bake texture; a different bake object than the previous
   * call resets the state (p restarts from the bake).
   */
  run(
    gl: THREE.WebGLRenderer,
    bake: THREE.Texture,
    time: number,
    extra?: GpgpuAttrPassExtraBindings,
  ): THREE.Texture {
    if (bake !== this.lastBake) {
      this.lastBake = bake;
      this.hasState = false;
    }
    const writeIdx = this.readIdx === 0 ? 1 : 0;
    const prevTex = this.hasState ? this.rts[this.readIdx].texture : bake;
    this.mat.uniforms.uSrc.value = bake;
    this.mat.uniforms.uPrev.value = prevTex;
    if (extra) {
      this.mat.uniforms.uSrc2.value = extra.src2Tex ?? null;
      this.mat.uniforms.uPosTex.value = extra.posTex ?? null;
      this.mat.uniforms.uVelTex.value = extra.velTex ?? null;
      if (typeof extra.ageDenom === 'number') this.mat.uniforms.uAgeDenom.value = extra.ageDenom;
      if (typeof extra.radiusDenom === 'number') this.mat.uniforms.uRadiusDenom.value = extra.radiusDenom;
      this.mat.uniforms.uDenTex.value = extra.denTex ?? null;
    }
    this.mat.uniforms.uTime.value = time;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.rts[writeIdx]);
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(prev);
    this.readIdx = writeIdx;
    this.hasState = true;
    return this.rts[this.readIdx].texture;
  }

  dispose(): void {
    this.rts[0].dispose();
    this.rts[1].dispose();
    this.mat.dispose();
    this.geo.dispose();
  }
}
