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
import { VEL_FRAG_PREAMBLE } from './gpgpuShaderSimulationVelocityPreamble';
import { VEL_FRAG_HELPERS } from './gpgpuShaderSimulationVelocityHelpers';
import { VEL_FRAG_MAIN_FORCES } from './gpgpuShaderSimulationVelocityMainForces';
import { VEL_FRAG_MAIN_SPH_GRAINS } from './gpgpuShaderSimulationVelocityMainSphGrains';
import { VEL_FRAG_MAIN_TAIL } from './gpgpuShaderSimulationVelocityMainTail';

export const SIM_VEL_FRAG =
  VEL_FRAG_PREAMBLE +
  VEL_FRAG_HELPERS +
  VEL_FRAG_MAIN_FORCES +
  VEL_FRAG_MAIN_SPH_GRAINS +
  VEL_FRAG_MAIN_TAIL;

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
export function buildVelocityFragment(customCode: string): string {
  const snippet = customCode.trim();
  if (!snippet) return SIM_VEL_FRAG;
  const extraction = extractCustomForceControls(snippet);
  const decls = extraction.ok ? extraction.decls : [];
  const body = applyCtrlDeclarations(snippet, decls);
  const injected = SIM_VEL_FRAG.replace(
    '    // __CUSTOM_FORCE__',
    `    { // custom force (user GLSL)\n${body}\n    }`,
  );
  if (decls.length === 0) return injected;
  return injected.replace(
    '  precision highp float;\n',
    `  precision highp float;\n${buildCtrlUniformDeclarations(decls)}`,
  );
}
