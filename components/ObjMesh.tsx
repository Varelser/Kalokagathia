import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  buildObjMeshGeometryData,
  objMeshRepeatTransforms,
  objMeshWorldScale,
} from '../lib/objMesh';

// OBJ Mesh (Phase V, Mir-style mesh side of the OBJ import): the
// polygon counterpart to the Phase J/O morph point cloud. The
// geometry comes from the SAME config text the morph target reads
// (gpgpuMorphObjSource, parsed by the shared lib/objMorph.ts
// parser) and is normalised exactly like the sampler, then scaled
// by the morph world scale — so the mesh and the OBJ point cloud
// occupy the same world footprint and can be shown together.
// Copies repeat on a centred cube grid (lib/objMesh.ts), and the
// whole assembly takes a position / Y-rotation transform.
//
// The system mounts ONLY when gpgpuObjMeshEnabled is set and the
// source parses: with the default off (or no usable OBJ) this
// component returns null, no lights exist, and the render is
// bit-identical to the pre-Phase-V scene. The geometry is a pure
// function of the config, so deterministic renders reproduce it
// exactly. Monochrome greys only, like the terrain mesh.

export const ObjMesh: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const enabled = config.gpgpuObjMeshEnabled;
  const display = config.gpgpuObjMeshDisplay;
  const repeat = config.gpgpuObjMeshRepeat;
  const meshScale = config.gpgpuObjMeshScale;
  const opacity = config.gpgpuObjMeshOpacity;
  const source = config.gpgpuMorphObjSource;
  const morphScale = config.gpgpuMorphScale;
  const bounceRadius = config.gpgpuBounceRadius;

  const geometry = React.useMemo(() => {
    if (!enabled || !source) return null;
    const data = buildObjMeshGeometryData(source);
    if (!data) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    return geo;
  }, [enabled, source]);

  React.useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  const repeatMode = config.gpgpuObjMeshRepeatMode;
  const repeatRotation = config.gpgpuObjMeshRepeatRotation;
  const repeatScaleStep = config.gpgpuObjMeshRepeatScaleStep;
  const copies = React.useMemo(() => {
    if (!enabled || !geometry) return null;
    return objMeshRepeatTransforms(repeat, repeatMode, repeatRotation, repeatScaleStep);
  }, [enabled, geometry, repeat, repeatMode, repeatRotation, repeatScaleStep]);

  if (!enabled || !geometry || !copies) return null;

  const worldScale = objMeshWorldScale(morphScale, bounceRadius, meshScale);
  const grey = 0.84;
  const color = new THREE.Color(grey, grey, grey * 1.03);
  const transparent = opacity < 0.999;
  const rotY = (config.gpgpuObjMeshRotY * Math.PI) / 180;

  return (
    <group
      position={[config.gpgpuObjMeshPosX, config.gpgpuObjMeshPosY, config.gpgpuObjMeshPosZ]}
      rotation={[0, rotY, 0]}
    >
      {/* Lights mount with the system only (same convention as the
          terrain mesh): the rest of the scene is shader-driven,
          and with the mesh off nothing here exists. */}
      <ambientLight intensity={0.8} />
      <directionalLight position={[90, 160, 70]} intensity={1.7} />
      <directionalLight position={[-110, 40, -90]} intensity={0.35} />
      {copies.map((copy, i) => {
        const position: [number, number, number] = [
          copy.offset[0] * worldScale,
          copy.offset[1] * worldScale,
          copy.offset[2] * worldScale,
        ];
        const copyScale = worldScale * copy.scale;
        const copyRotY = (copy.rotYDeg * Math.PI) / 180;
        return display === 'solid' ? (
          <mesh key={i} geometry={geometry} position={position} rotation={[0, copyRotY, 0]} scale={copyScale}>
            <meshStandardMaterial
              color={color}
              roughness={0.92}
              metalness={0.0}
              transparent={transparent}
              opacity={opacity}
              side={THREE.DoubleSide}
            />
          </mesh>
        ) : (
          <mesh key={i} geometry={geometry} position={position} rotation={[0, copyRotY, 0]} scale={copyScale}>
            <meshBasicMaterial
              color={color}
              wireframe
              transparent={transparent}
              opacity={opacity}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
};
