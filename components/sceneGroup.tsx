import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';

export const SceneGroup: React.FC<{ config: ParticleConfig; isPlaying: boolean; children: React.ReactNode }> = ({ config, isPlaying, children }) => {
  const groupRef = useRef<THREE.Group>(null);
  const autoRot = useRef({ x: 0, y: 0 });

  useFrame(() => {
    if (isPlaying) {
      autoRot.current.x += config.rotationSpeedX;
      autoRot.current.y += config.rotationSpeedY;
    }
    if (groupRef.current) {
      groupRef.current.rotation.x = config.manualRotationX + autoRot.current.x;
      groupRef.current.rotation.y = config.manualRotationY + autoRot.current.y;
      groupRef.current.rotation.z = config.manualRotationZ;
    }
  });

  return <group ref={groupRef}>{children}</group>;
};
