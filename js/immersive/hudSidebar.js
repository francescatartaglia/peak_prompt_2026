/**
 * Medical DICOM-style HUD sidebar (VT323):
 * GPX track with zone highlight, BPM zone selector, sound + heartbeat volumes.
 */

import { ZONE_ORDER, zoneConfig, zoneFromBpm } from "./zones.js";

function projectTrack(track) {
  if (!track?.length) return Object.assign([], { geoAspect: 1 });
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
  // Equirectangular correction so lon/lat keep real proportions
  const midLatRad = (((minLat + maxLat) * 0.5) * Math.PI) / 180;
  const lonScale = Math.max(Math.cos(midLatRad), 0.2);
  const geoAspect = Math.max((dLon * lonScale) / dLat, 1e-6);

  const pts = track.map((p) => {
    const bpm = Number(p.bpm);
    return {
      nx: (p.lon - minLon) / dLon,
      ny: 1 - (p.lat - minLat) / dLat,
      zone: Number.isFinite(bpm) ? zoneFromBpm(bpm) : Number(p.zone) || 1,
      bpm: Number.isFinite(bpm) ? bpm : 0,
      time: p.time,
    };
  });
  pts.geoAspect = geoAspect;
  return pts;
}

/** Fit geo-normalized track into canvas without distorting aspect ratio. */
function trackLayout(cssW, cssH, geoAspect) {
  // Extra inset so the path stays clear of L / A / R / P labels
  const pad = 0.14;
  const availW = Math.max(1, cssW * (1 - pad * 2));
  const availH = Math.max(1, cssH * (1 - pad * 2));
  const boxAspect = availW / availH;
  const aspect = Math.max(Number(geoAspect) || 1, 1e-6);
  let drawW;
  let drawH;
  if (boxAspect > aspect) {
    drawH = availH;
    drawW = drawH * aspect;
  } else {
    drawW = availW;
    drawH = drawW / aspect;
  }
  return {
    ox: (cssW - drawW) * 0.5,
    oy: (cssH - drawH) * 0.5,
    drawW,
    drawH,
  };
}

function toScreen(p, layout) {
  return {
    x: layout.ox + p.nx * layout.drawW,
    y: layout.oy + p.ny * layout.drawH,
    zone: p.zone,
    bpm: p.bpm,
  };
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
 * @param {{ track?: any[], startZone?: number, soundVol?: number, heartVol?: number, onZoneChange?: Function, onSoundChange?: Function, onHeartChange?: Function, onAutoplayChange?: Function, onTrackSeek?: Function, title?: string, report?: {
 *   examId?: string, series?: string, patientId?: string, patientName?: string, scanDate?: string,
 *   bpmMin?: number, bpmMax?: number, kv?: number, ma?: number, hikeType?: string, location?: string, duration?: string, distance?: string
 * } }} opts
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
    report = {},
  } = {}
) {
  const examId = report.examId || "CT-2026-991";
  const series = report.series || "3D CARDIAC RECON";
  const patientId = report.patientId || "HK-8842";
  const scanDate = report.scanDate || "02 OCT 2026";
  const kv = report.kv ?? 120;
  const ma = report.ma ?? 400;
  const slice = report.slice || "0.625MM";
  const rot = report.rot || "0.35S";
  const duration = report.duration || "02:32:59";
  const distance = report.distance || "3.31 KM";
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
  const SEEK_PER_SEC = 42;
  const FOLLOW_SMOOTH = 7;
  /** Cap speed along path in follow mode (indices/sec) — avoids dash-to-end */
  const FOLLOW_MAX_PER_SEC = 14;

  root.innerHTML = `
    <aside class="hud" aria-label="Cardiac CT diagnostics">
      <header class="hud-head">
        <div class="hud-title">${title}</div>
        <div class="hud-sub">CARDIAC CT · DICOM</div>
        <div class="hud-meta">
          <div class="hud-meta-row">
            <span class="hud-meta-l">EXAM ID: ${examId}</span>
            <span class="hud-meta-r">PATIENT ID: ${patientId}</span>
          </div>
          <div class="hud-meta-row">
            <span class="hud-meta-l">SERIES: ${series}</span>
            <span class="hud-meta-r">SCAN DATE: ${scanDate}</span>
          </div>
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
          <div class="hud-autoplay-row">
            <span class="hud-autoplay-label">AUTOPLAY</span>
            <span class="hud-autoplay-state" data-autoplay-state>OFF</span>
            <button
              type="button"
              class="hud-switch"
              data-autoplay
              aria-pressed="false"
              aria-label="Autoplay off"
            >
              <span class="hud-switch-thumb" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </section>

      <footer class="hud-foot">
        <div class="hud-meta-row">
          <span class="hud-meta-l">DURATION: ${duration}</span>
          <span class="hud-meta-r">kV ${kv} / mA ${ma}</span>
        </div>
        <div class="hud-meta-row">
          <span class="hud-meta-l">DISTANCE: ${distance}</span>
          <span class="hud-meta-r">${slice} / ${rot}</span>
        </div>
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
  const autoplayRow = root.querySelector(".hud-autoplay");
  const autoplayState = root.querySelector("[data-autoplay-state]");
  const zoneSlider = root.querySelector("[data-zone-slider]");

  function currentLayout(cssW, cssH) {
    return trackLayout(cssW, cssH, pts.geoAspect || 1);
  }

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

    const layout = currentLayout(cssW, cssH);
    const accent = zoneConfig(zone).accent;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (autoplay) {
      // Autoplay: tutto il percorso colorato per zona (sempre visibile)
      for (let i = 0; i < pts.length - 1; i += 1) {
        const z = pts[i].zone;
        const col = zoneConfig(z).accent;
        const a = toScreen(pts[i], layout);
        const b = toScreen(pts[i + 1], layout);
        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.1;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      // Dimmed full track
      ctx.beginPath();
      ctx.strokeStyle = "rgba(180, 190, 200, 0.28)";
      ctx.lineWidth = 2.2;
      for (let i = 0; i < pts.length; i += 1) {
        const p = toScreen(pts[i], layout);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
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
        const a = toScreen(pts[i], layout);
        const b = toScreen(pts[i + 1], layout);
        if (edgeZone === zone) {
          if (!drawing) {
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            drawing = true;
          }
          ctx.lineTo(b.x, b.y);
        } else if (drawing) {
          ctx.stroke();
          drawing = false;
        }
      }
      if (drawing) ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Endpoint markers (start + end, same gray)
    const a = toScreen(pts[0], layout);
    const b = toScreen(pts[pts.length - 1], layout);
    ctx.fillStyle = "rgba(220,230,240,0.7)";
    ctx.beginPath();
    ctx.arc(a.x, a.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();

    // Pallino progresso continuo (autoplay / scrub)
    if (progressPos >= 0 && pts.length) {
      const p = samplePath(progressPos);
      if (p) {
        const s = toScreen(p, layout);
        // Colore = zona del media corrente (HUD zone), non del punto GPX
        const dotAccent = zoneConfig(zone).accent;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = dotAccent;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = dotAccent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
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
      nx: a.nx + (b.nx - a.nx) * f,
      ny: a.ny + (b.ny - a.ny) * f,
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
        // Segue il viaggio continuo emesso dall’autoplay (path reale), con calma
        const prev = progressPos;
        const delta = progressTarget - progressPos;
        const k = 1 - Math.exp(-dt * FOLLOW_SMOOTH);
        let step = delta * k;
        const maxStep = FOLLOW_MAX_PER_SEC * dt;
        if (Math.abs(step) > maxStep) step = Math.sign(step) * maxStep;
        progressPos += step;
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
    if (autoplayRow) autoplayRow.classList.toggle("is-on", autoplay);
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
    const layout = currentLayout(rect.width, rect.height);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const p = toScreen(pts[i], layout);
      const dx = p.x - sx;
      const dy = p.y - sy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function dist2PointSeg(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const ab2 = abx * abx + aby * aby || 1e-6;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.min(1, Math.max(0, t));
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy;
  }

  /** Rombo solo sulla linea del percorso (o sul pallino), non su tutta la mappa. */
  function isTrackPathHot(clientX, clientY) {
    if (!autoplay || !canvas || pts.length < 2) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return false;
    }
    const layout = currentLayout(rect.width, rect.height);
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const thresh = 11;
    const thresh2 = thresh * thresh;

    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = toScreen(pts[i], layout);
      const b = toScreen(pts[i + 1], layout);
      best = Math.min(best, dist2PointSeg(sx, sy, a.x, a.y, b.x, b.y));
      if (best <= thresh2) return true;
    }

    // Pallino progresso
    if (progressPos >= 0) {
      const p = samplePath(progressPos);
      if (p) {
        const s = toScreen(p, layout);
        const dx = sx - s.x;
        const dy = sy - s.y;
        if (dx * dx + dy * dy <= thresh2) return true;
      }
    }
    return false;
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
    let idx = Math.min(n - 1, Math.max(0, Number(index)));
    const userDriven = !!(opts.seek || opts.immediate || progressMode === "scrub");

    // Autoplay: mai scatti indietro — solo scrub/seek utente possono tornare
    if (!userDriven && progressPos >= 0 && idx < progressPos) {
      return;
    }

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
    isTrackPathHot,
    setSoundVolume: (v) => soundSlider.set(v, { silent: true }),
    setHeartVolume: (v) => heartSlider.set(v, { silent: true }),
    redrawTrack: drawTrack,
    dispose() {
      stopProgressLoop();
      window.removeEventListener("resize", drawTrack);
    },
  };
}
