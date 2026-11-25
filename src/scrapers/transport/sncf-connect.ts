// The trains of a search as SNCF Connect sells them, at their real price (train-sources.md). The day's trains come from
// tools/sncf-api/fetch_day.py, through the person's running Chrome (sncf-connect-day.ts). It asks only while it is turned
// on in Settings (`isOn`).
//
// How it works, and why:
// - SNCF Connect is asked for the places the guests leave from and go to, as a person would type them ("Paris" →
//   "Toulouse"): it answers the trains from all their stations, with its own times, changes and prices. Those are the
//   trains of the search (trains.ts); Transitous' timetable and the estimates are only for when it cannot answer.
// - The price is second class, for one adult. When only first class is left, that is what the seat costs, and it says
//   so. A sold-out train ("Complet") is said to be sold out. A train whose sales are not open yet ("En vente
//   prochainement", for dates a few months ahead) has no price at all.
// - A day is kept in the cache for a day. A place SNCF does not know is kept as nothing. After SNCF turned us away, it is
//   not asked again for a while.
import { cacheTtlMs, trains } from "@/config";
import { stationKey } from "@/core/stations";
import { noCache } from "../cache";
import { ScrapeBlockedError } from "../errors";
import type { ScrapeCache } from "../types";
import { fetchSncfConnectDay, UnknownPlaceError, type DayQuery, type SncfConnectDay, type SncfConnectTrain } from "./sncf-connect-day";
import type { Position } from "./sncf-stations";
import type { FareQuote, RailLeg, SoldOut, TrainJourney } from "./train-types";

export type SncfConnectSettings = { blockedCooldownMs: number };

export const SNCF_CONNECT = "sncf-connect";

export interface SncfConnectTrains {
  id: typeof SNCF_CONNECT;
  /** Asked on each search: when it says no, trains.ts goes to the timetable */
  isOn(): boolean;
  /** The day's trains between two places; null when SNCF Connect knows no place by one of the names. Throws a ScrapeError otherwise. */
  day(query: Pick<DayQuery, "origin" | "destination" | "date">, context: { cache?: ScrapeCache; refresh?: boolean }): Promise<SncfConnectTrain[] | null>;
}

/** "Madrid, Spain", "La Réunion (Saint-Gilles)" → "Madrid", "La Réunion": the place as typed in SNCF Connect's search */
export const placeName = (label: string) =>
  label
    .split(",")[0]
    .replace(/\s*\(.*\)\s*/g, " ")
    .trim();

/**
 * What a seat costs on this train, one way, for one adult; SoldOut when SNCF says it is full ("Complet"); null when no price is
 * shown, such as a date whose sales are not open yet ("En vente prochainement").
 */
export function quoteOf(train: SncfConnectTrain, link: string): FareQuote | SoldOut | null {
  if (train.availability === "sold-out") return { soldOut: true, source: SNCF_CONNECT };
  if (!train.bookable) return null;
  const { second, first, best } = train.priceEur;
  if (second !== null) return { priceEur: Math.round(second), kind: "live", note: null, source: SNCF_CONNECT, link };
  if (first !== null) return { priceEur: Math.round(first), kind: "live", note: "Only first class left on SNCF Connect", source: SNCF_CONNECT, link };
  if (best !== null) return { priceEur: Math.round(best), kind: "live", note: null, source: SNCF_CONNECT, link };
  return null;
}

/** SNCF's own brands are run by SNCF Voyageurs; the others (LYRIA, EUROSTAR, FRECCIAROSSA) keep their name */
const SNCF_BRANDS = /inoui|ouigo|\bter\b|intercit|^tgv\b|transilien/i;

/** What kind of train it is, as the timetable would say: the most practical pick counts a regional train apart */
export function modeOf(operator: string): string {
  if (/\bter\b|transilien|l[eé]man express/i.test(operator)) return "REGIONAL_RAIL";
  if (/\bcar\b|\bbus\b|autocar/i.test(operator)) return "BUS";
  if ((/intercit/i.test(operator) && !/nuit/i.test(operator)) || /classique/i.test(operator)) return "LONG_DISTANCE";
  if (/nuit|night/i.test(operator)) return "NIGHT_RAIL";
  return "HIGHSPEED_RAIL";
}

/**
 * The train as a journey of the app. Each leg's times are "HH:MM": a leg that leaves earlier in the day than the one before
 * is on the next day. `where` places a station: its UIC number when SNCF gave it, else `null` and the caller says roughly.
 * A train without a leg (SNCF's coach-only answers) is not a train: null.
 */
export function toJourney(train: SncfConnectTrain, where: (code: string | null | undefined, end: "origin" | "destination") => Position): TrainJourney | null {
  if (train.legs.length === 0) return null;
  let day = train.departAt.slice(0, 10);
  let previous = train.departAt.slice(11, 16);
  const at = (time: string) => {
    if (time < previous) day = nextDay(day);
    previous = time;
    return `${day}T${time}`;
  };
  const legs = train.legs.map((leg, index): RailLeg => {
    const operator = leg.operator ?? "SNCF";
    return {
      from: { name: leg.from, ...where(leg.fromCode, index === 0 ? "origin" : "destination") },
      departAt: at(leg.departs),
      to: { name: leg.to, ...where(leg.toCode, "destination") },
      arriveAt: at(leg.arrives),
      train: `${operator} ${leg.number}`.trim(),
      operator: SNCF_BRANDS.test(operator) ? "SNCF VOYAGEURS" : operator,
      mode: modeOf(operator),
    };
  });
  return { legs, departAt: train.departAt, arriveAt: train.arriveAt, durationMin: train.durationMin };
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function createSncfConnect({
  fetchDay = fetchSncfConnectDay,
  config = trains.sncfConnect,
  now = Date.now,
  isOn = () => true,
}: {
  fetchDay?: (query: DayQuery) => Promise<SncfConnectDay>;
  config?: SncfConnectSettings;
  now?: () => number;
  isOn?: () => boolean;
} = {}): SncfConnectTrains {
  /** Until when SNCF Connect is left alone, after it turned a request away */
  let blockedUntil = 0;

  return {
    id: SNCF_CONNECT,
    isOn,
    async day({ origin, destination, date }, { cache = noCache, refresh }) {
      if (now() < blockedUntil) {
        throw new ScrapeBlockedError(`SNCF Connect turned a request away: not asked again before ${new Date(blockedUntil).toISOString().slice(11, 16)} UTC`);
      }
      try {
        return await cache.remember<SncfConnectTrain[] | null>(
          `trains|${stationKey(origin)}|${stationKey(destination)}|${date}`,
          SNCF_CONNECT,
          cacheTtlMs.scrape,
          async () => {
            try {
              return (await fetchDay({ origin, destination, date })).trains;
            } catch (error) {
              // A place SNCF does not know will not be known in an hour either: kept, as nothing
              if (error instanceof UnknownPlaceError) return null;
              throw error;
            }
          },
          // No train at all may be a page that did not load: not to be believed for a day
          { refresh, keepIf: (trainsOfDay) => trainsOfDay === null || trainsOfDay.length > 0 },
        );
      } catch (error) {
        if (error instanceof ScrapeBlockedError) blockedUntil = now() + config.blockedCooldownMs;
        throw error;
      }
    },
  };
}
