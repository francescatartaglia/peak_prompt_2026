const DATA_URL = "data/hike_viz.json";

const fmtTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const state = {
  data: null,
  map: null,
  scrubMarker: null,
  mediaLayer: null,
  mediaMarkers: [],
  chart: NoneSafe(),
  activeMediaId: null,
  filter: "all",
};

function NoneSafe() {
  return null;
}

async function boot() {
  const data = await fetch(DATA_URL).then((r) => {
    if (!r.ok) throw new Error("Missing data/hike_viz.json — run: python3 scripts/process_hike_viz.py");
    return r.json();
  });
  state.data = data;

  document.getElementById("title").textContent = shortTitle(data.title);
  renderStats(data);
  renderZones(data);
  initMap(data);
  initChart(data);
  bindFilters();
  bindInspector();

  document.getElementById("loader").classList.add("is-done");
}

function shortTitle(title) {
  if (!title) return "Lagazuoi hike";
  if (title.includes("Lagazuoi")) return "Rifugio Lagazuoi";
  return title.split(" - ")[0];
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

function zoneLabel(zone, zones) {
  if (!zone || !zones[zone]) return "—";
  return `${zones[zone].label} · ${zones[zone].range}`;
}

function renderStats(data) {
  const s = data.stats;
  const items = [
    ["Distance", `${s.distance_km.toFixed(2)} km`],
    ["Duration", formatDuration(s.duration_minutes)],
    ["Elev gain", `${Math.round(s.elevation_gain_m)} m`],
    ["Altitude", `${Math.round(s.elevation_min_m)}–${Math.round(s.elevation_max_m)} m`],
    ["Avg HR", `${Math.round(s.hr_avg)} bpm`],
    ["HR range", `${Math.round(s.hr_min)}–${Math.round(s.hr_max)}`],
  ];
  document.getElementById("stats").innerHTML = items
    .map(
      ([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`
    )
    .join("");
}

function renderZones(data) {
  const root = document.getElementById("zones");
  root.innerHTML = `<p class="section-label">Time in HR zones</p>`;
  Object.values(data.zoneStats)
    .sort((a, b) => a.id - b.id)
    .forEach((z) => {
      const row = document.createElement("div");
      row.className = "zone-row";
      row.innerHTML = `
        <span class="zone-swatch" style="color:${z.color};background:${z.color}"></span>
        <div>
          <strong>${z.label}</strong>
          <div class="zone-meta">${z.range}</div>
        </div>
        <div>${z.minutes} min · ${z.percent}%</div>
        <div class="zone-bar"><span style="width:${z.percent}%;background:${z.color}"></span></div>
      `;
      root.appendChild(row);
    });
}

function initMap(data) {
  const map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  }).addTo(map);

  // Color-coded HR zone segments
  const latLngs = [];
  for (let i = 0; i < data.track.length - 1; i += 1) {
    const a = data.track[i];
    const b = data.track[i + 1];
    const zone = a.zone || b.zone || 1;
    const color = data.zones[zone]?.color || "#999";
    const segment = [
      [a.lat, a.lon],
      [b.lat, b.lon],
    ];
    L.polyline(segment, {
      color,
      weight: 6,
      opacity: 0.92,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);
    latLngs.push([a.lat, a.lon]);
  }
  const last = data.track[data.track.length - 1];
  latLngs.push([last.lat, last.lon]);

  // Start / end
  L.circleMarker([data.track[0].lat, data.track[0].lon], {
    radius: 7,
    color: "#fff",
    weight: 2,
    fillColor: "#c4a574",
    fillOpacity: 1,
  }).addTo(map).bindPopup("<strong>Start</strong><br/>Pian Falzarego");
  L.circleMarker([last.lat, last.lon], {
    radius: 7,
    color: "#fff",
    weight: 2,
    fillColor: "#7eb6c9",
    fillOpacity: 1,
  }).addTo(map).bindPopup("<strong>End</strong><br/>Rifugio Lagazuoi");

  state.scrubMarker = L.marker([data.track[0].lat, data.track[0].lon], {
    interactive: false,
    icon: L.divIcon({ className: "", html: '<div class="scrub-marker"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
  }).addTo(map);

  state.mediaLayer = L.layerGroup().addTo(map);
  renderMediaMarkers(data);

  map.fitBounds(latLngs, { padding: [36, 36] });
  state.map = map;
}

function mediaIcon(kind, active = false) {
  const glyph = kind === "audio" ? "♪" : kind === "video" ? "▶" : "◉";
  return L.divIcon({
    className: "",
    html: `<div class="media-marker ${kind}${active ? " is-active" : ""}">${glyph}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function renderMediaMarkers(data) {
  state.mediaLayer.clearLayers();
  state.mediaMarkers = [];

  // Cluster visually by skipping exact duplicates of lat/lon for density — keep all clickable via slight jitter index
  const jittered = new Map();
  data.media.forEach((asset) => {
    if (state.filter !== "all" && asset.kind !== state.filter) return;
    const key = `${asset.lat.toFixed(5)},${asset.lon.toFixed(5)}`;
    const n = jittered.get(key) || 0;
    jittered.set(key, n + 1);
    const offset = n * 0.000018;
    const lat = asset.lat + offset;
    const lon = asset.lon + (n % 2 === 0 ? offset : -offset);

    const marker = L.marker([lat, lon], {
      icon: mediaIcon(asset.kind, asset.id === state.activeMediaId),
      riseOnHover: true,
    });
    marker.bindPopup(
      `<strong>${escapeHtml(asset.id)}</strong><br/>${asset.kind} · ${fmtTime.format(new Date(asset.time))}<br/>HR ${asset.bpm ?? "—"} bpm · Zone ${asset.zone ?? "—"}`
    );
    marker.on("click", () => openMedia(asset, true));
    marker.assetId = asset.id;
    marker.addTo(state.mediaLayer);
    state.mediaMarkers.push(marker);
  });
}

function bindFilters() {
  document.querySelectorAll(".filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("is-active", b === btn));
      state.filter = btn.dataset.kind;
      renderMediaMarkers(state.data);
    });
  });
}

function bindInspector() {
  document.getElementById("inspector-close").addEventListener("click", () => {
    closeInspector();
  });
}

function openMedia(asset, fromMap = false) {
  state.activeMediaId = asset.id;
  const panel = document.getElementById("inspector");
  const media = document.getElementById("inspector-media");
  media.innerHTML = "";

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

  document.getElementById("inspector-kind").textContent = `${asset.kind} · ${asset.source || "media"}`;
  document.getElementById("inspector-title").textContent = asset.id;
  document.getElementById("inspector-meta").textContent =
    `${fmtTime.format(new Date(asset.time))} · ${Math.round(asset.ele)} m · Δ ${Math.round(asset.delta_s)}s from track`;
  document.getElementById("inspector-hr").textContent =
    `Heart rate ${asset.bpm ?? "—"} bpm · ${zoneLabel(asset.zone, state.data.zones)}`;
  panel.hidden = false;

  // Move scrubber to this track point
  moveScrubToIndex(asset.trackIndex, { pan: fromMap });
  highlightChartIndex(asset.trackIndex);
  renderMediaMarkers(state.data);
}

function closeInspector() {
  document.getElementById("inspector").hidden = true;
  document.getElementById("inspector-media").innerHTML = "";
  state.activeMediaId = null;
  renderMediaMarkers(state.data);
}

function moveScrubToIndex(index, { pan = false } = {}) {
  const pt = state.data.track[index];
  if (!pt || !state.scrubMarker) return;
  state.scrubMarker.setLatLng([pt.lat, pt.lon]);
  if (pan) state.map.panTo([pt.lat, pt.lon], { animate: true, duration: 0.4 });
  updateReadout(index);
}

function nearestMediaAtIndex(index) {
  return state.data.media.find((m) => m.trackIndex === index) || null;
}

function updateReadout(index) {
  const pt = state.data.track[index];
  if (!pt) return;
  const media = nearestMediaAtIndex(index);
  document.getElementById("chart-readout").innerHTML = `
    ${fmtTime.format(new Date(pt.time))}<br/>
    ${Math.round(pt.bpm)} bpm · Z${pt.zone} · ${Math.round(pt.ele)} m
    ${media ? `<br/><span style="color:var(--sand)">${escapeHtml(media.id)}</span>` : ""}
  `;
}

function initChart(data) {
  const labels = data.track.map((p) => fmtTime.format(new Date(p.time)));
  const hr = data.track.map((p) => p.bpm);
  const elev = data.track.map((p) => p.ele);
  const zoneColors = data.track.map((p) => data.zones[p.zone]?.color || "#888");

  const ctx = document.getElementById("profileChart");
  const chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "line",
          label: "Heart rate",
          data: hr,
          yAxisID: "y",
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          tension: 0.25,
          segment: {
            borderColor: (ctx) => zoneColors[ctx.p0DataIndex] || "#c4a574",
          },
          borderColor: "#c4a574",
          backgroundColor: "transparent",
        },
        {
          type: "line",
          label: "Elevation",
          data: elev,
          yAxisID: "y1",
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 0,
          tension: 0.25,
          borderColor: "rgba(126, 182, 201, 0.85)",
          backgroundColor: "rgba(126, 182, 201, 0.12)",
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#93a4ae", boxWidth: 12, font: { family: "Sora", size: 11 } },
        },
        tooltip: {
          callbacks: {
            afterBody(items) {
              const i = items[0]?.dataIndex ?? 0;
              const pt = data.track[i];
              const media = nearestMediaAtIndex(i);
              const lines = [`Zone ${pt.zone} · ${Math.round(pt.distance_m)} m along route`];
              if (media) lines.push(`Media: ${media.id}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: "#93a4ae",
            maxTicksLimit: 8,
            font: { family: "Sora", size: 10 },
          },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
        y: {
          position: "left",
          title: { display: true, text: "bpm", color: "#93a4ae" },
          ticks: { color: "#93a4ae" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y1: {
          position: "right",
          title: { display: true, text: "m", color: "#93a4ae" },
          ticks: { color: "#93a4ae" },
          grid: { drawOnChartArea: false },
        },
      },
      onHover: (evt, elements) => {
        if (!elements.length) return;
        const index = elements[0].index;
        moveScrubToIndex(index);
        const media = nearestMediaAtIndex(index);
        if (media) {
          // Soft highlight only — don't auto-open to avoid flicker
          document.getElementById("chart-hint").textContent = `Near media: ${media.id}`;
        } else {
          document.getElementById("chart-hint").textContent = "Hover the chart to scrub the route";
        }
      },
    },
  });

  // Click chart → open nearest media if any
  ctx.onclick = (evt) => {
    const points = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
    if (!points.length) return;
    const index = points[0].index;
    const media = nearestMediaAtIndex(index);
    moveScrubToIndex(index, { pan: true });
    if (media) openMedia(media, true);
  };

  state.chart = chart;
}

function highlightChartIndex(index) {
  if (!state.chart) return;
  // Chart.js v4: set active elements
  const meta0 = state.chart.getDatasetMeta(0);
  if (!meta0?.data?.[index]) return;
  state.chart.setActiveElements([
    { datasetIndex: 0, index },
    { datasetIndex: 1, index },
  ]);
  state.chart.tooltip.setActiveElements(
    [
      { datasetIndex: 0, index },
      { datasetIndex: 1, index },
    ],
    { x: 0, y: 0 }
  );
  state.chart.update();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

boot().catch((err) => {
  console.error(err);
  document.querySelector(".loader h2").textContent = err.message || "Failed to load";
});
