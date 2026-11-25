// The tourist tax of a stay (task.md T8.5, use-cases.md R10): whether its price has it, and the rate when it does not:
// the stay's own page, France's open data, the config table, the AI. Done when an Airbnb in Catalonia adds the tax and
// an Airbnb in Paris does not.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskFn } from "@/ai/claude";
import { configTaxRule, nightlyTax, touristTaxOf, type PageTax, type TaxRule } from "@/core/tourist-tax";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { Http } from "@/scrapers/http";
import { createFranceTaxRules, deltaKeyOf, ruleFromDelta, type DeltaRow } from "@/scrapers/prices/france-tourist-tax";
import { addDestination } from "@/server/services/destinations";
import { localPricesOf, touristTaxOfStay } from "@/server/services/localPrices";
import { createPriceDestinationHandler, type PriceDestinationDeps } from "@/worker/handlers/price-destination";
import { processNextJob } from "@/worker";
import { enqueueJob } from "@/worker/queue";
import { createTestDb } from "./helpers/db";
import { enterScenario, paris, noBulletin } from "./helpers/compute";

const PARIS_ROWS: DeltaRow[] = JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/prices/delta-paris.json"), "utf8")).results;

const stay = { totalPriceEur: 600, nights: 4, guests: 3 };
const page = (over: Partial<PageTax>): PageTax => ({ included: null, amountEur: null, perPersonNightEur: null, maxNights: null, basis: null, ...over });

describe("configTaxRule: the config table, by country and place", () => {
  it("gives Barcelona's rate and its 7-night cap, and nothing for the rest of Catalonia", () => {
    expect(configTaxRule({ country: "ES", lat: 41.4036, lon: 2.1744 })).toMatchObject({ perPersonNightEur: 9.5, maxNights: 7, source: "config" });
    expect(configTaxRule({ country: "ES", lat: 41.9794, lon: 2.8214 })).toBeNull(); // Girona
  });

  it("knows where there is no tax, and a share of the price in Berlin", () => {
    expect(configTaxRule({ country: "ES", lat: 40.42, lon: -3.7 })).toMatchObject({ perPersonNightEur: 0 }); // Madrid
    expect(configTaxRule({ country: "ES", lat: 37.39, lon: -5.99 })).toMatchObject({ perPersonNightEur: 0, label: expect.stringContaining("Andalusia") }); // Seville
    expect(configTaxRule({ country: "FI", lat: 60.17, lon: 24.94 })).toMatchObject({ perPersonNightEur: 0 });
    expect(configTaxRule({ country: "DE", lat: 52.5, lon: 13.4 })).toMatchObject({ percentOfPrice: 7, perPersonNightEur: null });
  });

  it("does not take a French place for a Spanish one in the same box", () => {
    // Perpignan is inside the box of nothing Spanish, and Barcelona's circle is far
    expect(configTaxRule({ country: "FR", lat: 42.6887, lon: 2.8948 })).toBeNull();
  });
});

describe("nightlyTax", () => {
  const percent: TaxRule = { perPersonNightEur: null, percentOfPrice: 16.25, capPerNightEur: 15.61, maxNights: null, paidByHost: false, source: "open-data", label: "Paris" };

  it("takes a share of the price a person a night, at most the cap", () => {
    // 600 € for 4 nights and 3 people is 50 € a person a night
    expect(nightlyTax(percent, stay)).toBe(8.13);
    expect(nightlyTax(percent, { totalPriceEur: 6000, nights: 4, guests: 3 })).toBe(15.61);
    expect(nightlyTax({ ...percent, percentOfPrice: null, perPersonNightEur: 4 }, stay)).toBe(4);
  });
});

describe("touristTaxOf: in the price or not, and how much", () => {
  const barcelona = configTaxRule({ country: "ES", lat: 41.4036, lon: 2.1744 });

  it("adds Barcelona's tax to an Airbnb Airbnb does not collect for, for 7 nights at most", () => {
    expect(touristTaxOf({ page: page({}), provider: "airbnb", rule: barcelona, stay })).toEqual({ perNightEur: 9.5, maxNights: 7, included: false, source: "config" });
    expect(touristTaxOf({ page: null, provider: "airbnb", rule: barcelona, stay })).toMatchObject({ included: false, perNightEur: 9.5 });
  });

  it("takes the host's own rate and cap when they write it", () => {
    const host = page({ included: false, perPersonNightEur: 10.45, maxNights: 7, basis: "host-says-not-included" });
    expect(touristTaxOf({ page: host, provider: "airbnb", rule: barcelona, stay })).toEqual({ perNightEur: 10.45, maxNights: 7, included: false, source: "page" });
  });

  it("adds nothing to a Paris Airbnb whose price details have Airbnb's Taxes line, and says what it was", () => {
    // 68 € for 4 nights and 3 people (T8.2's Paris capture)
    const collected = page({ included: true, amountEur: 68, basis: "airbnb-collects" });
    expect(touristTaxOf({ page: collected, provider: "airbnb", rule: null, stay })).toEqual({ perNightEur: 5.67, maxNights: null, included: true, source: "page" });
  });

  it("takes a hotel's total as having it, and a French host on the forfait as paying it", () => {
    // What a hotel pays is not the rented flat's rate: in the price, no amount
    expect(touristTaxOf({ page: page({ included: true, basis: "google-policy" }), provider: "booking", rule: barcelona, stay })).toEqual({ perNightEur: 0, maxNights: null, included: true, source: "page" });
    const forfait: TaxRule = { ...barcelona!, paidByHost: true, source: "open-data" };
    expect(touristTaxOf({ page: page({}), provider: "airbnb", rule: forfait, stay })).toMatchObject({ included: true });
  });

  it("has no tax where there is none, or nothing is known", () => {
    expect(touristTaxOf({ page: page({}), provider: "airbnb", rule: configTaxRule({ country: "ES", lat: 40.42, lon: -3.7 }), stay })).toBeNull();
    expect(touristTaxOf({ page: page({}), provider: "airbnb", rule: null, stay })).toBeNull();
  });
});

describe("ruleFromDelta: a commune's voted rates (Paris, DELTA)", () => {
  it("takes the latest year's share for a rental with no star rating, with the extras of the last two years and the cap", () => {
    // 2025: 5 %, extras ×1.1 only; 2024's rows had Île-de-France's ×3.25; the highest rate, 4.80 (palaces)
    const rule = ruleFromDelta(PARIS_ROWS, 2027)!;
    expect(rule).toMatchObject({ percentOfPrice: 16.25, capPerNightEur: 15.6, perPersonNightEur: null, paidByHost: false, source: "open-data" });
    expect(rule.label).toBe("Ville de Paris (2025): 5 % of the price a person a night, with the extra taxes (×3.25), at most €15.6");
  });

  it("uses the rows of the stay's year, a fixed amount when that is what was voted, and the host on the forfait", () => {
    expect(ruleFromDelta(PARIS_ROWS, 2024)?.label).toMatch(/\(2024\)/);
    const fixed: DeltaRow[] = [{ date_effet: "2023", libelle_commune: "MONT-SAXONNEX", hebergement: "Hébergements sans classement ou en attente de classement", regime: "Forfait", tarif: 0.8, unite: "€", tarif_total: 0.88 }];
    expect(ruleFromDelta(fixed, 2027)).toMatchObject({ perPersonNightEur: 0.88, paidByHost: true, label: "Mont-Saxonnex (2023): €0.8 a person a night, with the extra taxes (×1.10); paid by the host (forfait)" });
    expect(ruleFromDelta(fixed, 2022)).toBeNull();
    expect(ruleFromDelta([{ ...fixed[0], hebergement: "Palaces" }], 2027)).toBeNull();
  });

  it("splits an INSEE code as DELTA does, overseas included", () => {
    expect(deltaKeyOf("75056")).toEqual({ departement: "75", commune: "056" });
    expect(deltaKeyOf("97415")).toEqual({ departement: "974", commune: "15" });
  });
});

describe("createFranceTaxRules", () => {
  it("finds the commune (trying nearby points for one in the sea), then asks for its rates", async () => {
    const urls: string[] = [];
    const http: Http = {
      postJson: vi.fn(),
      getJson: vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("geo.api.gouv.fr")) return urls.length === 1 ? [] : [{ code: "75056", nom: "Paris" }];
        return { results: PARIS_ROWS };
      }),
    };
    const rule = await createFranceTaxRules({ http })({ lat: 48.8566, lon: 2.3522 }, 2027);
    expect(rule).toMatchObject({ percentOfPrice: 16.25 });
    expect(urls).toHaveLength(3);
    expect(new URL(urls[2]).searchParams.get("where")).toBe('departement="75" and commune="056"');
  });
});

describe("the price_destination job keeps the place's tourist tax", () => {
  let db: Db;
  let close: () => void;
  beforeEach(() => ({ db, close } = createTestDb()));
  afterEach(() => close());

  const answer = (tax: { perPersonNightEur: number; maxNights: number; note: string }) =>
    (async () => ({
      prices: Object.fromEntries(["groceriesPerDay", "cheapMeal", "midMeal", "drink", "clubEntry", "preDrinks", "transitTicket", "transitDayPass", "taxiStart", "taxiPerKm", "parkingPerDay", "carRentalPerDay", "fuelPerL"].map((key) => [key, 10])),
      activities: [],
      touristTax: tax,
    })) as unknown as AskFn;

  async function price(destinationId: string, tripId: string, deps: Partial<PriceDestinationDeps>) {
    const all: PriceDestinationDeps = { ask: answer({ perPersonNightEur: 3, maxNights: 5, note: "the AI's" }), levels: async () => null, findPlace: async () => null, franceTax: async () => null, route: async () => null, transit: async () => null, rental: async () => null, fuel: noBulletin, ...deps };
    enqueueJob(db, { tripId, type: "price_destination", payload: { parent: "p", destinationId } });
    await processNextJob(db, { price_destination: createPriceDestinationHandler(all) }, { policy: { maxRetries: 0, backoffMs: [0] } });
    return all;
  }

  it("takes France's own rates for a French destination, the table's for Barcelona, the AI's elsewhere", async () => {
    const { tripId, destinations } = await enterScenario(db);
    const parisDestination = await addDestination(db, tripId, { place: paris, budgetLevel: "medium", objective: "culture" });
    const rome = await addDestination(db, tripId, { place: { label: "Rome, Italy", countryCode: "IT", lat: 41.9028, lon: 12.4964, airports: ["FCO"] }, budgetLevel: "medium", objective: "culture" });
    const franceTax = vi.fn(async () => ruleFromDelta(PARIS_ROWS, 2027));

    await price(parisDestination.id, tripId, { franceTax });
    await price(destinations.bcn.id, tripId, { franceTax });
    await price(rome.id, tripId, { franceTax, ask: answer({ perPersonNightEur: 6, maxNights: 10, note: "Rome's tax for a flat, 10 nights at most" }) });

    expect(franceTax).toHaveBeenCalledTimes(1);
    expect(localPricesOf(db, parisDestination.id)!.touristTax).toMatchObject({ source: "open-data", percentOfPrice: 16.25 });
    expect(localPricesOf(db, destinations.bcn.id)!.touristTax).toMatchObject({ source: "config", perPersonNightEur: 9.5 });
    expect(localPricesOf(db, rome.id)!.touristTax).toMatchObject({ source: "ai", perPersonNightEur: 6, maxNights: 10, label: "Rome: Rome's tax for a flat, 10 nights at most" });
  });

  it("an Airbnb in Barcelona adds the tax, an Airbnb in Paris does not (task.md T8.5)", async () => {
    const { tripId, destinations } = await enterScenario(db);
    const parisDestination = await addDestination(db, tripId, { place: paris, budgetLevel: "medium", objective: "culture" });
    await price(destinations.bcn.id, tripId, {});
    await price(parisDestination.id, tripId, { franceTax: async () => ruleFromDelta(PARIS_ROWS, 2027) });

    const addStay = (destinationId: string, touristTax: PageTax) =>
      db.insert(schema.stayOptions).values({ destinationId, provider: "airbnb", title: "Flat", capacity: 3, checkIn: "2027-08-26", checkOut: "2027-09-05", totalPriceEur: 1500, rawJson: JSON.stringify({ touristTax }) }).returning().get();
    // As T8.2 read them: no Taxes line and a host who says nothing; Airbnb's Taxes line in Paris (€170 for 10 nights, 3 people)
    const barcelonaFlat = addStay(destinations.bcn.id, page({}));
    const parisFlat = addStay(parisDestination.id, page({ included: true, amountEur: 170, basis: "airbnb-collects" }));

    expect(touristTaxOfStay(db, barcelonaFlat.id)).toEqual({ perNightEur: 9.5, maxNights: 7, included: false, source: "config" });
    expect(touristTaxOfStay(db, parisFlat.id)).toEqual({ perNightEur: 5.67, maxNights: null, included: true, source: "page" });
  });
});
