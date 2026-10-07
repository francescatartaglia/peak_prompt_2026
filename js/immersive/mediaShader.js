/**
 * Radiography / cardiac CT media treatment:
 * high-contrast diagnostic look, edge boost, film grain, thermal-CT luminance map.
 */

import * as THREE from "three";

export const mediaVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const mediaFragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uSaturation;
  uniform float uContrast;
  uniform float uBrightness;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uGrain;
  uniform float uEdge;
  uniform float uEdgeSoft;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float grain(vec2 uv, float t) {
    float n = hash(uv * vec2(1240.0, 980.0) + t * 37.0);
    float n2 = hash(uv * vec2(890.0, 1410.0) - t * 19.0);
    return (n + n2) * 0.5;
  }

  vec3 thermalCT(float lum) {
    // Cold tissue → bone/hot chambers (DICOM + thermal hybrid)
    vec3 c0 = vec3(0.02, 0.04, 0.08);
    vec3 c1 = vec3(0.12, 0.22, 0.32);
    vec3 c2 = vec3(0.45, 0.55, 0.52);
    vec3 c3 = vec3(0.85, 0.78, 0.42);
    vec3 c4 = vec3(0.98, 0.96, 0.94);
    float x = clamp(lum, 0.0, 1.0);
    vec3 col;
    if (x < 0.28) col = mix(c0, c1, x / 0.28);
    else if (x < 0.55) col = mix(c1, c2, (x - 0.28) / 0.27);
    else if (x < 0.78) col = mix(c2, c3, (x - 0.55) / 0.23);
    else col = mix(c3, c4, (x - 0.78) / 0.22);
    return col;
  }

  void main() {
    vec4 tex = texture2D(map, vUv);
    vec3 rgb = tex.rgb * uBrightness;

    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    // Keep a whisper of chroma then crush toward diagnostic mono
    float chromaLum = mix(lum, dot(rgb, vec3(0.333)), 0.35);
    chromaLum = (chromaLum - 0.5) * uContrast + 0.5;
    chromaLum = clamp(chromaLum, 0.0, 1.0);
    chromaLum = pow(chromaLum, 0.92);

    // Edge definition (radiography sharpness)
    float gx = dFdx(chromaLum);
    float gy = dFdy(chromaLum);
    float edge = clamp(length(vec2(gx, gy)) * uEdge * 14.0, 0.0, 1.0);
    float sharp = clamp(chromaLum + edge * 0.55 - edge * edge * 0.2, 0.0, 1.0);

    vec3 graded = thermalCT(sharp);
    // Slight desat control from zone grade
    graded = mix(vec3(sharp), graded, clamp(0.65 + uSaturation * 0.35, 0.0, 1.0));

    float g = grain(vUv, uTime) * 2.0 - 1.0;
    graded += g * uGrain;
    graded = clamp(graded, 0.0, 1.0);

    // Soft CRT edge: thin undefined band only near the border
    float ax = min(vUv.x, 1.0 - vUv.x);
    float ay = min(vUv.y, 1.0 - vUv.y);
    float edgeDist = min(ax, ay);
    float edgeMask = smoothstep(0.0, max(0.001, uEdgeSoft), edgeDist);

    gl_FragColor = vec4(graded, tex.a * uOpacity * edgeMask);
  }
`;

export function createMediaMaterial(texture, { saturation = 0.35, contrast = 1.55, brightness = 1.05 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uSaturation: { value: saturation },
      uContrast: { value: contrast },
      uBrightness: { value: brightness },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uGrain: { value: 0.14 },
      uEdge: { value: 1.15 },
      // ~1.5% UV ≈ sottile alone come i 7px del menu
      uEdgeSoft: { value: 0.015 },
    },
    vertexShader: mediaVertexShader,
    fragmentShader: mediaFragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    toneMapped: false,
  });
}

export function setShaderGrade(material, saturation, contrast, brightness = 1) {
  if (!material?.uniforms) return;
  material.uniforms.uSaturation.value = saturation;
  material.uniforms.uContrast.value = contrast;
  if (material.uniforms.uBrightness) material.uniforms.uBrightness.value = brightness;
}

export function setShaderOpacity(material, opacity) {
  if (!material?.uniforms?.uOpacity) return;
  const o = Math.min(1, Math.max(0, Number(opacity) ?? 1));
  material.uniforms.uOpacity.value = o;
  const fade = o < 0.999;
  const softEdge = (material.uniforms.uEdgeSoft?.value || 0) > 0.0001;
  // Soft CRT border needs alpha even at full opacity
  material.transparent = fade || softEdge;
  material.depthWrite = (!fade || o > 0.85) && o > 0.05;
}

export function tickMediaShaderTime(material, time) {
  if (material?.uniforms?.uTime) material.uniforms.uTime.value = time;
}

/** Soft CRT border width in UV (thin band near edges). */
export function setShaderEdgeSoft(material, width = 0.015) {
  if (!material?.uniforms?.uEdgeSoft) return;
  material.uniforms.uEdgeSoft.value = Math.max(0, Number(width) || 0);
  material.transparent = true;
}
