// RegioJet (task.md T7.8): the trains and buses of RegioJet (Czechia, Slovakia, Austria, Hungary, Germany...)
// with their real prices, between two cities on the days of the stay. Its trains are not in Transitous' timetables,
// so this is a source of journeys of its own, the way FlixBus is. RegioJet's public API answers plain requests
// with no key and no verification.
//
// How it works, and why:
// - The cities are looked up in RegioJet's list (kept for a month), the one nearest to the place asked for.
// - A round trip is two searches, the way there on the first day and the way back on the last; each way is sold
//   on its own, so the price of the round trip is the two added up, exactly.
// - A ride whose vehicles are all trains is a train; anything else is a bus. Each outbound ride is paired with the
//   cheapest ride back of the same kind.
// - The price is the lowest fare of the ride ("from"), the one a person is shown first.
import { cacheTtlMs, trains } from "@/config";
import type { TransportMode } from "@/core/types";
import { distanceKm } from "@/geo/airports";
import { z } from "zod";
import { noCache } from "../cache";
import { ScrapeChangedError } from "../errors";
import type { Http } from "../http";
import type { ScrapeCache, TransportAdapter, TransportOptionInput } from "../types";

export type RegiojetSettings = typeof trains.regiojet;

const SOURCE = "regiojet";
const MODES: TransportMode[] = ["train", "bus"];

const Locations = z.array(
  z.looseObject({
    code: z.string().optional(),
    cities: z.array(
      z.looseObject({
        id: z.number(),
        name: z.string(),
        aliases: z.array(z.string()).optional(),
        stations: z.array(z.looseObject({ latitude: z.number().nullish(), longitude: z.number().nullish() })),
      }),
    ),
  }),
);
const Routes = z.looseObject({
  routes: z.array(
    z.looseObject({
      departureTime: z.string(),
      arrivalTime: z.string(),
      vehicleTypes: z.array(z.string()),
      transfersCount: z.number().optional(),
      priceFrom: z.number().nullish(),
      bookable: z.boolean().optional(),
    }),
  ),
});

type City = { id: number; name: string; names: string[]; lat: number; lon: number };
export type Ride = { departAt: string; arriveAt: string; durationMin: number; kind: TransportMode; changes: number; priceEur: number };

const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** "2026-12-04T06:01:00.000+01:00" → "2026-12-04T06:01": RegioJet writes the local time, with the offset. */
const localMinute = (iso: string) => iso.slice(0, 16);

export function parseCities(answer: unknown): City[] {
  const parsed = Locations.safeParse(answer);
  if (!parsed.success) throw new ScrapeChangedError("RegioJet answered, but not in a form the scraper knows");
  return parsed.data
    .flatMap((country) => country.cities)
    .flatMap((city): City[] => {
      // Some stations have no position: they cannot place the city
      const points = city.stations.filter((s) => typeof s.latitude === "number" && typeof s.longitude === "number");
      if (points.length === 0) return [];
      return [
        {
          id: city.id,
          name: city.name,
          names: [city.name, ...(city.aliases ?? [])].map(norm),
          lat: points.reduce((sum, s) => sum + (s.latitude as number), 0) / points.length,
          lon: points.reduce((sum, s) => sum + (s.longitude as number), 0) / points.length,
        },
      ];
    });
}

export function parseRides(answer: unknown): Ride[] {
  const parsed = Routes.safeParse(answer);
  if (!parsed.success) throw new ScrapeChangedError("RegioJet answered, but not in a form the scraper knows");
  return parsed.data.routes.flatMap((route): Ride[] => {
    // A sold-out ride has no price to show
    if (route.bookable === false || route.priceFrom === null || route.priceFrom === undefined) return [];
    const durationMin = Math.round((Date.parse(route.arrivalTime) - Date.parse(route.departureTime)) / 60_000);
    if (!Number.isFinite(durationMin) || durationMin <= 0) return [];
    return [
      {
        departAt: localMinute(route.departureTime),
        arriveAt: localMinute(route.arrivalTime),
        durationMin,
        kind: route.vehicleTypes.every((type) => type === "TRAIN") ? "train" : "bus",
        changes: route.transfersCount ?? 0,
        priceEur: route.priceFrom,
      },
    ];
  });
}

/** The city that is the place asked for: the nearest within reach, and among those the one with the same name. */
export function pickCity(cities: City[], place: { label: string; lat: number; lon: number }, maxKm: number): City | null {
  const name = norm(place.label.split(",")[0]);
  const near = cities
    .map((city) => ({ city, km: distanceKm(place.lat, place.lon, city.lat, city.lon) }))
    .filter(({ km }) => km <= maxKm)
    .sort((a, b) => a.km - b.km);
  return (near.find(({ city }) => city.names.includes(name)) ?? near[0])?.city ?? null;
}

/** The same ride listed more than once (it leaves from another station of the city) counts once, at its lowest price. */
function alone(rides: Ride[]): Ride[] {
  const byTimes = new Map<string, Ride>();
  for (const ride of rides) {
    const key = `${ride.departAt}|${ride.arriveAt}`;
    const known = byTimes.get(key);
    if (!known || ride.priceEur < known.priceEur) byTimes.set(key, ride);
  }
  return [...byTimes.values()];
}

const cheapestFirst = (a: Ride, b: Ride) => a.priceEur - b.priceEur || a.durationMin - b.durationMin;

export function createRegiojet({
  http,
  config = trains.regiojet,
  link = trains.links.regiojet,
  now = () => new Date(),
}: {
  http: Http;
  config?: RegiojetSettings;
  link?: string;
  now?: () => Date;
}): TransportAdapter {
  const cities = (cache: ScrapeCache, refresh: boolean | undefined) =>
    cache.remember<City[]>("cities", SOURCE, cacheTtlMs.geo, async () => parseCities(await http.getJson(`${config.apiUrl}/consts/locations`)), { refresh, keepIf: (list) => list.length > 0 });

  const ridesOn = (from: City, to: City, day: string, cache: ScrapeCache, refresh: boolean | undefined) =>
    cache.remember<Ride[]>(
      `rides|${from.id}|${to.id}|${day}`,
      SOURCE,
      cacheTtlMs.scrape,
      async () =>
        // RegioJet answers with the rides of the days around the one asked as well: only that day's are wanted
        parseRides(
          await http.getJson(
            `${config.apiUrl}/routes/search/simple?${new URLSearchParams({
              tariffs: "REGULAR",
              fromLocationType: "CITY",
              fromLocationId: String(from.id),
              toLocationType: "CITY",
              toLocationId: String(to.id),
              departureDate: day,
            })}`,
          ),
        ).filter((ride) => ride.departAt.startsWith(day)),
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
      const known = await cities(cache, query.refresh);
      const from = pickCity(known, query.origin, config.maxCityDistanceKm);
      const to = pickCity(known, query.destination, config.maxCityDistanceKm);
      if (!from || !to || from.id === to.id) return [];

      const out = alone((await ridesOn(from, to, query.window.from, cache, query.refresh)).filter((ride) => ride.kind === query.mode)).sort(cheapestFirst);
      if (out.length === 0) return [];
      // A way there with no way back is not a trip: the price would be half of one
      const back = (await ridesOn(to, from, query.window.to, cache, query.refresh)).filter((ride) => ride.kind === query.mode).sort(cheapestFirst)[0];
      if (!back) return [];

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
          stops: ride.changes,
          priceEur: Math.round(ride.priceEur + back.priceEur),
          priceUnit: "per_person",
          // RegioJet stops in the city: no airport to get from
          lastMileEur: 0,
          comfortScore: null,
          comfortLevel: null,
          url: link,
          raw: { source: SOURCE, from: from.name, to: to.name, out: ride, back },
        }),
      );
    },
  };
}
