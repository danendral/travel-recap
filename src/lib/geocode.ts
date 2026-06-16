import type { LngLat } from "@/types";

export interface GeocodeResult {
  id: string;
  /** Primary name → used as the waypoint label. */
  label: string;
  /** Secondary line, e.g. "California, United States". */
  context: string;
  position: LngLat; // [lng, lat]
  source: "photon" | "nominatim";
}

interface GeocodeOptions {
  /** Map center to bias results toward. */
  bias?: LngLat;
  /** Abort the previous in-flight request on each keystroke. */
  signal?: AbortSignal;
}

/**
 * Forward geocoding (place name → coordinates). Tries Photon (free, no key,
 * good autocomplete); falls back to Nominatim only if Photon fails. Both are
 * OpenStreetMap-based and key-less — matching the "cheap, no-config" thesis.
 */
export async function geocode(
  query: string,
  opts: GeocodeOptions = {},
): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    return await photon(q, opts);
  } catch (err) {
    if (opts.signal?.aborted) throw err; // genuine cancel — propagate
    try {
      return await nominatim(q, opts);
    } catch {
      return [];
    }
  }
}

async function photon(
  q: string,
  { bias, signal }: GeocodeOptions,
): Promise<GeocodeResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");
  if (bias) {
    url.searchParams.set("lon", String(bias[0]));
    url.searchParams.set("lat", String(bias[1]));
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as {
    features?: Array<{
      geometry: { coordinates: [number, number] };
      properties: Record<string, string>;
    }>;
  };

  return (data.features ?? []).map((f, i) => {
    const p = f.properties;
    const context = [p.city, p.state, p.country]
      .filter((v) => v && v !== p.name)
      .join(", ");
    return {
      id: p.osm_id ? `photon-${p.osm_id}` : `photon-${i}`,
      label: p.name ?? p.city ?? p.country ?? q,
      context,
      position: [f.geometry.coordinates[0], f.geometry.coordinates[1]],
      source: "photon" as const,
    };
  });
}

async function nominatim(
  q: string,
  { signal }: GeocodeOptions,
): Promise<GeocodeResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  // Note: lat/lon are STRINGS and in lat,lon order — convert to [lng, lat].
  const data = (await res.json()) as Array<{
    place_id: number;
    lat: string;
    lon: string;
    display_name: string;
    name?: string;
  }>;

  return data.map((r) => {
    const [label, ...rest] = r.display_name.split(", ");
    return {
      id: `nominatim-${r.place_id}`,
      label: r.name || label,
      context: rest.join(", "),
      position: [parseFloat(r.lon), parseFloat(r.lat)],
      source: "nominatim" as const,
    };
  });
}
