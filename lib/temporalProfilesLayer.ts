import type { ParticleConfig } from '../types';
import { PROCEDURAL_OPACITY_SUFFIXES, addNumber, modulate, getLayerValue, smoothPulse, steppedCrystal, opacityBoostByProfile } from './temporalProfilesShared';
import type { TemporalProfile } from './temporalProfilesShared';

function applyTemporalToLayer(base: ParticleConfig, next: ParticleConfig, prefix: 'layer2' | 'layer3', time: number, isPlaying: boolean) {
  const profile = getLayerValue(base, `${prefix}TemporalProfile`) as TemporalProfile | undefined;
  const strength = Number(getLayerValue(base, `${prefix}TemporalStrength`) ?? 0);
  const speed = Number(getLayerValue(base, `${prefix}TemporalSpeed`) ?? 1);
  const enabled = Boolean(getLayerValue(base, `${prefix}Enabled`));
  if (!enabled || !profile || profile === 'steady' || strength <= 0) return;

  const t = isPlaying ? time : 0;
  const pulse = smoothPulse(t, speed * 1.35);
  const wave = Math.sin(t * speed * 0.9);
  const crystal = steppedCrystal(t, Math.max(0.15, speed));

  if (profile === 'growth') {
    const grow = 0.65 + pulse * 0.75 * strength;
    modulate(next, `${prefix}Count`, 0.8 + grow * 0.32, { min: 64, round: true });
    modulate(next, `${prefix}BaseSize`, 0.92 + grow * 0.2, { min: 0.02 });
    modulate(next, `${prefix}FlowAmplitude`, 0.9 + grow * 0.16, { min: 0 });
    modulate(next, `${prefix}Trail`, 0.9 + grow * 0.2, { min: 0, max: 1.4 });
    addNumber(next, `${prefix}GrowthBranches`, grow * 2.4, { min: 1, max: 16, round: true });
    modulate(next, `${prefix}GrowthLength`, 0.95 + grow * 0.18, { min: 0.1 });
    modulate(next, `${prefix}FiberLength`, 0.95 + grow * 0.16, { min: 0.1 });
    modulate(next, `${prefix}PatchResolution`, 0.92 + grow * 0.15, { min: 8, max: 128, round: true });
  } else if (profile === 'decay') {
    modulate(next, `${prefix}Count`, 0.92 - pulse * 0.22 * strength, { min: 48, round: true });
    modulate(next, `${prefix}BaseSize`, 0.96 - pulse * 0.1 * strength, { min: 0.02 });
    modulate(next, `${prefix}FlowAmplitude`, 0.9 - pulse * 0.12 * strength, { min: 0 });
    modulate(next, `${prefix}Trail`, 0.95 + (1 - pulse) * 0.12 * strength, { min: 0, max: 1.4 });
    addNumber(next, `${prefix}DepositionErosion`, 0.12 * strength, { min: 0, max: 1 });
    addNumber(next, `${prefix}FogDrift`, 0.08 * strength, { min: 0, max: 2 });
    addNumber(next, `${prefix}ErosionTrailDrift`, 0.08 * strength, { min: 0, max: 2 });
  } else if (profile === 'crystallize') {
    modulate(next, `${prefix}FlowAmplitude`, 0.9 - crystal * 0.12 * strength, { min: 0 });
    modulate(next, `${prefix}ConnectionOpacity`, 1 + crystal * 0.35 * strength, { min: 0, max: 1 });
    addNumber(next, `${prefix}CrystalScale`, 0.22 * crystal * strength, { min: 0.1, max: 5 });
    addNumber(next, `${prefix}CrystalDensity`, 0.14 * crystal * strength, { min: 0, max: 1.4 });
    addNumber(next, `${prefix}VoxelSnap`, 0.08 * crystal * strength, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullFresnel`, 0.08 * crystal * strength, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchFresnel`, 0.08 * crystal * strength, { min: 0, max: 2 });
    addNumber(next, `${prefix}ReactionWarp`, 0.06 * crystal * strength, { min: 0, max: 2 });
  } else if (profile === 'melt') {
    const soften = 0.7 + pulse * 0.5 * strength;
    modulate(next, `${prefix}ConnectionOpacity`, 0.92 - pulse * 0.2 * strength, { min: 0, max: 1 });
    addNumber(next, `${prefix}BrushJitter`, 0.08 * soften, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogDrift`, 0.1 * soften, { min: 0, max: 2 });
    addNumber(next, `${prefix}TrailDrift`, 0.08 * soften, { min: 0, max: 2 });
    addNumber(next, `${prefix}ErosionTrailDrift`, 0.1 * soften, { min: 0, max: 2 });
    modulate(next, `${prefix}PatchRelax`, 1 + 0.18 * pulse * strength, { min: 0, max: 2 });
    modulate(next, `${prefix}FogDepth`, 1 + 0.16 * pulse * strength, { min: 0.1, max: 2 });
    modulate(next, `${prefix}FiberCurl`, 1 + 0.12 * pulse * strength, { min: 0, max: 2 });
  } else if (profile === 'rupture') {
    const shock = Math.max(0, wave) * strength;
    modulate(next, `${prefix}FlowAmplitude`, 1 + shock * 0.55, { min: 0 });
    modulate(next, `${prefix}Trail`, 1 + shock * 0.45, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}Burst`, shock * 0.5, { min: 0, max: 2 });
    addNumber(next, `${prefix}FlickerAmount`, shock * 0.35, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullJitter`, shock * 0.08, { min: 0, max: 1 });
    addNumber(next, `${prefix}BrushJitter`, shock * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogGlow`, shock * 0.1, { min: 0, max: 2 });
    modulate(next, `${prefix}Count`, 1 - shock * 0.1, { min: 64, round: true });
  } else if (profile === 'oscillate') {
    const swing = Math.sin(t * speed * 2.2) * strength;
    modulate(next, `${prefix}FlowAmplitude`, 1 + swing * 0.28, { min: 0 });
    modulate(next, `${prefix}Trail`, 1 + Math.abs(swing) * 0.2, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}FiberCurl`, swing * 0.18, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchFresnel`, Math.abs(swing) * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}SheetFresnel`, Math.abs(swing) * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogDrift`, swing * 0.12, { min: 0, max: 2 });
  } else if (profile === 'accrete') {
    const stack = (0.45 + crystal * 0.8) * strength;
    modulate(next, `${prefix}Count`, 0.96 + stack * 0.18, { min: 64, round: true });
    addNumber(next, `${prefix}DepositionRelief`, stack * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionBands`, stack * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}GrowthBranches`, stack * 1.6, { min: 1, max: 16, round: true });
    addNumber(next, `${prefix}CrystalDensity`, stack * 0.12, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}VoxelSnap`, stack * 0.1, { min: 0, max: 1 });
  } else if (profile === 'evaporate') {
    const lift = (0.35 + pulse * 0.85) * strength;
    modulate(next, `${prefix}Count`, 0.96 - lift * 0.16, { min: 40, round: true });
    modulate(next, `${prefix}BaseSize`, 0.98 - lift * 0.08, { min: 0.01 });
    addNumber(next, `${prefix}FogDepth`, lift * 0.16, { min: 0.1, max: 2.4 });
    addNumber(next, `${prefix}FogDrift`, lift * 0.14, { min: 0, max: 2.2 });
    addNumber(next, `${prefix}BrushJitter`, lift * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}ErosionTrailDrift`, lift * 0.12, { min: 0, max: 2 });
  } else if (profile === 'shed') {
    const shedding = Math.max(0, Math.sin(t * speed * 1.4)) * strength;
    modulate(next, `${prefix}Count`, 1 - shedding * 0.18, { min: 36, round: true });
    addNumber(next, `${prefix}Burst`, shedding * 0.4, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionErosion`, shedding * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullJitter`, shedding * 0.09, { min: 0, max: 1 });
    addNumber(next, `${prefix}CrystalScale`, shedding * 0.16, { min: 0.1, max: 5 });
    addNumber(next, `${prefix}TrailDrift`, shedding * 0.1, { min: 0, max: 2 });
  } else if (profile === 'resonate') {
    const resonance = Math.sin(t * speed * 2.8) * strength;
    modulate(next, `${prefix}FlowAmplitude`, 1 + resonance * 0.32, { min: 0 });
    addNumber(next, `${prefix}ConnectionOpacity`, Math.abs(resonance) * 0.16, { min: 0, max: 1 });
    addNumber(next, `${prefix}PatchFresnel`, Math.abs(resonance) * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}SheetFresnel`, Math.abs(resonance) * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogGlow`, Math.abs(resonance) * 0.12, { min: 0, max: 2 });
  } else if (profile === 'condense') {
    const condense = (0.45 + crystal * 0.75) * strength;
    modulate(next, `${prefix}Count`, 0.96 + condense * 0.1, { min: 48, round: true });
    addNumber(next, `${prefix}FogDepth`, condense * 0.18, { min: 0.1, max: 2.5 });
    addNumber(next, `${prefix}HullOpacity`, condense * 0.12, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}PatchRelax`, condense * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}VoxelSnap`, condense * 0.08, { min: 0, max: 1 });
  } else if (profile === 'ignite') {
    const flare = Math.max(0, Math.sin(t * speed * 1.9)) * strength;
    modulate(next, `${prefix}FlowAmplitude`, 1 + flare * 0.45, { min: 0 });
    addNumber(next, `${prefix}Burst`, flare * 0.55, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogGlow`, flare * 0.2, { min: 0, max: 2 });
    addNumber(next, `${prefix}FlickerAmount`, flare * 0.2, { min: 0, max: 1 });
    addNumber(next, `${prefix}BrushJitter`, flare * 0.12, { min: 0, max: 2 });
  } else if (profile === 'unravel') {
    const unravel = (0.4 + pulse * 0.8) * strength;
    modulate(next, `${prefix}Count`, 1 - unravel * 0.14, { min: 32, round: true });
    addNumber(next, `${prefix}TrailDrift`, unravel * 0.14, { min: 0, max: 2 });
    addNumber(next, `${prefix}ErosionTrailDrift`, unravel * 0.14, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionErosion`, unravel * 0.1, { min: 0, max: 1 });
    addNumber(next, `${prefix}FiberCurl`, unravel * 0.1, { min: 0, max: 2 });
  } else if (profile === 'accumulate') {
    const stack = (0.5 + crystal * 0.85) * strength;
    modulate(next, `${prefix}Count`, 0.98 + stack * 0.16, { min: 64, round: true });
    addNumber(next, `${prefix}DepositionRelief`, stack * 0.18, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionBands`, stack * 0.16, { min: 0, max: 12, round: true });
    addNumber(next, `${prefix}CrystalDensity`, stack * 0.14, { min: 0, max: 1.8 });
    addNumber(next, `${prefix}FogDensity`, stack * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}ReactionWarp`, stack * 0.06, { min: 0, max: 2 });
  } else if (profile === 'exfoliate') {
    const flake = Math.max(0, Math.sin(t * speed * 1.6)) * strength;
    modulate(next, `${prefix}Count`, 1 - flake * 0.18, { min: 36, round: true });
    addNumber(next, `${prefix}DepositionErosion`, flake * 0.18, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullJitter`, flake * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}BrushJitter`, flake * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}CrystalSpread`, flake * 0.12, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}ErosionTrailDrift`, flake * 0.16, { min: 0, max: 2 });
  } else if (profile === 'phase_shift') {
    const phase = 0.5 + 0.5 * Math.sin(t * speed * 1.1);
    modulate(next, `${prefix}FlowAmplitude`, 0.86 + phase * 0.36 * strength, { min: 0 });
    modulate(next, `${prefix}PatchRelax`, 0.88 + phase * 0.32 * strength, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogDepth`, (phase - 0.5) * 0.28 * strength, { min: 0.1, max: 2.4 });
    addNumber(next, `${prefix}VoxelSnap`, phase * 0.12 * strength, { min: 0, max: 1 });
    addNumber(next, `${prefix}CrystalDensity`, phase * 0.1 * strength, { min: 0, max: 1.8 });
    addNumber(next, `${prefix}HullFresnel`, Math.abs(phase - 0.5) * 0.22 * strength, { min: 0, max: 2 });
  } else if (profile === 'inhale') {
    const breath = 0.5 + 0.5 * Math.sin(t * speed * 1.4 - 1.2);
    modulate(next, `${prefix}Count`, 0.92 + breath * 0.16 * strength, { min: 48, round: true });
    modulate(next, `${prefix}BaseSize`, 0.9 + breath * 0.18 * strength, { min: 0.02 });
    modulate(next, `${prefix}RadiusScale`, 0.94 + breath * 0.18 * strength, { min: 0.1 });
    addNumber(next, `${prefix}FlowAmplitude`, breath * 0.18 * strength, { min: 0, max: 200 });
    addNumber(next, `${prefix}FogDepth`, breath * 0.14 * strength, { min: 0.1, max: 2.4 });
    addNumber(next, `${prefix}SheetFresnel`, breath * 0.1 * strength, { min: 0, max: 2 });
  } else if (profile === 'rewrite') {
    const rewrite = (0.35 + crystal * 0.7 + pulse * 0.3) * strength;
    addNumber(next, `${prefix}GlyphOutlineOpacity`, rewrite * 0.18, { min: 0, max: 1 });
    addNumber(next, `${prefix}GlyphOutlineWidth`, rewrite * 0.2, { min: 0.2, max: 4 });
    addNumber(next, `${prefix}DepositionBands`, rewrite * 0.18, { min: 0, max: 12, round: true });
    addNumber(next, `${prefix}PatchResolution`, rewrite * 6, { min: 8, max: 144, round: true });
    addNumber(next, `${prefix}FiberDensity`, rewrite * 0.08, { min: 0.05, max: 1 });
    addNumber(next, `${prefix}ReactionWarp`, rewrite * 0.08, { min: 0, max: 2 });
  } else if (profile === 'saturate') {
    const soak = (0.45 + crystal * 0.75) * strength;
    addNumber(next, `${prefix}DepositionRelief`, soak * 0.16, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionBands`, soak * 0.18, { min: 0, max: 12, round: true });
    addNumber(next, `${prefix}FogDensity`, soak * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}BrushOpacity`, soak * 0.08, { min: 0, max: 1.6 });
  } else if (profile === 'delaminate') {
    const peel = Math.max(0, Math.sin(t * speed * 1.5)) * strength;
    addNumber(next, `${prefix}DepositionErosion`, peel * 0.16, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullJitter`, peel * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}CrystalSpread`, peel * 0.12, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}BrushJitter`, peel * 0.1, { min: 0, max: 2 });
  } else if (profile === 'anneal') {
    const anneal = (0.35 + pulse * 0.55) * strength;
    addNumber(next, `${prefix}VoxelSnap`, anneal * 0.14, { min: 0, max: 1 });
    addNumber(next, `${prefix}SheetFresnel`, anneal * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}HullFresnel`, anneal * 0.08, { min: 0, max: 2 });
    modulate(next, `${prefix}FlowAmplitude`, 1 - anneal * 0.08, { min: 0 });
  } else if (profile === 'bifurcate') {
    const fork = (0.35 + pulse * 0.7) * strength;
    addNumber(next, `${prefix}GrowthBranches`, fork * 2.4, { min: 1, max: 16, round: true });
    addNumber(next, `${prefix}GrowthSpread`, fork * 0.12, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}FiberDensity`, fork * 0.1, { min: 0.05, max: 1 });
    addNumber(next, `${prefix}FiberCurl`, fork * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchResolution`, fork * 6, { min: 8, max: 144, round: true });
  } else if (profile === 'recur') {
    const recur = (0.3 + crystal * 0.5 + pulse * 0.4) * strength;
    addNumber(next, `${prefix}GlyphOutlineOpacity`, recur * 0.14, { min: 0, max: 1 });
    addNumber(next, `${prefix}GrowthBranches`, recur * 1.8, { min: 1, max: 16, round: true });
    addNumber(next, `${prefix}FiberDensity`, recur * 0.08, { min: 0.05, max: 1 });
    addNumber(next, `${prefix}ReactionWarp`, recur * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}DepositionBands`, recur * 0.12, { min: 0, max: 12, round: true });
  } else if (profile === 'percolate') {
    const seep = (0.35 + crystal * 0.55 + pulse * 0.25) * strength;
    addNumber(next, `${prefix}DepositionBands`, seep * 0.18, { min: 0, max: 12, round: true });
    addNumber(next, `${prefix}DepositionRelief`, seep * 0.14, { min: 0, max: 2 });
    addNumber(next, `${prefix}ReactionWarp`, seep * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogDensity`, seep * 0.06, { min: 0, max: 2 });
    addNumber(next, `${prefix}BrushJitter`, seep * 0.06, { min: 0, max: 2 });
  } else if (profile === 'slump') {
    const slump = (0.3 + pulse * 0.7) * strength;
    modulate(next, `${prefix}Count`, 1 - slump * 0.08, { min: 48, round: true });
    addNumber(next, `${prefix}CrystalSpread`, slump * 0.16, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}DepositionErosion`, slump * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}FogDrift`, slump * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}BrushJitter`, slump * 0.08, { min: 0, max: 2 });
  } else if (profile === 'rebound') {
    const rebound = (0.4 + pulse * 0.75) * strength;
    modulate(next, `${prefix}RadiusScale`, 0.92 + rebound * 0.2, { min: 0.1 });
    modulate(next, `${prefix}BaseSize`, 0.9 + rebound * 0.16, { min: 0.02 });
    addNumber(next, `${prefix}SheetFresnel`, rebound * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchFresnel`, rebound * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}VoxelSnap`, rebound * 0.12, { min: 0, max: 1 });
  } else if (profile === 'fissure') {
    const fissure = Math.max(0, Math.sin(t * speed * 1.7)) * strength;
    addNumber(next, `${prefix}GrowthBranches`, fissure * 2.2, { min: 1, max: 16, round: true });
    addNumber(next, `${prefix}DepositionErosion`, fissure * 0.16, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullJitter`, fissure * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}TrailDrift`, fissure * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}ErosionTrailDrift`, fissure * 0.14, { min: 0, max: 2 });
  } else if (profile === 'ossify') {
    const ossify = (0.4 + crystal * 0.7) * strength;
    addNumber(next, `${prefix}CrystalDensity`, ossify * 0.16, { min: 0, max: 1.8 });
    addNumber(next, `${prefix}VoxelSnap`, ossify * 0.14, { min: 0, max: 1 });
    addNumber(next, `${prefix}HullFresnel`, ossify * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}SheetFresnel`, ossify * 0.08, { min: 0, max: 2 });
    modulate(next, `${prefix}FlowAmplitude`, 1 - ossify * 0.08, { min: 0 });
  } else if (profile === 'intermittent') {
    const gate = Math.max(0, Math.sin(t * speed * 2.6));
    modulate(next, `${prefix}Count`, 0.9 + gate * 0.2 * strength, { min: 32, round: true });
    modulate(next, `${prefix}FlowAmplitude`, 0.88 + gate * 0.34 * strength, { min: 0 });
    addNumber(next, `${prefix}Burst`, gate * 0.34 * strength, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogGlow`, gate * 0.12 * strength, { min: 0, max: 2 });
  } else if (profile === 'hysteresis') {
    const lag = (0.2 + pulse * 0.55 + crystal * 0.2) * strength;
    modulate(next, `${prefix}RadiusScale`, 0.96 + lag * 0.12, { min: 0.1 });
    addNumber(next, `${prefix}SheetFresnel`, lag * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchRelax`, lag * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogDrift`, lag * 0.08, { min: 0, max: 2 });
  } else if (profile === 'fatigue') {
    const fatigue = (0.25 + pulse * 0.45 + Math.max(0, Math.sin(t * speed * 1.15)) * 0.22) * strength;
    modulate(next, `${prefix}Count`, 1 - fatigue * 0.08, { min: 40, round: true });
    modulate(next, `${prefix}BaseSize`, 0.98 - fatigue * 0.06, { min: 0.01 });
    addNumber(next, `${prefix}DepositionErosion`, fatigue * 0.1, { min: 0, max: 1 });
    addNumber(next, `${prefix}FiberCurl`, fatigue * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}VoxelSnap`, -fatigue * 0.06, { min: 0, max: 1 });
  } else if (profile === 'recover') {
    const recover = (0.25 + pulse * 0.6) * strength;
    modulate(next, `${prefix}RadiusScale`, 0.96 + recover * 0.16, { min: 0.1 });
    modulate(next, `${prefix}BaseSize`, 0.96 + recover * 0.12, { min: 0.02 });
    addNumber(next, `${prefix}SheetFresnel`, recover * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}GrowthLength`, recover * 0.1, { min: 0.1, max: 3 });
    addNumber(next, `${prefix}FogDepth`, recover * 0.1, { min: 0.1, max: 2.5 });
  } else if (profile === 'erupt') {
    const erupt = Math.max(0, Math.sin(t * speed * 1.9)) * strength;
    modulate(next, `${prefix}FlowAmplitude`, 1 + erupt * 0.46, { min: 0 });
    addNumber(next, `${prefix}Burst`, erupt * 0.52, { min: 0, max: 2 });
    addNumber(next, `${prefix}FogGlow`, erupt * 0.18, { min: 0, max: 2 });
    addNumber(next, `${prefix}CrystalSpread`, erupt * 0.14, { min: 0, max: 1.6 });
    addNumber(next, `${prefix}TrailDrift`, erupt * 0.1, { min: 0, max: 2 });
  } else if (profile === 'latency') {
    const latency = (0.22 + (1 - pulse) * 0.52) * strength;
    modulate(next, `${prefix}Count`, 0.9 - latency * 0.06, { min: 40, round: true });
    modulate(next, `${prefix}FlowAmplitude`, 0.88 - latency * 0.08, { min: 0 });
    addNumber(next, `${prefix}FogGlow`, -latency * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchRelax`, latency * 0.04, { min: 0, max: 2 });
  } else if (profile === 'emerge') {
    const emerge = (0.2 + crystal * 0.48 + pulse * 0.42) * strength;
    modulate(next, `${prefix}Count`, 0.94 + emerge * 0.16, { min: 40, round: true });
    addNumber(next, `${prefix}FogDensity`, emerge * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}CrystalDensity`, emerge * 0.12, { min: 0, max: 1.8 });
    addNumber(next, `${prefix}SheetFresnel`, emerge * 0.08, { min: 0, max: 2 });
  } else if (profile === 'collapse') {
    const collapse = Math.max(0, Math.sin(t * speed * 1.35)) * strength;
    modulate(next, `${prefix}RadiusScale`, 1 - collapse * 0.18, { min: 0.08 });
    modulate(next, `${prefix}BaseSize`, 0.98 - collapse * 0.1, { min: 0.01 });
    addNumber(next, `${prefix}DepositionErosion`, collapse * 0.12, { min: 0, max: 1 });
    addNumber(next, `${prefix}TrailDrift`, collapse * 0.12, { min: 0, max: 2 });
    addNumber(next, `${prefix}HullJitter`, collapse * 0.08, { min: 0, max: 1 });
  } else if (profile === 'regrow') {
    const regrow = (0.24 + crystal * 0.56 + pulse * 0.24) * strength;
    addNumber(next, `${prefix}GrowthBranches`, regrow * 2.2, { min: 1, max: 16, round: true });
    addNumber(next, `${prefix}GrowthLength`, regrow * 0.14, { min: 0.1, max: 3 });
    addNumber(next, `${prefix}FiberDensity`, regrow * 0.08, { min: 0.05, max: 1 });
    addNumber(next, `${prefix}ReactionWarp`, regrow * 0.08, { min: 0, max: 2 });
  } else if (profile === 'invert') {
    const invert = Math.sin(t * speed * 1.6) * strength;
    addNumber(next, `${prefix}FogDrift`, Math.abs(invert) * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}SheetFresnel`, Math.abs(invert) * 0.1, { min: 0, max: 2 });
    addNumber(next, `${prefix}PatchFresnel`, Math.abs(invert) * 0.08, { min: 0, max: 2 });
    addNumber(next, `${prefix}VoxelSnap`, invert * 0.08, { min: 0, max: 1 });
  }

  const opacityMultiplier = opacityBoostByProfile(profile, t, speed, strength);
  for (const suffix of PROCEDURAL_OPACITY_SUFFIXES) {
    modulate(next, `${prefix}${suffix}`, opacityMultiplier, { min: 0, max: 1.6 });
  }
}

export function applyTemporalProfiles(config: ParticleConfig, time: number, isPlaying: boolean): ParticleConfig {
  const next = { ...config };
  applyTemporalToLayer(config, next, 'layer2', time, isPlaying);
  applyTemporalToLayer(config, next, 'layer3', time, isPlaying);
  return next;
}
