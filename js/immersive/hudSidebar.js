/**
 * Medical DICOM-style HUD sidebar (VT323):
 * GPX track with zone highlight, BPM zone selector, sound + heartbeat volumes.
 */

import { ZONE_ORDER, zoneConfig, zoneFromBpm } from "./zones.js";

function projectTrack(track) {
  if (!track?.length) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of track) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const dLon = Math.max(maxLon - minLon, 1e-6);
  const pad = 0.08;
  return track.map((p) => {
    const nx = (p.lon - minLon) / dLon;
    const ny = (p.lat - minLat) / dLat;
    const bpm = Number(p.bpm);
    return {
      x: pad + nx * (1 - pad * 2),
      y: pad + (1 - ny) * (1 - pad * 2),
      zone: Number.isFinite(bpm) ? zoneFromBpm(bpm) : Number(p.zone) || 1,
      bpm: Number.isFinite(bpm) ? bpm : 0,
      time: p.time,
    };
  });
}

function bindHorizontalSlider(el, { value, onChange, valueEl } = {}) {
  let v = Math.min(1, Math.max(0, Number(value) || 0));
  const fill = el?.querySelector("[data-fill]");
  const thumb = el?.querySelector("[data-thumb]");
  const readout =
    valueEl ||
    el?.closest(".hud-control")?.querySelector("[data-value]") ||
    null;
  let dragging = false;

  function paint() {
    const pct = `${(v * 100).toFixed(1)}%`;
    el.style.setProperty("--pct", pct);
    if (fill) fill.style.width = pct;
    if (thumb) thumb.style.left = pct;
    if (readout) {
      readout.textContent = String(Math.round(v * 100));
    }
  }

  function set(next, { silent = false } = {}) {
    v = Math.min(1, Math.max(0, Number(next) || 0));
    paint();
    if (!silent) onChange?.(v);
  }

  function fromX(clientX) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return v;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    el.setPointerCapture?.(e.pointerId);
    set(fromX(e.clientX));
  });
  el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    e.preventDefault();
    set(fromX(e.clientX));
  });
  el.addEventListener("pointerup", () => {
    dragging = false;
  });
  el.addEventListener("pointercancel", () => {
    dragging = false;
  });

  paint();
  return { get: () => v, set };
}

/**
 * @param {HTMLElement} root
 * @param {{ track?: any[], startZone?: number, soundVol?: number, heartVol?: number, onZoneChange?: Function, onSoundChange?: Function, onHeartChange?: Function, onAutoplayChange?: Function, onTrackSeek?: Function, title?: string }} opts
 */
export function createHudSidebar(
  root,
  {
    track = [],
    startZone = 1,
    soundVol = 0.5,
    heartVol = 0.5,
    onZoneChange,
    onSoundChange,
    onHeartChange,
    onAutoplayChange,
    onTrackSeek,
    title = "PEAK PROMPT",
  } = {}
) {
  const pts = projectTrack(track);
  let zone = startZone;
  let autoplay = false;
  /** Posizione continua lungo il GPX (float indice); -1 = nascosto */
  let progressPos = -1;
  let progressTarget = -1;
  /** idle | follow | seek | scrub */
  let progressMode = "idle";
  let scrubTarget = 0;
  let progressRaf = 0;
  let lastProgressTs = 0;
  const SEEK_PER_SEC = 58;
  const FOLLOW_SMOOTH = 11;

  root.innerHTML = `
    <aside class="hud" aria-label="Cardiac CT diagnostics">
      <header class="hud-head">
        <div class="hud-title">${title}</div>
        <div class="hud-sub">TAC CARDIACA · DICOM</div>
        <div class="hud-meta">
          <span>EX: 6868</span>
          <span>SE: 6</span>
          <span>IM: 51</span>
        </div>
      </header>

      <section class="hud-track-wrap" aria-label="GPX heart-rate track">
        <div class="hud-track-label">ROUTE / HR MAP</div>
        <canvas class="hud-track" width="280" height="420" aria-hidden="true"></canvas>
        <div class="hud-orient">
          <span>A</span><span>P</span><span>R</span><span>L</span>
        </div>
      </section>

      <section class="hud-controls">
        <div class="hud-control">
          <div class="hud-control-row">
            <span class="hud-label">BPM / ZONE</span>
            <span class="hud-readout hud-readout--zone" data-zone-readout>ZONE 1</span>
          </div>
          <div class="hud-zone-slider" data-zone-slider>
            <div class="hud-h-fill hud-h-fill--zone" data-zone-fill></div>
            <div class="hud-zone-marks">
              ${ZONE_ORDER.map(
                (id) =>
                  `<button type="button" class="hud-zone-mark" data-zone="${id}" style="--z:${zoneConfig(id).accent}" aria-label="${zoneConfig(id).rangeLabel}"></button>`
              ).join("")}
            </div>
            <input type="range" min="1" max="4" step="1" value="${startZone}" data-zone-range aria-label="Heart rate zone" />
          </div>
          <div class="hud-zone-range" data-zone-range-label>${zoneConfig(startZone).rangeLabel}</div>
        </div>

        <div class="hud-control">
          <div class="hud-control-row">
            <span class="hud-label">SOUND</span>
            <span class="hud-readout" data-value data-mode="pct">${Math.round(soundVol * 100)}</span>
          </div>
          <div class="hud-h-slider" data-sound-slider>
            <div class="hud-h-fill" data-fill></div>
            <button type="button" class="hud-h-thumb" data-thumb aria-label="Sound volume"></button>
          </div>
        </div>

        <div class="hud-control">
          <div class="hud-control-row">
            <span class="hud-label">HEARTBEAT</span>
            <span class="hud-readout" data-value data-mode="pct">${Math.round(heartVol * 100)}</span>
          </div>
          <div class="hud-h-slider" data-heart-slider>
            <div class="hud-h-fill" data-fill></div>
            <button type="button" class="hud-h-thumb" data-thumb aria-label="Heartbeat volume"></button>
          </div>
        </div>

        <div class="hud-control hud-autoplay">
          <button type="button" class="hud-autoplay-btn" data-autoplay aria-pressed="false" aria-label="Autoplay off">
            <span class="hud-autoplay-label">AUTOPLAY</span>
            <span class="hud-autoplay-state" data-autoplay-state>OFF</span>
            <span class="hud-switch" aria-hidden="true">
              <span class="hud-switch-thumb"></span>
            </span>
          </button>
        </div>
      </section>

      <footer class="hud-foot">
        <span>kV 100</span>
        <span>mA 400</span>
        <span class="hud-ww">WW: 400 WL: 40</span>
      </footer>
    </aside>
  `;

  const canvas = root.querySelector(".hud-track");
  const ctx = canvas.getContext("2d");
  const zoneReadout = root.querySelector("[data-zone-readout]");
  const zoneRangeLabel = root.querySelector("[data-zone-range-label]");
  const zoneFill = root.querySelector("[data-zone-fill]");
  const zoneRange = root.querySelector("[data-zone-range]");
  const autoplayBtn = root.querySelector("[data-autoplay]");
  const autoplayState = root.querySelector("[data-autoplay-state]");
  const zoneSlider = root.querySelector("[data-zone-slider]");

  function drawTrack() {
    if (!ctx || !canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 140;
    const cssH = canvas.clientHeight || 220;
    const w = Math.floor(cssW * dpr);
    const h = Math.floor(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (pts.length < 2) {
      ctx.fillStyle = "rgba(200,210,220,0.25)";
      ctx.font = "16px VT323, monospace";
      ctx.fillText("NO TRACK", 12, 24);
      return;
    }

    const accent = zoneConfig(zone).accent;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (autoplay) {
      // Autoplay: tutto il percorso colorato per zona (sempre visibile)
      for (let i = 0; i < pts.length - 1; i += 1) {
        const z = pts[i].zone;
        const col = zoneConfig(z).accent;
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.1;
        ctx.moveTo(pts[i].x * cssW, pts[i].y * cssH);
        ctx.lineTo(pts[i + 1].x * cssW, pts[i + 1].y * cssH);
        ctx.stroke();
      }
    } else {
      // Dimmed full track
      ctx.beginPath();
      ctx.strokeStyle = "rgba(180, 190, 200, 0.28)";
      ctx.lineWidth = 2.2;
      for (let i = 0; i < pts.length; i += 1) {
        const x = pts[i].x * cssW;
        const y = pts[i].y * cssH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Solo la zona selezionata in evidenza
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.2;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 8;
      let drawing = false;
      for (let i = 0; i < pts.length - 1; i += 1) {
        const edgeZone = pts[i].zone;
        const x0 = pts[i].x * cssW;
        const y0 = pts[i].y * cssH;
        const x1 = pts[i + 1].x * cssW;
        const y1 = pts[i + 1].y * cssH;
        if (edgeZone === zone) {
          if (!drawing) {
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            drawing = true;
          }
          ctx.lineTo(x1, y1);
        } else if (drawing) {
          ctx.stroke();
          drawing = false;
        }
      }
      if (drawing) ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Endpoint markers
    const a = pts[0];
    const b = pts[pts.length - 1];
    ctx.fillStyle = "rgba(220,230,240,0.7)";
    ctx.beginPath();
    ctx.arc(a.x * cssW, a.y * cssH, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = zoneConfig(b.zone || 4).accent;
    ctx.beginPath();
    ctx.arc(b.x * cssW, b.y * cssH, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Pallino progresso continuo (autoplay / scrub)
    if (progressPos >= 0 && pts.length) {
      const p = samplePath(progressPos);
      if (p) {
        const dotAccent = zoneConfig(p.zone || zone).accent;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = dotAccent;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x * cssW, p.y * cssH, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = dotAccent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p.x * cssW, p.y * cssH, 5.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function samplePath(t) {
    const n = pts.length;
    if (!n) return null;
    if (t <= 0) return pts[0];
    if (t >= n - 1) return pts[n - 1];
    const i = Math.floor(t);
    const f = t - i;
    const a = pts[i];
    const b = pts[Math.min(n - 1, i + 1)];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      zone: f < 0.5 ? a.zone : b.zone,
    };
  }

  function stopProgressLoop() {
    if (progressRaf) {
      cancelAnimationFrame(progressRaf);
      progressRaf = 0;
    }
  }

  function ensureProgressLoop() {
    if (progressRaf || !autoplay) return;
    if (progressPos < 0 && progressMode !== "scrub") return;
    lastProgressTs = performance.now();
    const tick = (now) => {
      progressRaf = 0;
      if (!autoplay) return;
      if (progressPos < 0 && progressMode !== "scrub") return;
      const dt = Math.min(0.05, (now - lastProgressTs) / 1000);
      lastProgressTs = now;
      const n = pts.length;
      if (!n) return;

      let dirty = false;
      if (progressMode === "scrub") {
        const k = Math.min(1, dt * 16);
        const next = progressPos + (scrubTarget - progressPos) * k;
        if (Math.abs(next - progressPos) > 0.0008) {
          progressPos = next;
          dirty = true;
        }
      } else if (progressMode === "seek") {
        const delta = progressTarget - progressPos;
        const step = SEEK_PER_SEC * dt;
        if (Math.abs(delta) <= step) {
          progressPos = progressTarget;
          progressMode = "follow";
        } else {
          progressPos += Math.sign(delta) * step;
        }
        dirty = true;
      } else if (progressMode === "follow") {
        // Segue il viaggio continuo emesso dall’autoplay (path reale)
        const prev = progressPos;
        const k = 1 - Math.exp(-dt * FOLLOW_SMOOTH);
        progressPos += (progressTarget - progressPos) * k;
        progressPos = Math.min(n - 1, Math.max(0, progressPos));
        dirty = Math.abs(progressPos - prev) > 0.0004;
      }

      if (dirty) drawTrack();
      if (autoplay && (progressPos >= 0 || progressMode === "scrub")) {
        progressRaf = requestAnimationFrame(tick);
      }
    };
    progressRaf = requestAnimationFrame(tick);
  }

  function paintAutoplay() {
    if (autoplayBtn) {
      autoplayBtn.classList.toggle("is-on", autoplay);
      autoplayBtn.setAttribute("aria-pressed", autoplay ? "true" : "false");
      autoplayBtn.setAttribute("aria-label", autoplay ? "Autoplay on" : "Autoplay off");
    }
    if (autoplayState) autoplayState.textContent = autoplay ? "ON" : "OFF";
    root.classList.toggle("is-autoplay", autoplay);
    if (zoneSlider) zoneSlider.classList.toggle("is-locked", autoplay);
    if (zoneRange) zoneRange.disabled = autoplay;
    if (canvas) {
      canvas.classList.toggle("is-scrubbable", autoplay);
      canvas.style.pointerEvents = autoplay ? "auto" : "none";
    }
    drawTrack();
  }

  function nearestTrackIndex(clientX, clientY) {
    if (!canvas || pts.length < 1) return 0;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return progressPos >= 0 ? Math.round(progressPos) : 0;
    }
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const dx = pts[i].x - nx;
      const dy = pts[i].y - ny;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function paintZone() {
    const cfg = zoneConfig(zone);
    const t = ((zone - 1) / 3) * 100;
    if (zoneFill) zoneFill.style.width = `${Math.max(t, 2)}%`;
    root.style.setProperty("--hud-accent", cfg.accent);
    if (zoneReadout) zoneReadout.textContent = `ZONE ${zone}`;
    if (zoneRangeLabel) zoneRangeLabel.textContent = cfg.rangeLabel || cfg.range;
    root.querySelectorAll(".hud-zone-mark").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.zone) === zone);
    });
    drawTrack();
  }

  function setZone(next, { silent = false } = {}) {
    zone = Math.min(4, Math.max(1, Math.round(next)));
    if (zoneRange) zoneRange.value = String(zone);
    paintZone();
    if (!silent) onZoneChange?.(zone);
  }

  function setAutoplay(next, { silent = false } = {}) {
    autoplay = !!next;
    paintAutoplay();
    if (!autoplay) {
      progressPos = -1;
      progressTarget = -1;
      progressMode = "idle";
      stopProgressLoop();
      drawTrack();
    }
    if (!silent) onAutoplayChange?.(autoplay);
  }

  /**
   * Pallino sync al viaggio media: -1 = nascosto (restart), altrimenti float GPX.
   * @param {number} index
   * @param {{ immediate?: boolean, seek?: boolean }} [opts]
   */
  function setTrackProgress(index, opts = {}) {
    const n = pts.length;
    if (!n || index == null || index < 0) {
      // Scomparsa (fine giro) — niente ritorno indietro sul path
      progressPos = -1;
      progressTarget = -1;
      progressMode = "idle";
      stopProgressLoop();
      drawTrack();
      return;
    }
    const idx = Math.min(n - 1, Math.max(0, Number(index)));
    progressTarget = idx;

    // Ricomparsa all’inizio / primo fix: snap
    if (progressPos < 0 || opts.immediate) {
      progressPos = idx;
      progressMode = autoplay ? "follow" : "idle";
      drawTrack();
      ensureProgressLoop();
      return;
    }

    if (opts.seek || progressMode === "scrub") {
      progressMode = "seek";
    } else if (autoplay) {
      if (progressMode !== "seek" && progressMode !== "scrub") {
        progressMode = "follow";
      }
      // Salto indietro netto (wrap / seek) → riallinea in modo fluido
      if (idx < progressPos - 6) progressMode = "seek";
    }

    ensureProgressLoop();
  }

  zoneRange?.addEventListener("input", () => {
    if (autoplay) return;
    setZone(Number(zoneRange.value));
  });
  root.querySelectorAll(".hud-zone-mark").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (autoplay) return;
      setZone(Number(btn.dataset.zone));
    });
  });
  autoplayBtn?.addEventListener("click", () => setAutoplay(!autoplay));

  // Scrubbing pallino sul percorso (solo in autoplay) — movimento fluido
  let scrubbing = false;
  function scrubTo(clientX, clientY, { commit = false } = {}) {
    if (!autoplay || !pts.length) return;
    const idx = nearestTrackIndex(clientX, clientY);
    scrubTarget = idx;
    progressTarget = idx;
    if (progressPos < 0) progressPos = idx;
    progressMode = commit ? "seek" : "scrub";
    ensureProgressLoop();
    if (commit) onTrackSeek?.(idx);
  }
  canvas?.addEventListener("pointerdown", (e) => {
    if (!autoplay) return;
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    canvas.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX, e.clientY, { commit: false });
  });
  canvas?.addEventListener("pointermove", (e) => {
    if (!scrubbing || !autoplay) return;
    e.preventDefault();
    scrubTo(e.clientX, e.clientY, { commit: false });
  });
  const endScrub = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    if (autoplay) scrubTo(e.clientX, e.clientY, { commit: true });
  };
  canvas?.addEventListener("pointerup", endScrub);
  canvas?.addEventListener("pointercancel", endScrub);

  const soundSlider = bindHorizontalSlider(root.querySelector("[data-sound-slider]"), {
    value: soundVol,
    onChange: onSoundChange,
  });
  const heartSlider = bindHorizontalSlider(root.querySelector("[data-heart-slider]"), {
    value: heartVol,
    onChange: onHeartChange,
  });

  paintZone();
  paintAutoplay();
  window.addEventListener("resize", drawTrack);

  return {
    getZone: () => zone,
    setZone,
    getAutoplay: () => autoplay,
    setAutoplay,
    setTrackProgress,
    setSoundVolume: (v) => soundSlider.set(v, { silent: true }),
    setHeartVolume: (v) => heartSlider.set(v, { silent: true }),
    redrawTrack: drawTrack,
    dispose() {
      stopProgressLoop();
      window.removeEventListener("resize", drawTrack);
    },
  };
}
