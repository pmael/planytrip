// Turns what the user types ("Madr") into places, using Photon, the OpenStreetMap geocoder built
// for search-as-you-type. Nominatim, the usual choice, only matches whole words: "Madr" finds two
// hamlets in Yemen, not Madrid. Photon's public server is free but asks for fair use, so calls are
// spaced out and cached by the service (server/services/geo.ts).
import type { GeoPlace } from "@/core/types";
import { nearbyAirports } from "./airports";
import { createThrottle } from "./throttle";

const PHOTON_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "trip-manager/0.1 (personal project)";
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 8000;
const RESULT_LIMIT = 5;

/** OSM `place` types that are somewhere you can travel to, not a street, a shop or a country. */
const PLACE_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "municipality",
  "suburb",
  "locality",
  "island",
  "state",
]);

/** The geocoding service could not be reached or answered with an error. */
export class GeocoderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeocoderUnavailableError";
  }
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; country?: string; countrycode?: string; type?: string };
};

function toPlace(feature: PhotonFeature): GeoPlace | null {
  const { name, country, countrycode, type } = feature.properties ?? {};
  const [lon, lat] = feature.geometry?.coordinates ?? [];
  if (!name || !countrycode || !type || !PLACE_TYPES.has(type)) return null;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  return {
    label: country ? `${name}, ${country}` : name,
    countryCode: countrycode.toUpperCase(),
    lat,
    lon,
    airports: nearbyAirports(lat, lon),
  };
}

export type Geocoder = (query: string) => Promise<GeoPlace[]>;

/**
 * Builds a geocoder. Requests are queued so that two are never closer than `minIntervalMs`.
 * `fetch` and the interval can be replaced, which is what the tests do.
 */
export function createGeocoder({
  fetch: fetchImpl = fetch,
  minIntervalMs = MIN_INTERVAL_MS,
}: { fetch?: typeof fetch; minIntervalMs?: number } = {}): Geocoder {
  const throttled = createThrottle(minIntervalMs);

  async function request(query: string): Promise<PhotonFeature[]> {
    const url = new URL(PHOTON_URL);
    url.search = new URLSearchParams({ q: query, lang: "en", limit: "10", osm_tag: "place" }).toString();
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Photon answered ${response.status}`);
      const body = (await response.json()) as { features?: PhotonFeature[] };
      return body.features ?? [];
    } catch (error) {
      throw new GeocoderUnavailableError("The geocoding service is unavailable", { cause: error });
    }
  }

  return (query) =>
    throttled(() => request(query)).then((features) => {
      const places: GeoPlace[] = [];
      for (const feature of features) {
        const place = toPlace(feature);
        // The same town often comes back as a city and as a county or state: keep the first
        if (place && !places.some((other) => other.label === place.label)) places.push(place);
        if (places.length === RESULT_LIMIT) break;
      }
      return places;
    });
}

/** Up to 5 places matching `query`, with the airports within reach of each. */
export const geocode: Geocoder = createGeocoder();
