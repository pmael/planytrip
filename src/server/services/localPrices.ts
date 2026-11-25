// A destination's local prices and things to do (task.md T8.4, use-cases.md R10): what the AI is asked, what is kept,
// and reading it back. Given once while the trip is set up (worker/handlers/price-destination.ts); the dashboard only
// reads them.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { localPricesHashOf, type LocalPricesFacts } from "@/ai/extra-prices";
import { extraPrices } from "@/config";
import { commonWindow, nightsBetween, tripWindow } from "@/core/dates";
import { ACTIVITY_KINDS, type ActivityKind, type LocalPrices } from "@/core/extras";
import { PRICE_KEYS } from "@/core/local-prices";
import { touristTaxOf, type PageTax, type TaxRule } from "@/core/tourist-tax";
import type { Objective, RatingSource } from "@/core/types";
import { toDestination, toGuest } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

const cityOf = (label: string) => label.split(",")[0].trim();
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
/** "ES" → "Spain" */
export const countryName = (code: string) => {
  try {
    return countryNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

export type LocalPricesInput = {
  destinationId: string;
  objective: Objective;
  countryCode: string;
  country: string;
  centre: { lat: number; lon: number };
  /** The airports near the destination, nearest first: where a Nature trip's car is rented (D6) */
  airports: string[];
  facts: LocalPricesFacts;
  hash: string;
};

/** What the AI is asked about a destination; null when it has no dates for the group (nothing to price yet). */
export function localPricesInputOf(db: Db, destinationId: string): LocalPricesInput | null {
  const [row] = db.select().from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!row) return null;
  const [trip] = db.select().from(schema.trips).where(eq(schema.trips.id, row.tripId)).all();
  const guests = db.select().from(schema.guests).where(eq(schema.guests.tripId, row.tripId)).all().map(toGuest);
  const destination = toDestination(row);
  const common = commonWindow(guests, destination);
  if (!common) return null;
  const window = tripWindow(common, trip.nights);

  const facts: LocalPricesFacts = {
    destination: { name: cityOf(destination.label), country: countryName(destination.countryCode), countryCode: destination.countryCode, lat: Math.round(destination.lat * 1000) / 1000, lon: Math.round(destination.lon * 1000) / 1000, outsideEurope: !destination.inScope },
    objective: destination.objective,
    budgetLevel: destination.budgetLevel,
    stay: { from: window.from, to: window.to, nights: nightsBetween(window) },
    activitiesWanted: extraPrices.activities[destination.objective],
  };
  return { destinationId, objective: destination.objective, countryCode: destination.countryCode, country: facts.destination.country, centre: { lat: destination.lat, lon: destination.lon }, airports: destination.airports, facts, hash: localPricesHashOf(facts) };
}

export type ActivityToStore = {
  name: string;
  kind: ActivityKind;
  priceEur: number;
  durationH: number | null;
  note: string | null;
  mapName: string;
  lat: number | null;
  lon: number | null;
};

/**
 * Keeps a destination's prices, replacing what was kept. `activities` null leaves the things to do as they were (the
 * rules have none to give, and those the AI gave for the same objective still hold).
 */
export function storeLocalPrices(
  db: Db,
  input: Pick<LocalPricesInput, "destinationId" | "objective" | "hash">,
  kept: { prices: LocalPrices; source: RatingSource; message: string | null; touristTax: TaxRule | null },
  activities: ActivityToStore[] | null,
): void {
  db.transaction((tx) => {
    tx.delete(schema.destinationPrices).where(eq(schema.destinationPrices.destinationId, input.destinationId)).run();
    tx.insert(schema.destinationPrices)
      .values({ destinationId: input.destinationId, pricesJson: JSON.stringify(kept.prices), source: kept.source, inputHash: input.hash, message: kept.message, touristTaxJson: kept.touristTax ? JSON.stringify(kept.touristTax) : null })
      .run();
    if (activities) {
      tx.delete(schema.extraActivities).where(eq(schema.extraActivities.destinationId, input.destinationId)).run();
      activities.forEach((activity, index) =>
        tx.insert(schema.extraActivities).values({ ...activity, destinationId: input.destinationId, rank: index + 1, objective: input.objective, source: kept.source }).run(),
      );
    }
  });
}

const PriceSchema = z.object({ eur: z.number(), source: z.enum(["ai", "rules", "open-data", "published"]), note: z.string().optional(), url: z.string().optional() });
const PricesSchema = z.object(Object.fromEntries(PRICE_KEYS.map((key) => [key, PriceSchema]))) as unknown as z.ZodType<LocalPrices>;

export type KeptLocalPrices = { prices: LocalPrices; source: RatingSource; inputHash: string; message: string | null; touristTax: TaxRule | null; createdAt: string };

const TaxRuleSchema: z.ZodType<TaxRule> = z.object({
  perPersonNightEur: z.number().nullable(),
  percentOfPrice: z.number().nullable(),
  capPerNightEur: z.number().nullable(),
  maxNights: z.number().nullable(),
  paidByHost: z.boolean(),
  source: z.enum(["open-data", "config", "ai"]),
  label: z.string(),
});

function taxRuleOf(json: string | null): TaxRule | null {
  try {
    const parsed = TaxRuleSchema.safeParse(json ? JSON.parse(json) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What is kept for a destination, or null; prices that do not read count as none. */
export function localPricesOf(db: Db, destinationId: string): KeptLocalPrices | null {
  const [row] = db.select().from(schema.destinationPrices).where(eq(schema.destinationPrices.destinationId, destinationId)).all();
  if (!row) return null;
  try {
    const prices = PricesSchema.safeParse(JSON.parse(row.pricesJson));
    return prices.success ? { prices: prices.data, source: row.source, inputHash: row.inputHash, message: row.message, touristTax: taxRuleOf(row.touristTaxJson), createdAt: row.createdAt } : null;
  } catch {
    return null;
  }
}

export type KeptActivity = ActivityToStore & { id: string; rank: number; objective: Objective; source: string; roadKmFromCentre: number | null; transitMinFromCentre: number | null };

/** The things to do kept for a destination, for its current objective, the most worthwhile first. */
export function extraActivitiesOf(db: Db, destinationId: string): KeptActivity[] {
  const [destination] = db.select({ objective: schema.destinations.objective }).from(schema.destinations).where(eq(schema.destinations.id, destinationId)).all();
  if (!destination) return [];
  return db
    .select()
    .from(schema.extraActivities)
    .where(eq(schema.extraActivities.destinationId, destinationId))
    .all()
    .filter((row) => row.objective === destination.objective && (ACTIVITY_KINDS as readonly string[]).includes(row.kind))
    .sort((a, b) => a.rank - b.rank)
    .map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as ActivityKind,
      priceEur: row.priceEur,
      durationH: row.durationH,
      note: row.note,
      mapName: row.mapName,
      lat: row.lat,
      lon: row.lon,
      rank: row.rank,
      objective: row.objective,
      source: row.source,
      roadKmFromCentre: row.roadKmFromCentre,
      transitMinFromCentre: row.transitMinFromCentre,
    }));
}

const PageTaxSchema = z.object({
  touristTax: z.object({ included: z.boolean().nullable(), amountEur: z.number().nullable(), perPersonNightEur: z.number().nullable(), maxNights: z.number().nullable(), basis: z.string().nullable() }),
});

/**
 * A stay's tourist tax (task.md T8.5, use-cases.md R10): what its page said (T8.2) and its destination's rule, for the
 * group and the stay's nights. null when there is none, or nothing is known.
 */
export function touristTaxOfStay(db: Db, stayId: string): ReturnType<typeof touristTaxOf> {
  const [stay] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.id, stayId)).all();
  if (!stay) return null;
  const [destination] = db.select({ tripId: schema.destinations.tripId }).from(schema.destinations).where(eq(schema.destinations.id, stay.destinationId)).all();
  const guests = db.select({ id: schema.guests.id }).from(schema.guests).where(eq(schema.guests.tripId, destination.tripId)).all().length;
  let page: PageTax | null = null;
  try {
    const parsed = PageTaxSchema.safeParse(stay.rawJson ? JSON.parse(stay.rawJson) : null);
    page = parsed.success ? parsed.data.touristTax : null;
  } catch {
    page = null;
  }
  const rule = localPricesOf(db, stay.destinationId)?.touristTax ?? null;
  return touristTaxOf({ page, provider: stay.provider, rule, stay: { totalPriceEur: stay.totalPriceEur, nights: nightsBetween({ from: stay.checkIn, to: stay.checkOut }), guests } });
}
