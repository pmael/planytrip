import { readFileSync } from "node:fs";
import path from "node:path";
import type { ScrapeCache } from "@/scrapers/types";
import type { TrainJourney } from "@/scrapers/transport/train-types";

export const trainFixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/trains", name), "utf8");
export const trainJson = (name: string) => JSON.parse(trainFixture(name));

/** A cache that keeps what it is given in memory, and honours `refresh` and `keepIf` as the real one does. */
export function memoryCache(): ScrapeCache & { keys: () => string[] } {
  const kept = new Map<string, unknown>();
  return {
    keys: () => [...kept.keys()],
    async remember<T>(key: string, _source: string, _ttl: number, produce: () => Promise<T>, options: { refresh?: boolean; keepIf?: (value: T) => boolean } = {}) {
      if (!options.refresh && kept.has(key)) return kept.get(key) as T;
      const value = await produce();
      if (!options.keepIf || options.keepIf(value)) kept.set(key, value);
      return value;
    },
  };
}

/** A journey of one train, for tests that need a timetable without reading a captured one. */
export function journey(over: Partial<TrainJourney["legs"][number]> & { departAt?: string; arriveAt?: string } = {}): TrainJourney {
  const leg = {
    from: { name: "Toulouse Matabiau", lat: 43.6112, lon: 1.4536 },
    to: { name: "Lyon Part Dieu", lat: 45.7606, lon: 4.8594 },
    departAt: "2026-12-04T07:37",
    arriveAt: "2026-12-04T11:48",
    train: "TGV INOUI 6871",
    operator: "SNCF VOYAGEURS",
    mode: "HIGHSPEED_RAIL",
    ...over,
  };
  return { legs: [leg], departAt: leg.departAt, arriveAt: leg.arriveAt, durationMin: Math.round((Date.parse(`${leg.arriveAt}Z`) - Date.parse(`${leg.departAt}Z`)) / 60_000) };
}
