// The acceptance criteria of use-cases.md (UC-A, UC-B, UC-C) checked on the seeded scenario.
import { describe, expect, it } from "vitest";
import { budgetDelta } from "@/core/pricing";
import { buildScenario, pickCheapest, pickMostPractical, pickDefaultStay } from "@/core/scenario";
import type { Selection, TransportOption } from "@/core/types";
import { loadScenario } from "./helpers/scenario";

const s = loadScenario();
const guestOf = (scenario: ReturnType<typeof s.scenarioFor>, name: string) =>
  scenario.guests.find((guest) => guest.name === name)!;

const barcelona = s.scenarioFor("barcelona");
const montSaxonnex = s.scenarioFor("mont-saxonnex");
const laReunion = s.scenarioFor("la-reunion");

const heart = (
  key: "barcelona" | "la-reunion" | "mont-saxonnex",
  rest:
    | { kind: "transport"; guestId: string; transportOptionId: string }
    | { kind: "stay"; stayOptionId: string },
): Selection => ({
  id: "sel",
  tripId: s.tripId,
  destinationId: s.destinations[key].id,
  reason: null,
  createdAt: "",
  ...rest,
});

const optionWhere = (predicate: (option: TransportOption) => boolean) => {
  const found = s.options.filter(predicate);
  if (found.length !== 1) throw new Error(`Expected one option, found ${found.length}`);
  return found[0];
};

// The figures are the budget with the Extra (use-cases.md UC-D, D.6, task.md T8.9): transport and housing as UC-A to
// UC-C give them, plus each guest's Mandatory and Plus, with the tier of R6 with the Extra (D2)
describe("UC-A: Martin, by car with 800 €", () => {
  it("costs 1,023 € in Barcelona (445 € + an Extra of 578 €), limited: only the Plus puts him over his 800 €", () => {
    const martin = guestOf(barcelona, "Martin");
    expect(martin.costEur).toBe(1023);
    expect([martin.mandatoryEur, martin.plusEur]).toEqual([338, 240]);
    expect(martin.transport).toMatchObject({ source: "default", comfort: { level: "yellow" } });
    expect(martin.transport?.option.variant).toBe("no_tolls");
    expect(martin.housingShareEur).toBe(300);
    expect(martin).toMatchObject({ tier: "limited", overBudgetEur: 0 });
  });

  it("costs 1,347.60 € at Mont-Saxonnex, over by 440 €, with the overnight stop (the other two options are red)", () => {
    const martin = guestOf(montSaxonnex, "Martin");
    expect(martin.costEur).toBeCloseTo(1347.6, 2);
    expect(martin.transport?.option.variant).toBe("overnight_stop");
    expect(martin.transport?.costEur).toBe(445);
    expect(martin).toMatchObject({ tier: "over", overBudgetEur: 440 });
  });

  it("is unreachable for La Réunion by car, with the plane as an assumption (2,170.67 € with the Extra)", () => {
    const martin = guestOf(laReunion, "Martin");
    expect(martin).toMatchObject({ status: "unreachable", reason: "no_road_route", tier: "over" });
    expect(martin.transport).toMatchObject({ source: "fallback", costEur: 1040 });
    expect(martin.costEur).toBeCloseTo(2170.67, 2);
    expect(laReunion.totalIncludesFallback).toBe(true);
  });

  it("can reach La Réunion once he also accepts the plane", () => {
    const guestModes = { ...s.guestModes, [s.martin.id]: ["car" as const, "plane" as const] };
    const martin = guestOf(s.scenarioFor("la-reunion", { guestModes }), "Martin");
    expect(martin.status).toBe("ok");
    expect(martin.costEur).toBeCloseTo(2170.67, 2);
    expect(martin.transport?.source).toBe("default");
  });

  it("goes to 1,053 € and the Barcelona total to 2,727 € with a ❤ on car with tolls, which puts him over (core 813 €), and back without it", () => {
    const withTolls = optionWhere(
      (o) => o.destinationId === s.destinations.barcelona.id && o.mode === "car" && o.variant === "tolls",
    );
    const hearted = s.scenarioFor("barcelona", {
      selections: [heart("barcelona", { kind: "transport", guestId: s.martin.id, transportOptionId: withTolls.id })],
    });
    expect(guestOf(hearted, "Martin").costEur).toBe(1053);
    expect(guestOf(hearted, "Martin")).toMatchObject({ tier: "over", overBudgetEur: 13 });
    expect(guestOf(hearted, "Martin").transport?.source).toBe("selected");
    expect(hearted.totalEur).toBe(2727);

    expect(guestOf(s.scenarioFor("barcelona"), "Martin").costEur).toBe(1023);
    expect(s.scenarioFor("barcelona").totalEur).toBe(2697);
  });

  it("does not change the other guests' costs (A-S7)", () => {
    const withTolls = optionWhere(
      (o) => o.destinationId === s.destinations.barcelona.id && o.mode === "car" && o.variant === "tolls",
    );
    const hearted = s.scenarioFor("barcelona", {
      selections: [heart("barcelona", { kind: "transport", guestId: s.martin.id, transportOptionId: withTolls.id })],
    });
    expect(guestOf(hearted, "Chloé").costEur).toBe(guestOf(barcelona, "Chloé").costEur);
    expect(guestOf(hearted, "Jessy").costEur).toBe(guestOf(barcelona, "Jessy").costEur);
  });
});

describe("UC-B: Jessy with 400 € by plane", () => {
  it("costs 812 € in Barcelona (over by 172 €: food and tax alone), 1,183.60 € at Mont-Saxonnex (over by 676 €), 2,170.67 € in La Réunion (over by 1,692.67 €)", () => {
    const [b, m, r] = [barcelona, montSaxonnex, laReunion].map((scenario) => guestOf(scenario, "Jessy"));
    expect([b.costEur, b.tier, b.overBudgetEur]).toEqual([812, "over", 172]);
    expect(b.transport?.option.provider).toBe("vueling");
    expect(m.costEur).toBeCloseTo(1183.6, 2);
    expect([m.tier, m.overBudgetEur]).toEqual(["over", 676]);
    expect(r.tier).toBe("over");
    expect(r.costEur).toBeCloseTo(2170.67, 2);
    expect(r.overBudgetEur).toBeCloseTo(1692.67, 2);
  });

  it("is never offered the 910 € flight as the cheapest, it is red", () => {
    const threeStops = optionWhere((o) => o.priceEur === 910);
    expect(threeStops.stops).toBe(3);
    expect(guestOf(laReunion, "Jessy").transport?.option.id).not.toBe(threeStops.id);
    expect(guestOf(laReunion, "Jessy").transport?.costEur).toBe(1040);
  });

  it("is already over before a ❤ on the Barcelona hotel, which brings Jessy to 1,106 € with its own Extra (no kitchen, its own tax: 396 €, D.6)", () => {
    const hotel = s.stays.find((stay) => stay.provider === "booking" && stay.destinationId === s.destinations.barcelona.id)!;
    const hearted = s.scenarioFor("barcelona", { selections: [heart("barcelona", { kind: "stay", stayOptionId: hotel.id })] });
    expect(guestOf(hearted, "Jessy")).toMatchObject({ costEur: 1106, mandatoryEur: 396, tier: "over", overBudgetEur: 466 });
    expect(hearted.tier).toBe("over");
    expect(hearted.staySource).toBe("selected");
    expect(guestOf(barcelona, "Jessy").tier).toBe("over");
  });

  it("only warns about guests the ❤ pushes into the red: Martin (+277 €), not Jessy, who already is", () => {
    const hotel = s.stays.find((stay) => stay.provider === "booking" && stay.destinationId === s.destinations.barcelona.id)!;
    const hearted = s.scenarioFor("barcelona", { selections: [heart("barcelona", { kind: "stay", stayOptionId: hotel.id })] });
    // With the hotel's own Extra: Martin's core goes from 783 € to 1,077 € (100 € more of housing, 194 € more of Mandatory)
    const delta = budgetDelta(barcelona, hearted);
    expect(delta.warnings).toEqual(["Martin +277 €"]);
    expect(delta.perGuest.find((entry) => entry.guestId === s.jessy.id)).toMatchObject({ before: 812, after: 1106, tier: "over" });
    expect([delta.totalBefore, delta.totalAfter]).toEqual([2697, 3579]);
  });
});

describe("UC-C: the group", () => {
  it("totals 2,697 €, 3,684.80 € and 6,292 € (with the fallback assumption)", () => {
    expect(barcelona.totalEur).toBe(2697);
    expect(montSaxonnex.totalEur).toBeCloseTo(3684.8, 6);
    expect(laReunion.totalEur).toBeCloseTo(6292, 6);
    expect(laReunion.totalIncludesFallback).toBe(true);
    expect(barcelona.totalIncludesFallback).toBe(false);
  });

  it("averages ~899 €, ~1,228 € and ~2,097 € per guest", () => {
    expect(Math.round(barcelona.averagePerGuestEur)).toBe(899);
    expect(Math.round(montSaxonnex.averagePerGuestEur)).toBe(1228);
    expect(Math.round(laReunion.averagePerGuestEur)).toBe(2097);
  });

  it("has Chloé at 862 € (120 + 300 + 442), 1,153.60 € (110 + 300 + 743.60, the last mile now in her Extra) and 1,950.67 €", () => {
    const [b, m, r] = [barcelona, montSaxonnex, laReunion].map((scenario) => guestOf(scenario, "Chloé"));
    expect([b.costEur, b.tier]).toEqual([862, "comfy"]);
    expect([b.transport?.costEur]).toEqual([120]);
    expect(m.costEur).toBeCloseTo(1153.6, 2);
    expect([m.tier, m.transport?.costEur]).toEqual(["limited", 110]);
    expect(r.costEur).toBeCloseTo(1950.67, 2);
    expect(r.tier).toBe("over");
    expect(r.transport?.costEur).toBe(820);
  });

  it("rates each destination by its worst guest: over everywhere (Jessy)", () => {
    expect(barcelona.tier).toBe("over");
    expect(montSaxonnex.tier).toBe("over");
    expect(laReunion.tier).toBe("over");
  });

  it("shares the accommodation equally: 300 €, 300 € and ~267 €", () => {
    expect(barcelona.housingShareEur).toBe(300);
    expect(montSaxonnex.housingShareEur).toBe(300);
    expect(laReunion.housingShareEur).toBeCloseTo(266.67, 2);
    expect(barcelona.stay?.provider).toBe("airbnb");
    expect(barcelona.staySource).toBe("default");
  });

  it("has every guest reachable except Martin in La Réunion", () => {
    const unreachable = (scenario: typeof barcelona) =>
      scenario.guests.filter((guest) => guest.status === "unreachable").map((guest) => guest.name);
    expect(unreachable(barcelona)).toEqual([]);
    expect(unreachable(montSaxonnex)).toEqual([]);
    expect(unreachable(laReunion)).toEqual(["Martin"]);
  });
});

describe("route checks the routing service could not make", () => {
  it("do not block a guest, they are only unverified (A.5)", () => {
    const unverified = s.checks.map((check) =>
      check.mode === "car" && check.destinationId === s.destinations["la-reunion"].id
        ? { ...check, reason: "osrm_unavailable" }
        : check,
    );
    const scenario = buildScenario({
      destination: s.destinations["la-reunion"],
      guests: s.guests,
      guestModes: s.guestModes,
      options: s.options,
      stays: s.stays,
      analyses: s.analyses,
      selections: [],
      checks: unverified,
    });
    // There are no car options for La Réunion in the data, so Martin still has nothing to take,
    // but the reason is no longer "no_road_route"
    const martin = scenario.guests.find((guest) => guest.name === "Martin")!;
    expect(martin.reason).toBeNull();
  });
});

describe("picking helpers", () => {
  const forBarcelona = (originKey: string, mode: string) =>
    s.options.filter(
      (o) => o.destinationId === s.destinations.barcelona.id && o.originKey === originKey && o.mode === mode,
    );

  it("pickMostPractical prefers the comfortable 10:15 Iberia flight over the cheaper 06:45 one", () => {
    const rated = forBarcelona("MAD", "plane").map((o) => ({
      ...o,
      comfortScore: o.provider === "iberia" ? 95 : 82,
      comfortLevel: o.provider === "iberia" ? ("green" as const) : ("yellow" as const),
    }));
    expect(pickMostPractical(rated)?.provider).toBe("iberia");
    expect(pickCheapest(rated)?.provider).toBe("vueling");
  });

  it("pickMostPractical breaks a tie with the price", () => {
    const [a, b] = forBarcelona("MAD", "plane").map((o) => ({ ...o, comfortScore: 80 }));
    expect(pickMostPractical([a, b])?.priceEur).toBe(Math.min(a.priceEur, b.priceEur));
  });

  it("pickCheapest is null when every option is red", () => {
    const allRed = forBarcelona("MAD", "plane").map((o) => ({ ...o, comfortLevel: "red" as const }));
    expect(pickCheapest(allRed)).toBeNull();
    expect(pickCheapest([])).toBeNull();
  });

  const stays = s.stays.filter((stay) => stay.destinationId === s.destinations.barcelona.id);
  const [apartment, hotel] = [...stays].sort((a, b) => a.totalPriceEur - b.totalPriceEur);

  it("pickDefaultStay takes the cheapest that sleeps the group", () => {
    expect(pickDefaultStay(stays, s.analyses, 3)).toEqual(apartment);
    expect(pickDefaultStay(stays, s.analyses, 4)).toBeNull();
  });

  it("pickDefaultStay skips a stay the AI judged bad, but not one that was never analysed", () => {
    const bad = new Map(s.analyses).set(apartment.id, { ...s.analyses.get(apartment.id)!, verdict: "bad" });
    expect(pickDefaultStay(stays, bad, 3)).toEqual(hotel);
    expect(pickDefaultStay(stays, new Map(), 3)).toEqual(apartment);
  });
});
