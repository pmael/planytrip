// The Extra: what each guest spends once there (use-cases.md R10 to R12, extra.md). Pure, like the rest of core: the
// facts (local prices, what is around the stay, how each guest gets from the airport or station to it, the activities)
// are found and stored while the trip is set up, and this works out the amounts every time a page is read. A ❤ on
// another stay, or a budget that changes, shows at once, and the AI is never asked from here.
//
// task.md T8.1 set the shape, the rules and the figures (tests/extras.test.ts); T8.6 built the amounts (extraPlan), T8.8
// the levers and the rules' advice (adviseByRules) and the tier with the Extra (budgetTierWithExtra, wired in by T8.9).
import { budgetTier, car, extras } from "@/config";
import type { BudgetLevel, BudgetTier, IsoDateTime, Objective, StayProvider, TransportMode } from "./types";

/**
 * Who gave a local price: the AI at setup (an estimate), the rules from a country's price level, open data, or a figure a
 * site publishes from its own bookings (`published`: DiscoverCars' monthly average for a rental car, task.md T8.11)
 */
export type PriceSource = "ai" | "rules" | "open-data" | "published";

/** `note`: whose figure it is ("DiscoverCars' average at GVA, August"), `url`: where a person can check it */
export type LocalPrice = { eur: number; source: PriceSource; note?: string; url?: string };

/** One adult, at the destination, in euros. All but the open data are estimates, and are shown with ≈. */
export type LocalPrices = {
  /** Food from the supermarket for one day (three meals) */
  groceriesPerDay: LocalPrice;
  /** A meal in a simple restaurant (light and medium budgets) */
  cheapMeal: LocalPrice;
  /** A meal in a mid-range restaurant (high budget) */
  midMeal: LocalPrice;
  /** A drink in a bar or a club */
  drink: LocalPrice;
  clubEntry: LocalPrice;
  /** Each person's share of the drinks bought at the supermarket before a night out */
  preDrinks: LocalPrice;
  transitTicket: LocalPrice;
  transitDayPass: LocalPrice;
  taxiStart: LocalPrice;
  taxiPerKm: LocalPrice;
  parkingPerDay: LocalPrice;
  /** An economy car, basic insurance included */
  carRentalPerDay: LocalPrice;
  fuelPerL: LocalPrice;
};

/**
 * The tourist tax at the stay. `included`: the stay's price already has it (Airbnb collects it for some listings, Google
 * Hotels' totals include it). `source`: the stay's own page, France's open data, the config table, the AI (T8.5).
 */
export type TouristTax = { perNightEur: number; maxNights: number | null; included: boolean; source: PriceSource | "page" | "config" };

/** What is known about the stay and around it (OpenStreetMap, the listing, the AI). A distance nobody knows is null. */
export type StayFacts = {
  provider: StayProvider;
  kitchen: boolean;
  freeParking: boolean;
  /** `sauna` also stands for a hot tub or a hammam */
  amenities: { spa: boolean; pool: boolean; sauna: boolean; view: boolean };
  /** "calm", "quiet", "peaceful", "cosy", "relaxing" in the title or the reviews */
  calmWords: boolean;
  /** The listing's rules say "no parties" or set quiet hours */
  quietRules: boolean;
  /** To the nearest supermarket, as the crow flies */
  supermarketKm: number | null;
  centreKm: number | null;
  historicCentreKm: number | null;
  /** To the nearest nightlife district the AI named, or the densest cluster of bars and clubs */
  nightlifeKm: number | null;
  /** To the nearest marked hiking path, trailhead or small natural park, as the crow flies (core/surroundings.ts) */
  natureKm: number | null;
  barsWithin500m: number | null;
  sightsWithin1Km: number | null;
  /** Coming back from the nightlife district at `config.extras.partying.nightTransportAt`: a night bus, or else a taxi this far */
  nightlife: { transitBack: boolean; taxiBackKm: number } | null;
  /** null: there is no tourist tax there */
  touristTax: TouristTax | null;
};

/** One way between the arrival airport or station and the stay, at the time the guest arrives (there) or leaves (back) */
export type TransferLeg = {
  /** Local wall-clock time of the arrival, or of the departure on the way back */
  at: IsoDateTime;
  hub: string;
  /** By road, for a taxi */
  km: number;
  /** The public transport journey Transitous found at that hour, its fare one way; null when there is none */
  transit: { durationMin: number; fareEur: number } | null;
};

export type ExtraGuest = {
  guestId: string;
  name: string;
  /** How they get to the destination (their ❤ or default option, or the fallback); a car is a car at the stay */
  mode: TransportMode;
  /** null for a guest who comes by car */
  there: TransferLeg | null;
  back: TransferLeg | null;
};

export const ACTIVITY_KINDS = ["club", "bar", "museum", "monument", "boat", "viewpoint", "tour", "hike", "beach", "park", "spa", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Something to do there, as the AI listed it at setup, most worthwhile first. Its position was checked on a map. */
export type ExtraActivity = {
  name: string;
  kind: ActivityKind;
  /** One adult: tickets, park or parking fees; 0 when free */
  priceEur: number;
  durationH: number | null;
  /** By road, from the stay */
  roadKmFromStay: number;
  /** Public transport from the stay, there and back, per person; null when there is none */
  transit: { durationMin: number; fareEur: number } | null;
  source: PriceSource;
};

export type ExtraInput = {
  objective: Objective;
  budgetLevel: BudgetLevel;
  nights: number;
  /** The group's ❤ stay, or the default one (R4) */
  stay: StayFacts;
  prices: LocalPrices;
  guests: ExtraGuest[];
  activities: ExtraActivity[];
};

export const EXTRA_LINE_IDS = [
  // Mandatory
  "food",
  "transfer",
  "parking",
  "tourist-tax",
  // Plus
  "nights-out",
  "pre-drinks",
  "night-transport",
  "activities",
  "relax",
  "local-transport",
  "car-rental",
  "fuel",
] as const;
export type ExtraLineId = (typeof EXTRA_LINE_IDS)[number];

export const MANDATORY_LINES: readonly ExtraLineId[] = ["food", "transfer", "parking", "tourist-tax"];

/** A line of a guest's Extra, unrounded. A line that does not apply is left out; a tax already in the price is a line of 0. */
export type ExtraLine = { id: ExtraLineId; eur: number };

export type GuestExtra = {
  guestId: string;
  lines: ExtraLine[];
  mandatoryEur: number;
  plusEur: number;
};

/** One way between the arrival airport or station and the stay, as it is counted (R10): what the Extra page details */
export type PlannedTransfer = {
  guestId: string;
  way: "there" | "back";
  hub: string;
  /** Local time of the arrival, or of the departure on the way back */
  at: IsoDateTime;
  /** What it costs this guest */
  eurEach: number;
} & (
  | { by: "transit"; durationMin: number; fareEur: number }
  /** `riders`: the guests sharing the taxis (this one included), `taxis` how many it takes, `fareEur` one taxi's fare */
  | { by: "taxi"; km: number; fareEur: number; taxis: number; riders: string[] }
);

/** How a Nature activity is reached (R10): on foot within 2 km, by public transport within 90 min, else by car */
export type ActivityWay = "on-foot" | "transit" | "car";

/** The plan the amounts come from: the same for every guest but the transfer, the parking and the car. */
export type ExtraPlan = {
  restaurantSharePct: number;
  restaurantMeals: number;
  groceryMeals: number;
  /** The restaurant meal counted: a cheap one, a mid-range one for a high budget */
  mealEur: number;
  /** Each way to and from the stay of the guests who take one (not by car, nor in a rented car) */
  transfers: PlannedTransfer[];
  /** Partying */
  nightsOut: number;
  /** Nature */
  hikeDays: number;
  /** Chill, culture: public transport day passes per guest */
  dayPasses: number;
  /** The activities counted, in the order they were listed */
  activities: ExtraActivity[];
  /** Nature: how each activity counted is reached, in the order of `activities`; empty for the other objectives */
  activityWays: ActivityWay[];
  /** Nature: cars on the road for the hikes, and how many of them are rented */
  carsNeeded: number;
  rentalCars: number;
  /** Nature: the guests who ride in the rented cars, which are their transfer */
  renters: string[];
  /** Nature: what each car drives to the activities that need one, there and back */
  hikeKm: number;
  /** Partying: each night's way back from the nightlife district, what it costs each guest; null for the other objectives */
  nightBack: { by: "transit"; eurEach: number } | { by: "taxi"; eurEach: number; km: number; taxis: number } | null;
  guests: GuestExtra[];
};

/** R10: each guest's Extra. */
export function extraPlan(input: ExtraInput, settings: ExtrasSettings = extras): ExtraPlan {
  return planWith(input, {}, settings);
}

type ExtrasSettings = typeof extras;

/**
 * Turns of the plan the advice tries (R12): fewer nights out, bars-only nights, no restaurant, fewer activities. The
 * plan itself is planWith(input, {}).
 */
export type PlanChanges = {
  nightsOut?: number;
  barsOnlyNights?: number;
  groceriesOnly?: boolean;
  /** The dearest paid activities left out */
  skippedActivities?: number;
  skipRelax?: boolean;
  dayPasses?: number;
  /** Ways taken by public transport rather than a taxi: "guestId|there", "guestId|back" */
  transitLegs?: string[];
};

/** The activities counted, less the `skipped` dearest paid ones */
function lessTheDearest(activities: ExtraActivity[], skipped: number): ExtraActivity[] {
  if (skipped <= 0) return activities;
  const dearest = new Set([...activities].filter((activity) => activity.priceEur > 0).sort((a, b) => b.priceEur - a.priceEur).slice(0, skipped));
  return activities.filter((activity) => !dearest.has(activity));
}

const minutes = (at: string) => Date.parse(`${at.slice(0, 16)}:00Z`) / 60_000;

/** One way of the transfer for the guests who take it (R10): public transport within the limit, or taxis shared by those arriving together. */
function transferCosts(way: PlannedTransfer["way"], legs: { guestId: string; leg: TransferLeg; byTransit?: boolean }[], prices: LocalPrices, settings: ExtrasSettings): PlannedTransfer[] {
  const planned: PlannedTransfer[] = [];
  const byTaxi: { guestId: string; leg: TransferLeg }[] = [];
  for (const item of legs) {
    const transit = item.leg.transit;
    if (transit && (item.byTransit || transit.durationMin <= settings.transfer.maxTransitMin)) {
      planned.push({ guestId: item.guestId, way, hub: item.leg.hub, at: item.leg.at, eurEach: transit.fareEur, by: "transit", durationMin: transit.durationMin, fareEur: transit.fareEur });
    } else byTaxi.push(item);
  }
  byTaxi.sort((a, b) => a.leg.hub.localeCompare(b.leg.hub) || minutes(a.leg.at) - minutes(b.leg.at));
  for (let i = 0; i < byTaxi.length; ) {
    const first = byTaxi[i];
    const group = byTaxi.slice(i).filter((item) => item.leg.hub === first.leg.hub && minutes(item.leg.at) - minutes(first.leg.at) <= settings.transfer.shareWithinMin);
    const fare = prices.taxiStart.eur + first.leg.km * prices.taxiPerKm.eur;
    const taxis = Math.ceil(group.length / settings.transfer.taxiSeats);
    const riders = group.map((item) => item.guestId);
    for (const item of group) {
      planned.push({ guestId: item.guestId, way, hub: item.leg.hub, at: item.leg.at, eurEach: (taxis * fare) / group.length, by: "taxi", km: first.leg.km, fareEur: fare, taxis, riders });
    }
    i += group.length;
  }
  return planned;
}

const LINE_ORDER: readonly ExtraLineId[] = EXTRA_LINE_IDS;

function planWith(input: ExtraInput, changes: PlanChanges, settings: ExtrasSettings): ExtraPlan {
  const { prices, stay, nights, guests } = input;
  const n = guests.length;
  const lines = new Map<string, ExtraLine[]>(guests.map((guest) => [guest.guestId, []]));
  const add = (guestId: string, id: ExtraLineId, eur: number) => {
    const own = lines.get(guestId)!;
    const line = own.find((existing) => existing.id === id);
    if (line) line.eur += eur;
    else own.push({ id, eur });
  };
  const addAll = (id: ExtraLineId, eur: number) => guests.forEach((guest) => add(guest.guestId, id, eur));

  // Food: the share of meals eaten out, from the objective, the budget level and the stay
  const meals = nights * settings.mealsPerNight;
  let share = settings.restaurantSharePct[input.objective] + settings.budgetLevelSharePts[input.budgetLevel];
  if (stay.supermarketKm !== null && stay.supermarketKm > settings.supermarketCloseKm) share += settings.farSupermarketSharePts;
  share = Math.min(100, Math.max(0, share));
  if (!stay.kitchen) share = Math.max(share, settings.noKitchenMinSharePct);
  const restaurantMeals = changes.groceriesOnly ? 0 : Math.round((meals * share) / 100);
  const groceryMeals = meals - restaurantMeals;
  const meal = input.budgetLevel === "high" ? prices.midMeal.eur : prices.cheapMeal.eur;
  const activityWays: ActivityWay[] = [];
  let hikeKm = 0;
  let nightBack: ExtraPlan["nightBack"] = null;
  addAll("food", restaurantMeals * meal + (groceryMeals * prices.groceriesPerDay.eur) / 3);

  // Nature: the hike days, and whether a car is needed (it is the transfer of the guests it carries)
  let hikeDays = 0;
  let activities: ExtraActivity[] = [];
  let carsNeeded = 0;
  let rentalCars = 0;
  let renters = new Set<string>();
  const needsCar = (activity: ExtraActivity) => activity.roadKmFromStay > settings.nature.walkKm && !(activity.transit && activity.transit.durationMin <= settings.nature.maxTransitMin);
  if (input.objective === "nature") {
    hikeDays = Math.round((nights * settings.nature.hikeSharePct) / 100);
    activities = lessTheDearest(input.activities.slice(0, hikeDays), changes.skippedActivities ?? 0);
    if (activities.some(needsCar)) {
      carsNeeded = Math.ceil(n / settings.nature.seatsPerCar);
      const ownCars = guests.filter((guest) => guest.mode === "car").length;
      rentalCars = Math.max(0, carsNeeded - Math.min(ownCars, carsNeeded));
      if (rentalCars > 0) renters = new Set(guests.filter((guest) => guest.mode !== "car").map((guest) => guest.guestId));
    }
  }

  // Getting to the stay and back, each way on its own
  const transfers: PlannedTransfer[] = [];
  for (const way of ["there", "back"] as const) {
    const legs = guests
      .filter((guest) => guest[way] && !renters.has(guest.guestId))
      .map((guest) => ({ guestId: guest.guestId, leg: guest[way]!, byTransit: changes.transitLegs?.includes(`${guest.guestId}|${way}`) }));
    for (const planned of transferCosts(way, legs, prices, settings)) {
      add(planned.guestId, "transfer", planned.eurEach);
      transfers.push(planned);
    }
  }
  for (const guest of guests) if (guest.mode === "car" && !stay.freeParking) add(guest.guestId, "parking", prices.parkingPerDay.eur * nights);
  if (stay.touristTax) addAll("tourist-tax", stay.touristTax.included ? 0 : stay.touristTax.perNightEur * Math.min(nights, stay.touristTax.maxNights ?? Number.POSITIVE_INFINITY));

  // The Plus, by objective
  let nightsOut = 0;
  let dayPasses = 0;
  if (input.objective === "partying") {
    nightsOut = changes.nightsOut ?? Math.ceil(nights / settings.partying.nightsPerNightOut);
    const barsOnly = Math.min(changes.barsOnlyNights ?? 0, nightsOut);
    addAll("nights-out", nightsOut * settings.partying.drinksPerNight * prices.drink.eur + (nightsOut - barsOnly) * prices.clubEntry.eur);
    addAll("pre-drinks", nightsOut * prices.preDrinks.eur);
    const taxiKm = stay.nightlife?.taxiBackKm ?? 0;
    const taxis = Math.ceil(n / settings.partying.taxiSeats);
    const back = stay.nightlife?.transitBack ? prices.transitTicket.eur : (taxis * (prices.taxiStart.eur + taxiKm * prices.taxiPerKm.eur)) / Math.max(n, 1);
    nightBack = stay.nightlife?.transitBack ? { by: "transit", eurEach: back } : { by: "taxi", eurEach: back, km: taxiKm, taxis };
    addAll("night-transport", nightsOut * (prices.transitTicket.eur + back));
  } else if (input.objective === "chill") {
    const spa = input.activities.find((activity) => activity.kind === "spa" && activity.priceEur > 0);
    if (spa && !stay.amenities.spa && !changes.skipRelax) {
      addAll("relax", spa.priceEur);
      activities = [spa];
    }
    dayPasses = changes.dayPasses ?? Math.max(1, Math.floor(nights / settings.chill.nightsPerDayPass));
    if (dayPasses > 0) addAll("local-transport", dayPasses * prices.transitDayPass.eur);
  } else if (input.objective === "culture") {
    const count = Math.min(settings.culture.maxActivities, Math.max(settings.culture.minActivities, nights));
    activities = lessTheDearest(input.activities.slice(0, count), changes.skippedActivities ?? 0);
    addAll("activities", activities.reduce((sum, activity) => sum + activity.priceEur, 0));
    if (stay.historicCentreKm !== null && stay.historicCentreKm > settings.culture.walkableKm) {
      dayPasses = changes.dayPasses ?? nights;
      if (dayPasses > 0) addAll("local-transport", dayPasses * prices.transitDayPass.eur);
    }
  } else if (input.objective === "nature") {
    for (const activity of activities) activityWays.push(activity.roadKmFromStay <= settings.nature.walkKm ? "on-foot" : needsCar(activity) ? "car" : "transit");
    addAll("activities", activities.reduce((sum, activity) => sum + activity.priceEur, 0));
    const byTransit = activities.filter((activity) => activity.roadKmFromStay > settings.nature.walkKm && !needsCar(activity));
    const transitFares = byTransit.reduce((sum, activity) => sum + activity.transit!.fareEur, 0);
    if (transitFares > 0) addAll("local-transport", transitFares);
    if (carsNeeded > 0) {
      const litresPerKm = car.consumptionLPer100Km / 100;
      hikeKm = activities.filter(needsCar).reduce((sum, activity) => sum + 2 * activity.roadKmFromStay, 0);
      const hikeFuel = (carsNeeded * hikeKm * litresPerKm * prices.fuelPerL.eur) / n;
      const firstRenter = guests.find((guest) => renters.has(guest.guestId));
      const transferFuel = firstRenter ? (rentalCars * ((firstRenter.there?.km ?? 0) + (firstRenter.back?.km ?? 0)) * litresPerKm * prices.fuelPerL.eur) / renters.size : 0;
      for (const guest of guests) {
        if (renters.has(guest.guestId)) add(guest.guestId, "car-rental", (rentalCars * nights * prices.carRentalPerDay.eur) / renters.size);
        add(guest.guestId, "fuel", hikeFuel + (renters.has(guest.guestId) ? transferFuel : 0));
      }
    }
  } else {
    addAll("local-transport", settings.none.transitTicketsPerNight * nights * prices.transitTicket.eur);
  }

  return {
    restaurantSharePct: share,
    restaurantMeals,
    groceryMeals,
    mealEur: meal,
    transfers,
    nightsOut,
    hikeDays,
    dayPasses,
    activities,
    activityWays,
    carsNeeded,
    rentalCars,
    renters: [...renters],
    hikeKm,
    nightBack,
    guests: guests.map((guest): GuestExtra => {
      const own = lines.get(guest.guestId)!.sort((a, b) => LINE_ORDER.indexOf(a.id) - LINE_ORDER.indexOf(b.id));
      return {
        guestId: guest.guestId,
        lines: own,
        mandatoryEur: own.filter((line) => MANDATORY_LINES.includes(line.id)).reduce((sum, line) => sum + line.eur, 0),
        plusEur: own.filter((line) => !MANDATORY_LINES.includes(line.id)).reduce((sum, line) => sum + line.eur, 0),
      };
    }),
  };
}

/** What a guest's trip costs with the Extra: `coreEur` is transport + housing share + mandatory, `plusEur` the Plus. */
export type CostWithExtra = { coreEur: number; plusEur: number };

/**
 * R6 with the Extra (decision D2): the Mandatory counts fully, the Plus is a suggestion. A guest is over only when the
 * core is over the budget; the Plus alone can make them limited, never over. `overBudgetEur` is the core's overrun.
 */
export function budgetTierWithExtra(cost: CostWithExtra, maxBudgetEur: number): { tier: BudgetTier; overBudgetEur: number } {
  const EPSILON = 1e-9;
  if (cost.coreEur > maxBudgetEur + EPSILON) return { tier: "over", overBudgetEur: cost.coreEur - maxBudgetEur };
  return { tier: (cost.coreEur + cost.plusEur) / maxBudgetEur <= budgetTier.comfyMaxRatio + EPSILON ? "comfy" : "limited", overBudgetEur: 0 };
}

/** R12: the ways of spending less, worked out by the rules; the AI only chooses among them and words them. */
export const LEVER_IDS = ["groceries-only", "fewer-nights-out", "bars-only", "skip-activity", "skip-relax", "fewer-day-passes", "transit-not-taxi"] as const;
export type LeverId = (typeof LEVER_IDS)[number];

/** A lever used `steps` times (one night out fewer, twice), and what it saves the guest in all */
export type LeverUse = { lever: LeverId; steps: number; savingEur: number };

/** The rules' advice for one guest whose trip with the Extra is over their budget */
export type GuestAdvice = {
  guestId: string;
  levers: LeverUse[];
  /** Transport + housing + Extra, before and after the levers */
  beforeEur: number;
  afterEur: number;
  /** False when even every lever does not bring the guest within budget */
  fits: boolean;
};

/** For each guest: their budget and what transport and housing already cost them */
export type AdviceGuest = { guestId: string; maxBudgetEur: number; tripEur: number };

/** What a guest's trip costs in all (transport and housing + the Extra) with some changes to the plan */
export function totalWith(input: ExtraInput, changes: PlanChanges, guest: AdviceGuest): number {
  const own = planWith(input, changes, extras).guests.find((candidate) => candidate.guestId === guest.guestId)!;
  return guest.tripEur + own.mandatoryEur + own.plusEur;
}

/** The plan as it would be with `steps` more of a lever, or null when the lever has no more steps for this guest */
export function withLever(input: ExtraInput, plan: ExtraPlan, changes: PlanChanges, lever: LeverId, guestId: string, steps = 1): PlanChanges | null {
  const s = extras;
  const nightsOut = changes.nightsOut ?? plan.nightsOut;
  switch (lever) {
    case "groceries-only":
      return !changes.groceriesOnly && plan.restaurantMeals > 0 && steps === 1 ? { ...changes, groceriesOnly: true } : null;
    case "fewer-nights-out":
      return input.objective === "partying" && nightsOut - steps >= s.partying.minNightsOut ? { ...changes, nightsOut: nightsOut - steps } : null;
    case "bars-only": {
      const bars = (changes.barsOnlyNights ?? 0) + steps;
      return input.objective === "partying" && bars <= nightsOut ? { ...changes, barsOnlyNights: bars } : null;
    }
    case "skip-activity": {
      const skipped = (changes.skippedActivities ?? 0) + steps;
      return plan.activities.filter((activity) => activity.priceEur > 0).length >= skipped && (input.objective === "culture" || input.objective === "nature") ? { ...changes, skippedActivities: skipped } : null;
    }
    case "skip-relax":
      return input.objective === "chill" && !changes.skipRelax && steps === 1 && plan.guests.some((guest) => guest.lines.some((line) => line.id === "relax")) ? { ...changes, skipRelax: true } : null;
    case "fewer-day-passes": {
      const passes = (changes.dayPasses ?? plan.dayPasses) - steps;
      return passes >= 0 && plan.dayPasses > 0 ? { ...changes, dayPasses: passes } : null;
    }
    case "transit-not-taxi": {
      // A taxi the guest takes alone, where public transport exists but takes longer than the transfer allows
      const taken = new Set(changes.transitLegs ?? []);
      const guest = input.guests.find((candidate) => candidate.guestId === guestId);
      const open = (["there", "back"] as const).filter((way) => {
        const leg = guest?.[way];
        const key = `${guestId}|${way}`;
        if (!leg?.transit || leg.transit.durationMin <= s.transfer.maxTransitMin || taken.has(key)) return false;
        const before = planWith(input, changes, s);
        const after = planWith(input, { ...changes, transitLegs: [...taken, key] }, s);
        return after.guests.every((other) => other.guestId === guestId || Math.abs(other.mandatoryEur - before.guests.find((g) => g.guestId === other.guestId)!.mandatoryEur) < 1e-9);
      });
      return open.length >= steps ? { ...changes, transitLegs: [...taken, ...open.slice(0, steps).map((way) => `${guestId}|${way}`)] } : null;
    }
  }
}

/** R12 without the AI: for each guest over budget, the biggest saving first, one step at a time, until it fits or nothing is left. */
export function adviseByRules(input: ExtraInput, plan: ExtraPlan, guests: AdviceGuest[]): GuestAdvice[] {
  const advice: GuestAdvice[] = [];
  for (const guest of guests) {
    const beforeEur = totalWith(input, {}, guest);
    if (beforeEur <= guest.maxBudgetEur + 1e-9) continue;
    let changes: PlanChanges = {};
    let current = beforeEur;
    const levers: LeverUse[] = [];
    while (current > guest.maxBudgetEur + 1e-9) {
      const best = LEVER_IDS.map((lever) => {
        const next = withLever(input, plan, changes, lever, guest.guestId);
        return next ? { lever, next, saving: current - totalWith(input, next, guest) } : null;
      })
        .filter((step): step is { lever: LeverId; next: PlanChanges; saving: number } => step !== null && step.saving > 1e-9)
        .sort((a, b) => b.saving - a.saving)[0];
      if (!best) break;
      const use = levers.find((used) => used.lever === best.lever);
      if (use) {
        use.steps++;
        use.savingEur += best.saving;
      } else levers.push({ lever: best.lever, steps: 1, savingEur: best.saving });
      changes = best.next;
      current -= best.saving;
    }
    advice.push({ guestId: guest.guestId, levers, beforeEur, afterEur: current, fits: current <= guest.maxBudgetEur + 1e-9 });
  }
  return advice;
}
