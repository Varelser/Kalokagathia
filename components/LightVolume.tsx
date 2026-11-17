import React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
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
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const volumeMaterial = React.useMemo(() => {
    if (!volumeDraws) return null;
    const radius = Math.tan((Math.max(1, Math.min(89, volumeParams.angleDeg)) * Math.PI) / 180) * volumeParams.length;
    return new THREE.ShaderMaterial({
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
      uniforms: {
        uIntensity: { value: volumeParams.intensity },
        uSteps: { value: volumeParams.steps },
        uSoftness: { value: volumeParams.softness },
        uLength: { value: volumeParams.length },
        uRadius: { value: radius },
        uShape: { value: volumeParams.shape === 'sphere' ? 1 : 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [volumeDraws, volumeParams.intensity, volumeParams.steps, volumeParams.softness, volumeParams.length, volumeParams.angleDeg, volumeParams.shape]);

  React.useEffect(() => {
    return () => {
      volumeMaterial?.dispose();
    };
  }, [volumeMaterial]);

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
