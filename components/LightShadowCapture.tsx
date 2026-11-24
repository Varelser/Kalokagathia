import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import {
  SHADOW_MAP_SIZE,
  buildLightViewProj,
  lightShadowFrustum,
  setLightShadowSource,
} from '../lib/lightShadowMap';

// Light shadow capture (Phase 22 stage 4, wiring stage 1):
// re-renders the scene once per frame from the Phase T light
// object's viewpoint into a 2048x2048 depth target and
// publishes it through lib/lightShadowMap.ts for receivers
// (stage 1: the terrain mesh).
//
// Mount discipline is the identity guarantee (the Phase 16
// depth-base pattern): AppScene mounts this component ONLY
// while gpgpuShadowMapStrength > 0. At the default 0 it never
// mounts, nothing extra is drawn, the store stays null and
// every receiver runs its stock shader.
//
// Casters are depth-writing opaque geometry only. Non-casters
// (Points / Line / Sprite — particles, lines, volumes) are
// hidden for the duration of the capture render so they cannot
// stamp square false shadows, and scene.overrideMaterial
// forces a plain depth write for everything that remains, so
// custom ShaderMaterials that keep depthWrite off in the main
// pass still cast. Visibility and the override are restored
// immediately after the capture render, inside the same
// default-priority useFrame that runs before the main render.

export const LightShadowCapture: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const gl = useThree((state) => state.gl);
  const rtRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const cameraRef = React.useRef<THREE.OrthographicCamera | null>(null);
  const depthMatRef = React.useRef<THREE.MeshDepthMaterial | null>(null);

  const ensureTarget = React.useCallback((): THREE.WebGLRenderTarget => {
    let rt = rtRef.current;
    if (!rt) {
      const depthTexture = new THREE.DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      depthTexture.format = THREE.DepthFormat;
      depthTexture.type = THREE.UnsignedInt248Type;
      rt = new THREE.WebGLRenderTarget(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        depthTexture,
      });
      rtRef.current = rt;
    }
    return rt;
  }, []);

  useFrame(({ scene }) => {
    const rt = ensureTarget();
    const lightPos = {
      x: config.gpgpuLightPosX,
      y: config.gpgpuLightPosY,
      z: config.gpgpuLightPosZ,
    };
    const frustum = lightShadowFrustum(lightPos, config.gpgpuBounceRadius);
    let cam = cameraRef.current;
    if (!cam) {
      cam = new THREE.OrthographicCamera(
        -frustum.extent, frustum.extent, frustum.extent, -frustum.extent, frustum.near, frustum.far,
      );
      cameraRef.current = cam;
    } else {
      cam.left = -frustum.extent;
      cam.right = frustum.extent;
      cam.top = frustum.extent;
      cam.bottom = -frustum.extent;
      cam.near = frustum.near;
      cam.far = frustum.far;
    }
    cam.position.copy(frustum.position);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();

    if (!depthMatRef.current) {
      depthMatRef.current = new THREE.MeshDepthMaterial();
      depthMatRef.current.side = THREE.DoubleSide;
    }

    // Hide non-casters for the capture render only.
    const hidden: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      const anyObj = obj as unknown as { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      if ((anyObj.isPoints || anyObj.isLine || anyObj.isSprite) && obj.visible) {
        obj.visible = false;
        hidden.push(obj);
      }
    });
    const prevOverride = scene.overrideMaterial;
    const prevTarget = gl.getRenderTarget();
    scene.overrideMaterial = depthMatRef.current;
    gl.setRenderTarget(rt);
    gl.render(scene, cam);
    gl.setRenderTarget(prevTarget);
    scene.overrideMaterial = prevOverride;
    for (const obj of hidden) obj.visible = true;

    setLightShadowSource({
      texture: rt.depthTexture as THREE.Texture,
      viewProj: buildLightViewProj(lightPos, config.gpgpuBounceRadius),
    });
  });

  React.useEffect(() => () => {
    setLightShadowSource(null);
    rtRef.current?.depthTexture?.dispose();
    rtRef.current?.dispose();
    rtRef.current = null;
    depthMatRef.current?.dispose();
    depthMatRef.current = null;
  }, []);

  return null;
};
