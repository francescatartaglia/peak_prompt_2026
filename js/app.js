const fmtTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const fmtTimeFull = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m} min`;
  return `${h}h ${m}m`;
}

function formatDelta(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s from track`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m from track`;
  return s ? `${m}m ${s}s from track` : `${m}m from track`;
}

function elev(meters) {
  if (meters == null || Number.isNaN(meters)) return "—";
  return `${Math.round(meters)} m`;
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

async function loadData() {
  const res = await fetch("data/timeline.json");
  if (!res.ok) throw new Error("Could not load timeline data");
  return res.json();
}

function renderHeader(data) {
  document.getElementById("title").textContent = data.title;
  document.title = `${data.title} — timeline`;
  document.getElementById("subtitle").textContent =
    "Photos, video, and audio placed on the GPX time axis. Altitude from the track.";
  document.getElementById("duration").textContent = formatDuration(data.durationMinutes);
  document.getElementById("asset-count").textContent = String(data.assets.length);
  const { min, max } = data.elevation;
  document.getElementById("altitude").textContent = `${Math.round(min)}–${Math.round(max)} m`;
}

function setRailWidth(data) {
  const rail = document.getElementById("rail");
  // ~18px per minute, with a comfortable minimum for scrolling
  const width = clamp(Math.round(data.durationMinutes * 18), 1600, 4800);
  rail.style.setProperty("--rail-width", `${width}px`);
  return width;
}

function xFromProgress(progress) {
  return `calc(${clamp(progress, 0, 1) * 100}% )`;
}

/** Cluster nearby assets so dense bursts stay readable. */
function clusterAssets(assets, threshold = 0.012) {
  const sorted = [...assets].sort((a, b) => a.progress - b.progress);
  const clusters = [];
  for (const asset of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(asset.progress - last.progress) <= threshold) {
      last.items.push(asset);
      last.progress = (last.progress * (last.items.length - 1) + asset.progress) / last.items.length;
    } else {
      clusters.push({ progress: asset.progress, items: [asset] });
    }
  }
  return clusters;
}

function markerThumb(asset) {
  if (asset.kind === "audio") {
    return `<span class="marker-icon" aria-hidden="true">♪</span>`;
  }
  if (asset.kind === "video") {
    return `<video src="${asset.path}#t=0.1" muted preload="metadata" playsinline></video>`;
  }
  return `<img src="${asset.path}" alt="" loading="lazy" />`;
}

function renderLanes(data) {
  const byKind = {
    image: data.assets.filter((a) => a.kind === "image"),
    video: data.assets.filter((a) => a.kind === "video"),
    audio: data.assets.filter((a) => a.kind === "audio"),
  };

  Object.entries(byKind).forEach(([kind, list]) => {
    const root = document.getElementById(`lane-${kind}`);
    root.innerHTML = "";
    const clusters = clusterAssets(list, kind === "image" ? 0.01 : 0.008);
    const frag = document.createDocumentFragment();

    clusters.forEach((cluster, clusterIndex) => {
      const primary = cluster.items[0];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `marker kind-${kind}${primary.onTrack ? "" : " is-off"}`;
      btn.style.left = xFromProgress(cluster.progress);
      btn.dataset.kind = kind;
      btn.dataset.cluster = cluster.items.map((a) => a.path).join("|");
      btn.title = cluster.items.map((a) => a.id).join(", ");
      btn.innerHTML = `
        <span class="marker-shell">${markerThumb(primary)}</span>
        ${cluster.items.length > 1 ? `<span class="marker-badge">${cluster.items.length}</span>` : ""}
      `;
      btn.style.transitionDelay = `${Math.min(clusterIndex, 20) * 12}ms`;
      frag.appendChild(btn);
    });

    root.appendChild(frag);
  });
}

function renderElevation(data) {
  const svg = document.getElementById("elev-chart");
  const scale = document.getElementById("elev-scale");
  const { min, max } = data.elevation;
  const pad = Math.max((max - min) * 0.08, 20);
  const yMin = min - pad;
  const yMax = max + pad;
  const w = 1000;
  const h = 160;

  const points = data.track.map((p) => {
    const x = clamp(p.progress, 0, 1) * w;
    const y = h - ((p.ele - yMin) / (yMax - yMin)) * h;
    return [x, y];
  });

  if (!points.length) return;

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)},${h} L${points[0][0].toFixed(2)},${h} Z`;

  const gridYs = [0.15, 0.5, 0.85].map((t) => t * h);

  svg.innerHTML = `
    <defs>
      <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="rgba(196,165,116,0.45)" />
        <stop offset="100%" stop-color="rgba(196,165,116,0.05)" />
      </linearGradient>
    </defs>
    ${gridYs.map((y) => `<line class="elev-grid" x1="0" y1="${y}" x2="${w}" y2="${y}" />`).join("")}
    <path class="elev-area" d="${area}" />
    <path class="elev-line" d="${line}" />
  `;

  const mid = (min + max) / 2;
  scale.innerHTML = `
    <span>${Math.round(max)} m</span>
    <span>${Math.round(mid)} m</span>
    <span>${Math.round(min)} m</span>
  `;
}

function renderTimeAxis(data) {
  const axis = document.getElementById("time-axis");
  axis.innerHTML = "";
  const start = new Date(data.start).getTime();
  const end = new Date(data.end).getTime();
  const span = end - start;
  const minutes = data.durationMinutes;
  const stepMin = minutes > 120 ? 30 : minutes > 60 ? 15 : 10;
  const stepMs = stepMin * 60 * 1000;

  const first = Math.ceil(start / stepMs) * stepMs;
  for (let t = first; t <= end; t += stepMs) {
    const progress = (t - start) / span;
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.left = `${progress * 100}%`;
    tick.textContent = fmtTime.format(new Date(t));
    axis.appendChild(tick);
  }

  // Always include start label
  const startTick = document.createElement("span");
  startTick.className = "tick";
  startTick.style.left = "0%";
  startTick.textContent = fmtTime.format(new Date(start));
  axis.prepend(startTick);
}

function setupPlayhead() {
  const scroller = document.getElementById("scroller");
  const rail = document.getElementById("rail");
  const playhead = document.getElementById("playhead");
  const pad = 48;

  const sync = (clientX) => {
    const rect = rail.getBoundingClientRect();
    const x = clamp(clientX - rect.left, pad, rect.width - pad);
    playhead.style.left = `${x}px`;
    playhead.classList.add("is-on");
  };

  scroller.addEventListener("pointermove", (e) => sync(e.clientX));
  scroller.addEventListener("pointerleave", () => playhead.classList.remove("is-on"));
}

function setupFilters() {
  const buttons = document.querySelectorAll(".filter");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      const filter = btn.dataset.filter;
      document.querySelectorAll(".lane").forEach((lane) => {
        const kind = lane.dataset.lane;
        const show = filter === "all" || filter === kind;
        lane.classList.toggle("is-dim", !show);
      });
    });
  });
}

function setupInspector(data) {
  const inspector = document.getElementById("inspector");
  const media = document.getElementById("inspector-media");
  const title = document.getElementById("inspector-title");
  const meta = document.getElementById("inspector-meta");
  const match = document.getElementById("inspector-match");
  const closeBtn = document.getElementById("inspector-close");
  const byPath = new Map(data.assets.map((a) => [a.path, a]));
  let cycle = [];
  let cycleIndex = 0;

  function renderAsset(asset) {
    media.innerHTML = "";
    document.querySelectorAll(".marker.is-active").forEach((el) => el.classList.remove("is-active"));

    if (asset.kind === "video") {
      const video = document.createElement("video");
      video.src = asset.path;
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      media.appendChild(video);
    } else if (asset.kind === "audio") {
      const audio = document.createElement("audio");
      audio.src = asset.path;
      audio.controls = true;
      audio.autoplay = true;
      media.appendChild(audio);
    } else {
      const img = document.createElement("img");
      img.src = asset.path;
      img.alt = asset.id;
      media.appendChild(img);
    }

    const when = new Date(asset.time);
    title.textContent = asset.id;
    meta.textContent = `${asset.kind} · ${asset.source} · ${fmtTimeFull.format(when)}${
      asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ""
    }`;
    match.textContent = `GPX ${fmtTimeFull.format(new Date(asset.match.time))} · ${elev(
      asset.match.ele
    )} · ${formatDelta(asset.match.deltaSeconds)}`;
    inspector.hidden = false;
  }

  function openCluster(paths, markerEl) {
    cycle = paths.map((p) => byPath.get(p)).filter(Boolean);
    cycleIndex = 0;
    if (!cycle.length) return;
    markerEl.classList.add("is-active");
    renderAsset(cycle[0]);
  }

  document.getElementById("lanes").addEventListener("click", (e) => {
    const marker = e.target.closest(".marker");
    if (!marker) return;
    const paths = marker.dataset.cluster.split("|");
    // If same cluster clicked again, cycle through items
    if (marker.classList.contains("is-active") && cycle.length > 1) {
      cycleIndex = (cycleIndex + 1) % cycle.length;
      renderAsset(cycle[cycleIndex]);
      return;
    }
    openCluster(paths, marker);
  });

  closeBtn.addEventListener("click", () => {
    inspector.hidden = true;
    media.innerHTML = "";
    document.querySelectorAll(".marker.is-active").forEach((el) => el.classList.remove("is-active"));
  });
}

async function main() {
  const data = await loadData();
  renderHeader(data);
  setRailWidth(data);
  renderLanes(data);
  renderElevation(data);
  renderTimeAxis(data);
  setupPlayhead();
  setupFilters();
  setupInspector(data);

  // Start near first on-track media
  const scroller = document.getElementById("scroller");
  const first = data.assets.find((a) => a.onTrack) || data.assets[0];
  if (first) {
    const railWidth = document.getElementById("rail").offsetWidth;
    scroller.scrollLeft = Math.max(0, first.progress * railWidth - scroller.clientWidth * 0.25);
  }
}

main().catch((err) => {
  document.getElementById("subtitle").textContent =
    "Could not load data/timeline.json. Run: ruby scripts/build_data.rb";
  console.error(err);
});
