/**
 * Playlist ambient: sequenza + loop, crossfade soft,
 * loudness allineata tra le tracce (normalizzazione RMS).
 */

const FADE_MS = 1400;
const LEAD_SEC = 1.55;
const TARGET_RMS = 0.11;
const MIN_GAIN = 0.4;
const MAX_GAIN = 4.2;
/** Extra sulle atmosfere (vento, acqua, uccelli…); voci un filo sotto. */
const AMBIENT_RE =
  /uccelli|atmosfera|respiro|foglie|vento|acqua|grotta|brum|passi|eco(?!\s*risata)|rocce|cammino/i;

function levelBoost(path) {
  const name = String(path).split("/").pop() || "";
  if (AMBIENT_RE.test(name)) return 1.55;
  return 1.15;
}

function encodePath(path) {
  return String(path)
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function makeEl(src) {
  const a = new Audio();
  a.preload = "auto";
  a.crossOrigin = "anonymous";
  a.src = encodePath(src);
  a.loop = false;
  a.playsInline = true;
  a.setAttribute("playsinline", "");
  // volume HTML lasciato a 1: il livello lo gestisce Web Audio
  a.volume = 1;
  return a;
}

function rampParam(param, from, to, ms, ctx) {
  if (!param || !ctx) return Promise.resolve();
  const now = ctx.currentTime;
  const dur = Math.max(ms, 1) / 1000;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(to, now + dur);
  return new Promise((r) => setTimeout(r, ms));
}

function computeRms(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  // campiona fino a ~30s per non pesare
  const step = Math.max(1, Math.floor(len / (audioBuffer.sampleRate * 30)));
  let sum = 0;
  let n = 0;
  for (let c = 0; c < channels; c += 1) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i += step) {
      const v = data[i];
      sum += v * v;
      n += 1;
    }
  }
  if (!n) return TARGET_RMS;
  return Math.sqrt(sum / n);
}

function tracksKey(list) {
  return (list || []).map((t) => t.path).join("|");
}

export function createZoneAmbient() {
  let tracks = [];
  let key = "";
  let index = 0;
  let current = null; // { el, src, gain }
  let pending = null;
  let volume = 0.72;
  let playing = false;
  let crossfading = false;
  let gen = 0;

  let ctx = null;
  let master = null;
  let comp = null;
  let limiter = null;
  const gainCache = new Map(); // path → linear gain

  function bump() {
    gen += 1;
    return gen;
  }

  function ensureGraph() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = volume;

    // Compressor + soft knee: livella ulteriormente i picchi
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.knee.value = 18;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;

    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0.5;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    comp.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);
    return ctx;
  }

  async function resumeCtx() {
    const ac = ensureGraph();
    if (ac.state === "suspended") {
      try {
        await ac.resume();
      } catch {
        /* ignore */
      }
    }
    return ac;
  }

  async function normalizeGain(path) {
    if (gainCache.has(path)) return gainCache.get(path);
    try {
      const ac = ensureGraph();
      const res = await fetch(encodePath(path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      const buf = await ac.decodeAudioData(raw.slice(0));
      const rms = Math.max(computeRms(buf), 1e-4);
      const g = Math.min(
        MAX_GAIN,
        Math.max(MIN_GAIN, (TARGET_RMS / rms) * levelBoost(path))
      );
      gainCache.set(path, g);
      return g;
    } catch (err) {
      console.warn("[ambient] normalize failed", path, err);
      gainCache.set(path, 1);
      return 1;
    }
  }

  function wireEl(el, trackGainValue) {
    const ac = ensureGraph();
    const src = ac.createMediaElementSource(el);
    const g = ac.createGain();
    g.gain.value = trackGainValue;
    src.connect(g);
    g.connect(comp);
    return { el, src, gain: g };
  }

  function disposeSlot(slot) {
    if (!slot) return;
    const { el, src, gain } = slot;
    el.onended = null;
    el.onerror = null;
    try {
      el.pause();
    } catch {
      /* ignore */
    }
    try {
      src.disconnect();
      gain.disconnect();
    } catch {
      /* ignore */
    }
    try {
      el.removeAttribute("src");
      el.load();
    } catch {
      /* ignore */
    }
  }

  async function fadeOutSlot(slot) {
    if (!slot || !ctx) {
      disposeSlot(slot);
      return;
    }
    const g = slot.gain.gain;
    const from = g.value;
    await rampParam(g, from, 0, FADE_MS, ctx);
    disposeSlot(slot);
  }

  function nextIndex() {
    if (!tracks.length) return 0;
    return (index + 1) % tracks.length;
  }

  async function playAt(i, { fadeIn = true } = {}) {
    if (!playing || !tracks.length) return;
    const my = bump();
    await resumeCtx();
    index = ((i % tracks.length) + tracks.length) % tracks.length;
    const track = tracks[index];

    const norm = await normalizeGain(track.path);
    if (my !== gen || !playing) return;

    const el = makeEl(track.path);
    let slot;
    try {
      slot = wireEl(el, fadeIn ? 0.0001 : norm);
    } catch (err) {
      console.warn("[ambient] wire failed", track.path, err);
      setTimeout(() => {
        if (my === gen && playing) advance();
      }, 300);
      return;
    }
    current = slot;

    try {
      await el.play();
    } catch (err) {
      console.warn("[ambient] play failed", track.path, err);
      disposeSlot(slot);
      if (current === slot) current = null;
      setTimeout(() => {
        if (my === gen && playing) advance();
      }, 400);
      return;
    }

    if (my !== gen || current !== slot) return;

    if (fadeIn) {
      await rampParam(slot.gain.gain, 0.0001, norm, FADE_MS, ctx);
    } else {
      slot.gain.gain.value = norm;
    }

    if (my !== gen || current !== slot || !playing) return;
    armAdvance(slot, my, norm);
  }

  function armAdvance(slot, my) {
    const el = slot.el;
    el.onended = () => {
      if (my !== gen || !playing || current !== slot) return;
      if (!crossfading) advance();
    };
    el.onerror = () => {
      if (my !== gen || !playing || current !== slot) return;
      console.warn("[ambient] skip", tracks[index]?.path);
      advance();
    };

    const tick = () => {
      if (my !== gen || !playing || current !== slot || crossfading) return;
      const dur = el.duration;
      if (Number.isFinite(dur) && dur > LEAD_SEC + 0.25) {
        if (dur - el.currentTime <= LEAD_SEC) {
          advance();
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function advance() {
    if (!playing || !tracks.length || crossfading) return;
    crossfading = true;
    const my = bump();
    const prev = current;
    const ni = nextIndex();
    const track = tracks[ni];

    await resumeCtx();
    const norm = await normalizeGain(track.path);
    if (my !== gen || !playing) {
      crossfading = false;
      return;
    }

    const el = makeEl(track.path);
    let slot;
    try {
      slot = wireEl(el, 0.0001);
    } catch (err) {
      console.warn("[ambient] wire failed", track.path, err);
      index = ni;
      crossfading = false;
      playAt(nextIndex(), { fadeIn: true });
      return;
    }
    pending = slot;

    try {
      await el.play();
    } catch (err) {
      console.warn("[ambient] play failed", track.path, err);
      disposeSlot(slot);
      pending = null;
      index = ni;
      crossfading = false;
      setTimeout(() => {
        if (playing) playAt(nextIndex(), { fadeIn: true });
      }, 400);
      return;
    }

    if (my !== gen || !playing) {
      disposeSlot(slot);
      pending = null;
      crossfading = false;
      return;
    }

    index = ni;
    current = slot;
    pending = null;

    await Promise.all([
      prev ? fadeOutSlot(prev) : Promise.resolve(),
      rampParam(slot.gain.gain, 0.0001, norm, FADE_MS, ctx),
    ]);

    if (my !== gen || current !== slot || !playing) return;
    crossfading = false;
    armAdvance(slot, my);
  }

  function applyMasterVolume() {
    if (!master || !ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.linearRampToValueAtTime(volume, now + 0.08);
  }

  // Precarica i gain RMS in background
  async function warmNormalize(list) {
    await resumeCtx();
    for (const t of list) {
      if (!t?.path || gainCache.has(t.path)) continue;
      // eslint-disable-next-line no-await-in-loop
      await normalizeGain(t.path);
    }
  }

  return {
    /** @returns {boolean} true se la playlist è cambiata */
    setTracks(list) {
      const next = (list || [])
        .filter((t) => t?.path)
        .slice()
        .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
      const k = tracksKey(next);
      if (k === key) {
        tracks = next;
        return false;
      }
      key = k;
      tracks = next;
      index = 0;
      warmNormalize(next);
      return true;
    },
    async start({ force = false } = {}) {
      if (!tracks.length) return;
      await resumeCtx();
      if (playing && current && !force) {
        applyMasterVolume();
        return;
      }
      if (playing && force) {
        // cambio zona: ferma la coda corrente e riparti
        playing = false;
        bump();
        const a = current;
        const b = pending;
        current = null;
        pending = null;
        crossfading = false;
        await Promise.all([fadeOutSlot(a), fadeOutSlot(b)]);
      }
      playing = true;
      crossfading = false;
      await playAt(index, { fadeIn: true });
    },
    async stop() {
      if (!playing && !current && !pending) return;
      playing = false;
      bump();
      const a = current;
      const b = pending;
      current = null;
      pending = null;
      crossfading = false;
      await Promise.all([fadeOutSlot(a), fadeOutSlot(b)]);
    },
    setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      applyMasterVolume();
      if (master) master.gain.value = volume;
    },
    getVolume() {
      return volume;
    },
    get playing() {
      return playing;
    },
    get index() {
      return index;
    },
    get trackCount() {
      return tracks.length;
    },
  };
}
