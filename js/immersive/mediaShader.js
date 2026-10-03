/**
 * Trattamento foto: piatto/neutro → iper saturo e contrastato.
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
  uniform float uOpacity;

  varying vec2 vUv;

  vec3 applyContrast(vec3 c, float contrast) {
    return (c - 0.5) * contrast + 0.5;
  }

  vec3 applySaturation(vec3 c, float sat) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(l), c, sat);
  }

  // Leggera “vibrance” sulle alte saturazioni (Zone 3–4)
  vec3 applyPunch(vec3 c, float amount) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 d = c - l;
    return c + d * amount * 0.35;
  }

  void main() {
    vec4 tex = texture2D(map, vUv);
    vec3 graded = applyContrast(tex.rgb, uContrast);
    graded = applySaturation(graded, uSaturation);
    float punch = clamp((uSaturation - 1.0) * 0.9, 0.0, 1.2);
    graded = applyPunch(graded, punch);
    graded = clamp(graded, 0.0, 1.0);
    gl_FragColor = vec4(graded, tex.a * uOpacity);
  }
`;

export function createMediaMaterial(texture, { saturation = 0.3, contrast = 0.75 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      uSaturation: { value: saturation },
      uContrast: { value: contrast },
      uOpacity: { value: 1 },
    },
    vertexShader: mediaVertexShader,
    fragmentShader: mediaFragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    toneMapped: false,
  });
}

export function setShaderGrade(material, saturation, contrast) {
  if (!material?.uniforms) return;
  material.uniforms.uSaturation.value = saturation;
  material.uniforms.uContrast.value = contrast;
}

export function setShaderOpacity(material, opacity) {
  if (material?.uniforms?.uOpacity) material.uniforms.uOpacity.value = opacity;
}
