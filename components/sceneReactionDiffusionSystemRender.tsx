import React from 'react';
import * as THREE from 'three';
import type { ReactionMode, ReactionSource } from './sceneReactionDiffusionSystemShared';

type Props = {
  displayMaterial: THREE.ShaderMaterial;
  planeSize: number;
  zOffset: number;
  mode: ReactionMode;
  source: ReactionSource;
};

type GeometryVariant = {
  rotation: [number, number, number];
  geometry: React.ReactElement;
};

function buildSourceDrivenGeometry(planeSize: number, source: ReactionSource): GeometryVariant {
  const radius = planeSize * 0.5;
  switch (source) {
    case 'disc':
      return {
        rotation: [0, 0, 0],
        geometry: <circleGeometry args={[radius * 0.92, 128]} />,
      };
    case 'ring':
      return {
        rotation: [0, 0, 0],
        geometry: <ringGeometry args={[radius * 0.38, radius * 0.94, 128, 16]} />,
      };
    case 'torus':
      return {
        rotation: [Math.PI / 2, 0, 0],
        geometry: <torusGeometry args={[radius * 0.68, radius * 0.18, 72, 160]} />,
      };
    case 'cylinder':
      return {
        rotation: [Math.PI / 2, 0, 0],
        geometry: <cylinderGeometry args={[radius * 0.54, radius * 0.48, planeSize * 0.9, 96, 1, true]} />,
      };
    case 'cone':
      return {
        rotation: [Math.PI / 2, 0, 0],
        geometry: <coneGeometry args={[radius * 0.58, planeSize * 0.94, 96, 1, true]} />,
      };
    case 'cube':
      return {
        rotation: [0.18, 0.44, 0.08],
        geometry: <boxGeometry args={[planeSize * 0.76, planeSize * 0.76, planeSize * 0.76, 48, 48, 48]} />,
      };
    case 'spiral':
    case 'galaxy':
      return {
        rotation: [0.22, 0.48, 0],
        geometry: <sphereGeometry args={[radius * 0.78, 96, 64]} />,
      };
    default:
      return {
        rotation: [0, 0, 0],
        geometry: <planeGeometry args={[planeSize, planeSize, 96, 96]} />,
      };
  }
}

function getReactionGeometryVariant(planeSize: number, mode: ReactionMode, source: ReactionSource): GeometryVariant {
  const radius = planeSize * 0.5;
  if (mode === 'biofilm_skin') {
    return {
      rotation: [0.24, 0.42, 0],
      geometry: <sphereGeometry args={[radius * 0.82, 112, 72]} />,
    };
  }
  if (mode === 'cellular_front') {
    return {
      rotation: [Math.PI / 2, 0, 0],
      geometry: <cylinderGeometry args={[radius * 0.6, radius * 0.46, planeSize * 0.94, 128, 1, true]} />,
    };
  }
  if (mode === 'corrosion_front') {
    return {
      rotation: [Math.PI / 2, 0, 0],
      geometry: <torusGeometry args={[radius * 0.7, radius * 0.2, 80, 192]} />,
    };
  }
  return buildSourceDrivenGeometry(planeSize, source);
}

export const ReactionDiffusionSystemRender: React.FC<Props> = ({ displayMaterial, planeSize, zOffset, mode, source }) => {
  const variant = getReactionGeometryVariant(planeSize, mode, source);
  return (
    <mesh position={[0, 0, zOffset]} rotation={variant.rotation} renderOrder={3}>
      {variant.geometry}
      <primitive object={displayMaterial} attach="material" />
    </mesh>
  );
};
