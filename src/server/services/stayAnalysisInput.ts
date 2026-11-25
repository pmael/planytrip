// What the AI is asked about one accommodation, and its fingerprint (use-cases.md B-S6). Shared by the
// request side, which tells whether an analysis may be out of date, and by the worker, which asks.
import { eq } from "drizzle-orm";
import { nightsBetween } from "@/core/dates";
import { stayFactsOf, stayInputHashOf, type StayFacts } from "@/ai/stay-analysis";
import { toStayOption } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import type { OptionRating } from "@/core/types";
import { ratingOfStay } from "./ratings";
import { getTrip } from "./trips";

export type StayAnalysisInput = { tripId: string; facts: StayFacts; inputHash: string; /** How the stay was rated while the trip was set up */ rating: OptionRating | null };

/** The facts about an accommodation, with their fingerprint. Null when it, or its trip, is gone. */
export function stayAnalysisInputOf(db: Db, stayId: string): StayAnalysisInput | null {
  const [row] = db.select().from(schema.stayOptions).where(eq(schema.stayOptions.id, stayId)).all();
  if (!row) return null;
  const stay = toStayOption(row);

  const [destinationRow] = db.select().from(schema.destinations).where(eq(schema.destinations.id, stay.destinationId)).all();
  const trip = destinationRow && getTrip(db, destinationRow.tripId);
  if (!destinationRow || !trip || trip.guests.length === 0) return null;

  const rating = ratingOfStay(db, stayId);
  const facts = stayFactsOf({
    stay: { ...stay, nights: Math.max(1, nightsBetween({ from: stay.checkIn, to: stay.checkOut })) },
    destination: destinationRow,
    guests: trip.guests,
    rating,
  });
  return { tripId: trip.id, facts, inputHash: stayInputHashOf(facts), rating };
}
