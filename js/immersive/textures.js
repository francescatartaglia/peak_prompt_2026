/**
 * Texture ottimizzate: foto a buona risoluzione; video loop muti.
 */

import * as THREE from "three";

export const MAX_TEX_SIZE = 384;
export const VIDEO_TEX_SIZE = 320;

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Draw source into a capped canvas → CanvasTexture. */
export function canvasTextureFromImage(img, maxSize = MAX_TEX_SIZE) {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.min(1, maxSize / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return { texture: tex, width: w, height: h, aspect: w / h };
}

export async function loadOptimizedImageTexture(url, maxSize = MAX_TEX_SIZE) {
  try {
    const img = await loadImageElement(url);
    return canvasTextureFromImage(img, maxSize);
  } catch {
    return null;
  }
}

export function makePlaceholderTexture(kind = "image") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a3a3a";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, 108, 108);
  ctx.fillStyle = "#bbb";
  ctx.font = "600 36px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(kind === "video" ? "▶" : "◇", 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return { texture: tex, width: 128, height: 128, aspect: 1 };
}

/** Preferisce MP4 web-friendly se il path punta a un .MOV. */
async function resolvePlayableUrl(url) {
  if (!/\.mov$/i.test(url)) return url;
  const candidates = [
    url.replace(/\.mov$/i, ".mp4"),
    url.replace(/phone\//i, "phone/web/").replace(/\.mov$/i, ".mp4"),
  ];
  for (const c of candidates) {
    try {
      const res = await fetch(c, { method: "HEAD" });
      if (res.ok) return c;
    } catch {
      /* next */
    }
  }
  return url;
}

/**
 * Video in loop, sempre muto, autoplay. Texture nativa.
 * Usa MP4 H.264 (i .MOV iPhone/HEVC non partono in Chrome).
 */
export async function createOptimizedVideo(url) {
  const playable = await resolvePlayableUrl(url);

  return new Promise((resolve) => {
    const video = document.createElement("video");
    // Fuori schermo ma nel DOM: aiuta autoplay su alcuni browser
    video.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;top:-9999px";
    document.body.appendChild(video);

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.loop = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("muted", "");
    video.setAttribute("loop", "");
    video.setAttribute("autoplay", "");
    video.preload = "auto";
    // niente crossOrigin su same-origin: evita errori inutili
    video.src = playable;

    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      video.remove();
      resolve(null);
    };

    const tryPlay = () => {
      video.muted = true;
      video.defaultMuted = true;
      video.volume = 0;
      video.loop = true;
      const p = video.play();
      if (p?.catch) p.catch(() => {});
    };

    video.addEventListener("ended", () => {
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      tryPlay();
    });

    const ready = () => {
      if (settled) return;
      settled = true;
      const aspect =
        (video.videoWidth || 1) / Math.max(video.videoHeight || 1, 1);

      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      tryPlay();

      resolve({
        texture,
        video,
        aspect,
        play: tryPlay,
        pause() {
          video.pause();
        },
      });
    };

    video.addEventListener("error", fail, { once: true });
    video.addEventListener("loadeddata", ready, { once: true });
    video.addEventListener("canplay", tryPlay);

    // kick load
    video.load();

    setTimeout(() => {
      if (!settled) {
        if (video.readyState >= 2) ready();
        else fail();
      }
    }, 12000);
  });
}
