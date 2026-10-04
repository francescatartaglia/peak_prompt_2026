/**
 * Click meccanici / elettronici (sintetizzati) — a tempo con la formazione testo.
 */

let ctx = null;
let noiseBuf = null;
let unlocked = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

function buildNoise(ac) {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    const t = i / len;
    // Rumore digitale più “secco”
    data[i] = (Math.random() * 2 - 1) * (1 - t) ** 2.2;
  }
  noiseBuf = buf;
  return buf;
}

async function resume() {
  const ac = ensureCtx();
  if (!ac) return false;
  if (ac.state === "suspended") {
    try {
      await ac.resume();
    } catch {
      return false;
    }
  }
  unlocked = ac.state === "running";
  return unlocked;
}

/** Sblocca l’audio al primo gesto (autoplay policy). */
export function armTypeSounds() {
  ensureCtx();
  const unlock = () => {
    resume();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
  resume();
}

/**
 * Tick elettronico/meccanico (relay + blip digitale).
 * @param {AudioContext} ac
 * @param {{ space?: boolean, gain?: number, uniform?: boolean, fluid?: boolean }} opts
 */
function fireClick(ac, { space = false, gain = 0.22, uniform = false, fluid = false } = {}) {
  const t0 = ac.currentTime;
  const peak = Math.min(0.85, Math.max(0.06, gain)) * (space && !uniform ? 0.55 : 1);
  const dur = fluid ? 0.038 : space && !uniform ? 0.05 : 0.032;

  // Burst noise filtrato (meccanico / relay)
  const buf = buildNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = uniform || fluid ? (fluid ? 1.15 : 1.05) : space ? 0.75 : 1.05 + Math.random() * 0.15;

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = uniform || fluid ? (fluid ? 2100 : 1850) : space ? 480 : 2000;
  bp.Q.value = fluid ? 1.6 : 2.2;

  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = fluid ? 900 : 700;

  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(peak * (fluid ? 0.55 : 0.7), t0 + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(bp);
  bp.connect(hp);
  hp.connect(ng);
  ng.connect(ac.destination);

  // Blip square elettronico
  const osc = ac.createOscillator();
  osc.type = "square";
  const baseHz = uniform || fluid ? (fluid ? 980 : 880) : space ? 160 : 720 + Math.random() * 200;
  osc.frequency.setValueAtTime(baseHz, t0);
  // Micro chirp verso il basso → feeling servo/relay
  osc.frequency.exponentialRampToValueAtTime(baseHz * 0.72, t0 + (fluid ? 0.022 : 0.016));

  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = fluid ? 2400 : 3200;
  lp.Q.value = 0.7;

  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(peak * (fluid ? 0.22 : 0.32), t0 + 0.0015);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + (fluid ? 0.028 : 0.02));

  osc.connect(lp);
  lp.connect(og);
  og.connect(ac.destination);

  // Armonica alta sottile (digitale)
  const hi = ac.createOscillator();
  hi.type = "square";
  hi.frequency.value = baseHz * 2.5;
  const hg = ac.createGain();
  hg.gain.setValueAtTime(0.0001, t0);
  hg.gain.exponentialRampToValueAtTime(peak * (fluid ? 0.06 : 0.1), t0 + 0.001);
  hg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.012);
  hi.connect(hg);
  hg.connect(ac.destination);

  src.start(t0);
  src.stop(t0 + 0.045);
  osc.start(t0);
  osc.stop(t0 + 0.03);
  hi.start(t0);
  hi.stop(t0 + 0.015);
}

/**
 * Un colpo tasto elettronico.
 * @param {{ space?: boolean, gain?: number, uniform?: boolean, fluid?: boolean }} [opts]
 */
export function playTypeClick(opts = {}) {
  const ac = ensureCtx();
  if (!ac) return;
  if (ac.state === "running") {
    fireClick(ac, opts);
    return;
  }
  resume().then((ok) => {
    if (ok) fireClick(ac, opts);
  });
}
