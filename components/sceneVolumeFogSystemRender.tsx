import React from 'react';
import { getFogSliceTransform } from './sceneVolumeFogSystemTransforms';
import { createVolumeFogMaterial } from './sceneVolumeFogSystemMaterial';
import type { VolumeFogRuntimeState } from './sceneVolumeFogSystemRuntime';

export const VolumeFogSystemRender: React.FC<{ layerIndex: 2 | 3; runtime: VolumeFogRuntimeState }> = ({ layerIndex, runtime }) => {
  const {
    rootRef,
    materialsRef,
    sliceMeshRefs,
    layerMode,
    layerSource,
    profile,
    sharedColor,
    fogOpacity,
    fogDensity,
    fogScale,
    fogDrift,
    fogGlow,
    fogAnisotropy,
    materialStyleIndex,
    sliceCount,
    sliceOffsets,
    planeScale,
    globalRadius,
    pyroDensityAmount,
    pyroTempAmount,
    fogFragmentShader,
  } = runtime;

  // Materials are created from materialsRef during this
  // render (below), so when the effective fragment shader (or
  // the slice layout the materials were built for) changes,
  // the ref is reset HERE, in the same render that recreates
  // them. Resetting in an effect instead left the meshes
  // rendering the disposed previous materials whenever no
  // further render followed the effect — in a settled live
  // session the second and later GLSL swaps never reached the
  // screen (Phase CE gate finding). The key mirrors the
  // former effect's dependency set.
  const materialsKey = `${fogFragmentShader}|${sliceCount}|${layerMode}|${layerSource}`;
  const materialsKeyRef = React.useRef(materialsKey);
  if (materialsKeyRef.current !== materialsKey) {
    materialsRef.current.forEach((material) => material.dispose());
    materialsRef.current = [];
    materialsKeyRef.current = materialsKey;
  }

  return (
    <group ref={rootRef}>
      {sliceOffsets.map((z, index) => {
        const material = materialsRef.current[index] ?? createVolumeFogMaterial({
          sharedColor,
          fogOpacity,
          fogDensity,
          fogScale,
          fogDrift,
          fogGlow,
          fogAnisotropy,
          materialStyleIndex,
          sliceCount,
          profile,
          pyroTexture: null,
          pyroResolution: 0,
          pyroFloatLinear: false,
          pyroDensityAmount,
          pyroTempAmount,
          pyroHalfExtent: 150,
          sliceIndex: index,
          fragmentShader: fogFragmentShader,
        });
        materialsRef.current[index] = material;
        const transform = getFogSliceTransform(
          layerMode,
          layerSource,
          index,
          sliceCount,
          z,
          planeScale * profile.planeScaleMul,
          globalRadius,
          0,
        );
        return (
          <mesh
            key={`${layerIndex}-${index}`}
            ref={(instance) => {
              sliceMeshRefs.current[index] = instance;
            }}
            position={transform.position}
            rotation={transform.rotation}
            scale={transform.scale}
            material={material}
            renderOrder={5 + index * 0.01}
          >
            <planeGeometry args={[1, 1, 1, 1]} />
          </mesh>
        );
      })}
    </group>
  );
};
