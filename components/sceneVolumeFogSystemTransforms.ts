import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import type { FogMode, FogSliceTransform } from './sceneVolumeFogSystemTypes';

type FogSourceTransform = {
  x: number;
  y: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
};

function fract(value: number) {
  return value - Math.floor(value);
}

function hash(value: number) {
  return fract(Math.sin(value * 127.13 + 19.37) * 43758.5453123);
}

function signedHash(value: number) {
  return hash(value) * 2 - 1;
}

function getFogSourceTransform(source: ParticleConfig['layer2Source'], index: number, sliceCount: number, globalRadius: number, time: number): FogSourceTransform {
  const centered = sliceCount > 1 ? index / (sliceCount - 1) - 0.5 : 0;
  const t = sliceCount > 1 ? index / (sliceCount - 1) : 0;
  const seed = index + 1;
  const transform: FogSourceTransform = { x: 0, y: 0, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1 };

  if (source === 'text' || source === 'grid') {
    const cols = Math.max(2, Math.round(Math.sqrt(sliceCount)));
    const col = (index % cols) - (cols - 1) * 0.5;
    const row = Math.floor(index / cols) - Math.floor(sliceCount / cols) * 0.5;
    transform.x += col * globalRadius * 0.06;
    transform.y += row * globalRadius * 0.045;
    transform.scaleY *= 0.86;
  } else if (source === 'ring' || source === 'disc' || source === 'torus') {
    const theta = t * Math.PI * 2.0 + time * 0.08;
    transform.x += Math.cos(theta) * globalRadius * 0.12;
    transform.y += Math.sin(theta) * globalRadius * 0.06;
    transform.rotZ += theta * 0.12;
    transform.scaleX *= 1.06;
  } else if (source === 'spiral' || source === 'galaxy') {
    const theta = t * Math.PI * 3.6 + time * 0.18;
    const radius = globalRadius * (0.05 + t * 0.16);
    transform.x += Math.cos(theta) * radius;
    transform.y += Math.sin(theta * 0.72) * radius * 0.8;
    transform.rotZ += theta * 0.18;
    transform.scaleX *= 0.96;
    transform.scaleY *= 1.08;
  } else if (source === 'image' || source === 'video') {
    transform.y += Math.sin(time * 0.22 + seed * 0.4) * globalRadius * 0.035;
    transform.rotX += 0.05 + signedHash(seed + 2.4) * 0.03;
    transform.scaleX *= 1.08;
    transform.scaleY *= 0.94;
  } else if (source === 'cube' || source === 'cylinder' || source === 'cone') {
    transform.y += centered * globalRadius * 0.08;
    transform.rotY += centered * 0.18;
    transform.scaleX *= 0.9;
    transform.scaleY *= 1.14;
  } else if (source === 'plane') {
    transform.rotX += 0.08;
    transform.scaleX *= 1.12;
    transform.scaleY *= 0.82;
  }

  return transform;
}

export function getFogSliceTransform(mode: FogMode, source: ParticleConfig['layer2Source'], index: number, sliceCount: number, z: number, planeScale: number, globalRadius: number, time: number) {
  const t = sliceCount <= 1 ? 0 : index / (sliceCount - 1);
  const centered = t - 0.5;
  const seed = index * 17.13 + 0.37;
  const basePos = new THREE.Vector3(0, 0, z);
  const baseRot = new THREE.Euler(0, 0, 0);
  const baseScale = new THREE.Vector3(1, 1, 1);

  if (mode === 'dust_plume') {
    basePos.x += Math.sin(time * 0.22 + seed) * globalRadius * 0.04;
    basePos.y += (t * 0.95 - 0.2) * globalRadius * 0.28;
    baseScale.set(0.62, 1.4 + t * 0.55, 1);
  } else if (mode === 'ashfall') {
    basePos.x += signedHash(seed) * globalRadius * 0.06;
    basePos.y -= t * globalRadius * 0.44;
    baseRot.z = signedHash(seed + 1.2) * 0.16;
    baseScale.set(0.3 + hash(seed + 2.1) * 0.14, 1.55, 1);
  } else if (mode === 'vapor_canopy') {
    const theta = centered * Math.PI * 1.25;
    basePos.x = Math.sin(theta) * globalRadius * 0.32;
    basePos.y = globalRadius * (0.16 + Math.cos(theta) * 0.12);
    baseRot.z = -theta * 0.35;
    baseScale.set(0.84, 1.26, 1);
  } else if (mode === 'ember_swarm' || mode === 'ember_drift') {
    const theta = time * 0.18 + seed * 0.27 + t * Math.PI * 2.0;
    basePos.x += Math.cos(theta) * globalRadius * 0.18 * (0.4 + t);
    basePos.y += Math.sin(theta * 1.3) * globalRadius * 0.12 + centered * globalRadius * 0.18;
    baseRot.z = theta * 0.2;
    baseScale.set(0.56, 0.9 + hash(seed + 3.4) * 0.4, 1);
  } else if (mode === 'soot_veil' || mode === 'velvet_ash') {
    basePos.x += centered * globalRadius * 0.16;
    basePos.y -= Math.abs(centered) * globalRadius * 0.12 + t * globalRadius * 0.08;
    baseRot.z = centered * 0.2;
    baseScale.set(0.72, 1.18 + Math.abs(centered) * 0.36, 1);
  } else if (mode === 'foam_drift') {
    const theta = time * 0.24 + seed * 0.22;
    basePos.x += Math.cos(theta) * globalRadius * 0.14;
    basePos.y += Math.sin(theta * 0.8) * globalRadius * 0.1;
    baseScale.set(1.1, 0.82, 1);
  } else if (mode === 'charge_veil') {
    basePos.x += signedHash(seed + 3.7) * globalRadius * 0.08;
    basePos.y += centered * globalRadius * 0.1;
    baseRot.z = Math.sin(time * 0.8 + seed) * 0.28;
    baseScale.set(0.42, 1.34, 1);
  } else if (mode === 'prism_smoke') {
    const theta = centered * Math.PI * 1.8;
    basePos.x += Math.sin(theta) * globalRadius * 0.24;
    basePos.y += Math.cos(theta * 0.5) * globalRadius * 0.08;
    baseRot.z = theta * 0.22;
    baseScale.set(0.78, 1.08, 1);
  } else if (mode === 'rune_smoke' || mode === 'static_smoke') {
    const col = (index % 4) - 1.5;
    const row = Math.floor(index / 4) - Math.floor(sliceCount / 8);
    basePos.x = col * globalRadius * 0.12;
    basePos.y = row * globalRadius * 0.08;
    baseScale.set(0.54, 0.54 + hash(seed + 2.6) * 0.32, 1);
  } else if (mode === 'mirage_smoke') {
    basePos.x += centered * globalRadius * 0.3;
    basePos.y = -globalRadius * 0.12 + Math.sin(time * 0.3 + seed) * globalRadius * 0.02;
    baseRot.x = 0.18;
    baseScale.set(1.28, 0.34, 1);
  } else if (mode === 'ion_rain') {
    const lane = (index % 6) - 2.5;
    basePos.x = lane * globalRadius * 0.08 + Math.sin(time * 0.5 + seed) * globalRadius * 0.02;
    basePos.y = -t * globalRadius * 0.28;
    baseScale.set(0.22, 1.62, 1);
  } else if (mode === 'vortex_transport') {
    const theta = time * 0.28 + t * Math.PI * 2.4;
    basePos.x += Math.cos(theta) * globalRadius * 0.2 * (0.4 + t);
    basePos.y += centered * globalRadius * 0.22;
    baseRot.z = theta * 0.3;
    baseScale.set(0.52, 1.22, 1);
  } else if (mode === 'pressure_cells') {
    const cols = Math.max(2, Math.round(Math.sqrt(sliceCount)));
    const col = (index % cols) - (cols - 1) * 0.5;
    const row = Math.floor(index / cols) - Math.floor(sliceCount / cols) * 0.5;
    basePos.x = col * globalRadius * 0.14;
    basePos.y = row * globalRadius * 0.12;
    baseScale.set(0.62, 0.62, 1);
  } else if (mode === 'condense_field') {
    basePos.x += centered * globalRadius * 0.1;
    basePos.y -= Math.abs(centered) * globalRadius * 0.16;
    baseScale.set(0.66, 0.88 + (1 - Math.abs(centered) * 1.8) * 0.38, 1);
  } else if (mode === 'sublimate_cloud') {
    basePos.x += centered * globalRadius * 0.12;
    basePos.y += t * globalRadius * 0.24;
    baseScale.set(1.02 + t * 0.22, 0.7, 1);
  }

  const sourceTransform = getFogSourceTransform(source, index, sliceCount, globalRadius, time);
  basePos.x += sourceTransform.x;
  basePos.y += sourceTransform.y;
  baseRot.x += sourceTransform.rotX;
  baseRot.y += sourceTransform.rotY;
  baseRot.z += sourceTransform.rotZ;
  baseScale.x *= sourceTransform.scaleX;
  baseScale.y *= sourceTransform.scaleY;

  if (planeScale > 0) {
    baseScale.x *= planeScale;
    baseScale.y *= planeScale;
  }

  return { position: basePos, rotation: baseRot, scale: baseScale } satisfies FogSliceTransform;
}


