/**
 * Click meccanici da tastiera (sintetizzati) — a tempo con la digitazione.
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
  const len = Math.floor(ac.sampleRate * 0.04);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) {
    // Burst breve con decadimento naturale
    const t = i / len;
    data[i] = (Math.random() * 2 - 1) * (1 - t) ** 1.6;
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
  // Tentativo immediato (funziona se il contesto è già sbloccato)
  resume();
}

function fireClick(ac, { space = false, gain = 0.22 } = {}) {
  const t0 = ac.currentTime;
  const buf = buildNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = space ? 0.72 + Math.random() * 0.08 : 0.95 + Math.random() * 0.22;

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = space ? 420 + Math.random() * 80 : 1800 + Math.random() * 900;
  bp.Q.value = space ? 0.7 : 1.1;

  const hp = ac.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = space ? 180 : 600;

  const g = ac.createGain();
  const peak = Math.min(0.85, Math.max(0.08, gain)) * (space ? 0.62 : 1);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + (space ? 0.045 : 0.028));

  // Corpo “plastica” leggero
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = space ? 110 + Math.random() * 30 : 240 + Math.random() * 120;
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(peak * 0.28, t0 + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.018);

  src.connect(bp);
  bp.connect(hp);
  hp.connect(g);
  g.connect(ac.destination);

  osc.connect(og);
  og.connect(ac.destination);

  src.start(t0);
  src.stop(t0 + 0.05);
  osc.start(t0);
  osc.stop(t0 + 0.022);
}

/**
 * Un colpo tasto. `space` = thud più cupo; altrimenti click più acuto.
 * @param {{ space?: boolean, gain?: number }} [opts]
 */
export function playTypeClick(opts = {}) {
  const ac = ensureCtx();
  if (!ac) return;
  if (ac.state === "running") {
    fireClick(ac, opts);
    return;
  }
  // Autoplay: sblocca e riprova (al primo gesto i click restanti partono)
  resume().then((ok) => {
    if (ok) fireClick(ac, opts);
  });
}
