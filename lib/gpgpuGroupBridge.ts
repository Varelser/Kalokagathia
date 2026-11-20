/**
 * Runtime → panel bridge for Phase CV group freezing.
 *
 * The control panel owns the group definitions (config), but the
 * current attribute bake — the only thing a freeze can evaluate
 * against — lives inside the GPGPU runtime. The runtime publishes
 * each finished bake here (interleaved RGBA float data, the same
 * array the attribute texture is built from); the panel's freeze
 * action reads it synchronously. Read-only from the panel side:
 * freezing writes back through the normal config update path.
 */

export interface LastAttrBake {
  data: Float32Array;
  texSize: number;
}

let lastBake: LastAttrBake | null = null;

export function setLastAttrBake(data: Float32Array, texSize: number): void {
  lastBake = { data, texSize };
}

export function getLastAttrBake(): LastAttrBake | null {
  return lastBake;
}

export function clearLastAttrBake(): void {
  lastBake = null;
}
