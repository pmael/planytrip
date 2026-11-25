// Finds a named place (a museum, a beach, a lake, a club) near a destination, with Photon, the OpenStreetMap search the
// app already uses for cities (geocode.ts). The things to do the AI lists are looked up with it: one the map cannot find
// near the destination is left out (task.md T8.4). Photon asks for fair use: calls are spaced out.
import { createThrottle } from "./throttle";
import { distanceKm } from "./airports";
import { GeocoderUnavailableError } from "./geocode";

const PHOTON_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "trip-manager/0.1 (personal project)";
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 8000;

export type FoundPlace = { name: string; lat: number; lon: number; distanceKm: number };

/** The best match for that name within `maxKm` of `near` (not a sign or a stop), or null. Throws GeocoderUnavailableError when Photon cannot be asked. */
export type PlaceFinder = (query: string, near: { lat: number; lon: number }, maxKm: number) => Promise<FoundPlace | null>;

type PhotonFeature = { geometry?: { coordinates?: [number, number] }; properties?: { name?: string; osm_key?: string; osm_value?: string } };

/**
 * A sign or a stop named after a place is not the place: a signpost to the Cirque du Fer-à-Cheval stands 30 km from it,
 * near Bonneville, and came first (2026-11-14)
 */
const NOT_THE_PLACE = new Set(["board", "guidepost", "map", "route_marker", "bus_stop", "platform", "stop_position", "stop"]);
const isThePlace = (feature: PhotonFeature) => {
  const { osm_key: key, osm_value: value } = feature.properties ?? {};
  return key !== "information" && key !== "public_transport" && !(key === "tourism" && value === "information") && !NOT_THE_PLACE.has(value ?? "");
};

export function createPlaceFinder({ fetch: fetchImpl = fetch, minIntervalMs = MIN_INTERVAL_MS }: { fetch?: typeof fetch; minIntervalMs?: number } = {}): PlaceFinder {
  const throttled = createThrottle(minIntervalMs);

  return (query, near, maxKm) =>
    throttled(async () => {
      const url = new URL(PHOTON_URL);
      // Photon puts what is near the given point first
      url.search = new URLSearchParams({ q: query, lat: String(near.lat), lon: String(near.lon), limit: "8", lang: "en" }).toString();
      let features: PhotonFeature[];
      try {
        const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) throw new Error(`Photon answered ${response.status}`);
        features = ((await response.json()) as { features?: PhotonFeature[] }).features ?? [];
      } catch (error) {
        throw new GeocoderUnavailableError("The map search is unavailable", { cause: error });
      }
      const found = features.filter(isThePlace).flatMap((feature): FoundPlace[] => {
        const [lon, lat] = feature.geometry?.coordinates ?? [];
        if (typeof lat !== "number" || typeof lon !== "number") return [];
        return [{ name: feature.properties?.name ?? query, lat, lon, distanceKm: distanceKm(near.lat, near.lon, lat, lon) }];
      });
      // Photon's own order: the best match, already favouring what is near
      return found.find((place) => place.distanceKm <= maxKm) ?? null;
    });
}

export const findPlace: PlaceFinder = createPlaceFinder();
