// The ratings kept for a trip's options (use-cases.md B-S1, R4): storing what the AI (or, when it was
// not available, the rules) said, reading it back for the dashboard, and telling whether it is still
// for what is stored now. The dashboard only ever reads: asking the AI is the worker's job, once,
// while the trip is set up.
import { and, eq, isNotNull } from "drizzle-orm";
import { RATING_KINDS, type OptionRating, type RatingKind, type RatingSource, type StayVerdict } from "@/core/types";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { ratingInputOf, type RatingInput } from "./ratingInputs";
import { getTrip } from "./trips";

/** What one option is rated, before it is stored: who rated it comes with it. */
export type RatingToStore = { verdict: StayVerdict; score: number; reason: string; source: RatingSource };

/**
 * Keeps the ratings of one kind of option at one destination, in place of the ones before, together
 * with the pass that made them: who did it, for what (`hash`), and why the rules did it when the AI
 * could not (`message`). Either every option is rated or the old ratings stay.
 */
export function storeRatings(
  db: Db,
  input: Pick<RatingInput<unknown>, "tripId" | "destinationId" | "kind" | "hash">,
  ratings: Map<string, RatingToStore>,
  run: { source: RatingSource; message: string | null },
): void {
  const { tripId, destinationId, kind } = input;
  db.transaction((tx) => {
    tx.delete(schema.optionRatings)
      .where(
        and(
          eq(schema.optionRatings.destinationId, destinationId),
          isNotNull(kind === "stays" ? schema.optionRatings.stayOptionId : schema.optionRatings.transportOptionId),
        ),
      )
      .run();
    for (const [optionId, rating] of ratings) {
      tx.insert(schema.optionRatings)
        .values({
          tripId,
          destinationId,
          stayOptionId: kind === "stays" ? optionId : null,
          transportOptionId: kind === "transport" ? optionId : null,
          ...rating,
        })
        .run();
    }
    const pass = { tripId, destinationId, kind, source: run.source, inputHash: input.hash, message: run.message, createdAt: new Date().toISOString() };
    tx.insert(schema.ratingRuns)
      .values(pass)
      .onConflictDoUpdate({ target: [schema.ratingRuns.destinationId, schema.ratingRuns.kind], set: pass })
      .run();
  });
}

/** The pass that last rated one kind of option at one destination, or null when none did. */
export function ratingRunOf(db: Db, destinationId: string, kind: RatingKind) {
  const [run] = db
    .select()
    .from(schema.ratingRuns)
    .where(and(eq(schema.ratingRuns.destinationId, destinationId), eq(schema.ratingRuns.kind, kind)))
    .all();
  return run ?? null;
}

const toRating = (row: typeof schema.optionRatings.$inferSelect): OptionRating => ({ verdict: row.verdict, score: row.score, reason: row.reason, source: row.source });

/** How one stay was rated while the trip was set up, or null when nothing rated it. */
export function ratingOfStay(db: Db, stayId: string): OptionRating | null {
  const [row] = db.select().from(schema.optionRatings).where(eq(schema.optionRatings.stayOptionId, stayId)).all();
  return row ? toRating(row) : null;
}

/** Every rating of a trip, by the id of the option it is for. */
export function ratingsOfTrip(db: Db, tripId: string): { stays: Map<string, OptionRating>; transport: Map<string, OptionRating> } {
  const stays = new Map<string, OptionRating>();
  const transport = new Map<string, OptionRating>();
  for (const row of db.select().from(schema.optionRatings).where(eq(schema.optionRatings.tripId, tripId)).all()) {
    if (row.stayOptionId) stays.set(row.stayOptionId, toRating(row));
    else if (row.transportOptionId) transport.set(row.transportOptionId, toRating(row));
  }
  return { stays, transport };
}

// ── Whether the ratings can be trusted ──────────────────────────────────────

export type RatingStatus = {
  /** What the rules rated because the AI was not available when the trip was set up, and why */
  byRules: { destination: string; kind: RatingKind; message: string | null }[];
  /** What the AI rated for facts that have changed since: a guest's budget, the dates, an offer */
  stale: { destination: string; kind: RatingKind }[];
};

/**
 * Whether a trip's ratings are "not rated by the AI" (the rules did it) or out of date (what they
 * were made from has changed). A trip that was never rated says nothing: there is nothing to doubt.
 * Computed from what is stored, so it never asks the AI anything.
 */
export function getRatingStatus(db: Db, tripId: string): RatingStatus {
  const status: RatingStatus = { byRules: [], stale: [] };
  const trip = getTrip(db, tripId);
  if (!trip) return status;

  for (const destination of trip.destinations) {
    const name = destination.label.split(",")[0];
    for (const kind of RATING_KINDS) {
      const run = ratingRunOf(db, destination.id, kind);
      const input = run && ratingInputOf(db, destination.id, kind);
      if (!run || !input) continue;
      if (run.source === "rules") status.byRules.push({ destination: name, kind, message: run.message });
      else if (run.inputHash !== input.hash) status.stale.push({ destination: name, kind });
    }
  }
  return status;
}
