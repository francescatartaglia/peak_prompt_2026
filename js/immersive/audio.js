/**
 * Procedural heartbeat — stesso timbro in tutte le zone;
 * il volume è regolabile dall’utente.
 *
 * Shared AudioContext so autoplay clips don’t spawn a 2nd context
 * (mobile Safari often mutes the first when a second starts).
 */

import { DUB_RATIO, clampBpm, secondsPerBeat } from "./heartbeat.js";

/** Timbro fisso (non cambia con la zona). */
const TONE = { bass: 0.45, drive: 0.12, body: 0.55 };

let sharedCtx = null;

/** One AudioContext for heartbeat + autoplay analysers. */
export function getSharedAudioContext() {
  if (!sharedCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedCtx = new AC();
  }
  return sharedCtx;
}

export function createHeartbeatAudio() {
  let ctx = null;
  let timer = null;
  let bpm = 120;
  let enabled = false;
  let nextBeatIndex = 0;
  let visualOffset = 0;
  let volume = 0.5;
  let master = null;
  let filter = null;
  let shaper = null;
  const scheduleAhead = 0.22;
  const lookaheadMs = 25;

  function makeDistortionCurve(amount) {
    const n = 256;
    const curve = new Float32Array(n);
    const k = amount * 80;
    for (let i = 0; i < n; i += 1) {
      const x = (i * 2) / n - 1;
      curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  function ensureGraph() {
    const ac = ensureCtx();
    if (master) return ac;

    master = ac.createGain();
    master.gain.value = volume;

    filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180 + TONE.bass * 220;
    filter.Q.value = 0.8;

    shaper = ac.createWaveShaper();
    shaper.curve = makeDistortionCurve(TONE.drive);
    shaper.oversample = "2x";

    filter.connect(shaper);
    shaper.connect(master);
    master.connect(ac.destination);
    return ac;
  }

  function ensureCtx() {
    ctx = getSharedAudioContext();
    return ctx;
  }

  function thump(time, strength = 1) {
    const ac = ensureGraph();
    const { bass, drive, body } = TONE;

    const osc = ac.createOscillator();
    const oscGain = ac.createGain();
    osc.type = "sine";
    const baseFreq = 48 + bass * 28;
    osc.frequency.setValueAtTime(baseFreq * strength + 20, time);
    osc.frequency.exponentialRampToValueAtTime(22, time + 0.18);
    oscGain.gain.setValueAtTime(0.0001, time);
    oscGain.gain.exponentialRampToValueAtTime(0.85 * strength * body, time + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
    osc.connect(oscGain);
    oscGain.connect(filter);
    osc.start(time);
    osc.stop(time + 0.3);

    const noiseDur = 0.12 + drive * 0.08;
    const frames = Math.floor(ac.sampleRate * noiseDur);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const noise = ac.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.0001, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.2 * strength * (0.4 + drive), time + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + noiseDur);
    noise.connect(noiseGain);
    noiseGain.connect(filter);
    noise.start(time);
    noise.stop(time + noiseDur);
  }

  function schedule() {
    if (!enabled || !ctx) return;
    const spb = secondsPerBeat(bpm);
    const syncNow = ctx.currentTime - visualOffset;
    const horizon = syncNow + scheduleAhead;

    while (true) {
      const beatSync = nextBeatIndex * spb;
      if (beatSync > horizon) break;
      const audioTime = beatSync + visualOffset;
      if (audioTime >= ctx.currentTime - 0.02) {
        thump(audioTime, 1);
        thump(audioTime + spb * DUB_RATIO, 0.58);
      }
      nextBeatIndex += 1;
    }
  }

  function tick() {
    schedule();
    timer = window.setTimeout(tick, lookaheadMs);
  }

  function applyVolume() {
    if (!master || !ctx) return;
    const t = ctx.currentTime;
    const current = Number.isFinite(master.gain.value) ? master.gain.value : volume;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(current, t);
    master.gain.linearRampToValueAtTime(volume, t + 0.05);
  }

  return {
    async start(visualElapsed = 0) {
      const ac = ensureGraph();
      if (!ac) return;
      if (ac.state === "suspended") await ac.resume();
      visualOffset = ac.currentTime - visualElapsed;
      const spb = secondsPerBeat(bpm);
      const syncNow = ac.currentTime - visualOffset;
      nextBeatIndex = Math.max(0, Math.ceil(syncNow / spb));
      enabled = true;
      applyVolume();
      if (timer) window.clearTimeout(timer);
      tick();
    },
    /** Keep beating after another gesture / clip (iOS often suspends the ctx). */
    async resume() {
      const ac = ensureCtx();
      if (!ac) return;
      if (ac.state === "suspended") {
        try {
          await ac.resume();
        } catch {
          /* ignore */
        }
      }
      if (enabled && !timer) tick();
    },
    stop() {
      enabled = false;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
    setBpm(next) {
      const prev = bpm;
      bpm = clampBpm(next);
      if (!enabled || !ctx || prev === bpm) return;
      const syncNow = ctx.currentTime - visualOffset;
      nextBeatIndex = Math.max(0, Math.ceil(syncNow / secondsPerBeat(bpm)));
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      applyVolume();
    },
    getVolume() {
      return volume;
    },
    getSyncTime(fallbackElapsed = 0) {
      if (!enabled || !ctx) return fallbackElapsed;
      return ctx.currentTime - visualOffset;
    },
    getBpm() {
      return bpm;
    },
    get enabled() {
      return enabled;
    },
  };
}
