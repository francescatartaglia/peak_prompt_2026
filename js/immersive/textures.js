/**
 * Lightweight texture loading — downscale images; low-res looping video canvases.
 */

import * as THREE from "three";

export const MAX_TEX_SIZE = 192;
export const VIDEO_TEX_SIZE = 176;

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

/**
 * Muted looping video drawn into a small canvas (cheap VideoTexture stand-in).
 */
export function createOptimizedVideo(url, size = VIDEO_TEX_SIZE) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { alpha: false });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    let aspect = 1;
    let playing = false;
    let raf = 0;
    let lastDraw = 0;

    const fail = () => resolve(null);

    const draw = (now) => {
      if (!playing) return;
      raf = requestAnimationFrame(draw);
      if (now - lastDraw < 66) return; // ~15 fps
      lastDraw = now;
      if (video.readyState < 2) return;
      const vw = video.videoWidth || size;
      const vh = video.videoHeight || size;
      aspect = vw / Math.max(vh, 1);
      // letterbox into square-ish canvas keeping aspect
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, size, size);
      let dw = size;
      let dh = size;
      if (aspect > 1) dh = size / aspect;
      else dw = size * aspect;
      ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh);
      texture.needsUpdate = true;
    };

    video.addEventListener("error", fail, { once: true });
    function paintFrame() {
      if (video.readyState < 2) return;
      const vw = video.videoWidth || size;
      const vh = video.videoHeight || size;
      aspect = vw / Math.max(vh, 1);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, size, size);
      let dw = size;
      let dh = size;
      if (aspect > 1) dh = size / aspect;
      else dw = size * aspect;
      ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh);
      texture.needsUpdate = true;
    }

    video.addEventListener(
      "loadeddata",
      () => {
        aspect = (video.videoWidth || 1) / Math.max(video.videoHeight || 1, 1);
        try {
          video.currentTime = 0.05;
        } catch {
          /* ignore */
        }
        paintFrame();
        resolve({
          texture,
          video,
          aspect,
          play() {
            playing = true;
            video.muted = true;
            const p = video.play();
            if (p?.catch) p.catch(() => {});
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(draw);
          },
          pause() {
            playing = false;
            video.pause();
            cancelAnimationFrame(raf);
          },
        });
      },
      { once: true }
    );
    video.addEventListener("seeked", paintFrame, { once: true });
    setTimeout(() => {
      if (video.readyState < 2) fail();
    }, 3500);
  });
}
