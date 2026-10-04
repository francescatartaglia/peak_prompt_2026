#!/usr/bin/env bash
# Downscale/compress assets/media for GitHub Pages.
# Images & videos: long side max 1024px. Audio: AAC recompress.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEDIA="$ROOT/assets/media"
MAX=1024
JPG_QUALITY=82

export PATH="${HOME}/.local/homebrew/bin:${HOME}/.local/media-tools/bin:${PATH}"
if [ -x "${HOME}/.local/homebrew/bin/brew" ]; then
  eval "$("${HOME}/.local/homebrew/bin/brew" shellenv)"
fi

command -v magick >/dev/null || { echo "magick (ImageMagick) not found"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg not found"; exit 1; }

echo "==> Tools"
magick -version | head -1
ffmpeg -version | head -1
echo "==> Before: $(du -sh "$MEDIA" | awk '{print $1}')"

process_image() {
  local src="$1"
  local tmp="${src}.__tmp__"
  # Resize only if larger; strip metadata; JPEG quality
  magick "$src" -auto-orient -resize "${MAX}x${MAX}>" -strip -quality "$JPG_QUALITY" "$tmp"
  mv -f "$tmp" "$src"
}

process_video() {
  local src="$1"
  local tmp="${src}.__tmp__.mp4"
  # scale so long side <= MAX; H.264 + AAC; faststart for web
  ffmpeg -y -nostdin -hide_banner -loglevel error -i "$src" \
    -vf "scale=${MAX}:${MAX}:force_original_aspect_ratio=decrease" \
    -c:v libx264 -preset medium -crf 28 -pix_fmt yuv420p \
    -c:a aac -b:a 96k -ac 2 \
    -movflags +faststart \
    "$tmp"
  # Keep original extension (MOV/mp4) so timeline paths stay valid
  mv -f "$tmp" "$src"
}

process_audio() {
  local src="$1"
  local tmp="${src}.__tmp__.m4a"
  ffmpeg -y -nostdin -hide_banner -loglevel error -i "$src" \
    -c:a aac -b:a 96k -ac 1 \
    "$tmp"
  mv -f "$tmp" "$src"
}

echo "==> Images (JPG/JPEG/PNG)…"
img_count=0
while IFS= read -r -d '' f; do
  process_image "$f"
  img_count=$((img_count + 1))
  printf "\r    %d images" "$img_count"
done < <(find "$MEDIA" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0)
echo
echo "    done: $img_count images"

echo "==> Videos (MP4/MOV)…"
vid_count=0
while IFS= read -r -d '' f; do
  process_video "$f"
  vid_count=$((vid_count + 1))
  printf "\r    %d videos" "$vid_count"
done < <(find "$MEDIA" -type f \( -iname '*.mp4' -o -iname '*.mov' \) -print0)
echo
echo "    done: $vid_count videos"

echo "==> Audio (M4A)…"
aud_count=0
while IFS= read -r -d '' f; do
  process_audio "$f"
  aud_count=$((aud_count + 1))
  printf "\r    %d audio" "$aud_count"
done < <(find "$MEDIA" -type f -iname '*.m4a' -print0)
echo
echo "    done: $aud_count audio"

# Clean Apple junk
find "$MEDIA" -name '.DS_Store' -delete 2>/dev/null || true

echo "==> After: $(du -sh "$MEDIA" | awk '{print $1}')"
echo "==> Sample checks"
magick identify "$(find "$MEDIA/camera" -iname '*.JPG' | head -1)" || true
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 \
  "$(find "$MEDIA/phone/web" -iname '*.mp4' | head -1)" || true
echo "OK"
