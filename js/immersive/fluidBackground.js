/**
 * Full-viewport fluid ambient gradient (standalone WebGL canvas).
 */

const VERT = /* glsl */ `
  attribute vec2 a_pos;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec2 u_res;
  uniform float u_time;
  uniform vec3 u_c1;
  uniform vec3 u_c2;
  uniform vec3 u_c3;

  // Soft value noise
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = m * p * 2.02;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_res.xy;
    vec2 p = uv * vec2(u_res.x / u_res.y, 1.0);

    // Drift + vortici (velocità scalata da JS via u_time / fluidSpeed zona)
    float t = u_time * 0.12;
    vec2 q = p;
    q += 0.18 * vec2(
      fbm(p * 0.9 + vec2(t * 0.7, -t * 0.4)),
      fbm(p * 0.9 + vec2(-t * 0.5, t * 0.6))
    );

    float n1 = fbm(q * 0.85 + vec2(t * 1.1, -t * 0.7));
    float n2 = fbm(q * 1.4 + vec2(-t * 0.9, t * 1.0) + n1 * 0.85);
    float n3 = fbm(q * 0.55 + vec2(t * 0.55, -t * 0.5));
    float swirl = fbm(q * 1.6 + vec2(n2 * 1.6, n1 * 1.2) + t * 0.55);
    float pulse = 0.5 + 0.5 * sin(t * 1.4 + n1 * 6.2831);

    float w1 = smoothstep(0.22, 0.78, n1 + swirl * 0.15);
    float w2 = smoothstep(0.25, 0.75, n2 + pulse * 0.12);
    float w3 = smoothstep(0.2, 0.8, n3 * 0.45 + swirl * 0.55);

    vec3 col = mix(u_c1, u_c2, w1);
    col = mix(col, u_c3, w2 * 0.9);
    col = mix(col, mix(u_c2, u_c1, 0.35), w3 * 0.55);
    // accento dinamico sulle macchie più chiare
    col = mix(col, u_c3 * 1.08, (1.0 - w1) * w2 * 0.25);

    float vig = smoothstep(1.25, 0.08, length(uv - 0.5));
    col = mix(col * 0.72, col * 1.22, vig);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

export function createFluidBackground(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL unavailable for fluid background");

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, "u_res");
  const uTime = gl.getUniformLocation(prog, "u_time");
  const uC1 = gl.getUniformLocation(prog, "u_c1");
  const uC2 = gl.getUniformLocation(prog, "u_c2");
  const uC3 = gl.getUniformLocation(prog, "u_c3");

  let c1 = [0.84, 0.91, 0.97];
  let c2 = [0.66, 0.8, 0.94];
  let c3 = [0.93, 0.96, 0.99];
  let from = { c1: c1.slice(), c2: c2.slice(), c3: c3.slice() };
  let to = { c1: c1.slice(), c2: c2.slice(), c3: c3.slice() };
  let blendStart = 0;
  let blendDuration = 0;
  let blending = false;
  let raf = 0;
  let speed = 1;
  let targetSpeed = 1;
  let simTime = 0;
  let lastNow = performance.now();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function mix3(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  function copy3(src, dst) {
    dst[0] = src[0];
    dst[1] = src[1];
    dst[2] = src[2];
  }

  function smootherstep(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * x * (x * (x * 6 - 15) + 10);
  }

  /** Ease molto soft: resta a lungo in fusione, poi cede al colore zona. */
  function blendEase(u) {
    // 0–0.62: da → mix, 0.62–1: mix → target
    if (u <= 0.62) {
      return 0.5 * smootherstep(u / 0.62);
    }
    return 0.5 + 0.5 * smootherstep((u - 0.62) / 0.38);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    resize();

    const now = performance.now();
    if (blending) {
      const u = Math.min(1, (now - blendStart) / Math.max(blendDuration, 1));
      const t = blendEase(u);
      copy3(mix3(from.c1, to.c1, t), c1);
      copy3(mix3(from.c2, to.c2, t), c2);
      copy3(mix3(from.c3, to.c3, t), c3);
      if (u >= 1) {
        blending = false;
        copy3(to.c1, c1);
        copy3(to.c2, c2);
        copy3(to.c3, c3);
      }
    }

    speed += (targetSpeed - speed) * 0.04;
    simTime += (now - lastNow) * 0.001 * speed;
    lastNow = now;

    gl.useProgram(prog);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, simTime);
    gl.uniform3fv(uC1, c1);
    gl.uniform3fv(uC2, c2);
    gl.uniform3fv(uC3, c3);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  resize();
  frame();
  window.addEventListener("resize", resize);

  return {
    setPalette({ a, b, c }, { duration = 1.85 } = {}) {
      const next = {
        c1: hexToRgb(a),
        c2: hexToRgb(b),
        c3: hexToRgb(c),
      };
      if (!duration || duration <= 0) {
        blending = false;
        copy3(next.c1, c1);
        copy3(next.c2, c2);
        copy3(next.c3, c3);
        from = { c1: c1.slice(), c2: c2.slice(), c3: c3.slice() };
        to = { c1: next.c1.slice(), c2: next.c2.slice(), c3: next.c3.slice() };
        return;
      }
      from = { c1: c1.slice(), c2: c2.slice(), c3: c3.slice() };
      to = next;
      blendStart = performance.now();
      blendDuration = duration * 1000;
      blending = true;
    },
    setSpeed(next) {
      targetSpeed = Math.max(0.05, Number(next) || 1);
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    },
  };
}
