// The AI's synthesis of a trip's destinations: asking for it, finding out where it stands, and
// keeping it (use-cases.md UC-C, "what would the AI go for"). The model is only ever called by the
// worker; this file puts the question in the queue and reads the answer back.
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import { factsOf, inputHashOf, SynthesisSchema, type Synthesis } from "@/ai/destination-synthesis";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { enqueueJob } from "@/worker/queue";
import { ConflictError, NotFoundError } from "../errors";
import { getDeliberationView, type ReadyDeliberation } from "./deliberation";

/** A synthesis, and whether it was written for what the trip looks like now. */
export type SynthesisResult = {
  synthesis: Synthesis;
  createdAt: string;
  /** False when a ★, a ❤ or a budget has changed since: it still reads, but may no longer hold */
  fresh: boolean;
};

export type SynthesisState =
  /** Nobody has asked yet */
  | { state: "none" }
  /** It is being written. `previous` is the one it will replace, if there is one */
  | { state: "pending"; previous: SynthesisResult | null }
  | { state: "ready"; current: SynthesisResult }
  /** It could not be had (the AI is not available): the rest of the page keeps working */
  | { state: "unavailable"; message: string; previous: SynthesisResult | null };

/** How long a failed attempt keeps the AI "unavailable" before a plain request tries again. */
const RETRY_AFTER_MS = 30 * 60 * 1000;
/** Syntheses kept per trip; older ones are dropped. */
const KEPT = 5;

function readyView(db: Db, tripId: string): ReadyDeliberation {
  const view = getDeliberationView(db, tripId);
  if (!view) throw new NotFoundError("Trip not found");
  if (view.kind === "not-ready") throw new ConflictError("not_ready", "The trip has not been worked out yet");
  return view;
}

/** Keeps a synthesis written for these facts, and forgets the oldest ones. Writing the same facts twice keeps the first. */
export function storeSynthesis(db: Db, tripId: string, inputHash: string, synthesis: Synthesis): void {
  db.insert(schema.destinationSyntheses)
    .values({ tripId, inputHash, payloadJson: JSON.stringify(synthesis) })
    .onConflictDoNothing()
    .run();

  const keep = db
    .select({ id: schema.destinationSyntheses.id })
    .from(schema.destinationSyntheses)
    .where(eq(schema.destinationSyntheses.tripId, tripId))
    .orderBy(desc(schema.destinationSyntheses.createdAt), desc(sql`rowid`))
    .limit(KEPT)
    .all()
    .map((row) => row.id);
  db.delete(schema.destinationSyntheses)
    .where(and(eq(schema.destinationSyntheses.tripId, tripId), notInArray(schema.destinationSyntheses.id, keep)))
    .run();
}

/** Whether a synthesis is already stored for exactly these facts. */
export function hasSynthesis(db: Db, tripId: string, inputHash: string): boolean {
  return (
    db
      .select({ id: schema.destinationSyntheses.id })
      .from(schema.destinationSyntheses)
      .where(and(eq(schema.destinationSyntheses.tripId, tripId), eq(schema.destinationSyntheses.inputHash, inputHash)))
      .all().length > 0
  );
}

/** Where the synthesis of a trip stands, without asking for anything. Throws when the trip does not exist or is not worked out. */
export function getSynthesisState(db: Db, tripId: string, now: Date = new Date()): SynthesisState {
  const hash = inputHashOf(factsOf(readyView(db, tripId)));

  // An answer that no longer has the shape we expect (the schema changed) is as good as none
  const stored = db
    .select()
    .from(schema.destinationSyntheses)
    .where(eq(schema.destinationSyntheses.tripId, tripId))
    .orderBy(desc(schema.destinationSyntheses.createdAt), desc(sql`rowid`))
    .all()
    .flatMap((row): SynthesisResult[] => {
      const parsed = SynthesisSchema.safeParse(JSON.parse(row.payloadJson));
      return parsed.success ? [{ synthesis: parsed.data, createdAt: row.createdAt, fresh: row.inputHash === hash }] : [];
    });
  const fresh = stored.find((result) => result.fresh) ?? null;
  const previous = fresh ?? stored[0] ?? null;

  const [latest] = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tripId, tripId), eq(schema.jobs.type, "synthesize_destinations")))
    .orderBy(desc(schema.jobs.createdAt), desc(sql`rowid`))
    .limit(1)
    .all();

  if (latest && (latest.status === "queued" || latest.status === "running")) return { state: "pending", previous };
  if (fresh) return { state: "ready", current: fresh };
  if (latest?.status === "failed" && now.getTime() - Date.parse(latest.updatedAt) < RETRY_AFTER_MS) {
    return { state: "unavailable", message: latest.error ?? "The AI could not be reached", previous };
  }
  return previous ? { state: "ready", current: previous } : { state: "none" };
}

/**
 * Asks the worker for a synthesis, unless it is already being written. A plain request only asks
 * when nobody ever has, so opening the page never spends the subscription on its own; `refresh`
 * asks again for what the trip looks like now, and also retries after a failure.
 */
export function requestSynthesis(db: Db, tripId: string, { refresh = false, now = new Date() }: { refresh?: boolean; now?: Date } = {}): SynthesisState {
  const state = getSynthesisState(db, tripId, now);
  if (state.state === "pending") return state;
  if (!refresh && state.state !== "none") return state;
  if (refresh && state.state === "ready" && state.current.fresh) return state;

  enqueueJob(db, { tripId, type: "synthesize_destinations" });
  return getSynthesisState(db, tripId, now);
}
