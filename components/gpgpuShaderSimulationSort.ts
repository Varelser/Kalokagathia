// ── Sort: depth computation (stores uvX, uvY, viewZ per particle) ──
export const SORT_DEPTH_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uPosTex;
  uniform mat4 uViewMatrix;
  varying vec2 vUv;
  void main() {
    vec3 pos = texture2D(uPosTex, vUv).xyz;
    float viewZ = -(uViewMatrix * vec4(pos, 1.0)).z;
    gl_FragColor = vec4(vUv.x, vUv.y, viewZ, 1.0);
  }
`;

// ── Sort: bitonic sort pass (one compare-swap step) ──
export const SORT_BITONIC_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uSortIn;
  uniform float uTexSizeF;
  uniform float uStep;
  uniform float uStage;
  varying vec2 vUv;
  void main() {
    float fw   = uTexSizeF;
    float ix   = floor(vUv.x * fw);
    float iy   = floor(vUv.y * fw);
    float i    = iy * fw + ix;
    float stepSize   = pow(2.0, uStep);
    float blockSzDir = pow(2.0, uStage + 1.0);
    // Arithmetic XOR: partner index = i XOR stepSize
    float bitInStep = mod(floor(i / stepSize), 2.0);
    float l = i + (bitInStep < 0.5 ? stepSize : -stepSize);
    if (l < 0.0 || l >= fw * fw) { gl_FragColor = texture2D(uSortIn, vUv); return; }
    float lx = mod(l, fw);
    float ly = floor(l / fw);
    vec2 partnerUv = (vec2(lx, ly) + 0.5) / fw;
    vec4 myData      = texture2D(uSortIn, vUv);
    vec4 partnerData = texture2D(uSortIn, partnerUv);
    float myDepth      = myData.z;
    float partnerDepth = partnerData.z;
    // origAsc=true for even blocks. Invert comparison for descending final order (far=0).
    bool origAsc = mod(floor(i / blockSzDir), 2.0) < 0.5;
    bool shouldSwap;
    if (i < l) {
      shouldSwap = origAsc ? (myDepth < partnerDepth) : (myDepth > partnerDepth);
    } else {
      shouldSwap = origAsc ? (myDepth > partnerDepth) : (myDepth < partnerDepth);
    }
    gl_FragColor = shouldSwap ? partnerData : myData;
  }
`;
