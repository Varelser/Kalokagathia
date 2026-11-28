import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { getSceneDepthSource, useSceneDepthSource } from '../lib/sceneDepth';
import { getParticleDensitySource } from '../lib/particleDensity';
import type { ParticleConfig } from '../types';
import { normalizeLightDir } from '../lib/gpgpuLight';
import {
  clampVolumeSteps,
  clampVolumeSoftness,
  clampVolumeDepthIntersect,
  clampVolumeDensity,
  lightVolumeDraws,
  volumeDepthIntersectOn,
  volumeDensityOn,
} from '../lib/lightVolume';
import { VOLUME_VERTEX, buildLightVolumeFragment } from './lightVolumeShader';
import {
  appendTrailPoint,
  buildLightTrailRibbon,
  type TrailVec3,
} from '../lib/lightTrail';
import { bakeShadowOcclusionMap, bakeTunnelShadowOcclusionMap, buildShadowScene } from '../lib/shadowOcclusion';

// Visible light volume + light trail (Phase Y).
//
// Volume: a dedicated cone / sphere mesh at the Phase T light's
// position, shaded by a raymarch-style accumulation over axial
// samples of an analytic density (lib/lightVolume.ts is the pure
// reference; the shader strings live in
// components/lightVolumeShader.ts). In its stock form it is
// draw-only and does NOT intersect scene depth — no occlusion —
// so edges are softened by the softness key instead; that limit
// is stated in the UI next to the controls. The depth-
// intersection variant (Layer 1 WP7 Phase B, behind
// gpgpuLightVolumeDepthIntersect > 0) lifts the limit: the
// accumulated beam is truncated by the visible fraction of the
// view chord in front of the scene surface, from the shared
// scene depth capture (lib/sceneDepth.ts). The density
// variant (Layer 1 WP7 Phase D, behind
// gpgpuLightVolumeDensity > 0) additionally attenuates the
// beam by the shared particle density field
// (lib/particleDensity.ts) at each fragment's screen position.
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
  // Depth intersection (Layer 1 WP7 Phase B): resolved once
  // here; the material assembles the extended fragment variant
  // only while the strength is positive, and the per-frame sync
  // below binds the depth supply for the volume's own sake as
  // well as for the global occlusion strength.
  const depthIntersectStrength = clampVolumeDepthIntersect(config.gpgpuLightVolumeDepthIntersect);
  const depthIntersectOn = volumeDepthIntersectOn(config);
  // Particle density attenuation (Layer 1 WP7 Phase D): the
  // volume joins the shared density field as a consumer while
  // the strength is positive; the material assembles the
  // density variant and the per-frame sync below binds the
  // field published by the GPGPU system's splat.
  const densityStrength = clampVolumeDensity(config.gpgpuLightVolumeDensity);
  const densityOn = volumeDensityOn(config);
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
    const scene = buildShadowScene(config);
    const bake = bakeShadowOcclusionMap(scene, 64);
    const tex = new THREE.DataTexture(bake.data, bake.resolution, bake.resolution, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // Tunnel occlusion bake (Round 83/84 gap 7): generated
    // alongside in tunnel mode; U wraps (periodic circumference).
    let tunnelTex: THREE.DataTexture | null = null;
    if (config.gpgpuTerrainMeshTunnel) {
      const tunnelBake = bakeTunnelShadowOcclusionMap(scene, 64);
      tunnelTex = new THREE.DataTexture(tunnelBake.data, tunnelBake.resolution, tunnelBake.resolution, THREE.RGBAFormat);
      tunnelTex.needsUpdate = true;
      tunnelTex.minFilter = THREE.LinearFilter;
      tunnelTex.magFilter = THREE.LinearFilter;
      tunnelTex.wrapS = THREE.RepeatWrapping;
      tunnelTex.wrapT = THREE.ClampToEdgeWrapping;
    }
    return { tex, extent: bake.extent, heightScale: bake.heightScale, tunnelTex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.gpgpuShadowEnabled, config.gpgpuShadowStrength, config.gpgpuShadowSoftness, config.gpgpuShadowSourceTerrain, config.gpgpuShadowSourceObj, config.gpgpuMorphTerrainAmplitude, config.gpgpuMorphTerrainFrequency, config.gpgpuMorphTerrainOctaves, config.gpgpuMorphTerrainSeed, config.gpgpuMorphTerrainKind, config.gpgpuMorphTerrainTerraceSteps, config.gpgpuMorphTerrainErosionWater, config.gpgpuMorphTerrainErosionDroplets, config.gpgpuMorphTerrainErosionDeposit, config.gpgpuMorphTerrainErosionThermal, config.gpgpuMorphTerrainErosionTalus, config.gpgpuMorphTerrainErosionThermalPasses, config.gpgpuMorphTerrainErosionSeed, config.gpgpuMorphTerrainErosionMaskMode, config.gpgpuMorphTerrainErosionMaskStrength, config.gpgpuMorphTerrainErosionMaskInvert, config.gpgpuMorphTerrainErosionMaskLow, config.gpgpuMorphTerrainErosionMaskHigh, config.gpgpuTerrainMeshTunnel, config.gpgpuSeed, config.gpgpuMorphScale, config.gpgpuBounceRadius, config.gpgpuTerrainMeshScale, config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ, config.gpgpuLight2Enabled, config.gpgpuLight2PosX, config.gpgpuLight2PosY, config.gpgpuLight2PosZ, config.gpgpuLight3Enabled, config.gpgpuLight3PosX, config.gpgpuLight3PosY, config.gpgpuLight3PosZ, config.gpgpuLight4Enabled, config.gpgpuLight4PosX, config.gpgpuLight4PosY, config.gpgpuLight4PosZ, config.gpgpuObjMeshEnabled, config.gpgpuObjMeshScale, config.gpgpuObjMeshRepeat, config.gpgpuObjMeshPosX, config.gpgpuObjMeshPosY, config.gpgpuObjMeshPosZ, config.gpgpuMorphObjSource]);

  React.useEffect(() => {
    return () => {
      shadowBake?.tex.dispose();
      shadowBake?.tunnelTex?.dispose();
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
      fragmentShader: buildLightVolumeFragment(depthIntersectOn, densityOn),
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
        uShadowTunnelMap: { value: shadowBake ? shadowBake.tunnelTex : null },
        uShadowTunnelReady: { value: shadowBake && shadowBake.tunnelTex ? 1 : 0 },
        uShadowHeightScale: { value: shadowBake ? shadowBake.heightScale : 1 },
        // Scene depth occlusion (Phase 16 stage 1): inert defaults;
        // the useFrame sync below binds the captured depth only
        // while gpgpuDepthOcclusion > 0 and a capture exists.
        uSceneDepth: { value: null },
        uDepthReady: { value: 0 },
        uDepthOcclusion: { value: 0 },
        // Depth intersection (Layer 1 WP7 Phase B): declared in
        // the fragment only in the extended variant; the sync
        // below drives it from the resolved strength.
        uDepthIntersect: { value: 0 },
        // Particle density (Layer 1 WP7 Phase D): declared in
        // the fragment only in the density variant; inert
        // defaults, bound per frame while the strength is
        // positive and the splat has published a field.
        uParticleDensity: { value: null },
        uVolumeDensity: { value: 0 },
        uVolumeDensityReady: { value: 0 },
        uCamNear: { value: 0.1 },
        uCamFar: { value: 10000 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [volumeDraws, volumeParams.intensity, volumeParams.steps, volumeParams.softness, volumeParams.length, volumeParams.angleDeg, volumeParams.shape, shadowBake, config.gpgpuShadowStrength, config.gpgpuLightDirX, config.gpgpuLightDirY, config.gpgpuLightDirZ, lightPos, depthIntersectOn, densityOn]);

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
  // uDepthReady at 0 and the fragment on its legacy path. The
  // binding also stands for the volume's own depth-intersection
  // strength (Layer 1 WP7 Phase B): AppScene mounts the capture
  // while either strength is positive.
  const depthSource = useSceneDepthSource();
  const gl = useThree((state) => state.gl);
  const depthOcclusion = config.gpgpuDepthOcclusion;
  useFrame(() => {
    if (!volumeMaterial) return;
    const u = volumeMaterial.uniforms;
    const source = depthOcclusion > 0 || depthIntersectOn ? (depthSource ?? getSceneDepthSource()) : null;
    if (source) {
      u.uSceneDepth.value = source.texture;
      u.uDepthReady.value = 1;
      u.uDepthOcclusion.value = Math.min(1, Math.max(0, depthOcclusion));
      u.uDepthIntersect.value = depthIntersectStrength;
      u.uCamNear.value = source.near;
      u.uCamFar.value = source.far;
      const size = gl.getDrawingBufferSize(new THREE.Vector2());
      (u.uResolution.value as THREE.Vector2).set(Math.max(1, size.x), Math.max(1, size.y));
    } else {
      u.uSceneDepth.value = null;
      u.uDepthReady.value = 0;
      u.uDepthOcclusion.value = 0;
      u.uDepthIntersect.value = 0;
    }
    // Particle density binding (Layer 1 WP7 Phase D): read the
    // shared density store per frame (the LightFx precedent —
    // the store has no subscription, consumers poll it in
    // their frame step). While the strength is 0 the binding
    // is explicitly cleared, keeping uVolumeDensityReady at 0
    // and the fragment on its non-density path; with no field
    // published yet the same holds, so the beam is unattenuated
    // until the splat first runs.
    const densitySource = densityOn ? getParticleDensitySource() : null;
    if (densitySource) {
      u.uParticleDensity.value = densitySource.texture;
      u.uVolumeDensity.value = densityStrength;
      u.uVolumeDensityReady.value = 1;
    } else {
      u.uParticleDensity.value = null;
      u.uVolumeDensity.value = 0;
      u.uVolumeDensityReady.value = 0;
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
