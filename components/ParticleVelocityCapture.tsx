import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import { SHADOW_CASTER_POINTS_USERDATA } from '../lib/lightShadowMap';
import {
  MOTION_BLUR_REFERENCE_DT,
  VELOCITY_SPLAT_FRAG,
  VELOCITY_SPLAT_VERT,
  getMotionSimFrameSource,
  motionBlurPointDiameterWorld,
  noteMotionCaptureFrame,
  noteMotionCapturePublished,
  noteMotionCaptureSkip,
  setMotionVelocitySource,
  velocityTargetSize,
} from '../lib/motionBlur';

// Particle velocity capture (limit plan stage 4, slice S5):
// draws the main pool's points once per frame into a
// half-resolution velocity target and publishes it through
// lib/motionBlur.ts for the 'motion-blur' post stage. Each
// splat writes the particle's screen-space velocity for the
// reference frame (UV per 1/60 s) plus a coverage alpha.
//
// Mount discipline is the identity guarantee (the Phase 16
// depth-base pattern): AppScene mounts this component ONLY
// while the resolved MB settings are on. At the defaults it
// never mounts, no target exists, the store stays null and
// the render is unchanged. The half-res size follows the
// drawing buffer every frame, so DynRes / exportScale are
// tracked by construction.
//
// Recorded scope: the velocity source is the MAIN POOL's
// points only. The geometry (instanced mesh) path writes no
// velocity this slice — where the pool is drawn as meshes,
// the field stays empty and the stage passes through; the
// same applies to non-particle scene objects (their velocity
// is not rendered by anyone), so postMbParticleOnly=false
// means "apply the gather wherever the particle velocity
// field reaches" rather than a whole-scene velocity render.
// The splat size is the representative world diameter
// (gpgpuSize in the bounceRadius * 0.02 world unit, the S4
// definition); overlapping splats resolve last-drawn-wins
// (no blending, no depth), so the field holds one
// representative velocity per pixel, not an average.
//
// Texture supply (stage-4 gate fix round 2,
// STAGE4_FIX5_MB_CHAIN_RECORD): the position/velocity
// textures come from the sim frame store in lib/motionBlur.ts
// — the GpgpuSystem frame loop publishes the simulation's own
// output targets there, the same targets the diagnostic AOV
// renders from (ctx.posOut / ctx.velOut). The original route
// read uPosTex / uVelTex off the marked points' draw material;
// this was the only capture that needed the velocity uniform,
// and its early return failed silently forever when the lookup
// came back empty, leaving the MB stage a permanent
// passthrough. Every skip now leaves its reason in the capture
// diag state (read it via the ?diag=1 hook's
// captureMotionVelocityStats), and the marked points object is
// still traversed — for its geometry (aTexCoord) only.

export const ParticleVelocityCapture: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const gl = useThree((state) => state.gl);
  const rtRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const pointsRef = React.useRef<THREE.Points | null>(null);
  const matRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const clearColorRef = React.useRef<THREE.Color | null>(null);

  const ensureTarget = React.useCallback((bufferWidth: number, bufferHeight: number): THREE.WebGLRenderTarget => {
    const { width, height } = velocityTargetSize(bufferWidth, bufferHeight);
    let rt = rtRef.current;
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        type: THREE.HalfFloatType,
      });
      rtRef.current = rt;
    } else if (rt.width !== width || rt.height !== height) {
      rt.setSize(width, height);
    }
    return rt;
  }, []);

  useFrame(({ scene, camera }) => {
    noteMotionCaptureFrame();
    // Find the marked main-pool points (the S4 caster mark) —
    // for its geometry only; the simulation textures come from
    // the sim frame store (see the header note).
    let pointsObj: THREE.Object3D | null = null;
    scene.traverse((obj) => {
      if (!pointsObj && obj.userData[SHADOW_CASTER_POINTS_USERDATA]) pointsObj = obj;
    });
    if (!pointsObj) {
      noteMotionCaptureSkip('no-points');
      return;
    }
    const frame = getMotionSimFrameSource();
    if (!frame) {
      noteMotionCaptureSkip('no-sim-frame');
      return;
    }
    const posTex = frame.posTexture;
    const velTex = frame.velTexture;

    const diameter = motionBlurPointDiameterWorld(config.gpgpuSize, config.gpgpuBounceRadius);
    if (!(diameter > 0)) {
      noteMotionCaptureSkip('zero-diameter');
      return;
    }

    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    if (size.x <= 0 || size.y <= 0) {
      noteMotionCaptureSkip('bad-buffer');
      return;
    }
    const rt = ensureTarget(size.x, size.y);

    if (!matRef.current) {
      matRef.current = new THREE.ShaderMaterial({
        uniforms: {
          uPosTex: { value: null },
          uVelTex: { value: null },
          uDiameterWorld: { value: 0 },
          uProjFactor: { value: 0 },
          uReferenceDt: { value: MOTION_BLUR_REFERENCE_DT },
          uSpeed: { value: 1 },
        },
        vertexShader: VELOCITY_SPLAT_VERT,
        fragmentShader: VELOCITY_SPLAT_FRAG,
        depthTest: false,
        depthWrite: false,
        transparent: false,
      });
    }
    const persp = camera as THREE.PerspectiveCamera;
    matRef.current.uniforms.uPosTex.value = posTex;
    matRef.current.uniforms.uVelTex.value = velTex;
    matRef.current.uniforms.uDiameterWorld.value = diameter;
    // The position pass scales travel by gpgpuSpeed (uSpeed);
    // the splat's forward projection must use the same factor
    // so the stored velocity matches the actual per-frame
    // travel (default 1 = the recorded baseline).
    matRef.current.uniforms.uSpeed.value =
      typeof config.gpgpuSpeed === 'number' && Number.isFinite(config.gpgpuSpeed) ? config.gpgpuSpeed : 1;
    matRef.current.uniforms.uProjFactor.value =
      size.y * 0.5 * (typeof persp.projectionMatrix?.elements?.[5] === 'number' ? persp.projectionMatrix.elements[5] : 1);

    if (!sceneRef.current) sceneRef.current = new THREE.Scene();
    const splatScene = sceneRef.current;
    splatScene.clear();
    const geo = (pointsObj as THREE.Points).geometry;
    if (!pointsRef.current) {
      pointsRef.current = new THREE.Points(geo, matRef.current);
      pointsRef.current.frustumCulled = false;
    } else {
      if (pointsRef.current.geometry !== geo) pointsRef.current.geometry = geo;
      pointsRef.current.material = matRef.current;
    }
    splatScene.add(pointsRef.current);

    if (!clearColorRef.current) clearColorRef.current = new THREE.Color(0, 0, 0);
    const prevTarget = gl.getRenderTarget();
    const prevClearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(rt);
    gl.setClearColor(clearColorRef.current, 0);
    gl.clear(true, false, false);
    gl.render(splatScene, camera);
    gl.setRenderTarget(prevTarget);
    gl.setClearAlpha(prevClearAlpha);

    setMotionVelocitySource({ texture: rt.texture, width: rt.width, height: rt.height, target: rt });
    noteMotionCapturePublished();
  });

  React.useEffect(() => () => {
    setMotionVelocitySource(null);
    rtRef.current?.dispose();
    rtRef.current = null;
    matRef.current?.dispose();
    matRef.current = null;
    pointsRef.current = null;
    sceneRef.current = null;
  }, []);

  return null;
};
