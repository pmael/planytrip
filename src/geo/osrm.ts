// Asks an OSRM routing server whether (and how far) you can drive between two points.
// The public demo server answers "Ok" even for an island with no road link, by snapping the
// destination to the nearest big road network, possibly thousands of km away. So the snap distance
// is checked: a point that had to be moved too far has no road to it (use-cases.md R1).
import { osrm } from "@/config";
import { createThrottle } from "./throttle";

export type LatLon = { lat: number; lon: number };

export type RoadRoute = { distanceKm: number; durationMin: number };

/** Gives the fastest road route, or null when there is no road between the two points. */
export type RouteFn = (from: LatLon, to: LatLon, options?: { excludeToll?: boolean }) => Promise<RoadRoute | null>;

/** The routing service could not be reached or did not understand the request. */
export class OsrmUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OsrmUnavailableError";
  }
}

type OsrmResponse = {
  code?: string;
  message?: string;
  routes?: { distance: number; duration: number }[];
  /** `distance` is how far, in metres, the point had to be moved to reach a road */
  waypoints?: { distance?: number }[];
};

/**
 * Builds the route function. Requests are spaced out, as the public server asks. `baseUrl`
 * defaults to the OSRM_URL environment variable, then to the public demo server; a self-hosted
 * server is needed for `excludeToll`, the demo rejects every `exclude`.
 */
export function createOsrm({
  fetch: fetchImpl = fetch,
  baseUrl = process.env.OSRM_URL ?? osrm.baseUrl,
  minIntervalMs = osrm.minIntervalMs,
}: { fetch?: typeof fetch; baseUrl?: string; minIntervalMs?: number } = {}): RouteFn {
  const throttled = createThrottle(minIntervalMs);

  async function request(from: LatLon, to: LatLon, excludeToll: boolean): Promise<RoadRoute | null> {
    const url = new URL(`${baseUrl.replace(/\/$/, "")}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}`);
    url.searchParams.set("overview", "false");
    if (excludeToll) url.searchParams.set("exclude", "toll");

    let body: OsrmResponse;
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": "trip-manager/0.1 (personal project)" },
        signal: AbortSignal.timeout(osrm.timeoutMs),
      });
      body = (await response.json().catch(() => ({}))) as OsrmResponse;
      // OSRM explains its 400s in the body ("NoRoute" is one), so read it before judging the status
      if (!response.ok && !body.code) throw new Error(`OSRM answered ${response.status}`);
    } catch (error) {
      throw new OsrmUnavailableError("The routing service is unavailable", { cause: error });
    }

    if (body.code === "NoRoute" || body.code === "NoSegment") return null;
    const route = body.routes?.[0];
    if (body.code !== "Ok" || !route) {
      throw new OsrmUnavailableError(`The routing service refused the request: ${body.code} ${body.message ?? ""}`.trim());
    }

    const snappedFar = body.waypoints?.some((waypoint) => (waypoint.distance ?? 0) > osrm.maxSnapKm * 1000);
    if (snappedFar) return null;
    return { distanceKm: route.distance / 1000, durationMin: route.duration / 60 };
  }

  return (from, to, { excludeToll = false } = {}) => throttled(() => request(from, to, excludeToll));
}

/** The fastest road route between two points, or null when there is no road. */
export const osrmRoute: RouteFn = createOsrm();
