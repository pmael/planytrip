// The Extra page (task.md T8.10, extra.md §9): each line with its detail, for everyone and for one guest, each guest's
// whole trip, the advice and "Ask again". On the reference scenario computed with UC-D's facts (use-cases.md D.2).
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extraPlan } from "@/core/extras";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { lineDetail, lineLabel } from "@/lib/extraLines";
import { ConflictError, NotFoundError } from "@/server/errors";
import { startCompute } from "@/server/services/compute";
import { askExtraAdvice, extraAdviceStatus } from "@/server/services/extraAdvice";
import { getExtraView } from "@/server/services/extraView";
import { setSelection } from "@/server/services/selections";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";
import { createTestDb } from "./helpers/db";
import { seedExtraInput } from "./helpers/extras";

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

function extraView(tripId: string, options?: Parameters<typeof getExtraView>[2]) {
  const view = getExtraView(db, tripId, options);
  expect(view?.kind).toBe("ready");
  return view as Extract<NonNullable<typeof view>, { kind: "ready" }>;
}

const lineOf = (view: ReturnType<typeof extraView>, id: string) => view.extra!.sections.flatMap((section) => section.lines).find((line) => line.id === id)!;

describe("getExtraView: everyone", () => {
  it("is not ready for a trip that was not computed, and null for an unknown one", async () => {
    const { tripId } = await enterScenario(db);
    expect(getExtraView(db, tripId)).toMatchObject({ kind: "not-ready", status: "draft" });
    expect(getExtraView(db, "nope")).toBeNull();
  });

  it("opens on the closest destination, Barcelona, worked out for the default stay with the AI's prices", async () => {
    const { tripId, destinations } = await computed();
    const view = extraView(tripId);
    expect(view.selectedId).toBe(destinations.bcn.id);
    expect(view.destination).toEqual({ shortLabel: "Barcelona", objective: "partying", budgetLevel: "light", nights: 10 });
    expect(view.guestId).toBeNull();
    expect(view.extra).toMatchObject({ stay: { title: "Gràcia apartment, 2 bedrooms, 3 beds", chosen: false }, pricesSource: "ai", counted: true, estimate: true });
  });

  it("gives the Mandatory and the Plus line by line, with what each guest and the group pay (D.2)", async () => {
    const { tripId } = await computed();
    const view = extraView(tripId);
    const [mandatory, plus] = view.extra!.sections;
    expect(mandatory.lines.map((line) => [line.id, line.label, line.groupEur])).toEqual([
      ["food", "Food", 459],
      ["transfer", "Airport ↔ stay", 28],
      ["parking", "Parking", 150],
      ["tourist-tax", "Tourist tax", 105],
    ]);
    expect(plus.lines.map((line) => [line.id, line.groupEur])).toEqual([["nights-out", 585], ["pre-drinks", 60], ["night-transport", 75]]);
    expect([mandatory.groupEur, plus.groupEur, view.extra!.total.groupEur]).toEqual([742, 720, 1462]);
    expect(view.extra!.total.perGuestEur).toBeCloseTo(487.33, 2);
  });

  it("says who pays a line not everyone has: the transfer for Chloé and Jessy, the parking for Martin's car", async () => {
    const { tripId } = await computed();
    const view = extraView(tripId);
    expect(lineOf(view, "transfer")).toMatchObject({ partial: true, perGuest: { minEur: 14, maxEur: 14 }, byGuest: [{ name: "Chloé", eur: 14 }, { name: "Jessy", eur: 14 }] });
    expect(lineOf(view, "parking")).toMatchObject({ partial: true, byGuest: [{ name: "Martin", eur: 150 }] });
    expect(lineOf(view, "food")).toMatchObject({ partial: false, perGuest: { minEur: 153, maxEur: 153 } });
  });

  it("opens each line on how it is worked out and where each price comes from", async () => {
    const { tripId } = await computed();
    const view = extraView(tripId);
    const food = lineOf(view, "food");
    expect(food.summary).toBe("30 meals: 3 in restaurants, 27 from the supermarket");
    expect(food.formula).toBe("3 × 15 € + 27 × 12 € ÷ 3");
    expect(food.rows).toEqual(
      expect.arrayContaining([
        { label: "A simple restaurant meal", value: "15 €", source: "ai" },
        { label: "Meals eaten out", value: "10 % (partying 25 %, light budget −15 points)", source: "rule" },
        { label: "Nearest supermarket", value: "0.2 km", source: "openstreetmap" },
      ]),
    );
    const tax = lineOf(view, "tourist-tax");
    expect(tax.formula).toBe("7 nights × 5 €");
    expect(tax.summary).toMatch(/^5 € a night per person, for 7 nights at most/);
    expect(lineOf(view, "night-transport").rows).toEqual(expect.arrayContaining([{ label: "Back at 03:00", value: "A night bus: 2.50 €", source: "transitous" }]));
    expect(lineOf(view, "nights-out").formula).toBe("5 × (15 € + 4 × 6 €)");
  });

  it("gives each guest's whole trip with the Extra against their budget (D.3)", async () => {
    const { tripId } = await computed();
    const standing = extraView(tripId).standing;
    expect(standing.map((guest) => [guest.name, guest.costEur, guest.tier, guest.overBudgetEur])).toEqual([
      ["Martin", 1023, "limited", 0],
      ["Chloé", 862, "comfy", 0],
      ["Jessy", 812, "over", 172],
    ]);
    expect(standing[2]).toMatchObject({ transportEur: 70, housingEur: 300, mandatoryEur: 202, plusEur: 240, maxBudgetEur: 400, color: "red" });
  });
});

describe("getExtraView: one guest", () => {
  it("shows only Jessy's lines, Jessy's amounts, and Jessy's own way from the airport", async () => {
    const { tripId, guests } = await computed();
    const view = extraView(tripId, { guestId: guests.jessy.id });
    expect(view.guestId).toBe(guests.jessy.id);
    expect(view.extra!.sections[0].lines.map((line) => line.id)).toEqual(["food", "transfer", "tourist-tax"]);
    expect(view.extra!.total.groupEur).toBe(442);
    const transfer = lineOf(view, "transfer");
    expect(transfer.formula).toBe("7 € + 7 €");
    expect(transfer.rows.map((row) => [row.label.replace(/\d\d:\d\d/, "hh:mm"), row.value, row.source])).toEqual([
      ["From BCN at hh:mm", "Public transport, 45 min: 7 €", "transitous"],
      ["Back to BCN at hh:mm", "Public transport, 45 min: 7 €", "transitous"],
    ]);
    expect(view.standing.map((guest) => guest.name)).toEqual(["Jessy"]);
  });

  it("details a taxi at Le Mont-Saxonnex: Chloé alone there, shared with Jessy on the way back (D.2)", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = extraView(tripId, { destinationId: destinations.ms.id, guestId: guests.chloe.id });
    const transfer = lineOf(view, "transfer");
    expect(transfer.rows[0].value).toBe("Taxi alone, 45 km: 94 €");
    expect(transfer.rows[1].value).toBe("A taxi shared with Jessy, 45 km: 94 € ÷ 2 = 47 €");
    expect(transfer.rows.filter((row) => row.label.startsWith("Taxi:")).map((row) => row.source)).toEqual(["ai", "ai"]);
    expect(transfer.formula).toBe("94 € + 47 €");
  });

  it("says how each hike is reached, and that Martin's car takes everyone (no rental)", async () => {
    const { tripId, destinations } = await computed();
    const view = extraView(tripId, { destinationId: destinations.ms.id });
    const hikes = lineOf(view, "activities");
    expect(hikes.label).toBe("Hikes and visits");
    expect(hikes.rows[0]).toMatchObject({ label: "Lac de Bénit and the Pointe d'Orchez", source: "ai" });
    expect(hikes.rows[0].value).toMatch(/^free · on foot/);
    expect(hikes.rows.slice(1).every((row) => row.value.includes("by car"))).toBe(true);
    expect(lineOf(view, "fuel").summary).toMatch(/^1 car driving .* to the hikes and back, shared by everyone$/);
    expect(view.extra!.sections[1].lines.map((line) => line.id)).not.toContain("car-rental");
  });
});

describe("getExtraView: what moves it", () => {
  it("moves at once with a ❤ on the hotel: no kitchen, 20 meals out of 30, the stay marked as the group's", async () => {
    const { tripId, destinations } = await computed();
    const [hotel] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.provider, "booking")).all().filter((stay) => stay.destinationId === destinations.bcn.id);
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotel.id });
    const view = extraView(tripId);
    expect(view.extra!.stay).toMatchObject({ id: hotel.id, chosen: true });
    expect(lineOf(view, "food").summary).toBe("30 meals: 20 in restaurants, 10 from the supermarket (the stay has no kitchen)");
    expect(lineOf(view, "food").rows).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Meals eaten out", value: "67 % (partying 25 %, light budget −15 points, no kitchen: at least 67 %)" })]));
  });

  it("says when the budget does not count it yet: no local prices stored, EU averages, transport and housing only", async () => {
    const { tripId } = await computed();
    db.delete(schema.destinationPrices).run();
    const view = extraView(tripId);
    expect(view.extra).toMatchObject({ pricesSource: "eu-average", counted: false });
    expect(view.standing.find((guest) => guest.name === "Jessy")).toMatchObject({ costEur: 370, tier: "limited" });
  });
});

describe("the advice on the page, and Ask again", () => {
  it("shows the advice and that it may be out of date, then writes it anew on Ask again", async () => {
    const { tripId, destinations, guests } = await computed();
    // Written during the computation, before the reference facts (helpers/compute.ts): no longer for these figures
    expect(extraView(tripId).advice).toMatchObject({ source: "rules", stale: true });

    expect(askExtraAdvice(db, destinations.bcn.id)).toEqual({ queued: true });
    expect(askExtraAdvice(db, destinations.bcn.id)).toEqual({ queued: false });
    expect(extraView(tripId).advicePending).toBe(true);
    expect(extraAdviceStatus(db, destinations.bcn.id)).toMatchObject({ exists: true, pending: true });

    await runUntilIdle(db, fixtureAdapters(), { fixtureFacts: false });
    expect(extraAdviceStatus(db, destinations.bcn.id)).toEqual({ exists: true, pending: false, stale: false, source: "rules" });
    const view = extraView(tripId, { guestId: guests.jessy.id });
    expect(view.advicePending).toBe(false);
    expect(view.advice!.stale).toBe(false);
    // Jessy's view: Jessy's own lines only, every lever together still leaves 572 € of 400 € (D.5)
    expect(view.advice!.guests.map((guest) => guest.name)).toEqual(["Jessy"]);
    const jessy = view.advice!.guests[0];
    expect(jessy.lines.map((line) => [line.lever, line.steps, line.savingEur])).toEqual([["fewer-nights-out", 4, 192], ["groceries-only", 1, 33], ["bars-only", 1, 15]]);
    expect(jessy).toMatchObject({ fits: false, afterEur: 572, budgetEur: 400 });
    // Everyone: Martin and Jessy, Chloé is within budget
    expect(extraView(tripId).advice!.guests.map((guest) => guest.name)).toEqual(["Martin", "Jessy"]);
  });

  it("refuses an unknown destination and a trip not worked out", async () => {
    const { destinations } = await enterScenario(db);
    expect(() => extraAdviceStatus(db, "nope")).toThrow(NotFoundError);
    expect(() => askExtraAdvice(db, destinations.bcn.id)).toThrow(ConflictError);
  });
});

describe("lineDetail: the words of a line (lib/extraLines.ts)", () => {
  const names: Record<string, string> = { martin: "Martin", chloe: "Chloé", jessy: "Jessy" };
  const nameOf = (id: string) => names[id];

  it("names the car rented at the airport when nobody comes by car to a Nature trip (D6)", () => {
    const seeded = seedExtraInput("mont-saxonnex");
    const chloe = seeded.guests.find((guest) => guest.guestId === "chloe")!;
    const input = { ...seeded, guests: seeded.guests.map((guest) => (guest.guestId === "martin" ? { ...guest, mode: "plane" as const, there: chloe.there, back: chloe.back } : guest)) };
    const plan = extraPlan(input);
    expect(plan).toMatchObject({ rentalCars: 1, renters: ["martin", "chloe", "jessy"] });
    const rental = lineDetail("car-rental", input, plan, "jessy", nameOf);
    expect(rental.summary).toBe("1 car rented for the whole stay at GVA, shared by Martin, Chloé and Jessy: it is their way to the stay too");
    expect(rental.formula).toBe("1 × 10 days × 55 € ÷ 3");
    expect(lineDetail("fuel", input, plan, "jessy", nameOf).summary).toMatch(/and the rented car's drive between the airport and the stay$/);
  });

  it("says the tax is already in the price at La Réunion, and calls the transfer by the guest's way of travelling", () => {
    const input = seedExtraInput("la-reunion");
    const plan = extraPlan(input);
    expect(lineDetail("tourist-tax", input, plan, null, nameOf)).toMatchObject({ summary: "Already in the stay's price: nothing more to pay", formula: "0 €", estimate: false });
    expect(lineLabel("transfer", input)).toBe("Airport ↔ stay");
    expect(lineLabel("transfer", { ...input, guests: input.guests.map((guest) => ({ ...guest, mode: "train" as const })) })).toBe("Station ↔ stay");
  });
});
