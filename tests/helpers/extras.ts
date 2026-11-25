// The Extra's input for a destination of the reference scenario (use-cases.md UC-D), from the seed's fixtures: the
// guests on their default options (R3, no ❤) and the default stay (R4), or another stay as if it had the ❤.
import type { ExtraGuest, ExtraInput } from "@/core/extras";
import type { BudgetLevel, Objective } from "@/core/types";
import {
  activityFixtures,
  localPriceFixtures,
  SCENARIO_NIGHTS,
  SCENARIO_WINDOW,
  stayFactFixtures,
  transferLegOf,
  transportFixtures,
  transportOptionOf,
  type DestinationKey,
} from "@/db/seed/fixtures";

const DESTINATIONS: Record<DestinationKey, { objective: Objective; budgetLevel: BudgetLevel; defaultStay: string }> = {
  barcelona: { objective: "partying", budgetLevel: "light", defaultStay: "fixture-barcelona-gracia" },
  "la-reunion": { objective: "chill", budgetLevel: "high", defaultStay: "fixture-reunion-saint-gilles" },
  "mont-saxonnex": { objective: "nature", budgetLevel: "high", defaultStay: "fixture-mont-saxonnex-bargy" },
};

/** The option each guest takes with no ❤ (use-cases.md A.2, B.2, C.2); Martin's La Réunion one is his plane fallback */
const PICKS: Record<DestinationKey, Record<"martin" | "chloe" | "jessy", string>> = {
  barcelona: { martin: "Car without tolls (620 km)", chloe: "Transavia ORY→BCN, departs 06:30", jessy: "Vueling MAD→BCN, departs 06:45" },
  "la-reunion": { martin: "Via Paris-Orly", chloe: "Via Marseille", jessy: "Via Paris-Orly" },
  "mont-saxonnex": {
    martin: "Car without tolls + 1 overnight stop each way",
    chloe: "easyJet CDG→GVA + bus/taxi 45 km",
    jessy: "easyJet MAD→GVA + bus/taxi",
  },
};

const NAMES = { martin: "Martin", chloe: "Chloé", jessy: "Jessy" } as const;

export function seedExtraInput(destination: DestinationKey, { stay }: { stay?: string } = {}): ExtraInput {
  const place = DESTINATIONS[destination];
  const stayId = stay ?? place.defaultStay;
  const guests = (Object.keys(NAMES) as (keyof typeof NAMES)[]).map((guestId): ExtraGuest => {
    const fixture = transportFixtures.find((option) => option.destination === destination && option.label === PICKS[destination][guestId]);
    if (!fixture) throw new Error(`No option "${PICKS[destination][guestId]}" for ${destination}`);
    if (fixture.mode === "car") return { guestId, name: NAMES[guestId], mode: "car", there: null, back: null };
    const option = transportOptionOf(fixture, fixture.originKey, SCENARIO_WINDOW);
    return {
      guestId,
      name: NAMES[guestId],
      mode: fixture.mode,
      there: transferLegOf(stayId, option.outArriveAt!),
      back: transferLegOf(stayId, option.backDepartAt!),
    };
  });
  return {
    objective: place.objective,
    budgetLevel: place.budgetLevel,
    nights: SCENARIO_NIGHTS,
    stay: stayFactFixtures[stayId],
    prices: localPriceFixtures[destination],
    guests,
    activities: activityFixtures[destination],
  };
}
