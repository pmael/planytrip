// FlixBus (task.md T7.5): the buses, and the trains FlixBus sells, between two cities on the days of the stay.
//
// How it works, and why:
// - FlixBus's own search service answers plain requests, so no browser is used: the city of each end is
//   looked up by name (the one nearest to the place asked for), then the rides of each day are listed.
// - A round trip is two searches, the way there on the first day and the way back on the last. FlixBus
//   sells each way on its own, so the price of the round trip is the two added up, exactly.
// - The answer mixes buses and trains. A ride whose legs are all trains is a train; anything else is a
//   bus (a bus and a train in one ticket is sold as a bus journey).
// - Each outbound ride is paired with the cheapest ride back of the same kind (the quickest among equals).
// - What was answered is kept for a day, and the city lookups for a month.
import { cacheTtlMs, flixbus } from "@/config";
import type { TransportMode } from "@/core/types";
import { distanceKm } from "@/geo/airports";
import { noCache } from "../cache";
import { ScrapeBlockedError, ScrapeError, ScrapeUnavailableError } from "../errors";
import { createPoliteThrottle } from "../throttle";
import type { ScrapeCache, TransportAdapter, TransportOptionInput } from "../types";
import { parseCities, parseRides, type FlixbusCity, type Ride } from "./flixbus-parse";

/** The tunable numbers of the search (config.flixbus) */
export type FlixbusSettings = {
  apiUrl: string;
  shopUrl: string;
  locale: string;
  currency: string;
  pauseMs: { min: number; max: number };
  timeoutMs: number;
  maxCityDistanceKm: number;
  maxOptions: number;
};

/** How the adapter asks FlixBus for JSON. Swapped for a fake in tests. */
export type JsonFetcher = (url: string) => Promise<unknown>;

const SOURCE = "flixbus";
const MODES: TransportMode[] = ["bus", "train"];

/** Plain requests, one after the other with a polite pause, from a program that says what it is. */
export function createJsonFetcher(settings: FlixbusSettings = flixbus): JsonFetcher {
  const pace = createPoliteThrottle({ minMs: settings.pauseMs.min, maxMs: settings.pauseMs.max });
  return (url) =>
    pace(async () => {
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: "application/json", "user-agent": "trip-manager (personal use, low volume)" },
          signal: AbortSignal.timeout(settings.timeoutMs),
        });
      } catch (error) {
        throw new ScrapeError(`Could not reach FlixBus: ${error instanceof Error ? error.message : "unknown error"}`);
      }
      if (response.status === 403) throw new ScrapeBlockedError("FlixBus turned the request away");
      if (response.status === 429 || response.status >= 500) throw new ScrapeError(`FlixBus answered ${response.status}`);
      if (!response.ok) throw new ScrapeUnavailableError(`FlixBus did not accept the search (${response.status})`);
      try {
        return await response.json();
      } catch {
        throw new ScrapeError("FlixBus answered with something that is not JSON");
      }
    });
}

const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** The city of the answer that is the place asked for: the nearest within reach, and among those the one with the same name. */
export function pickCity(cities: FlixbusCity[], place: { label: string; lat: number; lon: number }, maxKm: number): FlixbusCity | null {
  const name = norm(place.label.split(",")[0]);
  const near = cities
    .map((city) => ({ city, km: distanceKm(place.lat, place.lon, city.lat, city.lon) }))
    .filter(({ km }) => km <= maxKm)
    .sort((a, b) => a.km - b.km);
  return (near.find(({ city }) => norm(city.name) === name) ?? near[0])?.city ?? null;
}

/** "2026-12-22" → "22.12.2026", the way FlixBus writes a day. */
const flixbusDay = (isoDate: string) => isoDate.split("-").reverse().join(".");

const kindOf = (ride: Ride): TransportMode => (ride.legs.every((leg) => leg === "train") ? "train" : "bus");
const cheapestFirst = (a: Ride, b: Ride) => a.priceEur - b.priceEur || a.durationMin - b.durationMin;

export function createFlixbusAdapter({
  fetchJson,
  config,
  now = () => new Date(),
}: {
  fetchJson: JsonFetcher;
  config: FlixbusSettings;
  now?: () => Date;
}): TransportAdapter {
  const get = (path: string, params: Record<string, string>) => fetchJson(`${config.apiUrl}${path}?${new URLSearchParams(params)}`);

  async function cityOf(place: { label: string; lat: number; lon: number }, cache: ScrapeCache, refresh: boolean | undefined): Promise<FlixbusCity | null> {
    const key = `city|${norm(place.label.split(",")[0])}|${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    const found = await cache.remember<FlixbusCity | null>(
      key,
      SOURCE,
      cacheTtlMs.geo,
      async () => {
        const answer = await get("/search/autocomplete/cities", {
          q: place.label.split(",")[0].trim(),
          lang: "en",
          flixbus_cities_only: "false",
          is_train_only: "false",
          stations: "false",
          popular_stations: "false",
        });
        return pickCity(parseCities(answer), place, config.maxCityDistanceKm);
      },
      { refresh },
    );
    return found;
  }

  const ridesOn = (from: FlixbusCity, to: FlixbusCity, day: string, cache: ScrapeCache, refresh: boolean | undefined) =>
    cache.remember<Ride[]>(
      `rides|${from.id}|${to.id}|${day}`,
      SOURCE,
      cacheTtlMs.scrape,
      async () =>
        parseRides(
          await get("/search/service/v4/search", {
            from_city_id: from.id,
            to_city_id: to.id,
            departure_date: flixbusDay(day),
            products: JSON.stringify({ adult: 1 }),
            currency: config.currency,
            locale: config.locale,
            search_by: "cities",
            include_after_midnight_rides: "1",
          }),
        ),
      { refresh },
    );

  return {
    id: SOURCE,
    modes: MODES,
    async search(query) {
      if (!MODES.includes(query.mode)) return [];
      // No ride is sold for a day that has already begun
      if (query.window.from <= now().toISOString().slice(0, 10)) return [];

      const cache = query.cache ?? noCache;
      const from = await cityOf(query.origin, cache, query.refresh);
      const to = await cityOf(query.destination, cache, query.refresh);
      if (!from || !to) return [];

      const out = (await ridesOn(from, to, query.window.from, cache, query.refresh)).filter((ride) => kindOf(ride) === query.mode).sort(cheapestFirst);
      if (out.length === 0) return [];
      // A way there with no way back is not a trip: the price would be half of one
      const back = (await ridesOn(to, from, query.window.to, cache, query.refresh)).filter((ride) => kindOf(ride) === query.mode).sort(cheapestFirst)[0];
      if (!back) return [];

      const link = `${config.shopUrl}?${new URLSearchParams({
        departureCity: from.id,
        arrivalCity: to.id,
        rideDate: flixbusDay(query.window.from),
        adult: "1",
        _locale: config.locale.slice(0, 2),
      })}`;
      return out.slice(0, config.maxOptions).map(
        (ride): TransportOptionInput => ({
          originKey: query.origin.key,
          mode: query.mode,
          provider: SOURCE,
          variant: "standard",
          outDepartAt: ride.departAt,
          outArriveAt: ride.arriveAt,
          backDepartAt: back.departAt,
          backArriveAt: back.arriveAt,
          outDurationMin: ride.durationMin,
          backDurationMin: back.durationMin,
          stops: ride.legs.length - 1,
          priceEur: ride.priceEur + back.priceEur,
          priceUnit: "per_person",
          // FlixBus stops in the city: no airport to get from
          lastMileEur: 0,
          comfortScore: null,
          comfortLevel: null,
          url: link,
          raw: { source: SOURCE, from: from.name, to: to.name, out: { legs: ride.legs, priceEur: ride.priceEur }, back: { legs: back.legs, priceEur: back.priceEur } },
        }),
      );
    },
  };
}

export const flixbusAdapter = createFlixbusAdapter({ fetchJson: createJsonFetcher(), config: flixbus });
