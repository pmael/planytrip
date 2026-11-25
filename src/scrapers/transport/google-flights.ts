// Google Flights (task.md T7.2): the flights between a guest's home airports and the destination's, for
// the dates of the stay, with what a round trip costs.
//
// How it works, and why:
// - Google Flights shows each outbound flight with the price of the round trip it belongs to (the
//   cheapest way back included). That is the price kept, for one adult in economy, in euros.
// - The way back is learnt by choosing the first outbound the way a person would: Google then lists
//   the flights back. Each outbound is paired with the same airline's flight back when there is one,
//   else the cheapest. (An exact pairing for each outbound would be one more page per flight.)
// - A place with several airports (Paris) is searched airport pair by airport pair, a few at most.
// - What Google answered is kept for a day, so that a recomputation does not ask again.
import { cacheTtlMs, googleFlights, lastMile } from "@/config";
import { airportLocation, distanceKm } from "@/geo/airports";
import { noCache } from "../cache";
import { ScrapeChangedError, ScrapeError } from "../errors";
import type { TransportAdapter, TransportOptionInput, TransportQuery } from "../types";
import { chromeFlightsDriver, type FlightsDriver } from "./google-flights-chrome";
import { parseFlightLabels, parseShoppingResults, type Flight } from "./google-flights-parse";

/** The tunable numbers of the search (config.googleFlights) */
export type GoogleFlightsSettings = {
  baseUrl: string;
  language: string;
  region: string;
  currency: string;
  maxAirportPairs: number;
  maxOptions: number;
  answerTimeoutMs: number;
};

const SOURCE = "google-flights";

/** The address of a round trip search: Google reads the question out of `q` and fills the page in. */
export function searchUrl(settings: GoogleFlightsSettings, from: string, to: string, window: { from: string; to: string }): string {
  const params = new URLSearchParams({
    q: `Flights from ${from} to ${to} on ${window.from} through ${window.to}`,
    curr: settings.currency,
    hl: settings.language,
    gl: settings.region,
  });
  return `${settings.baseUrl}?${params}`;
}

/** Every airport of the origin with every airport of the destination, the nearest first, at most `max` pairs. */
export function airportPairs(origins: string[], destinations: string[], max: number): [string, string][] {
  const pairs: [string, string][] = [];
  const longest = Math.max(origins.length, destinations.length);
  // Nearest with nearest first: the diagonal, then the rest
  for (let rank = 0; rank < longest && pairs.length < max; rank++) {
    for (const origin of origins.slice(0, rank + 1)) {
      for (const destination of destinations.slice(0, rank + 1)) {
        if (pairs.length < max && !pairs.some(([a, b]) => a === origin && b === destination)) pairs.push([origin, destination]);
      }
    }
  }
  return pairs;
}

const slug = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What the transfer from the arrival airport to the destination costs, beyond the distance where it matters (B-S3). */
function lastMileOf(airport: string, destination: { lat: number; lon: number }): number {
  let location: { lat: number; lon: number } | null = null;
  try {
    location = airportLocation(airport);
  } catch {
    // Without the airports list there is no distance to go by
  }
  if (!location) return 0;
  const km = distanceKm(location.lat, location.lon, destination.lat, destination.lon);
  return km >= lastMile.minDistanceKm ? Math.round((km / 10) * lastMile.eurPer10Km) : 0;
}

const cheapestFirst = (a: Flight, b: Flight) => a.priceEur - b.priceEur || a.durationMin - b.durationMin;

/**
 * The way back to pair with an outbound flight: the airline's own when Google lists one (a round trip is
 * usually sold by one airline), otherwise the cheapest, and among equals the quickest.
 */
function returnFor(outbound: Flight, returns: Flight[]): { flight: Flight; pairing: "same-airline" | "cheapest" } | null {
  const sameAirline = returns.filter((candidate) => candidate.airlines[0] === outbound.airlines[0]).sort(cheapestFirst)[0];
  if (sameAirline) return { flight: sameAirline, pairing: "same-airline" };
  const cheapest = [...returns].sort(cheapestFirst)[0];
  return cheapest ? { flight: cheapest, pairing: "cheapest" } : null;
}

function optionOf(query: TransportQuery, flight: Flight, paired: ReturnType<typeof returnFor>, pair: [string, string], url: string): TransportOptionInput {
  const back = paired?.flight ?? null;
  const first = flight.legs[0];
  const last = flight.legs[flight.legs.length - 1];
  const backFirst = back?.legs[0];
  const backLast = back?.legs[back.legs.length - 1];
  return {
    originKey: query.origin.key,
    mode: "plane",
    provider: slug(flight.airlines[0] ?? "") || SOURCE,
    variant: "standard",
    outDepartAt: first.departAt,
    outArriveAt: last.arriveAt,
    backDepartAt: backFirst?.departAt ?? null,
    backArriveAt: backLast?.arriveAt ?? null,
    outDurationMin: flight.durationMin,
    backDurationMin: back?.durationMin ?? null,
    stops: flight.stops ?? flight.legs.length - 1,
    priceEur: flight.priceEur,
    priceUnit: "per_person",
    lastMileEur: lastMileOf(last.to, query.destination),
    comfortScore: null,
    comfortLevel: null,
    url,
    raw: {
      source: SOURCE,
      pair,
      airlines: flight.airlines,
      flights: flight.legs.map((leg) => `${leg.flightNumber} ${leg.from}-${leg.to}`),
      // Google's price is for the round trip with its own cheapest way back; the one shown is the best match among those it listed
      back: back ? { airlines: back.airlines, flights: back.legs.map((leg) => `${leg.flightNumber} ${leg.from}-${leg.to}`), pairing: paired!.pairing } : null,
    },
  };
}

/**
 * Tells Google's answers apart by where their flights leave from: the outbound ones leave from the
 * origin's airports, the ones back from the destination's. The same flights asked for twice count once.
 */
function sortAnswers(query: TransportQuery, answers: string[]): PairResult {
  const result: PairResult = { outbound: [], returns: [] };
  const seen = (list: Flight[], flight: Flight) => list.some((known) => known.priceEur === flight.priceEur && known.legs[0].departAt === flight.legs[0].departAt && known.legs[0].flightNumber === flight.legs[0].flightNumber);
  for (const answer of answers) {
    let flights: Flight[];
    try {
      flights = parseShoppingResults(answer);
    } catch (error) {
      // An answer that is not about flights (the page asks for other things too) is not a reason to give up
      if (error instanceof ScrapeChangedError && answers.length > 1) continue;
      throw error;
    }
    for (const flight of flights) {
      const leavesFrom = flight.legs[0].from;
      const list = query.origin.airports.includes(leavesFrom) ? result.outbound : query.destination.airports.includes(leavesFrom) ? result.returns : null;
      if (list && !seen(list, flight)) list.push(flight);
    }
  }
  return result;
}

/** What one airport pair gave: the outbound flights, and the flights back. Plain data, so that it can be kept. */
type PairResult = { outbound: Flight[]; returns: Flight[] };

export function createGoogleFlightsAdapter({
  driver,
  config,
  now = () => new Date(),
}: {
  driver: FlightsDriver;
  config: GoogleFlightsSettings;
  now?: () => Date;
}): TransportAdapter {
  return {
    id: SOURCE,
    modes: ["plane"],
    async search(query) {
      if (query.mode !== "plane") return [];
      // Google sells no flight that has already left
      if (query.window.from <= now().toISOString().slice(0, 10)) return [];

      const cache = query.cache ?? noCache;
      const found: TransportOptionInput[] = [];
      const failures: { pair: [string, string]; error: unknown }[] = [];
      for (const pair of airportPairs(query.origin.airports, query.destination.airports, config.maxAirportPairs)) {
        const url = searchUrl(config, pair[0], pair[1], query.window);
        const key = `flights|${pair[0]}|${pair[1]}|${query.window.from}|${query.window.to}`;
        let result: PairResult;
        try {
          result = await cache.remember<PairResult>(
            key,
            SOURCE,
            cacheTtlMs.scrape,
            async () => {
              const page = await driver(url, { wantReturn: true });
              const sorted = sortAnswers(query, page.answers);
              // The page showed its flights though its answer was not captured: they are read off the page
              if (sorted.outbound.length === 0 && page.rows.length > 0) sorted.outbound = parseFlightLabels(page.rows, pair, query.window.from);
              return sorted;
            },
            // No flight at all may only be a page that did not show its flights: not believed for a day
            { refresh: query.refresh, keepIf: (value) => value.outbound.length > 0 },
          );
        } catch (error) {
          // Turned away: asking the other pairs would only make it worse
          if (error instanceof ScrapeError && !error.retryable) throw error;
          // One airport pair that does not answer (a small airport) must not lose the flights the others found
          failures.push({ pair, error });
          console.warn(`[flights] ${pair[0]} to ${pair[1]} could not be searched: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        found.push(...result.outbound.map((flight) => optionOf(query, flight, returnFor(flight, result.returns), pair, url)));
      }
      // Flights from some pairs are worth showing though another pair failed. But "no flight" when a pair
      // failed is not "there is none": it is a search that did not work, and says so.
      if (found.length === 0 && failures.length > 0) {
        const [{ error }] = failures;
        const where = failures.map(({ pair }) => `${pair[0]} to ${pair[1]}`).join(", ");
        throw new ScrapeError(`${error instanceof Error ? error.message : "Google Flights failed"} (${where})`, !(error instanceof ScrapeError) || error.retryable);
      }

      return found.sort((a, b) => a.priceEur - b.priceEur || (a.outDurationMin ?? 0) - (b.outDurationMin ?? 0)).slice(0, config.maxOptions);
    },
  };
}

export const googleFlightsAdapter = createGoogleFlightsAdapter({ driver: chromeFlightsDriver, config: googleFlights });
