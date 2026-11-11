import React from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import type { ParticleConfig } from '../types';
import type { SceneAudioRef } from './AppSceneTypes';

// Diffusion-limited aggregation (DLA), after Witten & Sander (1981).
// Random walkers are released from the field border ring, diffuse one field
// texel per step, and stick to the growing aggregate when any 4-neighbour of
// their cell already holds aggregate density (with probability = stickiness).
// The aggregate field is a float texture that PERSISTS: each substep copies
// the previous field verbatim (factor 1.0, capped) and additively deposits
// the walkers that stuck this substep, then swaps — the same copy+deposit
// pass structure as the Physarum trail pass, minus diffusion/decay.
// Walker state is a float texture (x, y in field uv, z unused, w = flag:
// 0 = walking, 1 = stuck this substep). A stuck walker is respawned on the
// border ring on the next walk pass. Growth is soft-fenced to the
// central disc (stick probability tapers to zero over radius
// 0.22-0.42): GPU readback probes showed that if a branch reaches
// the border's neighbourhood the spawn flux zips a solid frame along
// it, a hard fence only relocates the ring, and a narrow taper
// collects a canopy hedge — so the fence is a wide gradient.
// Display is sheet-only: the
// aggregate is inherently planar (a 2D field), so unlike Physarum there is
// no sphere mode.

const FIELD_SIZE = 256;
const WALKER_GRID = 128; // 128x128 = 16384 walkers max

type DlaSeedShape = 'point' | 'line' | 'ring' | 'multi';

type DlaSystemProps = {
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

const WALK_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uWalkerTex;
  uniform sampler2D uFieldTex;
  uniform float uFieldSize;
  uniform float uGrid;
  uniform float uActiveCount;
  uniform float uStickiness;
  uniform float uTime;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  vec2 spawnPos(float hSide, float hT) {
    // Border-ring spawn: walkers (re)enter at a random point of the
    // field border ring, the classic far-field release for this design.
    float side = floor(hSide * 4.0);
    float inset = 0.008;
    if (side < 0.5) return vec2(hT, inset);
    if (side < 1.5) return vec2(hT, 1.0 - inset);
    if (side < 2.5) return vec2(inset, hT);
    return vec2(1.0 - inset, hT);
  }
  void main() {
    float idx = floor(vUv.x * uGrid) + floor(vUv.y * uGrid) * uGrid;
    if (idx >= uActiveCount) {
      // Parked outside the field; the walk pass respawns it if the active
      // count later grows past its index, and deposit/display discard it.
      gl_FragColor = vec4(2.0, 2.0, 0.0, 0.0);
      return;
    }
    vec4 state = texture2D(uWalkerTex, vUv);
    vec2 pos = state.xy;
    float hSide = hash(vUv * 17.17 + fract(uTime) * 7.71);
    float hT = hash(vUv * 91.7 + fract(uTime * 1.37) * 3.33);
    // (hSide, hT) are the spawn angle / radius hashes.
    float hAng = hash(vUv * 47.31 + fract(uTime * 0.83) * 5.57);
    float hStick = hash(vUv * 63.93 + fract(uTime * 0.61) * 9.17);
    if (state.w > 0.5 || pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
      // Stuck last substep (already deposited) or freshly activated:
      // respawn on the border ring.
      gl_FragColor = vec4(spawnPos(hSide, hT), 0.0, 0.0);
      return;
    }
    float ang = hAng * 6.2831853;
    vec2 next = clamp(pos + vec2(cos(ang), sin(ang)) / uFieldSize, vec2(0.001), vec2(0.999));
    vec2 texel = vec2(1.0 / uFieldSize);
    float n = texture2D(uFieldTex, next + vec2(0.0, texel.y)).x;
    float s = texture2D(uFieldTex, next - vec2(0.0, texel.y)).x;
    float e = texture2D(uFieldTex, next + vec2(texel.x, 0.0)).x;
    float w = texture2D(uFieldTex, next - vec2(texel.x, 0.0)).x;
    float nearAgg = max(max(n, s), max(e, w));
    // Growth fence (soft): the stick probability tapers to zero over
    // the wide annulus between radius 0.22 and 0.42 from the centre.
    // GPU readback probes (2026-11-11) showed (a) unfenced growth that
    // reaches the border's neighbourhood gets zipped into a solid
    // frame by the border-spawned walker flux within seconds, (b) a
    // HARD fence itself becomes a locus that zips into a ring, and
    // (c) a narrow taper collects a canopy hedge at its stall radius.
    // The wide gradient has no locus: outward tips decelerate over
    // ~50 texels and fade out, and the aggregate stays permanently
    // clear of the spawn region so flux arrives diffuse (Laplacian).
    float fence = 1.0 - smoothstep(0.22, 0.42, length(next - vec2(0.5)));
    float stuck = (nearAgg > 0.08 && hStick < uStickiness * fence) ? 1.0 : 0.0;
    // Rim guard: cells within ~3 texels of the border never stick, so the
    // respawn ring cannot crust into a solid frame.
    if (next.x < 0.012 || next.x > 0.988 || next.y < 0.012 || next.y > 0.988) stuck = 0.0;
    gl_FragColor = vec4(next, 0.0, stuck);
  }
`;

const FIELD_COPY_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrevTex;
  void main() {
    // The aggregate never decays: copy verbatim (capped so overlapping
    // deposits cannot run away to inf over long sessions).
    float d = texture2D(uPrevTex, vUv).x;
    gl_FragColor = vec4(vec3(min(d, 4.0)), 1.0);
  }
`;

const DEPOSIT_VERTEX = /* glsl */ `
  uniform sampler2D uWalkerTex;
  uniform float uThickness;
  uniform float uThicknessDecay;
  varying float vStuck;
  void main() {
    vec4 state = texture2D(uWalkerTex, position.xy);
    vStuck = state.w;
    // Thickness decay rule: branches thin with distance from the seed
    // centre — point size is scaled by
    // mix(1.0, 0.35, thicknessDecay * clamp(dist / fieldRadius, 0, 1))
    // where dist is the field-uv distance from (0.5, 0.5) and
    // fieldRadius = 0.5 in uv units.
    float distNorm = clamp(length(state.xy - vec2(0.5)) / 0.5, 0.0, 1.0);
    float factor = mix(1.0, 0.35, uThicknessDecay * distNorm);
    gl_PointSize = uThickness * factor;
    gl_Position = vec4(state.xy * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const DEPOSIT_FRAGMENT = /* glsl */ `
  precision highp float;
  varying float vStuck;
  uniform float uDeposit;
  void main() {
    if (vStuck < 0.5) discard;
    vec2 d = gl_PointCoord - 0.5;
    if (length(d) > 0.5) discard;
    gl_FragColor = vec4(vec3(uDeposit), 1.0);
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
  uniform sampler2D uFieldTex;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = texture2D(uFieldTex, vUv).x;
    // Density saturates: overlapping deposits brighten toward a white core
    // instead of clipping linearly.
    float bright = 1.0 - exp(-d * 1.6);
    float core = smoothstep(0.75, 1.8, d);
    vec3 col = uColor * (0.25 + bright * 0.95) + vec3(1.0) * core * 0.5;
    float alpha = uOpacity * clamp(bright * 1.3, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

const WALKER_POINTS_VERTEX = /* glsl */ `
  uniform sampler2D uWalkerTex;
  uniform float uPlaneSize;
  void main() {
    vec4 state = texture2D(uWalkerTex, position.xy);
    if (state.x < 0.0 || state.x > 1.0 || state.y < 0.0 || state.y > 1.0) {
      gl_Position = vec4(0.0, 0.0, -10.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    vec3 local = vec3((state.x - 0.5) * uPlaneSize, (state.y - 0.5) * uPlaneSize, 1.4);
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(160.0 / max(1.0, -mv.z), 1.0, 2.2);
  }
`;

const WALKER_POINTS_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float falloff = smoothstep(0.5, 0.05, length(d));
    gl_FragColor = vec4(uColor * 1.4 + vec3(0.2), falloff * 0.12 * uOpacity);
  }
`;

function buildWalkerSeedTexture() {
  const data = new Float32Array(WALKER_GRID * WALKER_GRID * 4);
  for (let i = 0; i < WALKER_GRID * WALKER_GRID; i += 1) {
    // Spawn on the border ring, matching the shader's respawn rule.
    const side = Math.floor(Math.random() * 4);
    const tt = Math.random();
    const inset = 0.008;
    let x = tt;
    let y = inset;
    if (side === 1) { x = tt; y = 1 - inset; } else if (side === 2) { x = inset; y = tt; } else if (side === 3) { x = 1 - inset; y = tt; }
    data[i * 4 + 0] = x;
    data[i * 4 + 1] = y;
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 0;
  }
  const tex = new THREE.DataTexture(data, WALKER_GRID, WALKER_GRID, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildFieldSeedTexture(shape: DlaSeedShape) {
  const data = new Float32Array(FIELD_SIZE * FIELD_SIZE * 4);
  const set = (cx: number, cy: number, v: number) => {
    if (cx < 0 || cy < 0 || cx >= FIELD_SIZE || cy >= FIELD_SIZE) return;
    data[(cy * FIELD_SIZE + cx) * 4 + 0] = v;
  };
  const blob = (fx: number, fy: number, r: number, v: number) => {
    const cx = Math.round(fx * FIELD_SIZE);
    const cy = Math.round(fy * FIELD_SIZE);
    for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= r * r) set(cx + dx, cy + dy, v);
    }
  };
  const c = FIELD_SIZE / 2;
  if (shape === 'point') {
    blob(0.5, 0.5, 2, 1.5);
  } else if (shape === 'line') {
    for (let x = c - 42; x <= c + 42; x += 1) { set(x, c, 1.5); set(x, c + 1, 1.0); }
  } else if (shape === 'ring') {
    const r = 42;
    for (let i = 0; i < 720; i += 1) {
      const a = (i / 720) * Math.PI * 2;
      set(Math.round(c + Math.cos(a) * r), Math.round(c + Math.sin(a) * r), 1.5);
    }
  } else {
    // 'multi': five seed points clustered around the centre (radius
    // <= ~0.14). An earlier wide scatter (radius ~0.3) put the seeds
    // at the soft-fence taper, where their canopies merged into a
    // hollow ring and screened the middle (probe-verified); a central
    // grove grows five trees side by side instead.
    blob(0.42, 0.44, 2, 1.5);
    blob(0.58, 0.42, 2, 1.5);
    blob(0.50, 0.56, 2, 1.5);
    blob(0.40, 0.60, 2, 1.5);
    blob(0.62, 0.60, 2, 1.5);
  }
  const tex = new THREE.DataTexture(data, FIELD_SIZE, FIELD_SIZE, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildPointsGeometry(count: number, grid: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3 + 0] = (i % grid) / grid + 0.5 / grid;
    positions[i * 3 + 1] = Math.floor(i / grid) / grid + 0.5 / grid;
    positions[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

const clampN = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? v : fallback));

export const DlaSystem: React.FC<DlaSystemProps> = ({ config, layerIndex, isPlaying }) => {
  const { gl } = useThree();
  const walkerOpts = { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false } as const;
  const walkerA = useFBO(WALKER_GRID, WALKER_GRID, walkerOpts);
  const walkerB = useFBO(WALKER_GRID, WALKER_GRID, walkerOpts);
  const fieldOpts = { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false } as const;
  const fieldA = useFBO(FIELD_SIZE, FIELD_SIZE, fieldOpts);
  const fieldB = useFBO(FIELD_SIZE, FIELD_SIZE, fieldOpts);

  const seedShapeValue: DlaSeedShape = (layerIndex === 2 ? config.layer2DlaSeedShape : config.layer3DlaSeedShape) ?? 'point';
  const walkerSeed = React.useMemo(() => buildWalkerSeedTexture(), []);
  const fieldSeed = React.useMemo(() => buildFieldSeedTexture(seedShapeValue), [seedShapeValue]);

  const quadScene = React.useMemo(() => new THREE.Scene(), []);
  const quadCamera = React.useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const quadMesh = React.useMemo(() => new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), []);
  const depositScene = React.useMemo(() => new THREE.Scene(), []);

  const walkMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWalkerTex: { value: walkerSeed },
      uFieldTex: { value: fieldSeed },
      uFieldSize: { value: FIELD_SIZE },
      uGrid: { value: WALKER_GRID },
      uActiveCount: { value: 8192 },
      uStickiness: { value: 0.7 },
      uTime: { value: 0 },
    },
    vertexShader: QUAD_VERTEX,
    fragmentShader: WALK_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }), [walkerSeed, fieldSeed]);

  const fieldCopyMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uPrevTex: { value: fieldSeed } },
    vertexShader: QUAD_VERTEX,
    fragmentShader: FIELD_COPY_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  }), [fieldSeed]);

  const walkerCount = WALKER_GRID * WALKER_GRID;
  const pointsGeometry = React.useMemo(() => buildPointsGeometry(walkerCount, WALKER_GRID), [walkerCount]);
  const depositMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWalkerTex: { value: walkerSeed },
      uThickness: { value: 2 },
      uThicknessDecay: { value: 0.3 },
      uDeposit: { value: 1.0 },
    },
    vertexShader: DEPOSIT_VERTEX,
    fragmentShader: DEPOSIT_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  }), [walkerSeed]);
  const depositPoints = React.useMemo(() => new THREE.Points(pointsGeometry, depositMaterial), [pointsGeometry, depositMaterial]);

  const displayMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uFieldTex: { value: fieldSeed },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0.9 },
    },
    vertexShader: DISPLAY_VERTEX,
    fragmentShader: DISPLAY_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), [fieldSeed]);

  const walkerPointsMaterial = React.useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWalkerTex: { value: walkerSeed },
      uPlaneSize: { value: 300 },
      uColor: { value: new THREE.Color('#ffffff') },
      uOpacity: { value: 0.9 },
    },
    vertexShader: WALKER_POINTS_VERTEX,
    fragmentShader: WALKER_POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
  }), [walkerSeed]);

  const walkerRef = React.useRef({ current: walkerA, next: walkerB, seeded: false });
  const fieldRef = React.useRef({ current: fieldA, next: fieldB, seeded: false });
  const reseedKeyRef = React.useRef<string | null>(null);

  const params = layerIndex === 2 ? {
    color: config.layer2Color,
    walkers: clampN(config.layer2DlaWalkers, 8192, 1024, 16384),
    steps: Math.round(clampN(config.layer2DlaSteps, 10, 1, 40)),
    stickiness: clampN(config.layer2DlaStickiness, 0.7, 0.05, 1),
    thickness: clampN(config.layer2DlaThickness, 2, 1, 4),
    thicknessDecay: clampN(config.layer2DlaThicknessDecay, 0.3, 0, 1),
    seedShape: seedShapeValue,
    seed: config.layer2DlaSeed ?? 1,
    opacity: clampN(config.layer2DlaOpacity, 0.9, 0, 1),
  } : {
    color: config.layer3Color,
    walkers: clampN(config.layer3DlaWalkers, 8192, 1024, 16384),
    steps: Math.round(clampN(config.layer3DlaSteps, 10, 1, 40)),
    stickiness: clampN(config.layer3DlaStickiness, 0.7, 0.05, 1),
    thickness: clampN(config.layer3DlaThickness, 2, 1, 4),
    thicknessDecay: clampN(config.layer3DlaThicknessDecay, 0.3, 0, 1),
    seedShape: seedShapeValue,
    seed: config.layer3DlaSeed ?? 1,
    opacity: clampN(config.layer3DlaOpacity, 0.9, 0, 1),
  };
  // Sheet placement mirrors the Physarum/RD sheets for this layer.
  const planeSize = Math.min(Math.max(config.sphereRadius * 3.1, 160), 900);
  const zOffset = config.sphereRadius * (layerIndex === 2 ? -0.58 : 0.58);

  useFrame((state) => {
    const wRef = walkerRef.current;
    const fRef = fieldRef.current;
    // Reseed triggers: seed shape change, seed nonce (Regrow) change, and
    // first mount / layer-type switch (fresh mount resets the refs).
    const reseedKey = `${params.seedShape}:${params.seed}`;
    if (reseedKeyRef.current !== reseedKey) {
      reseedKeyRef.current = reseedKey;
      wRef.seeded = false;
      fRef.seeded = false;
    }
    // Display always tracks the latest field/walkers (or the seed before
    // the first simulated frame), so the sheet renders while paused too.
    displayMaterial.uniforms.uFieldTex.value = fRef.seeded ? fRef.current.texture : fieldSeed;
    displayMaterial.uniforms.uColor.value.set(params.color);
    displayMaterial.uniforms.uOpacity.value = params.opacity;
    walkerPointsMaterial.uniforms.uWalkerTex.value = wRef.seeded ? wRef.current.texture : walkerSeed;
    walkerPointsMaterial.uniforms.uPlaneSize.value = planeSize;
    walkerPointsMaterial.uniforms.uColor.value.set(params.color);
    walkerPointsMaterial.uniforms.uOpacity.value = params.opacity;
    if (isPlaying === false) return;

    const prevTarget = gl.getRenderTarget();
    const prevAutoClear = gl.autoClear;
    walkMaterial.uniforms.uActiveCount.value = params.walkers;
    walkMaterial.uniforms.uStickiness.value = params.stickiness;
    depositMaterial.uniforms.uThickness.value = params.thickness;
    depositMaterial.uniforms.uThicknessDecay.value = params.thicknessDecay;

    for (let step = 0; step < params.steps; step += 1) {
      // 1) Walk pass: diffuse one texel, stick-check against the field.
      quadScene.remove(quadMesh);
      quadMesh.material = walkMaterial;
      quadScene.add(quadMesh);
      walkMaterial.uniforms.uWalkerTex.value = wRef.seeded ? wRef.current.texture : walkerSeed;
      walkMaterial.uniforms.uFieldTex.value = fRef.seeded ? fRef.current.texture : fieldSeed;
      walkMaterial.uniforms.uTime.value = state.clock.elapsedTime + step * 0.37;
      gl.setRenderTarget(wRef.next);
      gl.render(quadScene, quadCamera);
      const wSwap = wRef.current; wRef.current = wRef.next; wRef.next = wSwap;
      wRef.seeded = true;
      // 2) Field pass: copy the persistent field into the next target,
      // then deposit this substep's stuck walkers additively on top.
      quadMesh.material = fieldCopyMaterial;
      fieldCopyMaterial.uniforms.uPrevTex.value = fRef.seeded ? fRef.current.texture : fieldSeed;
      gl.setRenderTarget(fRef.next);
      gl.render(quadScene, quadCamera);
      depositMaterial.uniforms.uWalkerTex.value = wRef.current.texture;
      if (!depositScene.children.includes(depositPoints)) depositScene.add(depositPoints);
      gl.autoClear = false;
      gl.render(depositScene, quadCamera);
      gl.autoClear = prevAutoClear;
      const fSwap = fRef.current; fRef.current = fRef.next; fRef.next = fSwap;
      fRef.seeded = true;
    }
    displayMaterial.uniforms.uFieldTex.value = fRef.current.texture;
    walkerPointsMaterial.uniforms.uWalkerTex.value = wRef.current.texture;
    gl.setRenderTarget(prevTarget);
  });

  return (
    <group position={[0, 0, zOffset]}>
      <mesh material={displayMaterial}>
        <planeGeometry args={[planeSize, planeSize]} />
      </mesh>
      <points geometry={pointsGeometry} material={walkerPointsMaterial} frustumCulled={false} />
    </group>
  );
};
