// components/sceneGpgpuFieldGlyphs.tsx
// Flow-field glyph overlay (Phase AF2): the simulation's curl
// field drawn as line glyphs on a z = 0 grid inside the bounce
// radius — each segment follows the field direction at its grid
// point and its length scales with the field strength. The
// vertex shader reuses the curl GLSL chunk sliced verbatim out
// of the velocity shader (lib/fieldGlyphSampling
// extractCurlGlslChunk) and the same branch expression as the
// velocity main, fed with the same uniform mapping the
// simulation passes use — so the glyphs show the field the
// particles actually feel, at the same clock (the parent
// system's timeRef). Display only: nothing here feeds back
// into the simulation. The field shown is the shared/base
// field (replica seed offset 0), matching the non-stack path.

import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import { extractCurlGlslChunk } from '../lib/fieldGlyphSampling';

type Props = {
  config: ParticleConfig;
  timeRef: React.RefObject<number>;
};

const CURL_CHUNK = extractCurlGlslChunk()
  || 'vec3 curlNoise(vec3 p) { return vec3(0.0); }\n'
  + 'vec3 symmetricCurl(vec3 p, vec3 tOff) { return vec3(0.0); }\n'
  + 'vec3 curlField(vec3 p, vec3 tOff) { return vec3(0.0); }\n';

const VERT = /* glsl */ `
  uniform float uTime;
  uniform float uCurlEnabled;
  uniform float uCurlScale;
  uniform float uCurlSpeed;
  uniform int uCurlSymmetry;
  uniform int uCurlMode;
  uniform int uCurlOctaves;
  uniform vec3 uReplicaSeedOffset;
  uniform float uGlyphLength;
  uniform float uGlyphCell;
  attribute float aSide;
  varying float vMag;
  ${CURL_CHUNK}
  void main() {
    vec3 field = vec3(0.0);
    if (uCurlEnabled > 0.5) {
      float curlTime = uTime * 0.15 * uCurlSpeed;
      vec3 p = position * uCurlScale + uReplicaSeedOffset;
      // The velocity main's curl branch, verbatim structure.
      field = (uCurlMode == 0 && uCurlOctaves <= 1)
        ? (uCurlSymmetry == 0
          ? curlNoise(p + vec3(curlTime))
          : symmetricCurl(p, vec3(curlTime)))
        : curlField(p, vec3(curlTime));
    }
    float mag = length(field);
    vec3 dir = mag > 1e-6 ? field / mag : vec3(0.0);
    // Length rule shared with lib/fieldGlyphSampling
    // (fieldGlyphSegmentLength): strength capped at 3, scaled
    // by the length key and the grid cell size.
    float len = min(mag, 3.0) * uGlyphLength * uGlyphCell;
    vec3 pos = position + dir * (aSide * len * 0.5);
    vMag = mag;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vMag;
  void main() {
    if (vMag < 0.001) discard;
    float a = clamp(0.3 + vMag * 0.45, 0.0, 1.0) * uOpacity;
    gl_FragColor = vec4(uColor, a);
  }
`;

const CURL_SYMMETRY_TO_INT: Record<string, number> = {
  none: 0, mirrorX: 1, radial4: 2, radial6: 3, octahedral: 4,
};
const CURL_MODE_TO_INT: Record<string, number> = { curl: 0, ridged: 1, vortex: 2 };

export const GpgpuFieldGlyphs: React.FC<Props> = React.memo(({ config, timeRef }) => {
  const grid = Math.max(4, Math.min(40, Math.round(config.gpgpuFieldGlyphGrid) || 16));
  const radius = Math.max(0.01, config.gpgpuBounceRadius);

  const segments = useMemo(() => {
    const cell = (2 * radius) / grid;
    const positions = new Float32Array(grid * grid * 2 * 3);
    const sides = new Float32Array(grid * grid * 2);
    let v = 0;
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const cx = -radius + (gx + 0.5) * cell;
        const cy = -radius + (gy + 0.5) * cell;
        for (let s = 0; s < 2; s++) {
          positions[v * 3] = cx;
          positions[v * 3 + 1] = cy;
          positions[v * 3 + 2] = 0;
          sides[v] = s === 0 ? -1 : 1;
          v++;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uCurlEnabled: { value: 0 },
        uCurlScale: { value: 1 },
        uCurlSpeed: { value: 1 },
        uCurlSymmetry: { value: 0 },
        uCurlMode: { value: 0 },
        uCurlOctaves: { value: 1 },
        uReplicaSeedOffset: { value: new THREE.Vector3(0, 0, 0) },
        uGlyphLength: { value: 0.5 },
        uGlyphCell: { value: cell },
        uColor: { value: new THREE.Color(0.85, 0.88, 0.91) },
        uOpacity: { value: 0.85 },
      },
      transparent: true,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    return lines;
  }, [grid, radius]);

  useEffect(() => () => {
    segments.geometry.dispose();
    (segments.material as THREE.Material).dispose();
  }, [segments]);

  useFrame(() => {
    const mat = segments.material as THREE.ShaderMaterial;
    const u = mat.uniforms;
    u.uTime.value = timeRef.current ?? 0;
    u.uCurlEnabled.value = config.gpgpuCurlEnabled ? 1 : 0;
    u.uCurlScale.value = config.gpgpuCurlScale;
    u.uCurlSpeed.value = Math.max(0, Math.min(4, config.gpgpuCurlSpeed ?? 1));
    u.uCurlSymmetry.value = CURL_SYMMETRY_TO_INT[config.gpgpuCurlSymmetry] ?? 0;
    u.uCurlMode.value = CURL_MODE_TO_INT[config.gpgpuCurlMode] ?? 0;
    u.uCurlOctaves.value = Math.max(1, Math.min(3, Math.round(config.gpgpuCurlOctaves)));
    u.uGlyphLength.value = config.gpgpuFieldGlyphLength;
    u.uGlyphCell.value = (2 * radius) / grid;
  });

  return <primitive object={segments} />;
});
GpgpuFieldGlyphs.displayName = 'GpgpuFieldGlyphs';
