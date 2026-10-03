import { loadGpx } from "./gpx.js";
import { createProjector } from "./geo.js";
import { createScene } from "./scene.js";
import { bindUI } from "./ui.js";

const GPX_URL = "assets/peak_prompt.gpx";
const DATA_URL = "data/timeline.json";

async function boot() {
  const canvas = document.getElementById("scene");
  const loader = document.getElementById("loader");

  try {
    const [track, catalog] = await Promise.all([
      loadGpx(GPX_URL),
      fetch(DATA_URL).then((r) => {
        if (!r.ok) throw new Error("Missing data/timeline.json — run ruby scripts/build_data.rb");
        return r.json();
      }),
    ]);

    const world = createProjector(track.points);
    // Keep progress/time from GPX parse on projected points
    world.points = world.points.map((p, i) => ({
      ...p,
      progress: track.points[i].progress,
      time: track.points[i].time,
      ele: track.points[i].ele,
      index: i,
    }));

    const assets = normalizeAssets(catalog.assets, track);
    const sceneApi = createScene(canvas, world);
    sceneApi.setMarkers(assets);

    const ui = bindUI({ track, assets, sceneApi });

    loader.classList.add("is-done");

    // Render loop
    const loop = (now) => {
      ui.tickPlay(now);
      sceneApi.tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // Expose for debugging in console
    window.__lagazuoi = { track, assets, world, sceneApi };
  } catch (err) {
    console.error(err);
    loader.querySelector("p.mt-2").textContent = err.message || "Failed to start experience";
  }
}

function normalizeAssets(rawAssets, track) {
  const start = track.start.getTime();
  const span = Math.max(track.end - track.start, 1);

  return rawAssets.map((asset) => {
    const time = new Date(asset.time);
    let progress = asset.progress;
    if (progress == null || Number.isNaN(progress)) {
      progress = (time - start) / span;
    }
    // Clamp soft edges for off-track items
    const matchIndex = clamp(
      asset.match?.index ?? nearestIndex(track.points, progress),
      0,
      track.points.length - 1
    );
    return {
      ...asset,
      time: time.toISOString(),
      progress,
      match: {
        ...asset.match,
        index: matchIndex,
        ele: asset.match?.ele ?? track.points[matchIndex].ele,
        deltaSeconds: asset.match?.deltaSeconds ?? 0,
      },
    };
  });
}

function nearestIndex(points, progress) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const d = Math.abs(points[i].progress - progress);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function clamp(n, a, b) {
  return Math.min(Math.max(n, a), b);
}

boot();
