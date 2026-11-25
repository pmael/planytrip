// Transitous (task.md T7.8, train-sources.md): the timetables of the trains of the whole of Europe, from the
// operators' own open data, planned by a community-run MOTIS server. No key. It asks to be told who is asking
// (TRIP_CONTACT), not to be hammered (one search gives a whole day, kept for a day) and to be credited
// (https://transitous.org/sources/).
import { cacheTtlMs, trains } from "@/config";
import { sameStation, stationKey } from "@/core/stations";
import { z } from "zod";
import { noCache } from "../cache";
import { ScrapeChangedError } from "../errors";
import type { Http } from "../http";
import type { ScrapeCache } from "../types";
import { parsePlan } from "./transitous-parse";
import type { TrainJourney } from "./train-types";

export type TransitousSettings = typeof trains.transitous;
export type Place = { lat: number; lon: number };

export type Timetable = {
  /** The trains that leave on `day` (YYYY-MM-DD, local) from near one place to near the other */
  journeys(from: Place, to: Place, day: string): Promise<TrainJourney[]>;
};

const RAIL_MODES = new Set(["HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_RAIL", "RAIL"]);
const Stops = z.array(z.looseObject({ name: z.string(), lat: z.number(), lon: z.number(), modes: z.array(z.string()).optional() }));

/** Where a station is: the stop of that name that trains call at. Null when there is none; asking again is for the cache's month to answer. */
export type StationLocator = (name: string) => Promise<Place | null>;

export function createStationLocator({ http, config = trains.transitous, cache = noCache }: { http: Http; config?: Pick<TransitousSettings, "apiUrl">; cache?: ScrapeCache }): StationLocator {
  return (name) =>
    cache.remember<Place | null>(
      `station|${stationKey(name)}`,
      "transitous",
      cacheTtlMs.geo,
      async () => {
        const answer = await http.getJson(`${config.apiUrl}/v1/geocode?${new URLSearchParams({ text: name, type: "STOP", language: "fr" })}`);
        const parsed = Stops.safeParse(answer);
        if (!parsed.success) throw new ScrapeChangedError("Transitous answered, but not in a form the scraper knows");
        const stop = parsed.data.find((s) => sameStation(s.name, name) && (s.modes ?? []).some((mode) => RAIL_MODES.has(mode)));
        return stop ? { lat: stop.lat, lon: stop.lon } : null;
      },
      { keepIf: (place) => place !== null },
    );
}

export function createTransitous({ http, config = trains.transitous }: { http: Http; config?: TransitousSettings }): Timetable {
  return {
    async journeys(from, to, day) {
      const params = new URLSearchParams({
        fromPlace: `${from.lat},${from.lon}`,
        toPlace: `${to.lat},${to.lon}`,
        time: `${day}T${String(config.searchFromHourUtc).padStart(2, "0")}:00:00Z`,
        arriveBy: "false",
        // Trains only; the way to and from the station is on foot or, when there is no station near, by car
        transitModes: "HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL,REGIONAL_RAIL",
        directModes: "WALK",
        preTransitModes: "WALK,CAR",
        postTransitModes: "WALK,CAR",
        maxPreTransitTime: String(config.maxAccessSeconds),
        maxPostTransitTime: String(config.maxAccessSeconds),
        maxTransfers: String(config.maxTransfers),
        numItineraries: String(config.itineraries),
        searchWindow: String(config.searchWindowSeconds),
        // The shape of each ride and of each walk is not needed: it is most of the answer
        detailedLegs: "false",
        detailedTransfers: "false",
        language: "en",
      });
      const answer = await http.getJson(`${config.apiUrl}/v6/plan?${params}`);
      return parsePlan(answer).filter((journey) => journey.departAt.startsWith(day));
    },
  };
}
