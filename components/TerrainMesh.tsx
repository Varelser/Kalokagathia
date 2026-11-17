import React from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import {
  TERRAIN_MESH_EXTENT,
  buildTerrainMeshGeometryData,
  getTerrainMeshProceduralCanvas,
  tunnelScrollOffset,
} from '../lib/terrainMesh';
import { buildShadowScene, occlusionAtPoint } from '../lib/shadowOcclusion';

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
//
// Phase V additions: the 'image' texture kind resolves its source
// from the dedicated gpgpuTerrainTextureImage first and falls back
// to the Horizon background image (the legacy source) when empty;
// repeat / offset apply the standard UV transform to whichever map
// is active (identity at the defaults). Tunnel cruise
// (gpgpuTunnelSpeed) scrolls the terrain phase toward the viewer
// through a second, period-shifted copy of the same geometry — the
// camera itself never moves (Phase G pins it during exports), and
// the offset is a pure function of accumulated scene time
// (lib/terrainMesh.ts tunnelScrollOffset), so a deterministic
// render reproduces the travel frame-for-frame and speed 0 renders
// exactly the legacy single static mesh.

export const TerrainMesh: React.FC<{ config: ParticleConfig; isPlaying?: boolean }> = ({ config, isPlaying = true }) => {
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
  // Terrain recipes (Phase AI): the visible mesh follows the
  // same recipe as the bake / collider, so what you see is what
  // particles collide with.
  const terrainKind = config.gpgpuMorphTerrainKind;
  const terrainTerraceSteps = config.gpgpuMorphTerrainTerraceSteps;
  const seed = config.gpgpuSeed;
  const morphScale = config.gpgpuMorphScale;
  const bounceRadius = config.gpgpuBounceRadius;
  // Dedicated terrain texture image (Phase V) wins when set; the
  // Horizon background image remains the source otherwise, exactly
  // as before Phase V.
  const imageSource = config.gpgpuTerrainTextureImage || config.backgroundImageSource;
  const texRepeat = config.gpgpuTerrainTextureRepeat;
  const texOffsetX = config.gpgpuTerrainTextureOffsetX;
  const texOffsetY = config.gpgpuTerrainTextureOffsetY;
  const tunnelSpeed = config.gpgpuTunnelSpeed;
  // Occlusion-map shadow (Phase Z): per-vertex colours from the
  // same pure occlusion function the bake uses, evaluated at the
  // vertex positions (plane mode only — the tunnel's wrapped
  // frame has no single light horizon, documented limit). With
  // the shadow off no colour attribute exists and the materials
  // render exactly as before.
  const shadowActive = config.gpgpuShadowEnabled && config.gpgpuShadowStrength > 0 && !tunnel;

  const worldScale = morphScale * bounceRadius * 0.48 * meshScale;
  const geometry = React.useMemo(() => {
    if (!enabled) return null;
    const data = buildTerrainMeshGeometryData({
      terrain: { amplitude: amp, frequency: freq, octaves, seed: terrainSeed, kind: terrainKind, terraceSteps: terrainTerraceSteps },
      seed,
      worldScale,
      tunnel,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    if (shadowActive) {
      const scene = buildShadowScene(config);
      const colors = new Float32Array(data.vertexCount * 3);
      for (let i = 0; i < data.vertexCount; i++) {
        const occ = occlusionAtPoint(
          data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2], scene,
        );
        const f = 1 - config.gpgpuShadowStrength * occ;
        colors[i * 3] = f;
        colors[i * 3 + 1] = f;
        colors[i * 3 + 2] = f;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geo.computeVertexNormals();
    return geo;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, amp, freq, octaves, terrainSeed, terrainKind, terrainTerraceSteps, seed, morphScale, bounceRadius, meshScale, tunnel, shadowActive, config.gpgpuShadowStrength, config.gpgpuShadowSoftness, config.gpgpuShadowSourceTerrain, config.gpgpuShadowSourceObj, config.gpgpuLightPosX, config.gpgpuLightPosY, config.gpgpuLightPosZ, config.gpgpuObjMeshEnabled, config.gpgpuObjMeshScale, config.gpgpuObjMeshRepeat, config.gpgpuObjMeshPosX, config.gpgpuObjMeshPosY, config.gpgpuObjMeshPosZ, config.gpgpuMorphObjSource]);

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

  // UV transform (Phase V): repeat / offset apply to whichever map
  // is active (uv' = uv * repeat + offset — lib/terrainMesh.ts
  // terrainTextureUvTransform documents the formula; three.js
  // derives the shader transform from these fields every frame).
  // The defaults (1 / 0 / 0) are the identity transform.
  React.useEffect(() => {
    for (const tex of [imageTexture, proceduralTexture]) {
      if (!tex) continue;
      tex.repeat.set(texRepeat, texRepeat);
      tex.offset.set(texOffsetX, texOffsetY);
    }
  }, [imageTexture, proceduralTexture, texRepeat, texOffsetX, texOffsetY]);

  // Tunnel cruise (Phase V): accumulate scene time while playing
  // (delta clamped like the GPGPU sim's raw step) and fold it into
  // a scroll offset over one tunnel length. AppScene keys this
  // component by scene generation, so a deterministic render job
  // remounts it and the travel restarts from phase 0 — the offset
  // at stepped frame i is a pure function of (i, fps, speed).
  const tunnelLength = TERRAIN_MESH_EXTENT * 2 * worldScale;
  const scrolling = enabled && tunnel && tunnelSpeed !== 0;
  const scrollGroupRef = React.useRef<THREE.Group>(null);
  const scrollTimeRef = React.useRef(0);
  useFrame((_, delta) => {
    if (!scrolling || !isPlaying) return;
    scrollTimeRef.current += Math.min(delta, 0.05);
    const dz = tunnelScrollOffset(scrollTimeRef.current, tunnelSpeed, tunnelLength);
    if (scrollGroupRef.current) scrollGroupRef.current.position.z = dz;
  });

  if (!enabled || !geometry) return null;

  const map = textureKind === 'image' ? imageTexture : proceduralTexture;
  const grey = Math.max(0.05, Math.min(1.6, 0.84 * brightness));
  const color = new THREE.Color(grey, grey, grey * 1.03);
  const transparent = opacity < 0.999;

  const formElement = (key: string, zOffset: number) => {
    if (display === 'shaded') {
      return (
        <mesh key={key} geometry={geometry} position={[0, 0, zOffset]}>
          <meshStandardMaterial
            // Keyed on map presence: the 'image' map arrives
            // asynchronously, and a material first rendered without
            // a map never recompiles with USE_MAP when the texture
            // lands — the remount on presence flip is what makes
            // the image texture visible at all (found in the
            // Phase V gate; the no-map form is byte-identical).
            key={`${map ? 'with-map' : 'no-map'}-${shadowActive ? 'shadow' : 'plain'}`}
            color={color}
            vertexColors={shadowActive}
            roughness={0.92}
            metalness={0.0}
            map={map ?? undefined}
            transparent={transparent}
            opacity={opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      );
    }
    if (display === 'wireframe') {
      return (
        <mesh key={key} geometry={geometry} position={[0, 0, zOffset]}>
          <meshBasicMaterial
            key={shadowActive ? 'shadow' : 'plain'}
            color={color}
            vertexColors={shadowActive}
            wireframe
            transparent={transparent}
            opacity={opacity}
            side={THREE.DoubleSide}
          />
        </mesh>
      );
    }
    return (
      <points key={key} geometry={geometry} position={[0, 0, zOffset]}>
        <pointsMaterial
          key={shadowActive ? 'shadow' : 'plain'}
          color={color}
          vertexColors={shadowActive}
          size={2.4}
          sizeAttenuation
          transparent={transparent}
          opacity={opacity}
        />
      </points>
    );
  };

  return (
    <group>
      {/* Lights mount with the system only: the rest of the scene is
          shader-driven, and with the mesh off nothing here exists. */}
      <ambientLight intensity={0.5 + 0.3 * brightness} />
      <directionalLight position={[90, 160, 70]} intensity={1.7 * brightness} />
      <directionalLight position={[-110, 40, -90]} intensity={0.35 * brightness} />
      {scrolling ? (
        // Two period-shifted copies inside one scrolled group: as
        // the group travels +z by up to one tunnel length, the
        // trailing copy covers the far end, and because the field
        // is periodic over exactly that length the wrap is
        // invisible. The lights stay outside the scrolled group so
        // the illumination field is stable while the terrain flows.
        <group ref={scrollGroupRef}>
          {formElement('near', 0)}
          {formElement('far', -tunnelLength)}
        </group>
      ) : (
        formElement('single', 0)
      )}
    </group>
  );
};
