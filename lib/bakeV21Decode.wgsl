// Bake v2.1 GPU-side decoder (Phase 2B standalone unit).
//
// Mirrors lib/gpgpuStateCacheV21.ts exactly:
//   position    AABB u16 x3          (frameTable AABB)
//   orientation Smallest-Three u48   (DEFAULT: 2-bit max index
//                                     + 3x15-bit; measured max
//                                     angle error 0.0000825 rad,
//                                     meets the gate 2 line)
//               Smallest-Three u32   (size-priority option only:
//                                     2-bit + 3x10-bit; measured
//                                     max angle error 0.002539
//                                     rad — does NOT meet the
//                                     gate 2 line of 0.001 rad)
//   velocity    f16 x3               (IEEE binary16 bits in u16)
//   scalar      u16-normalized / f16 (2 B each)
//
// Input is ONE frame's compressed payload as a word stream
// (array<u32>, little-endian host upload — the manifest
// declares endian "little"; all WebGPU target platforms in
// scope are little-endian). Channel blocks are laid out in
// the same order as the file: positions, orientations,
// velocities, scalar columns. Byte offsets are computed from
// the layout uniform, so channel-selective decode is a
// matter of choosing which output buffers to bind.
//
// No CPU decode is required on the playback path: the worker
// uploads the raw bytes with queue.writeBuffer and this
// compute pass expands them (design 2.3.4, zero-CPU decode).

struct BakeV21Layout {
  stored : u32,          // stored particles this frame (validCount ?? count)
  hasOrientation : u32,  // 0 / 1
  orientationBytes : u32, // 4 (u32, 10-bit) or 6 (u48, 15-bit)
  hasVelocity : u32,     // 0 / 1
  scalarCount : u32,
  // Per-scalar kind flags packed: bit c set = u16-normalized,
  // clear = f16. Range for u16 channels comes from
  // scalarRanges[c] below.
  scalarU16Mask : u32,
  aabbMin : vec3<f32>,
  aabbMax : vec3<f32>,
}

struct BakeV21ScalarRange {
  min : f32,
  max : f32,
}

@group(0) @binding(0) var<storage, read> frameWords : array<u32>;
@group(0) @binding(1) var<uniform> layout : BakeV21Layout;
@group(0) @binding(2) var<storage, read> scalarRanges : array<BakeV21ScalarRange>;
@group(0) @binding(3) var<storage, read_write> outPositions : array<vec3<f32>>;
@group(0) @binding(4) var<storage, read_write> outOrientations : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> outVelocities : array<vec3<f32>>;
@group(0) @binding(6) var<storage, read_write> outScalars : array<f32>; // stored * scalarCount, column-major blocks

fn loadU16(byteOffset : u32) -> u32 {
  let word = frameWords[byteOffset >> 2u];
  let shift = (byteOffset & 3u) * 8u;
  return (word >> shift) & 0xffffu;
}

fn loadU32(byteOffset : u32) -> u32 {
  // Frame payloads are built so 32-bit fields (orientation)
  // start at a byte offset that is 2 mod 4 in the worst case
  // (position block is 6 B per particle). Orientation words
  // are therefore NOT guaranteed 4-byte aligned in the byte
  // stream; assemble from two u16 loads.
  return loadU16(byteOffset) | (loadU16(byteOffset + 2u) << 16u);
}

fn f16BitsToF32(bits : u32) -> f32 {
  let sign = select(1.0, -1.0, (bits & 0x8000u) != 0u);
  let exp = (bits >> 10u) & 0x1fu;
  let frac = bits & 0x3ffu;
  if (exp == 0u) {
    return sign * f32(frac) * 0.000000059604644775390625; // 2^-24
  }
  if (exp == 31u) {
    if (frac == 0u) { return sign * bitcast<f32>(0x7f800000u); }
    return bitcast<f32>(0x7fc00000u); // quiet NaN
  }
  return sign * (1.0 + f32(frac) / 1024.0) * pow(2.0, f32(exp) - 15.0);
}

fn unpackSmallestThreeComponent(u : u32, levels : f32) -> f32 {
  // [0, levels] -> [-sqrt(1/2), +sqrt(1/2)]
  return (f32(u) / levels) * 1.4142135623730951 - 0.7071067811865476;
}

fn reconstructQuat(maxIndex : u32, others : vec3<f32>) -> vec4<f32> {
  var q = vec4<f32>(0.0);
  var sum = 0.0;
  var k = 0u;
  for (var i = 0u; i < 4u; i++) {
    if (i == maxIndex) { continue; }
    let c = others[k]; k++;
    if (i == 0u) { q.x = c; } else if (i == 1u) { q.y = c; }
    else if (i == 2u) { q.z = c; } else { q.w = c; }
    sum += c * c;
  }
  let m = sqrt(max(0.0, 1.0 - sum));
  if (maxIndex == 0u) { q.x = m; } else if (maxIndex == 1u) { q.y = m; }
  else if (maxIndex == 2u) { q.z = m; } else { q.w = m; }
  return q;
}

// Detail-spec layout (commander ruling 2026-11-29): index
// at the TOP bits, components a, b, c from high to low.
// u32: idx [30..31], a [20..29], b [10..19], c [0..9].
fn unpackQuatSmallestThree(packed : u32) -> vec4<f32> {
  return reconstructQuat((packed >> 30u) & 3u, vec3<f32>(
    unpackSmallestThreeComponent((packed >> 20u) & 1023u, 1023.0),
    unpackSmallestThreeComponent((packed >> 10u) & 1023u, 1023.0),
    unpackSmallestThreeComponent(packed & 1023u, 1023.0),
  ));
}

// 48-bit profile: three u16 words w0,w1,w2 (little-endian)
// forming one 48-bit integer. Same principle at 15 bits:
// spare bit [47] (= w2 bit 15), index [45..46] (= w2 bits
// 13..14), a [30..44], b [15..29], c [0..14].
//   c = w0[0..14]
//   b = w0[15] | w1[0..13] << 1
//   a = w1[14..15] | w2[0..12] << 2
//   idx = w2[13..14]
fn unpackQuatSmallestThree48(w0 : u32, w1 : u32, w2 : u32) -> vec4<f32> {
  let c = w0 & 0x7fffu;
  let b = ((w0 >> 15u) & 1u) | ((w1 & 0x3fffu) << 1u);
  let a = ((w1 >> 14u) & 3u) | ((w2 & 0x1fffu) << 2u);
  let idx = (w2 >> 13u) & 3u;
  return reconstructQuat(idx, vec3<f32>(
    unpackSmallestThreeComponent(a, 32767.0),
    unpackSmallestThreeComponent(b, 32767.0),
    unpackSmallestThreeComponent(c, 32767.0),
  ));
}

@compute @workgroup_size(256)
fn decodeBakeV21Frame(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= layout.stored) { return; }
  let stored = layout.stored;

  // Position block at byte 0, 6 B per particle.
  var posOff = i * 6u;
  let qx = loadU16(posOff); let qy = loadU16(posOff + 2u); let qz = loadU16(posOff + 4u);
  let extent = layout.aabbMax - layout.aabbMin;
  outPositions[i] = layout.aabbMin
    + vec3<f32>(f32(qx), f32(qy), f32(qz)) / 65535.0 * extent;

  var blockOff = stored * 6u;
  if (layout.hasOrientation == 1u) {
    if (layout.orientationBytes == 6u) {
      let base = blockOff + i * 6u;
      outOrientations[i] = unpackQuatSmallestThree48(
        loadU16(base), loadU16(base + 2u), loadU16(base + 4u));
    } else {
      outOrientations[i] = unpackQuatSmallestThree(loadU32(blockOff + i * 4u));
    }
    blockOff += stored * layout.orientationBytes;
  }
  if (layout.hasVelocity == 1u) {
    let base = blockOff + i * 6u;
    outVelocities[i] = vec3<f32>(
      f16BitsToF32(loadU16(base)),
      f16BitsToF32(loadU16(base + 2u)),
      f16BitsToF32(loadU16(base + 4u)),
    );
    blockOff += stored * 6u;
  }
  for (var c = 0u; c < layout.scalarCount; c++) {
    let base = blockOff + c * stored * 2u + i * 2u;
    let raw = loadU16(base);
    var v : f32;
    if ((layout.scalarU16Mask & (1u << c)) != 0u) {
      let r = scalarRanges[c];
      v = r.min + (f32(raw) / 65535.0) * (r.max - r.min);
    } else {
      v = f16BitsToF32(raw);
    }
    outScalars[c * stored + i] = v;
  }
}
