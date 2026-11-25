// Fuel prices from the EU Weekly Oil Bulletin (task.md T8.12): reading its .xlsx without a library, the petrol price of
// each EU country, the page's link to the latest file, the cache, and its use for car trips and Nature's cars. The file
// is the real one of 9 November 2026 (tests/fixtures/prices/oil-bulletin-with-taxes-2026-11-09.xlsx).
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskFn } from "@/ai/claude";
import { extraPlan } from "@/core/extras";
import type { Db } from "@/db/types";
import { lineDetail } from "@/lib/extraLines";
import { createScrapeCache } from "@/scrapers/cache";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeUnavailableError } from "@/scrapers/errors";
import { createOilBulletin, latestFileLink, parseOilBulletin, petrolPriceIn, type OilBulletin } from "@/scrapers/prices/oil-bulletin";
import { createCarAdapter } from "@/scrapers/transport/car";
import type { TransportQuery } from "@/scrapers/types";
import { firstSheetRows, zipEntries } from "@/scrapers/xlsx";
import { localPricesOf } from "@/server/services/localPrices";
import { processNextJob } from "@/worker";
import { createPriceDestinationHandler, type PriceDestinationDeps } from "@/worker/handlers/price-destination";
import { enqueueJob } from "@/worker/queue";
import { enterScenario } from "./helpers/compute";
import { createTestDb } from "./helpers/db";
import { seedExtraInput } from "./helpers/extras";

const FILE = readFileSync(path.join(process.cwd(), "tests/fixtures/prices/oil-bulletin-with-taxes-2026-11-09.xlsx"));
const PAGE_URL = "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";
const FILE_PATH = "/document/download/264c2d0f-f161-4ea3-a777-78faae59bea0_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20with%20Taxes%20-%202026-09-21.xlsx";
// The page's two "latest prices" links, as it has them: without taxes, then with
const PAGE = `<a href="/document/download/78311f92-68f8-4b82-b5cf-1293beeaae77_en?filename=Weekly%20Oil%20Bulletin%20Weekly%20prices%20without%20taxes%20-%202024-02-19.xlsx" class="ecl-link">Download</a>
<a href="${FILE_PATH}" class="ecl-link" data-untranslated-label="Prices with taxes latest prices (xlsx)">Download</a>`;

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

describe("reading the bulletin's .xlsx", () => {
  it("opens the zip and reads the sheet's rows by column", () => {
    expect([...zipEntries(FILE).keys()]).toContain("xl/worksheets/sheet1.xml");
    const rows = firstSheetRows(FILE);
    expect(rows.get(1)!.get("B")).toMatch(/^Euro-super 95/);
    expect(rows.get(2)!.get("B")).toBe("1000 l");
    expect(rows.get(3)!.get("A")).toBe("Austria");
  });

  it("gives Euro-super 95 per litre in each of the 27 EU countries, and the bulletin's date", () => {
    const bulletin = parseOilBulletin(FILE, PAGE_URL);
    expect(bulletin.date).toBe("2026-11-09");
    expect(Object.keys(bulletin.petrolEurPerL)).toHaveLength(27);
    expect(bulletin.petrolEurPerL).toMatchObject({ France: 2.088, Spain: 1.73, Germany: 2.067, Czechia: 1.653 });
    // The EU and euro area averages are not countries
    expect(Object.keys(bulletin.petrolEurPerL).some((name) => name.startsWith("CE/EC"))).toBe(false);
  });

  it("finds a country by its English name, as places and labels write it", () => {
    const bulletin = parseOilBulletin(FILE, PAGE_URL);
    expect(petrolPriceIn(bulletin, "Spain")).toBe(1.73);
    expect(petrolPriceIn(bulletin, "Czech Republic")).toBe(1.653);
    expect(petrolPriceIn(bulletin, "the Netherlands")).toBe(2.196);
    expect(petrolPriceIn(bulletin, "Switzerland")).toBeNull();
  });

  it("says when the file or its sheet is not what it was", () => {
    expect(() => parseOilBulletin(Buffer.from("not a spreadsheet"), PAGE_URL)).toThrow(ScrapeChangedError);
  });

  it("follows the page's link to the prices with taxes, not to those without", () => {
    expect(latestFileLink(PAGE)).toBe(`https://energy.ec.europa.eu${FILE_PATH}`);
    expect(latestFileLink("<p>No links</p>")).toBeNull();
  });
});

describe("createOilBulletin: the page, then the file, kept a week", () => {
  const site = (overrides: Partial<Record<"page" | "file", Response>> = {}) =>
    vi.fn(async (url: string | URL | Request) =>
      String(url) === PAGE_URL ? (overrides.page ?? new Response(PAGE)) : (overrides.file ?? new Response(new Uint8Array(FILE))),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it("reads the latest file once a week, saying what the app is", async () => {
    const fetchImpl = site();
    const bulletin = createOilBulletin(fetchImpl);
    const cache = createScrapeCache(db);
    expect((await bulletin({ cache })).petrolEurPerL.France).toBe(2.088);
    await bulletin({ cache });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual([PAGE_URL, `https://energy.ec.europa.eu${FILE_PATH}`]);
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toEqual({ "user-agent": "planytrip/1.0 (personal use, low volume)" });
  });

  it("stops at a refusal, and says when the page no longer links to the file", async () => {
    await expect(createOilBulletin(site({ page: new Response("", { status: 403 }) }))()).rejects.toBeInstanceOf(ScrapeBlockedError);
    await expect(createOilBulletin(site({ page: new Response("<p>Moved</p>") }))()).rejects.toBeInstanceOf(ScrapeChangedError);
    await expect(createOilBulletin(site({ file: new Response("<html>a page</html>") }))()).rejects.toBeInstanceOf(ScrapeChangedError);
  });
});

const bulletin: OilBulletin = parseOilBulletin(FILE, PAGE_URL);
const known = async () => bulletin;

describe("car trips at the pump prices of both ends", () => {
  const query = (origin: string, countryCode?: string): TransportQuery => ({
    mode: "car",
    origin: { key: "o", label: origin, lat: 40.4168, lon: -3.7038, airports: [] },
    destination: { id: "d1", label: "Barcelona, Spain", lat: 41.3874, lon: 2.1686, airports: ["BCN"], countryCode },
    window: { from: "2027-08-26", to: "2027-09-05" },
  });
  const router = vi.fn(async () => ({ distanceKm: 620, durationMin: 364, tollKm: 0, hasToll: false }));
  const adapter = (fuel: () => Promise<OilBulletin>) => createCarAdapter({ tollRoute: router, roadRoute: router, fuel });

  it("costs Madrid → Barcelona at Spain's 1.73 €/L: 139 € rather than 145 € at the config's 1.80 €/L", async () => {
    const [drive] = await adapter(known).search(query("Madrid, Spain", "ES"));
    expect(drive.priceEur).toBe(139);
    expect(drive.raw).toMatchObject({ fuelEurPerL: 1.73, fuelPriceFrom: "EU Weekly Oil Bulletin, 2026-11-09" });
  });

  it("takes the mean of the two countries, or the one the bulletin has", async () => {
    const [fromFrance] = await adapter(known).search(query("Toulouse, France", "ES"));
    expect(fromFrance.raw).toMatchObject({ fuelEurPerL: 1.909 });
    const [fromZurich] = await adapter(known).search(query("Zürich, Switzerland", "ES"));
    expect(fromZurich.raw).toMatchObject({ fuelEurPerL: 1.73 });
  });

  it("keeps the config's price outside the EU, and when the bulletin cannot be read", async () => {
    const [outside] = await adapter(known).search({ ...query("Zürich, Switzerland", "CH"), destination: { ...query("x").destination, label: "Bern, Switzerland", countryCode: "CH" } });
    expect(outside).toMatchObject({ priceEur: 145, raw: { fuelEurPerL: 1.8, fuelPriceFrom: "config" } });
    const unreadable = async (): Promise<OilBulletin> => {
      throw new ScrapeUnavailableError("down");
    };
    expect((await adapter(unreadable).search(query("Madrid, Spain", "ES")))[0].priceEur).toBe(145);
  });
});

describe("price_destination: a Nature trip's fuel at the country's pump price", () => {
  const prices = Object.fromEntries(["groceriesPerDay", "cheapMeal", "midMeal", "drink", "clubEntry", "preDrinks", "transitTicket", "transitDayPass", "taxiStart", "taxiPerKm", "parkingPerDay", "carRentalPerDay", "fuelPerL"].map((key) => [key, 10]));
  const ask = (async () => ({ prices: { ...prices, fuelPerL: 1.9 }, activities: [], touristTax: { perPersonNightEur: 1, maxNights: 0, note: "" } })) as unknown as AskFn;

  async function price(destinationId: string, fuel: PriceDestinationDeps["fuel"]) {
    const [{ tripId }] = db.all<{ tripId: string }>(sql`select trip_id as tripId from destinations where id = ${destinationId}`);
    const deps: PriceDestinationDeps = { ask, levels: async () => null, findPlace: async () => null, franceTax: async () => null, route: async () => null, transit: async () => null, rental: async () => null, fuel };
    enqueueJob(db, { tripId, type: "price_destination", payload: { parent: "p", destinationId } });
    await processNextJob(db, { price_destination: createPriceDestinationHandler(deps) }, { policy: { maxRetries: 0, backoffMs: [0] } });
  }

  it("gives Le Mont-Saxonnex France's Euro-super 95 of 9 November 2026, as official data with its page", async () => {
    const { destinations } = await enterScenario(db);
    await price(destinations.ms.id, known);
    expect(localPricesOf(db, destinations.ms.id)!.prices.fuelPerL).toEqual({ eur: 2.088, source: "open-data", note: "EU Weekly Oil Bulletin, 9 November 2026: Euro-super 95", url: PAGE_URL });
  });

  it("asks nothing for a trip with no car to fill (Barcelona, partying)", async () => {
    const { destinations } = await enterScenario(db);
    const fuel = vi.fn(known);
    await price(destinations.bcn.id, fuel);
    expect(fuel).not.toHaveBeenCalled();
  });

  it("keeps the estimate, and says why, for a country the bulletin does not have or when it cannot be read", async () => {
    const { destinations } = await enterScenario(db);
    await price(destinations.ms.id, async () => ({ ...bulletin, petrolEurPerL: { Spain: 1.73 } }));
    const kept = localPricesOf(db, destinations.ms.id)!;
    expect(kept.prices.fuelPerL).toEqual({ eur: 1.9, source: "ai" });
    expect(kept.message).toContain("France is not in the EU Weekly Oil Bulletin: the fuel price is an estimate");
  });
});

describe("on the Extra page", () => {
  it("shows the fuel as official data, with the bulletin's date and its page", () => {
    const seeded = seedExtraInput("mont-saxonnex");
    const input = { ...seeded, prices: { ...seeded.prices, fuelPerL: { eur: 2.088, source: "open-data" as const, note: "EU Weekly Oil Bulletin, 9 November 2026: Euro-super 95", url: PAGE_URL } } };
    const fuel = lineDetail("fuel", input, extraPlan(input), null, (id) => id);
    expect(fuel.rows[0]).toEqual({ label: "Fuel, a litre", value: "2.09 € (EU Weekly Oil Bulletin, 9 November 2026: Euro-super 95)", source: "open-data", href: PAGE_URL });
    expect(fuel.estimate).toBe(false);
  });
});
