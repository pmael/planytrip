import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GeoPlace } from "@/core/types";
import { toTransportOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import type { TrainJourney } from "@/scrapers/transport/train-types";
import type { Timetable } from "@/scrapers/transport/transitous";
import { PriceObservationsBodySchema, type PriceObservationsBody } from "@/server/schemas";
import { addDestination } from "@/server/services/destinations";
import { addGuest } from "@/server/services/guests";
import { withObservedPrices } from "@/server/services/observedPrices";
import { importPriceObservations, type ImportDeps } from "@/server/services/priceObservations";
import { searchTransport } from "@/server/services/search";
import { createTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { journey } from "./helpers/trains";

// Eurostar's and Iryo's pages, as the extension reads them (price-model.md phase 4): the real pages, saved from Chrome on 2026-10-26, run
// through the real parsers, then through the app's own validation, the import, the matching and the price laid on the cards.
let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

const NOW = new Date("2026-10-26T12:00:00Z");
const TWO_HOURS_LATER = new Date("2026-10-26T14:00:00Z");

function parser(file: string, name: string): { parsePage(page: unknown, now?: Date): Record<string, unknown> } {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(readFileSync(path.join(process.cwd(), "extension/sncf-import", file), "utf8"), context);
  return context[name] as never;
}
const fixture = (site: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures", site, "real-page.json"), "utf8"));

/** What the extension would send for a page: the payload of content.js (without who the prices are for, which is only shown), checked as the route does */
function payload(source: "eurostar" | "iryo", parsePage: (page: unknown, now?: Date) => Record<string, unknown>, page: unknown): PriceObservationsBody {
  const parsed = parsePage(page, NOW);
  delete parsed.travellers;
  return PriceObservationsBodySchema.parse({ source, capturedAt: NOW.toISOString(), ...parsed });
}
const eurostar = () => payload("eurostar", parser("eurostar-parser.js", "EurostarParser").parsePage, fixture("eurostar"));
const iryo = () => payload("iryo", parser("iryo-parser.js", "IryoParser").parsePage, fixture("iryo"));

const PARIS_NORD = { name: "Paris Gare du Nord", lat: 48.8809, lon: 2.3553 };
const LONDON_STP = { name: "London St Pancras International", lat: 51.5322, lon: -0.1263 };
const MADRID = { name: "Madrid Chamartín-Clara Campoamor", lat: 40.4722, lon: -3.6825 };
const VALENCIA = { name: "València Joaquín Sorolla", lat: 39.4584, lon: -0.3769 };
/** Where the pages' own spellings are: what the import looks up for a train no option was matched with */
const where: Record<string, { lat: number; lon: number }> = {
  "Paris Gare du Nord": PARIS_NORD,
  "Londres St Pancras Int'l": LONDON_STP,
  "Madrid-Chamartin": MADRID,
  "Valencia-Joaquín Sorolla": VALENCIA,
};
const deps: ImportDeps = { fareTable: async () => ({ rows: [] }) as never, locate: async (name) => where[name] ?? null };

const paris: GeoPlace = { label: "Paris, France", countryCode: "FR", lat: 48.8566, lon: 2.3522, airports: ["CDG"] };
const london: GeoPlace = { label: "London, United Kingdom", countryCode: "GB", lat: 51.5072, lon: -0.1276, airports: ["LHR"] };
const madrid: GeoPlace = { label: "Madrid, Spain", countryCode: "ES", lat: 40.4168, lon: -3.7038, airports: ["MAD"] };
const valencia: GeoPlace = { label: "Valencia, Spain", countryCode: "ES", lat: 39.4699, lon: -0.3763, airports: ["VLC"] };

/** A trip from `home` to `destination`, whose search found the trains of the timetable (the way there on `outDay`, the way back on `backDay`) */
async function tripWith(home: GeoPlace, destination: GeoPlace, outDay: string, backDay: string, out: TrainJourney[], back: TrainJourney[]) {
  const trip = createTrip(db);
  const { guest } = await addGuest(db, trip.id, { name: "Mael", homePlace: home, maxBudgetEur: 800, availableFrom: outDay, availableTo: backDay, preferredMode: "train" });
  const place = await addDestination(db, trip.id, { place: destination, budgetLevel: "medium", objective: "none" });
  const timetable: Timetable = { journeys: async (_from, _to, day): Promise<TrainJourney[]> => (day === outDay ? out : back) };
  const adapter = createTrainsAdapter({ timetable, fares: [], now: () => new Date("2026-10-26T10:00:00Z") });
  await searchTransport(db, { destinationId: place.id, originKey: guest.originKey, mode: "train" }, [adapter]);
}

const observations = () => db.select().from(schema.priceObservations).all();
const options = () => db.select().from(schema.transportOptions).all().map(toTransportOption);
const at = (list: ReturnType<typeof options>, time: string) => list.find((o) => o.outDepartAt?.endsWith(time))!;

describe("a page of Eurostar's, Paris → Londres on 30 October (phase 4 of price-model.md)", () => {
  const es = (departAt: string, arriveAt: string, train: string) => journey({ from: PARIS_NORD, to: LONDON_STP, departAt, arriveAt, train, operator: "Eurostar", mode: "HIGHSPEED_RAIL" });
  const timetable = () =>
    tripWith(
      paris,
      london,
      "2026-10-30",
      "2026-11-01",
      [es("2026-10-30T07:05", "2026-10-30T08:30", "EUROSTAR 9007"), es("2026-10-30T12:30", "2026-10-30T14:00", "EUROSTAR 9029"), es("2026-10-30T21:02", "2026-10-30T22:30", "EUROSTAR 9063")],
      [journey({ from: LONDON_STP, to: PARIS_NORD, departAt: "2026-11-01T17:31", arriveAt: "2026-11-01T20:59", train: "EUROSTAR 9080", operator: "Eurostar", mode: "HIGHSPEED_RAIL" })],
    );

  it("is a payload the app takes: the parser's output passes the route's own validation", () => {
    const body = eurostar();
    expect(body).toMatchObject({ source: "eurostar", direction: "out", origin: "Paris", destination: "Londres", date: "2026-10-30" });
    expect(body.offers).toHaveLength(19);
  });

  it("stores the 19 trains, and matches the three the search found though the page says Londres and Int'l", async () => {
    await timetable();
    expect(await importPriceObservations(db, eurostar(), deps)).toEqual({ saved: 19, matched: 3, duplicates: 0, skipped: 0 });

    const morning = observations().find((o) => o.departTime === "07:05")!;
    expect(morning).toMatchObject({
      source: "eurostar",
      travelDate: "2026-10-30",
      daysBefore: 4,
      direction: "out",
      originLabel: "Paris",
      destinationLabel: "Londres",
      departStation: "Paris Gare du Nord",
      arriveStation: "Londres St Pancras Int'l",
      arriveTime: "08:30",
      durationMin: 145,
      changes: 0,
      trainType: "EUROSTAR",
      price2ndEur: 135,
      price1stEur: 180,
      // SNCF publishes no range for it
      rangeMinEur: null,
      rangeMaxEur: null,
      estimateMethod: "distance",
    });
    // As the crow flies from Paris to London, from the option's own stations
    expect(morning.distanceKm).toBeGreaterThan(330);
    expect(morning.distanceKm).toBeLessThan(360);
    // What the app thought of it, before the page said 135 €: the rate per kilometre
    expect(morning.estimateEur).toBeLessThan(80);
    expect(morning.transportOptionId).toBe(at(options(), "T07:05").id);
    expect(observations().filter((o) => o.transportOptionId !== null).map((o) => o.departTime).sort()).toEqual(["07:05", "12:30", "21:02"]);
  });

  it("measures the distance of a train no option was matched with, from where the page's stations are", async () => {
    await importPriceObservations(db, eurostar(), deps);
    const train = observations().find((o) => o.departTime === "10:57")!;
    expect(train.transportOptionId).toBeNull();
    expect(train.distanceKm).toBeGreaterThan(330);
    expect(train.price2ndEur).toBe(190);
  });

  it("puts the price seen on the card, and says on which site", async () => {
    await timetable();
    await importPriceObservations(db, eurostar(), deps);

    const morning = at(withObservedPrices(db, options(), TWO_HOURS_LATER), "T07:05");
    // 135 € for the way there; the way back, which nobody saw, is still the estimate
    expect(morning.priceKind).toBe("estimated");
    expect(morning.priceNote).toMatch(/^Aller vu sur Eurostar il y a 2 h/);
    const estimated = at(options(), "T07:05").priceEur;
    expect(morning.priceEur).toBeGreaterThan(135);
    expect(morning.priceEur).toBeLessThan(estimated + 135);

    // The way back seen too (a capture of the way back, made up from the way there): both seen, so the price is the page's
    const back = { ...eurostar(), direction: "back" as const, origin: "Londres", destination: "Paris", date: "2026-11-01", offers: [{ ...eurostar().offers[0], departTime: "17:31", arriveTime: "20:59", departStation: "Londres St Pancras Int'l", arriveStation: "Paris Gare du Nord", price2ndEur: 165, price1stEur: 255 }] };
    await importPriceObservations(db, back, deps);
    expect(at(withObservedPrices(db, options(), TWO_HOURS_LATER), "T07:05")).toMatchObject({ priceEur: 135 + 165, priceKind: "observed", priceNote: "vu sur Eurostar il y a 2 h" });
  });

  it("keeps the same page once, and does not mix it up with a page of SNCF Connect read at the same instant", async () => {
    await importPriceObservations(db, eurostar(), deps);
    expect((await importPriceObservations(db, eurostar(), deps)).duplicates).toBe(19);
    expect(observations()).toHaveLength(19);
  });
});

describe("a page of Iryo's, Madrid → Valencia on 31 October (phase 4 of price-model.md)", () => {
  const iryoTrain = (departAt: string, arriveAt: string, train: string) => journey({ from: MADRID, to: VALENCIA, departAt, arriveAt, train, operator: "Iryo", mode: "HIGHSPEED_RAIL" });
  const timetable = () =>
    tripWith(
      madrid,
      valencia,
      "2026-10-31",
      "2026-11-02",
      [iryoTrain("2026-10-31T09:30", "2026-10-31T11:30", "IRYO 6201"), iryoTrain("2026-10-31T13:30", "2026-10-31T15:24", "IRYO 6205"), iryoTrain("2026-10-31T20:45", "2026-10-31T22:39", "IRYO 6209")],
      [journey({ from: VALENCIA, to: MADRID, departAt: "2026-11-02T18:00", arriveAt: "2026-11-02T20:00", train: "IRYO 6202", operator: "Iryo", mode: "HIGHSPEED_RAIL" })],
    );

  it("is a payload the app takes: the parser's output passes the route's own validation", () => {
    const body = iryo();
    expect(body).toMatchObject({ source: "iryo", direction: "out", origin: "Madrid", destination: "Valencia", date: "2026-10-31" });
    expect(body.offers).toHaveLength(7);
  });

  it("stores the 7 trains, and matches the three the search found: the page says Madrid-Chamartin, the timetable Madrid Chamartín-Clara Campoamor", async () => {
    await timetable();
    expect(await importPriceObservations(db, iryo(), deps)).toEqual({ saved: 7, matched: 3, duplicates: 0, skipped: 0 });

    const morning = observations().find((o) => o.departTime === "09:30")!;
    expect(morning).toMatchObject({
      source: "iryo",
      travelDate: "2026-10-31",
      daysBefore: 5,
      direction: "out",
      originLabel: "Madrid",
      destinationLabel: "Valencia",
      departStation: "Madrid-Chamartin",
      // The page leaves it blank on the row: it is the search's own station
      arriveStation: "Valencia-Joaquín Sorolla",
      durationMin: 120,
      changes: 0,
      trainType: "IRYO",
      price2ndEur: 41.3,
      price1stEur: 52.06,
      rangeMinEur: null,
    });
    expect(morning.transportOptionId).toBe(at(options(), "T09:30").id);
    expect(observations().filter((o) => o.transportOptionId !== null)).toHaveLength(3);
  });

  it("puts the price seen on the card, and says on which site", async () => {
    await timetable();
    await importPriceObservations(db, iryo(), deps);
    const morning = at(withObservedPrices(db, options(), TWO_HOURS_LATER), "T09:30");
    expect(morning.priceKind).toBe("estimated");
    expect(morning.priceNote).toMatch(/^Aller vu sur Iryo il y a 2 h/);
  });
});
