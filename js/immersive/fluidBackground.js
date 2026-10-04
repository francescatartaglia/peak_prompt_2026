/**
 * Sfondo liquido dinamico — flussi, vortici e macchie che si fondono,
 * colorati per HR zone.
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

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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
    for (int i = 0; i < 6; i++) {
      v += a * noise(p);
      p = m * p * 2.05;
      a *= 0.5;
    }
    return v;
  }

  // Dominio distorto: sembianza di flusso viscoso
  vec2 flow(vec2 p, float t) {
    vec2 q = vec2(
      fbm(p + vec2(0.0, t * 0.35)),
      fbm(p + vec2(5.2, -t * 0.28))
    );
    vec2 r = vec2(
      fbm(p + 1.7 * q + vec2(1.7 + t * 0.22, 9.2)),
      fbm(p + 1.7 * q + vec2(8.3, 2.8 - t * 0.31))
    );
    return r;
  }

  float blob(vec2 p, vec2 c, float r) {
    float d = length(p - c);
    return (r * r) / (d * d + 0.012);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_res.xy;
    float aspect = u_res.x / max(u_res.y, 1.0);
    vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
    float t = u_time * 0.55;

    // Campo di flusso animato
    vec2 f = flow(p * 1.35, t);
    vec2 q = p + 0.55 * (f - 0.5);

    // Seconda passata di warp (più liquido)
    vec2 f2 = flow(q * 1.1 + vec2(t * 0.18, -t * 0.14), t * 1.15);
    q += 0.35 * (f2 - 0.5);

    // Metaballs che nuotano nel flusso
    vec2 cA = vec2(sin(t * 0.41) * 0.55, cos(t * 0.33) * 0.42);
    vec2 cB = vec2(cos(t * 0.29 + 1.9) * 0.62, sin(t * 0.47 + 0.6) * 0.5);
    vec2 cC = vec2(sin(t * 0.37 - 1.1) * 0.48, cos(t * 0.51 + 2.4) * 0.55);
    vec2 cD = vec2(cos(t * 0.53 + 0.4) * 0.35, sin(t * 0.27 - 1.7) * 0.38);
    cA += 0.22 * (flow(cA + t, t) - 0.5);
    cB += 0.22 * (flow(cB - t, t * 1.1) - 0.5);

    float field = 0.0;
    field += blob(q, cA, 0.38);
    field += blob(q, cB, 0.44);
    field += blob(q, cC, 0.36);
    field += blob(q, cD, 0.30);
    field += blob(q, mix(cA, cC, 0.5 + 0.5 * sin(t * 0.7)), 0.26);
    field += 0.55 * fbm(q * 1.8 + t * 0.4);

    // Swirl cromatico dal flusso
    float n1 = fbm(q * 0.95 + f * 1.4 + t * 0.25);
    float n2 = fbm(q * 1.6 - f * 1.1 - t * 0.2);
    float n3 = fbm(q * 0.55 + vec2(n1, n2) * 1.8);

    float wA = smoothstep(0.35, 0.85, n1 + field * 0.12);
    float wB = smoothstep(0.3, 0.9, n2 + sin(t + n3 * 6.28) * 0.08);
    float wC = smoothstep(0.25, 0.8, field * 0.35 + n3 * 0.65);

    // Base più nera + colori zona attenuati
    vec3 deep = mix(u_c2 * 0.25, vec3(0.0), 0.7);
    vec3 col = deep;
    col = mix(col, u_c1 * 0.9, wA);
    col = mix(col, u_c3 * 0.88, wB * 0.85);
    col = mix(col, mix(u_c2, u_c1, 0.45) * 0.85, wC * 0.7);

    // Highlight liquidi
    float crest = smoothstep(1.15, 1.55, field) * (0.35 + 0.65 * n2);
    col += u_c3 * crest * 0.28;
    col = mix(col, u_c3 * 0.95, crest * 0.18);

    // Contaminazioni di nero che attraversano il flusso
    float ink = smoothstep(0.42, 0.72, fbm(q * 1.25 - t * 0.2 + f * 0.8));
    float ink2 = smoothstep(0.55, 0.8, n3 + (1.0 - field * 0.2));
    col = mix(col, vec3(0.0), ink * 0.45);
    col = mix(col, vec3(0.0), ink2 * 0.28);
    col *= 0.78 + 0.22 * (1.0 - ink);

    // Micro-ripple tenue
    float ripple = sin(q.x * 18.0 + t * 3.5 + n1 * 8.0) *
                   sin(q.y * 14.0 - t * 2.8) * 0.012;
    col += ripple;

    // Grain
    float g = hash(gl_FragCoord.xy * 0.7 + floor(t * 20.0)) * 0.03;
    col += g - 0.02;

    float vig = smoothstep(1.35, 0.08, length(uv - 0.5));
    col *= mix(0.55, 1.0, vig);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
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
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
  }
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

  let c1 = [0.55, 0.78, 0.92];
  let c2 = [0.08, 0.18, 0.28];
  let c3 = [0.85, 0.94, 1.0];
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

  function frame() {
    raf = requestAnimationFrame(frame);
    resize();

    const now = performance.now();
    if (blending) {
      const u = Math.min(1, (now - blendStart) / Math.max(blendDuration, 1));
      const t = smootherstep(u);
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

    speed += (targetSpeed - speed) * 0.05;
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
