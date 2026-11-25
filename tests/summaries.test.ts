import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SummaryDocument } from "@/components/SummaryDocument";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ConflictError, FieldError, NotFoundError } from "@/server/errors";
import { startCompute } from "@/server/services/compute";
import { askExtraAdvice } from "@/server/services/extraAdvice";
import { setFavoriteDestination } from "@/server/services/guests";
import { setSelection } from "@/server/services/selections";
import { deleteSummary, getSummary, latestSummaryId, priceChangesOf, SummarySnapshotSchema, validateDestination, type SummarySnapshot } from "@/server/services/summaries";
import { getTrip } from "@/server/services/trips";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

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

const statusOf = (tripId: string) => getTrip(db, tripId)!.status;
const guestOf = (snapshot: SummarySnapshot, name: string) => snapshot.guests.find((g) => g.name === name)!;
const hotelOf = (destinationId: string) => db.select().from(schema.stayOptions).all().find((s) => s.destinationId === destinationId && s.provider === "booking")!;

describe("validateDestination (C-S7)", () => {
  it("freezes Barcelona's scenario: the totals, the dates, what each guest pays and the offers behind it", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    const { snapshot } = summary;

    expect(SummarySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(summary).toMatchObject({ tripId, destinationId: destinations.bcn.id, totalEur: 2697 });
    expect(snapshot.destination).toMatchObject({ shortLabel: "Barcelona", objective: "partying", inScope: true });
    expect(snapshot.dates).toEqual({ from: "2027-08-26", to: "2027-09-05", nights: 10 });
    expect(snapshot.totals).toMatchObject({ totalEur: 2697, tier: "over", includesFallback: false, complete: true });
    // The closest, not a recommendation: Jessy is over budget once the Extra counts (D.4)
    expect(snapshot.ranking).toMatchObject({ rank: 1, eligible: false, recommended: false, blockers: [{ kind: "over", name: "Jessy", overBudgetEur: 172 }] });

    // The 3 per-guest costs of the acceptance criterion C.4 #5, with the Extra (D.6), and the Extra frozen with them
    expect(snapshot.guests.map((g) => [g.name, g.costEur])).toEqual([["Martin", 1023], ["Chloé", 862], ["Jessy", 812]]);
    expect(snapshot.guests.map((g) => [g.name, g.mandatoryEur, g.plusEur])).toEqual([["Martin", 338, 240], ["Chloé", 202, 240], ["Jessy", 202, 240]]);
    expect(snapshot.housing).toMatchObject({ title: "Gràcia apartment, 2 bedrooms, 3 beds", provider: "airbnb", totalEur: 900, perGuestEur: 300, nights: 10, chosenByGroup: false });
  });

  it("keeps each guest's way of getting there with its price, times and comfort", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.bcn.id);

    expect(guestOf(snapshot, "Jessy").transport).toMatchObject({
      mode: "plane", provider: "vueling", priceEur: 70, costEur: 70, source: "default", comfortLevel: "yellow",
      outDepartAt: "2027-08-26T06:45", backDepartAt: "2027-09-05T16:00", outDurationMin: 75, stops: 0,
    });
    expect(guestOf(snapshot, "Martin").transport).toMatchObject({ mode: "car", variant: "no_tolls", priceUnit: "per_vehicle", priceEur: 145, outDepartAt: null });
    expect(guestOf(snapshot, "Jessy")).toMatchObject({ status: "ok", tier: "over", maxBudgetEur: 400, housingShareEur: 300 });
  });

  it("marks the trip validated and stores one summary", async () => {
    const { tripId, destinations } = await computed();
    expect(statusOf(tripId)).toBe("ready");
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    expect(statusOf(tripId)).toBe("validated");
    expect(db.select().from(schema.summaries).all()).toHaveLength(1);
    expect(latestSummaryId(db, tripId)).toBe(summary.id);
  });

  it("records the group's choices: a hotel ❤ and a transport ❤ become the frozen offers, and the ★ are noted", async () => {
    const { tripId, destinations, guests } = await computed();
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotelOf(destinations.bcn.id).id });
    const plane = db.select().from(schema.transportOptions).all().find((o) => o.destinationId === destinations.bcn.id && o.provider === "iberia")!;
    setSelection(db, destinations.bcn.id, { kind: "transport", optionId: plane.id, guestId: guests.jessy.id });
    setFavoriteDestination(db, guests.martin.id, destinations.bcn.id);

    const { snapshot } = validateDestination(db, tripId, destinations.bcn.id);
    expect(snapshot.housing).toMatchObject({ title: "Hotel Cuatro Naciones, 2 rooms", totalEur: 1200, chosenByGroup: true });
    expect(guestOf(snapshot, "Jessy").transport).toMatchObject({ provider: "iberia", source: "selected", costEur: 95 });
    expect(guestOf(snapshot, "Martin").starred).toBe(true);
    expect(guestOf(snapshot, "Chloé").starred).toBe(false);
    // Iberia (95 €), the hotel share (400 €) and the hotel's Mandatory (396 €) put Jessy 491 € over a budget of 400 €,
    // and the hotel Martin 277 € over (D.6)
    expect(snapshot.ranking.eligible).toBe(false);
    expect(snapshot.ranking.blockers).toEqual([
      { kind: "over", guestId: guests.martin.id, name: "Martin", overBudgetEur: 277 },
      { kind: "over", guestId: guests.jessy.id, name: "Jessy", overBudgetEur: 491 },
    ]);
  });

  it("lets the group validate a destination that does not work for everyone, and says so", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.ms.id);
    expect(snapshot.ranking).toMatchObject({ eligible: false, recommended: false });
    expect(snapshot.ranking.blockers).toMatchObject([{ kind: "over", name: "Martin", overBudgetEur: 440 }, { kind: "over", name: "Jessy", overBudgetEur: 676 }]);
  });

  it("freezes a guest who cannot get there, with the fallback as an assumption", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.run.id);
    expect(guestOf(snapshot, "Martin")).toMatchObject({ status: "unreachable", transport: { mode: "plane", source: "fallback" } });
    expect(snapshot.totals.includesFallback).toBe(true);
    expect(snapshot.destination.inScope).toBe(false);
  });

  it("gives back the same summary when validating the same thing twice, and a new one when something changed", async () => {
    const { tripId, destinations, guests } = await computed();
    const first = validateDestination(db, tripId, destinations.bcn.id);
    const again = validateDestination(db, tripId, destinations.bcn.id);
    expect(again.id).toBe(first.id);
    expect(db.select().from(schema.summaries).all()).toHaveLength(1);

    setFavoriteDestination(db, guests.jessy.id, destinations.bcn.id);
    const changed = validateDestination(db, tripId, destinations.bcn.id);
    expect(changed.id).not.toBe(first.id);
    expect(latestSummaryId(db, tripId)).toBe(changed.id);
  });

  it("refuses an unknown trip, a destination of another trip, and a trip that was not worked out", async () => {
    const { tripId, destinations } = await computed();
    expect(() => validateDestination(db, "nope", destinations.bcn.id)).toThrow(NotFoundError);
    expect(() => validateDestination(db, tripId, "nope")).toThrow(FieldError);

    const draft = await enterScenario(db);
    expect(() => validateDestination(db, draft.tripId, draft.destinations.bcn.id)).toThrow(ConflictError);
    expect(statusOf(draft.tripId)).toBe("draft");
  });
});

describe("a recomputation does not change the summary (C-S7)", () => {
  it("leaves the snapshot as it was, keeps the trip validated, and flags no price when none moved", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);

    startCompute(db, tripId, { force: true });
    await runUntilIdle(db, fixtureAdapters());

    expect(statusOf(tripId)).toBe("validated");
    const after = getSummary(db, summary.id)!;
    expect(after.snapshot).toEqual(summary.snapshot);
    expect(after.totalEur).toBe(2697);
    expect(after.priceChanges).toEqual([]);
  });

  it("flags a price that has changed since, and leaves the frozen figures alone (the \"price changed\" badge)", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    const jessyFlight = guestOf(summary.snapshot, "Jessy").transport!.optionId;

    db.update(schema.transportOptions).set({ priceEur: 85 }).where(eq(schema.transportOptions.id, jessyFlight)).run();
    db.update(schema.stayOptions).set({ totalPriceEur: 1000 }).where(eq(schema.stayOptions.id, summary.snapshot.housing!.stayId)).run();

    const view = getSummary(db, summary.id)!;
    expect(view.priceChanges).toEqual([
      { kind: "transport", label: "Jessy's plane (vueling)", wasEur: 70, nowEur: 85 },
      { kind: "stay", label: "Gràcia apartment, 2 bedrooms, 3 beds", wasEur: 900, nowEur: 1000 },
    ]);
    // What was decided is what was decided
    expect(view.snapshot.totals.totalEur).toBe(2697);
    expect(guestOf(view.snapshot, "Jessy").costEur).toBe(812);
  });

  it("flags an offer that is no longer there", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    db.delete(schema.stayOptions).where(eq(schema.stayOptions.id, summary.snapshot.housing!.stayId)).run();

    expect(getSummary(db, summary.id)!.priceChanges).toEqual([
      { kind: "stay", label: "Gràcia apartment, 2 bedrooms, 3 beds", wasEur: 900, nowEur: null },
    ]);
  });

  it("does not flag the last mile once the Extra counts the way from the airport (T8.13), but still the fare", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.ms.id);
    const chloeFlight = guestOf(summary.snapshot, "Chloé").transport!;
    expect(chloeFlight).toMatchObject({ lastMileEur: 50, costEur: 110 });

    db.update(schema.transportOptions).set({ lastMileEur: 60 }).where(eq(schema.transportOptions.id, chloeFlight.optionId)).run();
    expect(getSummary(db, summary.id)!.priceChanges).toEqual([]);
    db.update(schema.transportOptions).set({ priceEur: 120 }).where(eq(schema.transportOptions.id, chloeFlight.optionId)).run();
    expect(getSummary(db, summary.id)!.priceChanges).toEqual([{ kind: "transport", label: "Chloé's plane (easyjet)", wasEur: 110, nowEur: 120 }]);
  });

  it("still notices a change in the last mile in a summary saved before the Extra, whose fares had it in them", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.ms.id);
    // As saved before T8.9: no Extra, and the guests without their Mandatory and Plus
    const before = structuredClone(snapshot);
    delete before.extra;
    for (const guest of before.guests) {
      delete guest.mandatoryEur;
      delete guest.plusEur;
    }
    expect(SummarySnapshotSchema.safeParse(before).success).toBe(true);
    const flight = guestOf(snapshot, "Chloé").transport!;
    const current = { transport: new Map([[flight.optionId, { priceEur: 110, lastMileEur: 60 }]]), stay: new Map([[snapshot.housing!.stayId, snapshot.housing!.totalEur]]) };
    expect(priceChangesOf(before, current)).toContainEqual({ kind: "transport", label: "Chloé's plane (easyjet)", wasEur: 160, nowEur: 170 });
  });
});

describe("priceChangesOf", () => {
  it("reports an offer two guests share once, naming both", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.bcn.id);
    const shared = structuredClone(snapshot);
    shared.guests[2].transport = { ...shared.guests[0].transport! };

    const changes = priceChangesOf(shared, { transport: new Map([[shared.guests[0].transport!.optionId, { priceEur: 999, lastMileEur: 0 }]]), stay: new Map([[shared.housing!.stayId, 900]]) });
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.label.startsWith("Martin and Jessy"))).toMatchObject({ nowEur: 999 });
  });

  it("has nothing to say when every price is the same", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.bcn.id);
    const same = {
      transport: new Map(snapshot.guests.map((g) => [g.transport!.optionId, { priceEur: g.transport!.priceEur, lastMileEur: g.transport!.lastMileEur }] as const)),
      stay: new Map([[snapshot.housing!.stayId, snapshot.housing!.totalEur]]),
    };
    expect(priceChangesOf(snapshot, same)).toEqual([]);
  });
});

describe("the Extra, frozen (task.md T8.13)", () => {
  const extraOf = (snapshot: SummarySnapshot) => snapshot.extra!;

  it("freezes Barcelona's Extra line by line, as the Extra page showed it for everyone (D.2)", async () => {
    const { tripId, destinations } = await computed();
    const { snapshot } = validateDestination(db, tripId, destinations.bcn.id);
    expect(SummarySnapshotSchema.safeParse(snapshot).success).toBe(true);
    const extra = extraOf(snapshot);
    expect(extra).toMatchObject({ stayTitle: "Gràcia apartment, 2 bedrooms, 3 beds", pricesSource: "ai", counted: true, totalEur: 1462 });
    const [mandatory, plus] = extra.sections;
    expect(mandatory.lines.map((line) => [line.id, line.groupEur])).toEqual([["food", 459], ["transfer", 28], ["parking", 150], ["tourist-tax", 105]]);
    expect(plus.lines.map((line) => [line.id, line.groupEur])).toEqual([["nights-out", 585], ["pre-drinks", 60], ["night-transport", 75]]);
    expect([mandatory.groupEur, plus.groupEur]).toEqual([742, 720]);
    const food = mandatory.lines[0];
    expect(food).toMatchObject({ label: "Food", formula: "3 × 15 € + 27 × 12 € ÷ 3", estimate: true });
    expect(food.rows).toContainEqual({ label: "A simple restaurant meal", value: "15 €", source: "ai" });
    expect(mandatory.lines[1].byGuest.map((guest) => [guest.name, guest.eur])).toEqual([["Chloé", 14], ["Jessy", 14]]);
  });

  it("freezes the advice as it was, saying so when it was written before the last change", async () => {
    const { tripId, destinations } = await computed();
    // Written during the computation, before the reference facts: out of date when validated
    expect(extraOf(validateDestination(db, tripId, destinations.bcn.id).snapshot).advice).toMatchObject({ source: "rules", stale: true });

    askExtraAdvice(db, destinations.bcn.id);
    await runUntilIdle(db, fixtureAdapters(), { fixtureFacts: false });
    const advice = extraOf(validateDestination(db, tripId, destinations.bcn.id).snapshot).advice!;
    expect(advice).toMatchObject({ source: "rules", stale: false, group: [] });
    expect(advice.guests.map((guest) => [guest.name, guest.fits])).toEqual([["Martin", true], ["Jessy", false]]);
    expect(advice.guests[1].lines[0]).toEqual({ text: "Go out 4 nights fewer", savingEur: 192 });
  });

  it("is not changed by new local prices, and does not flag them: what was decided is what was decided", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    const [row] = db.select().from(schema.destinationPrices).where(eq(schema.destinationPrices.destinationId, destinations.bcn.id)).all();
    const prices = JSON.parse(row.pricesJson);
    db.update(schema.destinationPrices).set({ pricesJson: JSON.stringify({ ...prices, cheapMeal: { eur: 40, source: "ai" } }) }).where(eq(schema.destinationPrices.destinationId, destinations.bcn.id)).run();

    const view = getSummary(db, summary.id)!;
    expect(view.snapshot.extra).toEqual(summary.snapshot.extra);
    expect(view.priceChanges).toEqual([]);
  });

  it("prints the Extra in the summary's page, which the PDF is made from", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    const html = renderToStaticMarkup(createElement(SummaryDocument, { summary: getSummary(db, summary.id)! }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    expect(text).toContain("Once there: the Extra");
    expect(text).toContain("3 × 15 € + 27 × 12 € ÷ 3");
    expect(text).toContain("A simple restaurant meal: 15 € (AI estimate)");
    expect(text).toMatch(/Extra ≈ 487 € ≈ 1462 €/);
    expect(text).toContain("Advice");
    // A summary saved before the Extra has no such part
    const before = { ...getSummary(db, summary.id)!, snapshot: { ...summary.snapshot, extra: undefined } };
    expect(renderToStaticMarkup(createElement(SummaryDocument, { summary: before }))).not.toContain("Once there");
  });
});

describe("getSummary and deleteSummary", () => {
  it("is null for an unknown summary", () => {
    expect(getSummary(db, "nope")).toBeNull();
    expect(deleteSummary(db, "nope")).toBeNull();
    expect(latestSummaryId(db, "nope")).toBeNull();
  });

  it("refuses to show a summary whose stored shape it cannot read, instead of showing something wrong", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    db.update(schema.summaries).set({ snapshotJson: JSON.stringify({ version: 9 }) }).where(eq(schema.summaries.id, summary.id)).run();
    expect(() => getSummary(db, summary.id)).toThrow(/can't be read/);
  });

  it("reopens the decision: the summary goes and the trip is ready again", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);

    expect(deleteSummary(db, summary.id)).toEqual({ tripStatus: "ready" });
    expect(statusOf(tripId)).toBe("ready");
    expect(getSummary(db, summary.id)).toBeNull();
    expect(latestSummaryId(db, tripId)).toBeNull();
  });

  it("keeps the trip validated while another summary stands", async () => {
    const { tripId, destinations } = await computed();
    const first = validateDestination(db, tripId, destinations.bcn.id);
    const second = validateDestination(db, tripId, destinations.ms.id);
    expect(latestSummaryId(db, tripId)).toBe(second.id);

    expect(deleteSummary(db, second.id)).toEqual({ tripStatus: "validated" });
    expect(latestSummaryId(db, tripId)).toBe(first.id);
  });

  it("does not claim a trip that is being worked out is ready", async () => {
    const { tripId, destinations } = await computed();
    const summary = validateDestination(db, tripId, destinations.bcn.id);
    db.update(schema.trips).set({ status: "computing" }).where(eq(schema.trips.id, tripId)).run();
    expect(deleteSummary(db, summary.id)).toEqual({ tripStatus: "computing" });
    expect(statusOf(tripId)).toBe("computing");
  });
});
