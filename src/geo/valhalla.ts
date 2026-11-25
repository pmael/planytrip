// Routes by car with toll information, which OSRM's public server cannot give: how far the drive
// is, how long it takes, how much of it is on toll roads, and the same drive avoiding tolls.
import { valhalla } from "@/config";
import type { LatLon } from "./osrm";
import { createThrottle } from "./throttle";

export type TollRoute = {
  distanceKm: number;
  durationMin: number;
  /** Km driven on toll roads */
  tollKm: number;
  hasToll: boolean;
};

/** Gives the drive between two points, or null when there is no road. `avoidTolls` asks for the toll-free way. */
export type TollRouteFn = (from: LatLon, to: LatLon, options?: { avoidTolls?: boolean }) => Promise<TollRoute | null>;

/** The routing service could not be reached or did not understand the request. */
export class ValhallaUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ValhallaUnavailableError";
  }
}

/** The drive is longer than the server agrees to route (1,500 km on the public one). Another engine can still try. */
export class RouteTooLongError extends ValhallaUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = "RouteTooLongError";
  }
}

/** Valhalla's error codes for "there is no road": no path between the points, or no road near one of them. */
const NO_ROAD_CODES = new Set([442, 171]);
const TOO_LONG_CODE = 154;

type ValhallaResponse = {
  error_code?: number;
  error?: string;
  trip?: {
    summary?: { length?: number; time?: number; has_toll?: boolean };
    legs?: { maneuvers?: { length?: number; toll?: boolean }[] }[];
  };
};

export function createValhalla({
  fetch: fetchImpl = fetch,
  baseUrl = process.env.VALHALLA_URL ?? valhalla.baseUrl,
  minIntervalMs = valhalla.minIntervalMs,
}: { fetch?: typeof fetch; baseUrl?: string; minIntervalMs?: number } = {}): TollRouteFn {
  const throttled = createThrottle(minIntervalMs);

  async function request(from: LatLon, to: LatLon, avoidTolls: boolean): Promise<TollRoute | null> {
    let body: ValhallaResponse;
    try {
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/route`, {
        method: "POST",
        headers: { "content-type": "application/json", "User-Agent": "trip-manager/0.1 (personal project)" },
        body: JSON.stringify({
          locations: [
            { lat: from.lat, lon: from.lon },
            { lat: to.lat, lon: to.lon },
          ],
          costing: "auto",
          // use_tolls goes from 0 (avoid them) to 1 (do not mind them)
          costing_options: { auto: { use_tolls: avoidTolls ? 0 : 1 } },
          directions_options: { units: "kilometers" },
        }),
        signal: AbortSignal.timeout(valhalla.timeoutMs),
      });
      body = (await response.json().catch(() => ({}))) as ValhallaResponse;
      // Valhalla explains its 400s in the body, so read it before judging the status
      if (!response.ok && body.error_code === undefined) throw new Error(`Valhalla answered ${response.status}`);
    } catch (error) {
      throw new ValhallaUnavailableError("The routing service is unavailable", { cause: error });
    }

    if (body.error_code !== undefined) {
      if (NO_ROAD_CODES.has(body.error_code)) return null;
      if (body.error_code === TOO_LONG_CODE) throw new RouteTooLongError(body.error ?? "Route too long");
      throw new ValhallaUnavailableError(`The routing service refused the request: ${body.error_code} ${body.error ?? ""}`.trim());
    }

    const summary = body.trip?.summary;
    if (summary?.length === undefined || summary.time === undefined) {
      throw new ValhallaUnavailableError("The routing service gave an answer that is not a route");
    }
    const maneuvers = body.trip?.legs?.flatMap((leg) => leg.maneuvers ?? []) ?? [];
    return {
      distanceKm: summary.length,
      durationMin: summary.time / 60,
      tollKm: maneuvers.reduce((km, maneuver) => km + (maneuver.toll ? (maneuver.length ?? 0) : 0), 0),
      hasToll: summary.has_toll ?? false,
    };
  }

  return (from, to, { avoidTolls = false } = {}) => throttled(() => request(from, to, avoidTolls));
}

/** The drive between two points with its tolls, or null when there is no road. */
export const valhallaRoute: TollRouteFn = createValhalla();
