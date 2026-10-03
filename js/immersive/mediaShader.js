/**
 * Trattamento foto — colori fedeli, bordi netti (niente sfocatura).
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

  varying vec2 vUv;

  vec3 applyContrast(vec3 c, float contrast) {
    return (c - 0.5) * contrast + 0.5;
  }

  vec3 applySaturation(vec3 c, float sat) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, sat);
  }

  void main() {
    vec4 tex = texture2D(map, vUv);
    vec3 graded = tex.rgb * uBrightness;
    graded = applyContrast(graded, uContrast);
    graded = applySaturation(graded, uSaturation);
    graded = clamp(graded, 0.0, 1.0);
    gl_FragColor = vec4(graded, tex.a * uOpacity);
  }
`;

export function createMediaMaterial(texture, { saturation = 1, contrast = 1, brightness = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uSaturation: { value: saturation },
      uContrast: { value: contrast },
      uBrightness: { value: brightness },
      uOpacity: { value: 1 },
    },
    vertexShader: mediaVertexShader,
    fragmentShader: mediaFragmentShader,
    side: THREE.DoubleSide,
    // Opache di default: depth buffer pulito (una foto copre l’altra)
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
  // Solo durante i fade: trasparenza. A opacity≈1 resta opaca per lo stacking.
  const fade = o < 0.999;
  material.transparent = fade;
  material.depthWrite = !fade || o > 0.85;
}

/** Compat: non usiamo più bordi soft. */
export function setShaderEdgeSoft(material) {
  if (material) material.depthWrite = true;
}
