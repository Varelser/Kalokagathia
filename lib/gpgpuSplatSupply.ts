import type { ParticleConfig } from '../types';
import {
  buildAttributeData,
  buildAttributeDataExt,
  normalizeAttrNames,
  normalizeAttrNames2,
  normalizeAttrSources,
  resolveAttrColorSlots,
  resolveAttrConsumers,
  resolveAttrNameSlot,
} from './gpgpuAttributes';
import { buildGpgpuInitialData } from './gpgpuInitialData';
import { getAttrPointCloud } from './attrPointCloud';
import { buildSplatParamData, type SplatParamData } from './gpgpuSplat';

// ── Splat parameter supply (Layer 1 WP7 Phase C2) ──────────
// Resolves the per-particle sources of the splat parameter
// bake (components/useGpgpuDrawAssets.ts rebakes the two
// parameter textures from this whenever the supply signature
// changes):
//
//   scale   — the attribute slot named by gpgpuSplatScaleAttr
//             multiplies each splat's scale triple; the
//             reserved value 'velocity' (case-insensitive)
//             selects the velocity-stretch supply instead:
//             quaternions aligned to the seeded velocity
//             field with the X scale elongated by
//             splatStretchMultiplier at strength
//             SPLAT_VELOCITY_STRETCH.
//   opacity — the attribute slot named by
//             gpgpuSplatOpacityAttr multiplies each splat's
//             opacity.
//
// Slot names resolve through resolveAttrNameSlot (the WP2
// name resolution, slots 0..7 across both name sets). A name
// that does not resolve leaves that channel on the uniform
// bake — the supply never invents values.
//
// The attribute values come from a LOCAL bake
// (buildAttributeData / buildAttributeDataExt run here, the
// U4 duplicate-bake precedent: the builders are pure). The
// local bake is fed the plain seeded initial data
// (buildGpgpuInitialData with the config's primitive emit
// inputs — the same standalone build the morph-fiber draw
// makes for itself), so two documented divergences from the
// runtime's own attribute bake apply: the morph cloud is not
// available here (a 'target'-source slot reads its no-cloud
// values), and directed emitter velocities / emitter
// transforms are not folded into the seeded field the
// stretch supply reads. The baked group / rule writes are
// likewise not applied — the supply reads the pristine slot
// values, exactly what setLastAttrBake publishes.

/** Reserved gpgpuSplatScaleAttr value selecting the
 *  velocity-stretch supply (takes precedence over a slot of
 *  the same name). */
export const SPLAT_SCALE_VELOCITY_SOURCE = 'velocity';

/** Strength of the velocity-stretch supply (the multiplier
 *  law is splatStretchMultiplier in lib/gpgpuSplat.ts). */
export const SPLAT_VELOCITY_STRETCH = 1;

export interface SplatParamSupply extends SplatParamData {
  /** Resolved scale slot 0..7, or -1 when the scale channel
   *  is uniform (no name, unresolvable name, velocity mode). */
  scaleSlot: number;
  /** Resolved opacity slot 0..7, or -1 when uniform. */
  opacitySlot: number;
  /** True while the scale source is the velocity supply. */
  velocityMode: boolean;
}

function extractSlotValues(
  base: Float32Array,
  ext: Float32Array | null,
  slot: number,
  count: number,
): Float32Array | null {
  if (slot < 0) return null;
  if (slot < 4) {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = base[i * 4 + slot] ?? 0;
    return out;
  }
  if (!ext) return null;
  const channel = slot - 4;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = ext[i * 4 + channel] ?? 0;
  return out;
}

/**
 * Build the splat parameter supply for a config. A pure
 * function of (config, texSize): with no supply authored the
 * result is exactly buildSplatParamData's uniform bake.
 */
export function buildSplatParamSupply(config: ParticleConfig, texSize: number): SplatParamSupply {
  const count = texSize * texSize;
  const names = normalizeAttrNames(config.gpgpuAttrNames);
  const names2 = normalizeAttrNames2(config.gpgpuAttrNames2);
  const scaleName = (config.gpgpuSplatScaleAttr ?? '').trim();
  const opacityName = (config.gpgpuSplatOpacityAttr ?? '').trim();
  const velocityMode = scaleName.toLowerCase() === SPLAT_SCALE_VELOCITY_SOURCE;
  const scaleSlot = !velocityMode && scaleName
    ? resolveAttrNameSlot(scaleName, names, names2)
    : -1;
  const opacitySlot = opacityName
    ? resolveAttrNameSlot(opacityName, names, names2)
    : -1;

  let scaleValues: Float32Array | null = null;
  let opacityValues: Float32Array | null = null;
  let velData: Float32Array | null = null;

  if (velocityMode || scaleSlot >= 0 || opacitySlot >= 0) {
    // The plain seeded build (see the header note): one build
    // feeds both the attribute bake and the stretch field.
    const init = buildGpgpuInitialData(
      texSize,
      config.gpgpuBounceRadius,
      config.gpgpuEmitShape,
      config.gpgpuSeed,
      config.gpgpuAgeMax,
    );
    if (velocityMode) velData = init.velData;
    if (scaleSlot >= 0 || opacitySlot >= 0) {
      const colorRawSlots = resolveAttrConsumers(config).colorActive
        ? resolveAttrColorSlots(names)
        : null;
      const base = buildAttributeData({
        texSize,
        posData: init.posData,
        velData: init.velData,
        ageMax: config.gpgpuAgeMax,
        bounceRadius: config.gpgpuBounceRadius,
        sphRadius: config.gpgpuSphRadius,
        sphRestDensity: config.gpgpuSphRestDensity,
        speciesCount: config.gpgpuParticleLifeSpecies,
        morphData: null,
        morphWorldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
        cloud: getAttrPointCloud(),
        names,
        sources: normalizeAttrSources(config.gpgpuAttrSources),
        exprs: config.gpgpuAttrExprs,
        colorRawSlots,
      });
      const ext = scaleSlot >= 4 || opacitySlot >= 4
        ? buildAttributeDataExt({
          texSize,
          posData: init.posData,
          velData: init.velData,
          ageMax: config.gpgpuAgeMax,
          bounceRadius: config.gpgpuBounceRadius,
          sphRadius: config.gpgpuSphRadius,
          sphRestDensity: config.gpgpuSphRestDensity,
          speciesCount: config.gpgpuParticleLifeSpecies,
          morphData: null,
          morphWorldScale: config.gpgpuMorphScale * config.gpgpuBounceRadius * 0.48,
          cloud: getAttrPointCloud(),
          firstBake: base,
          names,
          names2,
          sources2: normalizeAttrSources(config.gpgpuAttrSources2),
          exprs2: config.gpgpuAttrExprs2,
        })
        : null;
      scaleValues = extractSlotValues(base, ext, scaleSlot, count);
      opacityValues = extractSlotValues(base, ext, opacitySlot, count);
    }
  }

  const baked = buildSplatParamData({
    texSize,
    scaleValues,
    opacityValues,
    velData,
    stretch: velocityMode ? SPLAT_VELOCITY_STRETCH : 0,
  });
  return { ...baked, scaleSlot, opacitySlot, velocityMode };
}
