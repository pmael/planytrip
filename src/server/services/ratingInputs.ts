// What the AI is asked to rate for a destination, and its fingerprint. The worker uses it to ask;
// the dashboard uses it to tell whether the scores kept are still for what is stored now (a guest's
// budget, the dates or an offer may have changed since). Nothing here calls the AI.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type RatingKind, type TransportMode, type TransportOption } from "@/core/types";
import { ratings as ratingsConfig } from "@/config";
import { commonWindow, nightsBetween, tripWindow } from "@/core/dates";
import { rateStayByRules, rateTransportByRules, seasonOf, stayObjectiveScore, type RuleRating } from "@/core/ratings";
import { toDestination } from "@/db/mappers";
import { stayFactsOf } from "./extras";
import { localPricesOf } from "./localPrices";
import { getPlaceSurveys } from "./surveys";
import { transportCostFor } from "@/core/pricing";
import { rateOptions } from "@/core/scenario";
import { toStayOption, toTransportOption } from "@/db/mappers";
import { withObservedPrices } from "./observedPrices";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { plainText, ratingHashOf, type StayRatingFacts, type TransportRatingFacts } from "@/ai/option-ratings";
import { getTrip } from "./trips";

/** Everything needed to rate one kind of option at one destination. */
export type RatingInput<Facts> = {
  tripId: string;
  destinationId: string;
  kind: RatingKind;
  /** The fingerprint of everything that was scraped and everything about the group that matters */
  hash: string;
  /** What the AI is shown: the most promising candidates, each with a code */
  facts: Facts;
  /** The code of each candidate shown to the AI → its option id */
  codes: Map<string, string>;
  /** What the rules say about every option of the destination, shown to the AI or not: the rating when the AI gives none */
  rules: Map<string, RuleRating>;
};

const cityOf = (label: string) => label.split(",")[0];

const euros = (value: number) => Math.round(value);

/** What a scraper kept besides the columns of a stay (Airbnb: reviews, host, distance...), read leniently. */
const ExtrasSchema = z.object({
  reviewCount: z.number().nullish(),
  hostType: z.string().nullish(),
  propertyType: z.string().nullish(),
  bathrooms: z.number().nullish(),
  distanceKm: z.number().nullish(),
  badges: z.array(z.string()).nullish(),
});

function extrasOf(rawJson: string | null) {
  try {
    const parsed = ExtrasSchema.safeParse(rawJson ? JSON.parse(rawJson) : {});
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

// ── The stays ───────────────────────────────────────────────────────────────

/** The stays of a destination, ready to be rated. Null when there is none, or the trip is gone. */
export function stayRatingInputOf(db: Db, destinationId: string): RatingInput<StayRatingFacts> | null {
  const [destination] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  const trip = destination && getTrip(db, destination.tripId);
  const rows = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationId)).all();
  if (!destination || !trip || trip.guests.length === 0 || rows.length === 0) return null;

  const groupSize = trip.guests.length;
  const budgets = trip.guests.map((guest) => ({ name: guest.name, maxBudgetEur: guest.maxBudgetEur }));
  const poorest = Math.min(...budgets.map((b) => b.maxBudgetEur));
  // R11: what is known around each stay (T8.3) and the destination's objective, for the rules and for the AI
  const place = toDestination(destination);
  const surveys = getPlaceSurveys(db, destinationId);
  const touristTaxRule = localPricesOf(db, destinationId)?.touristTax ?? null;
  const season = { month: Number(rows[0].checkIn.slice(5, 7)), lat: place.lat };

  const candidates = rows
    .map((row) => {
      const stay = toStayOption(row);
      const extras = extrasOf(row.rawJson);
      const { facts: around } = stayFactsOf(row, { destination: place, groupSize, survey: surveys.get(row.id) ?? null, touristTaxRule });
      const objectiveScore = stayObjectiveScore(place.objective, around, season);
      const rules = rateStayByRules({
        capacity: stay.capacity,
        totalPriceEur: stay.totalPriceEur,
        groupSize,
        budgets,
        rating: stay.rating,
        reviewCount: extras.reviewCount ?? null,
        distanceKm: extras.distanceKm ?? null,
        objective: { name: place.objective, score: objectiveScore },
      });
      const share = stay.totalPriceEur / groupSize;
      const amenities = Object.entries(around.amenities)
        .filter(([, has]) => has)
        .map(([name]) => name);
      const facts = {
        title: plainText(stay.title),
        source: stay.provider === "booking" ? "A hotel (Google Hotels)" : "Airbnb",
        bedrooms: stay.rooms,
        beds: stay.beds,
        bathrooms: extras.bathrooms ?? null,
        sleeps: stay.capacity,
        totalEur: stay.totalPriceEur,
        perGuestEur: euros(share),
        shareOfThePoorestGuestsBudgetPercent: Math.round((share / poorest) * 100),
        ratingOutOf5: stay.rating,
        reviewCount: extras.reviewCount ?? null,
        hostType: extras.hostType ?? null,
        propertyType: plainText(extras.propertyType, 40) || null,
        distanceFromTheCentreKm: extras.distanceKm ?? null,
        badges: (extras.badges ?? []).map((badge) => plainText(badge, 30)),
        // What is around it and what it has (T8.3, T8.7): null when not known
        around: {
          nightlifeDistrictKm: around.nightlifeKm,
          barsWithin500m: around.barsWithin500m,
          historicCentreKm: around.historicCentreKm,
          sightsWithin1Km: around.sightsWithin1Km,
          nearestHikingPathOrParkKm: around.natureKm,
          nearestSupermarketKm: around.supermarketKm,
        },
        has: [...(around.kitchen ? ["kitchen"] : []), ...(around.freeParking ? ["free parking"] : []), ...amenities],
      };
      return { stay, rules, facts };
    })
    // Most promising first, by the rules; the order is fixed so the same stays always give the same question
    .sort((a, b) => b.rules.score - a.rules.score || a.stay.id.localeCompare(b.stay.id));

  const first = candidates[0].stay;
  const shared = {
    destination: { name: cityOf(destination.label), country: destination.countryCode, outsideEurope: !destination.inScope, tripObjective: destination.objective, tripBudgetLevel: destination.budgetLevel, season: seasonOf(season) },
    trip: { checkIn: first.checkIn, checkOut: first.checkOut, nights: Math.max(1, nightsBetween({ from: first.checkIn, to: first.checkOut })) },
    group: { size: groupSize, guests: budgets },
  };

  const shown = candidates.slice(0, ratingsConfig.maxPromptCandidates);
  return {
    tripId: trip.id,
    destinationId,
    kind: "stays",
    // Everything scraped counts, not just what the AI is shown: a new listing makes the scores stale
    hash: ratingHashOf({ ...shared, candidates: candidates.map((c) => ({ id: c.stay.id, ...c.facts })) }),
    facts: { ...shared, candidates: shown.map((c, index) => ({ code: `S${index + 1}`, ...c.facts })) },
    codes: new Map(shown.map((c, index) => [`S${index + 1}`, c.stay.id])),
    rules: new Map(candidates.map((c) => [c.stay.id, c.rules])),
  };
}

// ── The journeys ────────────────────────────────────────────────────────────

/** The transport options of a destination, ready to be rated. Null when there is none, or the trip is gone. */
export function transportRatingInputOf(db: Db, destinationId: string): RatingInput<TransportRatingFacts> | null {
  const [destination] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  const trip = destination && getTrip(db, destination.tripId);
  const options = withObservedPrices(db, db.select().from(schema.transportOptions).where(eq(schema.transportOptions.destinationId, destinationId)).all().map(toTransportOption));
  if (!destination || !trip || trip.guests.length === 0 || options.length === 0) return null;

  // Comfort is judged against the other options of the same route, so it is worked out for the destination as a whole
  const { rated, comforts } = rateOptions(options);
  const originsOf = new Map<string, typeof trip.guests>();
  for (const guest of trip.guests) originsOf.set(guest.originKey, [...(originsOf.get(guest.originKey) ?? []), guest]);

  // The guests who would take a journey: those leaving from its origin who accept its mode. A journey no
  // one of them accepts (offered to a guest who cannot get there another way) is for the whole origin.
  const accepts = (guest: (typeof trip.guests)[number], mode: TransportMode) => (trip.guestModes[guest.id] ?? [guest.preferredMode]).includes(mode);
  const takersOf = (option: TransportOption) => {
    const fromThere = originsOf.get(option.originKey) ?? trip.guests;
    const taking = fromThere.filter((guest) => accepts(guest, option.mode));
    return taking.length > 0 ? taking : fromThere;
  };

  const candidates = rated
    .map((option: TransportOption) => {
      const takers = takersOf(option);
      const budgets = takers.map((guest) => ({ name: guest.name, maxBudgetEur: guest.maxBudgetEur }));
      const cost = transportCostFor(option);
      const comfort = comforts.get(option.id)!;
      const rules = rateTransportByRules({ costEur: cost, budgets, comfort, soldOut: option.soldOut });
      const poorest = Math.min(...budgets.map((b) => b.maxBudgetEur));
      const facts = {
        from: cityOf(takers[0].homeLabel),
        takenBy: takers.map((guest) => guest.name),
        mode: option.mode,
        provider: plainText(option.provider, 30),
        variant: option.variant,
        priceEur: option.priceEur,
        priceIs: option.priceUnit === "per_vehicle" ? "for the car, shared by the people in it" : "per person, round trip",
        // A price worked out rather than asked by the seller may be off: the rating must not lean on it as on a fare
        priceIsAnEstimate: option.priceKind === "estimated" ? (option.priceNote ? plainText(option.priceNote, 120) : "estimated") : false,
        // Only said when it is so, so that the facts of every other journey (and the ratings already made from them) stay the same
        ...(option.soldOut ? { soldOut: true } : {}),
        lastMileEur: option.lastMileEur,
        costEachEur: euros(cost),
        shareOfThePoorestGuestsBudgetPercent: Math.round((cost / poorest) * 100),
        departsOut: option.outDepartAt,
        outDurationMin: option.outDurationMin,
        stops: option.stops,
        comfort: { level: comfort.level, score: comfort.score, reasons: comfort.reasons },
      };
      return { option, rules, facts };
    })
    .sort((a, b) => b.rules.score - a.rules.score || a.option.id.localeCompare(b.option.id));

  const groupSize = trip.guests.length;
  const fitting = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationId)).all().filter((row) => row.capacity >= groupSize);
  const cheapestShare = fitting.length > 0 ? euros(Math.min(...fitting.map((row) => row.totalPriceEur)) / groupSize) : null;
  const rawWindow = commonWindow(trip.guests, destination);
  const window = rawWindow && tripWindow(rawWindow, trip.nights);

  const shared = {
    destination: { name: cityOf(destination.label), country: destination.countryCode, outsideEurope: !destination.inScope },
    dates: window ? { from: window.from, to: window.to } : null,
    group: { size: groupSize },
    cheapestAccommodationShareEur: cheapestShare,
    origins: [...originsOf.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, guests]) => ({
        from: cityOf(guests[0].homeLabel),
        guests: guests.map((guest) => ({ name: guest.name, maxBudgetEur: guest.maxBudgetEur, acceptsModes: trip.guestModes[guest.id] ?? [guest.preferredMode] })),
      })),
  };

  const shown = candidates.slice(0, ratingsConfig.maxPromptCandidates);
  return {
    tripId: trip.id,
    destinationId,
    kind: "transport",
    hash: ratingHashOf({ ...shared, candidates: candidates.map((c) => ({ id: c.option.id, ...c.facts })) }),
    facts: { ...shared, candidates: shown.map((c, index) => ({ code: `T${index + 1}`, ...c.facts })) },
    codes: new Map(shown.map((c, index) => [`T${index + 1}`, c.option.id])),
    rules: new Map(candidates.map((c) => [c.option.id, c.rules])),
  };
}

/** The input for either kind. */
export function ratingInputOf(db: Db, destinationId: string, kind: RatingKind) {
  return kind === "stays" ? stayRatingInputOf(db, destinationId) : transportRatingInputOf(db, destinationId);
}
