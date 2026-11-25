// The Extra's figures (use-cases.md UC-D) and its rules (R10 to R12), stated before they are built (task.md T8.1).
//
// A case is `it.fails` while the function it calls only says "not built yet". The task that builds the function turns
// its cases into `it`, and they must then pass as they are written: T8.6 the amounts (extraPlan: done), T8.7 the stay
// ratings (stayObjectiveScore, blendObjectiveScore: done), T8.8 the advice (adviseByRules) and the tier (budgetTierWithExtra): done.
import { describe, expect, it } from "vitest";
import {
  adviseByRules,
  budgetTierWithExtra,
  extraPlan,
  type ExtraActivity,
  type ExtraGuest,
  type ExtraInput,
  type ExtraLineId,
  type ExtraPlan,
  type LocalPrices,
  type StayFacts,
  type TransferLeg,
} from "@/core/extras";
import { blendObjectiveScore, stayObjectiveScore } from "@/core/ratings";
import { stayFactFixtures } from "@/db/seed/fixtures";
import { seedExtraInput } from "./helpers/extras";

const guestOf = (plan: ExtraPlan, guestId: string) => {
  const guest = plan.guests.find((candidate) => candidate.guestId === guestId);
  if (!guest) throw new Error(`No guest ${guestId} in the plan`);
  return guest;
};

/** A line's amount, or undefined when the line does not apply to that guest */
const lineOf = (plan: ExtraPlan, guestId: string, id: ExtraLineId) => guestOf(plan, guestId).lines.find((line) => line.id === id)?.eur;

/** Every line of a guest as { id: eur }, to compare at once */
const linesOf = (plan: ExtraPlan, guestId: string) => Object.fromEntries(guestOf(plan, guestId).lines.map((line) => [line.id, line.eur]));

// ---------------------------------------------------------------------------------------------------------------------
// UC-D: the reference scenario, 10 nights, no ❤

describe("UC-D Barcelona: Partying, light budget, the Gràcia apartment", () => {
  it("eats 3 meals in 30 out (25 % − 15 points), the supermarket being 200 m away", () => {
    const plan = extraPlan(seedExtraInput("barcelona"));
    expect(plan).toMatchObject({ restaurantSharePct: 10, restaurantMeals: 3, groceryMeals: 27, nightsOut: 5 });
  });

  it("gives Chloé and Jessy 202 € of Mandatory: food, the airport bus both ways, 7 nights of Catalan tax", () => {
    const plan = extraPlan(seedExtraInput("barcelona"));
    for (const guestId of ["chloe", "jessy"]) {
      expect(linesOf(plan, guestId)).toEqual({ food: 153, transfer: 14, "tourist-tax": 35, "nights-out": 195, "pre-drinks": 20, "night-transport": 25 });
      expect(guestOf(plan, guestId)).toMatchObject({ mandatoryEur: 202, plusEur: 240 });
    }
  });

  it("gives Martin, who drives, parking instead of a transfer: 338 € of Mandatory", () => {
    const plan = extraPlan(seedExtraInput("barcelona"));
    expect(linesOf(plan, "martin")).toEqual({ food: 153, parking: 150, "tourist-tax": 35, "nights-out": 195, "pre-drinks": 20, "night-transport": 25 });
    expect(guestOf(plan, "martin")).toMatchObject({ mandatoryEur: 338, plusEur: 240 });
  });

  it("moves at once with a ❤ on the hotel: no kitchen (67 % eaten out), its own tax", () => {
    const plan = extraPlan(seedExtraInput("barcelona", { stay: "fixture-barcelona-cuatro-naciones" }));
    expect(plan).toMatchObject({ restaurantSharePct: 67, restaurantMeals: 20, groceryMeals: 10 });
    expect(linesOf(plan, "chloe")).toMatchObject({ food: 340, transfer: 14, "tourist-tax": 42 });
    expect(guestOf(plan, "chloe")).toMatchObject({ mandatoryEur: 396, plusEur: 240 });
    expect(guestOf(plan, "martin").mandatoryEur).toBe(532);
  });

  it("shares a taxi home after a night out when no night bus runs", () => {
    const input = seedExtraInput("barcelona");
    const plan = extraPlan({ ...input, stay: { ...input.stay, nightlife: { transitBack: false, taxiBackKm: 7 } } });
    // A ticket there, and a 13 € taxi shared by the 3 of them, 5 nights
    expect(lineOf(plan, "jessy", "night-transport")).toBeCloseTo(34.17, 2);
    expect(guestOf(plan, "jessy").plusEur).toBeCloseTo(249.17, 2);
  });

  it("goes out once every two nights, rounded up", () => {
    expect(extraPlan({ ...seedExtraInput("barcelona"), nights: 3 }).nightsOut).toBe(2);
  });
});

describe("UC-D La Réunion: Chill, high budget, the villa", () => {
  it("eats 24 meals in 30 out (60 % + 20 points), mid-range", () => {
    const plan = extraPlan(seedExtraInput("la-reunion"));
    expect(plan).toMatchObject({ restaurantSharePct: 80, restaurantMeals: 24, groceryMeals: 6, dayPasses: 3 });
    expect(lineOf(plan, "chloe", "food")).toBe(750);
  });

  it("shares one taxi at night for the three of them (23:30 and 00:00), and takes the bus back by day", () => {
    const plan = extraPlan(seedExtraInput("la-reunion"));
    for (const guestId of ["martin", "chloe", "jessy"]) {
      expect(linesOf(plan, guestId)).toEqual({ food: 750, transfer: 36, "tourist-tax": 0, relax: 60, "local-transport": 18 });
      expect(guestOf(plan, guestId)).toMatchObject({ mandatoryEur: 786, plusEur: 78 });
    }
  });
});

describe("UC-D Le Mont-Saxonnex: Nature, high budget, the chalet", () => {
  it("eats half the meals out: the supermarket is 4 km away", () => {
    const plan = extraPlan(seedExtraInput("mont-saxonnex"));
    expect(plan).toMatchObject({ restaurantSharePct: 50, restaurantMeals: 15, groceryMeals: 15 });
    expect(lineOf(plan, "martin", "food")).toBe(495);
  });

  it("takes a taxi from Geneva (the bus takes 1 h 45), alone there and shared back", () => {
    const plan = extraPlan(seedExtraInput("mont-saxonnex"));
    expect(lineOf(plan, "chloe", "transfer")).toBe(141);
    expect(lineOf(plan, "jessy", "transfer")).toBe(141);
    expect(lineOf(plan, "martin", "transfer")).toBeUndefined();
    // The chalet has free parking
    expect(lineOf(plan, "martin", "parking")).toBeUndefined();
  });

  it("hikes 6 days in 10, in Martin's car: nothing is rented, the fuel is shared by three", () => {
    const plan = extraPlan(seedExtraInput("mont-saxonnex"));
    expect(plan).toMatchObject({ hikeDays: 6, carsNeeded: 1, rentalCars: 0 });
    expect(plan.activities).toHaveLength(6);
    for (const guestId of ["martin", "chloe", "jessy"]) {
      expect(lineOf(plan, guestId, "activities")).toBe(92);
      expect(lineOf(plan, guestId, "fuel")).toBeCloseTo(15.6, 2);
      expect(lineOf(plan, guestId, "car-rental")).toBeUndefined();
      expect(guestOf(plan, guestId).plusEur).toBeCloseTo(107.6, 2);
    }
    expect(guestOf(plan, "martin").mandatoryEur).toBe(495);
    expect(guestOf(plan, "chloe").mandatoryEur).toBe(636);
  });
});

describe("UC-D: whole trip, with the transfer out of the transport (D3)", () => {
  /** Transport + housing share, without the last mile (use-cases.md UC-D, D.2) */
  const TRIP = {
    barcelona: { martin: 445, chloe: 420, jessy: 370 },
    "la-reunion": { martin: 1040 + 800 / 3, chloe: 820 + 800 / 3, jessy: 1040 + 800 / 3 },
    "mont-saxonnex": { martin: 745, chloe: 410, jessy: 440 },
  } as const;

  it("totals 2,697 € in Barcelona, 3,684.80 € at Le Mont-Saxonnex and 6,292 € in La Réunion", () => {
    for (const [destination, total] of [["barcelona", 2697], ["mont-saxonnex", 3684.8], ["la-reunion", 6292]] as const) {
      const plan = extraPlan(seedExtraInput(destination));
      const sum = plan.guests.reduce((all, guest) => all + TRIP[destination][guest.guestId as "martin"] + guest.mandatoryEur + guest.plusEur, 0);
      expect(sum).toBeCloseTo(total, 2);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R6 with the Extra (decision D2)

describe("R6: the Mandatory counts fully, the Plus can only make a guest limited", () => {
  it("keeps Martin limited in Barcelona: 783 € without the Plus, 1,023 € with it, of 800 €", () => {
    expect(budgetTierWithExtra({ coreEur: 783, plusEur: 240 }, 800)).toEqual({ tier: "limited", overBudgetEur: 0 });
  });

  it("keeps Chloé comfy in Barcelona: 862 € of 1,200 €", () => {
    expect(budgetTierWithExtra({ coreEur: 622, plusEur: 240 }, 1200)).toEqual({ tier: "comfy", overBudgetEur: 0 });
  });

  it("puts Jessy over in Barcelona by 172 €: food and tax alone are more than her 400 €", () => {
    expect(budgetTierWithExtra({ coreEur: 572, plusEur: 240 }, 400)).toEqual({ tier: "over", overBudgetEur: 172 });
  });

  it("makes Chloé limited at Le Mont-Saxonnex, and Martin over by 440 €", () => {
    expect(budgetTierWithExtra({ coreEur: 1046, plusEur: 107.6 }, 1200).tier).toBe("limited");
    expect(budgetTierWithExtra({ coreEur: 1240, plusEur: 107.6 }, 800)).toEqual({ tier: "over", overBudgetEur: 440 });
  });

  it("draws the lines at 80 % and 100 % of the budget as before", () => {
    expect(budgetTierWithExtra({ coreEur: 600, plusEur: 40 }, 800).tier).toBe("comfy");
    expect(budgetTierWithExtra({ coreEur: 600, plusEur: 41 }, 800).tier).toBe("limited");
    expect(budgetTierWithExtra({ coreEur: 800, plusEur: 0 }, 800).tier).toBe("limited");
    expect(budgetTierWithExtra({ coreEur: 801, plusEur: 0 }, 800)).toEqual({ tier: "over", overBudgetEur: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R10 on cases the scenario does not have: Culture, None, a hotel for Chill, rented cars

const eur = (value: number) => ({ eur: value, source: "ai" as const });
const granadaPrices: LocalPrices = {
  groceriesPerDay: eur(12), cheapMeal: eur(14), midMeal: eur(25), drink: eur(4), clubEntry: eur(10), preDrinks: eur(3),
  transitTicket: eur(1.5), transitDayPass: eur(6), taxiStart: eur(4), taxiPerKm: eur(1.5), parkingPerDay: eur(12),
  carRentalPerDay: eur(35), fuelPerL: eur(1.6),
};
const albaicinFlat: StayFacts = {
  provider: "airbnb", kitchen: true, freeParking: false, amenities: { spa: false, pool: false, sauna: false, view: false },
  calmWords: false, quietRules: false, supermarketKm: 0.4, centreKm: 0.8, historicCentreKm: 0.6, nightlifeKm: 0.7, natureKm: 15,
  barsWithin500m: 10, sightsWithin1Km: 8, nightlife: { transitBack: true, taxiBackKm: 1.5 }, touristTax: null,
};
const leg = (at: string, overrides: Partial<TransferLeg> = {}): TransferLeg => ({ at, hub: "GRX", km: 17, transit: { durationMin: 45, fareEur: 3 }, ...overrides });
const byPlane = (guestId: string, there = leg("2027-05-10T10:00"), back = leg("2027-05-14T18:00")): ExtraGuest => ({ guestId, name: guestId, mode: "plane", there, back });
const sight = (name: string, priceEur: number, kind: ExtraActivity["kind"] = "monument"): ExtraActivity => ({ name, kind, priceEur, durationH: 2, roadKmFromStay: 1, transit: null, source: "ai" });
const granadaSights = [
  sight("The Alhambra", 19),
  sight("A walk through the Albaicín", 0, "tour"),
  sight("Mirador de San Nicolás", 0, "viewpoint"),
  sight("Granada Cathedral", 7),
  sight("The Royal Chapel", 7),
];
const granada = (overrides: Partial<ExtraInput> = {}): ExtraInput => ({
  objective: "culture", budgetLevel: "medium", nights: 4, stay: albaicinFlat, prices: granadaPrices,
  guests: [byPlane("ana"), byPlane("ben")], activities: granadaSights, ...overrides,
});

describe("R10 Culture: Granada, 4 nights, a flat in the Albaicín", () => {
  it("counts one sight a night, the first four listed, and no transport: the old town is 600 m away", () => {
    const plan = extraPlan(granada());
    expect(plan.activities.map((activity) => activity.name)).toEqual(["The Alhambra", "A walk through the Albaicín", "Mirador de San Nicolás", "Granada Cathedral"]);
    // 40 % of 12 meals is 4.8: 5 out at 14 €, 7 from the supermarket at 4 €; no tourist tax in Andalusia
    expect(linesOf(plan, "ana")).toEqual({ food: 98, transfer: 6, activities: 26 });
    expect(guestOf(plan, "ana")).toMatchObject({ mandatoryEur: 104, plusEur: 26 });
  });

  it("counts at least 3 sights and at most 5", () => {
    expect(extraPlan(granada({ nights: 2 })).activities).toHaveLength(3);
    expect(extraPlan(granada({ nights: 8 })).activities).toHaveLength(5);
  });

  it("adds a day pass a day when the old town is not walkable", () => {
    const plan = extraPlan(granada({ stay: { ...albaicinFlat, historicCentreKm: 2.5 } }));
    expect(plan.dayPasses).toBe(4);
    expect(lineOf(plan, "ana", "local-transport")).toBe(24);
  });
});

describe("R10 None: Granada, light budget", () => {
  it("eats 15 % out, has no activity and two tickets a night", () => {
    const plan = extraPlan(granada({ objective: "none", budgetLevel: "light" }));
    expect(plan.activities).toEqual([]);
    expect(linesOf(plan, "ben")).toEqual({ food: 68, transfer: 6, "local-transport": 12 });
  });
});

describe("R10 Chill and the stay", () => {
  const spaHotel: StayFacts = { ...albaicinFlat, provider: "booking", kitchen: false, amenities: { spa: true, pool: true, sauna: false, view: false } };

  it("eats at least 67 % out in a hotel with no kitchen, and needs no spa session when the hotel has one", () => {
    const plan = extraPlan(granada({ objective: "chill", stay: spaHotel }));
    expect(plan).toMatchObject({ restaurantSharePct: 67, restaurantMeals: 8, dayPasses: 1 });
    expect(linesOf(plan, "ana")).toEqual({ food: 128, transfer: 6, "local-transport": 6 });
  });

  it("eats 95 % out on a high budget with the supermarket far away", () => {
    const plan = extraPlan(granada({ objective: "chill", budgetLevel: "high", stay: { ...albaicinFlat, supermarketKm: 3 } }));
    // 11 mid-range meals at 25 €, 1 from the supermarket
    expect(plan).toMatchObject({ restaurantSharePct: 95, restaurantMeals: 11 });
    expect(lineOf(plan, "ana", "food")).toBe(279);
  });
});

describe("R10 the transfer", () => {
  it("puts 5 guests arriving at night in two taxis, the fare split by all five", () => {
    const night = leg("2027-05-10T23:50", { transit: null });
    const guests = ["a", "b", "c", "d", "e"].map((guestId) => byPlane(guestId, night));
    const plan = extraPlan(granada({ guests }));
    // 2 taxis × (4 € + 17 km × 1.5 €) ÷ 5, then the bus back
    expect(lineOf(plan, "c", "transfer")).toBeCloseTo(14.8, 2);
  });
});

describe("R10 Nature: the cars", () => {
  const sierra: StayFacts = { ...albaicinFlat, freeParking: true, natureKm: 20 };
  const hike = (name: string, priceEur: number, roadKmFromStay: number, transit: ExtraActivity["transit"] = null): ExtraActivity => ({
    name, kind: "hike", priceEur, durationH: 5, roadKmFromStay, transit, source: "ai",
  });

  it("rents a car at the airport for 4 guests by plane: it is their transfer too", () => {
    const far = { transit: null, km: 40 };
    const guests = ["a", "b", "c", "d"].map((guestId) => byPlane(guestId, leg("2027-06-10T10:00", far), leg("2027-06-14T18:00", far)));
    const plan = extraPlan(granada({ objective: "nature", stay: sierra, guests, activities: [hike("Mulhacén", 0, 20), hike("Sierra Nevada park", 10, 30), hike("Los Cahorros", 0, 25)] }));
    // 4 nights × 60 % is 2.4: 2 hike days, 1 car for 4
    expect(plan).toMatchObject({ hikeDays: 2, carsNeeded: 1, rentalCars: 1 });
    // Rental 4 × 35 ÷ 4; fuel for 100 km of hikes and 80 km to and from the airport, 6.5 L/100 km at 1.60 €, ÷ 4
    const { fuel, ...rest } = linesOf(plan, "a");
    expect(rest).toEqual({ food: 68, "car-rental": 35, activities: 10 });
    expect(fuel).toBeCloseTo(4.68, 2);
  });

  it("needs no car when the hikes are on foot or by bus", () => {
    const plan = extraPlan(granada({ objective: "nature", stay: sierra, activities: [hike("From the door", 0, 1), hike("By bus", 5, 30, { durationMin: 60, fareEur: 8 })] }));
    expect(plan).toMatchObject({ hikeDays: 2, carsNeeded: 0, rentalCars: 0 });
    expect(linesOf(plan, "ana")).toEqual({ food: 68, transfer: 6, activities: 5, "local-transport": 8 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R11: the objective in the stay rating (rules)

describe("R11: how well a stay suits the objective", () => {
  const august = { month: 8, lat: 41.39 };
  const gracia = stayFactFixtures["fixture-barcelona-gracia"];
  const hotel = stayFactFixtures["fixture-barcelona-cuatro-naciones"];

  it("puts the Gràcia flat before the central hotel for Partying: the group can gather in it", () => {
    expect(stayObjectiveScore("partying", gracia, august)).toBe(96);
    expect(stayObjectiveScore("partying", hotel, august)).toBe(88);
  });

  it("adds a quarter of it to the rules' score, and changes nothing for None", () => {
    expect(stayObjectiveScore("none", gracia, august)).toBeNull();
    expect(blendObjectiveScore(60, null)).toBe(60);
    expect(blendObjectiveScore(60, 96)).toBe(69);
    expect(blendObjectiveScore(60, 88)).toBe(67);
  });

  it("rewards a quiet hotel with a spa and a pool for Chill in July, and not a flat among 40 bars", () => {
    const spaHotel: StayFacts = { ...hotel, amenities: { spa: true, pool: true, sauna: false, view: false }, barsWithin500m: 3, calmWords: true };
    const busyFlat: StayFacts = { ...gracia, barsWithin500m: 40 };
    expect(stayObjectiveScore("chill", spaHotel, { month: 7, lat: 41.39 })).toBe(85);
    expect(stayObjectiveScore("chill", busyFlat, { month: 7, lat: 41.39 })).toBe(0);
    // August is winter south of the equator: the pool no longer counts, a sauna would
    expect(stayObjectiveScore("chill", spaHotel, { month: 8, lat: -21.1 })).toBe(60);
  });

  it("rewards the old town for Culture and the trails for Nature", () => {
    expect(stayObjectiveScore("culture", albaicinFlat, { month: 5, lat: 37.18 })).toBe(92);
    expect(stayObjectiveScore("culture", { ...albaicinFlat, historicCentreKm: 5, sightsWithin1Km: 0 }, { month: 5, lat: 37.18 })).toBe(0);
    expect(stayObjectiveScore("nature", stayFactFixtures["fixture-mont-saxonnex-bargy"], { month: 8, lat: 46.05 })).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// R12: the advice, by the rules

describe("R12 Barcelona: what the rules advise the guests over budget", () => {
  const guests = [
    { guestId: "martin", maxBudgetEur: 800, tripEur: 445 },
    { guestId: "chloe", maxBudgetEur: 1200, tripEur: 420 },
    { guestId: "jessy", maxBudgetEur: 400, tripEur: 370 },
  ];

  it("brings Martin back within budget: 4 nights out fewer, then the supermarket (798 € of 800 €)", () => {
    const input = seedExtraInput("barcelona");
    const advice = adviseByRules(input, extraPlan(input), guests);
    expect(advice.find((guest) => guest.guestId === "martin")).toEqual({
      guestId: "martin",
      levers: [
        { lever: "fewer-nights-out", steps: 4, savingEur: 192 },
        { lever: "groceries-only", steps: 1, savingEur: 33 },
      ],
      beforeEur: 1023,
      afterEur: 798,
      fits: true,
    });
  });

  it("says that nothing brings Jessy within budget: 572 € of 400 € with every lever", () => {
    const input = seedExtraInput("barcelona");
    const advice = adviseByRules(input, extraPlan(input), guests);
    expect(advice.find((guest) => guest.guestId === "jessy")).toEqual({
      guestId: "jessy",
      levers: [
        { lever: "fewer-nights-out", steps: 4, savingEur: 192 },
        { lever: "groceries-only", steps: 1, savingEur: 33 },
        { lever: "bars-only", steps: 1, savingEur: 15 },
      ],
      beforeEur: 812,
      afterEur: 572,
      fits: false,
    });
  });

  it("advises nothing to Chloé, who is within budget", () => {
    const input = seedExtraInput("barcelona");
    expect(adviseByRules(input, extraPlan(input), guests).map((guest) => guest.guestId)).toEqual(["martin", "jessy"]);
  });
});
