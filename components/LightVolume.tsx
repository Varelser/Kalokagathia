import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { SCENE_DEPTH_GLSL, getSceneDepthSource, useSceneDepthSource } from '../lib/sceneDepth';
import type { ParticleConfig } from '../types';
import { normalizeLightDir } from '../lib/gpgpuLight';
import {
  clampVolumeSteps,
  clampVolumeSoftness,
  lightVolumeDraws,
} from '../lib/lightVolume';
import {
  appendTrailPoint,
  buildLightTrailRibbon,
  type TrailVec3,
} from '../lib/lightTrail';
import { bakeShadowOcclusionMap, buildShadowScene } from '../lib/shadowOcclusion';

// Visible light volume + light trail (Phase Y).
//
// Volume: a dedicated cone / sphere mesh at the Phase T light's
// position, shaded by a raymarch-style accumulation over axial
// samples of an analytic density (lib/lightVolume.ts is the pure
// reference; the GLSL below is its twin). It is draw-only and
// does NOT intersect scene depth — no occlusion — so edges are
// softened by the softness key instead. That limit is stated in
// the UI next to the controls.
//
// Trail: the light's per-frame position history (sampled in
// useFrame, in frame order, never from the wall clock) turned
// into an arc-length-resampled ribbon by lib/lightTrail.ts,
// which reuses the Phase S path basis (chord table + taper).
//
// Both halves mount only when enabled (and, for the volume, when
// intensity and length are positive): with the defaults off,
// this component returns null and the render is bit-identical
// to v1.29.0. It lives inside the SceneGroup (mounted from
// AppSceneLayerContent), so its coordinates are the light's own
// local coordinates, rotation included.

const VOLUME_VERTEX = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vScene;
  uniform vec3 uSceneOrigin;
  uniform vec4 uSceneQuat;
  uniform vec3 uMeshOffset;
  uniform float uMeshFlip;
  vec3 quatRotate(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    // Scene-local position (the frame the shadow bake lives in):
    // mesh flip/offset first, then the light group's quaternion,
    // then the light position. vWorld includes the scene group's
    // own rotation and cannot be used for the bake sample.
    vec3 lp = position;
    if (uMeshFlip > 0.5) lp = vec3(lp.x, -lp.y, -lp.z);
    lp += uMeshOffset;
    vScene = uSceneOrigin + quatRotate(uSceneQuat, lp);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const VOLUME_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform float uIntensity;
  uniform float uSteps;
  uniform float uSoftness;
  uniform float uLength;
  uniform float uRadius;
  uniform float uShape; // 0 = cone, 1 = sphere
  // Occlusion-map shadow (Phase Z): the volume dims where the
  // baked occlusion says the light is blocked.
  uniform sampler2D uShadowMap;
  uniform float uShadowReady;
  uniform float uShadowExtent;
  uniform float uShadowStrength;
  varying vec3 vScene;
  // Scene depth occlusion (Phase 16 stage 1): the shared scene
  // depth capture (lib/sceneDepth.ts). uDepthReady 0 (no texture
  // bound — always the case while gpgpuDepthOcclusion is 0, when
  // the capture never mounts) skips this block entirely and the
  // accumulation below is the legacy formula verbatim.
  uniform sampler2D uSceneDepth;
  uniform float uDepthReady;
  uniform float uDepthOcclusion;
  uniform float uCamNear;
  uniform float uCamFar;
  uniform vec2 uResolution;
  ${SCENE_DEPTH_GLSL}

  float edgeExp() { return mix(0.8, 2.2, uSoftness); }

  void main() {
    // View chord through the volume, approximated by the
    // surface normal vs view direction: 1 through the middle of
    // the silhouette, 0 at its rim. (A radial density evaluated
    // ON the mesh surface would be identically zero, so the
    // chord carries the cross-beam falloff — see lib/lightVolume.ts.)
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float chord = abs(dot(normalize(vNormal), viewDir));
    float acc = 0.0;
    float n = uSteps;
    if (uShape < 0.5) {
      // Cone: local geometry space has the apex at +length/2 and
      // the base at -length/2 (ConeGeometry), so the axial
      // fraction is u = 0.5 - y / length.
      float u = clamp(0.5 - vLocal.y / uLength, 0.0, 1.0);
      for (int i = 0; i < 32; i++) {
        if (float(i) >= n) break;
        float s = u * (float(i) / n);
        acc += pow(1.0 - s, 1.3);
      }
      acc /= n;
      acc *= pow(chord, edgeExp());
    } else {
      for (int i = 0; i < 32; i++) {
        if (float(i) >= n) break;
        float f = float(i) / n;
        acc += 1.0 - f * f;
      }
      acc /= n;
      acc *= pow(chord, edgeExp()) * 1.4;
    }
    float a = clamp(uIntensity * acc, 0.0, 1.0);
    if (uShadowReady > 0.5 && uShadowStrength > 0.0) {
      vec2 suv = clamp(vScene.xz / (2.0 * uShadowExtent) + 0.5, 0.0, 1.0);
      float occ = texture2D(uShadowMap, suv).r;
      a *= 1.0 - uShadowStrength * occ * 0.8;
    }
    if (uDepthReady > 0.5 && uDepthOcclusion > 0.0) {
      // Cut / fade the volume where an opaque surface sits in
      // front of this fragment: the scene depth at this pixel vs
      // this fragment's own view depth, softened over 5% of the
      // fragment depth (min 1 world unit).
      vec2 duv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      float sceneDepth = kaloViewDepthFromBuffer(texture2D(uSceneDepth, duv).x, uCamNear, uCamFar);
      float fragDepth = -(viewMatrix * vec4(vWorld, 1.0)).z;
      float fade = kaloDepthFadeFactor(sceneDepth, fragDepth, max(fragDepth * 0.05, 1.0));
      a *= mix(1.0, fade, clamp(uDepthOcclusion, 0.0, 1.0));
    }
    if (a <= 0.001) discard;
    gl_FragColor = vec4(vec3(1.0), a);
  }
`;

export const LightVolume: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const volumeParams = {
    enabled: config.gpgpuLightVolumeEnabled,
    shape: config.gpgpuLightVolumeShape,
    intensity: config.gpgpuLightVolumeIntensity,
    length: config.gpgpuLightVolumeLength,
    angleDeg: config.gpgpuLightVolumeAngle,
    steps: clampVolumeSteps(config.gpgpuLightVolumeSteps),
    softness: clampVolumeSoftness(config.gpgpuLightVolumeSoftness),
  };
  const volumeDraws = lightVolumeDraws(volumeParams);
  const trailEnabled = config.gpgpuLightTrailEnabled && config.gpgpuLightTrailWidth > 0;

  const lightPos = React.useMemo<TrailVec3>(
    () => ({ x: config.gpgpuLightPosX, y: config.gpgpuLightPosY, z: config.gpgpuLightPosZ }),
    [config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ],
  );

  // ── Trail history (frame-ordered, deterministic) ──
  const historyRef = React.useRef<TrailVec3[]>([]);
  const [historyVersion, setHistoryVersion] = React.useState(0);
  useFrame(() => {
    if (!trailEnabled) return;
    const next = appendTrailPoint(historyRef.current, lightPos);
    if (next !== historyRef.current) {
      historyRef.current = next;
      setHistoryVersion((v) => v + 1);
    }
  });

  const trailGeometry = React.useMemo(() => {
    if (!trailEnabled || historyVersion === 0) return null;
    const ribbon = buildLightTrailRibbon(historyRef.current, {
      width: config.gpgpuLightTrailWidth,
      fade: config.gpgpuLightTrailFade,
    });
    if (!ribbon) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ribbon.positions, 3));
    const colors = new Float32Array(ribbon.brightness.length * 3);
    for (let i = 0; i < ribbon.brightness.length; i++) {
      colors[i * 3] = ribbon.brightness[i];
      colors[i * 3 + 1] = ribbon.brightness[i];
      colors[i * 3 + 2] = ribbon.brightness[i];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(ribbon.indices, 1));
    return geo;
    // historyVersion is the rebuild trigger for the ref's contents.
     
  }, [trailEnabled, historyVersion, config.gpgpuLightTrailWidth, config.gpgpuLightTrailFade]);

  React.useEffect(() => {
    return () => {
      trailGeometry?.dispose();
    };
  }, [trailGeometry]);

  // ── Volume geometry / material ──
  const volumeGeometry = React.useMemo(() => {
    if (!volumeDraws) return null;
    if (volumeParams.shape === 'sphere') {
      return new THREE.SphereGeometry(volumeParams.length, 48, 32);
    }
    const radius = Math.tan((Math.max(1, Math.min(89, volumeParams.angleDeg)) * Math.PI) / 180) * volumeParams.length;
    return new THREE.ConeGeometry(radius, volumeParams.length, 48, 1, true);
  }, [volumeDraws, volumeParams.shape, volumeParams.length, volumeParams.angleDeg]);

  React.useEffect(() => {
    return () => {
      volumeGeometry?.dispose();
    };
  }, [volumeGeometry]);

  const shadowBake = React.useMemo(() => {
    if (!config.gpgpuShadowEnabled || !(config.gpgpuShadowStrength > 0)) return null;
    const bake = bakeShadowOcclusionMap(buildShadowScene(config), 64);
    const tex = new THREE.DataTexture(bake.data, bake.resolution, bake.resolution, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return { tex, extent: bake.extent };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.gpgpuShadowEnabled, config.gpgpuShadowStrength, config.gpgpuShadowSoftness, config.gpgpuShadowSourceTerrain, config.gpgpuShadowSourceObj, config.gpgpuMorphTerrainAmplitude, config.gpgpuMorphTerrainFrequency, config.gpgpuMorphTerrainOctaves, config.gpgpuMorphTerrainSeed, config.gpgpuMorphTerrainKind, config.gpgpuMorphTerrainTerraceSteps, config.gpgpuMorphTerrainErosionWater, config.gpgpuMorphTerrainErosionDroplets, config.gpgpuMorphTerrainErosionDeposit, config.gpgpuMorphTerrainErosionThermal, config.gpgpuMorphTerrainErosionTalus, config.gpgpuMorphTerrainErosionThermalPasses, config.gpgpuMorphTerrainErosionSeed, config.gpgpuTerrainMeshTunnel, config.gpgpuSeed, config.gpgpuMorphScale, config.gpgpuBounceRadius, config.gpgpuTerrainMeshScale, config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ, config.gpgpuObjMeshEnabled, config.gpgpuObjMeshScale, config.gpgpuObjMeshRepeat, config.gpgpuObjMeshPosX, config.gpgpuObjMeshPosY, config.gpgpuObjMeshPosZ, config.gpgpuMorphObjSource]);

  React.useEffect(() => {
    return () => {
      shadowBake?.tex.dispose();
    };
  }, [shadowBake]);

  const volumeMaterial = React.useMemo(() => {
    if (!volumeDraws) return null;
    const radius = Math.tan((Math.max(1, Math.min(89, volumeParams.angleDeg)) * Math.PI) / 180) * volumeParams.length;
    const dir0 = normalizeLightDir(config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir0[0], dir0[1], dir0[2]));
    const isCone = volumeParams.shape === 'cone';
    return new THREE.ShaderMaterial({
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
      uniforms: {
        uIntensity: { value: volumeParams.intensity },
        uSteps: { value: volumeParams.steps },
        uSoftness: { value: volumeParams.softness },
        uLength: { value: volumeParams.length },
        uRadius: { value: radius },
        uShape: { value: isCone ? 0 : 1 },
        uSceneOrigin: { value: new THREE.Vector3(lightPos.x, lightPos.y, lightPos.z) },
        uSceneQuat: { value: new THREE.Vector4(quat.x, quat.y, quat.z, quat.w) },
        uMeshOffset: { value: isCone ? new THREE.Vector3(0, volumeParams.length / 2, 0) : new THREE.Vector3(0, 0, 0) },
        uMeshFlip: { value: isCone ? 1 : 0 },
        uShadowMap: { value: shadowBake ? shadowBake.tex : null },
        uShadowReady: { value: shadowBake ? 1 : 0 },
        uShadowExtent: { value: shadowBake ? shadowBake.extent : 1 },
        uShadowStrength: { value: config.gpgpuShadowStrength },
        // Scene depth occlusion (Phase 16 stage 1): inert defaults;
        // the useFrame sync below binds the captured depth only
        // while gpgpuDepthOcclusion > 0 and a capture exists.
        uSceneDepth: { value: null },
        uDepthReady: { value: 0 },
        uDepthOcclusion: { value: 0 },
        uCamNear: { value: 0.1 },
        uCamFar: { value: 10000 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [volumeDraws, volumeParams.intensity, volumeParams.steps, volumeParams.softness, volumeParams.length, volumeParams.angleDeg, volumeParams.shape, shadowBake, config.gpgpuShadowStrength, config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ, lightPos]);

  React.useEffect(() => {
    return () => {
      volumeMaterial?.dispose();
    };
  }, [volumeMaterial]);

  // Scene depth occlusion sync (Phase 16 stage 1): subscribing to
  // the depth store keeps this component in step with the capture;
  // the uniforms are (re)bound per frame from the live store so a
  // camera near/far change or a capture resize is followed. While
  // the strength is 0 the binding is explicitly cleared, keeping
  // uDepthReady at 0 and the fragment on its legacy path.
  const depthSource = useSceneDepthSource();
  const gl = useThree((state) => state.gl);
  const depthOcclusion = config.gpgpuDepthOcclusion;
  useFrame(() => {
    if (!volumeMaterial) return;
    const u = volumeMaterial.uniforms;
    const source = depthOcclusion > 0 ? (depthSource ?? getSceneDepthSource()) : null;
    if (source) {
      u.uSceneDepth.value = source.texture;
      u.uDepthReady.value = 1;
      u.uDepthOcclusion.value = Math.min(1, Math.max(0, depthOcclusion));
      u.uCamNear.value = source.near;
      u.uCamFar.value = source.far;
      const size = gl.getDrawingBufferSize(new THREE.Vector2());
      (u.uResolution.value as THREE.Vector2).set(Math.max(1, size.x), Math.max(1, size.y));
    } else {
      u.uSceneDepth.value = null;
      u.uDepthReady.value = 0;
      u.uDepthOcclusion.value = 0;
    }
  });

  if (!volumeDraws && !trailEnabled) return null;

  const dir = normalizeLightDir(config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ);
  const dirVec = new THREE.Vector3(dir[0], dir[1], dir[2]);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirVec);

  return (
    <group>
      {volumeDraws && volumeGeometry && volumeMaterial && (
        <group position={[lightPos.x, lightPos.y, lightPos.z]} quaternion={quaternion}>
          {volumeParams.shape === 'cone' ? (
            // ConeGeometry's apex points +Y in local space; rotate
            // PI around X so the apex sits at the group origin and
            // the base extends along +Y (= the light direction).
            <mesh
              geometry={volumeGeometry}
              material={volumeMaterial}
              position={[0, volumeParams.length / 2, 0]}
              rotation={[Math.PI, 0, 0]}
              renderOrder={5}
              frustumCulled={false}
            />
          ) : (
            <mesh geometry={volumeGeometry} material={volumeMaterial} renderOrder={5} frustumCulled={false} />
          )}
        </group>
      )}
      {trailEnabled && trailGeometry && (
        <mesh geometry={trailGeometry} renderOrder={4} frustumCulled={false}>
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={0.85}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};
