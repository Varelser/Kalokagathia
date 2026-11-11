import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { ParticleConfig } from '../types';
import type { SceneAudioRef } from './AppSceneTypes';
import { getRaymarchDefaults, RAYMARCH_DEFAULTS } from '../lib/raymarchDefaults';

// Raymarched SDF (signed distance field), the heaviest system in the
// app — it ray-marches every pixel of an offscreen pass each frame.
//
// Architecture:
//  - Offscreen pass: a WebGLRenderTarget sized
//    (drawingBufferSize x renderScale) is rendered with a fullscreen
//    triangle carrying the raymarch shader. Per frame the four corner
//    rays of the camera frustum slice AT THE BACKDROP PLANE'S DEPTH
//    are computed from the real camera on the CPU and passed as
//    uniforms; the shader interpolates them, so each FBO pixel's ray
//    is geometrically exact for the backdrop plane.
//  - Display: a plane in the layer group at the DLA/L-system sheet
//    z-offset pushed further back (x2.2, the backdrop), scaled per
//    frame to cover the frustum at its depth, textured with the FBO.
//    depthWrite is off; other layer content is in front geometrically.
//  - SDF scene lives in normalised "scene units" (bounding radius
//    ~1.2, max march distance 8): world rays are re-based onto a
//    scene centre that sits, by default, at the camera's look-at
//    origin distance. The Distance key scales that distance: the
//    centre is placed at camPos + camForward * (|camPos| * distance)
//    at FBO-pass time, so < 1 pulls the sculpture toward the camera.
//  - Quality defaults come ONLY from RAYMARCH_DEFAULTS
//    (lib/raymarchDefaults.ts): the config keys default to it, and
//    this component's fallbacks reference it too — the step cap and
//    render scale arrive as uniforms, never as shader literals.
//
// Shading is strictly monochrome: DE-gradient normal, one diffuse
// light, rim, cheap AO (4 extra DE taps along the normal), distance
// fog to black, and a subtle iteration-count band. A miss writes
// transparent black (alpha 0) so the backdrop blends into the scene.

type RaymarchShape = 'mandelbulb' | 'blobs' | 'columns';
const SHAPE_IDS: Record<RaymarchShape, number> = { mandelbulb: 0, blobs: 1, columns: 2 };

type RaymarchSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef?: SceneAudioRef;
  isPlaying?: boolean;
};

const clampN = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? v : fallback));

const TRI_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const RAYMARCH_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uCornerBL;
  uniform vec3 uCornerBR;
  uniform vec3 uCornerTL;
  uniform vec3 uCornerTR;
  uniform vec3 uCamPos;
  uniform vec3 uSceneCentre;
  uniform float uSceneScale;
  uniform float uTime;
  uniform float uRotationAngle;
  uniform int uShape;
  uniform float uPower;
  uniform int uSteps;
  uniform float uEps;
  uniform vec3 uColor;
  uniform float uOpacity;

  float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
  }

  // Mandelbulb distance estimator (Hart et al.), iteration cap 10,
  // bounding radius ~1.2 enforced by the caller via a bounding sphere.
  float mandelbulbDE(vec3 pos) {
    vec3 z = pos;
    float dr = 1.0;
    float r = 0.0;
    for (int i = 0; i < 10; i++) {
      r = length(z);
      if (r > 2.0) break;
      float theta = acos(clamp(z.z / max(r, 1e-6), -1.0, 1.0)) * uPower;
      float phi = atan(z.y, z.x) * uPower;
      dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
      float zr = pow(r, uPower);
      z = zr * vec3(sin(theta) * cos(phi), sin(phi) * sin(theta), cos(theta)) + pos;
    }
    return 0.5 * log(max(r, 1e-6)) * r / max(dr, 1e-6);
  }

  float blobsDE(vec3 p) {
    float t = uTime;
    float d = length(p - vec3(sin(t * 0.31) * 0.25, cos(t * 0.23) * 0.18, sin(t * 0.19) * 0.22)) - 0.62;
    d = smin(d, length(p - vec3(0.72 + sin(t * 0.27 + 1.7) * 0.14, 0.28, cos(t * 0.21 + 0.6) * 0.18)) - 0.44, 0.45);
    d = smin(d, length(p - vec3(-0.68, -0.30 + sin(t * 0.33 + 3.1) * 0.15, 0.30)) - 0.48, 0.45);
    d = smin(d, length(p - vec3(0.18, 0.74 + cos(t * 0.25 + 2.2) * 0.13, -0.42)) - 0.40, 0.45);
    d = smin(d, length(p - vec3(-0.30, 0.12, -0.74 + sin(t * 0.29 + 4.4) * 0.16)) - 0.42, 0.45);
    d = smin(d, length(p - vec3(0.42, -0.68, 0.44 + cos(t * 0.35 + 1.1) * 0.12)) - 0.38, 0.45);
    return d;
  }

  float boxDE(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  }

  float columnsDE(vec3 p) {
    vec3 q = p;
    q.xz = mod(q.xz + 0.7, 1.4) - 0.7;
    float col = length(q.xz) - 0.30;
    float cap = boxDE(vec3(q.x, p.y, q.z), vec3(0.30, 3.0, 0.30));
    float d = min(col, cap);
    d = smin(d, p.y + 1.05, 0.25);
    // Finite architectural field: intersect with a bounding box.
    return max(d, boxDE(p, vec3(1.95, 1.55, 1.95)));
  }

  float mapDE(vec3 p) {
    if (uShape == 0) {
      float bound = length(p) - 1.25;
      if (bound > 0.35) return bound;
      return min(mandelbulbDE(p), bound + 0.35);
    }
    if (uShape == 1) return blobsDE(p);
    return columnsDE(p);
  }

  vec3 calcNormal(vec3 p) {
    float e = max(uEps * 2.0, 0.0012);
    vec3 n = vec3(0.0);
    // Tetrahedron gradient taps (4 DE evaluations).
    n += vec3(1.0, -1.0, -1.0) * mapDE(p + vec3(1.0, -1.0, -1.0) * e);
    n += vec3(-1.0, -1.0, 1.0) * mapDE(p + vec3(-1.0, -1.0, 1.0) * e);
    n += vec3(-1.0, 1.0, -1.0) * mapDE(p + vec3(-1.0, 1.0, -1.0) * e);
    n += vec3(1.0, 1.0, 1.0) * mapDE(p + vec3(1.0, 1.0, 1.0) * e);
    return normalize(n);
  }

  void main() {
    vec3 planePos = mix(mix(uCornerBL, uCornerBR, vUv.x), mix(uCornerTL, uCornerTR, vUv.x), vUv.y);
    vec3 rdWorld = normalize(planePos - uCamPos);
    // Re-base into scene units around the scene centre, and apply the
    // slow Y rotation by rotating the ray by the inverse angle.
    vec3 ro = (uCamPos - uSceneCentre) / uSceneScale;
    float ca = cos(-uRotationAngle);
    float sa = sin(-uRotationAngle);
    vec3 rd = normalize(vec3(rdWorld.x * ca - rdWorld.z * sa, rdWorld.y, rdWorld.x * sa + rdWorld.z * ca));
    ro = vec3(ro.x * ca - ro.z * sa, ro.y, ro.x * sa + ro.z * ca);

    float t = 0.0;
    float hit = 0.0;
    int iterUsed = 0;
    for (int i = 0; i < 128; i++) {
      if (i >= uSteps) break;
      iterUsed = i;
      vec3 p = ro + rd * t;
      float d = mapDE(p);
      if (d < uEps * (1.0 + t * 0.6)) { hit = 1.0; break; }
      t += d * 0.9;
      if (t > 8.0) break;
    }
    if (hit < 0.5) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      return;
    }
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    // Cheap AO: 4 extra DE taps along the normal.
    float ao = 0.0;
    float sca = 1.0;
    for (int i = 1; i <= 4; i++) {
      float h = 0.03 + 0.11 * float(i) / 4.0;
      ao += (h - mapDE(p + n * h)) * sca;
      sca *= 0.9;
    }
    ao = clamp(1.0 - 1.6 * ao, 0.0, 1.0);
    vec3 lightDir = normalize(vec3(0.6, 0.85, 0.45));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);
    float shade = (0.16 + 0.84 * diff) * ao + rim * 0.28;
    shade += float(iterUsed) / max(float(uSteps), 1.0) * 0.07;
    float fog = 1.0 - exp(-max(t - 3.5, 0.0) * 0.16);
    shade *= 1.0 - fog;
    vec3 col = uColor * shade;
    gl_FragColor = vec4(col, uOpacity);
  }
`;

const DISPLAY_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISPLAY_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTex;
  void main() {
    gl_FragColor = texture2D(uTex, vUv);
  }
`;

export const RaymarchSystem: React.FC<RaymarchSystemProps> = ({ config, layerIndex, isPlaying }) => {
  const { gl } = useThree();
  const raw = layerIndex === 2 ? {
    color: config.layer2Color,
    shape: config.layer2RaymarchShape,
    scale: config.layer2RaymarchScale,
    steps: config.layer2RaymarchSteps,
    power: config.layer2RaymarchPower,
    rotation: config.layer2RaymarchRotation,
    distance: config.layer2RaymarchDistance,
    opacity: config.layer2RaymarchOpacity,
  } : {
    color: config.layer3Color,
    shape: config.layer3RaymarchShape,
    scale: config.layer3RaymarchScale,
    steps: config.layer3RaymarchSteps,
    power: config.layer3RaymarchPower,
    rotation: config.layer3RaymarchRotation,
    distance: config.layer3RaymarchDistance,
    opacity: config.layer3RaymarchOpacity,
  };
  const shape: RaymarchShape = raw.shape === 'blobs' || raw.shape === 'columns' ? raw.shape : 'mandelbulb';
  const tierDefaults = getRaymarchDefaults();
  const renderScale = clampN(raw.scale, tierDefaults.renderScale, 0.25, 1.0);
  const steps = Math.round(clampN(raw.steps, tierDefaults.maxSteps, 16, 128));
  const power = clampN(raw.power, 8, 2, 16);
  const rotationSpeed = clampN(raw.rotation, 0.2, 0, 1);
  const distanceKey = clampN(raw.distance, 1.0, 0.5, 2.0);
  const opacity = clampN(raw.opacity, 1.0, 0, 1);

  // Sheet placement mirrors DLA/Physarum, pushed further back (backdrop).
  const planeSize = Math.min(Math.max(config.sphereRadius * 3.1, 160), 900);
  const zOffset = config.sphereRadius * (layerIndex === 2 ? -0.58 : 0.58) * 2.2;
  const sceneScale = planeSize * 0.30;

  const simScene = React.useMemo(() => new THREE.Scene(), []);
  const simCamera = React.useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const raymarchMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uCornerBL: { value: new THREE.Vector3() },
      uCornerBR: { value: new THREE.Vector3() },
      uCornerTL: { value: new THREE.Vector3() },
      uCornerTR: { value: new THREE.Vector3() },
      uCamPos: { value: new THREE.Vector3() },
      uSceneCentre: { value: new THREE.Vector3() },
      uSceneScale: { value: 1 },
      uTime: { value: 0 },
      uRotationAngle: { value: 0 },
      uShape: { value: 0 },
      uPower: { value: 8 },
      uSteps: { value: RAYMARCH_DEFAULTS.maxSteps },
      uEps: { value: 0.002 },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 1 },
    },
    vertexShader: TRI_VERTEX,
    fragmentShader: RAYMARCH_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }), []);
  const simQuad = React.useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const mesh = new THREE.Mesh(geo, raymarchMaterial);
    mesh.frustumCulled = false;
    simScene.add(mesh);
    return mesh;
  }, [raymarchMaterial, simScene]);

  const displayMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null as THREE.Texture | null } },
    vertexShader: DISPLAY_VERTEX,
    fragmentShader: DISPLAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  const fboRef = React.useRef<{ rt: THREE.WebGLRenderTarget; w: number; h: number } | null>(null);
  const meshRef = React.useRef<THREE.Mesh>(null);
  const animRef = React.useRef({ time: 0, angle: 0 });

  React.useEffect(() => () => {
    if (fboRef.current) fboRef.current.rt.dispose();
    fboRef.current = null;
    simScene.remove(simQuad);
    simQuad.geometry.dispose();
    raymarchMaterial.dispose();
    displayMaterial.dispose();
  }, [displayMaterial, raymarchMaterial, simQuad, simScene]);

  const tmp = React.useMemo(() => ({
    dbSize: new THREE.Vector2(),
    worldPos: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    toPlane: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    corner: new THREE.Vector3(),
    centre: new THREE.Vector3(),
  }), []);

  useFrame((state, delta) => {
    if (isPlaying !== false) {
      const dt = Math.min(delta, 0.1);
      animRef.current.time += dt;
      animRef.current.angle += dt * rotationSpeed * 0.45;
    }
    const camera = state.camera;
    // Allocate / recreate the FBO only while this system is mounted
    // (i.e. only when 'raymarch' is selected), sized by renderScale.
    gl.getDrawingBufferSize(tmp.dbSize);
    const w = Math.max(16, Math.round(tmp.dbSize.x * renderScale));
    const h = Math.max(16, Math.round(tmp.dbSize.y * renderScale));
    if (!fboRef.current || fboRef.current.w !== w || fboRef.current.h !== h) {
      if (fboRef.current) fboRef.current.rt.dispose();
      const rt = new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      fboRef.current = { rt, w, h };
      displayMaterial.uniforms.uTex.value = rt.texture;
    }
    const mesh = meshRef.current;
    if (!mesh || !fboRef.current) return;
    mesh.getWorldPosition(tmp.worldPos);
    camera.getWorldDirection(tmp.forward);
    tmp.toPlane.copy(tmp.worldPos).sub(camera.position);
    const distForward = tmp.toPlane.dot(tmp.forward);
    const dist = camera.position.distanceTo(tmp.worldPos);
    // Size the backdrop plane to cover the frustum at its depth.
    let frustumH = 1;
    let frustumW = 1;
    const persp = camera as THREE.PerspectiveCamera;
    const ortho = camera as THREE.OrthographicCamera;
    if (persp.isPerspectiveCamera) {
      frustumH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);
      frustumW = frustumH * persp.aspect;
    } else if (ortho.isOrthographicCamera) {
      frustumH = (ortho.top - ortho.bottom) / ortho.zoom;
      frustumW = (ortho.right - ortho.left) / ortho.zoom;
    }
    mesh.scale.set(frustumW, frustumH, 1);

    // Four corner rays of the frustum slice at the backdrop depth.
    const corners: [string, number, number][] = [
      ['uCornerBL', -1, -1], ['uCornerBR', 1, -1], ['uCornerTL', -1, 1], ['uCornerTR', 1, 1],
    ];
    for (const [name, nx, ny] of corners) {
      tmp.dir.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
      const denom = tmp.dir.dot(tmp.forward);
      const tHit = denom > 1e-6 ? distForward / denom : dist;
      tmp.corner.copy(camera.position).addScaledVector(tmp.dir, tHit);
      (raymarchMaterial.uniforms[name].value as THREE.Vector3).copy(tmp.corner);
    }
    // Scene centre along the camera forward (Distance key mechanism).
    tmp.centre.copy(camera.position).addScaledVector(tmp.forward, camera.position.length() * distanceKey);
    const u = raymarchMaterial.uniforms;
    u.uCamPos.value.copy(camera.position);
    u.uSceneCentre.value.copy(tmp.centre);
    u.uSceneScale.value = sceneScale;
    u.uTime.value = animRef.current.time;
    u.uRotationAngle.value = animRef.current.angle;
    u.uShape.value = SHAPE_IDS[shape];
    u.uPower.value = power;
    u.uSteps.value = steps;
    // Epsilon follows the pixel footprint: coarser FBO -> larger eps.
    u.uEps.value = 0.0009 / renderScale;
    u.uColor.value.set(raw.color);
    u.uOpacity.value = opacity;

    // Offscreen raymarch pass (RD-runtime pattern: save/restore target).
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(fboRef.current.rt);
    gl.render(simScene, simCamera);
    gl.setRenderTarget(prevTarget);
  });

  return (
    <group position={[0, 0, zOffset]}>
      <mesh ref={meshRef} material={displayMaterial} frustumCulled={false} renderOrder={-5}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
};
