// Shared domain types for Travel Recap.
// Geometry uses GeoJSON longitude-first order everywhere: [lng, lat].

export type LngLat = [number, number];
export type Id = string; // crypto.randomUUID()
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type TravelMode = "flight" | "drive";
/** The icon shown traveling along a segment. */
export type VehicleType = "plane" | "car" | "train" | "boat" | "walk";

/**
 * Geometry mode for a vehicle type: planes fly curved great-circle arcs;
 * everything else follows a straight line (later: road/sea routing).
 */
export function modeForVehicle(v: VehicleType): TravelMode {
  return v === "plane" ? "flight" : "drive";
}

export interface WaypointPhoto {
  /** URL.createObjectURL handle — must be revoked when the waypoint is removed. */
  objectUrl: string;
  /** Small persisted preview (data URL) so trips survive reloads without the blob. */
  thumbDataUrl?: string;
  source: "exif" | "manual";
  hadGps: boolean;
}

export interface Waypoint {
  id: Id;
  position: LngLat;
  label: string;
  /** ISO timestamp — EXIF DateTimeOriginal or manual. Drives auto-ordering. */
  arrivalTime?: string;
  photo?: WaypointPhoto;
  /** Optional per-stop camera framing for the fly-to animation. */
  cameraHint?: { zoom?: number; pitch?: number; bearing?: number };
}

export type RouteStatus = "pending" | "resolved" | "fallback" | "error";

export interface PathSegment {
  id: Id;
  fromWaypointId: Id;
  toWaypointId: Id;
  mode: TravelMode;
  /** Which icon travels this leg. `mode` is derived from it via modeForVehicle. */
  vehicleType: VehicleType;
  /**
   * Resolved geometry, cached so routing / great-circle math runs once at edit
   * time and never inside the export loop.
   * great-circle points (flight) | OSRM route (drive)
   */
  geometry?: LngLat[];
  routeStatus: RouteStatus;
  /** Animation time allotted to traversing this leg. */
  durationMs: number;
}

export interface Trip {
  id: Id;
  name: string;
  /** Ordered — the source of truth for stop sequence. */
  waypointIds: Id[];
  /** Derived: one segment per adjacent waypoint pair. */
  segmentIds: Id[];
  /** Identifier of the chosen map style (resolved to a spec at render time). */
  mapStyleId: string;
  /** Output aspect ratio; drives preview letterbox + export framing. */
  aspectRatio: AspectRatio;
  createdAt: string;
  updatedAt: string;
}

export type PlaybackStatus = "idle" | "playing" | "paused" | "scrubbing";

export interface PlaybackState {
  status: PlaybackStatus;
  currentTimeMs: number;
  /** Sum of segment durations + per-stop dwell time. */
  totalDurationMs: number;
  playbackRate: number;
}

export type ExportStatus =
  | "idle"
  | "preparing"
  | "encoding"
  | "muxing"
  | "done"
  | "error";

export interface ExportState {
  status: ExportStatus;
  aspectRatio: AspectRatio;
  resolution: { width: number; height: number };
  fps: 30 | 60;
  /** Resolved per browser capability at export time. */
  codec: "h264" | "vp9";
  /** 0..1 */
  progress: number;
  resultUrl?: string;
  /** Gates watermark + resolution caps. */
  isPaidExport: boolean;
}
