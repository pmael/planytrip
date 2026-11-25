// Where a journey arrives at the destination and leaves it again (task.md T8.6): the airport of a flight, the station
// of a train, else the destination itself. The Extra's transfer goes from there to the stay and back.
import type { TransportMode } from "@/core/types";
import { airportLocation } from "./airports";

export type Hub = { name: string; lat: number; lon: number };

type Leg = { from?: { name?: string; lat?: number; lon?: number }; to?: { name?: string; lat?: number; lon?: number } };
type Raw = { pair?: unknown; back?: { flights?: unknown; legs?: Leg[] }; out?: { legs?: Leg[] }; fixture?: boolean };

const point = (stop: Leg["to"]): Hub | null =>
  stop && typeof stop.lat === "number" && typeof stop.lon === "number" ? { name: stop.name ?? "the station", lat: stop.lat, lon: stop.lon } : null;

const airport = (code: unknown): Hub | null => {
  if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) return null;
  const at = airportLocation(code);
  return at ? { name: code, ...at } : null;
};

/**
 * Where a journey arrives (`there`) and where the way back leaves (`back`). A flight: its arrival airport (Google
 * Flights' pair), the way back from the first airport of its return flights. A train: the last station of the way there,
 * the first of the way back. A car, a bus whose stops are not kept, a sample: the destination's airport for a plane, the
 * destination itself otherwise.
 */
export function hubsOf(raw: unknown, mode: TransportMode, destination: { label: string; lat: number; lon: number; airports: string[] }): { there: Hub; back: Hub } {
  const r = (raw ?? {}) as Raw;
  const fallback = (mode === "plane" ? airport(destination.airports[0]) : null) ?? { name: destination.label.split(",")[0], lat: destination.lat, lon: destination.lon };
  if (mode === "plane") {
    const there = airport(Array.isArray(r.pair) ? r.pair[1] : null);
    const backFlight = Array.isArray(r.back?.flights) ? /\b([A-Z]{3})-[A-Z]{3}$/.exec(String(r.back.flights[0]))?.[1] : null;
    return { there: there ?? fallback, back: airport(backFlight) ?? there ?? fallback };
  }
  const outLegs = r.out?.legs ?? [];
  const backLegs = r.back?.legs ?? [];
  const there = point(outLegs[outLegs.length - 1]?.to);
  return { there: there ?? fallback, back: point(backLegs[0]?.from) ?? there ?? fallback };
}
