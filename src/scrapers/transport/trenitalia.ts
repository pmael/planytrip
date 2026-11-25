// Trenitalia's own booking service (task.md T7.8): the real fare of a train, for the journeys that are
// entirely Trenitalia's (Frecciarossa, Frecciargento, Frecciabianca, Intercity, regionals). It is the JSON the
// operator's website asks for itself; it answers a normal request from a home connection, without a key
// and without a verification. A source that answers like a wall stops the search for it (see http.ts).
//
// How it works: the stations of a journey are looked up by name, then the day's solutions between them are
// listed once, and each journey takes the price of the solution that leaves and arrives at the same times.
import { cacheTtlMs, trains } from "@/config";
import { z } from "zod";
import { noCache } from "../cache";
import { ScrapeChangedError } from "../errors";
import type { Http } from "../http";
import type { FareQuote, FareSource, TrainJourney } from "./train-types";

export type TrenitaliaSettings = { apiUrl: string; pageSize: number; maxPages: number };

const SOURCE = "trenitalia";
const norm = (name: string) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const Locations = z.array(z.looseObject({ id: z.number(), name: z.string(), multistation: z.boolean().optional() }));
const Answer = z.looseObject({
  solutions: z.array(
    z.looseObject({
      solution: z.looseObject({
        departureTime: z.string(),
        arrivalTime: z.string(),
        status: z.string().optional(),
        price: z.looseObject({ amount: z.number() }).nullish(),
      }),
    }),
  ),
});

/** One solution of the day: when it leaves and arrives (local), and what the cheapest fare costs; null when no fare is on sale. */
type Solution = { departAt: string; arriveAt: string; priceEur: number | null };

/** "2026-12-04T07:00:00.000+01:00" → "2026-12-04T07:00": Trenitalia writes local time, with the offset. */
const localMinute = (iso: string) => iso.slice(0, 16);

export function createTrenitalia({
  http,
  config = trains.trenitalia,
  link = trains.links.trenitalia,
}: {
  http: Http;
  config?: TrenitaliaSettings;
  link?: string;
}): FareSource<FareQuote | null> {
  async function stationId(name: string, cache: Parameters<FareSource["quote"]>[1]["cache"], refresh: boolean | undefined): Promise<number | null> {
    return cache.remember<number | null>(
      `station|${norm(name)}`,
      SOURCE,
      cacheTtlMs.geo,
      async () => {
        const parsed = Locations.safeParse(await http.getJson(`${config.apiUrl}/locations/search?${new URLSearchParams({ name, limit: "5" })}`));
        if (!parsed.success) throw new ScrapeChangedError("Trenitalia answered, but not in a form the scraper knows");
        const stations = parsed.data.filter((place) => !place.multistation);
        return (stations.find((place) => norm(place.name) === norm(name)) ?? null)?.id ?? null;
      },
      { refresh },
    );
  }

  return {
    id: SOURCE,
    async quote(journeys, { cache = noCache, refresh }) {
      const quotes: (FareQuote | null)[] = journeys.map(() => null);

      // The journeys that are entirely Trenitalia's, a search for each pair of stations and day
      const groups = new Map<string, number[]>();
      journeys.forEach((journey, index) => {
        if (!journey.legs.every((leg) => /^trenitalia/i.test(leg.operator))) return;
        const first = journey.legs[0].from.name;
        const last = journey.legs[journey.legs.length - 1].to.name;
        const key = `${first}\u0000${last}\u0000${journey.departAt.slice(0, 10)}`;
        groups.set(key, [...(groups.get(key) ?? []), index]);
      });

      for (const [key, indexes] of groups) {
        const [first, last] = key.split("\u0000");
        const [from, to] = [await stationId(first, cache, refresh), await stationId(last, cache, refresh)];
        if (from === null || to === null) continue;

        const departures = indexes.map((i) => journeys[i].departAt).sort();
        const [earliest, latest] = [departures[0], departures[departures.length - 1]];
        const solutions = await cache.remember<Solution[]>(
          `solutions|${from}|${to}|${earliest}|${latest}`,
          SOURCE,
          cacheTtlMs.scrape,
          async () => {
            // The answer comes 10 solutions at a time, in the order of the day: read on until the last train wanted
            const found: Solution[] = [];
            for (let page = 0; page < config.maxPages; page++) {
              const answer = await http.postJson(`${config.apiUrl}/ticket/solutions`, {
                departureLocationId: from,
                arrivalLocationId: to,
                departureTime: `${earliest}:00.000`,
                adults: 1,
                children: 0,
                criteria: { frecceOnly: false, regionalOnly: false, noChanges: false, order: "DEPARTURE_DATE", limit: config.pageSize, offset: page * config.pageSize },
                advancedSearchRequest: { bestFare: false },
              });
              const parsed = Answer.safeParse(answer);
              if (!parsed.success) throw new ScrapeChangedError("Trenitalia answered, but not in a form the scraper knows");
              const solutionsOfPage = parsed.data.solutions.map(({ solution }): Solution => ({
                departAt: localMinute(solution.departureTime),
                arriveAt: localMinute(solution.arrivalTime),
                priceEur: solution.status === "SALEABLE" && solution.price ? solution.price.amount : null,
              }));
              found.push(...solutionsOfPage);
              const last = solutionsOfPage[solutionsOfPage.length - 1];
              if (solutionsOfPage.length < config.pageSize || last.departAt >= latest) break;
            }
            return found;
          },
          { refresh, keepIf: (value) => value.length > 0 },
        );

        for (const index of indexes) {
          const journey: TrainJourney = journeys[index];
          const match = solutions.find((s) => s.departAt === journey.departAt && s.arriveAt === journey.arriveAt && s.priceEur !== null);
          if (match) quotes[index] = { priceEur: Math.round(match.priceEur!), kind: "live", note: null, source: SOURCE, link };
        }
      }
      return quotes;
    },
  };
}
