import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ParticleConfig } from "../types";
import { createGradientLutTextureResolved } from "../lib/kinetixGradients";
import { STREAK_FRAG, STREAK_VERT, buildDrawFrag, buildDrawVert } from "./gpgpuShaders";
import { liveRulesHaveAction } from "../lib/gpgpuParticleRulesLive";
import { mergedSupplyActive } from "../lib/gpgpuMergedSupply";
import { extraLightUnitsActive } from "../lib/gpgpuLightUnits";
import { spinChannelActive } from "../lib/gpgpuSpeedDragSpin";
import { orientChannelActive } from "../lib/gpgpuOrient";
import { spriteFrameChannelActive } from "../lib/spriteSheet";
import { ageFreeVariantOn } from "../lib/gpgpuAgeFreeCurves";

// Phase 19 gate fix: the points draw's string variant follows
// the config side of the Vellum crack condition (the same terms
// gpgpuVisualUpdates uses for uVellumCrackEnabled, minus the
// per-frame state texture). Off, the draw strings are
// byte-identical to v2.00.
export function vellumCrackVariantOn(config: ParticleConfig): boolean {
  return !!config.gpgpuVellumEnabled
    && (config.gpgpuVellumTearGap ?? 0) > 0
    && (config.gpgpuVellumTear ?? 0) > 0;
}

// Rigid cluster colouring (Phase 20 stage 1): the points draw's
// string variant follows the config side of the cluster colour
// condition — colour key on AND the rigid solver on. The
// per-frame half (a cell texture and LUT actually exist) is
// resolved in gpgpuVisualUpdates, exactly like the crack
// variant's state texture. Off, the draw strings are
// byte-identical to the Phase 19 strings.
export function rigidClusterColorVariantOn(config: ParticleConfig): boolean {
  return !!config.gpgpuRigidClusterColorEnabled
    && !!config.gpgpuRigidEnabled;
}

// True shadow map (Phase 23, wiring stage 2): the GPGPU points
// become a receiver while the shadow-map strength is positive
// — the same condition that mounts the capture in AppScene.
// The per-frame half (a captured source actually exists) is
// resolved in gpgpuVisualUpdates via uShadowMapReady, exactly
// like the crack variant's state texture. Off, the draw
// strings are byte-identical to the Phase 20 strings.
export function shadowMapVariantOn(config: ParticleConfig): boolean {
  return (config.gpgpuShadowMapStrength ?? 0) > 0;
}

// Tunnel occlusion bake (Round 83/84 gap 7): the points draw
// carries the tunnel-bake sampler only while the terrain mesh
// is a tunnel AND the Phase Z shadow is live — the same
// condition under which gpgpuVisualUpdates produces the tunnel
// bake. Off, the draw strings are the stock ones byte-identically.
export function shadowTunnelVariantOn(config: ParticleConfig): boolean {
  return config.gpgpuTerrainMeshTunnel === true
    && config.gpgpuShadowEnabled === true
    && (config.gpgpuShadowStrength ?? 0) > 0;
}

// Live display action (Grammar 2.0 stage 1, slice 1C): the
// points draw samples the REP output's .a channel while the
// live rule list carries a display action — the config side
// of the condition. The per-frame half (a REP texture
// actually exists and the rule classifies live) is resolved
// in gpgpuVisualUpdates via uRuleLiveDisplayEnabled, exactly
// like the crack variant's state texture. Off, the draw
// strings are the stock ones byte-identically.
export function liveRuleDisplayVariantOn(config: ParticleConfig): boolean {
  return liveRulesHaveAction(config.gpgpuParticleRulesLive ?? '', 'display');
}

// Light units 2-4 (Grammar 2.0 stage 2, E4): the points draw
// carries the extra units' uniform families while any of them
// is enabled — the resolution lives in lib/gpgpuLightUnits.ts.
// Off, the draw strings are the stock ones byte-identically.
export function lightUnitsVariantOn(config: ParticleConfig): boolean {
  return extraLightUnitsActive(config);
}

// Spin channel (Grammar 2.0 stage 2, B3): the points draw
// and the geometry draw carry the spin state texture while
// the channel is enabled — the resolution lives in
// lib/gpgpuSpeedDragSpin.ts. Off, the draw strings are the
// stock ones byte-identically.
export function spinChannelVariantOn(config: ParticleConfig): boolean {
  return spinChannelActive(config);
}

// Orientation channel (Limit plan stage 4, S2): the geometry
// draw carries the posture state texture while the channel
// is enabled — the resolution lives in lib/gpgpuOrient.ts.
// The points draw does NOT consume posture in this slice.
// Off, the geometry string is the stock one byte-identically.
export function orientChannelVariantOn(config: ParticleConfig): boolean {
  return orientChannelActive(config);
}

// Sprite frame channel (Limit plan stage 4, S3): the points
// draw carries the channel-decided sprite frame while the
// frame mode is 'channel' — the resolution lives in
// lib/spriteSheet.ts. Off (every legacy frame mode), the
// draw strings are the stock ones byte-identically.
export function spriteFrameChannelVariantOn(config: ParticleConfig): boolean {
  return spriteFrameChannelActive(config);
}

// Age free curves (Grammar 2.0 stage 2, B4): the points draw
// (size / opacity) and the geometry draw (rotation) carry the
// target's free-curve variant while the target's Enabled and
// FreeEnabled are both on — the resolution lives in
// lib/gpgpuAgeFreeCurves.ts. Off, the draw strings are the
// stock ones byte-identically.
export function ageFreeSizeVariantOn(config: ParticleConfig): boolean {
  return ageFreeVariantOn(config, 'size');
}
export function ageFreeOpacityVariantOn(config: ParticleConfig): boolean {
  return ageFreeVariantOn(config, 'opacity');
}
export function ageFreeRotationVariantOn(config: ParticleConfig): boolean {
  return ageFreeVariantOn(config, 'rotation');
}
import { AUX_TEX_SIZE, buildAuxDrawFrag, buildAuxDrawVert } from "./gpgpuShaderAux";
import { auxInheritColorActive } from "../lib/auxInherit";
import { WW_DRAW_FRAG, WW_DRAW_VERT, WW_TEX_SIZE } from "./gpgpuShaderWhitewater";

export function useGpgpuDrawAssets(config: ParticleConfig, texSize: number) {
  const drawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:            { value: null },
      uVelTex:            { value: null },
      uColor:             { value: new THREE.Color(config.gpgpuColor) },
      uSize:              { value: config.gpgpuSize },
      uRingOffsetZ:       { value: 0 },
      uKuramotoEnabled:   { value: config.gpgpuKuramotoEnabled },
      uKuramotoInfluence: { value: config.gpgpuKuramotoInfluence },
      uParticleLifeEnabled: { value: false },
      uParticleLifeSpecies: { value: 4 },
      uTexSizeF:          { value: texSize },
      uOpacity:           { value: config.gpgpuOpacity },
      uVelColorEnabled:   { value: false },
      uVelColorHueMin:    { value: 200 },
      uVelColorHueMax:    { value: 360 },
      uVelColorSaturation:{ value: 0.9 },
      uAgeEnabled:        { value: false },
      uAgeMax:            { value: 8.0 },
      uAgeFadeIn:         { value: 0.1 },
      uAgeFadeOut:        { value: 0.2 },
      uAgeColorEnabled:   { value: false },
      uAgeColorYoung:     { value: new THREE.Color('#00aaff') },
      uAgeColorOld:       { value: new THREE.Color('#ff4400') },
      uAgeSizeEnabled:    { value: false },
      uAgeSizeStart:      { value: 2.0 },
      uAgeSizeEnd:        { value: 0.2 },
      uAgeSizeCurve:      { value: 0 },
      // Phase U: age curves / Layer Maps / sprite image. Defaults are
      // the identity configuration (curves disabled, flat points,
      // amounts 0, no sprite), so the legacy draw is bit-identical.
      uAgeCurveSizeEnabled:    { value: false },
      uAgeCurveSize:           { value: [1, 1, 1, 1, 1] },
      uAgeCurveOpacityEnabled: { value: false },
      uAgeCurveOpacity:        { value: [1, 1, 1, 1, 1] },
      // Age free curves (Grammar 2.0 stage 2, B4): declared
      // in the shaders only in the age-free variant strings;
      // the entries hold the padded identity asset otherwise.
      uAgeCurveSizeFreeT:      { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveSizeFreeV:      { value: [1, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveOpacityFreeT:   { value: [0, 1, 1, 1, 1, 1, 1, 1] },
      uAgeCurveOpacityFreeV:   { value: [1, 1, 1, 1, 1, 1, 1, 1] },
      uMapSizeAmount:          { value: 0 },
      uMapOpacityAmount:       { value: 0 },
      // Phase X: per-property map textures / displacement / mask.
      // All defaults are the inactive configuration (nothing ready,
      // amount 0, mask off), so the legacy draw is bit-identical.
      uMapSizeTex:             { value: null },
      uMapSizeReady:           { value: false },
      uMapOpacityTex:          { value: null },
      uMapOpacityReady:        { value: false },
      uMapDisplaceTex:         { value: null },
      uMapDisplaceReady:       { value: false },
      uMapDisplaceAmount:      { value: 0 },
      uMapDisplaceRadius:      { value: 1 },
      // Noise field map (Phase AY): amounts 0 — both consumers
      // skip the field evaluation and the legacy draw is
      // bit-identical; scale / evolve are inert while they are 0.
      uNoiseMapScale:          { value: 0.01 },
      uNoiseMapEvolve:         { value: 0 },
      uNoiseMapTime:           { value: 0 },
      uNoiseMapSizeAmount:     { value: 0 },
      uNoiseMapDisplaceAmount: { value: 0 },
      // Phase BJ field grammar: perlin (0) / 1 octave — the
      // Phase AY field exactly while the amounts keep it inert.
      uNoiseMapKind:           { value: 0 },
      uNoiseMapOctaves:        { value: 1 },
      uMaskTex:                { value: null },
      uMaskReady:              { value: false },
      uMaskMode:               { value: 0 },
      uMaskThreshold:          { value: 0.5 },
      uMaskInvert:             { value: false },
      uSpriteImageTex:         { value: null },
      uSpriteImageReady:       { value: false },
      // Sprite sheet (Phase AD): 1x1 / age / 12fps / loop — the
      // frame is always 0 and the UV remap is the exact identity,
      // so single-image sprites stay bit-identical.
      uSpriteSheetCols:        { value: 1 },
      uSpriteSheetRows:        { value: 1 },
      uSpriteSheetMode:        { value: 0 },
      uSpriteSheetFps:         { value: 12 },
      uSpriteSheetLoop:        { value: true },
      // Sprite rotation (Phase AX): 0s — the fragment skips the
      // rotation and samples verbatim.
      uSpriteRotInitial:       { value: 0 },
      uSpriteRotSpeed:         { value: 0 },
      uSpriteRotDamping:       { value: 0 },
      uSpriteRotRandom:        { value: 0 },
      // 3D light (Phase T): disabled by default; the vertex shader
      // then yields exactly 1.0 and the fragment multiply is the
      // identity, so the legacy draw is bit-identical.
      uLightEnabled:      { value: false },
      uLightPos:          { value: new THREE.Vector3(0, 0, 0) },
      uLightIntensity:    { value: 1 },
      uLightRadius:       { value: 3 },
      uLightConeEnabled:  { value: false },
      uLightConeAngleDeg: { value: 30 },
      uLightConeDir:      { value: new THREE.Vector3(0, -1, 0) },
      // Light units 2-4 (stage 2, E4): inert entries mirroring
      // unit 1's defaults; the light-units variant's shader
      // declares them, the stock shader declares none — writes
      // are guarded in gpgpuVisualUpdates like the Phase Z
      // tunnel block.
      uLight2Enabled:   { value: false },
      uLight2Pos:       { value: new THREE.Vector3(0, 0, 0) },
      uLight2Intensity: { value: 1 },
      uLight2Radius:    { value: 3 },
      uLight3Enabled:   { value: false },
      uLight3Pos:       { value: new THREE.Vector3(0, 0, 0) },
      uLight3Intensity: { value: 1 },
      uLight3Radius:    { value: 3 },
      uLight4Enabled:   { value: false },
      uLight4Pos:       { value: new THREE.Vector3(0, 0, 0) },
      uLight4Intensity: { value: 1 },
      uLight4Radius:    { value: 3 },
      // Occlusion-map shadow (Phase Z): no bake, strength 0 — the
      // vertex sample yields exactly 1.0, bit-identical legacy.
      uShadowEnabled:     { value: false },
      uShadowStrength:    { value: 0 },
      uShadowMap:         { value: null },
      uShadowReady:       { value: false },
      uShadowExtent:      { value: 1 },
      uShadowHeightScale: { value: 1 },
      // Tunnel occlusion bake (Round 83/84 gap 7): inert
      // entries; the tunnel variant's shader declares them,
      // the stock shader declares none — writes are guarded
      // in gpgpuVisualUpdates like the Phase Z block.
      uShadowTunnelMap:   { value: null },
      uShadowTunnelReady: { value: false },
      // True shadow map (Phase 23, wiring stage 2): no capture
      // yet — texture null, ready 0, and the defaults mirror
      // lib/appStateDefaultGpgpu.ts (bias 0.001, softness 1).
      // These uniforms exist on the material from creation so
      // the per-frame sync never has to add them; the shader
      // variant that declares them is only assembled while
      // gpgpuShadowMapStrength > 0.
      uShadowMapTex:      { value: null },
      uLightViewProj:     { value: new THREE.Matrix4() },
      uShadowMapBias:     { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady:    { value: 0 },
      uShadowMapStrength: { value: 0 },
      uPointShape:        { value: 0 },
      uGradEnabled:       { value: false },
      uGradDriver:        { value: 0 },
      uGradLut:           { value: createGradientLutTextureResolved(config.gpgpuGradStart, config.gpgpuGradMid, config.gpgpuGradEnd, config.gpgpuGradQuarter, config.gpgpuGradThreeQuarter, config.gpgpuGradQuarterPos, config.gpgpuGradThreeQuarterPos, config.gpgpuGradStopPositions, config.gpgpuGradStopColors) },
      uGradSpatialScale:  { value: config.gpgpuGradSpatialScale },
      uGradTime:          { value: 0 },
      uGradImageTex:      { value: null },
      uGradImageReady:    { value: false },
      uGradImageScale:    { value: 1 / 300 },
      uSortTex:           { value: null },
      uSortEnabled:       { value: false },
      // Named attributes (Phase AK): no texture / drives off is
      // the identity configuration (vAttrBright exactly 1.0), so
      // the legacy draw is bit-identical.
      uAttrTex:           { value: null },
      uAttrEnabled:       { value: false },
      uAttrSizeSlot:      { value: -1 },
      uAttrSizeAmount:    { value: 1 },
      uAttrBrightSlot:    { value: -1 },
      uAttrBrightAmount:  { value: 1 },
      // Colour drive (Phase CL): disabled / slots -1 leaves
      // vAttrColor at exactly vec3(1.0).
      uAttrColorEnabled:  { value: false },
      uAttrColorSlotR:    { value: -1 },
      uAttrColorSlotG:    { value: -1 },
      uAttrColorSlotB:    { value: -1 },
      // Group colour gating (Phase DG): off leaves the colour
      // drive exactly as Phase CL resolved it.
      uGroupColorEnabled: { value: false },
      uGroupSlot:    { value: 0 },
      uGroupMode:    { value: 1 },
      uGroupLow:     { value: 0.25 },
      uGroupHigh:    { value: 0.75 },
      uGroupInvert:  { value: false },
      // Density compensation (Phase DN): off / target 0.5 /
      // count and viewport are inert placeholders until the
      // per-frame sync supplies the real values; off keeps the
      // legacy draw bit-identical.
      uVellumCrackEnabled: { value: false },
      uVellumStateTex:     { value: null },
      uVellumMode:         { value: 0 },
      // Rigid cluster colouring (Phase 20 stage 1): supply off /
      // no textures is the identity configuration — the vertex
      // leaves vClusterOn at 0 and the fragment keeps the
      // legacy base colour.
      uClusterColorEnabled:  { value: false },
      uClusterCellTex:       { value: null },
      uClusterColorLutTex:   { value: null },
      uDensityCompEnabled: { value: false },
      uDensityTarget:      { value: 0.5 },
      uDensityCount:       { value: texSize * texSize },
      uViewportSizePx:     { value: new THREE.Vector2(1, 1) },
      // Live display action (Grammar 2.0 1C): supply off /
      // no texture is the identity configuration — the
      // vertex never applies the REP .a size override.
      uRuleLiveTex:            { value: null },
      uRuleLiveDisplayEnabled: { value: false },
      // Merged supply (stage 2 texture-unit follow-up): the
      // display read's y scale, declared only in the merged
      // display variant; inert otherwise.
      uLiveTexYScale:          { value: 1 },
      // Spin channel (Grammar 2.0 stage 2, B3): declared in
      // the shader only in the spin variant string; the entry
      // is inert otherwise. syncVisualUniforms binds the spin
      // pass's latest texture per frame.
      uSpinTex:                { value: null },
      // Sprite frame channel (Limit plan stage 4, S3):
      // declared in the shader only in the channel variant
      // string; the entries are inert otherwise (defaults =
      // ageRatio / no slot / range 1).
      uSpriteFrameChannel:     { value: 0 },
      uSpriteFrameSlot:        { value: -1 },
      uSpriteFrameRange:       { value: 1 },
    },
    vertexShader: buildDrawVert({ vellumCrack: vellumCrackVariantOn(config), clusterColor: rigidClusterColorVariantOn(config), shadowMap: shadowMapVariantOn(config), shadowTunnel: shadowTunnelVariantOn(config), ruleDisplay: liveRuleDisplayVariantOn(config), ruleDisplayMerged: mergedSupplyActive(config, texSize), lightUnits: lightUnitsVariantOn(config), spinChannel: spinChannelVariantOn(config), spriteFrameChannel: spriteFrameChannelVariantOn(config), ageFreeSize: ageFreeSizeVariantOn(config) }),
    fragmentShader: buildDrawFrag({ vellumCrack: vellumCrackVariantOn(config), clusterColor: rigidClusterColorVariantOn(config), shadowMap: shadowMapVariantOn(config), spinChannel: spinChannelVariantOn(config), spriteFrameChannel: spriteFrameChannelVariantOn(config), ageFreeOpacity: ageFreeOpacityVariantOn(config) }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Phase 19 gate fix: swap the draw strings when either
  // variant condition flips (creation already used the initial
  // config's variants). Phase 20 stage 1: the cluster colour
  // variant joins the same swap. Phase 23 stage 2: the
  // shadow-map variant joins it too (its predicate is the
  // strength's sign, not its value, so dragging the slider
  // while positive does not recompile).
  const drawVariantRef = useRef({
    crack: vellumCrackVariantOn(config),
    cluster: rigidClusterColorVariantOn(config),
    shadowMap: shadowMapVariantOn(config),
    shadowTunnel: shadowTunnelVariantOn(config),
    ruleDisplay: liveRuleDisplayVariantOn(config),
    ruleDisplayMerged: mergedSupplyActive(config, texSize),
    lightUnits: lightUnitsVariantOn(config),
    spinChannel: spinChannelVariantOn(config),
    spriteFrameChannel: spriteFrameChannelVariantOn(config),
    ageFreeSize: ageFreeSizeVariantOn(config),
    ageFreeOpacity: ageFreeOpacityVariantOn(config),
  });
  useEffect(() => {
    const crack = vellumCrackVariantOn(config);
    const cluster = rigidClusterColorVariantOn(config);
    const shadowMap = shadowMapVariantOn(config);
    const shadowTunnel = shadowTunnelVariantOn(config);
    const ruleDisplay = liveRuleDisplayVariantOn(config);
    const ruleDisplayMerged = mergedSupplyActive(config, texSize);
    const lightUnits = lightUnitsVariantOn(config);
    const spinChannel = spinChannelVariantOn(config);
    const spriteFrameChannel = spriteFrameChannelVariantOn(config);
    const ageFreeSize = ageFreeSizeVariantOn(config);
    const ageFreeOpacity = ageFreeOpacityVariantOn(config);
    if (drawVariantRef.current.crack === crack && drawVariantRef.current.cluster === cluster && drawVariantRef.current.shadowMap === shadowMap && drawVariantRef.current.shadowTunnel === shadowTunnel && drawVariantRef.current.ruleDisplay === ruleDisplay && drawVariantRef.current.ruleDisplayMerged === ruleDisplayMerged && drawVariantRef.current.lightUnits === lightUnits && drawVariantRef.current.spinChannel === spinChannel && drawVariantRef.current.spriteFrameChannel === spriteFrameChannel && drawVariantRef.current.ageFreeSize === ageFreeSize && drawVariantRef.current.ageFreeOpacity === ageFreeOpacity) return;
    drawVariantRef.current = { crack, cluster, shadowMap, shadowTunnel, ruleDisplay, ruleDisplayMerged, lightUnits, spinChannel, spriteFrameChannel, ageFreeSize, ageFreeOpacity };
    drawMat.vertexShader = buildDrawVert({ vellumCrack: crack, clusterColor: cluster, shadowMap, shadowTunnel, ruleDisplay, ruleDisplayMerged, lightUnits, spinChannel, spriteFrameChannel, ageFreeSize });
    drawMat.fragmentShader = buildDrawFrag({ vellumCrack: crack, clusterColor: cluster, shadowMap, spinChannel, spriteFrameChannel, ageFreeOpacity });
    drawMat.needsUpdate = true;
  }, [config.gpgpuVellumEnabled, config.gpgpuVellumTearGap, config.gpgpuVellumTear, config.gpgpuRigidClusterColorEnabled, config.gpgpuRigidEnabled, config.gpgpuShadowMapStrength, config.gpgpuTerrainMeshTunnel, config.gpgpuShadowEnabled, config.gpgpuShadowStrength, config.gpgpuParticleRulesLive, config.gpgpuFieldInstances, config.gpgpuFieldLayers, config.gpgpuSteerSeekPaths, config.gpgpuSteerSeekPathSvg, config.gpgpuPredationEnabled, config.gpgpuPredationOutcome, config.gpgpuPredationStrike, config.gpgpuPredationStrikeFrames, config.gpgpuPredationGraceSeconds, config.gpgpuGroupsData, config.gpgpuLight2Enabled, config.gpgpuLight3Enabled, config.gpgpuLight4Enabled, config.gpgpuSpinEnabled, config.gpgpuSpriteFrameMode, config.gpgpuAgeCurveSizeEnabled, config.gpgpuAgeCurveSizeFreeEnabled, config.gpgpuAgeCurveOpacityEnabled, config.gpgpuAgeCurveOpacityFreeEnabled, drawMat]);

  const drawGeo = useMemo(() => {
    const count = texSize * texSize;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % texSize) + 0.5) / texSize;
      coords[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    return geo;
  }, [texSize]);

  const streakGeo = useMemo(() => {
    const count = texSize * texSize;
    const geo   = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 4);
    const ends   = new Float32Array(count * 2);
    const pos    = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const u = ((i % texSize) + 0.5) / texSize;
      const v = (Math.floor(i / texSize) + 0.5) / texSize;
      coords[i*4+0] = u; coords[i*4+1] = v;
      coords[i*4+2] = u; coords[i*4+3] = v;
      ends[i*2+0] = 0; ends[i*2+1] = 1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    geo.setAttribute('aIsEnd',    new THREE.BufferAttribute(ends, 1));
    return geo;
  }, [texSize]);

  const streakMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uPosTex:       { value: null },
      uVelTex:       { value: null },
      uColor:        { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:      { value: 0.6 },
      uStreakLength: { value: 15.0 },
      uRingOffsetZ:  { value: 0 },
      uAgeEnabled:   { value: false },
      uAgeMax:       { value: 8.0 },
      uAgeFadeIn:    { value: 0.1 },
      uAgeFadeOut:   { value: 0.2 },
    },
    vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Aux event pool draw (B3): fixed 128x128 grid, independent of the
  // main texSize. Uniforms are pointed at the aux ping-pong outputs by
  // the scene loop each frame the aux passes run.
  const auxDrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAuxSize },
      // True shadow map (Phase 30 stage 3): the uniform entries
      // always exist on the aux materials (the stock shaders
      // declare none of them); the scene loop syncs them from
      // the shared store with guarded writes, and the variant
      // strings are swapped when the strength's sign flips —
      // the same contract as the points / geom receivers.
      uShadowMapTex: { value: null },
      uLightViewProj: { value: new THREE.Matrix4() },
      uShadowMapBias: { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady: { value: 0 },
      uShadowMapStrength: { value: 0 },
      // Spawn inheritance (1D-1): declared in the shader
      // only in the inherit variant; the scene loop points
      // uAuxInheritTex at this level's inheritance target
      // and syncs the mix per frame (guarded writes).
      uAuxInheritTex: { value: null },
      uAuxInheritColor: { value: 0 },
    },
    vertexShader: buildAuxDrawVert({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }), fragmentShader: buildAuxDrawFrag({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Aux chain draw (Phase W1): levels 2 and 3 share the level-1
  // draw shaders and geometry; each level gets its own material so
  // its colour / size / textures resolve independently. Uniforms are
  // pointed at the chain ping-pong outputs by the scene loop on the
  // frames the chain passes run.
  const aux2DrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAux2Size },
      // True shadow map (Phase 30 stage 3): the uniform entries
      // always exist on the aux materials (the stock shaders
      // declare none of them); the scene loop syncs them from
      // the shared store with guarded writes, and the variant
      // strings are swapped when the strength's sign flips —
      // the same contract as the points / geom receivers.
      uShadowMapTex: { value: null },
      uLightViewProj: { value: new THREE.Matrix4() },
      uShadowMapBias: { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady: { value: 0 },
      uShadowMapStrength: { value: 0 },
      // Spawn inheritance (1D-1): declared in the shader
      // only in the inherit variant; the scene loop points
      // uAuxInheritTex at this level's inheritance target
      // and syncs the mix per frame (guarded writes).
      uAuxInheritTex: { value: null },
      uAuxInheritColor: { value: 0 },
    },
    vertexShader: buildAuxDrawVert({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }), fragmentShader: buildAuxDrawFrag({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const aux3DrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uAuxPosTex: { value: null },
      uAuxVelTex: { value: null },
      uColor:     { value: new THREE.Color(config.gpgpuColor) },
      uOpacity:   { value: config.gpgpuOpacity },
      uAuxSize:   { value: config.gpgpuAux2Size },
      // True shadow map (Phase 30 stage 3): the uniform entries
      // always exist on the aux materials (the stock shaders
      // declare none of them); the scene loop syncs them from
      // the shared store with guarded writes, and the variant
      // strings are swapped when the strength's sign flips —
      // the same contract as the points / geom receivers.
      uShadowMapTex: { value: null },
      uLightViewProj: { value: new THREE.Matrix4() },
      uShadowMapBias: { value: 0.001 },
      uShadowMapSoftness: { value: 1 },
      uShadowMapReady: { value: 0 },
      uShadowMapStrength: { value: 0 },
      // Spawn inheritance (1D-1): declared in the shader
      // only in the inherit variant; the scene loop points
      // uAuxInheritTex at this level's inheritance target
      // and syncs the mix per frame (guarded writes).
      uAuxInheritTex: { value: null },
      uAuxInheritColor: { value: 0 },
    },
    vertexShader: buildAuxDrawVert({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }), fragmentShader: buildAuxDrawFrag({ shadowMap: shadowMapVariantOn(config), inherit: auxInheritColorActive(config) }),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  // Phase 30 stage 3: swap the aux draw strings when the
  // shadow-map variant condition flips (creation already used
  // the initial config's variant). All three aux levels share
  // the draw shaders, so all three materials swap together.
  // Slice 1D-1: the inheritance variant condition (inheritance
  // on + colour mix above 0) swaps through the same effect.
  const auxVariantRef = useRef({
    shadowMap: shadowMapVariantOn(config),
    inherit: auxInheritColorActive(config),
  });
  useEffect(() => {
    const shadowMap = shadowMapVariantOn(config);
    const inherit = auxInheritColorActive(config);
    if (auxVariantRef.current.shadowMap === shadowMap
      && auxVariantRef.current.inherit === inherit) return;
    auxVariantRef.current = { shadowMap, inherit };
    for (const m of [auxDrawMat, aux2DrawMat, aux3DrawMat]) {
      m.vertexShader = buildAuxDrawVert({ shadowMap, inherit });
      m.fragmentShader = buildAuxDrawFrag({ shadowMap, inherit });
      m.needsUpdate = true;
    }
  }, [config.gpgpuShadowMapStrength, config.gpgpuAuxInheritSlots, config.gpgpuAuxInheritColor, auxDrawMat, aux2DrawMat, aux3DrawMat]);

  const auxDrawGeo = useMemo(() => {
    const count = AUX_TEX_SIZE * AUX_TEX_SIZE;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % AUX_TEX_SIZE) + 0.5) / AUX_TEX_SIZE;
      coords[i * 2 + 1] = (Math.floor(i / AUX_TEX_SIZE) + 0.5) / AUX_TEX_SIZE;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    return geo;
  }, []);

  // Whitewater draw (Phase BC): fixed 64x64 grid, foam white by
  // definition (a near-white with a hint of the water's grey-blue;
  // not a key — whitewater's colour is its identity, its amount /
  // life / size are the keys). Uniforms are pointed at the foam
  // ping-pong outputs by the scene loop each frame the foam
  // passes run.
  const wwDrawMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      uWwPosTex: { value: null },
      uWwVelTex: { value: null },
      uColor:    { value: new THREE.Color('#eef4f5') },
      uOpacity:  { value: config.gpgpuOpacity },
      uWwSize:   { value: config.gpgpuWhitewaterSize },
    },
    vertexShader: WW_DRAW_VERT, fragmentShader: WW_DRAW_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const wwDrawGeo = useMemo(() => {
    const count = WW_TEX_SIZE * WW_TEX_SIZE;
    const geo = new THREE.BufferGeometry();
    const coords = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      coords[i * 2]     = ((i % WW_TEX_SIZE) + 0.5) / WW_TEX_SIZE;
      coords[i * 2 + 1] = (Math.floor(i / WW_TEX_SIZE) + 0.5) / WW_TEX_SIZE;
    }
    geo.setAttribute('position',  new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTexCoord', new THREE.BufferAttribute(coords, 2));
    return geo;
  }, []);

  // Same disposal contract as useGpgpuTrailAssets: texSize-sized
  // geometries must not outlive the generation that created them.
  useEffect(() => () => {
    drawGeo.dispose();
  }, [drawGeo]);
  useEffect(() => () => {
    streakGeo.dispose();
  }, [streakGeo]);
  useEffect(() => () => {
    auxDrawGeo.dispose();
  }, [auxDrawGeo]);
  useEffect(() => () => {
    wwDrawGeo.dispose();
  }, [wwDrawGeo]);

  return {
    drawMat,
    drawGeo,
    streakGeo,
    streakMat,
    auxDrawMat,
    aux2DrawMat,
    aux3DrawMat,
    auxDrawGeo,
    wwDrawMat,
    wwDrawGeo,
  };
}
