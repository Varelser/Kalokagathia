import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { AuxMode, ParticleData } from './particleData';
import { getLayerRuntimeLineSnapshot } from '../lib/sceneRenderRouting';
import { LineSystem } from './sceneLineSystem';
import { getParticleBlendMode } from './sceneShared';
import { FRAGMENT_SHADER, PARTICLE_VERTEX_SHADER } from './sceneShaders';

type ParticleSystemRenderProps = {
  config: ParticleConfig;
  layerIndex: 1 | 2 | 3 | 4;
  isAux: boolean;
  auxMode: AuxMode;
  data: ParticleData;
  geometryKey: string;
  geomMode3D: string;
  meshRef: React.RefObject<THREE.InstancedMesh | null>;
  uniforms: Record<string, { value: unknown }>;
  ghostMats: THREE.ShaderMaterial[];
  contactAmount: number;
  isPlaying: boolean;
};

function ParticleGeometry({ geomMode3D, data }: { geomMode3D: string; data: ParticleData }) {
  const attrs = (
    <>
      <instancedBufferAttribute attach="attributes-aPosition" args={[data.pos, 3]} />
      <instancedBufferAttribute attach="attributes-aOffset" args={[data.off, 3]} />
      <instancedBufferAttribute attach="attributes-aData1" args={[data.d1, 4]} />
      <instancedBufferAttribute attach="attributes-aData2" args={[data.d2, 4]} />
      <instancedBufferAttribute attach="attributes-aData3" args={[data.d3, 4]} />
      <instancedBufferAttribute attach="attributes-aFeedbackIndex" args={[data.fidx, 1]} />
    </>
  );

  if (geomMode3D === 'cube') return <boxGeometry args={[1, 1, 1]}>{attrs}</boxGeometry>;
  if (geomMode3D === 'tetra') return <tetrahedronGeometry args={[0.7]}>{attrs}</tetrahedronGeometry>;
  if (geomMode3D === 'icosa') return <icosahedronGeometry args={[0.72]}>{attrs}</icosahedronGeometry>;
  return <planeGeometry args={[1, 1]}>{attrs}</planeGeometry>;
}

export function renderParticleSystemContent({
  config,
  layerIndex,
  isAux,
  data,
  geometryKey,
  geomMode3D,
  meshRef,
  uniforms,
  ghostMats,
  contactAmount,
  isPlaying,
}: ParticleSystemRenderProps) {
  const lineRuntime = !isAux && (layerIndex === 2 || layerIndex === 3)
    ? getLayerRuntimeLineSnapshot(config, layerIndex)
    : null;
  const showLines = Boolean(lineRuntime?.connectionEnabled);
  const lineRadius = lineRuntime ? config.sphereRadius * lineRuntime.radiusScale : config.sphereRadius;
  const connDist = lineRuntime?.connectionDistance ?? 50;
  const connOp = lineRuntime?.connectionOpacity ?? 0.2;

  return (
    <group>
      <instancedMesh key={geometryKey} ref={meshRef} args={[undefined, undefined, data.count]}>
        <ParticleGeometry geomMode3D={geomMode3D} data={data} />
        <shaderMaterial
          key={`mat-${config.backgroundColor}`}
          vertexShader={PARTICLE_VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          uniforms={uniforms}
          transparent={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={getParticleBlendMode(config.backgroundColor)}
        />
      </instancedMesh>
      {showLines && (
        <LineSystem
          config={config}
          layerIndex={layerIndex as 2 | 3}
          particleData={data}
          uniforms={uniforms}
          globalRadius={lineRadius}
          connectionDistance={connDist}
          connectionOpacity={connOp}
          contactAmount={contactAmount}
          isPlaying={isPlaying}
        />
      )}
      {ghostMats.map((gmat, i) => (
        <instancedMesh key={`ghost-${i}-${geometryKey}`} args={[undefined, undefined, data.count]}>
          <planeGeometry args={[1, 1]}>
            <instancedBufferAttribute attach="attributes-aPosition" args={[data.pos, 3]} />
            <instancedBufferAttribute attach="attributes-aOffset" args={[data.off, 3]} />
            <instancedBufferAttribute attach="attributes-aData1" args={[data.d1, 4]} />
            <instancedBufferAttribute attach="attributes-aData2" args={[data.d2, 4]} />
            <instancedBufferAttribute attach="attributes-aData3" args={[data.d3, 4]} />
            <instancedBufferAttribute attach="attributes-aFeedbackIndex" args={[data.fidx, 1]} />
          </planeGeometry>
          <primitive object={gmat} attach="material" />
        </instancedMesh>
      ))}
    </group>
  );
}
