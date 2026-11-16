import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getDeterministicRotationFrame } from '../lib/sceneRotationDeterminism';
import type { ParticleConfig } from '../types';

export const SceneGroup: React.FC<{ config: ParticleConfig; isPlaying: boolean; children: React.ReactNode }> = ({ config, isPlaying, children }) => {
  const groupRef = useRef<THREE.Group>(null);
  const autoRot = useRef({ x: 0, y: 0 });

  useFrame(() => {
    const detFrame = getDeterministicRotationFrame();
    if (detFrame !== null) {
      // Deterministic render job (Phase X1): derive the accumulated
      // auto-rotation from the job's step index instead of counting
      // useFrame calls - the count raced the scene remount at job
      // start and shifted some exports by one frame of rotation.
      // The +1 is the remounted group's mount frame: a freshly
      // mounted group has already accumulated once by the time the
      // job's first advance renders (the unshifted exports include
      // it), so job step s maps to s + 1 accumulations.
      autoRot.current.x = config.rotationSpeedX * (detFrame + 1);
      autoRot.current.y = config.rotationSpeedY * (detFrame + 1);
    } else if (isPlaying) {
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
