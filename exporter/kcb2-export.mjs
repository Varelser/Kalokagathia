#!/usr/bin/env node
/**
 * KCB2 — Kalokagathia standalone-code exporter (Casberry candidate 2).
 *
 * Reads a Kalokagathia preset JSON (site/presets/<id>.json record form
 * {id, name, config} or a bare config object) or a #c= share payload
 * (deflate-raw + base64url, the lib/shareLink.ts format) and writes a
 * single-file, zero-dependency HTML that renders the preset's seeded
 * initial particle cloud with Raw WebGL points, plus a manifest.json
 * that lists exactly what was reproduced, approximated and dropped.
 *
 * REPRODUCED SUBSET (plan KCB2): particle count, seed (the initial
 * positions are generated with the exact mulberry32 draw sequence of
 * lib/seededRng.ts + lib/gpgpuInitialData.ts, so particle i's initial
 * position matches the app's particle i), emit shape, point size,
 * background colour, scene rotation, monochrome-to-gradient colouring.
 * GPGPU physics and the PostFX pipeline are NOT reproduced; every
 * config key that is present in the input but not reproduced is listed
 * in manifest.unsupportedKeys — nothing is dropped silently.
 *
 * Deterministic: the same input produces byte-identical output
 * (no timestamps, no randomness outside the seeded RNG).
 *
 * Usage:
 *   node kcb2-export.mjs --preset <preset.json> --out <dir>
 *   node kcb2-export.mjs --payload '<#c= payload | payload | URL with #c=>' --out <dir>
 *   [--id <slug>] overrides the output file stem.
 */
import { inflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const TOOL = 'kcb2-exporter';
const TOOL_VERSION = '1.0.0';
const MAX_COUNT = 1048576;

/* ------------------------------------------------------------------ */
/* Seeded RNG — verbatim port of lib/seededRng.ts (mulberry32 style).  */
/* ------------------------------------------------------------------ */
function createSeededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Initial data — port of lib/gpgpuInitialData.ts buildGpgpuInitialData
 * with agePhase = null and (for 'light') lightPos = origin. The draw
 * order per particle is identical to the original (theta, shape draws,
 * age draw, 3 velocity draws), so positions match the app's exactly
 * for the first `count` particles regardless of the app's texSize.    */
/* ------------------------------------------------------------------ */
function buildInitialData(count, bounceRadius, emitShape, seed, ageMax) {
  const random = createSeededRng(seed);
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const age = new Float32Array(count);
  const r = bounceRadius;
  const shape = emitShape;
  for (let i = 0; i < count; i++) {
    const theta = random() * Math.PI * 2;
    let px, py, pz;
    if (shape === 'disc') {
      const rad = r * Math.sqrt(random());
      px = rad * Math.cos(theta); py = 0; pz = rad * Math.sin(theta);
    } else if (shape === 'ring') {
      const rad = r * (0.85 + random() * 0.15);
      px = rad * Math.cos(theta); py = (random() - 0.5) * r * 0.08; pz = rad * Math.sin(theta);
    } else if (shape === 'box') {
      px = (random() - 0.5) * 2 * r; py = (random() - 0.5) * 2 * r; pz = (random() - 0.5) * 2 * r;
    } else if (shape === 'shell') {
      const phi = Math.acos(2 * random() - 1);
      px = r * Math.sin(phi) * Math.cos(theta); py = r * Math.sin(phi) * Math.sin(theta); pz = r * Math.cos(phi);
    } else if (shape === 'cone') {
      const h = random() * r;
      const cr = (h / r) * r;
      px = cr * Math.cos(theta); py = h - r * 0.5; pz = cr * Math.sin(theta);
    } else if (shape === 'light') {
      const phi = Math.acos(2 * random() - 1);
      const jr = r * 0.05 * (0.1 + random() * 0.9);
      px = jr * Math.sin(phi) * Math.cos(theta); py = jr * Math.sin(phi) * Math.sin(theta); pz = jr * Math.cos(phi);
    } else {
      const phi = Math.acos(2 * random() - 1);
      const rad = r * (0.1 + random() * 0.9);
      px = rad * Math.sin(phi) * Math.cos(theta); py = rad * Math.sin(phi) * Math.sin(theta); pz = rad * Math.cos(phi);
    }
    pos[i * 3] = px; pos[i * 3 + 1] = py; pos[i * 3 + 2] = pz;
    age[i] = random() * ageMax;
    vel[i * 3] = (random() - 0.5) * 4; vel[i * 3 + 1] = (random() - 0.5) * 4; vel[i * 3 + 2] = (random() - 0.5) * 4;
  }
  return { pos, vel, age };
}

/* ------------------------------ colour ---------------------------- */
const NAMED = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', transparent: '#000000' };
function parseColor(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  let s = v.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function rampAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [p0, c0] = stops[i - 1]; const [p1, c1] = stops[i];
      return lerp3(c0, c1, p1 > p0 ? (t - p0) / (p1 - p0) : 0);
    }
  }
  return stops[stops.length - 1][1];
}

/* --------------------------- input loading ------------------------ */
function decodePayload(arg) {
  let s = String(arg).trim();
  const hashIdx = s.indexOf('#c=');
  if (hashIdx >= 0) s = s.slice(hashIdx + 3);
  else if (s.startsWith('#')) s = s.slice(1);
  if (s.startsWith('c=')) s = s.slice(2);
  if (s.includes('#p=')) throw new Error('#p= payloads reference a preset id; pass the preset JSON file instead.');
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('payload is not base64url');
  const packed = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (packed.length > 200000) throw new Error('payload exceeds the app limit of 200,000 packed bytes');
  const raw = inflateRawSync(packed);
  if (raw.length > 2000000) throw new Error('payload exceeds the app limit of 2,000,000 raw bytes');
  const parsed = JSON.parse(raw.toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || !parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config)) {
    throw new Error('payload JSON has no config object');
  }
  return { name: typeof parsed.name === 'string' ? parsed.name : 'shared-config', config: parsed.config, kind: 'hash-c-payload' };
}

function loadInput(args) {
  if (args.preset) {
    const parsed = JSON.parse(readFileSync(args.preset, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object') {
      return { id: parsed.id || basename(args.preset, '.json'), name: parsed.name || parsed.id || basename(args.preset, '.json'), config: parsed.config, kind: 'preset-json' };
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { id: basename(args.preset, '.json'), name: basename(args.preset, '.json'), config: parsed, kind: 'preset-json (bare config)' };
    }
    throw new Error('preset JSON has no config object');
  }
  if (args.payload) {
    const d = decodePayload(args.payload);
    return { id: 'shared-config', name: d.name, config: d.config, kind: d.kind };
  }
  throw new Error('either --preset <path> or --payload <string> is required');
}

/* ------------------------------ export ---------------------------- */
const SUPPORTED_KEYS = [
  'gpgpuCount', 'gpgpuSeed', 'gpgpuEmitShape', 'gpgpuBounceRadius', 'gpgpuAgeMax',
  'gpgpuSize', 'baseSize', 'gpgpuOpacity', 'backgroundColor', 'backgroundHex',
  'rotationSpeedX', 'rotationSpeedY', 'manualRotationX', 'manualRotationY', 'manualRotationZ',
  'gpgpuColor', 'gpgpuBlendMode',
  'gpgpuGradEnabled', 'gpgpuGradStart', 'gpgpuGradMid', 'gpgpuGradEnd',
  'gpgpuGradQuarter', 'gpgpuGradThreeQuarter', 'gpgpuGradQuarterPos', 'gpgpuGradThreeQuarterPos',
  'gpgpuGradStopPositions', 'gpgpuGradStopColors', 'gpgpuGradDriver',
  'gpgpuAgeColorEnabled', 'gpgpuAgeColorYoung', 'gpgpuAgeColorOld',
];

function slugify(s) {
  const out = String(s || 'export').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'export';
}

function buildExport(input) {
  const cfg = input.config;
  const num = (k, dflt) => (typeof cfg[k] === 'number' && Number.isFinite(cfg[k]) ? cfg[k] : dflt);
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(num('gpgpuCount', 65536))));
  const seed = Math.round(num('gpgpuSeed', 1));
  const shapes = ['sphere', 'disc', 'ring', 'box', 'shell', 'cone', 'light'];
  const emitShape = shapes.includes(cfg.gpgpuEmitShape) ? cfg.gpgpuEmitShape : 'sphere';
  const bounceRadius = num('gpgpuBounceRadius', 150) || 150;
  const ageMax = num('gpgpuAgeMax', 8) || 8;
  const sizeFactor = num('gpgpuSize', 1) * num('baseSize', 1);
  const opacity = Math.min(1, Math.max(0, num('gpgpuOpacity', 0.85)));
  const bg = parseColor(cfg.backgroundHex) || parseColor(cfg.backgroundColor) || [0, 0, 0];
  const rotXPerSec = num('rotationSpeedX', 0.0005) * 60;
  const rotYPerSec = num('rotationSpeedY', 0.001) * 60;
  const manual = [num('manualRotationX', 0), num('manualRotationY', 0), num('manualRotationZ', 0)];
  const blendMode = cfg.gpgpuBlendMode === 'normal' ? 'normal' : 'additive';

  const { pos, vel, age } = buildInitialData(count, bounceRadius, emitShape, seed, ageMax);

  /* colour mode */
  const approximated = [];
  let colorMode = 'flat';
  let stops = null;
  let ageYoung = null; let ageOld = null;
  if (cfg.gpgpuGradEnabled) {
    const sp = Array.isArray(cfg.gpgpuGradStopPositions) ? cfg.gpgpuGradStopPositions : [];
    const sc = Array.isArray(cfg.gpgpuGradStopColors) ? cfg.gpgpuGradStopColors : [];
    const pairs = [];
    for (let i = 0; i < Math.min(sp.length, sc.length); i++) {
      const c = parseColor(sc[i]);
      if (typeof sp[i] === 'number' && c) pairs.push([Math.min(1, Math.max(0, sp[i])), c]);
    }
    if (pairs.length >= 2) { pairs.sort((a, b) => a[0] - b[0]); stops = pairs; }
    else {
      stops = [[0, parseColor(cfg.gpgpuGradStart) || [1, 1, 1]]];
      const q = parseColor(cfg.gpgpuGradQuarter); if (q) stops.push([num('gpgpuGradQuarterPos', 0.25), q]);
      stops.push([0.5, parseColor(cfg.gpgpuGradMid) || [1, 1, 1]]);
      const tq = parseColor(cfg.gpgpuGradThreeQuarter); if (tq) stops.push([num('gpgpuGradThreeQuarterPos', 0.75), tq]);
      stops.push([1, parseColor(cfg.gpgpuGradEnd) || [1, 1, 1]]);
    }
    colorMode = 'gradient (driver: life/age)';
    if (cfg.gpgpuGradDriver && cfg.gpgpuGradDriver !== 'life') {
      approximated.push({ key: 'gpgpuGradDriver', note: "driver '" + cfg.gpgpuGradDriver + "' approximated with the lifecycle (age) driver" });
    }
  } else if (cfg.gpgpuAgeColorEnabled) {
    ageYoung = parseColor(cfg.gpgpuAgeColorYoung) || [1, 1, 1];
    ageOld = parseColor(cfg.gpgpuAgeColorOld) || ageYoung;
    colorMode = 'age (young->old)';
  }
  const flat = parseColor(cfg.gpgpuColor) || [1, 1, 1];
  if (emitShape === 'light') approximated.push({ key: 'gpgpuEmitShape', note: "'light' emitter placed at the origin (the app's light position is not reproduced)" });
  if (typeof cfg.gpgpuPointShape === 'string' && cfg.gpgpuPointShape !== 'soft') {
    approximated.push({ key: 'gpgpuPointShape', note: "point shape '" + cfg.gpgpuPointShape + "' rendered as a soft round sprite" });
  }

  /* interleaved per-particle data: pos(3, /bounceRadius), colour(3), velDir(3), phase(1) */
  const data = new Float32Array(count * 10);
  for (let i = 0; i < count; i++) {
    const t = ageMax > 0 ? age[i] / ageMax : 0;
    let col = flat;
    if (stops) col = rampAt(stops, t);
    else if (ageYoung) col = lerp3(ageYoung, ageOld, t);
    const vx = vel[i * 3], vy = vel[i * 3 + 1], vz = vel[i * 3 + 2];
    const vl = Math.hypot(vx, vy, vz) || 1;
    data[i * 10] = pos[i * 3] / bounceRadius;
    data[i * 10 + 1] = pos[i * 3 + 1] / bounceRadius;
    data[i * 10 + 2] = pos[i * 3 + 2] / bounceRadius;
    data[i * 10 + 3] = col[0]; data[i * 10 + 4] = col[1]; data[i * 10 + 5] = col[2];
    data[i * 10 + 6] = vx / vl; data[i * 10 + 7] = vy / vl; data[i * 10 + 8] = vz / vl;
    data[i * 10 + 9] = t;
  }
  const dataB64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64');

  const presentKeys = Object.keys(cfg);
  const supportedPresent = SUPPORTED_KEYS.filter((k) => presentKeys.includes(k));
  const supportedSet = new Set(SUPPORTED_KEYS);
  const approxKeys = new Set(approximated.map((a) => a.key));
  const unsupportedKeys = presentKeys.filter((k) => !supportedSet.has(k) && !approxKeys.has(k)).sort();

  const stem = slugify(input.idOverride || input.id);
  const htmlName = stem + '.html';
  const manifestName = stem + '.manifest.json';

  const headerLines = [
    'Generated by ' + TOOL + ' ' + TOOL_VERSION + ' (KCB2 standalone exporter).',
    'Source preset: ' + input.name + ' (' + input.kind + ')',
    'Reproduced: particle count, seed-based initial distribution (' + emitShape + '),',
    '  point size, background, rotation, colour (' + colorMode + ').',
    'NOT reproduced: GPGPU physics simulation, PostFX pipeline, morph targets,',
    '  layers, audio, MIDI and every other config key listed in the manifest',
    '  (' + unsupportedKeys.length + ' unsupported keys, none dropped silently).',
    'Animation: scene rotation from rotationSpeedX/Y plus a gentle per-particle',
    '  shimmer along the seeded initial velocity direction (basic form only).',
  ];
  const params = {
    count, bg, sizeFactor, opacity, rotXPerSec, rotYPerSec, manual, blendMode, dataB64,
  };
  const html = renderHtml(input.name, headerLines, params);
  const manifest = {
    tool: TOOL, toolVersion: TOOL_VERSION, plan: 'KCB2',
    input: { kind: input.kind, id: input.id, name: input.name, configKeyCount: presentKeys.length },
    output: { html: htmlName, format: 'single-file HTML, Raw WebGL points, no external libraries or network requests' },
    reproduced: {
      particleCount: count, seed, emitShape, bounceRadius, ageMax,
      initialDistribution: 'first ' + count + ' particles of lib/gpgpuInitialData.ts buildGpgpuInitialData (mulberry32 draw order preserved); positions normalised by bounceRadius',
      pointSizeFactor: sizeFactor, opacity,
      background: '#' + bg.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join(''),
      rotationSpeedRadPerSec: { x: rotXPerSec, y: rotYPerSec },
      manualRotationRad: manual, colorMode, blendMode,
      animation: 'rotation + per-particle shimmer along seeded initial velocity (basic form, not the GPGPU simulation)',
    },
    supportedKeys: supportedPresent,
    approximatedKeys: approximated,
    unsupportedKeys,
    unsupportedFeatures: [
      'GPGPU physics (forces, SPH/FLIP/Pyro, collisions, morph, lifecycle respawn)',
      'PostFX pipeline (all 25 stages incl. Bloom and LightFx)',
      'Layer 1/2/3 particle systems and ambient particles',
      'Audio reactivity, MIDI, camera rigs, deterministic render export',
    ],
  };
  return { html, manifest, htmlName, manifestName };
}

/* --------------------------- HTML template ------------------------ */
function renderHtml(name, headerLines, p) {
  const header = headerLines.map((l) => '  ' + l).join('\n');
  const title = String(name).replace(/[<>&"]/g, '');
  const bgCss = '#' + p.bg.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  const dataJson = JSON.stringify({
    count: p.count, bg: p.bg, size: p.sizeFactor, opacity: p.opacity,
    rotX: p.rotXPerSec, rotY: p.rotYPerSec, manual: p.manual, blend: p.blendMode, data: p.dataB64,
  });
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + title + ' — Kalokagathia standalone export</title>\n' +
    '<style>html,body{margin:0;height:100%;background:' + bgCss + ';overflow:hidden}' +
    'canvas{display:block;width:100%;height:100%}#hud{position:fixed;left:10px;bottom:8px;color:#888;' +
    'font:12px/1.5 monospace;opacity:.85}</style>\n</head>\n<body>\n<!--\n' + header + '\n-->\n' +
    '<canvas id="c"></canvas>\n<div id="hud">' + title + ' · standalone export (KCB2) · physics/PostFX not included</div>\n' +
    '<script>\n"use strict";\nvar P = ' + dataJson + ';\n' +
    'var bin = atob(P.data); var bytes = new Uint8Array(bin.length);\n' +
    'for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);\n' +
    'var verts = new Float32Array(bytes.buffer);\n' +
    'var canvas = document.getElementById("c");\n' +
    'var gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, alpha: false });\n' +
    'if (!gl) { document.getElementById("hud").textContent = "WebGL unavailable"; throw new Error("no webgl"); }\n' +
    'function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }\n' +
    'var vs = "attribute vec3 aPos; attribute vec3 aCol; attribute vec3 aVel; attribute float aPhase;" +\n' +
    '  "uniform float uTime; uniform float uRotX; uniform float uRotY; uniform vec3 uManual; uniform float uSize; uniform float uAspect;" +\n' +
    '  "varying vec3 vCol; varying float vPhase;" +\n' +
    '  "mat3 rotX(float a){ float c=cos(a),s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }" +\n' +
    '  "mat3 rotY(float a){ float c=cos(a),s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }" +\n' +
    '  "mat3 rotZ(float a){ float c=cos(a),s=sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }" +\n' +
    '  "void main(){ vCol = aCol; vPhase = aPhase;" +\n' +
    '  " vec3 pos = aPos + aVel * (sin(uTime * 0.6 + aPhase * 6.28318) * 0.03);" +\n' +
    '  " pos = rotY(uManual.y + uRotY) * rotX(uManual.x + uRotX) * rotZ(uManual.z) * pos;" +\n' +
    '  " vec4 mv = vec4(pos, 1.0); mv.z -= 3.2;" +\n' +
    '  " float f = 1.0 / tan(radians(22.5));" +\n' +
    '  " gl_Position = vec4(mv.x * f / uAspect, mv.y * f, mv.z * (-100.1 / 99.9) - (20.0 / 99.9), -mv.z);" +\n' +
    '  " gl_PointSize = uSize * (120.0 / -mv.z); }";\n' +
    'var fs = "precision mediump float; varying vec3 vCol; varying float vPhase; uniform float uOpacity;" +\n' +
    '  "void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d); if (r2 > 0.25) discard;" +\n' +
    '  " float a = smoothstep(0.25, 0.02, r2) * uOpacity; gl_FragColor = vec4(vCol, a); }";\n' +
    'var prog = gl.createProgram();\n' +
    'gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog); gl.useProgram(prog);\n' +
    'var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);\n' +
    'function attr(name, size, off) { var loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off); }\n' +
    'attr("aPos", 3, 0); attr("aCol", 3, 12); attr("aVel", 3, 24); attr("aPhase", 1, 36);\n' +
    'var uTime = gl.getUniformLocation(prog, "uTime"), uRotX = gl.getUniformLocation(prog, "uRotX"), uRotY = gl.getUniformLocation(prog, "uRotY"), uManual = gl.getUniformLocation(prog, "uManual"), uSize = gl.getUniformLocation(prog, "uSize"), uAspect = gl.getUniformLocation(prog, "uAspect"), uOpacity = gl.getUniformLocation(prog, "uOpacity");\n' +
    'gl.uniform3f(uManual, P.manual[0], P.manual[1], P.manual[2]);\n' +
    'gl.uniform1f(uSize, Math.min(8, Math.max(0.5, 1.2 * P.size)));\n' +
    'gl.uniform1f(uOpacity, P.opacity);\n' +
    'gl.clearColor(P.bg[0], P.bg[1], P.bg[2], 1);\n' +
    'if (P.blend === "additive") { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); } else { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }\n' +
    'gl.disable(gl.DEPTH_TEST);\n' +
    'function resize() { var dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.floor(innerWidth * dpr); canvas.height = Math.floor(innerHeight * dpr); gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform1f(uAspect, canvas.width / canvas.height); }\n' +
    'addEventListener("resize", resize); resize();\n' +
    'var t0 = performance.now();\n' +
    'function frame(now) { var t = (now - t0) / 1000; gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(uTime, t); gl.uniform1f(uRotX, t * P.rotX); gl.uniform1f(uRotY, t * P.rotY); gl.drawArrays(gl.POINTS, 0, P.count); requestAnimationFrame(frame); }\n' +
    'requestAnimationFrame(frame);\n' +
    '</script>\n</body>\n</html>\n';
}

/* -------------------------------- CLI ----------------------------- */
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') out.preset = argv[++i];
    else if (a === '--payload') out.payload = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else throw new Error('unknown argument: ' + a);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.out) throw new Error('--out <dir> is required');
  const input = loadInput(args);
  if (args.id) input.idOverride = args.id;
  const { html, manifest, htmlName, manifestName } = buildExport(input);
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, htmlName), html, 'utf8');
  writeFileSync(join(args.out, manifestName), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('wrote ' + join(args.out, htmlName) + ' (' + html.length + ' bytes)');
  console.log('wrote ' + join(args.out, manifestName) + ' — ' + manifest.supportedKeys.length + ' supported, ' + manifest.approximatedKeys.length + ' approximated, ' + manifest.unsupportedKeys.length + ' unsupported keys listed');
}

try { main(); } catch (e) { console.error('kcb2-export: ' + e.message); process.exit(1); }
