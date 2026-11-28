import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import {
  SHADOW_CASTER_GEOM_FRAG,
  SHADOW_CASTER_GEOM_USERDATA,
  SHADOW_CASTER_GEOM_VERT,
  SHADOW_CASTER_POINTS_FRAG,
  SHADOW_CASTER_POINTS_USERDATA,
  SHADOW_CASTER_POINTS_VERT,
  SHADOW_MAP_SIZE,
  buildLightViewProj,
  lightShadowFrustum,
  setLightShadowSource,
  shadowCastParticlesOn,
  shadowCasterPointDiameterWorld,
  shadowCasterPointSizePx,
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
//
// Particle self-shadow (limit plan stage 4, slice S4): while
// gpgpuShadowMapCastParticles is on, a dedicated caster pass
// runs into the same target right after the scene pass (with
// clearing off, so both depth sets land in one map). The
// casters are stand-in objects in a private scene that share
// the marked scene objects' geometries and read their live
// uniforms: the geometry meshes (marked in useGpgpuMeshAssets)
// are drawn with an instanced depth material at their true
// position/scale, and the main points (marked in
// gpgpuRenderOutputs) with a round point-size depth draw. The
// marked geometry meshes are also hidden during the scene
// pass while casting is on — under the plain override depth
// material their instanced transform would collapse to the
// origin, and the caster pass draws them properly instead.
// At the default (cast off) none of this exists: no marks are
// read, nothing extra is hidden, no caster pass runs, and the
// capture is byte-identical to the stage-1 discipline above.

export const LightShadowCapture: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const gl = useThree((state) => state.gl);
  const rtRef = React.useRef<THREE.WebGLRenderTarget | null>(null);
  const cameraRef = React.useRef<THREE.OrthographicCamera | null>(null);
  const depthMatRef = React.useRef<THREE.MeshDepthMaterial | null>(null);
  // Caster pass state (stage 4, S4): a private scene whose
  // objects are created lazily and reused across frames. The
  // geometries they draw are borrowed from the marked scene
  // objects and are never disposed here.
  const casterSceneRef = React.useRef<THREE.Scene | null>(null);
  const casterPointsRef = React.useRef<THREE.Points | null>(null);
  const casterPointsMatRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const casterGeomMatRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const casterGeomByGeoRef = React.useRef<Map<string, THREE.Mesh> | null>(null);

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

  // Caster pass (stage 4, S4): draws the marked particle
  // objects' stand-ins into the capture target with clearing
  // off, so particle depth lands in the same map as the scene
  // pass. Live uniforms (uPosTex / uGeomScale) are read off
  // the marked objects' own materials — the same values the
  // main render used this frame. Any piece whose source is not
  // ready yet (no points object, no position texture) is
  // skipped for this frame instead of failing.
  const runCasterPass = (
    pointsObj: THREE.Object3D | null,
    geomObjs: THREE.Object3D[],
    rt: THREE.WebGLRenderTarget,
    cam: THREE.OrthographicCamera,
    extent: number,
    prevTarget: THREE.WebGLRenderTarget | null,
  ): void => {
    const uniformsOf = (obj: THREE.Object3D): Record<string, { value: unknown }> | null => {
      const mat = (obj as THREE.Mesh).material as unknown as
        { uniforms?: Record<string, { value: unknown }> } | undefined;
      return mat?.uniforms ?? null;
    };

    if (!casterSceneRef.current) casterSceneRef.current = new THREE.Scene();
    const casterScene = casterSceneRef.current;
    casterScene.clear();

    // Points caster: shares the marked points object's draw
    // geometry; the pixel size is computed CPU-side from the
    // world diameter (the light camera is orthographic).
    if (pointsObj) {
      const uniforms = uniformsOf(pointsObj);
      const posTex = (uniforms?.uPosTex?.value ?? null) as THREE.Texture | null;
      const diameter = shadowCasterPointDiameterWorld(
        config.gpgpuSize, config.gpgpuBounceRadius, config.gpgpuShadowMapParticleSize,
      );
      const sizePx = shadowCasterPointSizePx(diameter, extent);
      if (posTex && sizePx > 0) {
        if (!casterPointsMatRef.current) {
          casterPointsMatRef.current = new THREE.ShaderMaterial({
            uniforms: {
              uPosTex: { value: null },
              uCasterPointSizePx: { value: 0 },
            },
            vertexShader: SHADOW_CASTER_POINTS_VERT,
            fragmentShader: SHADOW_CASTER_POINTS_FRAG,
            depthWrite: true,
            depthTest: true,
          });
        }
        casterPointsMatRef.current.uniforms.uPosTex.value = posTex;
        casterPointsMatRef.current.uniforms.uCasterPointSizePx.value = sizePx;
        const geo = (pointsObj as THREE.Points).geometry;
        if (!casterPointsRef.current) {
          casterPointsRef.current = new THREE.Points(geo, casterPointsMatRef.current);
          casterPointsRef.current.frustumCulled = false;
        } else {
          if (casterPointsRef.current.geometry !== geo) casterPointsRef.current.geometry = geo;
          casterPointsRef.current.material = casterPointsMatRef.current;
        }
        casterScene.add(casterPointsRef.current);
      }
    }

    // Geometry casters: one stand-in Mesh per marked mesh,
    // sharing its instanced geometry; all marked meshes share
    // the one geometry material, so the uniforms are read off
    // the first.
    if (geomObjs.length > 0) {
      const uniforms = uniformsOf(geomObjs[0]);
      const posTex = (uniforms?.uPosTex?.value ?? null) as THREE.Texture | null;
      const geomScale = (uniforms?.uGeomScale?.value ?? null) as number | null;
      if (posTex && typeof geomScale === 'number') {
        if (!casterGeomMatRef.current) {
          casterGeomMatRef.current = new THREE.ShaderMaterial({
            uniforms: {
              uPosTex: { value: null },
              uGeomScale: { value: 0 },
            },
            vertexShader: SHADOW_CASTER_GEOM_VERT,
            fragmentShader: SHADOW_CASTER_GEOM_FRAG,
            depthWrite: true,
            depthTest: true,
            side: THREE.DoubleSide,
          });
        }
        casterGeomMatRef.current.uniforms.uPosTex.value = posTex;
        casterGeomMatRef.current.uniforms.uGeomScale.value = geomScale;
        if (!casterGeomByGeoRef.current) casterGeomByGeoRef.current = new Map();
        const byGeo = casterGeomByGeoRef.current;
        for (const src of geomObjs) {
          const geo = (src as THREE.Mesh).geometry;
          let wrapper = byGeo.get(geo.uuid);
          if (!wrapper) {
            wrapper = new THREE.Mesh(geo, casterGeomMatRef.current);
            wrapper.frustumCulled = false;
            byGeo.set(geo.uuid, wrapper);
          } else {
            if (wrapper.geometry !== geo) wrapper.geometry = geo;
            wrapper.material = casterGeomMatRef.current;
          }
          casterScene.add(wrapper);
        }
      }
    }

    if (casterScene.children.length === 0) return;
    const prevAutoClear = gl.autoClear;
    gl.autoClear = false;
    gl.setRenderTarget(rt);
    gl.render(casterScene, cam);
    gl.setRenderTarget(prevTarget);
    gl.autoClear = prevAutoClear;
  };

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
    // Particle casters (stage 4, S4): collected during the same
    // traverse, only while casting is on. At the default the
    // marks are never read and this stays exactly the stage-1
    // hiding pass.
    const castOn = shadowCastParticlesOn(config);
    let casterPointsObj: THREE.Object3D | null = null;
    const casterGeomObjs: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      const anyObj = obj as unknown as { isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
      if ((anyObj.isPoints || anyObj.isLine || anyObj.isSprite) && obj.visible) {
        obj.visible = false;
        hidden.push(obj);
      }
      if (castOn) {
        if (obj.userData[SHADOW_CASTER_POINTS_USERDATA]) {
          casterPointsObj = obj;
        } else if (obj.userData[SHADOW_CASTER_GEOM_USERDATA]) {
          casterGeomObjs.push(obj);
          // The caster pass draws these properly; under the
          // override depth material their instanced transform
          // would collapse to the origin, so hide them here.
          if (obj.visible) {
            obj.visible = false;
            hidden.push(obj);
          }
        }
      }
    });
    const prevOverride = scene.overrideMaterial;
    const prevTarget = gl.getRenderTarget();
    scene.overrideMaterial = depthMatRef.current;
    gl.setRenderTarget(rt);
    gl.render(scene, cam);
    scene.overrideMaterial = prevOverride;

    if (castOn) {
      runCasterPass(casterPointsObj, casterGeomObjs, rt, cam, frustum.extent, prevTarget);
    }

    gl.setRenderTarget(prevTarget);
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
    // Caster pass state: the materials are ours to dispose;
    // the wrapper objects only borrow the marked objects'
    // geometries, which are NOT disposed here.
    casterPointsMatRef.current?.dispose();
    casterPointsMatRef.current = null;
    casterGeomMatRef.current?.dispose();
    casterGeomMatRef.current = null;
    casterPointsRef.current = null;
    casterGeomByGeoRef.current = null;
    casterSceneRef.current = null;
  }, []);

  return null;
};
