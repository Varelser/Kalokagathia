import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import type { ParticleConfig } from '../types';
import type { SceneAudioRef } from './AppSceneTypes';

// Physarum (slime mould) transport-network simulation, after Jones (2010).
// Agents live on a 2D field: each senses the trail field ahead (centre and
// +/- sensor angle), steers toward the strongest reading, moves, and deposits
// trail. The trail field diffuses and decays each step, so frequently used
// paths reinforce into networks. Agent state is a float texture
// (x, y in field uv, z = heading, w = per-agent speed jitter); the trail is a
// second float texture. Both ping-pong like the reaction-diffusion system.
// The field is presented on a sheet at the layer's z offset (same placement
// as the reaction-diffusion display) with the agents drawn as points on it.

const FIELD_SIZE = 256;
const AGENT_GRID = 128; // 128x128 = 16384 agents

type PhysarumSystemProps = {
  config: ParticleConfig;
  layerIndex: 2 | 3;
  audioRef?: SceneAudioRef;
  isPlaying?: boolean;
};

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const AGENT_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uAgentTex;
  uniform sampler2D uTrailTex;
  uniform float uFieldSize;
  uniform float uSensorAngle;
  uniform float uSensorDist;
  uniform float uTurnSpeed;
  uniform float uMoveSpeed;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float sense(vec2 pos, float angle, float dist) {
    vec2 target = pos + vec2(cos(angle), sin(angle)) * dist;
    return texture2D(uTrailTex, fract(target)).x;
  }
  void main() {
    vec4 state = texture2D(uAgentTex, vUv);
    vec2 pos = state.xy;
    float heading = state.z;
    float jitter = state.w;
    float dist = uSensorDist / uFieldSize;
    float ahead = sense(pos, heading, dist);
    float left = sense(pos, heading + uSensorAngle, dist);
    float right = sense(pos, heading - uSensorAngle, dist);
    float rnd = hash(vUv * 91.7 + fract(uTime) * 13.13);
    if (ahead > left && ahead > right) {
      // keep heading
    } else if (ahead < left && ahead < right) {
      heading += (rnd - 0.5) * 2.0 * uTurnSpeed;
    } else if (left > right) {
      heading += uTurnSpeed;
    } else if (right > left) {
      heading -= uTurnSpeed;
    }
    vec2 next = pos + vec2(cos(heading), sin(heading)) * (uMoveSpeed * jitter / uFieldSize);
    gl_FragColor = vec4(fract(next), heading, jitter);
  }
`;

const TRAIL_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrevTex;
  uniform vec2 uTexel;
  uniform float uDecay;
  void main() {
    float c = texture2D(uPrevTex, vUv).x * 4.0;
    float n = texture2D(uPrevTex, vUv + vec2(0.0, uTexel.y)).x;
    float s = texture2D(uPrevTex, vUv - vec2(0.0, uTexel.y)).x;
    float e = texture2D(uPrevTex, vUv + vec2(uTexel.x, 0.0)).x;
    float w = texture2D(uPrevTex, vUv - vec2(uTexel.x, 0.0)).x;
    float blurred = (c + (n + s + e + w) * 2.0) / 12.0;
    gl_FragColor = vec4(vec3(clamp(blurred * uDecay, 0.0, 1.5)), 1.0);
  }
`;

const DEPOSIT_VERTEX = /* glsl */ `
  uniform sampler2D uAgentTex;
  void main() {
    vec4 state = texture2D(uAgentTex, position.xy);
    gl_Position = vec4(state.xy * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 2.0;
  }
`;

const DEPOSIT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform float uDeposit;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float falloff = smoothstep(0.5, 0.0, length(d));
    gl_FragColor = vec4(vec3(uDeposit), falloff);
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
  uniform sampler2D uTrailTex;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uDisplayMode;
  void main() {
    vec2 sampleUv = vUv;
    if (uDisplayMode > 0.5) {
      // Equal-area latitude remap (sphere mode only): the geometry uv.y
      // (g) sits at geometric polar angle theta = (1 - g) * PI. Under the
      // Lambert-style equal-area mapping the field row that belongs at
      // theta is v = (1 + cos(theta)) / 2, so equal field-row bands cover
      // equal sphere surface area and the polar caps are no longer
      // compressed. This is the exact inverse of the agent-points mapping
      // phi = acos(2v - 1), so the trail texture stays registered with
      // the agents that deposited it.
      float theta = (1.0 - vUv.y) * 3.14159265;
      sampleUv = vec2(vUv.x, 0.5 * (1.0 + cos(theta)));
    }
    float t = texture2D(uTrailTex, sampleUv).x;
    float body = clamp(t * 1.5, 0.0, 1.0);
    float core = smoothstep(0.55, 1.2, t);
    vec3 col = uColor * (0.25 + body * 0.95) + vec3(1.0) * core * 0.55;
    float alpha = uOpacity * clamp(0.10 + t * 1.35, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

const AGENT_POINTS_VERTEX = /* glsl */ `
  uniform sampler2D uAgentTex;
  uniform float uPlaneSize;
  uniform float uDisplayMode;
  uniform float uSphereRadius;
  void main() {
    vec4 state = texture2D(uAgentTex, position.xy);
    vec3 local;
    if (uDisplayMode > 0.5) {
      // Sphere mapping with equal-area latitude remap: longitude is
      // state.x * 2PI; the polar angle is phi = acos(2 * state.y - 1)
      // (Lambert cylindrical equal-area relation cos(phi) = 2v - 1), so
      // equal field-row bands cover equal sphere surface area instead of
      // bunching up at the poles. The trail display mesh samples the
      // field with the inverse remap, so agents sit exactly on the
      // network they deposit.
      float theta = state.x * 6.2831853;
      float phi = acos(clamp(2.0 * state.y - 1.0, -1.0, 1.0));
      float r = uSphereRadius * 1.01;
      local = vec3(r * sin(phi) * cos(theta), r * cos(phi), r * sin(phi) * sin(theta));
    } else {
      local = vec3((state.x - 0.5) * uPlaneSize, (state.y - 0.5) * uPlaneSize, 1.4);
    }
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(260.0 / max(1.0, -mv.z), 1.0, 5.0);
  }
`;

const AGENT_POINTS_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float falloff = smoothstep(0.5, 0.05, length(d));
    gl_FragColor = vec4(uColor * 1.6 + vec3(0.25), falloff * 0.9);
  }
`;

function buildAgentSeedTexture() {
  const data = new Float32Array(AGENT_GRID * AGENT_GRID * 4);
  for (let i = 0; i < AGENT_GRID * AGENT_GRID; i += 1) {
    // Concentrate agents in a central disc so networks grow outward.
    const r = Math.sqrt(Math.random()) * 0.34;
    const a = Math.random() * Math.PI * 2;
    data[i * 4 + 0] = 0.5 + Math.cos(a) * r;
    data[i * 4 + 1] = 0.5 + Math.sin(a) * r;
    data[i * 4 + 2] = Math.random() * Math.PI * 2;
    data[i * 4 + 3] = 0.6 + Math.random() * 0.7;
  }
  const tex = new THREE.DataTexture(data, AGENT_GRID, AGENT_GRID, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildTrailSeedTexture() {
  const data = new Float32Array(FIELD_SIZE * FIELD_SIZE * 4);
  const tex = new THREE.DataTexture(data, FIELD_SIZE, FIELD_SIZE, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildPointsGeometry(count: number, grid: number, withUvPositions: boolean) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const x = (i % grid) / grid + 0.5 / grid;
    const y = Math.floor(i / grid) / grid + 0.5 / grid;
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  void withUvPositions;
  return geo;
}

export const PhysarumSystem: React.FC<PhysarumSystemProps> = ({ config, layerIndex, isPlaying }) => {
  const { gl } = useThree();
  const rtOpts = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false } as const;
  const agentA = useFBO(AGENT_GRID, AGENT_GRID, rtOpts);
  const agentB = useFBO(AGENT_GRID, AGENT_GRID, rtOpts);
  const trailOpts = { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false } as const;
  const trailA = useFBO(FIELD_SIZE, FIELD_SIZE, trailOpts);
  const trailB = useFBO(FIELD_SIZE, FIELD_SIZE, trailOpts);

  const agentSeed = React.useMemo(() => buildAgentSeedTexture(), []);
  const trailSeed = React.useMemo(() => buildTrailSeedTexture(), []);

  const quadScene = React.useMemo(() => new THREE.Scene(), []);
  const quadCamera = React.useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const quadMesh = React.useMemo(() => new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), []);
  const depositScene = React.useMemo(() => new THREE.Scene(), []);

  const agentMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAgentTex: { value: agentSeed },
      uTrailTex: { value: trailSeed },
      uFieldSize: { value: FIELD_SIZE },
      uSensorAngle: { value: 0.65 },
      uSensorDist: { value: 7 },
      uTurnSpeed: { value: 0.7 },
      uMoveSpeed: { value: 1.4 },
      uTime: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: AGENT_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }), [agentSeed, trailSeed]);

  const trailMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPrevTex: { value: trailSeed },
      uTexel: { value: new THREE.Vector2(1 / FIELD_SIZE, 1 / FIELD_SIZE) },
      uDecay: { value: 0.95 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: TRAIL_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }), [trailSeed]);

  const agentCount = AGENT_GRID * AGENT_GRID;
  const depositGeometry = React.useMemo(() => buildPointsGeometry(agentCount, AGENT_GRID, true), [agentCount]);
  const depositMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAgentTex: { value: agentSeed },
      uDeposit: { value: 0.4 },
    },
    vertexShader: DEPOSIT_VERTEX,
    fragmentShader: DEPOSIT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  }), [agentSeed]);
  const depositPoints = React.useMemo(() => new THREE.Points(depositGeometry, depositMaterial), [depositGeometry, depositMaterial]);

  const displayMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uTrailTex: { value: trailSeed },
      uColor: { value: new THREE.Color('#9fd8ff') },
      uOpacity: { value: 0.85 },
      uDisplayMode: { value: 0 },
    },
    vertexShader: DISPLAY_VERTEX,
    fragmentShader: DISPLAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [trailSeed]);

  const agentPointsMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAgentTex: { value: agentSeed },
      uPlaneSize: { value: 300 },
      uDisplayMode: { value: 0 },
      uSphereRadius: { value: 150 },
      uColor: { value: new THREE.Color('#9fd8ff') },
    },
    vertexShader: AGENT_POINTS_VERTEX,
    fragmentShader: AGENT_POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
  }), [agentSeed]);

  const agentRef = React.useRef({ current: agentA, next: agentB, seeded: false });
  const trailRef = React.useRef({ current: trailA, next: trailB, seeded: false });

  const params = layerIndex === 2 ? {
    color: config.layer2Color,
    spread: config.layer2SourceSpread,
    sensorAngle: config.layer2PhysarumSensorAngle,
    sensorDistance: config.layer2PhysarumSensorDistance,
    turnSpeed: config.layer2PhysarumTurnSpeed,
    speed: config.layer2PhysarumSpeed,
    deposit: config.layer2PhysarumDeposit,
    decay: config.layer2PhysarumDecay,
    opacity: config.layer2PhysarumOpacity,
    display: config.layer2PhysarumDisplay ?? 'sheet',
  } : {
    color: config.layer3Color,
    spread: config.layer3SourceSpread,
    sensorAngle: config.layer3PhysarumSensorAngle,
    sensorDistance: config.layer3PhysarumSensorDistance,
    turnSpeed: config.layer3PhysarumTurnSpeed,
    speed: config.layer3PhysarumSpeed,
    deposit: config.layer3PhysarumDeposit,
    decay: config.layer3PhysarumDecay,
    opacity: config.layer3PhysarumOpacity,
    display: config.layer3PhysarumDisplay ?? 'sheet',
  };
  // Sheet size follows the layer's visual extent (sphereRadius), not the
  // particle-field source spread: some presets carry spreads in the
  // thousands, which would blow the sheet far past the camera.
  const planeSize = Math.min(Math.max(config.sphereRadius * 3.1, 160), 900);
  const zOffset = config.sphereRadius * (layerIndex === 2 ? -0.58 : 0.58);

  useFrame((state) => {
    if (isPlaying === false) return;
    const prevTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    const aRef = agentRef.current;
    const tRef = trailRef.current;
    if (!aRef.seeded) {
      agentMaterial.uniforms.uAgentTex.value = agentSeed;
      agentMaterial.uniforms.uTrailTex.value = trailSeed;
      aRef.seeded = true; // first step reads the seeds directly
    }
    if (!tRef.seeded) {
      trailMaterial.uniforms.uPrevTex.value = trailSeed;
      tRef.seeded = true;
    }
    for (let step = 0; step < 2; step += 1) {
      // 1) Agent step: sense trail, steer, move.
      quadScene.remove(quadMesh);
      quadMesh.material = agentMaterial;
      quadScene.add(quadMesh);
      agentMaterial.uniforms.uTime.value = state.clock.elapsedTime + step * 0.37;
      gl.setRenderTarget(aRef.next);
      gl.render(quadScene, quadCamera);
      const aSwap = aRef.current; aRef.current = aRef.next; aRef.next = aSwap;
      agentMaterial.uniforms.uAgentTex.value = aRef.current.texture;
      agentMaterial.uniforms.uTrailTex.value = tRef.current.texture;
      // 2) Trail diffuse + decay, then deposit from the new agent positions.
      quadMesh.material = trailMaterial;
      trailMaterial.uniforms.uPrevTex.value = tRef.current.texture;
      gl.setRenderTarget(tRef.next);
      gl.render(quadScene, quadCamera);
      depositMaterial.uniforms.uAgentTex.value = aRef.current.texture;
      if (!depositScene.children.includes(depositPoints)) depositScene.add(depositPoints);
      gl.autoClear = false;
      gl.render(depositScene, quadCamera);
      gl.autoClear = prevAutoClear;
      const tSwap = tRef.current; tRef.current = tRef.next; tRef.next = tSwap;
    }
    // Per-frame parameter + display updates.
    agentMaterial.uniforms.uSensorAngle.value = params.sensorAngle;
    agentMaterial.uniforms.uSensorDist.value = params.sensorDistance;
    agentMaterial.uniforms.uTurnSpeed.value = params.turnSpeed;
    agentMaterial.uniforms.uMoveSpeed.value = params.speed;
    trailMaterial.uniforms.uDecay.value = params.decay;
    depositMaterial.uniforms.uDeposit.value = params.deposit;
    displayMaterial.uniforms.uTrailTex.value = tRef.current.texture;
    displayMaterial.uniforms.uColor.value.set(params.color);
    displayMaterial.uniforms.uOpacity.value = params.opacity;
    displayMaterial.uniforms.uDisplayMode.value = params.display === 'sphere' ? 1 : 0;
    agentPointsMaterial.uniforms.uAgentTex.value = aRef.current.texture;
    agentPointsMaterial.uniforms.uPlaneSize.value = planeSize;
    agentPointsMaterial.uniforms.uDisplayMode.value = params.display === 'sphere' ? 1 : 0;
    agentPointsMaterial.uniforms.uSphereRadius.value = planeSize / 2;
    agentPointsMaterial.uniforms.uColor.value.set(params.color);
    gl.setRenderTarget(prevTarget);
  });

  const sphereDisplay = params.display === 'sphere';
  return (
    <group position={[0, 0, zOffset]}>
      {sphereDisplay ? (
        <mesh material={displayMaterial}>
          <sphereGeometry args={[planeSize / 2, 64, 48]} />
        </mesh>
      ) : (
        <mesh material={displayMaterial}>
          <planeGeometry args={[planeSize, planeSize]} />
        </mesh>
      )}
      <points geometry={depositGeometry} material={agentPointsMaterial} frustumCulled={false} />
    </group>
  );
};
