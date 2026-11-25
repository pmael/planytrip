import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeoPlace } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ScrapeError } from "@/scrapers/errors";
import { createSncfFares, parseFares } from "@/scrapers/transport/sncf-fares";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import type { Timetable } from "@/scrapers/transport/transitous";
import type { TrainJourney } from "@/scrapers/transport/train-types";
import { withObservedPrices } from "@/server/services/observedPrices";
import { ImportRefusedError, importPriceObservations, type ImportDeps } from "@/server/services/priceObservations";
import { searchTransport } from "@/server/services/search";
import { addDestination } from "@/server/services/destinations";
import { addGuest } from "@/server/services/guests";
import { loadTripScenarios } from "@/server/services/scenarios";
import { createTrip } from "@/server/services/trips";
import { getTransportView } from "@/server/services/transports";
import { toTransportOption } from "@/db/mappers";
import type { PriceObservationsBody } from "@/server/schemas";
import { createTestDb } from "./helpers/db";
import { journey, trainFixture } from "./helpers/trains";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => {
  close();
  vi.useRealTimers();
});

const toulouse: GeoPlace = { label: "Toulouse, France", countryCode: "FR", lat: 43.6047, lon: 1.4442, airports: ["TLS"] };
const lyon: GeoPlace = { label: "Lyon, France", countryCode: "FR", lat: 45.764, lon: 4.8357, airports: ["LYS"] };

const TOULOUSE = { name: "Toulouse Matabiau", lat: 43.6112, lon: 1.4536 };
const LYON = { name: "Lyon Part Dieu", lat: 45.7606, lon: 4.8594 };
const goingTo = (departAt: string, arriveAt: string, train = "TGV INOUI 6871") => journey({ departAt, arriveAt, train });
const comingBack = (departAt: string, arriveAt: string) => journey({ from: LYON, to: TOULOUSE, departAt, arriveAt });

/** SNCF Connect's page of 4 December, as the extension read it on 2026-10-24 at 19:40 (Paris) */
const CAPTURED = "2026-10-24T17:40:00.000Z";
const page = (over: Partial<PriceObservationsBody> = {}): PriceObservationsBody => ({
  source: "sncf-connect",
  capturedAt: CAPTURED,
  direction: "out",
  origin: "Toulouse",
  destination: "Lyon",
  date: "2026-12-04",
  offers: [
    { departTime: "07:37", arriveTime: "11:48", departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu", durationMin: 251, changes: 0, trainType: "TGV INOUI", price2ndEur: 66, price1stEur: 77, seatsAtPrice: [5] },
    { departTime: "15:42", arriveTime: "19:50", departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu", durationMin: 248, changes: 0, trainType: "TGV INOUI", price2ndEur: 101, price1stEur: 107, seatsAtPrice: [] },
    { departTime: "17:43", arriveTime: "21:38", departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu", durationMin: 235, changes: 0, trainType: "TGV INOUI", price2ndEur: 71, price1stEur: 97, seatsAtPrice: [] },
    { departTime: "06:51", arriveTime: "11:58", departStation: "Toulouse Matabiau", arriveStation: "Lyon Saint-Exupery TGV", durationMin: 307, changes: 2, trainType: "MIXED", price2ndEur: 49.5, price1stEur: 64.3, seatsAtPrice: [6] },
  ],
  ...over,
});
const backPage = (): PriceObservationsBody =>
  page({
    direction: "back",
    origin: "Lyon",
    destination: "Toulouse",
    date: "2026-12-06",
    offers: [{ departTime: "16:39", arriveTime: "20:39", departStation: "Lyon Part Dieu", arriveStation: "Toulouse Matabiau", durationMin: 240, changes: 0, trainType: "TGV INOUI", price2ndEur: 71, price1stEur: 97, seatsAtPrice: [] }],
  });

const stations: Record<string, { lat: number; lon: number }> = {
  "Toulouse Matabiau": { lat: 43.6112, lon: 1.4536 },
  "Lyon Part Dieu": { lat: 45.7606, lon: 4.8594 },
  "Lyon Saint-Exupery TGV": { lat: 45.7216, lon: 5.0766 },
};
const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  fareTable: async () => parseFares(trainFixture("sncf-fares.csv")),
  locate: async (name) => stations[name] ?? null,
  ...over,
});

/** Mael, from Toulouse, going to Lyon on 4 December: the trains the search found (07:37, 15:42, 17:43; back at 16:39 and 18:00) */
async function tripWithTrains() {
  const trip = createTrip(db);
  const { guest } = await addGuest(db, trip.id, { name: "Mael", homePlace: toulouse, maxBudgetEur: 400, availableFrom: "2026-12-04", availableTo: "2026-12-06", preferredMode: "train" });
  const destination = await addDestination(db, trip.id, { place: lyon, budgetLevel: "medium", objective: "none" });
  const timetable: Timetable = {
    journeys: async (_from, _to, day): Promise<TrainJourney[]> =>
      day === "2026-12-04"
        ? [goingTo("2026-12-04T07:37", "2026-12-04T11:48"), goingTo("2026-12-04T15:42", "2026-12-04T19:50", "TGV INOUI 6875"), goingTo("2026-12-04T17:43", "2026-12-04T21:38", "TGV INOUI 6879")]
        : [comingBack("2026-12-06T16:39", "2026-12-06T20:39"), comingBack("2026-12-06T18:00", "2026-12-06T22:00")],
  };
  const adapter = createTrainsAdapter({
    timetable,
    fares: [createSncfFares({ load: async () => trainFixture("sncf-fares.csv"), config: { positionInRange: 0.5 } })],
    now: () => new Date("2026-10-24T10:00:00Z"),
  });
  await searchTransport(db, { destinationId: destination.id, originKey: guest.originKey, mode: "train" }, [adapter]);
  return { tripId: trip.id, destinationId: destination.id, guestId: guest.id };
}

const observations = () => db.select().from(schema.priceObservations).all();
const optionAt = (time: string) => db.select().from(schema.transportOptions).all().find((o) => o.outDepartAt?.endsWith(time))!;

describe("importPriceObservations (T7.9: a page of SNCF Connect, matched with the trains the app found)", () => {
  it("stores every train of the page with its prices, and says how many were matched with a train of the app", async () => {
    await tripWithTrains();
    const result = await importPriceObservations(db, page(), deps());

    expect(result).toEqual({ saved: 4, matched: 3, duplicates: 0, skipped: 0 });
    expect(observations()).toHaveLength(4);
    const morning = observations().find((o) => o.departTime === "07:37")!;
    expect(morning).toMatchObject({
      source: "sncf-connect",
      capturedAt: CAPTURED,
      travelDate: "2026-12-04",
      daysBefore: 41,
      direction: "out",
      originLabel: "Toulouse",
      destinationLabel: "Lyon",
      departStation: "Toulouse Matabiau",
      arriveStation: "Lyon Part Dieu",
      arriveTime: "11:48",
      durationMin: 251,
      changes: 0,
      trainType: "TGV INOUI",
      price2ndEur: 66,
      price1stEur: 77,
    });
    expect(JSON.parse(morning.rawJson).offer.seatsAtPrice).toEqual([5]);
  });

  it("matches the 07:37 and the 17:43 with their options, and not the train with two changes that the search did not find", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    const byTime = (time: string) => observations().find((o) => o.departTime === time)!;

    expect(byTime("07:37").transportOptionId).toBe(optionAt("T07:37").id);
    expect(byTime("17:43").transportOptionId).toBe(optionAt("T17:43").id);
    expect(byTime("15:42").transportOptionId).toBe(optionAt("T15:42").id);
    expect(byTime("06:51").transportOptionId).toBeNull();
  });

  it("keeps what the app estimated for the train, before anything changes it, and how", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    // The middle of SNCF's range for Toulouse - Lyon (25.50 to 101 €), one way
    expect(observations().find((o) => o.departTime === "07:37")).toMatchObject({ estimateEur: 63, estimateMethod: "sncf-fares" });
    expect(observations().find((o) => o.departTime === "06:51")).toMatchObject({ estimateEur: null, estimateMethod: null });
  });

  it("gives SNCF's range to a direct TGV, and none to a journey with changes", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    expect(observations().find((o) => o.departTime === "07:37")).toMatchObject({ rangeMinEur: 25.5, rangeMaxEur: 101 });
    expect(observations().find((o) => o.departTime === "06:51")).toMatchObject({ rangeMinEur: null, rangeMaxEur: null });
  });

  it("measures the distance as the crow flies between the two stations: from the option when it is matched, from where the stations are when it is not", async () => {
    await tripWithTrains();
    const locate = vi.fn(async (name: string) => stations[name] ?? null);
    await importPriceObservations(db, page(), deps({ locate }));

    // Toulouse Matabiau to Lyon Part Dieu is about 360 km
    expect(observations().find((o) => o.departTime === "07:37")!.distanceKm).toBeGreaterThan(355);
    expect(observations().find((o) => o.departTime === "07:37")!.distanceKm).toBeLessThan(365);
    // To Lyon Saint-Exupéry, a little farther
    const bis = observations().find((o) => o.departTime === "06:51")!;
    expect(bis.distanceKm).toBeGreaterThan(365);
    expect(bis.distanceKm).toBeLessThan(385);
    expect(bis.distanceKm).toBeGreaterThan(observations().find((o) => o.departTime === "07:37")!.distanceKm!);
    // Only the train nobody matched needed the stations to be found
    expect(locate.mock.calls.map(([name]) => name).sort()).toEqual(["Lyon Saint-Exupery TGV", "Toulouse Matabiau"]);
  });

  it("keeps the same page once, and a page captured again as a new set of prices (they move, and that is the point)", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    expect(await importPriceObservations(db, page(), deps())).toEqual({ saved: 0, matched: 0, duplicates: 4, skipped: 0 });
    expect(observations()).toHaveLength(4);

    const later = await importPriceObservations(db, page({ capturedAt: "2026-10-25T09:00:00.000Z" }), deps());
    expect(later.saved).toBe(4);
    expect(observations()).toHaveLength(8);
    expect(observations().find((o) => o.capturedAt.startsWith("2026-10-25") && o.departTime === "07:37")!.daysBefore).toBe(40);
  });

  it("works without any trip: the prices are worth keeping for what they teach, matched with nothing", async () => {
    const result = await importPriceObservations(db, page(), deps());
    expect(result).toMatchObject({ saved: 4, matched: 0 });
    expect(observations().every((o) => o.transportOptionId === null)).toBe(true);
    // The distance and the range do not need an option
    expect(observations().find((o) => o.departTime === "07:37")).toMatchObject({ rangeMinEur: 25.5, rangeMaxEur: 101 });
    expect(observations().find((o) => o.departTime === "07:37")!.distanceKm).toBeGreaterThan(355);
  });

  it("does not take a train for another one a few hours away, nor one of another day", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page({ offers: [page().offers[0]].map((o) => ({ ...o, departTime: "07:41" })) }), deps());
    expect(observations()[0].transportOptionId).toBeNull();

    await importPriceObservations(db, page({ date: "2026-12-05", capturedAt: "2026-10-25T09:00:00.000Z", offers: [page().offers[0]] }), deps());
    expect(observations().find((o) => o.travelDate === "2026-12-05")!.transportOptionId).toBeNull();
  });

  it("matches a train that leaves two minutes apart, as the page and the timetable do not always agree to the minute", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page({ offers: [{ ...page().offers[0], departTime: "07:39" }] }), deps());
    expect(observations()[0].transportOptionId).toBe(optionAt("T07:37").id);
  });

  it("matches a page that names the city and not the station", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page({ offers: [{ ...page().offers[0], departStation: "Toulouse", arriveStation: "Lyon" }] }), deps());
    expect(observations()[0].transportOptionId).toBe(optionAt("T07:37").id);
  });

  it("cannot say which train a page is when it gives no station at all", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page({ offers: [{ ...page().offers[0], departStation: null, arriveStation: null }] }), deps());
    expect(observations()[0]).toMatchObject({ transportOptionId: null, departStation: "", distanceKm: null });
  });

  it("matches the way back of an option with a page of the way back", async () => {
    await tripWithTrains();
    await importPriceObservations(db, backPage(), deps());
    const [seen] = observations();
    expect(seen.direction).toBe("back");
    expect(seen.transportOptionId).not.toBeNull();
    expect(seen.estimateMethod).toBe("sncf-fares");
  });

  it("leaves out a train that shows no price, and still keeps the others", async () => {
    const result = await importPriceObservations(db, page({ offers: [{ ...page().offers[0], price2ndEur: null }, page().offers[1]] }), deps());
    expect(result).toMatchObject({ saved: 1, skipped: 1 });
  });

  it("does not store the lines of the extension's own preview, which it once read as trains", async () => {
    const preview = { ...page().offers[0], departStation: "→ 08:14 · TGV INOUI · 0 corr. · 51 € (1re 74 €)", arriveStation: null, durationMin: null, changes: null };
    const result = await importPriceObservations(db, page({ offers: [page().offers[0], preview] }), deps());
    expect(result).toMatchObject({ saved: 1, skipped: 1 });
    expect(observations().map((o) => o.departStation)).toEqual(["Toulouse Matabiau"]);
  });

  it("does not fail for want of SNCF's file or of a way to find the stations: the prices are kept without them", async () => {
    const result = await importPriceObservations(db, page(), deps({ fareTable: async () => Promise.reject(new Error("offline")), locate: async () => Promise.reject(new ScrapeError("down")) }));
    expect(result.saved).toBe(4);
    expect(observations().every((o) => o.rangeMinEur === null && o.distanceKm === null)).toBe(true);
  });

  it("refuses a train that has already left: its price says nothing of a trip to come", async () => {
    await expect(importPriceObservations(db, page({ date: "2026-10-23" }), deps())).rejects.toBeInstanceOf(ImportRefusedError);
    await expect(importPriceObservations(db, page({ date: "2026-10-23" }), deps())).rejects.toThrow(/déjà passé/);
    expect(observations()).toHaveLength(0);
  });

  it("keeps the observation when the option it was matched with goes away", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    db.delete(schema.transportOptions).where(eq(schema.transportOptions.id, optionAt("T07:37").id)).run();
    const seen = observations().find((o) => o.departTime === "07:37")!;
    expect(seen.transportOptionId).toBeNull();
    expect(seen.price2ndEur).toBe(66);
  });
});

describe("withObservedPrices (T7.9 P1.4: the price the person saw on SNCF Connect, on the cards)", () => {
  const options = () => db.select().from(schema.transportOptions).all().map(toTransportOption);
  const at = (list: ReturnType<typeof options>, time: string) => list.find((o) => o.outDepartAt?.endsWith(time))!;
  /** Two hours after the capture */
  const twoHoursLater = new Date("2026-10-24T19:40:00.000Z");

  it("prices the way there as it was seen, and says the way back is still an estimate", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());

    const morning = at(withObservedPrices(db, options(), twoHoursLater), "T07:37");
    // 66 € seen for the way there, the way back still the middle of SNCF's range (63 €)
    expect(morning).toMatchObject({ priceEur: 129, priceKind: "estimated" });
    expect(morning.priceNote).toBe("Aller vu sur SNCF Connect il y a 2 h · SNCF's published fares for this route: 26 to 101 € one way");
  });

  it("is an observed price, and says so, when both ways were seen: 66 € there and 71 € back, and not the 126 € estimated", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    await importPriceObservations(db, backPage(), deps());

    expect(at(options(), "T07:37").priceEur).toBe(126);
    const morning = at(withObservedPrices(db, options(), twoHoursLater), "T07:37");
    expect(morning).toMatchObject({ priceEur: 137, priceKind: "observed", priceNote: "vu sur SNCF Connect il y a 2 h" });
    // The other trains of that day were seen at their own prices: 101 € for the 15:42, 71 € for the 17:43
    expect(at(withObservedPrices(db, options(), twoHoursLater), "T15:42").priceEur).toBe(172);
    expect(at(withObservedPrices(db, options(), twoHoursLater), "T17:43").priceEur).toBe(142);
  });

  it("goes back to the estimate after a day: older observations are only kept for training", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    await importPriceObservations(db, backPage(), deps());

    const dayLater = new Date("2026-10-25T17:41:00.000Z");
    expect(at(withObservedPrices(db, options(), dayLater), "T07:37")).toMatchObject({ priceEur: 126, priceKind: "estimated" });
    const justBefore = new Date("2026-10-25T17:39:00.000Z");
    expect(at(withObservedPrices(db, options(), justBefore), "T07:37")).toMatchObject({ priceEur: 137, priceKind: "observed" });
    expect(observations()).toHaveLength(5);
  });

  it("takes the latest of two captures", async () => {
    await tripWithTrains();
    await importPriceObservations(db, page(), deps());
    await importPriceObservations(db, backPage(), deps());
    const cheaper = page({ capturedAt: "2026-10-24T18:30:00.000Z" });
    cheaper.offers[0].price2ndEur = 49;
    await importPriceObservations(db, cheaper, deps());

    const morning = at(withObservedPrices(db, options(), twoHoursLater), "T07:37");
    expect(morning.priceEur).toBe(49 + 71);
    // The older of the two captures that priced it is what the label says
    expect(morning.priceNote).toBe("vu sur SNCF Connect il y a 2 h");
  });

  it("leaves alone what no observation concerns, and what is not a train", async () => {
    await tripWithTrains();
    const before = options();
    expect(withObservedPrices(db, before, twoHoursLater)).toBe(before);

    await importPriceObservations(db, page({ date: "2026-12-20", capturedAt: CAPTURED }), deps());
    expect(withObservedPrices(db, before, twoHoursLater)).toBe(before);
    const plane = { ...before[0], mode: "plane" as const };
    expect(withObservedPrices(db, [plane], twoHoursLater)).toEqual([plane]);
  });

  it("is on the dashboard's cards, and in what a guest pays, for the day it is fresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T19:40:00.000Z"));
    const { tripId, destinationId, guestId } = await tripWithTrains();
    db.update(schema.trips).set({ status: "ready" }).where(eq(schema.trips.id, tripId)).run();
    await importPriceObservations(db, page(), deps());
    await importPriceObservations(db, backPage(), deps());

    const scenarios = loadTripScenarios(db, tripId)!;
    expect(scenarios.options.find((o) => o.outDepartAt?.endsWith("T07:37"))).toMatchObject({ priceEur: 137, priceKind: "observed" });

    const view = getTransportView(db, tripId, { destinationId, guestId });
    expect(view?.kind).toBe("ready");
    const column = (view as Extract<NonNullable<typeof view>, { kind: "ready" }>).columns.find((c) => c.mode === "train")!;
    const card = [column.cheapest, column.practical, ...column.more].find((c) => c?.out.departTime === "07:37")!;
    expect(card).toMatchObject({ costEur: 137, priceKind: "observed", priceNote: "vu sur SNCF Connect il y a 2 h" });

    vi.setSystemTime(new Date("2026-10-26T19:40:00.000Z"));
    expect(loadTripScenarios(db, tripId)!.options.find((o) => o.outDepartAt?.endsWith("T07:37"))).toMatchObject({ priceEur: 126, priceKind: "estimated" });
  });
});
