import type { LngLat } from "@/types";

/**
 * Renders a small static preview of a route onto an offscreen canvas and
 * returns a PNG data URL. This is a lightweight stylized render (route polyline
 * + stop dots on a dark gradient) — NOT a real map snapshot — so it's fast,
 * deterministic, and needs no second GL context per card. A real map snapshot
 * can replace this later behind the same `useTripThumbnail` interface.
 *
 * `line` is the whole-route polyline from `buildRouteLine` (GeoJSON [lng,lat]).
 */
export function renderRouteThumbnail(
  line: LngLat[],
  opts: { width?: number; height?: number } = {},
): string {
  const width = opts.width ?? 320;
  const height = opts.height ?? 180;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background: subtle dark gradient (matches the app's slate palette).
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#0f172a");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (line.length < 2) {
    return canvas.toDataURL("image/png");
  }

  // Project the route into the canvas with padding, preserving aspect.
  const pad = 22;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lng, lat] of line) {
    minX = Math.min(minX, lng); maxX = Math.max(maxX, lng);
    minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  }
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const project = ([lng, lat]: LngLat): [number, number] => [
    offX + (lng - minX) * scale,
    // Flip Y: latitude increases upward, canvas Y increases downward.
    height - (offY + (lat - minY) * scale),
  ];

  const pts = line.map(project);

  // Glow underlay.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(56,189,248,0.25)";
  ctx.lineWidth = 7;
  strokePath(ctx, pts);

  // Bright dashed route.
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2.5;
  strokePath(ctx, pts);
  ctx.setLineDash([]);

  // Endpoint stop dots.
  for (const idx of [0, pts.length - 1]) {
    const [x, y] = pts[idx];
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#0ea5e9";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  return canvas.toDataURL("image/png");
}

function strokePath(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}
