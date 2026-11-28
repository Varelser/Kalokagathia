#!/usr/bin/env node
// layer1-wp2b-wiring.test.mjs — Layer 1 WP2 phase B3: the
// scene wiring for the two generators completed in B1 / B2.
//
// The attribute stage order in components/sceneGpgpuSystem.tsx
// is now
//   bake -> feedback | dyn -> chain -> mapping -> REP
//        -> rule-write -> consumers
// and this file pins that order and the consumer hand-off
// with source-string pins (the stage5-rep-two-phase test's
// discipline), because the wiring itself only exists as the
// scene's useFrame body:
//
// (a) imports + fragment construction: the mapping fragment
//     is built from parseAttrMappings(config.gpgpuAttrMappings)
//     under the chain's own !groupGateBaked guard; the
//     rule-write fragment is built by
//     buildRuleAttrWriteFragment over ruleLiveRules.
// (b) execution order: chain run < mapping run < REP run(s)
//     < rule-write run, the write run lands after the
//     fracture readback, and attrFinalTexture composes
//     mapping ?? chain ?? dyn.
// (c) consumers: runSimulationPasses receives
//     attrTex: consumerAttrTex and syncVisualUniforms
//     receives attrTexture: drawAttrTex, both defined as the
//     held write texture falling back to the pre-B3 values;
//     the REP's own bindings keep reading simAttrTex.
// (d) the stage-6 L1-2 liquid arguments in the
//     runSimulationPasses call are byte-unchanged.
//     (第45期統合では液体は杉判断(c)で除外のため、(d) は
//     引数が存在しないことを確認する形に反転している。)
// (e) the write stage has its own signature, independent of
//     ruleLiveSignature (no interval / merged-plan inputs).
//
// Run: node scripts/layer1-wp2b-wiring.test.mjs

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'components', 'sceneGpgpuSystem.tsx'), 'utf8');

let failures = 0;
let checks = 0;
const check = (name, cond) => {
  checks += 1;
  if (!cond) { failures += 1; console.error(`FAIL: ${name}`); }
};
const count = (needle) => src.split(needle).length - 1;
const idx = (needle) => src.indexOf(needle);

// ── (a) imports + fragment construction ──────────────────
check('a imports the mapping builder + parser from lib/gpgpuAttrMappings',
  src.includes("import { buildAttrMappingFragment, parseAttrMappings } from '../lib/gpgpuAttrMappings';"));
check('a imports buildRuleAttrWriteFragment from lib/gpgpuParticleRulesLive',
  src.includes('buildRuleAttrWriteFragment,')
  && src.includes("} from '../lib/gpgpuParticleRulesLive';"));
check('a mapping fragment is built under the !groupGateBaked guard from the parsed table',
  src.includes('const attrMappingFragment = !groupGateBaked')
  && src.includes("parseAttrMappings(config.gpgpuAttrMappings ?? '')"));
check('a rule-write fragment is built over the merged rule list',
  src.includes('const ruleAttrWriteFragment = buildRuleAttrWriteFragment(\n    ruleLiveRules,'));
check('a both stages reuse the dyn pass class',
  src.includes('new GpgpuAttrDynPass(texSize, attrMappingFragment)')
  && src.includes('new GpgpuAttrDynPass(texSize, ruleAttrWriteFragment)'));

// ── (b) execution order ──────────────────────────────────
const chainRun = idx('attrChainPass.run(');
const mappingRun = idx('attrMappingPass.run(');
const repRunFirst = idx('ruleEvalPass.run(');
const repRunLast = src.lastIndexOf('ruleEvalPass.run(');
const fractureReadback = idx('runtime.noteLiveFractureMask(');
const writeRun = idx('ruleAttrWritePassRef.current.run(');
check('b all four stage runs are present',
  chainRun >= 0 && mappingRun >= 0 && repRunFirst >= 0 && writeRun >= 0);
check('b mapping runs after chain', chainRun < mappingRun);
check('b REP runs after mapping', mappingRun < repRunFirst);
check('b rule-write runs after the REP (both phases)', repRunLast < writeRun);
check('b rule-write runs after the fracture readback', fractureReadback >= 0 && fractureReadback < writeRun);
check('b the write pass reads simAttrTex (the REP input = the final attribute texture)',
  src.includes('ruleAttrWritePassRef.current.run(\n              glCtx, simAttrTex, timeRef.current, attrPassExtra,'));
check('b attrFinalTexture composes mapping ?? chain ?? dyn',
  src.includes('const attrFinalTexture = attrMappingTexture ?? attrChainTexture ?? attrDynTexture;'));
check('b mapping input is the chain output (else stage-1, else bake)',
  src.includes('const chainAttrTex = attrChainTexture ?? attrDynTexture ?? attrTexRef.current;'));
check('b rule-write joins the density-supply detection (a set-attr expression may read den)',
  src.includes('ruleLiveFragment, ruleAttrWriteFragment]'));

// ── (c) consumers ────────────────────────────────────────
check('c consumerAttrTex falls back to simAttrTex',
  src.includes('const consumerAttrTex = ruleAttrWriteTextureRef.current ?? simAttrTex;'));
check('c drawAttrTex falls back to the pre-B3 draw value',
  src.includes('const drawAttrTex = ruleAttrWriteTextureRef.current ?? attrFinalTexture ?? attrTexRef.current;'));
check('c runSimulationPasses receives the consumer texture exactly once',
  count('attrTex: consumerAttrTex,') === 1);
// 第45期統合: 液体は杉判断(c)で除外 — the liquid arguments are
// not part of this tree, so the hand-off check keeps only its
// non-liquid half (the hand-off sits inside the call) and the
// (d) checks below pin the liquid arguments' absence.
check('c the consumer hand-off sits inside the runSimulationPasses call (liquid args absent — 第45期統合)',
  idx('runSimulationPasses({') < idx('attrTex: consumerAttrTex,')
  && idx('liquidPass: liquidPassRef.current,') === -1);
check('c syncVisualUniforms receives the draw texture',
  src.includes('attrTexture: drawAttrTex,'));
check('c pre-B3 consumers keep simAttrTex (REP bindings, spin, orient, stacks)',
  count('attrTex: simAttrTex,') >= 4);

// ── (d) stage-6 L1-2 liquid arguments ────────────────────
// 第45期統合: 液体は杉判断(c)で除外 — in this tree the liquid
// arguments must be ABSENT (they return with the liquid
// integration, at which point these checks flip back to
// "present exactly once").
check('d liquidPass argument is absent (第45期統合: 液体は杉判断(c)で除外)',
  count('liquidPass: liquidPassRef.current,') === 0);
check('d liquidSpareRT argument is absent (第45期統合: 液体は杉判断(c)で除外)',
  count('liquidSpareRT: prevPosRTRef.current,') === 0);

// ── (e) independent write signature ──────────────────────
const sigStart = idx('const ruleAttrWriteSignature');
const sigBlock = sigStart >= 0 ? src.slice(sigStart, sigStart + 700) : '';
check('e the write signature exists with its own prefix',
  sigBlock.includes('`raw|'));
check('e the write signature does not ride ruleLiveSignature',
  sigBlock.length > 0 && !sigBlock.includes('ruleLiveSignature'));
check('e the write signature excludes the REP interval and merged plan',
  sigBlock.length > 0 && !sigBlock.includes('ruleLiveInterval') && !sigBlock.includes('merged'));

console.log(`layer1-wp2b-wiring: ${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
