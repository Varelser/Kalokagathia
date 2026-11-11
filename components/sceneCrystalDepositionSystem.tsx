import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { generateParticleData, type ParticleData } from './particleData';
import { estimateLayerPositionApprox } from './sceneMotionEstimator';
import { getLayerParticleLayoutDeps, getLayerRuntimeCrystalDepositionSnapshot } from '../lib/sceneRenderRouting';

type HybridSettings = {
  opacity: number;
  crystalScale: number;
  density: number;
  relief: number;
  audioReactive: number;
  wireframe: boolean;
  color: string;
  materialStyle: ParticleConfig['layer2MaterialStyle'];
  source: ParticleConfig['layer2Source'];
  radiusScale: number;
};

type SurfaceProfile = {
  ringEtch: number;
  vein: number;
  terrace: number;
  plumeShear: number;
  basin: number;
  orbit: number;
  fan: number;
  plateScaleX: number;
  plateScaleY: number;
  pitch: number;
  roll: number;
  yaw: number;
  offsetMul: number;
  normalBias: number;
  elongation: number;
};

type Layout = {
  particleData: ParticleData;
  anchorIndices: Uint32Array;
  instanceCount: number;
};

const temp = new THREE.Vector3();
const next = new THREE.Vector3();
const tangent = new THREE.Vector3();
const offset = new THREE.Vector3();
const radial = new THREE.Vector3();
const swirl = new THREE.Vector3();
const up = new THREE.Vector3(0,1,0);
const quat = new THREE.Quaternion();
const scaleVec = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const color = new THREE.Color();

function fract(v:number){return v-Math.floor(v)}
function hash(v:number){return fract(Math.sin(v*127.13+19.37)*43758.5453123)}
function shash(v:number){return hash(v)*2-1}

function getSettings(config: ParticleConfig, layerIndex: 2 | 3): HybridSettings {
  const runtime = getLayerRuntimeCrystalDepositionSnapshot(config, layerIndex);
  return {
    opacity: runtime.opacity,
    crystalScale: runtime.crystalScale,
    density: runtime.density,
    relief: runtime.relief,
    audioReactive: runtime.audioReactive,
    wireframe: runtime.wireframe,
    color: runtime.color,
    materialStyle: runtime.materialStyle,
    source: runtime.source,
    radiusScale: runtime.radiusScale,
  };
}

function getSurfaceProfile(source: ParticleConfig['layer2Source'], style: ParticleConfig['layer2MaterialStyle']): SurfaceProfile {
  const base: SurfaceProfile = {
    ringEtch: 0.12,
    vein: 0.18,
    terrace: 0.14,
    plumeShear: 0.1,
    basin: 0.12,
    orbit: 0,
    fan: 0.08,
    plateScaleX: 1.12,
    plateScaleY: 0.9,
    pitch: 0.12,
    roll: 0.18,
    yaw: 0.16,
    offsetMul: 1,
    normalBias: 0.18,
    elongation: 1.18,
  };
  switch (source) {
    case 'text':
      Object.assign(base, { vein: 0.42, terrace: 0.34, plumeShear: 0.04, fan: 0.02, plateScaleX: 1.36, plateScaleY: 0.72, roll: 0.04, offsetMul: 0.84, normalBias: 0.3, elongation: 1.42 });
      break;
    case 'image':
    case 'video':
      Object.assign(base, { vein: 0.28, plumeShear: 0.26, basin: 0.18, fan: 0.16, plateScaleX: 1.22, plateScaleY: 0.84, pitch: 0.18, offsetMul: 1.08, elongation: 1.26 });
      break;
    case 'ring':
    case 'disc':
    case 'torus':
      Object.assign(base, { ringEtch: 0.52, vein: 0.12, terrace: 0.1, orbit: 0.34, fan: 0.26, plateScaleX: 1.28, plateScaleY: 0.78, yaw: 0.38, offsetMul: 1.06, normalBias: 0.12, elongation: 1.38 });
      break;
    case 'spiral':
    case 'galaxy':
      Object.assign(base, { ringEtch: 0.28, vein: 0.18, plumeShear: 0.32, orbit: 0.28, fan: 0.14, plateScaleX: 1.18, plateScaleY: 0.82, yaw: 0.32, offsetMul: 1.02, normalBias: 0.16, elongation: 1.3 });
      break;
    case 'grid':
    case 'plane':
      Object.assign(base, { vein: 0.36, terrace: 0.42, basin: 0.08, fan: 0.04, plateScaleX: 1.3, plateScaleY: 0.8, roll: 0.08, offsetMul: 0.9, normalBias: 0.28, elongation: 1.24 });
      break;
    case 'cube':
    case 'cylinder':
    case 'cone':
      Object.assign(base, { vein: 0.22, terrace: 0.2, plumeShear: 0.18, basin: 0.22, fan: 0.18, plateScaleX: 1.08, plateScaleY: 0.96, pitch: 0.22, roll: 0.24, offsetMul: 1.16, normalBias: 0.24, elongation: 1.2 });
      break;
    case 'center':
    case 'random':
      Object.assign(base, { basin: 0.28, fan: 0.18, plumeShear: 0.16, plateScaleX: 1.06, plateScaleY: 0.94, offsetMul: 1.1, normalBias: 0.22, elongation: 1.16 });
      break;
    case 'sphere':
    default:
      break;
  }
  if (style === 'glass') {
    base.ringEtch += 0.08;
    base.offsetMul *= 0.92;
  } else if (style === 'chrome') {
    base.vein += 0.06;
    base.terrace += 0.08;
  } else if (style === 'hologram') {
    base.plumeShear += 0.08;
    base.orbit += 0.08;
  } else if (style === 'halftone') {
    base.terrace += 0.06;
    base.vein += 0.04;
  }
  return base;
}

function buildLayout(config: ParticleConfig, layerIndex: 2 | 3): Layout | null {
  const particleData = generateParticleData(config, layerIndex, false, 'aux');
  if (!particleData || particleData.count < 4) return null;
  const settings = getSettings(config, layerIndex);
  const anchorCount = Math.max(10, Math.min(80, Math.floor(particleData.count / Math.max(8, 18 - settings.density))));
  const anchorIndices = new Uint32Array(anchorCount);
  for (let i=0;i<anchorCount;i+=1) anchorIndices[i] = Math.min(particleData.count-1, Math.floor((i / Math.max(1, anchorCount-1))*Math.max(0, particleData.count-1)));
  return { particleData, anchorIndices, instanceCount: anchorCount };
}

const VERT = `
  uniform float uTime;
  uniform float uRelief;
  uniform float uPulse;
  uniform float uAudioReactive;
  uniform float uRingEtch;
  uniform float uVein;
  uniform float uTerrace;
  uniform float uPlumeShear;
  varying vec2 vUv;
  varying float vHeight;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.)); vec2 u=f*f*(3.-2.*f); return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y; }
  float fbm(vec2 p){ float v=0.; float a=.5; for(int i=0;i<4;i++){ v+=noise(p)*a; p=p*2.03+vec2(17.2,-11.8); a*=0.5; } return v; }
  void main(){
    vUv=uv;
    vec3 pos=position;
    vec2 centered=uv*2.0-1.0;
    float field=fbm(uv*4.0+vec2(uTime*0.035,-uTime*0.02));
    float ridge=abs(field*2.0-1.0);
    float ring=1.0-smoothstep(0.08, 0.72, abs(length(centered)-0.58));
    float veins=0.5+0.5*sin((centered.x+centered.y*0.42)*18.0 + field*6.0 + uTime*0.25);
    float terrace=floor((field + ring*uRingEtch*0.6 + veins*uVein*0.35) * (3.0 + uTerrace*6.0)) / (3.0 + uTerrace*6.0);
    float plume=(centered.y+1.0)*0.5 + centered.x*uPlumeShear*0.4;
    vHeight=mix(ridge, terrace, 0.35) + ring*uRingEtch*0.42 + veins*uVein*0.22;
    pos.z += ((ridge-0.35) * 96.0 + ring*uRingEtch*28.0 + veins*uVein*20.0 + terrace*uTerrace*32.0 + plume*uPlumeShear*18.0) * uRelief + uPulse * uAudioReactive * 18.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
  }
`;
const FRAG = `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uMaterialStyle;
  uniform float uPulse;
  uniform float uRingEtch;
  uniform float uVein;
  uniform float uTerrace;
  varying vec2 vUv; varying float vHeight;
  void main(){
    vec2 centered=vUv*2.0-1.0;
    float ring=1.0-smoothstep(0.08, 0.72, abs(length(centered)-0.58));
    float veins=0.5+0.5*sin((centered.x+centered.y*0.42)*18.0 + vHeight*8.0);
    float terrace=step(0.5, fract(vHeight * (2.0 + uTerrace * 4.0)));
    vec3 col = mix(uColor*0.34, uColor, smoothstep(0.18,0.92,vHeight));
    col += vec3(1.0) * ring * uRingEtch * 0.12;
    col = mix(col, vec3(1.0), veins * uVein * 0.08);
    float alpha = uOpacity * (0.4 + vHeight*0.75 + terrace * uTerrace * 0.16);
    if (uMaterialStyle > 0.5 && uMaterialStyle < 1.5) { col = mix(col, vec3(0.96,0.98,1.0), 0.26); alpha *= 0.82; }
    else if (uMaterialStyle > 1.5 && uMaterialStyle < 2.5) { col = mix(col, vec3(0.14,0.95,1.0), 0.44); }
    else if (uMaterialStyle > 2.5 && uMaterialStyle < 3.5) { float band=0.5+0.5*sin(vUv.y*22.0+vHeight*8.0); col = mix(vec3(0.15), vec3(1.0), band) * mix(uColor, vec3(1.0), 0.4); }
    else if (uMaterialStyle > 3.5) { vec2 cell=fract(vUv*18.0)-0.5; float dots=1.0-smoothstep(0.1,0.34,length(cell)); alpha*=mix(0.42,1.0,dots); col*=0.5+dots*0.6; }
    col += vec3(1.0) * uPulse * 0.04;
    gl_FragColor = vec4(col, alpha);
  }
`;

function styleify(baseColor: THREE.Color, style: HybridSettings['materialStyle'], pulse: number) {
  const c = baseColor.clone();
  let emissive = c.clone().multiplyScalar(0.15 + pulse * 0.08);
  let opacityMul = 1;
  if (style === 'glass') { c.lerp(new THREE.Color('#f1fbff'), 0.28); opacityMul = 0.78; }
  else if (style === 'hologram') { c.lerp(new THREE.Color('#4afff0'), 0.42); emissive = new THREE.Color('#39f9ff').multiplyScalar(0.36 + pulse * 0.28); }
  else if (style === 'chrome') { c.setScalar(0.3 + 0.7 * (0.5 + 0.5 * Math.sin(baseColor.r * 12 + pulse * 8))).lerp(baseColor, 0.3); emissive = new THREE.Color('#ffffff').multiplyScalar(0.04 + pulse * 0.04); }
  else if (style === 'halftone') { c.multiplyScalar(0.72); opacityMul = 0.88; }
  return { color: c, emissive, opacityMul };
}


function getLayoutDeps(config: ParticleConfig, layerIndex: 2 | 3) {
  const runtime = getLayerRuntimeCrystalDepositionSnapshot(config, layerIndex);
  return getLayerParticleLayoutDeps(config, layerIndex, [runtime.density]);
}
export const CrystalDepositionSystem: React.FC<{
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef: React.MutableRefObject<{ bass: number; treble: number; pulse: number; bandA: number; bandB: number }>;
  isPlaying: boolean;
}> = ({ config, layerIndex, audioRef, isPlaying }) => {
  const groupRef = useRef<THREE.Group>(null);
  const planeMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const crystalMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const settings = getSettings(config, layerIndex);
  // eslint-disable-next-line react-hooks/use-memo, react-hooks/exhaustive-deps -- deps come from a get*Deps() helper listing the exact config fields this layout reads; a literal [config] dep would rebuild the geometry on every config change.
  const layout = useMemo(() => buildLayout(config, layerIndex), getLayoutDeps(config, layerIndex));
  const planeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1, 68, 68), []);
  const crystalGeometry = useMemo(() => new THREE.OctahedronGeometry(1, 0), []);
  React.useEffect(() => () => { planeGeometry.dispose(); crystalGeometry.dispose(); }, [planeGeometry, crystalGeometry]);

  useFrame(({ clock }) => {
    const group = groupRef.current, planeMat = planeMaterialRef.current, crystalMat = crystalMaterialRef.current, mesh = meshRef.current;
    if (!group || !planeMat || !crystalMat || !mesh || !layout) return;
    const t = clock.getElapsedTime();
    const surfaceProfile = getSurfaceProfile(settings.source, settings.materialStyle);
    const globalRadius = config.sphereRadius * settings.radiusScale;
    const pulse = config.audioEnabled ? audioRef.current.pulse * config.audioBurstScale : 0;
    const bass = config.audioEnabled ? audioRef.current.bass * config.audioBeatScale : 0;
    const audioDrive = isPlaying ? (pulse + bass * 0.65) * settings.audioReactive : 0;
    // center plane around average
    const center = new THREE.Vector3();
    const sampleCount = Math.min(24, layout.particleData.count);
    for (let i=0;i<sampleCount;i+=1) {
      const idx = Math.floor((i / Math.max(1, sampleCount-1)) * Math.max(0, layout.particleData.count-1));
      center.add(estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: idx, globalRadius, time: t }));
    }
    center.multiplyScalar(1 / Math.max(1, sampleCount));
    group.position.copy(center.multiplyScalar(0.3));
    group.rotation.x = -Math.PI / 2 + surfaceProfile.pitch + Math.sin(t * 0.1 + layerIndex) * 0.12;
    group.rotation.y = surfaceProfile.yaw * Math.sin(t * 0.12 + layerIndex * 0.4);
    group.rotation.z = surfaceProfile.roll + Math.cos(t * 0.08 + layerIndex * 0.3) * 0.18;
    const planeScale = globalRadius * (1.12 + settings.relief * 0.26 + audioDrive * 0.08);
    group.scale.set(planeScale * surfaceProfile.plateScaleX, planeScale * (0.86 + settings.relief * 0.08) * surfaceProfile.plateScaleY, 1);

    planeMat.uniforms.uColor.value.set(settings.color);
    planeMat.uniforms.uOpacity.value = settings.opacity;
    planeMat.uniforms.uRelief.value = settings.relief;
    planeMat.uniforms.uPulse.value = pulse + bass * 0.25;
    planeMat.uniforms.uAudioReactive.value = settings.audioReactive;
    planeMat.uniforms.uTime.value = t;
    planeMat.uniforms.uMaterialStyle.value = settings.materialStyle === 'glass' ? 1 : settings.materialStyle === 'hologram' ? 2 : settings.materialStyle === 'chrome' ? 3 : settings.materialStyle === 'halftone' ? 4 : 0;
    planeMat.uniforms.uRingEtch.value = surfaceProfile.ringEtch;
    planeMat.uniforms.uVein.value = surfaceProfile.vein;
    planeMat.uniforms.uTerrace.value = surfaceProfile.terrace;
    planeMat.uniforms.uPlumeShear.value = surfaceProfile.plumeShear;
    planeMat.wireframe = settings.wireframe;

    const baseColor = color.set(settings.color);
    const styled = styleify(baseColor, settings.materialStyle, pulse + bass * 0.2);
    for (let i=0;i<layout.anchorIndices.length;i+=1) {
      const sourceIndex = layout.anchorIndices[i] ?? 0;
      const estimated = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t });
      const estimatedNext = estimateLayerPositionApprox({ config, layerIndex, particleData: layout.particleData, index: sourceIndex, globalRadius, time: t + 0.03 });
      temp.set(estimated.x, estimated.y, estimated.z); next.set(estimatedNext.x, estimatedNext.y, estimatedNext.z);
      tangent.copy(next).sub(temp); if (tangent.lengthSq() < 1e-5) tangent.set(shash(i+0.1), 1, shash(i+0.2)); tangent.normalize();
      radial.set(temp.x, 0, temp.z); if (radial.lengthSq() < 1e-5) radial.set(1, 0, 0); radial.normalize();
      swirl.set(-radial.z, 0, radial.x).normalize();
      const seed = i * 13.17;
      offset.set(shash(seed+1.1), Math.abs(shash(seed+2.3))*0.85 + settings.relief*0.6, shash(seed+3.5)).normalize().multiplyScalar(globalRadius * 0.08 * surfaceProfile.offsetMul * (0.55 + hash(seed+4.4) * 0.9));
      offset
        .addScaledVector(radial, surfaceProfile.ringEtch * globalRadius * 0.04 * Math.sin(seed + t * 0.28))
        .addScaledVector(swirl, surfaceProfile.orbit * globalRadius * 0.06 * Math.cos(seed * 0.6 + t * 0.44))
        .addScaledVector(tangent, surfaceProfile.vein * globalRadius * 0.04 * shash(seed + 6.2));
      const position = temp.clone().multiplyScalar(0.22)
        .add(offset)
        .addScaledVector(swirl, surfaceProfile.plumeShear * globalRadius * 0.03 * (temp.y / Math.max(globalRadius, 1)));
      if (surfaceProfile.terrace > 0) {
        position.y = Math.round(position.y / (globalRadius * 0.05)) * (globalRadius * 0.05 * (1 - surfaceProfile.terrace * 0.28));
      }
      position.addScaledVector(radial, -surfaceProfile.basin * globalRadius * 0.03 * hash(seed + 7.8));
      quat.setFromUnitVectors(up, tangent.clone().add(offset.clone().normalize().multiplyScalar(0.8 + surfaceProfile.normalBias)).add(swirl.clone().multiplyScalar(surfaceProfile.orbit * 0.35)).normalize());
      const crystalScale = globalRadius * 0.015 * settings.crystalScale * (0.75 + hash(seed+5.1) * 1.2) * (1 + audioDrive * 0.35);
      scaleVec.set(crystalScale, crystalScale * (1.2 + hash(seed+7.1) * 0.8) * surfaceProfile.elongation, crystalScale * (1 + surfaceProfile.fan * 0.4));
      matrix.compose(position, quat, scaleVec);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, styled.color.clone().offsetHSL(0,0,shash(seed+8.4)*0.06));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    crystalMat.opacity = settings.opacity * styled.opacityMul;
    crystalMat.color.copy(styled.color);
    crystalMat.emissive.copy(styled.emissive);
    crystalMat.roughness = settings.materialStyle === 'chrome' ? 0.16 : settings.materialStyle === 'glass' ? 0.08 : 0.46;
    crystalMat.metalness = settings.materialStyle === 'chrome' ? 0.92 : settings.materialStyle === 'glass' ? 0.24 : 0.12;
    crystalMat.wireframe = settings.wireframe;
  });

  if (!layout) return null;
  return (
    <group ref={groupRef} renderOrder={2}>
      <mesh geometry={planeGeometry}>
        <shaderMaterial ref={planeMaterialRef} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.AdditiveBlending}
          vertexShader={VERT} fragmentShader={FRAG}
          uniforms={{ uColor: { value: new THREE.Color(settings.color) }, uOpacity: { value: settings.opacity }, uRelief: { value: settings.relief }, uPulse: { value: 0 }, uAudioReactive: { value: settings.audioReactive }, uTime: { value: 0 }, uMaterialStyle: { value: 0 }, uRingEtch: { value: 0 }, uVein: { value: 0 }, uTerrace: { value: 0 }, uPlumeShear: { value: 0 } }}
        />
      </mesh>
      <instancedMesh ref={meshRef} args={[crystalGeometry, undefined, layout.instanceCount]} renderOrder={3}>
        <meshStandardMaterial ref={crystalMaterialRef} transparent depthWrite={false} vertexColors blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </group>
  );
};
