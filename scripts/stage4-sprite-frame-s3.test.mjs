// Limit plan stage 4, slice S3 — Sprite frame channel
// (STAGE4_DESIGN_MATERIALS §2, frame grammar 案A): the frame
// mode gains 'channel'; a per-particle channel value
// (ageRatio / speed / attr / state / rule), normalised by a
// range, sweeps the sheet like 'age' sweeps normAge. The
// GLSL twin decides the frame in the points draw VERTEX
// (where the velocity, attribute and REP textures live) and
// passes it as vSpriteFrame; the fragment only remaps the
// UV, gaining no sampler.
//
// What is pinned here (node side):
//  (a) Monotonicity + endpoints of the CPU twin: for every
//      channel, frames are non-decreasing as the raw input
//      grows; t = 0 → first frame, t = 1 → last frame
//      (non-loop), and loop wraps t = 1 back to frame 0.
//  (b) Per-channel normalisation: raw definitions, the range
//      divisor and its guards, slot and channel resolution.
//  (c) Legacy identity: the three legacy modes return the
//      exact pre-S3 values, the stock draw strings keep
//      their pre-S3 sha256 pins, the defaults keep the
//      variant off, and the new keys sit at their defaults.
//  (d) GLSL twin agreement: the variant strings carry the
//      pinned mapping fragments, the fragment sampler count
//      is unchanged (+0), the vertex gains exactly the REP
//      sampler (and declares it only once when the display
//      variant stands), the merged form scales the REP
//      reads, and an independent transcription of the GLSL
//      formula agrees with the CPU twin over a sweep.
// The gate G4-2 yardstick (fast/slow group separation on a
// real GPU) is NOT judged here — CPU monotonicity only.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(ROOT, 'scripts', `.s4s3-bundle-${process.pid}.mjs`);
let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const samplerCount = (s) => (s.match(/uniform sampler[23]D /g) || []).length;

// Pre-S3 stock string pins (measured on the untouched tree).
const STOCK_VERT_SHA256 = '24ad38d4b2840ab2a41d4b9ee7e40727b6ded006a3cd8ac525ad2367b780b529';
const STOCK_FRAG_SHA256 = 'ca59f9933380321e9a686f7bd664409f96055bdf32f5e88ce1d01b9b606ad56c';

await build({
  stdin: {
    contents: `
      export { SPRITE_FRAME_MODES, SPRITE_FRAME_CHANNELS, spriteFrameIndex, spriteFrameModeIndex, spriteFrameChannelIndex, spriteFrameChannelRaw, spriteFrameChannelT, spriteFrameChannelActive, resolveSpriteFrameDrive, normalizeSpriteFrameChannel, normalizeSpriteFrameSlot, normalizeSpriteFrameRange } from './lib/spriteSheet.ts';
      export { DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag } from './components/gpgpuShaderPoints.ts';
      export { spriteFrameChannelVariantOn } from './components/useGpgpuDrawAssets.ts';
      export { DEFAULT_CONFIG } from './lib/appStateConfigDefaults.ts';
    `,
    resolveDir: ROOT, loader: 'ts',
  },
  bundle: true, platform: 'node', format: 'esm', outfile: BUNDLE, logLevel: 'silent',
});
try {
  const m = await import(pathToFileURL(BUNDLE).href);
  const {
    SPRITE_FRAME_MODES, spriteFrameIndex, spriteFrameModeIndex, spriteFrameChannelIndex,
    spriteFrameChannelRaw, spriteFrameChannelT, spriteFrameChannelActive, resolveSpriteFrameDrive,
    normalizeSpriteFrameChannel, normalizeSpriteFrameSlot, normalizeSpriteFrameRange,
    DRAW_VERT, DRAW_FRAG, buildDrawVert, buildDrawFrag, spriteFrameChannelVariantOn, DEFAULT_CONFIG,
  } = m;
  const cfg = (patch) => ({ ...DEFAULT_CONFIG, ...patch });
  const baseInput = { normAge: 0, speed: 0, attrValue: 0, stateId: 0, ruleBits: 0 };
  const sheet = (loop) => ({ cols: 4, rows: 2, mode: 'channel', fps: 12, loop });
  const frameOf = (channel, input, range, loop) => spriteFrameIndex(
    sheet(loop),
    { normAge: 0, timeSeconds: 0, seed: 0, channelT: spriteFrameChannelT(channel, input, range) },
  );

  // ── (a) monotonicity + endpoints, per channel ──────────
  const sweeps = {
    ageRatio: { key: 'normAge', max: 1, range: 1 },
    speed: { key: 'speed', max: 80, range: 80 },
    attr: { key: 'attrValue', max: 1, range: 1 },
    state: { key: 'stateId', max: 255, range: 255 },
    rule: { key: 'ruleBits', max: 255, range: 255 },
  };
  for (const [channel, sw] of Object.entries(sweeps)) {
    let prev = -1; let monotone = true;
    for (let i = 0; i <= 64; i += 1) {
      const input = { ...baseInput, [sw.key]: (sw.max * i) / 64 };
      const f = frameOf(channel, input, sw.range, false);
      if (f < prev) monotone = false;
      prev = f;
    }
    check(`(a) ${channel}: frames non-decreasing over the raw sweep`, monotone);
    check(`(a) ${channel}: raw 0 -> frame 0`, frameOf(channel, baseInput, sw.range, false) === 0);
    check(`(a) ${channel}: raw max -> last frame (non-loop)`,
      frameOf(channel, { ...baseInput, [sw.key]: sw.max }, sw.range, false) === 7);
    let prevLoop = -1; let monotoneLoop = true;
    for (let i = 0; i <= 63; i += 1) {
      const input = { ...baseInput, [sw.key]: (sw.max * i) / 64 };
      const f = frameOf(channel, input, sw.range, true);
      if (f < prevLoop) monotoneLoop = false;
      prevLoop = f;
    }
    check(`(a) ${channel}: loop sweep non-decreasing below t=1`, monotoneLoop && prevLoop === 7);
    check(`(a) ${channel}: loop wraps t=1 to frame 0`,
      frameOf(channel, { ...baseInput, [sw.key]: sw.max }, sw.range, true) === 0);
  }
  check('(a) 1x1 sheet always frame 0 in channel mode',
    spriteFrameIndex({ cols: 1, rows: 1, mode: 'channel', fps: 12, loop: true },
      { normAge: 0, timeSeconds: 0, seed: 0, channelT: 0.9 }) === 0);
  check('(a) missing / non-finite channelT reads as frame 0',
    spriteFrameIndex(sheet(false), { normAge: 0, timeSeconds: 0, seed: 0 }) === 0
    && spriteFrameIndex(sheet(false), { normAge: 0, timeSeconds: 0, seed: 0, channelT: NaN }) === 0);

  // ── (b) per-channel normalisation ──────────────────────
  check('(b) ageRatio: normAge 0.5 / range 1 -> t 0.5',
    spriteFrameChannelT('ageRatio', { ...baseInput, normAge: 0.5 }, 1) === 0.5);
  check('(b) ageRatio: range 0.5 doubles to t 1',
    spriteFrameChannelT('ageRatio', { ...baseInput, normAge: 0.5 }, 0.5) === 1);
  check('(b) ageRatio: raw clamps above 1',
    spriteFrameChannelRaw('ageRatio', { ...baseInput, normAge: 2 }) === 1);
  check('(b) speed: 40 / range 80 -> t 0.5',
    spriteFrameChannelT('speed', { ...baseInput, speed: 40 }, 80) === 0.5);
  check('(b) speed: negative and NaN read as 0',
    spriteFrameChannelRaw('speed', { ...baseInput, speed: -5 }) === 0
    && spriteFrameChannelRaw('speed', { ...baseInput, speed: NaN }) === 0);
  check('(b) attr: value passes through, t clamps at 1',
    spriteFrameChannelT('attr', { ...baseInput, attrValue: 0.25 }, 1) === 0.25
    && spriteFrameChannelT('attr', { ...baseInput, attrValue: 2 }, 1) === 1);
  check('(b) state: id 128 / range 255 -> t ~0.502',
    Math.abs(spriteFrameChannelT('state', { ...baseInput, stateId: 128 }, 255) - 128 / 255) < 1e-12);
  check('(b) state: id clamps to 255 and rounds',
    spriteFrameChannelRaw('state', { ...baseInput, stateId: 300 }) === 255
    && spriteFrameChannelRaw('state', { ...baseInput, stateId: 3.6 }) === 4);
  check('(b) state: range 1 is a binary split (id>=1 -> t 1)',
    spriteFrameChannelT('state', { ...baseInput, stateId: 1 }, 1) === 1);
  check('(b) rule: bits 255 / range 255 -> t 1; bits 0 -> t 0',
    spriteFrameChannelT('rule', { ...baseInput, ruleBits: 255 }, 255) === 1
    && spriteFrameChannelT('rule', baseInput, 255) === 0);
  check('(b) range guards: 0 / negative / NaN resolve to 1',
    normalizeSpriteFrameRange(0) === 1 && normalizeSpriteFrameRange(-2) === 1
    && normalizeSpriteFrameRange(NaN) === 1 && normalizeSpriteFrameRange(2.5) === 2.5);
  check('(b) slot clamp: -1..3 kept, others -> -1, fractions round',
    normalizeSpriteFrameSlot(-1) === -1 && normalizeSpriteFrameSlot(0) === 0
    && normalizeSpriteFrameSlot(3) === 3 && normalizeSpriteFrameSlot(4) === -1
    && normalizeSpriteFrameSlot(1.6) === 2 && normalizeSpriteFrameSlot(NaN) === -1);
  check('(b) channel resolution: unknown -> ageRatio, indices stable',
    normalizeSpriteFrameChannel('speed') === 'speed'
    && normalizeSpriteFrameChannel('bogus') === 'ageRatio'
    && spriteFrameChannelIndex('ageRatio') === 0 && spriteFrameChannelIndex('speed') === 1
    && spriteFrameChannelIndex('attr') === 2 && spriteFrameChannelIndex('state') === 3
    && spriteFrameChannelIndex('rule') === 4);
  check('(b) mode indices: legacy 0/1/2 unchanged, channel = 3',
    spriteFrameModeIndex('age') === 0 && spriteFrameModeIndex('fps') === 1
    && spriteFrameModeIndex('random') === 2 && spriteFrameModeIndex('channel') === 3
    && SPRITE_FRAME_MODES.length === 4);
  check('(b) resolveSpriteFrameDrive resolves the default config to ageRatio / -1 / 1',
    (() => { const d = resolveSpriteFrameDrive(DEFAULT_CONFIG); return d.channel === 'ageRatio' && d.channelIndex === 0 && d.slot === -1 && d.range === 1; })());

  // ── (c) legacy identity ────────────────────────────────
  const legacySheet = (mode, loop) => ({ cols: 4, rows: 2, mode, fps: 12, loop });
  const ageIn = (t) => ({ normAge: t, timeSeconds: 0, seed: 0 });
  check('(c) age mode values are the pre-S3 ones (loop)',
    [0, 0.124, 0.125, 0.5, 0.999, 1].map((t) => spriteFrameIndex(legacySheet('age', true), ageIn(t)))
      .join(',') === '0,0,1,4,7,0');
  check('(c) age mode values are the pre-S3 ones (non-loop clamps)',
    spriteFrameIndex(legacySheet('age', false), ageIn(1)) === 7
    && spriteFrameIndex(legacySheet('age', false), ageIn(0.5)) === 4);
  check('(c) fps mode values are the pre-S3 ones',
    spriteFrameIndex(legacySheet('fps', true), { normAge: 0, timeSeconds: 0.5, seed: 0 }) === 6
    && spriteFrameIndex(legacySheet('fps', true), { normAge: 0, timeSeconds: 1, seed: 0 }) === 4
    && spriteFrameIndex(legacySheet('fps', false), { normAge: 0, timeSeconds: 10, seed: 0 }) === 7);
  check('(c) random mode values are the pre-S3 ones',
    spriteFrameIndex(legacySheet('random', true), { normAge: 0, timeSeconds: 0, seed: 0 }) === 0
    && spriteFrameIndex(legacySheet('random', true), { normAge: 0, timeSeconds: 0, seed: 0.5 }) === 4
    && spriteFrameIndex(legacySheet('random', true), { normAge: 0, timeSeconds: 0, seed: 0.999 }) === 7);
  check('(c) stock DRAW_VERT keeps its pre-S3 sha256 pin', sha256(DRAW_VERT) === STOCK_VERT_SHA256,
    sha256(DRAW_VERT));
  check('(c) stock DRAW_FRAG keeps its pre-S3 sha256 pin', sha256(DRAW_FRAG) === STOCK_FRAG_SHA256,
    sha256(DRAW_FRAG));
  check('(c) default builders return the stock strings',
    buildDrawVert() === DRAW_VERT && buildDrawFrag() === DRAW_FRAG);
  check('(c) no vSpriteFrame / channel uniforms in the stock strings',
    !DRAW_VERT.includes('vSpriteFrame') && !DRAW_FRAG.includes('vSpriteFrame')
    && !DRAW_VERT.includes('uSpriteFrameChannel'));
  check('(c) defaults: mode age, variant off, new keys at defaults',
    DEFAULT_CONFIG.gpgpuSpriteFrameMode === 'age'
    && DEFAULT_CONFIG.gpgpuSpriteFrameChannel === 'ageRatio'
    && DEFAULT_CONFIG.gpgpuSpriteFrameSlot === -1
    && DEFAULT_CONFIG.gpgpuSpriteFrameRange === 1
    && spriteFrameChannelActive(DEFAULT_CONFIG) === false
    && spriteFrameChannelVariantOn(DEFAULT_CONFIG) === false
    && spriteFrameChannelVariantOn(cfg({ gpgpuSpriteFrameMode: 'channel' })) === true);

  // ── (d) GLSL twin agreement ────────────────────────────
  const vChan = buildDrawVert({ spriteFrameChannel: true });
  const fChan = buildDrawFrag({ spriteFrameChannel: true });
  check('(d) variant vertex declares the varying and drive uniforms',
    vChan.includes('varying float vSpriteFrame;')
    && vChan.includes('uniform float uSpriteFrameChannel;')
    && vChan.includes('uniform int   uSpriteFrameSlot;')
    && vChan.includes('uniform float uSpriteFrameRange;'));
  check('(d) variant vertex carries the pinned channel reads',
    vChan.includes('float sfRaw = vNormAge;')
    && vChan.includes('sfRaw = length(vel);')
    && vChan.includes('kaloAttrChannel(texture2D(uAttrTex, particleUv), uSpriteFrameSlot)')
    && vChan.includes('floor(clamp(texture2D(uRuleLiveTex, particleUv).g, 0.0, 1.0) * 255.0 + 0.5)')
    && vChan.includes('floor(clamp(texture2D(uRuleLiveTex, particleUv).b, 0.0, 255.0) + 0.5)'));
  check('(d) variant vertex carries the pinned frame mapping',
    vChan.includes('float sfFrame = floor(clamp(sfRaw / max(uSpriteFrameRange, 1e-6), 0.0, 1.0) * sfTotal);')
    && vChan.includes('vSpriteFrame = uSpriteSheetLoop ? mod(sfFrame, sfTotal) : min(sfFrame, sfTotal - 1.0);'));
  check('(d) variant fragment uses the varying and drops the stock call',
    fChan.includes('float spriteFrame = vSpriteFrame;')
    && !fChan.includes('float spriteFrame = kaloSpriteFrame(')
    && fChan.includes('varying float vSpriteFrame;'));
  check('(d) fragment sampler count unchanged (+0)',
    samplerCount(fChan) === samplerCount(DRAW_FRAG), `${samplerCount(fChan)} vs ${samplerCount(DRAW_FRAG)}`);
  check('(d) vertex sampler count is stock + 1 (the REP declaration)',
    samplerCount(vChan) === samplerCount(DRAW_VERT) + 1,
    `${samplerCount(vChan)} vs ${samplerCount(DRAW_VERT)}`);
  const vBoth = buildDrawVert({ spriteFrameChannel: true, ruleDisplay: true });
  check('(d) with the display variant, uRuleLiveTex is declared exactly once',
    (vBoth.match(/uniform sampler2D uRuleLiveTex;/g) || []).length === 1);
  const vMerged = buildDrawVert({ spriteFrameChannel: true, ruleDisplay: true, ruleDisplayMerged: true });
  check('(d) merged form scales the sprite REP reads by uLiveTexYScale',
    vMerged.includes('texture2D(uRuleLiveTex, vec2(particleUv.x, particleUv.y * uLiveTexYScale)).g')
    && vMerged.includes('texture2D(uRuleLiveTex, vec2(particleUv.x, particleUv.y * uLiveTexYScale)).b')
    && (vMerged.match(/uniform sampler2D uRuleLiveTex;/g) || []).length === 1);
  // Independent transcription of the GLSL mapping (floor /
  // mod / min over the clamped t) vs the CPU twin.
  const glslFrame = (t, total, loop) => {
    if (total <= 1) return 0;
    const raw = Math.floor(Math.min(1, Math.max(0, t)) * total);
    return loop ? ((raw % total) + total) % total : Math.min(raw, total - 1);
  };
  let agree = true;
  for (let i = 0; i <= 200; i += 1) {
    const t = i / 200;
    for (const loop of [true, false]) {
      const cpu = spriteFrameIndex(sheet(loop), { normAge: 0, timeSeconds: 0, seed: 0, channelT: t });
      if (cpu !== glslFrame(t, 8, loop)) agree = false;
    }
  }
  check('(d) CPU twin agrees with the GLSL mapping transcription over t in [0,1]', agree);

  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  try { unlinkSync(BUNDLE); } catch { /* already gone */ }
}
