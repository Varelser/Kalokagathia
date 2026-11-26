// ── Velocity sim fragment (+ N-body) ──
//
// Phase AV (behaviour-zero maintenance): the fragment body was split
// into five verbatim chunk modules (preamble / helpers / main forces /
// main SPH+Grains / main tail), the same shell pattern as the Forces
// split in v1.39.1. This module only concatenates the chunks in the
// original order and re-exports the public surface, so
// SIM_VEL_FRAG is byte-identical to the pre-split string (pinned by
// phaseav_test.mjs: length 70447, sha256
// 49b31f9d7c004017b8f4d68cba8c6f5af258401dfcc98b0e9cb1a9ea2ff14889).
import {
  applyCtrlDeclarations,
  buildCtrlUniformDeclarations,
  extractCustomForceControls,
} from '../lib/gpgpuCustomForceControls';
import { VEL_FRAG_PREAMBLE, buildVelocityPreamble } from './gpgpuShaderSimulationVelocityPreamble';
import { VEL_FRAG_HELPERS } from './gpgpuShaderSimulationVelocityHelpers';
import { VEL_FRAG_MAIN_FORCES, buildMainForcesFragment } from './gpgpuShaderSimulationVelocityMainForces';
import { isDefaultGpgpuForceOrder } from '../lib/gpgpuForceOrder';
import { VEL_FRAG_MAIN_SPH_GRAINS, buildVelocitySphGrains } from './gpgpuShaderSimulationVelocityMainSphGrains';
import { VEL_FRAG_MAIN_TAIL, buildVelocityTail } from './gpgpuShaderSimulationVelocityMainTail';

export const SIM_VEL_FRAG =
  VEL_FRAG_PREAMBLE +
  VEL_FRAG_HELPERS +
  VEL_FRAG_MAIN_FORCES +
  VEL_FRAG_MAIN_SPH_GRAINS +
  VEL_FRAG_MAIN_TAIL;

// Phase 19 gate fix: string-level shader variants. On the target
// GPU, ANY code-text change in this fragment breaks bit-identity
// with v2.00 — even code gated off by a false uniform (measured,
// see PHASE19_GATE_DIAGNOSIS). The Phase 19 additions (the Grains
// complete neighbourhood scan, the FLIP 3D coupling) therefore
// exist only in variant strings selected by these options; with
// no options set, every chunk above is byte-identical to v2.00
// and SIM_VEL_FRAG is the v2.00 string. SIM_VEL_FRAG_PHASE19 is
// the full Phase 19 string (both variants on), byte-identical to
// the Phase 19 SIM_VEL_FRAG. Both are pinned by
// scripts/phase18-shader-hash.mjs.
export interface VelocityFragmentVariantOptions {
  grainsFullScan?: boolean;
  flip3dCouple?: boolean;
  // Phase 20 stage 2: crowd steering ('steer-seek' chunk +
  // its preamble uniform set), spliced in in the Phase 19
  // manner — only while the steer-seek keys are on.
  steeringSeek?: boolean;
  // Phase 24: Akinci surface tension (preamble uniform +
  // SPH-head chunks), spliced in in the same manner — only
  // while the Akinci strength key is above zero.
  sphAkinci?: boolean;
  // Phase 27 (9-6 stage 1): strange attractor unit 2
  // (preamble uniform set + the 'attractor-2' force chunk),
  // spliced in in the same manner — only while the unit-2
  // enable key is on.
  attractor2?: boolean;
  // Phase 29 (9-6 stage 2): attractor units 3 and 4, spliced
  // in identically while their enable keys are on.
  attractor3?: boolean;
  attractor4?: boolean;
  // Grains Stage C: XSPH velocity smoothing (preamble uniform
  // set + the segment after the Grains block), spliced in in
  // the same manner — only while the pile plan is active with
  // a positive XSPH strength.
  grainsPileXsph?: boolean;
  // Round 84 gap 2: crowd state machine (preamble uniform set
  // + the crowd variant of the 'steer-seek' chunk), spliced
  // in in the same manner — only while the crowd key is on.
  crowd?: boolean;
  // G10 stage 1: particle rules (main-forces mask segment),
  // spliced in in the same manner — only while an effective
  // rule list exists.
  particleRules?: boolean;
}

export const SIM_VEL_FRAG_PHASE19 =
  buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true }) +
  VEL_FRAG_HELPERS +
  VEL_FRAG_MAIN_FORCES +
  buildVelocitySphGrains({ grainsFullScan: true }) +
  buildVelocityTail({ flip3dCouple: true });

// Phase 20 stage 2: the full Phase 20 string — every Phase 19
// variant plus the steering additions (preamble uniform set and
// the 'steer-seek' force chunk at its default order position,
// last). The Phase 19 and default strings above are unchanged.
export const SIM_VEL_FRAG_PHASE20 =
  buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true }) +
  VEL_FRAG_HELPERS +
  buildMainForcesFragment(undefined, { steeringSeek: true }) +
  buildVelocitySphGrains({ grainsFullScan: true }) +
  buildVelocityTail({ flip3dCouple: true });

// Phase 24: the full Phase 24 string — every Phase 20 variant
// plus the Akinci surface-tension additions (preamble uniform
// and the SPH-head chunks). The default, Phase 19 and Phase 20
// strings above are unchanged.
export const SIM_VEL_FRAG_PHASE24 =
  buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true }) +
  VEL_FRAG_HELPERS +
  buildMainForcesFragment(undefined, { steeringSeek: true }) +
  buildVelocitySphGrains({ grainsFullScan: true, sphAkinci: true }) +
  buildVelocityTail({ flip3dCouple: true });

// Phase 27: the full Phase 27 string — every Phase 24 variant
// plus the attractor unit-2 additions (preamble uniform set
// and the 'attractor-2' force chunk right after 'attractor').
// The default, Phase 19, Phase 20 and Phase 24 strings above
// are unchanged.
export const SIM_VEL_FRAG_PHASE27 =
  buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true }) +
  VEL_FRAG_HELPERS +
  buildMainForcesFragment(undefined, { steeringSeek: true, attractor2: true }) +
  buildVelocitySphGrains({ grainsFullScan: true, sphAkinci: true }) +
  buildVelocityTail({ flip3dCouple: true });

// Phase 29: the full Phase 29 string — every Phase 27 variant
// plus the attractor unit-3 / unit-4 additions (preamble
// uniform sets and the replicated force chunks right after
// 'attractor-2'). The strings above are unchanged.
export const SIM_VEL_FRAG_PHASE29 =
  buildVelocityPreamble({ grainsFullScan: true, flip3dCouple: true, steeringSeek: true, sphAkinci: true, attractor2: true, attractor3: true, attractor4: true }) +
  VEL_FRAG_HELPERS +
  buildMainForcesFragment(undefined, { steeringSeek: true, attractor2: true, attractor3: true, attractor4: true }) +
  buildVelocitySphGrains({ grainsFullScan: true, sphAkinci: true }) +
  buildVelocityTail({ flip3dCouple: true });

// Builds the effective velocity fragment shader with a user's custom GLSL
// force snippet injected at the placeholder above — after every built-in
// force has been accumulated into `vel`, before the speed clamp, damping
// and boundary bounce. The snippet runs in a block scope and may read
// `pos`, `vel`, `uTime` and `uDelta` (see lib/gpgpuCustomForce.ts for the
// validation and compile-check contract). An empty snippet yields the
// stock shader unchanged.
// KCB1: when the snippet declares ctrl() controls (see
// lib/gpgpuCustomForceControls.ts), the calls are rewritten to
// uCtrl_<id> uniform references and the uniform declarations are
// injected right after the preamble's precision line. A snippet
// without declarations takes the historical path only, so the
// output stays byte-identical to the pre-KCB1 builder.
export function buildVelocityFragment(customCode: string, forceOrder?: string, options?: VelocityFragmentVariantOptions): string {
  const snippet = customCode.trim();
  // Phase 18 stage 2: a non-default force order rebuilds the
  // main-forces chunk in that order. The default order ('' /
  // unset) takes the historical path only, so the output stays
  // byte-identical to SIM_VEL_FRAG. The custom-force placeholder
  // lives in the main tail chunk, so ordering never competes
  // with the snippet injection below.
  // Phase 19 gate fix: a Phase 19 variant option rebuilds the
  // affected chunks in their variant form. With no variant on,
  // the historical paths above are untouched.
  const hasVariant = !!options?.grainsFullScan || !!options?.flip3dCouple || !!options?.steeringSeek || !!options?.sphAkinci || !!options?.attractor2 || !!options?.attractor3 || !!options?.attractor4 || !!options?.grainsPileXsph || !!options?.crowd || !!options?.particleRules;
  const base = !hasVariant && (!forceOrder || isDefaultGpgpuForceOrder(forceOrder))
    ? SIM_VEL_FRAG
    : buildVelocityPreamble(options) + VEL_FRAG_HELPERS + buildMainForcesFragment(forceOrder, options)
      + buildVelocitySphGrains(options) + buildVelocityTail(options);
  if (!snippet) return base;
  const extraction = extractCustomForceControls(snippet);
  const decls = extraction.ok ? extraction.decls : [];
  const body = applyCtrlDeclarations(snippet, decls);
  const injected = base.replace(
    '    // __CUSTOM_FORCE__',
    `    { // custom force (user GLSL)\n${body}\n    }`,
  );
  if (decls.length === 0) return injected;
  return injected.replace(
    '  precision highp float;\n',
    `  precision highp float;\n${buildCtrlUniformDeclarations(decls)}`,
  );
}
