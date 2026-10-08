/**
 * Thermal-camera media treatment in black & white:
 * high-contrast luminance map, edge boost, film grain.
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

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float grain(vec2 uv, float t) {
    float n = hash(uv * vec2(1240.0, 980.0) + t * 37.0);
    float n2 = hash(uv * vec2(890.0, 1410.0) - t * 19.0);
    return (n + n2) * 0.5;
  }

  float thermalCurve(float lum) {
    // Thermal luminance remap: cold dark → hot bright
    float x = clamp(lum, 0.0, 1.0);
    float t;
    if (x < 0.28) t = mix(0.02, 0.16, x / 0.28);
    else if (x < 0.55) t = mix(0.16, 0.46, (x - 0.28) / 0.27);
    else if (x < 0.78) t = mix(0.46, 0.78, (x - 0.55) / 0.23);
    else t = mix(0.78, 0.98, (x - 0.78) / 0.22);
    return t;
  }

  vec3 thermalSoft(float lum) {
    // Soft thermal tint (cool → warm), not full palette
    float x = clamp(lum, 0.0, 1.0);
    vec3 c0 = vec3(0.06, 0.08, 0.12);
    vec3 c1 = vec3(0.22, 0.26, 0.30);
    vec3 c2 = vec3(0.52, 0.50, 0.46);
    vec3 c3 = vec3(0.82, 0.78, 0.70);
    vec3 c4 = vec3(0.96, 0.94, 0.90);
    if (x < 0.28) return mix(c0, c1, x / 0.28);
    if (x < 0.55) return mix(c1, c2, (x - 0.28) / 0.27);
    if (x < 0.78) return mix(c2, c3, (x - 0.55) / 0.23);
    return mix(c3, c4, (x - 0.78) / 0.22);
  }

  void main() {
    vec4 tex = texture2D(map, vUv);
    vec3 rgb = tex.rgb * uBrightness;

    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float chromaLum = mix(lum, dot(rgb, vec3(0.333)), 0.35);
    chromaLum = (chromaLum - 0.5) * uContrast + 0.5;
    chromaLum = clamp(chromaLum, 0.0, 1.0);
    chromaLum = pow(chromaLum, 0.9);

    float gx = dFdx(chromaLum);
    float gy = dFdy(chromaLum);
    float edge = clamp(length(vec2(gx, gy)) * uEdge * 14.0, 0.0, 1.0);
    float sharp = clamp(chromaLum + edge * 0.55 - edge * edge * 0.2, 0.0, 1.0);

    float mono = thermalCurve(sharp);
    vec3 tinted = thermalSoft(sharp);
    // Mostly desaturated thermal, keep a whisper of tint + original chroma
    vec3 graded = mix(vec3(mono), tinted, 0.42);
    graded = mix(graded, rgb * mono / max(lum, 0.08), 0.18 * clamp(uSaturation, 0.0, 1.0));

    float g = grain(vUv, uTime) * 2.0 - 1.0;
    graded += g * uGrain;
    graded = clamp(graded, 0.0, 1.0);

    gl_FragColor = vec4(graded, tex.a * uOpacity);
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
      uGrain: { value: 0.22 },
      uEdge: { value: 1.15 },
    },
    vertexShader: mediaVertexShader,
    fragmentShader: mediaFragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
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
  material.transparent = fade;
  material.depthWrite = (!fade || o > 0.85) && o > 0.05;
}

export function tickMediaShaderTime(material, time) {
  if (material?.uniforms?.uTime) material.uniforms.uTime.value = time;
}

/** No-op: soft edge removed (caused tinted/black rims over fluid bg). */
export function setShaderEdgeSoft() {}
