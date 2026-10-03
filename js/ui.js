const fmtTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function bindUI(ctx) {
  const {
    track,
    assets,
    sceneApi,
  } = ctx;

  // Header stats
  document.getElementById("route-subtitle").textContent =
    track.description?.split("\n")[0] ||
    "3D GPX trail with photos, video, and audio synced by timestamp.";
  document.getElementById("stat-duration").textContent = formatDuration(track.durationMinutes);
  document.getElementById("stat-altitude").textContent =
    `${Math.round(track.elevation.min)}–${Math.round(track.elevation.max)} m`;
  document.getElementById("stat-assets").textContent = String(assets.length);

  // Filters
  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
      sceneApi.setFilter(btn.dataset.filter);
    });
  });

  document.getElementById("btn-overview").addEventListener("click", () => {
    sceneApi.setFollow(false);
    document.getElementById("btn-follow").classList.remove("is-active");
    sceneApi.setOverviewCamera();
  });

  document.getElementById("btn-follow").addEventListener("click", (e) => {
    const on = !sceneApi.followEnabled;
    sceneApi.setFollow(on);
    e.currentTarget.classList.toggle("is-active", on);
  });

  // Tooltip + picking
  const tooltip = document.getElementById("tooltip");
  const tooltipTitle = document.getElementById("tooltip-title");
  const tooltipMeta = document.getElementById("tooltip-meta");
  const canvas = document.getElementById("scene");

  canvas.addEventListener("pointermove", (e) => {
    const asset = sceneApi.pick(e.clientX, e.clientY);
    if (!asset) {
      tooltip.classList.add("hidden");
      canvas.style.cursor = "grab";
      return;
    }
    canvas.style.cursor = "pointer";
    tooltip.classList.remove("hidden");
    tooltip.style.left = `${e.clientX + 14}px`;
    tooltip.style.top = `${e.clientY + 14}px`;
    tooltipTitle.textContent = asset.id;
    tooltipMeta.textContent = `${asset.kind} · ${fmtTime.format(new Date(asset.time))} · ${Math.round(asset.match.ele)} m`;
  });

  canvas.addEventListener("click", (e) => {
    const asset = sceneApi.pick(e.clientX, e.clientY);
    if (!asset) return;
    openInspector(asset);
    sceneApi.flyToMedia(asset);
    // Sync scrubber to asset progress
    const scrubber = document.getElementById("scrubber");
    scrubber.value = String(Math.round(clamp(asset.progress, 0, 1) * 1000));
    scrubber.dispatchEvent(new Event("input"));
  });

  // Inspector
  document.getElementById("inspector-close").addEventListener("click", closeInspector);

  // Scrubber + play
  const scrubber = document.getElementById("scrubber");
  const scrubTime = document.getElementById("scrub-time");
  const scrubElev = document.getElementById("scrub-elev");
  const playIcon = document.getElementById("play-icon");
  let playing = false;
  let lastTs = 0;

  function applyProgress(progress) {
    const { point } = sceneApi.followProgress(progress);
    scrubTime.textContent = fmtTime.format(point.time);
    scrubElev.textContent = `${Math.round(point.ele)} m`;
  }

  scrubber.addEventListener("input", () => {
    const progress = Number(scrubber.value) / 1000;
    applyProgress(progress);
  });

  document.getElementById("btn-play").addEventListener("click", () => {
    playing = !playing;
    playIcon.textContent = playing ? "❚❚" : "▶";
    if (playing) sceneApi.setFollow(true);
    lastTs = performance.now();
  });

  function tickPlay(now) {
    if (playing) {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      // Full hike in ~90s of playback
      const next = Math.min(Number(scrubber.value) / 1000 + dt / 90, 1);
      scrubber.value = String(Math.round(next * 1000));
      applyProgress(next);
      if (next >= 1) {
        playing = false;
        playIcon.textContent = "▶";
      }
    } else {
      lastTs = now;
    }
  }

  // Initial scrub position
  applyProgress(0);

  return { tickPlay, openInspector, closeInspector };
}

function openInspector(asset) {
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
    `${fmtTime.format(new Date(asset.time))}${asset.duration ? ` · ${asset.duration.toFixed(1)}s` : ""}`;
  document.getElementById("inspector-match").textContent =
    `Matched GPX · ${Math.round(asset.match.ele)} m · Δ ${Math.round(asset.match.deltaSeconds)}s`;
  panel.classList.remove("hidden");
}

function closeInspector() {
  const panel = document.getElementById("inspector");
  const media = document.getElementById("inspector-media");
  media.innerHTML = "";
  panel.classList.add("hidden");
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m} min`;
}

function clamp(n, a, b) {
  return Math.min(Math.max(n, a), b);
}
