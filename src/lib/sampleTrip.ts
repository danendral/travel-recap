import type { LngLat, VehicleType } from "@/types";

/**
 * The first-run demo trip: a short, iconic, MULTI-MODE route that shows off
 * flights, a train, AND a road-snapped drive at once and looks impressive
 * immediately. Coordinates are [lng, lat] (GeoJSON order). Seeded once so a
 * brand-new user lands in a playable trip and can hit Play in two seconds.
 *
 * Route: Tokyo ✈ Seoul ✈ Beijing (two great-circle flight arcs across the
 * sea), Beijing 🚆 Tianjin (a high-speed-rail hop), then Tianjin 🚗 Langfang
 * (a short drive that snaps to real roads — demonstrating the routing). A
 * compact tour that exercises every visual treatment in one clip.
 */
export interface SampleStop {
  label: string;
  position: LngLat;
}

export const SAMPLE_TRIP: {
  name: string;
  stops: SampleStop[];
  /** One per segment (stops.length - 1 entries). */
  vehicles: VehicleType[];
} = {
  name: "Tokyo → Beijing sampler",
  stops: [
    { label: "Tokyo", position: [139.6917, 35.6895] },
    { label: "Seoul", position: [126.978, 37.5665] },
    { label: "Beijing", position: [116.4074, 39.9042] },
    { label: "Tianjin", position: [117.1901, 39.1252] },
    { label: "Langfang", position: [116.6839, 39.5196] },
  ],
  // Tokyo→Seoul ✈ · Seoul→Beijing ✈ · Beijing→Tianjin 🚆 · Tianjin→Langfang 🚗
  vehicles: ["plane", "plane", "train", "car"],
};
