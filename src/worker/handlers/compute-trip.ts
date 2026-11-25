import { and, eq, inArray, sql } from "drizzle-orm";
import { jobs as jobConfig } from "@/config";
import * as schema from "@/db/schema";
import type { JobType } from "@/core/types";
import type { Db } from "@/db/types";
import { osrmRoute, type RouteFn } from "@/geo/osrm";
import { adapterRegistry, type AdapterSet } from "@/scrapers/registry";
import { failedSearchKeysBefore, planSearches, searchKeyOf, type SearchTask } from "@/server/services/compute";
import { checkReachability } from "@/server/services/reachability";
import { getTrip, setTripStatus } from "@/server/services/trips";
import { ComputePayloadSchema, parsePayload } from "../payloads";
import { defaultRetryPolicy, enqueueJobs, PermanentJobError } from "../queue";
import type { JobHandler } from "../types";

const SEARCHES = ["search_transport", "search_stays"] as const;
/** What is around the stays, and the local prices: what the Extra and the ratings need, before the ratings */
const SURVEYS = ["survey_places", "price_destination"] as const;
const RATINGS = ["rate_stays", "rate_transport"] as const;
const ADVICE = ["advise_extras"] as const;

/** Whether any job of these types that this computation started is still to run or running. */
function pending(db: Db, computeJobId: string, tripId: string, types: readonly JobType[]): boolean {
  return db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.tripId, tripId),
        inArray(schema.jobs.type, [...types]),
        inArray(schema.jobs.status, ["queued", "running"]),
        sql`json_extract(${schema.jobs.payloadJson}, '$.parent') = ${computeJobId}`,
      ),
    )
    .limit(1)
    .all().length > 0;
}

/** One survey job per destination with places to stay whose position is known (T8.2): what is around them, from OpenStreetMap (T8.3). */
function planSurveys(db: Db, destinationIds: string[]) {
  return destinationIds.filter(
    (destinationId) =>
      db
        .select({ id: schema.stayOptions.id })
        .from(schema.stayOptions)
        .where(and(eq(schema.stayOptions.destinationId, destinationId), sql`json_extract(${schema.stayOptions.rawJson}, '$.lat') is not null`))
        .limit(1)
        .all().length > 0,
  );
}

/** One rating job per destination and kind of option, for what was found. */
function planRatings(db: Db, destinationIds: string[]) {
  return destinationIds.flatMap((destinationId) => {
    const has = (table: typeof schema.stayOptions | typeof schema.transportOptions) =>
      db.select({ id: table.id }).from(table).where(eq(table.destinationId, destinationId)).limit(1).all().length > 0;
    return [
      ...(has(schema.stayOptions) ? [{ type: "rate_stays" as const, destinationId }] : []),
      ...(has(schema.transportOptions) ? [{ type: "rate_transport" as const, destinationId }] : []),
    ];
  });
}

/**
 * compute_trip: works out everything the dashboard needs for a trip.
 * 1. Checks who can get where, and starts one search job per transport route and per destination's stays.
 * 2. Waits for them, without holding the worker: it asks to be run again in a moment, over and over,
 *    until none is left. (Waiting inside the handler would deadlock a worker that runs one job at a time.)
 * 3. Starts one survey job per destination with places to stay whose position is known: what is around them, from OpenStreetMap, for the
 *    Extra and the ratings (T8.3); and one job per destination for its local prices and things to do (T8.4). Waits
 *    for them; one that fails leaves its destination without and the trip goes on.
 * 4. Starts one rating job per destination and kind of option: the AI rates what was found, once, so
 *    that the dashboard never has to ask it (the rules rate instead when it is not there). Waits for them.
 * 5. Starts one advice job per destination: how to fit the Extra into the budgets (T8.8). Waits for them.
 * 6. Marks the trip ready, if at least one way of getting somewhere was found.
 * The stages are told apart by the "plan", "survey" and "rating" progress marks, so a run that starts over after a
 * crash or a retry picks up where it was.
 */
export function createComputeTripHandler({
  route = osrmRoute,
  adapters = adapterRegistry,
  waitMs = jobConfig.waitMs,
}: { route?: RouteFn; adapters?: AdapterSet; waitMs?: number } = {}): JobHandler {
  return async (job, { db, reportProgress }) => {
    const { force, retryFailed } = parsePayload(ComputePayloadSchema, job.payload);
    const trip = getTrip(db, job.tripId);
    if (!trip) throw new PermanentJobError("The trip no longer exists");

    try {
      if (job.progress?.plan?.done !== 1) {
        setTripStatus(db, trip.id, "computing");
        const matrix = await checkReachability(db, trip.id, route, (done, total) => reportProgress("routes", done, total));
        const retry = retryFailed ? failedSearchKeysBefore(db, trip.id, job.id) : undefined;
        const tasks = planSearches(db, trip, matrix, adapters, { force, retry });
        // All the searches are queued at once or none is: a run that starts over never finds half of them
        enqueueJobs(db, tasks.map(({ type, ...rest }) => ({ tripId: trip.id, type, payload: { parent: job.id, ...rest, force: force || retry?.has(searchKeyOf({ type, ...rest } as SearchTask)) === true } })));
        reportProgress("plan", 1, 1);
      }

      if (pending(db, job.id, trip.id, SEARCHES)) return { rescheduleInMs: waitMs };

      const found = db.select({ id: schema.transportOptions.id }).from(schema.transportOptions).where(
        inArray(schema.transportOptions.destinationId, trip.destinations.map((destination) => destination.id)),
      ).limit(1).all();
      if (found.length === 0) throw new PermanentJobError(
          "No way of getting to any destination was found: nothing was found for these days by the modes the guests accept. Flights and FlixBus buses are searched, trains only where FlixBus sells them; a guest who accepts the car can always get there by road.",
        );

      if (job.progress?.survey?.done !== 1) {
        const surveys = planSurveys(db, trip.destinations.map((destination) => destination.id));
        enqueueJobs(db, [
          ...surveys.map((destinationId) => ({ tripId: trip.id, type: "survey_places" as const, payload: { parent: job.id, destinationId, force } })),
          // The local prices and things to do: asked of the AI once per place, objective, budget level and dates (T8.4)
          ...trip.destinations.map((destination) => ({ tripId: trip.id, type: "price_destination" as const, payload: { parent: job.id, destinationId: destination.id } })),
        ]);
        reportProgress("survey", 1, 1);
      }
      if (pending(db, job.id, trip.id, SURVEYS)) return { rescheduleInMs: waitMs };

      if (job.progress?.rating?.done !== 1) {
        const rating = planRatings(db, trip.destinations.map((destination) => destination.id));
        enqueueJobs(db, rating.map(({ type, destinationId }) => ({ tripId: trip.id, type, payload: { parent: job.id, destinationId } })));
        reportProgress("rating", 1, 1);
      }
      if (pending(db, job.id, trip.id, RATINGS)) return { rescheduleInMs: waitMs };

      // The advice on the Extra (T8.8): after the ratings, which decide the default stay; one per destination
      if (job.progress?.advice?.done !== 1) {
        enqueueJobs(db, trip.destinations.map((destination) => ({ tripId: trip.id, type: "advise_extras" as const, payload: { parent: job.id, destinationId: destination.id } })));
        reportProgress("advice", 1, 1);
      }
      if (pending(db, job.id, trip.id, ADVICE)) return { rescheduleInMs: waitMs };

      // A decision that was taken stays taken: the summary is frozen, the trip only has fresher prices now
      setTripStatus(db, trip.id, db.select({ id: schema.summaries.id }).from(schema.summaries).where(eq(schema.summaries.tripId, trip.id)).limit(1).all().length > 0 ? "validated" : "ready");
    } catch (error) {
      // Out of retries: give the trip back, so that it can be computed again
      if (error instanceof PermanentJobError || job.attempts > defaultRetryPolicy.maxRetries) setTripStatus(db, trip.id, "draft");
      throw error;
    }
  };
}
