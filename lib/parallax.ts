// Phase AZ: parallax (2.5D layer shift) — pure math + config
// resolution. The scene's layer families (Layer 1 / Layer 2 /
// Layer 3 / ambient / the GPGPU family) each sit inside a plain
// group under the single SceneGroup (components/sceneParallaxGroup.tsx);
// this module decides how far each group is translated for a
// given camera position.
//
// Drive model: offset = (camera position − the config's default
// camera position) * factor, per group. The default position is
// the canonical framing a fresh load shows — the same values
// CameraImpulseRig pins under the determinism lock — so during a
// deterministic render the delta is exactly zero and exports are
// parallax-free for ANY factor. Factor 0 (the default for every
// group) makes the offset exactly (0, 0, 0) on every frame, the
// wrapper group's local matrix is the identity, and the composed
// world matrices are numerically the legacy ones: the render is
// bit-identical to the pre-AZ scene.
//
// The SceneGroup's own auto-rotation is deliberately NOT a drive
// signal: coupling groups to it would be differential rotation
// (unbounded drift), not parallax.

import type { ParticleConfig } from '../types';

export type ParallaxGroupId = 'layer1' | 'layer2' | 'layer3' | 'ambient' | 'gpgpu';

export const PARALLAX_GROUP_IDS: readonly ParallaxGroupId[] = [
  'layer1',
  'layer2',
  'layer3',
  'ambient',
  'gpgpu',
];

export const PARALLAX_FACTOR_MIN = -1;
export const PARALLAX_FACTOR_MAX = 1;

const PARALLAX_KEY_BY_GROUP: Record<ParallaxGroupId, keyof ParticleConfig> = {
  layer1: 'parallaxLayer1',
  layer2: 'parallaxLayer2',
  layer3: 'parallaxLayer3',
  ambient: 'parallaxAmbient',
  gpgpu: 'parallaxGpgpu',
};

export function getParallaxConfigKey(group: ParallaxGroupId): keyof ParticleConfig {
  return PARALLAX_KEY_BY_GROUP[group];
}

/** Clamp a raw config value to a usable factor. Non-finite or
 *  non-number input resolves to 0 (the legacy behaviour). */
export function clampParallaxFactor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value < PARALLAX_FACTOR_MIN) return PARALLAX_FACTOR_MIN;
  if (value > PARALLAX_FACTOR_MAX) return PARALLAX_FACTOR_MAX;
  return value;
}

/** The config's default camera position — the canonical framing
 *  (mirrors getDefaultCameraPosition in AppSceneCameraRig and the
 *  camera elements in AppScene): orthographic sits at z = 500,
 *  perspective at z = cameraDistance + 200. */
export function getParallaxDefaultCameraPosition(
  viewMode: ParticleConfig['viewMode'],
  cameraDistance: number,
): [number, number, number] {
  if (viewMode === 'orthographic') return [0, 0, 500];
  return [0, 0, cameraDistance + 200];
}

/** The per-group translation for one frame. Factor 0 returns the
 *  exact zero vector for any camera position. */
export function getParallaxGroupOffset(
  cameraPosition: readonly [number, number, number],
  defaultPosition: readonly [number, number, number],
  factor: unknown,
): [number, number, number] {
  const f = clampParallaxFactor(factor);
  if (f === 0) return [0, 0, 0];
  return [
    (cameraPosition[0] - defaultPosition[0]) * f,
    (cameraPosition[1] - defaultPosition[1]) * f,
    (cameraPosition[2] - defaultPosition[2]) * f,
  ];
}

/** Resolve the five group factors from a config (each clamped). */
export function resolveParallaxFactors(
  config: ParticleConfig,
): Record<ParallaxGroupId, number> {
  return {
    layer1: clampParallaxFactor(config.parallaxLayer1),
    layer2: clampParallaxFactor(config.parallaxLayer2),
    layer3: clampParallaxFactor(config.parallaxLayer3),
    ambient: clampParallaxFactor(config.parallaxAmbient),
    gpgpu: clampParallaxFactor(config.parallaxGpgpu),
  };
}

/** True when at least one group actually shifts. */
export function isParallaxActive(factors: Record<ParallaxGroupId, number>): boolean {
  return PARALLAX_GROUP_IDS.some((id) => factors[id] !== 0);
}
