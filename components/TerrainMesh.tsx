import React from 'react';
import * as THREE from 'three';
import type { ParticleConfig } from '../types';
import {
  buildTerrainMeshGeometryData,
  getTerrainMeshProceduralCanvas,
} from '../lib/terrainMesh';

// Terrain Mesh (Phase P, Mir-style): a polygon counterpart to the
// Phase L point terrain. A 128x128 grid is displaced by the shared
// seeded height field (lib/terrainMesh.ts, same field-seed mixing
// as the morph bake, so mesh and point terrain are one landscape),
// given vertex normals by computeVertexNormals, and shaded with a
// MeshStandardMaterial under lights that mount with the system.
// Display switches between the shaded mesh, a wireframe overlay
// form, and a points form over the SAME geometry; the surface can
// carry a procedural monochrome texture or the Horizon background
// image as its map; tunnel mode wraps the field into a cylinder
// interior (see lib/terrainMesh.ts for the seamless tiling).
//
// The system mounts ONLY when gpgpuTerrainMeshEnabled is set: with
// the default off, this component returns null, no lights exist,
// and the render is bit-identical to the pre-Phase-P scene. The
// geometry is a pure function of the config, so deterministic
// renders reproduce it exactly.

export const TerrainMesh: React.FC<{ config: ParticleConfig }> = ({ config }) => {
  const enabled = config.gpgpuTerrainMeshEnabled;
  const display = config.gpgpuTerrainMeshDisplay;
  const tunnel = config.gpgpuTerrainMeshTunnel;
  const textureKind = config.gpgpuTerrainMeshTexture;
  const meshScale = config.gpgpuTerrainMeshScale;
  const opacity = config.gpgpuTerrainMeshOpacity;
  const brightness = config.gpgpuTerrainMeshBrightness;
  const amp = config.gpgpuMorphTerrainAmplitude;
  const freq = config.gpgpuMorphTerrainFrequency;
  const octaves = config.gpgpuMorphTerrainOctaves;
  const terrainSeed = config.gpgpuMorphTerrainSeed;
  const seed = config.gpgpuSeed;
  const morphScale = config.gpgpuMorphScale;
  const bounceRadius = config.gpgpuBounceRadius;
  const imageSource = config.backgroundImageSource;

  const geometry = React.useMemo(() => {
    if (!enabled) return null;
    const data = buildTerrainMeshGeometryData({
      terrain: { amplitude: amp, frequency: freq, octaves, seed: terrainSeed },
      seed,
      worldScale: morphScale * bounceRadius * 0.48 * meshScale,
      tunnel,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [enabled, amp, freq, octaves, terrainSeed, seed, morphScale, bounceRadius, meshScale, tunnel]);

  React.useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  // Surface map: procedural canvases are synchronous; the 'image'
  // kind decodes the Horizon background image source (data URL)
  // asynchronously and swaps in when ready (plain shading until
  // then — the UI states the source is shared with the background).
  const [imageTexture, setImageTexture] = React.useState<THREE.Texture | null>(null);
  React.useEffect(() => {
    if (!enabled || textureKind !== 'image' || !imageSource) {
      setImageTexture(null);
      return undefined;
    }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(imageSource, (tex) => {
      if (cancelled) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      setImageTexture(tex);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, textureKind, imageSource]);
  React.useEffect(() => {
    return () => {
      imageTexture?.dispose();
    };
  }, [imageTexture]);

  const proceduralTexture = React.useMemo(() => {
    if (!enabled || (textureKind !== 'gradient' && textureKind !== 'grid')) return null;
    const tex = new THREE.CanvasTexture(getTerrainMeshProceduralCanvas(textureKind));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }, [enabled, textureKind]);
  React.useEffect(() => {
    return () => {
      proceduralTexture?.dispose();
    };
  }, [proceduralTexture]);

  if (!enabled || !geometry) return null;

  const map = textureKind === 'image' ? imageTexture : proceduralTexture;
  const grey = Math.max(0.05, Math.min(1.6, 0.84 * brightness));
  const color = new THREE.Color(grey, grey, grey * 1.03);
  const transparent = opacity < 0.999;

  return (
    <group>
      {/* Lights mount with the system only: the rest of the scene is
          shader-driven, and with the mesh off nothing here exists. */}
      <ambientLight intensity={0.5 + 0.3 * brightness} />
      <directionalLight position={[90, 160, 70]} intensity={1.7 * brightness} />
      <directionalLight position={[-110, 40, -90]} intensity={0.35 * brightness} />
      {display === 'shaded' && (
        <mesh geometry={geometry}>
          <meshStandardMaterial
            color={color}
            roughness={0.92}
            metalness={0.0}
            map={map ?? undefined}
            transparent={transparent}
            opacity={opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {display === 'wireframe' && (
        <mesh geometry={geometry}>
          <meshBasicMaterial
            color={color}
            wireframe
            transparent={transparent}
            opacity={opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      {display === 'points' && (
        <points geometry={geometry}>
          <pointsMaterial
            color={color}
            size={2.4}
            sizeAttenuation
            transparent={transparent}
            opacity={opacity}
          />
        </points>
      )}
    </group>
  );
};
