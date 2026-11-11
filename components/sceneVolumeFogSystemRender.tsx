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
  } = runtime;

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
          sliceIndex: index,
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
