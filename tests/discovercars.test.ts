// A rental car's real daily price (task.md T8.11, rental-sources.md): DiscoverCars' published monthly averages at an
// airport, found from the country page, weighted by the stay's nights, and used for a Nature trip's car by the
// price_destination job. Fixtures cut from the real pages on 2026-11-15 (tests/fixtures/prices/discovercars-*.html); the
// airport page is the Swiss side of Geneva airport's, served here as the French side's.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskFn } from "@/ai/claude";
import { extraPlan } from "@/core/extras";
import type { Db } from "@/db/types";
import { lineDetail } from "@/lib/extraLines";
import { createScrapeCache } from "@/scrapers/cache";
import { ScrapeBlockedError, ScrapeChangedError } from "@/scrapers/errors";
import { airportPagesOf, countrySlug, createDiscoverCarsRental, monthlyAverages, pageFetcher, stayAverage, type RentalPriceSource } from "@/scrapers/prices/discovercars";
import { localPricesOf } from "@/server/services/localPrices";
import { processNextJob } from "@/worker";
import { createPriceDestinationHandler, type PriceDestinationDeps } from "@/worker/handlers/price-destination";
import { enqueueJob } from "@/worker/queue";
import { enterScenario, noBulletin } from "./helpers/compute";
import { createTestDb } from "./helpers/db";
import { seedExtraInput } from "./helpers/extras";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/prices", name), "utf8");
const FRANCE = fixture("discovercars-france.html");
const GVA = fixture("discovercars-gva.html");
const GVA_MONTHS = [55, 58, 54, 46, 44, 55, 86, 68, 50, 50, 40, 74];

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("reading DiscoverCars' pages", () => {
  it("reads the twelve monthly averages of an airport page, not the searches chart that follows", () => {
    expect(monthlyAverages(GVA)).toEqual(GVA_MONTHS);
  });

  it("takes nothing from a page in another currency, or without the chart", () => {
    expect(monthlyAverages(GVA.replaceAll(">€", ">$"))).toBeNull();
    expect(monthlyAverages("<html><body>No chart here</body></html>")).toBeNull();
  });

  it("finds an airport's page on its country's page: Geneva's French side for a trip in France", () => {
    const pages = airportPagesOf(`${FRANCE}<a href="/spain/barcelona/bcn">Barcelona</a>`, "France");
    expect(pages.get("GVA")).toBe("/france/ferney-voltaire/gva");
    expect(pages.get("LYS")).toBe("/france/lyon/lys");
    expect(pages.has("BCN")).toBe(false);
  });

  it("writes a country the way its addresses do", () => {
    expect(countrySlug("France")).toBe("france");
    expect(countrySlug("United Kingdom")).toBe("united-kingdom");
    expect(countrySlug("Côte d'Ivoire")).toBe("cote-d-ivoire");
    expect(countrySlug("Bosnia & Herzegovina")).toBe("bosnia-and-herzegovina");
  });

  it("weights the stay's months by its nights: 26 August → 5 September is 6 nights at 68 € and 4 at 50 €", () => {
    expect(stayAverage(GVA_MONTHS, "2027-08-26", "2027-09-05")).toBe(60.8);
    expect(stayAverage(GVA_MONTHS, "2027-07-10", "2027-07-17")).toBe(86);
  });
});

describe("the rental price at the destination's airports", () => {
  const pages = (overrides: Record<string, string | null> = {}) => {
    const site: Record<string, string | null> = { "https://www.discovercars.com/france": FRANCE, "https://www.discovercars.com/france/ferney-voltaire/gva": GVA, ...overrides };
    return vi.fn(async (url: string) => (url in site ? site[url] : null));
  };
  const leMontSaxonnex = { country: "France", airports: ["GVA"], from: "2027-08-26", to: "2027-09-05" };

  it("gives the August–September average at Geneva airport, from two pages, then from the cache", async () => {
    const fetchPage = pages();
    const rental = createDiscoverCarsRental(fetchPage);
    const cache = createScrapeCache(db);
    expect(await rental(leMontSaxonnex, { cache })).toEqual({ eurPerDay: 60.8, monthsEur: GVA_MONTHS, airport: "GVA", url: "https://www.discovercars.com/france/ferney-voltaire/gva" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    await rental({ ...leMontSaxonnex, from: "2027-07-10", to: "2027-07-17" }, { cache });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("tries the next airport when the first has no page, and gives nothing when none has", async () => {
    const fetchPage = pages();
    const rental = createDiscoverCarsRental(fetchPage);
    expect(await rental({ ...leMontSaxonnex, airports: ["CMF", "GVA"] })).toMatchObject({ airport: "GVA" });
    expect(await rental({ ...leMontSaxonnex, airports: ["CMF"] })).toBeNull();
    expect(await rental({ ...leMontSaxonnex, country: "Atlantis" })).toBeNull();
    expect(await rental({ ...leMontSaxonnex, airports: [] })).toBeNull();
  });

  it("gives nothing for an airport page that is gone, and says so when the chart has changed", async () => {
    expect(await createDiscoverCarsRental(pages({ "https://www.discovercars.com/france/ferney-voltaire/gva": null }))(leMontSaxonnex)).toBeNull();
    const changed = GVA.replaceAll(">€", ">CHF ");
    await expect(createDiscoverCarsRental(pages({ "https://www.discovercars.com/france/ferney-voltaire/gva": changed }))(leMontSaxonnex)).rejects.toBeInstanceOf(ScrapeChangedError);
  });

  it("asks politely and stops at a wall: 403, 429 or a verification page", async () => {
    const answering = (status: number, body = "") => vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
    const fetchOk = answering(200, "<html>ok</html>");
    expect(await pageFetcher(fetchOk, { min: 0, max: 0 })("https://www.discovercars.com/france")).toBe("<html>ok</html>");
    const [, init] = (fetchOk as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["user-agent"]).toBe("planytrip/1.0 (personal use, low volume)");
    expect(await pageFetcher(answering(404), { min: 0, max: 0 })("https://www.discovercars.com/nope")).toBeNull();
    await expect(pageFetcher(answering(403), { min: 0, max: 0 })("x")).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(pageFetcher(answering(429), { min: 0, max: 0 })("x")).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(pageFetcher(answering(200, '<script src="https://geo.captcha-delivery.com/c.js"></script>'), { min: 0, max: 0 })("x")).rejects.toBeInstanceOf(ScrapeBlockedError);
  });
});

describe("price_destination: a Nature trip's car at its published price", () => {
  const prices = Object.fromEntries(["groceriesPerDay", "cheapMeal", "midMeal", "drink", "clubEntry", "preDrinks", "transitTicket", "transitDayPass", "taxiStart", "taxiPerKm", "parkingPerDay", "carRentalPerDay", "fuelPerL"].map((key) => [key, 10]));
  const ask = (async () => ({ prices: { ...prices, carRentalPerDay: 55 }, activities: [], touristTax: { perPersonNightEur: 1, maxNights: 0, note: "" } })) as unknown as AskFn;

  async function price(destinationId: string, rental: RentalPriceSource, overrides: Partial<PriceDestinationDeps> = {}) {
    const [{ tripId }] = db.all<{ tripId: string }>(sql`select trip_id as tripId from destinations where id = ${destinationId}`);
    const deps: PriceDestinationDeps = { ask, levels: async () => null, findPlace: async () => null, franceTax: async () => null, route: async () => null, transit: async () => null, rental, fuel: noBulletin, ...overrides };
    enqueueJob(db, { tripId, type: "price_destination", payload: { parent: "p", destinationId } });
    await processNextJob(db, { price_destination: createPriceDestinationHandler(deps) }, { policy: { maxRetries: 0, backoffMs: [0] } });
  }
  const found: RentalPriceSource = async () => ({ eurPerDay: 60.8, monthsEur: GVA_MONTHS, airport: "GVA", url: "https://www.discovercars.com/france/ferney-voltaire/gva" });

  it("replaces the AI's estimate at Le Mont-Saxonnex with DiscoverCars' average at Geneva for the stay's months", async () => {
    const { destinations } = await enterScenario(db);
    const rental = vi.fn(found);
    await price(destinations.ms.id, rental);
    expect(rental).toHaveBeenCalledWith(expect.objectContaining({ country: "France", airports: expect.arrayContaining(["GVA"]), from: "2027-08-26", to: "2027-09-05" }), expect.anything());
    expect(localPricesOf(db, destinations.ms.id)!.prices.carRentalPerDay).toEqual({
      eur: 60.8,
      source: "published",
      note: "DiscoverCars' average at GVA, August and September",
      url: "https://www.discovercars.com/france/ferney-voltaire/gva",
    });
  });

  it("asks nothing for a trip that rents no car (Barcelona, partying)", async () => {
    const { destinations } = await enterScenario(db);
    const rental = vi.fn(found);
    await price(destinations.bcn.id, rental);
    expect(rental).not.toHaveBeenCalled();
    expect(localPricesOf(db, destinations.bcn.id)!.prices.carRentalPerDay.source).toBe("ai");
  });

  it("keeps the AI's estimate and says why when DiscoverCars turns us away, or has no page", async () => {
    const { destinations } = await enterScenario(db);
    await price(destinations.ms.id, async () => {
      throw new ScrapeBlockedError("DiscoverCars turned the request away");
    });
    const kept = localPricesOf(db, destinations.ms.id)!;
    expect(kept.prices.carRentalPerDay).toEqual({ eur: 55, source: "ai" });
    expect(kept.message).toContain("The rental car's price is an estimate: DiscoverCars turned the request away");
  });

  it("gives the car its price on a recompute of prices kept from before, without asking the AI again", async () => {
    const { destinations } = await enterScenario(db);
    const askOnce = vi.fn(ask);
    await price(destinations.ms.id, async () => null, { ask: askOnce as unknown as AskFn });
    expect(localPricesOf(db, destinations.ms.id)!.message).toContain("DiscoverCars publishes no average");
    await price(destinations.ms.id, found, { ask: askOnce as unknown as AskFn });
    expect(askOnce).toHaveBeenCalledTimes(1);
    expect(localPricesOf(db, destinations.ms.id)!.prices.carRentalPerDay).toMatchObject({ eur: 60.8, source: "published" });
  });

  it("uses it without the AI too, in place of the rules' estimate", async () => {
    const { destinations } = await enterScenario(db);
    const noAi = (async () => {
      const { ClaudeUnavailableError } = await import("@/ai/claude");
      throw new ClaudeUnavailableError("The claude CLI is not installed");
    }) as unknown as AskFn;
    await price(destinations.ms.id, found, { ask: noAi });
    const kept = localPricesOf(db, destinations.ms.id)!;
    expect(kept.source).toBe("rules");
    expect(kept.prices.carRentalPerDay).toMatchObject({ eur: 60.8, source: "published" });
  });
});

describe("on the Extra page", () => {
  it("shows whose average it is, with ≈ and the page to check it on", () => {
    const seeded = seedExtraInput("mont-saxonnex");
    const chloe = seeded.guests.find((guest) => guest.guestId === "chloe")!;
    const input = {
      ...seeded,
      prices: { ...seeded.prices, carRentalPerDay: { eur: 60.8, source: "published" as const, note: "DiscoverCars' average at GVA, August and September", url: "https://www.discovercars.com/france/ferney-voltaire/gva" } },
      guests: seeded.guests.map((guest) => (guest.guestId === "martin" ? { ...guest, mode: "plane" as const, there: chloe.there, back: chloe.back } : guest)),
    };
    const rental = lineDetail("car-rental", input, extraPlan(input), "chloe", (id) => id);
    expect(rental.rows[0]).toEqual({
      label: "A car for a day",
      value: "60.80 € (DiscoverCars' average at GVA, August and September)",
      source: "published",
      href: "https://www.discovercars.com/france/ferney-voltaire/gva",
    });
    expect(rental.estimate).toBe(true);
  });
});
