// Each guest's Extra at each destination (task.md T8.6, use-cases.md R10): the stored facts put together as the Extra's
// input, for the group's ❤ stay or the default one (R4), and worked out by core/extras.ts. Read on every page: nothing
// here asks a site or the AI, so a ❤ on another stay or another journey moves the Extra at once.
//
// Where each fact comes from:
// - the stay: its amenities and its tax as its page said (T8.2), what is around it (T8.3, place_surveys) and how it is
//   reached from each airport or station and back from a night out (T8.6, place_surveys.access);
// - the place: its local prices, things to do and tourist tax (T8.4, T8.5, destination_prices, extra_activities);
// - each guest: the journey they take (their ❤, or R3's pick), where it arrives and when.
import { eq, inArray } from "drizzle-orm";
import { extras as settings } from "@/config";
import { amenityFlags } from "@/core/amenities";
import { nightsBetween } from "@/core/dates";
import { extraPlan, type ExtraActivity, type ExtraGuest, type ExtraInput, type ExtraPlan, type LocalPrices, type StayFacts, type TransferLeg } from "@/core/extras";
import { rulesPrices } from "@/core/local-prices";
import type { Scenario } from "@/core/scenario";
import { touristTaxOf, type PageTax, type TaxRule } from "@/core/tourist-tax";
import type { Destination, Guest, StayOption } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { distanceKm } from "@/geo/airports";
import { hubsOf, type Hub } from "@/geo/hubs";
import { countryName, extraActivitiesOf, localPricesOf } from "./localPrices";
import { loadTripScenarios, type TripScenarios } from "./scenarios";
import { getPlaceSurveys } from "./surveys";

export type DestinationExtra = {
  destinationId: string;
  stayId: string;
  /** The group's ❤, or the default stay (R4) */
  staySource: "selected" | "default";
  /** Who gave the local prices: the AI, the rules from the country's price level, or the EU average when nothing was kept yet */
  pricesSource: "ai" | "rules" | "eu-average";
  input: ExtraInput;
  plan: ExtraPlan;
};

type Position = { lat: number; lon: number };
type StayRaw = { lat?: number; lon?: number; amenities?: string[]; touristTax?: PageTax };

const parsed = <T>(json: string | null): T | null => {
  try {
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
};

const km = (a: Position, b: Position) => distanceKm(a.lat, a.lon, b.lat, b.lon);
const CALM = /\b(?:calm|quiet|peaceful|cos[yi]|relax\w*|tranquil|serene)\b/i;

/** "HH:MM" of a local date-time is within the hours public transport is counted on */
const transitRunsAt = (at: string) => {
  const time = at.slice(11, 16);
  return time >= settings.transfer.transitHours.from && time <= settings.transfer.transitHours.to;
};

type StayRow = { id: string; provider: StayOption["provider"]; title: string; totalPriceEur: number; checkIn: string; checkOut: string; rawJson: string | null };
type Survey = ReturnType<typeof getPlaceSurveys> extends Map<string, infer S> ? S : never;

/**
 * What is known about a stay and around it (core/extras.ts `StayFacts`), from what its page said (T8.2), its survey
 * (T8.3, T8.6) and the place's tourist tax (T8.5). Shared by the Extra and the stay ratings (R11). Without amenities (a
 * stay found before T8.2), a whole home is taken to have a kitchen and a hotel not.
 */
export function stayFactsOf(stay: StayRow, context: { destination: Destination; groupSize: number; survey: Survey | null; touristTaxRule: TaxRule | null }): { facts: StayFacts; position: Position | null } {
  const { destination, survey } = context;
  const raw = parsed<StayRaw>(stay.rawJson) ?? {};
  const position: Position | null = typeof raw.lat === "number" && typeof raw.lon === "number" ? { lat: raw.lat, lon: raw.lon } : null;
  const centre = { lat: destination.lat, lon: destination.lon };
  const nights = nightsBetween({ from: stay.checkIn, to: stay.checkOut });
  const flags = amenityFlags(raw.amenities ?? []);
  const known = (raw.amenities ?? []).length > 0;
  const facts: StayFacts = {
    provider: stay.provider,
    kitchen: known ? flags.kitchen : stay.provider === "airbnb",
    freeParking: flags.freeParking,
    amenities: { spa: flags.spa, pool: flags.pool, sauna: flags.sauna, view: flags.view },
    calmWords: CALM.test(stay.title),
    quietRules: false,
    supermarketKm: survey?.supermarketKm ?? null,
    centreKm: survey?.centreKm ?? (position ? Math.round(km(position, centre) * 100) / 100 : null),
    historicCentreKm: survey?.historicCentreKm ?? null,
    nightlifeKm: survey?.nightlifeKm ?? null,
    natureKm: survey?.natureKm ?? null,
    barsWithin500m: survey?.barsWithin500m ?? null,
    sightsWithin1Km: survey?.sightsWithin1Km ?? null,
    // Back from a night out: a night bus when Transitous found one, else a taxi
    nightlife: survey?.nightlifeKm != null ? { transitBack: survey.access?.nightBus === true, taxiBackKm: Math.round(survey.nightlifeKm * settings.transfer.roadFactor * 10) / 10 } : null,
    touristTax: touristTaxOf({ page: raw.touristTax ?? null, provider: stay.provider, rule: context.touristTaxRule, stay: { totalPriceEur: stay.totalPriceEur, nights, guests: context.groupSize } }),
  };
  return { facts, position };
}

/** The Extra's input for a destination's scenario: null when it has no stay to work it out for */
export function extraInputOf(db: Db, destination: Destination, guests: Guest[], scenario: Scenario): { input: ExtraInput; pricesSource: DestinationExtra["pricesSource"] } | null {
  const stay: StayOption | null = scenario.stay;
  if (!stay) return null;
  const nights = nightsBetween({ from: stay.checkIn, to: stay.checkOut });
  const [stayRow] = db.select({ rawJson: schema.stayOptions.rawJson }).from(schema.stayOptions).where(eq(schema.stayOptions.id, stay.id)).all();
  const centre = { lat: destination.lat, lon: destination.lon };
  const survey = getPlaceSurveys(db, destination.id).get(stay.id) ?? null;
  const kept = localPricesOf(db, destination.id);
  const prices: LocalPrices = kept?.prices ?? rulesPrices(null, countryName(destination.countryCode)).prices;
  const { facts, position } = stayFactsOf({ ...stay, rawJson: stayRow?.rawJson ?? null }, { destination, groupSize: guests.length, survey, touristTaxRule: kept?.touristTax ?? null });

  // Each guest's way between their airport or station and the stay, at their own hours
  const chosen = scenario.guests.flatMap((guest) => (guest.transport ? [guest.transport.option.id] : []));
  const rawOf = new Map(
    chosen.length === 0
      ? []
      : db
          .select({ id: schema.transportOptions.id, rawJson: schema.transportOptions.rawJson })
          .from(schema.transportOptions)
          .where(inArray(schema.transportOptions.id, chosen))
          .all()
          .map((row) => [row.id, parsed<unknown>(row.rawJson)]),
  );
  const leg = (hub: Hub, at: string | null): TransferLeg => {
    const when = at ?? `${stay.checkIn}T12:00`;
    const fact = survey?.access?.transfers.find((known) => km(known, hub) <= settings.transfer.mergeKm);
    const distance = fact?.km ?? Math.round(km(hub, position ?? centre) * settings.transfer.roadFactor * 10) / 10;
    const transit = fact?.transitMin != null && transitRunsAt(when) ? { durationMin: fact.transitMin, fareEur: fact.fareEur ?? prices.transitTicket.eur } : null;
    return { at: when, hub: hub.name, km: distance, transit };
  };
  const extraGuests = scenario.guests.map((guest): ExtraGuest => {
    const option = guest.transport?.option ?? null;
    const mode = option?.mode ?? guests.find((g) => g.id === guest.guestId)?.preferredMode ?? "plane";
    if (mode === "car" || !option) return { guestId: guest.guestId, name: guest.name, mode, there: null, back: null };
    const hubs = hubsOf(rawOf.get(option.id), mode, destination);
    return { guestId: guest.guestId, name: guest.name, mode, there: leg(hubs.there, option.outArriveAt), back: leg(hubs.back, option.backDepartAt) };
  });

  // The things to do, from the stay: the road from the centre stretched to the stay, the bus from the centre if the stay is near it
  const activities = extraActivitiesOf(db, destination.id).map((activity): ExtraActivity => {
    const at = activity.lat !== null && activity.lon !== null ? { lat: activity.lat, lon: activity.lon } : null;
    const straightFromCentre = at ? km(centre, at) : null;
    const detour = activity.roadKmFromCentre !== null && straightFromCentre !== null && straightFromCentre > 0.5 ? activity.roadKmFromCentre / straightFromCentre : settings.transfer.roadFactor;
    const roadKmFromStay = at ? Math.round(km(position ?? centre, at) * detour * 10) / 10 : destination.objective === "nature" ? 20 : 1;
    const nearCentre = !position || km(position, centre) <= 5;
    return {
      name: activity.name,
      kind: activity.kind,
      priceEur: activity.priceEur,
      durationH: activity.durationH,
      roadKmFromStay,
      transit: activity.transitMinFromCentre !== null && nearCentre ? { durationMin: activity.transitMinFromCentre, fareEur: 2 * prices.transitTicket.eur } : null,
      source: activity.source === "ai" ? "ai" : "rules",
    };
  });

  return {
    input: { objective: destination.objective, budgetLevel: destination.budgetLevel, nights, stay: facts, prices, guests: extraGuests, activities },
    pricesSource: kept ? kept.source : "eu-average",
  };
}

/** Every destination's Extra for a trip, from its scenarios (one is read when not given) */
export function tripExtras(db: Db, tripId: string, scenarios: TripScenarios | null = loadTripScenarios(db, tripId)): Map<string, DestinationExtra> {
  const result = new Map<string, DestinationExtra>();
  if (!scenarios) return result;
  for (const scenario of scenarios.scenarios) {
    const destination = scenarios.trip.destinations.find((candidate) => candidate.id === scenario.destinationId);
    if (!destination || !scenario.stay) continue;
    const built = extraInputOf(db, destination, scenarios.trip.guests, scenario);
    if (!built) continue;
    result.set(destination.id, {
      destinationId: destination.id,
      stayId: scenario.stay.id,
      staySource: scenario.staySource === "selected" ? "selected" : "default",
      pricesSource: built.pricesSource,
      input: built.input,
      plan: extraPlan(built.input),
    });
  }
  return result;
}
