/**
 * Lightweight GPX 1.1 parser → track points with lat/lon/ele/time.
 */
export function parseGpx(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid GPX XML");
  }

  const name =
    doc.querySelector("metadata > name")?.textContent?.trim() ||
    doc.querySelector("trk > name")?.textContent?.trim() ||
    "Track";

  const description =
    doc.querySelector("trk > desc")?.textContent?.trim() ||
    doc.querySelector("trk > cmt")?.textContent?.trim() ||
    "";

  const points = [...doc.querySelectorAll("trkpt")].map((pt) => {
    const timeText = pt.querySelector("time")?.textContent;
    return {
      lat: Number(pt.getAttribute("lat")),
      lon: Number(pt.getAttribute("lon")),
      ele: Number(pt.querySelector("ele")?.textContent ?? 0),
      time: timeText ? new Date(timeText) : null,
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.time);

  if (!points.length) throw new Error("No timed track points in GPX");

  const start = points[0].time;
  const end = points[points.length - 1].time;
  const spanMs = Math.max(end - start, 1);
  const elevations = points.map((p) => p.ele);

  const withProgress = points.map((p, index) => ({
    ...p,
    index,
    progress: (p.time - start) / spanMs,
  }));

  return {
    name: name.replace(/^Wikiloc - /, ""),
    description,
    points: withProgress,
    start,
    end,
    durationMinutes: (spanMs / 60000),
    elevation: {
      min: Math.min(...elevations),
      max: Math.max(...elevations),
      gain: Math.max(...elevations) - Math.min(...elevations),
    },
  };
}

export async function loadGpx(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load GPX: ${url}`);
  return parseGpx(await res.text());
}
