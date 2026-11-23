import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { setSceneDepthSource } from '../lib/sceneDepth';

// Scene depth capture (Phase 16 stage 1): renders the scene once
// per frame into a WebGLRenderTarget carrying a DepthTexture and
// publishes it through lib/sceneDepth.ts for LightVolume and the
// LightFx Lux cone.
//
// Mount discipline is the identity guarantee: AppScene mounts
// this component ONLY while gpgpuDepthOcclusion > 0. At the
// default 0 it never mounts, nothing extra is drawn, the store
// stays null and both consumers run their legacy formulas
// verbatim.
//
// Honest scope: the capture is a plain re-render of the scene as
// composed, so the depth holds whatever actually writes depth.
// Much of this app draws with depthWrite:false (particles,
// volumes, additive passes) — those surfaces do not occlude,
// which is the recorded precision wall of the depth base: the
// opaque writers (Terrain / OBJ Standard meshes and other
// depth-writing draws) are what the fade can see.
//
// The capture runs in a default-priority useFrame, i.e. before
// R3F's own render of the same frame, so consumers shading in
// the main pass read the current frame's depth (the volume and
// the post chain draw after this, in the same frame).

export const SceneDepthCapture: React.FC = () => {
  const gl = useThree((state) => state.gl);
  const rtRef = React.useRef<THREE.WebGLRenderTarget | null>(null);

  const ensureTarget = React.useCallback((width: number, height: number): THREE.WebGLRenderTarget => {
    let rt = rtRef.current;
    if (!rt) {
      const depthTexture = new THREE.DepthTexture(width, height);
      depthTexture.format = THREE.DepthFormat;
      depthTexture.type = THREE.UnsignedInt248Type;
      rt = new THREE.WebGLRenderTarget(width, height, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        depthTexture,
      });
      rtRef.current = rt;
    } else if (rt.width !== width || rt.height !== height) {
      rt.setSize(width, height);
    }
    return rt;
  }, []);

  useFrame(({ scene, camera }) => {
    const size = gl.getDrawingBufferSize(new THREE.Vector2());
    if (size.x <= 0 || size.y <= 0) return;
    const rt = ensureTarget(size.x, size.y);
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(rt);
    gl.render(scene, camera);
    gl.setRenderTarget(prevTarget);
    const cam = camera as THREE.PerspectiveCamera;
    setSceneDepthSource({
      texture: rt.depthTexture as THREE.Texture,
      near: typeof cam.near === 'number' ? cam.near : 0.1,
      far: typeof cam.far === 'number' ? cam.far : 10000,
    });
  });

  React.useEffect(() => () => {
    setSceneDepthSource(null);
    rtRef.current?.depthTexture?.dispose();
    rtRef.current?.dispose();
    rtRef.current = null;
  }, []);

  return null;
};
