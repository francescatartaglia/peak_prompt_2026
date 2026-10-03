/**
 * Procedural heartbeat using Web Audio API.
 * Tempo follows the active zone BPM (lub-dub pattern per beat).
 */

export function createHeartbeatAudio() {
  let ctx = null;
  let timer = null;
  let bpm = 120;
  let enabled = false;
  let nextNoteTime = 0;
  const scheduleAhead = 0.15;
  const lookaheadMs = 25;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    return ctx;
  }

  function thump(time, strength = 1) {
    const ac = ensureCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const filter = ac.createBiquadFilter();

    osc.type = "sine";
    osc.frequency.setValueAtTime(85 * strength + 20, time);
    osc.frequency.exponentialRampToValueAtTime(35, time + 0.12);

    filter.type = "lowpass";
    filter.frequency.value = 180;

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.55 * strength, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);

    osc.start(time);
    osc.stop(time + 0.2);
  }

  function schedule() {
    if (!enabled || !ctx) return;
    const secondsPerBeat = 60 / Math.max(bpm, 40);
    while (nextNoteTime < ctx.currentTime + scheduleAhead) {
      // lub
      thump(nextNoteTime, 1);
      // dub
      thump(nextNoteTime + secondsPerBeat * 0.28, 0.72);
      nextNoteTime += secondsPerBeat;
    }
  }

  function tick() {
    schedule();
    timer = window.setTimeout(tick, lookaheadMs);
  }

  return {
    async start() {
      const ac = ensureCtx();
      if (ac.state === "suspended") await ac.resume();
      enabled = true;
      nextNoteTime = ac.currentTime + 0.05;
      if (timer) window.clearTimeout(timer);
      tick();
    },
    stop() {
      enabled = false;
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
    setBpm(next) {
      bpm = Math.max(40, Math.min(220, Number(next) || 120));
    },
    getBpm() {
      return bpm;
    },
    get enabled() {
      return enabled;
    },
  };
}
