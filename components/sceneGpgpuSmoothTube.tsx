// components/sceneGpgpuSmoothTube.tsx
// Per-particle smooth tube trails via CPU ring buffer + in-place geometry updates.
// Reads particle positions from posReadbackRef (same source as MetaballSystem).

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';

type Props = {
  config: ParticleConfig;
  posReadbackRef: React.RefObject<Float32Array | null>;
  isPlaying: boolean;
};

const SMOOTH_TUBE_SIDES = 6;
// Scratch vectors reused across frames
const _dir   = new THREE.Vector3();
const _up    = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up2   = new THREE.Vector3();
const _center = new THREE.Vector3();

export const GpgpuSmoothTube: React.FC<Props> = React.memo(({ config, posReadbackRef, isPlaying }) => {
  const N       = Math.max(4, Math.min(256, config.gpgpuSmoothTubeCount));
  const histLen = Math.max(4, Math.min(32, config.gpgpuSmoothTubeHistory));
  const sides   = SMOOTH_TUBE_SIDES;

  // CPU ring buffer: histLen snapshots × N particles × 3 floats
  const history = useRef<Float32Array[]>([]);
  const histHead = useRef(0);
  const frameCount = useRef(0);

  // Reset history buffer when N or histLen changes
  useEffect(() => {
    history.current = Array.from({ length: histLen }, () => new Float32Array(N * 3));
    histHead.current = 0;
    frameCount.current = 0;
  }, [N, histLen]);

  // Pre-allocated tube geometries (one per particle, updated in-place each frame)
  const geos = useMemo(() => {
    const vertsPerParticle = histLen * sides;
    return Array.from({ length: N }, () => {
      const positions = new Float32Array(vertsPerParticle * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // Indices: (histLen-1) segments × sides × 2 triangles
      const idx: number[] = [];
      for (let r = 0; r < histLen - 1; r++) {
        for (let s = 0; s < sides; s++) {
          const s1 = (s + 1) % sides;
          const a = r * sides + s;
          const b = r * sides + s1;
          const c = (r + 1) * sides + s;
          const d = (r + 1) * sides + s1;
          idx.push(a, c, b, b, c, d);
        }
      }
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      return geo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [N, histLen]);

  // Single shared material
  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.gpgpuSmoothTubeColor),
    opacity: config.gpgpuSmoothTubeOpacity,
    transparent: config.gpgpuSmoothTubeOpacity < 1,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.4,
    metalness: 0.2,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Mesh objects (created once, reused)
  const meshes = useMemo(() => geos.map(geo => {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    return m;
     
  }), [geos, mat]);

  useEffect(() => () => {
    geos.forEach(g => g.dispose());
    mat.dispose();
  }, [geos, mat]);

  useFrame(() => {
    const pos = posReadbackRef.current;
    if (!pos || !isPlaying) return;

    // Sync material live params
    mat.color.setStyle(config.gpgpuSmoothTubeColor);
    mat.opacity = config.gpgpuSmoothTubeOpacity;
    mat.transparent = config.gpgpuSmoothTubeOpacity < 0.999;

    // Capture current positions into ring buffer
    const snapshot = history.current[histHead.current];
    // The reset effect populates the ring buffer on mount and on N /
    // histLen changes, but a frame can tick before the effect flush
    // (observed under heavy load while switching GPGPU presets, where
    // this threw "Cannot set properties of undefined (setting '0')").
    // Skip the frame until the buffer exists.
    if (!snapshot) return;
    const cap = Math.min(N, Math.floor(pos.length / 4));
    for (let i = 0; i < cap; i++) {
      snapshot[i * 3]     = pos[i * 4];
      snapshot[i * 3 + 1] = pos[i * 4 + 1];
      snapshot[i * 3 + 2] = pos[i * 4 + 2];
    }
    histHead.current = (histHead.current + 1) % histLen;
    frameCount.current++;

    if (frameCount.current < histLen) return; // wait until buffer is full

    const radius = config.gpgpuSmoothTubeRadius;
    const PI2 = Math.PI * 2;

    for (let p = 0; p < N; p++) {
      const geo = geos[p];
      const attr = geo.attributes.position as THREE.BufferAttribute;
      const posArr = attr.array as Float32Array;

      for (let r = 0; r < histLen; r++) {
        // Ring buffer: read from oldest (head) to newest
        const frameIdx = (histHead.current + r) % histLen;
        const snap = history.current[frameIdx];
        _center.set(snap[p * 3], snap[p * 3 + 1], snap[p * 3 + 2]);

        // Compute tangent direction
        const prevIdx = (histHead.current + r - 1 + histLen) % histLen;
        const nextIdx = (histHead.current + r + 1) % histLen;
        const prevSnap = history.current[prevIdx < 0 ? (prevIdx + histLen) : prevIdx];
        const nextSnap = history.current[nextIdx];
        _dir.set(
          nextSnap[p * 3]     - prevSnap[p * 3],
          nextSnap[p * 3 + 1] - prevSnap[p * 3 + 1],
          nextSnap[p * 3 + 2] - prevSnap[p * 3 + 2],
        );
        const dirLen = _dir.length();
        if (dirLen < 0.001) _dir.set(0, 1, 0); else _dir.divideScalar(dirLen);

        _up.set(Math.abs(_dir.y) < 0.99 ? 0 : 1, Math.abs(_dir.y) < 0.99 ? 1 : 0, 0);
        _right.crossVectors(_dir, _up).normalize();
        _up2.crossVectors(_right, _dir).normalize();

        for (let s = 0; s < sides; s++) {
          const angle = (PI2 * s) / sides;
          const cos = Math.cos(angle) * radius;
          const sin = Math.sin(angle) * radius;
          const vi = (r * sides + s) * 3;
          posArr[vi]     = _center.x + _right.x * cos + _up2.x * sin;
          posArr[vi + 1] = _center.y + _right.y * cos + _up2.y * sin;
          posArr[vi + 2] = _center.z + _right.z * cos + _up2.z * sin;
        }
      }

      attr.needsUpdate = true;
      // computeBoundingSphere() removed: frustumCulled=false なので毎フレーム計算不要
    }
  });

  return (
    <group>
      {meshes.map((mesh, i) => <primitive key={i} object={mesh} />)}
    </group>
  );
});
GpgpuSmoothTube.displayName = 'GpgpuSmoothTube';
