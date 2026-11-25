import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { startCompute } from "@/server/services/compute";
import { getDeliberationView } from "@/server/services/deliberation";
import { setFavoriteDestination } from "@/server/services/guests";
import { setSelection } from "@/server/services/selections";
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

function deliberation(tripId: string) {
  const view = getDeliberationView(db, tripId);
  expect(view?.kind).toBe("ready");
  return view as Extract<NonNullable<typeof view>, { kind: "ready" }>;
}

const hotelOf = (destinationId: string) =>
  db.select().from(schema.stayOptions).all().find((s) => s.destinationId === destinationId && s.provider === "booking")!;

const cellOf = (view: ReturnType<typeof deliberation>, destinationId: string, guestId: string) =>
  view.destinations.find((d) => d.id === destinationId)!.cells.find((c) => c.guestId === guestId)!;

describe("getDeliberationView", () => {
  it("is not ready for a trip that was not computed, and null for an unknown one", async () => {
    const { tripId } = await enterScenario(db);
    expect(getDeliberationView(db, tripId)).toMatchObject({ kind: "not-ready", status: "draft" });
    expect(getDeliberationView(db, "doesnotexist")).toBeNull();
  });

  it("lists the destinations best first: none recommended, Barcelona the closest (use-cases.md D.4)", async () => {
    const { tripId, destinations } = await computed();
    const view = deliberation(tripId);
    expect(view.destinations.map((d) => d.rank)).toEqual([1, 2, 3]);
    expect(view.destinations[0]).toMatchObject({ id: destinations.bcn.id, recommended: false, eligible: false, shortLabel: "Barcelona" });
    expect(view.recommendedId).toBeNull();
    expect(view.closestId).toBe(destinations.bcn.id);
  });

  it("describes a destination: details, dates, group figures and what keeps it from working", async () => {
    const { tripId, destinations } = await computed();
    const view = deliberation(tripId);
    const bcn = view.destinations.find((d) => d.id === destinations.bcn.id)!;
    expect(bcn).toMatchObject({ budgetLevel: "light", objective: "partying", inScope: true, tier: "over", totalEur: 2697 });
    expect(bcn.airports).toContain("BCN");
    expect(bcn.window).toEqual({ from: "2027-08-26", to: "2027-09-05", nights: 10, limitedBy: ["Martin"] });
    expect(bcn.standing).toEqual({ comfy: 1, limited: 1, over: 1, unreachable: 0 });
    expect(bcn.blockers.map((b) => [b.kind, b.name])).toEqual([["over", "Jessy"]]);
    expect(bcn.housing).toMatchObject({ title: "Gràcia apartment, 2 bedrooms, 3 beds", totalEur: 900, perGuestEur: 300, chosen: false });

    const reunion = view.destinations.find((d) => d.id === destinations.run.id)!;
    expect(reunion.eligible).toBe(false);
    // With the Extra, Chloé and Jessy are over budget, and Martin, who only drives, cannot get there at all (D.6)
    expect(reunion.blockers.map((b) => [b.kind, b.name])).toEqual([["over", "Chloé"], ["over", "Jessy"], ["unreachable", "Martin"]]);
  });

  it("gives each guest a cell per destination, in the guests' order (D.6: Jessy 812 € / 1,183.60 € / ~2,170.67 €)", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = deliberation(tripId);
    expect(view.guests.map((g) => g.name)).toEqual(["Martin", "Chloé", "Jessy"]);
    for (const dossier of view.destinations) expect(dossier.cells.map((c) => c.guestId)).toEqual(view.guests.map((g) => g.id));

    expect(cellOf(view, destinations.bcn.id, guests.jessy.id)).toMatchObject({
      status: "ok", tier: "over", costEur: 812, overBudgetEur: 172, housingShareEur: 300,
      transport: { mode: "plane", costEur: 70, assumed: false },
    });
    expect(cellOf(view, destinations.bcn.id, guests.jessy.id).budgetRatio).toBeCloseTo(2.03);
    expect(cellOf(view, destinations.ms.id, guests.jessy.id)).toMatchObject({ tier: "over", overBudgetEur: 676 });
    expect(cellOf(view, destinations.ms.id, guests.jessy.id).costEur).toBeCloseTo(1183.6, 1);
    expect(cellOf(view, destinations.run.id, guests.jessy.id).costEur).toBeCloseTo(2170.67, 1);
  });

  it("shows a guest who cannot get there as unreachable, with the mode the figures assume", async () => {
    const { tripId, destinations, guests } = await computed();
    const cell = cellOf(deliberation(tripId), destinations.run.id, guests.martin.id);
    expect(cell).toMatchObject({ status: "unreachable", tier: "over", transport: { mode: "plane", assumed: true } });
  });

  it("marks where each guest's numbers say they are best off, and nowhere else", async () => {
    const { tripId, destinations, guests } = await computed();
    const view = deliberation(tripId);
    expect(view.guests.every((g) => g.bestFitId === destinations.bcn.id)).toBe(true);
    for (const dossier of view.destinations) {
      expect(dossier.cells.every((c) => c.bestFit)).toBe(dossier.id === destinations.bcn.id);
    }
    expect(guests.jessy.id).toBeTruthy();
  });

  it("follows the ★ votes: who prefers what, counted per destination", async () => {
    const { tripId, destinations, guests } = await computed();
    expect(deliberation(tripId).guests.every((g) => g.favoriteId === null)).toBe(true);

    setFavoriteDestination(db, guests.martin.id, destinations.ms.id);
    setFavoriteDestination(db, guests.jessy.id, destinations.ms.id);
    setFavoriteDestination(db, guests.chloe.id, destinations.bcn.id);
    const view = deliberation(tripId);

    expect(view.guests.map((g) => [g.name, g.favoriteId])).toEqual([
      ["Martin", destinations.ms.id], ["Chloé", destinations.bcn.id], ["Jessy", destinations.ms.id],
    ]);
    const ms = view.destinations.find((d) => d.id === destinations.ms.id)!;
    expect(ms.votes).toEqual({ count: 2, guestIds: [guests.martin.id, guests.jessy.id] });
    expect(ms.cells.map((c) => c.starred)).toEqual([true, false, true]);
    expect(view.destinations.find((d) => d.id === destinations.run.id)!.votes.count).toBe(0);
  });

  it("lets a ★ settle a tie but never make an ineligible destination eligible (C-S5)", async () => {
    const { tripId, destinations, guests } = await computed();
    for (const guest of Object.values(guests)) setFavoriteDestination(db, guest.id, destinations.run.id);
    const view = deliberation(tripId);
    // Three ★ for La Réunion: still not eligible, and Barcelona stays the closest (the ★ come after the overrun, R7)
    expect(view.recommendedId).toBeNull();
    expect(view.closestId).toBe(destinations.bcn.id);
    expect(view.destinations.find((d) => d.id === destinations.run.id)).toMatchObject({ eligible: false, votes: { count: 3 } });
  });

  it("reflects a housing ❤ at once: the stay is marked as chosen and Jessy goes further over (B.1 step 6, D.6)", async () => {
    const { tripId, destinations, guests } = await computed();
    const hotel = deliberation(tripId).destinations.find((d) => d.id === destinations.bcn.id)!;
    expect(hotel.housing!.chosen).toBe(false);

    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotelOf(destinations.bcn.id).id });

    const view = deliberation(tripId);
    const bcn = view.destinations.find((d) => d.id === destinations.bcn.id)!;
    expect(bcn.housing).toMatchObject({ chosen: true, totalEur: 1200 });
    // The hotel: 400 € of housing, no kitchen, its own tax; Jessy's Mandatory goes to 396 €
    expect(bcn.cells.find((c) => c.guestId === guests.jessy.id)).toMatchObject({ tier: "over", costEur: 1106, overBudgetEur: 466 });
    expect(bcn.eligible).toBe(false);
    expect(view.recommendedId).toBeNull();
  });

  it("names the best-ranked destination as the one to unblock first when none works for everyone", async () => {
    const { tripId, destinations } = await computed();
    // No destination works for everyone (D.4), and Barcelona's hotel does not change that
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotelOf(destinations.bcn.id).id });
    const view = deliberation(tripId);
    expect(view.recommendedId).toBeNull();
    expect(view.closestId).toBe(view.destinations[0].id);
  });
});
