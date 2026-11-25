// A destination's local prices and things to do (task.md T8.4, use-cases.md R10): the rules' prices from Eurostat's
// price levels, the AI's answer and how it is checked, the map check of the things to do, the job, and the seed.
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { localPricesHashOf, localPricesPrompt, type LocalPricesAnswer, type LocalPricesFacts } from "@/ai/extra-prices";
import { extraPrices } from "@/config";
import { checkedPrices, PRICE_KEYS, rulesPrices } from "@/core/local-prices";
import { localPriceFixtures, activityFixtures } from "@/db/seed/fixtures";
import { seedScenarioMartin } from "@/db/seed/scenario-martin";
import type { Db } from "@/db/types";
import { GeocoderUnavailableError } from "@/geo/geocode";
import { createPlaceFinder, type PlaceFinder } from "@/geo/places";
import { ScrapeError } from "@/scrapers/errors";
import { createPriceLevels, parsePriceLevels } from "@/scrapers/prices/eurostat";
import { extraActivitiesOf, localPricesOf } from "@/server/services/localPrices";
import { updateDestination } from "@/server/services/destinations";
import { createPriceDestinationHandler, type PriceDestinationDeps } from "@/worker/handlers/price-destination";
import { enqueueJob } from "@/worker/queue";
import { processNextJob } from "@/worker";
import { createTestDb } from "./helpers/db";
import { enterScenario, noBulletin } from "./helpers/compute";

const EUROSTAT = readFileSync(path.join(process.cwd(), "tests/fixtures/prices/eurostat-price-levels.json"), "utf8");
const LEVELS = parsePriceLevels(EUROSTAT);

describe("parsePriceLevels: Eurostat's price levels (prc_ppp_ind, EU27 = 100)", () => {
  it("reads each country's level of each category, at the latest year, by ISO code", () => {
    expect(LEVELS.get("ES")).toMatchObject({ A010101: 94.6, A0111: 83.9, A0109: 94.2, A010201: 90.5, A010703: 81.5, A0107: 87.4 });
    expect(LEVELS.get("FR")?.A0111).toBe(110);
    // Greece is "EL" at Eurostat
    expect(LEVELS.get("GR")?.A0111).toBe(86.4);
    expect(LEVELS.has("EU")).toBe(false);
  });

  it("has nothing for the United Kingdom since it left the EU, and says the file changed when it is not JSON-stat", () => {
    expect(LEVELS.get("GB")).toBeUndefined();
    expect(() => parsePriceLevels("{}")).toThrow(/JSON-stat/);
  });

  it("reads the file once, and asks again after a failure", async () => {
    const load = vi.fn().mockRejectedValueOnce(new ScrapeError("down")).mockResolvedValue(EUROSTAT);
    const levels = createPriceLevels({ load });
    await expect(levels("ES")).rejects.toThrow("down");
    expect(await levels("es")).toMatchObject({ A0111: 83.9 });
    expect(await levels("JP")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("rulesPrices: the EU average of each thing times the country's price level", () => {
  it("prices Spain below the EU average, and says how", () => {
    const { prices, message } = rulesPrices(LEVELS.get("ES")!, "Spain");
    // 15 € × 83.9 % and 12 € × 94.6 %
    expect(prices.cheapMeal).toEqual({ eur: 12.59, source: "rules" });
    expect(prices.groceriesPerDay).toEqual({ eur: 11.35, source: "rules" });
    expect(prices.transitTicket.eur).toBe(1.79);
    expect(message).toBe("the EU average of each thing times Spain's price level (Eurostat)");
  });

  it("uses the EU average where the country has no level, and says so", () => {
    const { prices, message } = rulesPrices(null, "United Kingdom");
    expect(prices.cheapMeal.eur).toBe(extraPrices.euAverage.cheapMeal);
    expect(message).toBe("no price level is known for United Kingdom: the EU average of each thing");
    expect(rulesPrices({ A0111: 120 }, "Somewhere").message).toMatch(/the EU average where it has none/);
  });
});

describe("checkedPrices: the AI's prices against the country's average", () => {
  const rules = rulesPrices(LEVELS.get("ES")!, "Spain").prices;
  const given = Object.fromEntries(PRICE_KEYS.map((key) => [key, rules[key].eur * 1.2])) as Record<(typeof PRICE_KEYS)[number], number>;

  it("keeps the AI's prices that are near the average, as the AI's", () => {
    const { prices, replaced } = checkedPrices(given, rules);
    expect(replaced).toEqual([]);
    expect(prices.cheapMeal).toEqual({ eur: Math.round(rules.cheapMeal.eur * 1.2 * 100) / 100, source: "ai" });
  });

  it("replaces one far from it (in cents, or ten times too dear) by the rules', and names it", () => {
    const { prices, replaced } = checkedPrices({ ...given, taxiPerKm: 130, clubEntry: 0.5, fuelPerL: Number.NaN }, rules);
    expect(replaced).toEqual(["clubEntry", "taxiPerKm", "fuelPerL"]);
    expect(prices.taxiPerKm).toEqual(rules.taxiPerKm);
  });
});

const facts: LocalPricesFacts = {
  destination: { name: "Granada", country: "Spain", countryCode: "ES", lat: 37.177, lon: -3.599, outsideEurope: false },
  objective: "culture",
  budgetLevel: "medium",
  stay: { from: "2027-05-10", to: "2027-05-14", nights: 4 },
  activitiesWanted: 6,
};

describe("localPricesPrompt", () => {
  it("asks for the prices and for the objective's things to do, looked up on the map by name", () => {
    const prompt = localPricesPrompt(facts);
    expect(prompt).toContain("The trip is for culture");
    expect(prompt).toContain("Give 6 of them");
    expect(prompt).toContain('"name": "Granada"');
    expect(prompt).toMatch(/looks each one up on the map/);
    expect(localPricesPrompt({ ...facts, objective: "none", activitiesWanted: 0 })).toContain("Give 0 of them (none)");
  });

  it("gives a new fingerprint when the place, the objective, the budget level or the dates change", () => {
    const hash = localPricesHashOf(facts);
    expect(localPricesHashOf({ ...facts })).toBe(hash);
    expect(localPricesHashOf({ ...facts, objective: "nature" })).not.toBe(hash);
    expect(localPricesHashOf({ ...facts, stay: { ...facts.stay, from: "2027-08-10" } })).not.toBe(hash);
  });
});

describe("createPlaceFinder: a thing to do looked up on the map near the destination", () => {
  const feature = (name: string, lat: number, lon: number) => ({ geometry: { coordinates: [lon, lat] }, properties: { name } });
  const answering = (features: unknown[], ok = true) => vi.fn(async () => new Response(JSON.stringify({ features }), { status: ok ? 200 : 503 })) as unknown as typeof fetch;

  it("takes the best match within the distance of the destination", async () => {
    const fetch = answering([feature("Alhambra", 37.1761, -3.5881), feature("Alhambra", 34.09, -118.13)]);
    const found = await createPlaceFinder({ fetch, minIntervalMs: 0 })("Alhambra", { lat: 37.177, lon: -3.599 }, 30);
    expect(found).toMatchObject({ name: "Alhambra", lat: 37.1761, lon: -3.5881 });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("lat")).toBe("37.177");
  });

  it("does not take a signpost or a bus stop named after the place for the place", async () => {
    // What Photon answered for the Cirque du Fer-à-Cheval near Le Mont-Saxonnex: a board 30 km from it came first
    const board = { ...feature("Cirque du Fer à Cheval", 46.0724, 6.4558), properties: { name: "Cirque du Fer à Cheval", osm_key: "information", osm_value: "board" } };
    const stop = { ...feature("Cirque du Fer à Cheval", 46.07, 6.8), properties: { name: "Cirque du Fer à Cheval", osm_key: "highway", osm_value: "bus_stop" } };
    const viewpoint = { ...feature("Cirque du Fer à Cheval", 46.0773, 6.8405), properties: { name: "Cirque du Fer à Cheval", osm_key: "tourism", osm_value: "viewpoint" } };
    const found = await createPlaceFinder({ fetch: answering([board, stop, viewpoint]), minIntervalMs: 0 })("Cirque du Fer-à-Cheval", { lat: 46.0517, lon: 6.4533 }, 80);
    expect(found).toMatchObject({ lat: 46.0773, lon: 6.8405 });
  });

  it("finds nothing when no place of that name is near, and says when the map cannot be asked", async () => {
    const far = createPlaceFinder({ fetch: answering([feature("Alhambra", 34.09, -118.13)]), minIntervalMs: 0 });
    expect(await far("Alhambra", { lat: 37.177, lon: -3.599 }, 30)).toBeNull();
    const down = createPlaceFinder({ fetch: answering([], false), minIntervalMs: 0 });
    await expect(down("Alhambra", { lat: 37.177, lon: -3.599 }, 30)).rejects.toBeInstanceOf(GeocoderUnavailableError);
  });
});

describe("the price_destination job", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  /** What a good AI answers for Barcelona, partying: Spain's rules prices plus 10 %, and three places to go out */
  const answerFor = (overrides: Partial<LocalPricesAnswer["prices"]> = {}): LocalPricesAnswer => ({
    prices: { ...(Object.fromEntries(PRICE_KEYS.map((key) => [key, rulesPrices(LEVELS.get("ES")!, "Spain").prices[key].eur * 1.1])) as LocalPricesAnswer["prices"]), ...overrides },
    activities: [
      { name: "Razzmatazz", kind: "club", mapName: "Razzmatazz", priceEur: 18, durationH: 5, note: "Five rooms, open until 6 am" },
      { name: "El Born bars", kind: "bar", mapName: "Passeig del Born", priceEur: 0, durationH: 3, note: "" },
      { name: "A club that does not exist", kind: "club", mapName: "Club Nowhere", priceEur: 20, durationH: 4, note: "" },
    ],
    touristTax: { perPersonNightEur: 6.88, maxNights: 7, note: "Catalan tax and Barcelona surcharge" },
  });
  const onTheMap: PlaceFinder = async (name, near) => (name === "Club Nowhere" || name === "A club that does not exist" ? null : { name, lat: near.lat + 0.01, lon: near.lon + 0.01, distanceKm: 1.4 });
  const levels = async (country: string) => LEVELS.get(country) ?? null;

  async function run(db: Db, destinationId: string, deps: Partial<PriceDestinationDeps>) {
    const [{ tripId }] = db.all<{ tripId: string }>(sql`select trip_id as tripId from destinations where id = ${destinationId}`);
    const ask = vi.fn<AskFn>(async () => answerFor() as never);
    const all: PriceDestinationDeps = { ask: ask as AskFn, levels, findPlace: onTheMap, franceTax: async () => null, route: async () => null, transit: async () => null, rental: async () => null, fuel: noBulletin, ...deps };
    enqueueJob(db, { tripId, type: "price_destination", payload: { parent: "p", destinationId } });
    await processNextJob(db, { price_destination: createPriceDestinationHandler(all) }, { policy: { maxRetries: 0, backoffMs: [0] } });
    return all;
  }

  it("keeps the AI's prices and the things to do it could find on the map, and says what it left out", async () => {
    const { destinations } = await enterScenario(db);
    await run(db, destinations.bcn.id, {});
    const kept = localPricesOf(db, destinations.bcn.id)!;
    expect(kept.source).toBe("ai");
    expect(kept.prices.cheapMeal.source).toBe("ai");
    expect(kept.message).toBe("1 thing to do not found on the map near the destination, left out (A club that does not exist)");
    const activities = extraActivitiesOf(db, destinations.bcn.id);
    expect(activities.map((activity) => [activity.rank, activity.name, activity.kind, activity.priceEur])).toEqual([
      [1, "Razzmatazz", "club", 18],
      [2, "El Born bars", "bar", 0],
    ]);
    expect(activities[0]).toMatchObject({ note: "Five rooms, open until 6 am", lat: expect.any(Number) });
    expect(activities[1].note).toBeNull();
  });

  it("does not ask again for the same place, objective, budget level and dates, and asks again when one changes", async () => {
    const { destinations } = await enterScenario(db);
    const first = await run(db, destinations.bcn.id, {});
    const again = await run(db, destinations.bcn.id, {});
    expect(first.ask).toHaveBeenCalledTimes(1);
    expect(again.ask).not.toHaveBeenCalled();
    await updateDestination(db, destinations.bcn.id, { objective: "culture" });
    const changed = await run(db, destinations.bcn.id, {});
    expect(changed.ask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(changed.ask).mock.calls[0][0]).toContain("The trip is for culture");
  });

  it("replaces an AI price far from Spain's average by the rules', and says which", async () => {
    const { destinations } = await enterScenario(db);
    await run(db, destinations.bcn.id, { ask: (async () => answerFor({ taxiPerKm: 150 })) as AskFn });
    const kept = localPricesOf(db, destinations.bcn.id)!;
    expect(kept.prices.taxiPerKm).toEqual({ eur: 1.3, source: "rules" });
    expect(kept.message).toMatch(/^1 price the AI gave was far from the country's average and replaced by it \(taxiPerKm\)/);
  });

  it("gives Barcelona Spain's country-average prices, marked rule-based, without the AI", async () => {
    const { destinations } = await enterScenario(db);
    const ask = vi.fn<AskFn>(async () => {
      throw new ClaudeUnavailableError("The claude CLI is not installed");
    });
    await run(db, destinations.bcn.id, { ask: ask as AskFn });
    const kept = localPricesOf(db, destinations.bcn.id)!;
    expect(kept.source).toBe("rules");
    expect(kept.prices.cheapMeal).toEqual({ eur: 12.59, source: "rules" });
    expect(kept.message).toBe("Not given by the AI (The claude CLI is not installed): the EU average of each thing times Spain's price level (Eurostat)");
    expect(extraActivitiesOf(db, destinations.bcn.id)).toEqual([]);
  });

  it("keeps the things to do the AI gave before when it is not there the next time, and asks it again then", async () => {
    const { destinations } = await enterScenario(db);
    await run(db, destinations.bcn.id, {});
    await run(db, destinations.bcn.id, { ask: (async () => { throw new ClaudeUnavailableError("logged out"); }) as AskFn });
    // The kept AI prices were for the same facts: nothing was asked. Make them the rules', as after an AI outage
    db.run(sql`update destination_prices set source = 'rules'`);
    await run(db, destinations.bcn.id, { ask: (async () => { throw new ClaudeUnavailableError("logged out"); }) as AskFn });
    expect(localPricesOf(db, destinations.bcn.id)!.source).toBe("rules");
    expect(extraActivitiesOf(db, destinations.bcn.id)).toHaveLength(2);
    const back = await run(db, destinations.bcn.id, {});
    expect(back.ask).toHaveBeenCalledTimes(1);
    expect(localPricesOf(db, destinations.bcn.id)!.source).toBe("ai");
  });

  it("uses the EU average when Eurostat cannot be reached, and keeps the things to do unplaced when the map cannot be asked", async () => {
    const { destinations } = await enterScenario(db);
    await run(db, destinations.bcn.id, {
      levels: async () => {
        throw new ScrapeError("Could not get Eurostat's price levels: HTTP 503");
      },
      findPlace: async () => {
        throw new GeocoderUnavailableError("down");
      },
    });
    const activities = extraActivitiesOf(db, destinations.bcn.id);
    expect(activities).toHaveLength(3);
    expect(activities.every((activity) => activity.lat === null)).toBe(true);
    // The AI's prices were checked against the EU average
    expect(localPricesOf(db, destinations.bcn.id)!.source).toBe("ai");
  });
});

describe("the seed (use-cases.md UC-D, D.1)", () => {
  it("writes the local prices and the things to do of T8.1 for the three destinations", () => {
    const { db, close } = createTestDb();
    const { destinationIds } = seedScenarioMartin(db);
    expect(localPricesOf(db, destinationIds.barcelona)).toMatchObject({ source: "ai", prices: localPriceFixtures.barcelona });
    expect(extraActivitiesOf(db, destinationIds["mont-saxonnex"]).map((activity) => activity.name)).toEqual(activityFixtures["mont-saxonnex"].map((activity) => activity.name));
    expect(extraActivitiesOf(db, destinationIds.barcelona)).toEqual([]);
    close();
  });
});
