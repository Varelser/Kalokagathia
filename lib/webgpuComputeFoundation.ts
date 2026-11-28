import type { ParticleConfig } from '../types';
import {
  attrExprsReferenceSimVar,
  normalizeAttrExprs,
  resolveAttrExtConsumers,
} from './gpgpuAttributes';
import { flip3dMode } from './flip3d';
import { GRAINS_DEM_FEATURE, resolveGrainsDemPlan } from './gpgpuGrains';
import { hasEffectiveParticleRules } from './gpgpuParticleRules';
import {
  hasEffectiveLiveRules,
  liveRulesWgslCoverable,
  resolveLiveParticleRules,
} from './gpgpuParticleRulesLive';
import { parseGpgpuGroups } from './gpgpuGroups';
import { emitterRespawnShapeActive, emitterTransformActive, emitterVelocityDirectedActive } from './gpgpuEmitter';
import { spawnRateAbsoluteActive, spawnRuleGateKeyOn } from './gpgpuSpawnAllocator';
import { emissionMaskActive, emissionMaskVariantActive, emissionPathActive, emissionSourceActive } from './gpgpuEmissionSource';
import { fieldInstancesActive } from './gpgpuFieldInstances';
import { pathAssetExtended, steeringPathAssetActive, steeringCrowdPathAssetActive } from './gpgpuPathAssets';
import { relDragActive, spinChannelActive, targetSpeedActive } from './gpgpuSpeedDragSpin';
import { orientChannelActive } from './gpgpuOrient';
import { ageFreeCurvesActive } from './gpgpuAgeFreeCurves';
import { distributionActive } from './gpgpuDistribution';
import { predationActive } from './gpgpuPredation';
import { meanderStandaloneActive } from './gpgpuMeander';
import { shaderSeedActive } from './gpgpuRandom';

export const WEBGPU_COMPUTE_SUPPORTED_FEATURES = [
  'particles',
  'metaball',
  'volumetric',
  'smooth-tube',
  'ribbon',
  'tube',
  'trail',
  // Morph attraction joined the WGSL velocity pass in Phase R
  // (baked target cloud as a storage buffer, same force law as
  // WebGL). Before Phase R morph was not even listed as a requested
  // feature, so morph configs silently lost the force on this path.
  'morph',
  // Phase X3: the WGSL passes now carry the full WebGL force set
  // (verbatim force laws in lib/webgpuCompute.ts), including the
  // OBJ normal kick inside the morph block, so every feature below
  // is genuinely implemented on this path. Still unsupported —
  // and therefore still routing to WebGL — are 'flip' (Phase AT:
  // the P2G / pressure-projection passes are WebGL FBO passes
  // with no WGSL counterpart) and 'custom-force' (user GLSL
  // cannot be compiled to WGSL).
  // Phase 25: 'fluid-field' joined — FLUID_WGSL advects the
  // resident 64x64 grid on a third compute pipeline ahead of the
  // velocity pass, which samples it through the legacy coupling
  // formula. Only the field itself moved: a config combining it
  // with 'flip' (or any other unsupported feature) still routes
  // to WebGL, where the FLIP layer lives on the same field.
  'fluid-field',
  // Phase 26: 'flip-3d' joined — the atlas FLIP solver stepped
  // by FLIP3D_*_WGSL inside stepWebGPUCompute, with the G2P
  // coupling in the WGSL velocity pass. The requirement split
  // (the Phase 24 reconciliation memo's section 3.6 option):
  // 'flip' now names only the 2D layer (still WebGL-only), and
  // a 3D-mode config requests 'flip-3d' instead. In 3D mode the
  // 2D layer never runs (the passes disable it), so the split
  // changes no behaviour — it only stops the 2D layer's
  // requirement from holding 3D configs on the WebGL path.
  'flip-3d',
  // Phase 15 (UE5 #18): 'age' joined — the WGSL position pass now
  // runs the age advance + wrap respawn with the WebGL placement
  // law, and the velocity pass gained the kick's respawn-frame
  // trigger. The lifecycle's OTHER entries (spawn gate, kill
  // conditions, emission curve, group kill, collision life) stay
  // WebGL-only under their own declarations below, so combining
  // them with age still routes to WebGL.
  'audio-reactive',
  'age',
  'verlet',
  'nbody',
  'curl',
  'boids',
  'attractor',
  'vortex',
  'wind',
  'well',
  'elastic',
  'magnetic',
  'sph',
  'vector-field',
  'spring',
  'sdf-collider',
  'mouse-force',
  'kuramoto',
  'particle-life',
  'levy',
  'floor',
  // Grains DEM engine (solver research stage 2-1): the WGSL DEM
  // path group in lib/webgpuCompute.ts (grid build / force /
  // integrate substeps with per-contact history). Requesting it
  // REPLACES the legacy 'grains' request — see the request logic
  // below. Its precondition is a device whose storage-buffer
  // limit was requested at the adapter maximum (initWebGPUCompute
  // does this); the runtime disables DEM when the granted limit
  // is still too small.
  'grains-dem',
  // Particle rules (G10 stage 3): the WGSL velocity pass now
  // multiplies the five forces by the baked permit mask (slot
  // 3 of the attribute texture, bits 0-4) and the WGSL position
  // pass consumes the kill bit (bit 5) through the age block's
  // placement law — the same consumption the WebGL passes have
  // had since stage 1. One combination stays narrower than
  // WebGL: while the DEM engine replaces the position pass,
  // the rule kill is not consumed (the DEM lifecycle owns
  // respawn there), exactly like the other position-side
  // lifecycle entries under DEM.
  'particle-rules',
  // Live particle rules (Grammar 2.0 stage 1, the WGSL
  // slice): the REP now also exists as a WGSL compute pass
  // (buildRuleEvalWgsl in lib/gpgpuParticleRulesLive.ts) and
  // the WGSL velocity / position passes consume its aggregate
  // with the same composition as WebGL (permits AND, kill OR,
  // the latched true-kill, the extension gates bits 8-11).
  // The coverage is partial by construction: a config whose
  // live rules reach past the WGSL subset — a condition
  // reading den / hit / hits / an ext slot, a baked-fallback
  // rule, a spawn or display action, or a slot-reading
  // condition while an attribute dynamic stage would rewrite
  // the slots the WebGL REP reads — additionally requests
  // 'particle-rules-live-full' below, which stays unsupported
  // and keeps those configs on the WebGL route. While the DEM
  // engine replaces the position pass, the live kill /
  // true-kill are not consumed, exactly like the baked kill.
  'particle-rules-live',
] as const;

export type WebgpuComputeFeature = typeof WEBGPU_COMPUTE_SUPPORTED_FEATURES[number];

const SUPPORTED_SET = new Set<string>(WEBGPU_COMPUTE_SUPPORTED_FEATURES);

function getRequestedGpgpuFeatures(config: ParticleConfig): string[] {
  const features: string[] = ['particles'];
  if (config.gpgpuMetaballEnabled) features.push('metaball');
  if (config.gpgpuVolumetricEnabled) features.push('volumetric');
  if (config.gpgpuSmoothTubeEnabled) features.push('smooth-tube');
  if (config.gpgpuRibbonEnabled) features.push('ribbon');
  if (config.gpgpuTubeEnabled) features.push('tube');
  if (config.gpgpuTrailEnabled) features.push('trail');
  if (config.gpgpuAudioReactive) features.push('audio-reactive');
  if (config.gpgpuAgeEnabled) features.push('age');
  if (config.gpgpuVerletEnabled) features.push('verlet');
  if (config.gpgpuNBodyEnabled) features.push('nbody');
  if (config.gpgpuCurlEnabled) features.push('curl');
  if (config.gpgpuBoidsEnabled) features.push('boids');
  if (config.gpgpuAttractorEnabled) features.push('attractor');
  if (config.gpgpuVortexEnabled) features.push('vortex');
  if (config.gpgpuWindEnabled) features.push('wind');
  if (config.gpgpuWellEnabled) features.push('well');
  if (config.gpgpuElasticEnabled) features.push('elastic');
  if (config.gpgpuMagneticEnabled) features.push('magnetic');
  if (config.gpgpuSphEnabled) features.push('sph');
  if (config.gpgpuVFieldEnabled) features.push('vector-field');
  if (config.gpgpuSpringEnabled) features.push('spring');
  if (config.gpgpuSdfEnabled) features.push('sdf-collider');
  if (config.gpgpuMouseEnabled) features.push('mouse-force');
  // Multi-touch interference (Phase AO): the WGSL passes carry a
  // single mouse position only — declaring it routes to WebGL.
  if (config.gpgpuMouseEnabled && config.gpgpuMouseMultiTouch) features.push('multi-touch');
  if (config.gpgpuFluidEnabled) features.push('fluid-field');
  if (config.gpgpuMorphEnabled) features.push('morph');
  // Phase X3 inventory: the features below exist in the WebGL
  // velocity/position shaders but were never requested here, so
  // configs using them silently lost the effect on the WebGPU
  // path (the Phase R morph bug, in four more places). Kuramoto,
  // Particle Life, Lévy and floor are implemented in WGSL as of
  // Phase X3; custom force (user GLSL) and the Aux event pools
  // (WebGL FBO passes that only run off the WebGPU path) stay
  // unsupported so those configs route to WebGL instead of
  // dropping the effect without a word.
  if (config.gpgpuKuramotoEnabled) features.push('kuramoto');
  if (config.gpgpuParticleLifeEnabled) features.push('particle-life');
  if (config.gpgpuLevyEnabled) features.push('levy');
  if (config.gpgpuFloorEnabled) features.push('floor');
  if (config.gpgpuCustomForceEnabled && (config.gpgpuCustomForceCode || '').trim().length > 0) features.push('custom-force');
  if (config.gpgpuAuxMode !== 'none') features.push('aux');
  // Phase AB lifecycle grammar: the spawn gate, the kill
  // conditions, the global drag / max speed and the two new force
  // terms live in the WebGL passes only. They are requested here
  // (and deliberately NOT added to the supported list) so a
  // WebGPU-preference config using them routes to WebGL instead
  // of silently losing the effect — the Phase R morph lesson.
  // The Aux birthBurst mode needs no entry of its own: 'aux'
  // already routes every aux config to WebGL.
  if ((config.gpgpuSpawnBurst ?? 1) < 1) features.push('spawn-gate');
  // Phase AX spawn grammar: the pulse cycle limit / probability,
  // the distance spawn order and the burst event live in the
  // WebGL passes only — same treatment as the gate above.
  if ((config.gpgpuSpawnPulseCycles ?? 0) > 0 || (config.gpgpuSpawnPulseProbability ?? 1) < 1) features.push('spawn-pulse-cycles');
  if ((config.gpgpuSpawnOrderMode ?? 'hash') !== 'hash') features.push('spawn-distance-order');
  if (config.gpgpuSpawnEventEnabled) features.push('spawn-burst-event');
  if (config.gpgpuKillBoundary || config.gpgpuKillMask) features.push('kill-conditions');
  // Collision life (Phase 15, Unity §1): the contact bookkeeping
  // lives in the WebGL position pass only — same treatment.
  if (config.gpgpuCollisionKill || (config.gpgpuCollisionLifeLoss || 0) > 0) features.push('collision-life');
  if ((config.gpgpuMaxSpeed || 0) > 0 || Math.abs((config.gpgpuDrag ?? 1.1) - 1.1) > 1e-9) features.push('global-velocity-limit');
  if (config.gpgpuParticleLifeEnabled && (config.gpgpuParticleLifeAvoid || 0) > 0) features.push('particle-life-avoid');
  if (config.gpgpuSphEnabled && ((config.gpgpuSphSurfaceTension || 0) > 0 || (config.gpgpuSphSurfaceTensionAkinci || 0) > 0)) features.push('sph-surface-tension');
  // Phase AC signal & time grammar: the sim age curves
  // (velocity / force) and a non-legacy curl evolution speed live
  // in the WebGL passes only — same treatment as Phase AB above.
  // The rotation curve needs no entry: geometry spin is a WebGL
  // draw path that never runs under WebGPU compute. Modulation
  // (internal noise / envelope / lag) is engine-level config
  // modulation and applies on every path already.
  if (config.gpgpuAgeCurveVelocityEnabled || config.gpgpuAgeCurveForceEnabled) features.push('age-curve-sim');
  if (config.gpgpuCurlEnabled && Math.abs((config.gpgpuCurlSpeed ?? 1) - 1) > 1e-9) features.push('curl-speed');
  // Phase AE terrain slope force: the downhill flow samples the
  // derived gradient bake in the WebGL velocity pass only. The
  // derived-map SUPPLY (Layer Maps / mask sources) needs no
  // entry: those are draw-path textures that resolve identically
  // on every path.
  if (config.gpgpuSlopeForceEnabled) features.push('slope-force');
  // Terrain collider (Phase AI): the collider reads the derived
  // collider bake in the sim passes, which the WGSL passes do
  // not implement — declaring it routes the session to WebGL.
  if (config.gpgpuTerrainColliderEnabled) features.push('terrain-collider');
  if (config.gpgpuMeshSdfEnabled || config.gpgpuMeshSdfMultiEnabled) features.push('mesh-sdf-collider');
  // Emission curve (Phase AJ): the respawn gate lives in the
  // WebGL position pass only — declaring it routes to WebGL.
  if (config.gpgpuEmissionCurveEnabled) features.push('emission-curve');
  // Emitter respawn shape / transform (Grammar 2.0 stage 2,
  // E0+E1): the bake side is shared initial data and applies
  // on every route, but the WGSL position pass still places
  // respawns with the legacy law only (its age / rule-kill
  // blocks above), so a config that names a respawn shape or
  // moves the emitter frame would silently diverge at the
  // first respawn. Declaring the gap (deliberately NOT added
  // to the supported list) routes those configs to WebGL.
  if (emitterRespawnShapeActive(config) || emitterTransformActive(config)) features.push('emitter-respawn-shape');
  // Spawn allocator (Grammar 2.0 stage 2, E2): the absolute
  // rate, the envelope clock, the rule spawn gate and the
  // directed initial velocity live in the WebGL sim passes
  // only — the WGSL gate still runs the legacy fraction rate
  // over the plain spawn time and never resets velocity on
  // activation. Declaring each gap (deliberately NOT added
  // to the supported list) routes those configs to WebGL.
  if (spawnRateAbsoluteActive(config)) features.push('spawn-rate-absolute');
  if (config.gpgpuSpawnEnvelopeEnabled) features.push('spawn-envelope');
  if (spawnRuleGateKeyOn(config)) features.push('spawn-rule-gate');
  if (emitterVelocityDirectedActive(config)) features.push('emitter-directed-velocity');
  // Emission sources (Grammar 2.0 stage 2, E3): the cloud /
  // path placements and the emission mask gate live in the
  // WebGL position pass only — the WGSL respawn still places
  // with the legacy law. Declaring the gaps (deliberately NOT
  // added to the supported list) routes those configs to
  // WebGL instead of silently dropping the source at the
  // first respawn. (The bake side is shared initial data and
  // applies on every route, like E0–E2.)
  if (emissionSourceActive(config)) features.push('emission-source');
  if (emissionMaskActive(config) || emissionMaskVariantActive(config)) features.push('emission-mask');
  // Field instances + layers (Grammar 2.0 stage 2, B1): the
  // column-data texture, the instance loop and the attribute-
  // slot layer modulation live in the WebGL velocity pass
  // only — the WGSL velocity implements none of them.
  // Declaring the gap (deliberately NOT added to the
  // supported list) routes those configs to WebGL instead of
  // silently dropping the placed fields.
  if (fieldInstancesActive(config)) features.push('field-instances');
  // Path assets (Grammar 2.0 stage 2, B2): an extended path
  // asset (multiple paths / over 8 points / closed loops /
  // SVG-derived) is followed and emitted from over the
  // column-data texture in the WebGL passes only — the WGSL
  // twins still carry the legacy 8-point uniform path.
  // Declaring the gap (deliberately NOT added to the
  // supported list) routes those configs to WebGL instead of
  // silently truncating the asset to its first 8 points.
  if (steeringPathAssetActive(config) || steeringCrowdPathAssetActive(config) || (emissionPathActive(config) && pathAssetExtended(config))) {
    features.push('path-assets');
  }
  // Speed / drag / spin (Grammar 2.0 stage 2, B3): the target
  // speed is a velocity-tail setting, the relative drag is a
  // new force chunk with a slot-modulated rate, and the spin
  // channel is a dedicated ping-pong state pass feeding the
  // draw side — none of the three has a WebGPU counterpart in
  // this foundation. Declaring the gaps (deliberately NOT
  // added to the supported list) routes those configs to
  // WebGL instead of silently dropping the features. None of
  // the three is ever required at its default.
  if (targetSpeedActive(config)) features.push('target-speed');
  if (relDragActive(config)) features.push('rel-drag');
  if (spinChannelActive(config)) features.push('spin-channel');
  // Orientation channel (Limit plan stage 4, S2): a dedicated
  // quaternion ping-pong pass feeding the geometry vertex —
  // no WebGPU counterpart in this foundation. Declaring the
  // gap (deliberately NOT added to the supported list) routes
  // those configs to WebGL instead of silently dropping the
  // posture. Never requested at the default (channel off).
  if (orientChannelActive(config)) features.push('orient-channel');
  // Age free curves (Grammar 2.0 stage 2, B4): a target's
  // free control-point curve over age is evaluated by the
  // WebGL shader variants only — the WGSL twins carry the
  // fixed 5-point curves. Declaring the gap (deliberately
  // NOT added to the supported list) routes those configs
  // to WebGL instead of silently falling back to the
  // 5-point shape. Requested only while some target's free
  // mode stands with a non-identity curve.
  if (ageFreeCurvesActive(config)) features.push('age-free-curves');
  // Distribution operators + shader seed (Grammar 2.0 stage 2,
  // B5): the operator layer over the shape law and the
  // seed-phase respawn draws live in the WebGL position pass
  // only — the WGSL respawn still places with the unlayered
  // law at the legacy hash phase. (The bake side is shared
  // initial data and applies on every route, like E0–E3.)
  // Declaring the gaps (deliberately NOT added to the
  // supported list) routes those configs to WebGL instead of
  // silently dropping the layer / seed at the first respawn.
  if (distributionActive(config)) features.push('emission-distribution');
  if (shaderSeedActive(config)) features.push('shader-seed');
  // Predator-Prey semantics (Grammar 2.0 stage 2, B6): the
  // generated rules ride on the WebGL REP, whose neighbourhood
  // supply (prey / pred) has no WGSL home — the WGSL REP does
  // no neighbour sampling, and the generated true-kill / spawn
  // consumers are the WebGL position pass and Aux pool.
  // Declaring the gap (deliberately NOT added to the
  // supported list) routes those configs to WebGL instead of
  // silently dropping the predation outcomes. (A user-written
  // live rule reading prey / pred without the predation keys
  // routes the same way through 'particle-rules-live-full':
  // liveConditionWgsl has no form for the variables.)
  if (predationActive(config)) features.push('predation');
  // Meander (Grammar 2.0 stage 2, B7 + WGSL follow-up)
  // deliberately declares NOTHING here: B7 originally routed
  // standalone configs to WebGL ('meander-standalone')
  // because the WGSL velocity pass carried no wander term,
  // but the follow-up implemented the term in WGSL — both
  // homes (inside the Particle Life block and the standalone
  // block after it, exactly once either way) and the REP
  // gate consumption (mask bit 14, livePermitMeander) — so
  // no route can silently lose the wander anymore. The
  // meanderStandaloneActive import stays for the record of
  // that history; it no longer gates routing.
  void meanderStandaloneActive;
  // Light units (Grammar 2.0 stage 2, E4) deliberately declare
  // NOTHING here: the emit-unit selection resolves on the CPU
  // (lib/gpgpuLightUnits.ts resolveEmitLightPos) before supply,
  // so both routes receive the same single position value; the
  // extra units' draw lives in the points draw shader, which
  // is WebGL on every route; and the Phase Z connection is a
  // CPU bake shared by all routes. No route can diverge.
  // Named attributes (Phase AK): the velocity-side consumers
  // (force drive / group gate) read the attribute texture in
  // the WebGL velocity pass only — declaring them routes to
  // WebGL. The draw-side drives (size / brightness) need no
  // entry: they live in the draw shader, which is WebGL on
  // every path already.
  if (config.gpgpuAttrForceSlot >= 0 && config.gpgpuAttrForceAmount !== 0) features.push('attr-force');
  // Phase DF: a named-group reference (Phase CV) activates the
  // group consumer exactly like the legacy toggle — the bake in
  // lib/gpgpuAttributes.ts has counted the ref since CV, so the
  // capability declaration must count it too, otherwise a
  // ref-only config would stay on the WebGPU route and silently
  // lose the gate.
  const groupConsumerActive = !!config.gpgpuGroupEnabled
    || (typeof config.gpgpuGroupRef === 'string' && config.gpgpuGroupRef.length > 0);
  if (groupConsumerActive) features.push('attr-group');
  // Particle rules (G10): requested while effective rules
  // exist. Stage 1 implemented the consumption on the WebGL
  // passes only, so the feature was declared unsupported and
  // rule configs routed to WebGL; stage 3 added the WGSL
  // consumption (velocity permits + position kill) and the
  // feature joined the supported list above.
  if (hasEffectiveParticleRules(config.gpgpuParticleRules ?? '')) features.push('particle-rules');
  // Live particle rules (Grammar 2.0 stage 1, slice 1A;
  // WGSL slice): the feature is requested while effective
  // live rules exist and is supported (the WGSL REP +
  // consumption above). Configs reaching past the WGSL
  // subset additionally request 'particle-rules-live-full',
  // which is deliberately NOT supported, so they keep
  // routing to WebGL — the same declare-the-gap discipline
  // as the attr-* entries below. The dynamic-stage test
  // mirrors those entries: while dyn / feedback / chain
  // would rewrite slot values, the WebGL REP reads the
  // rewritten texture but the WGSL REP reads the mirrored
  // bake, so a slot-reading live condition would diverge.
  if (hasEffectiveLiveRules(config.gpgpuParticleRulesLive ?? '')) {
    features.push('particle-rules-live');
    const attrDynamicActive = (
      (config.gpgpuAttrDynEnabled && normalizeAttrExprs(config.gpgpuAttrExprs).some((expr) => expr.trim().length > 0))
      || (config.gpgpuAttrFeedbackEnabled && normalizeAttrExprs(config.gpgpuAttrExprs).some((expr) => expr.trim().length > 0))
      || (config.gpgpuAttrChainEnabled && normalizeAttrExprs(config.gpgpuAttrChainExprs).some((expr) => expr.trim().length > 0))
    );
    if (!liveRulesWgslCoverable(
      resolveLiveParticleRules(config.gpgpuParticleRulesLive ?? ''),
      {
        names: config.gpgpuAttrNames,
        names2: config.gpgpuAttrNames2,
        groupDefs: parseGpgpuGroups(config.gpgpuGroupsData ?? ''),
        densityAvailable: true,
        attrDynamicActive,
      },
    )) {
      features.push('particle-rules-live-full');
    }
  }
  // Attribute feedback (Phase BV): the feedback pass's output
  // reaches the draw-side drives on every path (the draw shader
  // is WebGL throughout, exactly as with Phase BO's dynamic
  // re-evaluation), but its SIM-side consumption — the force
  // drive / group gate reading the feedback texture — is
  // WebGL-only; on the WebGPU route those consumers keep the
  // bake (the Phase BO gap, inherited). Declared here, under
  // the same conditions as 'attr-force' / 'attr-group' above,
  // so the gap is named in the capability report instead of
  // being dropped silently.
  // Phase 28 (9-5): the steering state mode is a sim-side
  // attribute consumer too — it reads the bake from the
  // mirrored WGSL texture. The STATIC bake is exact on the
  // WebGPU route now, but when a dynamic stage (feedback /
  // chain / sim vars / ext slots) would change the values the
  // WebGL pass reads, the config must route to WebGL like the
  // other sim consumers, so the state mode counts in every
  // declaration below.
  const steerStateConsumerActive = !!config.gpgpuSteerSeekEnabled && config.gpgpuSteerSeekMode === 'state';
  if (config.gpgpuAttrFeedbackEnabled
    && ((config.gpgpuAttrForceSlot >= 0 && config.gpgpuAttrForceAmount !== 0) || groupConsumerActive || steerStateConsumerActive)) {
    features.push('attr-feedback');
  }
  // Phase 18 stage 1 declarations (same discipline: the draw
  // side works on every path, the SIM-side consumption is
  // WebGL-only, so a WebGPU-preference config using them with
  // a sim-side consumer routes to WebGL instead of silently
  // keeping the bake):
  // - 'attr-chain': the chain stage's output reaches the force
  //   drive / group gate on the WebGL route only.
  // - 'attr-sim-vars': the vel / age / rad variables sample the
  //   WebGL sim targets; on the WebGPU route they would keep
  //   reading the initial state.
  // - 'attr-ext-slots': the ext attribute texture (slots 4..7)
  //   is a WebGL-route supply; its pass outputs reach sim-side
  //   consumers on that route only.
  const attrSimConsumerActive = (config.gpgpuAttrForceSlot >= 0 && config.gpgpuAttrForceAmount !== 0)
    || groupConsumerActive
    || steerStateConsumerActive;
  if (config.gpgpuAttrChainEnabled
    && normalizeAttrExprs(config.gpgpuAttrChainExprs).some((expr) => expr.trim().length > 0)
    && attrSimConsumerActive) {
    features.push('attr-chain');
  }
  const attrSimVarUsed = (
    ((config.gpgpuAttrDynEnabled || config.gpgpuAttrFeedbackEnabled)
      && attrExprsReferenceSimVar(config.gpgpuAttrExprs, config.gpgpuAttrNames, config.gpgpuAttrNames2))
    || (config.gpgpuAttrChainEnabled
      && attrExprsReferenceSimVar(config.gpgpuAttrChainExprs, config.gpgpuAttrNames, config.gpgpuAttrNames2))
  );
  if (attrSimVarUsed && attrSimConsumerActive) {
    features.push('attr-sim-vars');
  }
  if (resolveAttrExtConsumers(config) && attrSimConsumerActive) {
    features.push('attr-ext-slots');
  }
  // Attractor space modes (Phase DO): the velocity-matching /
  // rotated sampling lives in the WebGL velocity pass only —
  // declaring it routes to WebGL (the CPU fallback mirrors it in
  // attractor units).
  if (config.gpgpuAttractorEnabled && config.gpgpuAttractorSpaceMode && config.gpgpuAttractorSpaceMode !== 'legacy') features.push('attractor-space-mode');
  // Phase 27: attractor unit 2 — same rule for the second
  // unit's space mode (its legacy mode runs on both routes).
  if (config.gpgpuAttractor2Enabled && config.gpgpuAttractor2SpaceMode && config.gpgpuAttractor2SpaceMode !== 'legacy') features.push('attractor-space-mode');
  // Phase 29: attractor units 3 and 4 — same rule again (their
  // legacy modes run on both routes).
  if (config.gpgpuAttractor3Enabled && config.gpgpuAttractor3SpaceMode && config.gpgpuAttractor3SpaceMode !== 'legacy') features.push('attractor-space-mode');
  if (config.gpgpuAttractor4Enabled && config.gpgpuAttractor4SpaceMode && config.gpgpuAttractor4SpaceMode !== 'legacy') features.push('attractor-space-mode');
  // Wind volume (Phase AL): the placed wind localisation lives in
  // the WebGL velocity pass only — declaring it routes to WebGL.
  if (config.gpgpuWindVolumeEnabled) features.push('wind-volume');
  // Grains (Phase AQ): the DEM-style contact / friction solver
  // lives in the WebGL velocity pass only — declaring it routes
  // to WebGL (the CPU fallback treats it as a no-op, like SPH).
  // Stage 2-1 exception: while the DEM plan resolves active, the
  // config requests the WGSL 'grains-dem' feature INSTEAD, so a
  // DEM config stays on the WebGPU route and the DEM path group
  // owns the solve. When the plan is inactive (DEM off, or an
  // exclusion like rigid / Verlet owns the state) the legacy
  // request stands and behaviour is exactly as before.
  if (config.gpgpuGrainsEnabled) {
    features.push(resolveGrainsDemPlan(config).active ? GRAINS_DEM_FEATURE : 'grains');
  }
  // Vellum (Phase AR): the constraint projection pass, the tear
  // state pass and the structured grid bake live on the WebGL
  // path only — declaring it routes to WebGL (the CPU fallback
  // treats it as a no-op, like SPH / Grains).
  if (config.gpgpuVellumEnabled) features.push('vellum');
  // Pyro (Phase AS): the temperature / buoyancy / disturbance
  // terms live in the WebGL velocity pass only — declaring it
  // routes to WebGL (the CPU fallback treats it as a no-op,
  // like SPH / Grains).
  if (config.gpgpuPyroEnabled) features.push('pyro');
  // FLIP (Phase AT): the 2D layer's P2G splat, pressure
  // projection and G2P transfer live on the WebGL FBO path
  // only — declaring 'flip' routes to WebGL (the CPU fallback
  // treats it as a no-op, like SPH / Grains). Phase 26 split
  // the requirement by mode: a '3d'-mode config requests
  // 'flip-3d' (supported — the WGSL atlas solver) instead,
  // because the 2D layer is disabled in 3D mode.
  if (config.gpgpuFlipEnabled) {
    features.push(flip3dMode(config) === '3d' ? 'flip-3d' : 'flip');
  }
  // Whitewater (Phase BC): the foam pool's spawn / carry passes
  // are WebGL FBO passes over the FLIP field — declaring it
  // routes to WebGL (the CPU fallback treats it as a no-op,
  // like SPH / Grains).
  if (config.gpgpuWhitewaterEnabled) features.push('whitewater');
  // Rigid bodies (Phase AU): the CPU solver + texture supply
  // live on the WebGL path only — declaring it routes to WebGL
  // (the CPU fallback treats it as a no-op, like SPH / Grains).
  if (config.gpgpuRigidEnabled) features.push('rigid-bodies');
  return features;
}

export interface WebgpuComputeCapabilityReport {
  supportedFeatures: string[];
  unsupportedFeatures: string[];
  requestedFeatures: string[];
  canRunRequestedConfig: boolean;
}

export function getWebgpuComputeCapabilityReport(config: ParticleConfig): WebgpuComputeCapabilityReport {
  const requestedFeatures = getRequestedGpgpuFeatures(config);
  const supportedFeatures = requestedFeatures.filter((feature) => SUPPORTED_SET.has(feature));
  const unsupportedFeatures = requestedFeatures.filter((feature) => !SUPPORTED_SET.has(feature));
  return {
    supportedFeatures,
    unsupportedFeatures,
    requestedFeatures,
    canRunRequestedConfig: unsupportedFeatures.length === 0,
  };
}
