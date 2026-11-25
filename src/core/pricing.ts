// Costs and budget tiers (use-cases.md R5, R6) and what a ❤ changed.
import { budgetTier as tierLimits, car } from "@/config";
import type { BudgetDelta, BudgetTier, StayOption, TransportOption } from "./types";
import type { Scenario } from "./scenario";

// Costs are kept unrounded (C-S3); rounding to the euro only happens at display time.
const EPSILON = 1e-9;

type Priced = Pick<TransportOption, "priceEur" | "priceUnit" | "lastMileEur">;

/**
 * What one guest pays for an option (R5): the fare, or the vehicle's price shared between its occupants for the car (one
 * occupant in the POC). The way from the airport or station to the stay is the Extra's transfer (D3, task.md T8.9), so
 * the option's `lastMileEur` only counts for its comfort. `lastMile`: the destination's Extra does not count yet (its
 * local prices are not stored), so the fare keeps the last mile, as before T8.9.
 */
export function transportCostFor(option: Priced, occupants: number = car.occupants, lastMile = false): number {
  if (option.priceUnit === "per_vehicle") return option.priceEur / occupants;
  return option.priceEur + (lastMile ? option.lastMileEur : 0);
}

/** One guest's share of the accommodation. No stay means nothing to share. */
export function housingShare(stay: Pick<StayOption, "totalPriceEur"> | null, groupSize: number): number {
  return stay ? stay.totalPriceEur / groupSize : 0;
}

/** What a guest's transport and share of the accommodation cost them; their Extra comes on top (R5, core/scenario.ts). */
export function guestCost(option: Priced, stay: Pick<StayOption, "totalPriceEur"> | null, groupSize: number): number {
  return transportCostFor(option) + housingShare(stay, groupSize);
}

/**
 * R6 without the Extra: comfy up to 80 % of the budget, limited up to 100 %, over beyond. With the Extra, the tier is
 * `budgetTierWithExtra` (core/extras.ts, D2).
 */
export function budgetTier(cost: number, maxBudget: number): BudgetTier {
  const ratio = cost / maxBudget;
  if (ratio <= tierLimits.comfyMaxRatio + EPSILON) return "comfy";
  if (ratio <= tierLimits.limitedMaxRatio + EPSILON) return "limited";
  return "over";
}

const TIER_ORDER: BudgetTier[] = ["comfy", "limited", "over"];

/** The worst of several tiers: a destination is as bad as its worst-off guest. */
export function worstTier(tiers: BudgetTier[]): BudgetTier {
  return tiers.reduce<BudgetTier>(
    (worst, tier) => (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(worst) ? tier : worst),
    "comfy",
  );
}

/**
 * What a ❤ did, from the scenario before it and the one after: each guest's cost and tier after, and the guests it put
 * into the red, with their overrun ("Martin +13 €", B-S9). Exact, the Extra included.
 */
export function budgetDelta(before: Scenario, after: Scenario): BudgetDelta {
  const perGuest: BudgetDelta["perGuest"] = [];
  const warnings: string[] = [];
  for (const guest of after.guests) {
    if (guest.costEur === null) continue;
    const was = before.guests.find((candidate) => candidate.guestId === guest.guestId);
    perGuest.push({ guestId: guest.guestId, before: was?.costEur ?? guest.costEur, after: guest.costEur, tier: guest.tier });
    if (guest.tier === "over" && was?.tier !== "over" && guest.overBudgetEur !== null) warnings.push(`${guest.name} +${Math.round(guest.overBudgetEur)} €`);
  }
  return { perGuest, totalBefore: before.totalEur, totalAfter: after.totalEur, warnings };
}

/**
 * What a car trip costs the driver, round trip (use-cases.md A-S6): the fuel for twice the
 * distance plus the tolls of both ways. The tolls are estimated from the km driven on toll roads.
 * `fuelEurPerL`: the countries' pump price (EU Weekly Oil Bulletin, task.md T8.12), else the config's.
 */
export function carTripCostEur({ distanceKm, tollKm = 0 }: { distanceKm: number; tollKm?: number }, fuelEurPerL: number = car.fuelPriceEurPerL): number {
  const fuel = ((distanceKm * 2 * car.consumptionLPer100Km) / 100) * fuelEurPerL;
  const tolls = tollKm * 2 * car.tollEurPerKm;
  return Math.round(fuel + tolls);
}
