import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import { FieldError, NotFoundError } from "@/server/errors";
import { getBudgetView, getDashboard, isWholeEuros } from "@/server/services/dashboard";
import { startCompute } from "@/server/services/compute";
import { setFavoriteDestination } from "@/server/services/guests";
import { setSelection } from "@/server/services/selections";
import * as schema from "@/db/schema";
import { createTrip } from "@/server/services/trips";
import { airlineCode } from "@/lib/airlines";
import { EXTRA_WORDS } from "@/lib/extraText";
import { createTestDb } from "./helpers/db";
import { enterScenario, fixtureAdapters, runUntilIdle } from "./helpers/compute";

let db: Db;
let close: () => void;
beforeEach(() => ({ db, close } = createTestDb()));
afterEach(() => close());

/**
 * The reference scenario, entered and computed with the test dataset. Its costs have the Extra in them (use-cases.md
 * UC-D, D.3 and D.6, task.md T8.9): no destination works for everyone, Barcelona is the closest.
 */
async function computed() {
  const scenario = await enterScenario(db);
  startCompute(db, scenario.tripId);
  await runUntilIdle(db, fixtureAdapters());
  return scenario;
}

function ready<T extends { kind: string }>(view: T | null) {
  expect(view?.kind).toBe("ready");
  return view as Extract<T, { kind: "ready" }>;
}

describe("getDashboard", () => {
  it("has nothing to show for a trip that was not computed, and says where it stands", async () => {
    const { tripId } = await enterScenario(db);
    expect(getDashboard(db, tripId)).toEqual({ kind: "not-ready", tripId, status: "draft" });
    expect(getDashboard(db, createTrip(db).id)).toMatchObject({ kind: "not-ready" });
  });

  it("is null for an unknown trip", () => {
    expect(getDashboard(db, "doesnotexist")).toBeNull();
    expect(getBudgetView(db, "doesnotexist")).toBeNull();
  });

  it("opens on the closest destination when none is recommended: Barcelona", async () => {
    const { tripId, destinations } = await computed();
    const view = ready(getDashboard(db, tripId));
    expect(view.selectedId).toBe(destinations.bcn.id);
    expect(view.destinations.map((d) => [d.shortLabel, d.recommended, d.tier])).toEqual([
      ["Barcelona", false, "over"],
      ["Réunion", false, "over"],
      ["Mont-Saxonnex", false, "over"],
    ]);
  });

  it("shows Barcelona's budget, housing and transport (D.3: 2,697 € with the Extra)", async () => {
    const { tripId } = await computed();
    const view = ready(getDashboard(db, tripId));
    expect(view.budget.totalEur).toBe(2697);
    expect(view.budget.perGuestEur).toBeCloseTo(899, 2);
    expect(view.budget).toMatchObject({ tier: "over", includesFallback: false });
    expect(view.housing).toMatchObject({ title: "Gràcia apartment, 2 bedrooms, 3 beds", totalEur: 900, shareEur: 300 });
    expect(view.transportModes.sort()).toEqual(["car", "plane"]);
  });

  it("lists each guest's tier, dates and ★", async () => {
    const { tripId } = await computed();
    const guests = Object.fromEntries(ready(getDashboard(db, tripId)).guests.map((g) => [g.name, g]));
    expect(guests.Martin).toMatchObject({ tier: "limited", datesColor: "yellow", starred: false });
    expect(guests["Chloé"]).toMatchObject({ tier: "comfy", datesColor: "green", availableFrom: "2027-08-26", availableTo: "2027-09-14" });
    expect(guests.Jessy).toMatchObject({ tier: "over", datesColor: "green" });
  });

  it("shows another destination when asked: La Réunion, with Martin's plane as an assumption", async () => {
    const { tripId, destinations } = await computed();
    const view = ready(getDashboard(db, tripId, destinations.run.id));
    expect(view.selectedId).toBe(destinations.run.id);
    expect(view.budget.totalEur).toBeCloseTo(6292, 6);
    expect(view.budget).toMatchObject({ tier: "over", includesFallback: true });
    expect(view.transportModes).toEqual(["plane"]);
    expect(view.guests.find((g) => g.name === "Jessy")?.tier).toBe("over");
  });

  it("falls back to the recommended destination for an id that is not in the trip", async () => {
    const { tripId, destinations } = await computed();
    expect(ready(getDashboard(db, tripId, "nope")).selectedId).toBe(destinations.bcn.id);
  });

  it("shows a ★ on the destination the guest chose, and only there", async () => {
    const { tripId, destinations, guests } = await computed();
    setFavoriteDestination(db, guests.martin.id, destinations.bcn.id);
    setFavoriteDestination(db, guests.chloe.id, destinations.run.id);

    const onBarcelona = ready(getDashboard(db, tripId, destinations.bcn.id)).guests;
    expect(onBarcelona.filter((g) => g.starred).map((g) => g.name)).toEqual(["Martin"]);
    const onReunion = ready(getDashboard(db, tripId, destinations.run.id)).guests;
    expect(onReunion.filter((g) => g.starred).map((g) => g.name)).toEqual(["Chloé"]);
  });
});

describe("setFavoriteDestination (C-S5)", () => {
  it("puts the ★ on a destination, moves it, and takes it off", async () => {
    const { destinations, guests } = await computed();
    expect(setFavoriteDestination(db, guests.martin.id, destinations.bcn.id).favoriteDestinationId).toBe(destinations.bcn.id);
    expect(setFavoriteDestination(db, guests.martin.id, destinations.run.id).favoriteDestinationId).toBe(destinations.run.id);
    expect(setFavoriteDestination(db, guests.martin.id, null).favoriteDestinationId).toBeNull();
  });

  it("refuses a destination of another trip, on the destination field", async () => {
    const { guests } = await computed();
    const other = await enterScenario(db);
    const error = (() => { try { setFavoriteDestination(db, guests.martin.id, other.destinations.bcn.id); } catch (e) { return e; } })();
    expect(error).toBeInstanceOf(FieldError);
    expect(error).toMatchObject({ field: "destinationId" });
    expect(() => setFavoriteDestination(db, guests.martin.id, "doesnotexist")).toThrow(FieldError);
  });

  it("rejects an unknown guest", () => {
    expect(() => setFavoriteDestination(db, "doesnotexist", null)).toThrow(NotFoundError);
  });
});

describe("getBudgetView", () => {
  it("has nothing to show for a trip that was not computed", async () => {
    const { tripId } = await enterScenario(db);
    expect(getBudgetView(db, tripId)).toEqual({ kind: "not-ready", tripId, status: "draft" });
  });

  it("has one card per destination, in the order they were added, and echoes the chips", async () => {
    const { tripId } = await computed();
    const view = ready(getBudgetView(db, tripId, { show: ["housing"] }));
    expect(view.cards.map((c) => c.shortLabel)).toEqual(["Barcelona", "Réunion", "Mont-Saxonnex"]);
    expect(view.show).toEqual(["housing"]);
    expect(ready(getBudgetView(db, tripId)).show).toEqual([]);
  });

  it("gives the totals of D.3 with their tier colour: red everywhere (Jessy is over at every destination)", async () => {
    const { tripId } = await computed();
    const [bcn, run, ms] = ready(getBudgetView(db, tripId)).cards;
    expect(bcn.total).toMatchObject({ totalEur: 2697, color: "red", includesFallback: false, complete: true });
    expect(bcn.total.perGuestEur).toBeCloseTo(899, 2);
    expect(run.total.totalEur).toBeCloseTo(6292, 6);
    expect(run.total).toMatchObject({ color: "red", includesFallback: true });
    expect(ms.total.totalEur).toBeCloseTo(3684.8, 6);
    expect(ms.total).toMatchObject({ color: "red" });
    expect(ms.total.perGuestEur).toBeCloseTo(1228.27, 2);
  });

  it("marks the totals ▲ for the lowest (Barcelona), ▼ for the highest (La Réunion) and ≈ between (C.2)", async () => {
    const { tripId } = await computed();
    expect(ready(getBudgetView(db, tripId)).cards.map((c) => c.total.trend)).toEqual(["▲", "▼", "≈"]);
  });

  it("gives the housing of each destination, with its trend and colour (C.2: La Réunion ▲, the others tied ▼)", async () => {
    const { tripId } = await computed();
    const [bcn, run, ms] = ready(getBudgetView(db, tripId)).cards;
    expect([bcn.housing?.totalEur, run.housing?.totalEur, ms.housing?.totalEur]).toEqual([900, 800, 900]);
    expect(run.housing?.perGuestEur).toBeCloseTo(266.67, 2);
    expect([bcn.housing?.trend, run.housing?.trend, ms.housing?.trend]).toEqual(["▼", "▲", "▼"]);
    expect([bcn.housing?.color, run.housing?.color, ms.housing?.color]).toEqual(["red", "green", "red"]);
    expect(bcn.housing?.stay).toMatchObject({ title: "Gràcia apartment, 2 bedrooms, 3 beds", provider: "airbnb" });
    // Nobody asked the AI: the rules rated it when the trip was set up, and nobody has explained it yet. 53, not 50: a
    // quarter of the score is how well it suits partying (R11), a whole home with its surroundings unknown (60)
    expect(bcn.housing?.analysis).toMatchObject({ ratedBy: "rules", explained: false, verdict: "ok", fitScore: 53, pros: [], cons: [] });
  });

  it("gives each guest's transport with its mode, time and comfort colour", async () => {
    const { tripId } = await computed();
    const [bcn, run] = ready(getBudgetView(db, tripId)).cards;
    expect(bcn.transports?.guests).toMatchObject([
      { name: "Martin", costEur: 145, mode: "car", durationMin: expect.any(Number), comfort: "yellow", assumed: false },
      { name: "Chloé", costEur: 120, mode: "plane", comfort: "yellow", assumed: false },
      { name: "Jessy", costEur: 70, mode: "plane", comfort: "yellow", assumed: false },
    ]);
    expect(bcn.transports?.totalEur).toBe(335);
    expect(bcn.transports?.perGuestEur).toBeCloseTo(111.67, 2);
    // Martin cannot drive to the island: his plane is shown as an assumption
    expect(run.transports?.guests[0]).toMatchObject({ name: "Martin", mode: "plane", costEur: 1040, assumed: true });
  });

  it("gives the common days, how many nights, and who limits them", async () => {
    const { tripId } = await computed();
    for (const card of ready(getBudgetView(db, tripId)).cards) {
      expect(card.dates).toEqual({ from: "2027-08-26", to: "2027-09-05", nights: 10, limitedBy: ["Martin"], setByDestination: false });
    }
  });

  it("narrows the days to the destination's own dates, and says it is the destination that does", async () => {
    const { tripId, destinations } = await computed();
    const { eq } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    db.update(schema.destinations).set({ dateFrom: "2027-08-28", dateTo: "2027-09-02" }).where(eq(schema.destinations.id, destinations.bcn.id)).run();
    const [bcn] = ready(getBudgetView(db, tripId)).cards;
    expect(bcn.dates).toEqual({ from: "2027-08-28", to: "2027-09-02", nights: 5, limitedBy: [], setByDestination: true });
  });

  it("has no days when the destination's dates leave none", async () => {
    const { tripId, destinations } = await computed();
    const { eq } = await import("drizzle-orm");
    const schema = await import("@/db/schema");
    db.update(schema.destinations).set({ dateFrom: "2028-01-01", dateTo: "2028-01-10" }).where(eq(schema.destinations.id, destinations.bcn.id)).run();
    expect(ready(getBudgetView(db, tripId)).cards[0].dates).toBeNull();
  });
});

/** The guests' ★ of use-cases.md C.1 step 4: Chloé → La Réunion, Martin and Jessy → Barcelona. */
function castTheStars(scenario: Awaited<ReturnType<typeof computed>>) {
  const { guests, destinations } = scenario;
  setFavoriteDestination(db, guests.chloe.id, destinations.run.id);
  setFavoriteDestination(db, guests.martin.id, destinations.bcn.id);
  setFavoriteDestination(db, guests.jessy.id, destinations.bcn.id);
}

describe("getBudgetView: the Extra chip (task.md T8.9)", () => {
  it("shows the Extra in the totals: Barcelona 1,462 €, the Mandatory 742 € and the Plus 720 € (D.3)", async () => {
    const { tripId } = await computed();
    const [bcn, run, ms] = ready(getBudgetView(db, tripId, { show: ["extra"] })).cards;
    expect(bcn.extra).toMatchObject({ totalEur: 1462, mandatoryEur: 742, plusEur: 720, pricesByAi: true, color: "green", trend: "▲" });
    expect(bcn.extra!.perGuestEur).toBeCloseTo(487.33, 2);
    expect(bcn.extra!.guests.map((g) => [g.name, g.mandatoryEur, g.plusEur])).toEqual([["Martin", 338, 240], ["Chloé", 202, 240], ["Jessy", 202, 240]]);
    // Transport, housing and the Extra make the total
    expect(bcn.transports!.totalEur + bcn.housing!.totalEur + bcn.extra!.totalEur).toBe(bcn.total.totalEur);
    expect(ms.extra!.totalEur + ms.housing!.totalEur + ms.transports!.totalEur).toBeCloseTo(ms.total.totalEur, 6);
    expect(run.extra!.trend).toBe("▼");
  });

  it("has no Extra while a destination's local prices are not known: the figures before T8.9, the last mile in the fare (C.2)", async () => {
    const { tripId, destinations } = await computed();
    db.delete(schema.destinationPrices).run();
    const cards = ready(getBudgetView(db, tripId)).cards;
    const bcn = cards.find((c) => c.destinationId === destinations.bcn.id)!;
    const ms = cards.find((c) => c.destinationId === destinations.ms.id)!;
    expect(bcn.extra).toBeNull();
    expect(bcn.total.totalEur).toBe(1235);
    // Chloé's and Jessy's flights to Geneva carry their 50 € to the chalet again
    expect(ms.total.totalEur).toBe(1695);
    expect(ms.blockers).toEqual([{ kind: "over", guestId: expect.any(String), name: "Jessy", overBudgetEur: 90 }]);
  });

  it("says when the local prices are the rules', not the AI's", async () => {
    const { tripId, destinations } = await computed();
    db.update(schema.destinationPrices).set({ source: "rules" }).run();
    const bcn = ready(getBudgetView(db, tripId)).cards.find((c) => c.destinationId === destinations.bcn.id)!;
    expect(bcn.extra!.pricesByAi).toBe(false);
  });
});

describe("getDashboard: the stay on the Housing card", () => {
  it("has its first photo and its score, as the Housing page opens on it, and the ❤'s when there is one", async () => {
    const { tripId, destinations } = await computed();
    const stays = db.select().from(schema.stayOptions).all().filter((stay) => stay.destinationId === destinations.bcn.id);
    for (const stay of stays) db.update(schema.stayOptions).set({ photosJson: JSON.stringify([`https://photos.test/${stay.provider}-1.jpg`, `https://photos.test/${stay.provider}-2.jpg`]) }).where(eq(schema.stayOptions.id, stay.id)).run();
    const housing = () => ready(getDashboard(db, tripId, destinations.bcn.id)).housing!;
    expect(housing()).toMatchObject({ provider: "airbnb", photo: "https://photos.test/airbnb-1.jpg", ratedBy: "rules", fitScore: expect.any(Number) });
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: stays.find((stay) => stay.provider === "booking")!.id });
    expect(housing()).toMatchObject({ provider: "booking", photo: "https://photos.test/booking-1.jpg" });
  });

  it("has no photo when the source gave none", async () => {
    const { tripId, destinations } = await computed();
    db.update(schema.stayOptions).set({ photosJson: "[]" }).run();
    expect(ready(getDashboard(db, tripId, destinations.bcn.id)).housing).toMatchObject({ photo: null });
  });
});

describe("getDashboard: who takes the guests there", () => {
  it("names the airlines of the flights, each once, and the other modes", async () => {
    const { tripId, destinations } = await computed();
    expect(ready(getDashboard(db, tripId, destinations.bcn.id)).carriers).toEqual([
      { mode: "car", label: "Car", airline: null },
      { mode: "plane", label: "Transavia", airline: "TO" },
      { mode: "plane", label: "Vueling", airline: "VY" },
    ]);
    // Chloé and Jessy both fly easyJet to Geneva
    expect(ready(getDashboard(db, tripId, destinations.ms.id)).carriers.filter(({ mode }) => mode === "plane")).toEqual([{ mode: "plane", label: "easyJet", airline: "U2" }]);
  });

  it("reads the airline from the flight number first, else from its name, and does not guess", () => {
    expect(airlineCode("british-airways", "BA319 CDG-LHR")).toBe("BA");
    expect(airlineCode("discover-airlines", "4Y123 FRA-LIS")).toBe("4Y");
    expect(airlineCode("easyjet", " CDG-GVA")).toBe("U2");
    expect(airlineCode("some-airline")).toBeNull();
  });
});

describe("getDashboard: the Extra card (task.md T8.9)", () => {
  it("names what the Extra is spent on by the objective: Barcelona \"Food | Nights out\", La Réunion \"Restaurants | Relax\"", async () => {
    const { tripId, destinations } = await computed();
    const bcn = ready(getDashboard(db, tripId, destinations.bcn.id));
    expect(bcn.extra).toEqual({ objective: "partying", totalEur: 1462 });
    expect(EXTRA_WORDS[bcn.extra.objective]).toEqual(["Food", "Nights out"]);
    expect(EXTRA_WORDS[ready(getDashboard(db, tripId, destinations.run.id)).extra.objective]).toEqual(["Restaurants", "Relax"]);
    expect(EXTRA_WORDS[ready(getDashboard(db, tripId, destinations.ms.id)).extra.objective]).toEqual(["Food", "Hikes & car"]);
    expect(EXTRA_WORDS.none).toEqual(["Groceries", "Transport"]);
    expect(EXTRA_WORDS.culture).toEqual(["Food", "Visits"]);
  });

  it("has no amount while the local prices are not known", async () => {
    const { tripId, destinations } = await computed();
    db.delete(schema.destinationPrices).run();
    expect(ready(getDashboard(db, tripId, destinations.bcn.id)).extra).toEqual({ objective: "partying", totalEur: null });
  });
});

describe("getBudgetView: ranking, blockers and ★ on each card (C.2)", () => {
  it("ranks the destinations, none eligible: Barcelona 1, Mont-Saxonnex 2 (the smaller overrun), La Réunion 3 (D.4)", async () => {
    const { tripId } = await computed();
    const [bcn, run, ms] = ready(getBudgetView(db, tripId)).cards;
    expect([bcn, ms, run].map((c) => [c.shortLabel, c.rank, c.eligible])).toEqual([["Barcelona", 1, false], ["Mont-Saxonnex", 2, false], ["Réunion", 3, false]]);
    expect(bcn.blockers).toEqual([{ kind: "over", guestId: expect.any(String), name: "Jessy", overBudgetEur: 172 }]);
  });

  it("lists what keeps a destination from working: Martin +440 € and Jessy +676 € at Mont-Saxonnex (C-S6)", async () => {
    const { tripId } = await computed();
    const ms = ready(getBudgetView(db, tripId)).cards.find((c) => c.shortLabel === "Mont-Saxonnex")!;
    expect(ms.blockers).toEqual([
      { kind: "over", guestId: expect.any(String), name: "Martin", overBudgetEur: 440 },
      { kind: "over", guestId: expect.any(String), name: "Jessy", overBudgetEur: 676 },
    ]);
  });

  it("explains La Réunion: Jessy +1,693 € and Martin, who only drives, with the plane as the fallback (+1,293 €)", async () => {
    const { tripId } = await computed();
    const run = ready(getBudgetView(db, tripId)).cards.find((c) => c.shortLabel === "Réunion")!;
    const jessy = run.blockers.find((b) => b.name === "Jessy")!;
    const martin = run.blockers.find((b) => b.name === "Martin")!;
    expect(jessy).toMatchObject({ kind: "over" });
    expect((jessy as { overBudgetEur: number }).overBudgetEur).toBeCloseTo(1692.67, 1);
    expect(martin).toMatchObject({ kind: "unreachable", modes: ["car"], fallback: { mode: "plane" } });
    const fallback = (martin as Extract<typeof martin, { kind: "unreachable" }>).fallback!;
    expect(fallback.costEur).toBeCloseTo(2170.67, 1);
    expect(fallback.overBudgetEur).toBeCloseTo(1292.67, 1);
  });

  it("counts the ★ on each card and names whose they are (C.1 step 4)", async () => {
    const scenario = await computed();
    expect(ready(getBudgetView(db, scenario.tripId)).cards.map((c) => c.votes.count)).toEqual([0, 0, 0]);

    castTheStars(scenario);
    const [bcn, run, ms] = ready(getBudgetView(db, scenario.tripId)).cards;
    expect(bcn.votes).toEqual({ count: 2, guestIds: [scenario.guests.martin.id, scenario.guests.jessy.id], names: ["Martin", "Jessy"] });
    expect(run.votes.names).toEqual(["Chloé"]);
    expect(ms.votes.count).toBe(0);
  });
});

describe("getBudgetView: the recommendation (C.4 #2, C-S5, C-S6)", () => {
  it("recommends none and names Barcelona the closest, with its total: 2,697 € (D.4)", async () => {
    const { tripId, destinations } = await computed();
    const { recommendation } = ready(getBudgetView(db, tripId));
    expect(recommendation).toMatchObject({ works: false, destinationId: destinations.bcn.id, shortLabel: "Barcelona", totalEur: 2697, includesFallback: false });
    expect(recommendation.perGuestEur).toBeCloseTo(899, 1);
  });

  it("says a ★ makes no destination eligible, Chloé's for La Réunion as Martin's and Jessy's for Barcelona", async () => {
    const scenario = await computed();
    castTheStars(scenario);
    const { recommendation } = ready(getBudgetView(db, scenario.tripId));

    expect(recommendation).toMatchObject({ works: false, destinationId: scenario.destinations.bcn.id });
    expect(recommendation.reasons.map((r) => r.kind)).toEqual(["closest", "star_cannot_override", "star_cannot_override"]);
    const stars = recommendation.reasons.filter((r) => r.kind === "star_cannot_override");
    expect(stars).toMatchObject([
      { names: ["Martin", "Jessy"], destination: "Barcelona" },
      { names: ["Chloé"], destination: "Réunion" },
    ]);
  });

  it("says who keeps the closest from working: Jessy +172 €; with nothing recommended, no destination \"leads\"", async () => {
    const { tripId } = await computed();
    const { reasons } = ready(getBudgetView(db, tripId)).recommendation;
    expect(reasons.find((r) => r.kind === "leads")).toBeUndefined();
    const closest = reasons.find((r) => r.kind === "closest") as { blockers: { name: string; overBudgetEur?: number }[] };
    expect(closest.blockers.map((b) => [b.name, b.overBudgetEur])).toEqual([["Jessy", 172]]);
  });

  it("gives the whole ranking with the figures behind each rank", async () => {
    const { tripId } = await computed();
    const { ranking } = ready(getBudgetView(db, tripId)).recommendation;
    expect(ranking.map((r) => [r.shortLabel, r.rank, r.eligible])).toEqual([["Barcelona", 1, false], ["Mont-Saxonnex", 2, false], ["Réunion", 3, false]]);
    expect(ranking[0]).toMatchObject({ comfyGuests: 1, totalEur: 2697, overrunEur: 172 });
    expect(ranking[1].overrunEur).toBe(1116);
    expect(ranking[0].averageComfort).toBeGreaterThan(0);
  });

  it("recommends nothing when none works for everyone, and names the closest and who is in the way (Barcelona's hotel ❤, B.1)", async () => {
    const { tripId, destinations } = await computed();
    const hotel = db.select().from(schema.stayOptions).all().find((o) => o.destinationId === destinations.bcn.id && o.provider === "booking")!;
    setSelection(db, destinations.bcn.id, { kind: "stay", optionId: hotel.id });

    const { recommendation } = ready(getBudgetView(db, tripId));
    expect(recommendation.works).toBe(false);
    expect(recommendation.destinationId).toBe(ready(getBudgetView(db, tripId)).recommendation.ranking[0].destinationId);
    expect(recommendation.reasons[0]).toMatchObject({ kind: "closest" });
    const blockers = (recommendation.reasons[0] as { blockers: { name: string; overBudgetEur?: number }[] }).blockers;
    // The hotel's Extra: no kitchen, its own tax; Martin's core goes to 1,077 €, Jessy's to 866 € (D.6)
    expect(blockers.map((b) => [b.name, b.overBudgetEur])).toEqual([["Martin", 277], ["Jessy", 466]]);
  });
});

describe("getBudgetView: the guest view (C.4 #4, C-S4)", () => {
  it("echoes the guest the page opens on, and opens on everyone for one it does not know", async () => {
    const { tripId, guests } = await computed();
    expect(ready(getBudgetView(db, tripId, { guestId: guests.jessy.id })).guestId).toBe(guests.jessy.id);
    expect(ready(getBudgetView(db, tripId, { guestId: "nobody" })).guestId).toBeNull();
    expect(ready(getBudgetView(db, tripId)).guestId).toBeNull();
    expect(ready(getBudgetView(db, tripId)).guests.map((g) => g.name)).toEqual(["Martin", "Chloé", "Jessy"]);
  });

  it("gives Jessy's own cost and colour at each destination: Barcelona 812 €, Mont-Saxonnex 1,183.60 €, La Réunion 2,170.67 €, all red (D.6)", async () => {
    const { tripId, guests } = await computed();
    const cards = ready(getBudgetView(db, tripId)).cards;
    const jessy = (shortLabel: string) => cards.find((c) => c.shortLabel === shortLabel)!.guestViews[guests.jessy.id];

    expect(jessy("Barcelona")).toMatchObject({ costEur: 812, tier: "over", color: "red", overBudgetEur: 172, maxBudgetEur: 400, housingShareEur: 300 });
    expect(jessy("Barcelona").budgetRatio).toBeCloseTo(2.03);
    expect(jessy("Mont-Saxonnex").costEur).toBeCloseTo(1183.6, 1);
    expect(jessy("Mont-Saxonnex")).toMatchObject({ tier: "over", color: "red", overBudgetEur: 676 });
    expect(jessy("Réunion").costEur).toBeCloseTo(2170.67, 1);
    expect(jessy("Réunion")).toMatchObject({ tier: "over", color: "red" });
  });

  it("gives a view per guest on every card, and Martin's plane to La Réunion as an assumption", async () => {
    const { tripId, guests } = await computed();
    const cards = ready(getBudgetView(db, tripId)).cards;
    for (const card of cards) expect(Object.keys(card.guestViews).sort()).toEqual(Object.values(guests).map((g) => g.id).sort());

    const martin = cards.find((c) => c.shortLabel === "Réunion")!.guestViews[guests.martin.id];
    expect(martin).toMatchObject({ status: "unreachable", transport: { mode: "plane", assumed: true } });
  });

  it("is only a view: the figures of the cards are the same whichever guest is chosen (C-S4)", async () => {
    const { tripId, guests } = await computed();
    const everyone = ready(getBudgetView(db, tripId)).cards.map((c) => c.total);
    const asJessy = ready(getBudgetView(db, tripId, { guestId: guests.jessy.id })).cards.map((c) => c.total);
    expect(asJessy).toEqual(everyone);
  });
});

describe("isWholeEuros", () => {
  it("is true for a whole amount, even with float noise", () => {
    expect(isWholeEuros(600)).toBe(true);
    expect(isWholeEuros(3700.0000001)).toBe(true);
    expect(isWholeEuros(2166.33)).toBe(false);
  });
});
