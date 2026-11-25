import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ConflictError, FieldError, NotFoundError } from "@/server/errors";
import { startCompute } from "@/server/services/compute";
import { getDashboard } from "@/server/services/dashboard";
import { clearSelection, setSelection } from "@/server/services/selections";
import { compareStays, getHousingView, getOrRequestStayAnalysis, listStays } from "@/server/services/stays";
import { getTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, forgetRatings, rateStaysAsAi, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

async function computed() {
  const scenario = await enterScenario(db);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, fixtureAdapters());
  return scenario;
}

function housing(tripId: string, destinationId?: string) {
  const view = getHousingView(db, tripId, destinationId);
  expect(view?.kind).toBe("ready");
  return view as Extract<NonNullable<typeof view>, { kind: "ready" }>;
}

const stayOf = (destinationId: string, provider: "airbnb" | "booking") =>
  db.select().from(schema.stayOptions).all().find((s) => s.destinationId === destinationId && s.provider === provider)!;
const optionOf = (destinationId: string, originKey: string, variant: string) =>
  db.select().from(schema.transportOptions).all().find((o) => o.destinationId === destinationId && o.originKey === originKey && o.variant === variant)!;

describe("getHousingView", () => {
  it("is not ready for a trip that was not computed, and null for an unknown one", async () => {
    const { tripId } = await enterScenario(db);
    expect(getHousingView(db, tripId)).toMatchObject({ kind: "not-ready", status: "draft" });
    expect(getHousingView(db, "doesnotexist")).toBeNull();
  });

  it("opens on the recommended destination, with a column for Airbnb and one for hotels", async () => {
    const { tripId, destinations } = await computed();
    const view = housing(tripId);
    expect(view.selectedId).toBe(destinations.bcn.id);
    expect(view.columns.map((c) => [c.provider, c.label, c.stays.length])).toEqual([["airbnb", "Airbnb", 1], ["booking", "Hotel", 1]]);
    expect(view.destinations.map((d) => d.shortLabel)).toEqual(["Barcelona", "Réunion", "Mont-Saxonnex"]);
  });

  it("shows another destination when asked, and keeps an empty column when a source has nothing there", async () => {
    const { tripId, destinations } = await computed();
    const view = housing(tripId, destinations.run.id);
    expect(view.selectedId).toBe(destinations.run.id);
    expect(view.columns.map((c) => c.stays.length)).toEqual([1, 0]);
    expect(housing(tripId, "nope").selectedId).toBe(destinations.bcn.id);
  });

  it("describes an offer: rooms, beds, nights, total, per guest and per guest and night (the mockup's figures)", async () => {
    const { tripId } = await computed();
    const [apartment] = housing(tripId).columns[0].stays;
    expect(apartment).toMatchObject({
      title: "Gràcia apartment, 2 bedrooms, 3 beds", rooms: 2, beds: 3, capacity: 3, nights: 10,
      totalEur: 900, perGuestEur: 300, perGuestNightEur: 30, fits: true, hearted: false,
    });
  });

  it("colours the offers against each other: the cheapest green, the dearest red", async () => {
    const { tripId } = await computed();
    const [airbnb, hotel] = housing(tripId).columns.map((c) => c.stays[0]);
    expect([airbnb.color, hotel.color]).toEqual(["green", "red"]);
    expect([hotel.totalEur, hotel.perGuestEur, hotel.perGuestNightEur]).toEqual([1200, 400, 40]);
  });

  it("says what each guest would pay with each offer, its own Extra included: the hotel puts Jessy at 1,106 € (B.1 step 6, D.6)", async () => {
    const { tripId } = await computed();
    const [airbnb, hotel] = housing(tripId).columns.map((c) => c.stays[0]);
    // The hotel: 100 € more of housing each, and no kitchen nor the flat's tax: what its ❤ then shows
    expect(hotel.impact.find((i) => i.name === "Jessy")).toMatchObject({ costEur: 1106, tier: "over" });
    expect(hotel.impact.find((i) => i.name === "Martin")).toMatchObject({ tier: "over" });
    expect(airbnb.impact.find((i) => i.name === "Jessy")).toMatchObject({ costEur: 812, tier: "over" });
    expect(hotel.impact.map((i) => i.name)).toEqual(["Martin", "Chloé", "Jessy"]);
  });

  it("names the offer the budget uses by default", async () => {
    const { tripId } = await computed();
    const view = housing(tripId);
    expect(view.defaultStayId).toBe(view.columns[0].stays[0].id);
  });

  it("sorts a column by the fit score the AI gave while the trip was set up, then by price (B-S4)", async () => {
    const { tripId, destinations } = await computed();
    const cheap = stayOf(destinations.bcn.id, "airbnb");
    const [dear] = db.insert(schema.stayOptions).values({
      destinationId: destinations.bcn.id, provider: "airbnb", externalId: "x-dear", title: "Dear but great",
      capacity: 4, checkIn: "2027-08-26", checkOut: "2027-09-05", totalPriceEur: 1500,
    }).returning().all();
    const [alsoCheap] = db.insert(schema.stayOptions).values({
      destinationId: destinations.bcn.id, provider: "airbnb", externalId: "x-cheap2", title: "Cheap and unrated",
      capacity: 3, checkIn: "2027-08-26", checkOut: "2027-09-05", totalPriceEur: 700,
    }).returning().all();
    rateStaysAsAi(db, tripId, destinations.bcn.id, [[dear.id, 90, "good"], [cheap.id, 60, "ok"]]);

    const titles = housing(tripId).columns[0].stays.map((s) => s.title);
    // 90, 60, then the one nobody rated
    expect(titles).toEqual(["Dear but great", "Gràcia apartment, 2 bedrooms, 3 beds", "Cheap and unrated"]);
    expect(alsoCheap.id).toBeTruthy();
    expect(housing(tripId).columns[0].stays[0]).toMatchObject({ fitScore: 90, verdict: "good", ratedBy: "ai" });
  });

  it("still counts an old analysis on a trip that was set up before the ratings existed", async () => {
    const { tripId, destinations } = await computed();
    forgetRatings(db);
    const apartment = stayOf(destinations.bcn.id, "airbnb");
    const hotel = stayOf(destinations.bcn.id, "booking");
    db.insert(schema.stayAnalyses).values({ stayId: hotel.id, verdict: "good", fitScore: 84, summary: "Nice", inputHash: "h" }).run();

    const [airbnb, booking] = housing(tripId).columns.map((c) => c.stays[0]);
    expect(booking).toMatchObject({ fitScore: 84, verdict: "good", ratedBy: null });
    expect(airbnb).toMatchObject({ id: apartment.id, fitScore: null, verdict: null, ratedBy: null });
  });

  it("flags an offer that does not sleep the whole group", async () => {
    const { tripId, destinations } = await computed();
    db.update(schema.stayOptions).set({ capacity: 2 }).where(eq(schema.stayOptions.id, stayOf(destinations.bcn.id, "booking").id)).run();
    expect(housing(tripId).columns[1].stays[0].fits).toBe(false);
  });
});

describe("setSelection: the accommodation's ❤ (B-S8)", () => {
  it("puts the group's ❤ on an offer, and the budget uses it", async () => {
    const { tripId, destinations } = await computed();
    const hotel = stayOf(destinations.bcn.id, "booking");
    const { selection } = setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotel.id });
    expect(selection).toMatchObject({ kind: "stay", stayOptionId: hotel.id, destinationId: destinations.bcn.id });

    const view = housing(tripId);
    expect(view.columns[1].stays[0].hearted).toBe(true);
    expect(view.columns[0].stays[0].hearted).toBe(false);
  });

  it("says the hotel puts Martin 277 € over budget (Jessy already was), and Barcelona stays red (B.4 #3, D.6)", async () => {
    const { tripId, destinations } = await computed();
    const { budget } = setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stayOf(destinations.bcn.id, "booking").id });
    expect(budget.warnings).toEqual(["Martin +277 €"]);
    expect(budget.perGuest.find((g) => g.after === 1106)).toMatchObject({ before: 812, tier: "over" });
    expect(budget.totalBefore).toBe(2697);
    // 300 € more of housing, and the Extra of a hotel: restaurants rather than groceries, its own tax
    expect(budget.totalAfter).toBe(3579);

    const home = getDashboard(db, tripId, destinations.bcn.id);
    expect(home?.kind === "ready" && home.budget.tier).toBe("over");
  });

  it("is unique per destination: a new ❤ replaces the old one", async () => {
    const { destinations } = await computed();
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stayOf(destinations.bcn.id, "booking").id });
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stayOf(destinations.bcn.id, "airbnb").id });
    const rows = db.select().from(schema.selections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].stayOptionId).toBe(stayOf(destinations.bcn.id, "airbnb").id);
  });

  it("takes a ❤ off, back to the default pick and its figures (B.1 step 6)", async () => {
    const { tripId, destinations } = await computed();
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stayOf(destinations.bcn.id, "booking").id });
    const { budget } = clearSelection(db, destinations.bcn.id, { kind: "stay" });
    expect(budget.warnings).toEqual([]);
    expect(budget.totalBefore).toBe(3579);
    expect(budget.totalAfter).toBe(2697);
    expect(budget.perGuest.find((g) => g.before === 1106)).toMatchObject({ after: 812, tier: "over" });
    expect(db.select().from(schema.selections).all()).toEqual([]);
    expect(housing(tripId).columns.flatMap((c) => c.stays).some((s) => s.hearted)).toBe(false);
  });

  it("changes nothing when there is no ❤ to take off", async () => {
    const { destinations } = await computed();
    const { budget } = clearSelection(db, destinations.bcn.id, { kind: "stay" });
    expect(budget.totalBefore).toBe(budget.totalAfter);
    expect(budget.warnings).toEqual([]);
  });

  it("only takes an offer of that destination, and an existing one", async () => {
    const { destinations } = await computed();
    const elsewhere = stayOf(destinations.run.id, "airbnb");
    const error = (() => { try { setSelection(db, destinations.bcn.id, { kind: "stay", optionId: elsewhere.id }); } catch (e) { return e; } })();
    expect(error).toBeInstanceOf(FieldError);
    expect(error).toMatchObject({ field: "optionId" });
    expect(() => setSelection(db, destinations.bcn.id, { kind: "stay", optionId: "doesnotexist" })).toThrow(FieldError);
    expect(() => setSelection(db, "doesnotexist", { kind: "stay", optionId: elsewhere.id })).toThrow(NotFoundError);
    expect(db.select().from(schema.selections).all()).toEqual([]);
  });
});

describe("setSelection: a guest's transport ❤ (A-S7, A.4 #4 and #5)", () => {
  it("goes from 1,023 € to 1,053 € for Martin, and from 2,697 € to 2,727 € in all, and back without it (D.6)", async () => {
    const { destinations, guests } = await computed();
    const tolls = optionOf(destinations.bcn.id, "madrid-spain", "tolls");
    const { budget } = setSelection(db, destinations.bcn.id, { kind: "transport", optionId: tolls.id, guestId: guests.martin.id });
    expect(budget.perGuest.find((g) => g.guestId === guests.martin.id)).toMatchObject({ before: 1023, after: 1053 });
    expect([budget.totalBefore, budget.totalAfter]).toEqual([2697, 2727]);
    // His core goes from 783 € to 813 €, over his 800 €: the ❤ puts him in the red
    expect(budget.warnings).toEqual(["Martin +13 €"]);

    const back = clearSelection(db, destinations.bcn.id, { kind: "transport", guestId: guests.martin.id }).budget;
    expect(back.perGuest.find((g) => g.guestId === guests.martin.id)).toMatchObject({ before: 1053, after: 1023 });
    expect([back.totalBefore, back.totalAfter]).toEqual([2727, 2697]);
  });

  it("is one per guest and destination, and leaves the others' ❤ alone", async () => {
    const { destinations, guests } = await computed();
    const tolls = optionOf(destinations.bcn.id, "madrid-spain", "tolls");
    const noTolls = optionOf(destinations.bcn.id, "madrid-spain", "no_tolls");
    const iberia = db.select().from(schema.transportOptions).all().find((o) => o.provider === "iberia")!;
    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: tolls.id, guestId: guests.martin.id });
    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: iberia.id, guestId: guests.jessy.id });
    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: noTolls.id, guestId: guests.martin.id });
    const rows = db.select().from(schema.selections).all();
    expect(rows.map((r) => [r.guestId, r.transportOptionId]).sort()).toEqual([[guests.jessy.id, iberia.id], [guests.martin.id, noTolls.id]].sort());
  });

  it("does not change the other guests' costs", async () => {
    const { destinations, guests } = await computed();
    const { budget } = setSelection(db, destinations.bcn.id, {
      kind: "transport", optionId: optionOf(destinations.bcn.id, "madrid-spain", "tolls").id, guestId: guests.martin.id,
    });
    const others = budget.perGuest.filter((g) => g.guestId !== guests.martin.id);
    expect(others.every((g) => g.before === g.after)).toBe(true);
  });

  it("refuses an option from where the guest does not live, a guest of another trip, and an option of another destination", async () => {
    const { destinations, guests } = await computed();
    const fromParis = db.select().from(schema.transportOptions).all().find((o) => o.destinationId === destinations.bcn.id && o.originKey === "paris-france")!;
    expect(() => setSelection(db, destinations.bcn.id, { kind: "transport", optionId: fromParis.id, guestId: guests.martin.id })).toThrow(FieldError);

    const other = await enterScenario(db);
    expect(() => setSelection(db, destinations.bcn.id, {
      kind: "transport", optionId: optionOf(destinations.bcn.id, "madrid-spain", "tolls").id, guestId: other.guests.martin.id,
    })).toThrow(expect.objectContaining({ field: "guestId" }));

    const toMont = optionOf(destinations.ms.id, "madrid-spain", "tolls");
    expect(() => setSelection(db, destinations.bcn.id, { kind: "transport", optionId: toMont.id, guestId: guests.martin.id })).toThrow(FieldError);
  });
});

describe("getOrRequestStayAnalysis (B-S6)", () => {
  const jobs = () => db.select().from(schema.jobs).all().filter((j) => j.type === "analyze_stay");

  it("gives the explanation with the score the stay was rated while the trip was set up", async () => {
    const { destinations, tripId } = await computed();
    const stay = stayOf(destinations.bcn.id, "airbnb");
    rateStaysAsAi(db, tripId, destinations.bcn.id, [[stay.id, 80, "good"]]);
    db.insert(schema.stayAnalyses).values({
      stayId: stay.id, verdict: "ok", fitScore: 55, prosJson: '["Central"]', consJson: '["Noisy"]', summary: "Nice", inputHash: "h",
    }).run();
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({
      state: "ready",
      analysis: { verdict: "good", fitScore: 80, ratedBy: "ai", explained: true, pros: ["Central"], cons: ["Noisy"], summary: "Nice" },
    });
    expect(jobs()).toHaveLength(0);
  });

  it("gives an old analysis as it is, on a trip that was set up before the ratings existed", async () => {
    const { destinations } = await computed();
    forgetRatings(db);
    const stay = stayOf(destinations.bcn.id, "airbnb");
    db.insert(schema.stayAnalyses).values({
      stayId: stay.id, verdict: "good", fitScore: 80, prosJson: '["Central"]', consJson: '["Noisy"]', summary: "Nice", inputHash: "h",
    }).run();
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({
      state: "ready", analysis: { verdict: "good", fitScore: 80, explained: true, pros: ["Central"], cons: ["Noisy"], summary: "Nice" },
    });
    expect(jobs()).toHaveLength(0);
  });

  it("asks for the explanation when there is none, and says it is pending, with the stored rating to show meanwhile", async () => {
    const { destinations, tripId } = await computed();
    const stay = stayOf(destinations.bcn.id, "booking");
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({
      state: "pending",
      previous: { ratedBy: "rules", explained: false, verdict: "bad", pros: [], cons: [] },
    });
    expect(jobs()).toHaveLength(1);
    expect(jobs()[0]).toMatchObject({ tripId, status: "queued", payloadJson: JSON.stringify({ stayId: stay.id }) });
  });

  it("has nothing to show meanwhile for a stay nobody rated", async () => {
    const { destinations } = await computed();
    forgetRatings(db);
    expect(getOrRequestStayAnalysis(db, stayOf(destinations.bcn.id, "booking").id)).toEqual({ state: "pending" });
  });

  it("does not ask twice while the request is on its way", async () => {
    const { destinations } = await computed();
    const stay = stayOf(destinations.bcn.id, "booking");
    getOrRequestStayAnalysis(db, stay.id);
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "pending" });
    db.update(schema.jobs).set({ status: "running" }).run();
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "pending" });
    expect(jobs()).toHaveLength(1);
  });

  it("is unavailable when the request just failed, and tries again after half an hour", async () => {
    const { destinations } = await computed();
    const stay = stayOf(destinations.bcn.id, "booking");
    getOrRequestStayAnalysis(db, stay.id);
    db.update(schema.jobs).set({ status: "failed" }).run();

    // The stored rating is still there to show
    expect(getOrRequestStayAnalysis(db, stay.id)).toMatchObject({ state: "unavailable", message: null, previous: { ratedBy: "rules", explained: false } });
    expect(jobs()).toHaveLength(1);

    const later = new Date(Date.now() + 31 * 60 * 1000);
    expect(getOrRequestStayAnalysis(db, stay.id, { now: later })).toMatchObject({ state: "pending" });
    expect(jobs()).toHaveLength(2);
  });

  it("rejects an unknown stay", () => {
    expect(() => getOrRequestStayAnalysis(db, "doesnotexist")).toThrow(NotFoundError);
  });
});

describe("the trip after ❤", () => {
  it("keeps the ❤ in the trip's data", async () => {
    const { tripId, destinations } = await computed();
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stayOf(destinations.bcn.id, "booking").id });
    expect(getTrip(db, tripId)).toBeTruthy();
    expect(db.select().from(schema.selections).where(eq(schema.selections.tripId, tripId)).all()).toHaveLength(1);
  });
});

/** The AI's rating of the two Barcelona offers, as it stores it while the trip is set up: the hotel 84, the apartment 62. */
function analyseBarcelona(tripId: string, destinationId: string) {
  rateStaysAsAi(db, tripId, destinationId, [
    [stayOf(destinationId, "booking").id, 84, "good"],
    [stayOf(destinationId, "airbnb").id, 62, "ok"],
  ]);
}

/** Two more Airbnb offers at Barcelona (400 € and 2,000 €), so that there is more than one of a source to page through. */
function addAirbnbOffers(destinationId: string) {
  const [base] = db.select().from(schema.stayOptions).all().filter((s) => s.destinationId === destinationId && s.provider === "airbnb");
  for (const [id, totalPriceEur] of [["extra-cheap", 400], ["extra-dear", 2000]] as const) {
    db.insert(schema.stayOptions).values({ ...base, id, externalId: id, title: `Offer ${totalPriceEur}`, totalPriceEur }).run();
  }
}

describe("listStays (GET /api/destinations/:id/stays, B-S4)", () => {
  it("lists a destination's offers best first: by the AI's fit score when it has given one", async () => {
    const { tripId, destinations } = await computed();
    analyseBarcelona(tripId, destinations.bcn.id);
    const page = listStays(db, destinations.bcn.id);
    expect(page.nextCursor).toBeNull();
    // The hotel scores 84 and the apartment 62, so the dearer one leads
    expect(page.items.map((s) => s.title)).toEqual(["Hotel Cuatro Naciones, 2 rooms", "Gràcia apartment, 2 bedrooms, 3 beds"]);
  });

  it("falls back to the price while nothing has rated them: the cheaper first", async () => {
    const { destinations } = await computed();
    forgetRatings(db);
    expect(listStays(db, destinations.bcn.id).items.map((s) => s.totalEur)).toEqual([900, 1200]);
  });

  it("gives the same card as the Housing page: figures, colour, ❤ and what each guest would pay", async () => {
    const { destinations, guests } = await computed();
    const apartment = listStays(db, destinations.bcn.id, { provider: "airbnb" }).items[0];
    expect(apartment).toMatchObject({ provider: "airbnb", totalEur: 900, perGuestEur: 300, perGuestNightEur: 30, nights: 10, fits: true, hearted: false });
    expect(apartment.impact.find((i) => i.guestId === guests.jessy.id)).toMatchObject({ costEur: 812, tier: "over" });
  });

  it("filters by source", async () => {
    const { destinations } = await computed();
    expect(listStays(db, destinations.bcn.id, { provider: "booking" }).items.map((s) => s.provider)).toEqual(["booking"]);
    expect(listStays(db, destinations.run.id, { provider: "booking" }).items).toEqual([]);
  });

  it("pages with a cursor, and says when there is no more", async () => {
    const { tripId, destinations } = await computed();
    forgetRatings(db);
    addAirbnbOffers(destinations.bcn.id);

    const first = listStays(db, destinations.bcn.id, { provider: "airbnb", limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = listStays(db, destinations.bcn.id, { provider: "airbnb", limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const all = [...first.items, ...second.items].map((s) => s.id);
    expect(new Set(all).size).toBe(3);
    expect(listStays(db, destinations.bcn.id, { provider: "airbnb" }).items.map((s) => s.totalEur)).toEqual([400, 900, 2000]);
    // Once the AI has rated the apartment (fit 62) it leads, and the two it has not seen follow, cheaper first
    analyseBarcelona(tripId, destinations.bcn.id);
    expect(listStays(db, destinations.bcn.id, { provider: "airbnb" }).items.map((s) => s.totalEur)).toEqual([900, 400, 2000]);
  });

  it("shows the ❤ on the group's pick", async () => {
    const { destinations } = await computed();
    const hotel = listStays(db, destinations.bcn.id, { provider: "booking" }).items[0];
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotel.id });
    expect(listStays(db, destinations.bcn.id).items.map((s) => [s.provider, s.hearted])).toEqual([["airbnb", false], ["booking", true]]);
  });

  it("refuses a cursor it did not give, an unknown destination and a trip not worked out", async () => {
    const { destinations } = await computed();
    expect(() => listStays(db, destinations.bcn.id, { cursor: "garbage" })).toThrow(FieldError);
    expect(() => listStays(db, destinations.bcn.id, { cursor: "-1" })).toThrow(FieldError);
    expect(() => listStays(db, "nope")).toThrow(NotFoundError);
  });

  it("has nothing to list for a trip that was not worked out", async () => {
    const { destinations } = await enterScenario(db);
    expect(() => listStays(db, destinations.bcn.id)).toThrow(ConflictError);
    expect(() => compareStays(db, destinations.bcn.id, ["a", "b"])).toThrow(ConflictError);
  });
});

describe("compareStays (GET /api/destinations/:id/stays/compare, B-S7)", () => {
  it("puts the offers side by side in the order asked, with what each would do to every guest (B.1 step 5)", async () => {
    const { destinations, guests } = await computed();
    const apartment = stayOf(destinations.bcn.id, "airbnb");
    const hotel = stayOf(destinations.bcn.id, "booking");
    const comparison = compareStays(db, destinations.bcn.id, [hotel.id, apartment.id]);

    expect(comparison.destinationId).toBe(destinations.bcn.id);
    expect(comparison.guests.map((g) => g.name)).toEqual(["Martin", "Chloé", "Jessy"]);
    expect(comparison.stays.map((s) => s.id)).toEqual([hotel.id, apartment.id]);

    const jessy = (index: number) => comparison.stays[index].impact.find((i) => i.guestId === guests.jessy.id)!;
    // The hotel puts Jessy at 1,106 €, its Extra included; the apartment at 812 € (D.6)
    expect(jessy(0)).toMatchObject({ costEur: 1106, tier: "over" });
    expect(jessy(1)).toMatchObject({ costEur: 812, tier: "over" });
  });

  it("accepts three offers", async () => {
    const { destinations } = await computed();
    addAirbnbOffers(destinations.bcn.id);
    const ids = db.select().from(schema.stayOptions).all().filter((s) => s.destinationId === destinations.bcn.id).map((s) => s.id).slice(0, 3);
    expect(compareStays(db, destinations.bcn.id, ids).stays).toHaveLength(3);
  });

  it("refuses an offer of another destination, an unknown one, and the same one twice", async () => {
    const { destinations } = await computed();
    const here = stayOf(destinations.bcn.id, "airbnb");
    const elsewhere = stayOf(destinations.run.id, "airbnb");
    expect(() => compareStays(db, destinations.bcn.id, [here.id, elsewhere.id])).toThrow(FieldError);
    expect(() => compareStays(db, destinations.bcn.id, [here.id, "nope"])).toThrow(FieldError);
    expect(() => compareStays(db, destinations.bcn.id, [here.id, here.id])).toThrow(/only be compared once/);
    expect(() => compareStays(db, "nope", [here.id, elsewhere.id])).toThrow(NotFoundError);
  });
});
