import { and, desc, eq, inArray } from "drizzle-orm";
import { commonWindow, noCommonDates } from "@/core/dates";
import { experienceOf, isSlow, remainingSeconds, usualSeconds, type Experience } from "@/core/estimates";
import type { ReachabilityMatrix } from "@/core/reachability";
import type { Job, RatingKind, TransportMode, TripDetails, TripStatus } from "@/core/types";
import { toJob } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { MODE_LABELS } from "@/lib/reachabilityText";
import type { AdapterSet } from "@/scrapers/registry";
import { enqueueJob } from "@/worker/queue";
import { ConflictError, NotFoundError } from "../errors";
import { getTrip, setTripStatus } from "./trips";

const ACTIVE = ["queued", "running"] as const;

function computeJobsOf(db: Db, tripId: string): Job[] {
  return db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tripId, tripId), eq(schema.jobs.type, "compute_trip")))
    .orderBy(desc(schema.jobs.createdAt), desc(schema.jobs.id))
    .all()
    .map(toJob);
}

/**
 * Starts working out the options of a trip: asks the worker to run a `compute_trip` job and says
 * which one. Nothing happens until the worker picks it up. It does not start a second computation
 * while one is under way, and leaves a finished trip alone unless `force` asks to search again, or
 * `rerate` asks to rate again what is stored (the searches are not repeated, the ratings made for
 * facts that have not changed are kept: what a budget that changed makes out of date is redone), and
 * `retry` asks to search again what failed last time.
 * Throws a ConflictError when there is nothing to compute: no guests, no common dates, no destination.
 */
export function startCompute(
  db: Db,
  tripId: string,
  { force = false, rerate = false, retry = false }: { force?: boolean; rerate?: boolean; retry?: boolean } = {},
): { jobId: string } {
  const trip = getTrip(db, tripId);
  if (!trip) throw new NotFoundError("Trip not found");

  if (trip.guests.length === 0) throw new ConflictError("no_guests", "Add the people you're travelling with first");
  if (!commonWindow(trip.guests)) {
    const clash = noCommonDates(trip.guests);
    throw new ConflictError("no_common_dates", clash ? `No common dates between ${clash[0].name} and ${clash[1].name}` : "No common dates");
  }
  if (trip.destinations.length === 0) throw new ConflictError("no_destinations", "Add at least one destination first");

  const jobs = computeJobsOf(db, tripId);
  const running = jobs.find((job) => (ACTIVE as readonly string[]).includes(job.status));
  if (running) return { jobId: running.id };
  if (!force && !rerate && !retry && (trip.status === "ready" || trip.status === "validated") && jobs[0]) return { jobId: jobs[0].id };

  setTripStatus(db, tripId, "computing");
  return { jobId: enqueueJob(db, { tripId, type: "compute_trip", payload: { force, retryFailed: retry } }).id };
}

/** One search to run for a computation. */
export type SearchTask =
  | { type: "search_transport"; destinationId: string; originKey: string; mode: TransportMode }
  | { type: "search_stays"; destinationId: string };

/** What tells one search from another, to find again the ones that failed. */
export const searchKeyOf = (task: SearchTask) =>
  task.type === "search_stays" ? `stays|${task.destinationId}` : `transport|${task.destinationId}|${task.originKey}|${task.mode}`;

type SearchPayload = { parent?: string; destinationId: string; originKey?: string; mode?: TransportMode };

/** Every search job a computation started, whatever became of it. */
function searchJobsOf(db: Db, tripId: string, computeJobId: string): Job[] {
  return db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tripId, tripId), inArray(schema.jobs.type, ["search_transport", "search_stays"])))
    .all()
    .map(toJob)
    .filter((job) => (job.payload as SearchPayload).parent === computeJobId);
}

/** The searches of a computation that gave up, as the tasks that would run them again, with why. */
function failedSearchesOf(db: Db, tripId: string, computeJobId: string): { task: SearchTask; error: string | null }[] {
  return searchJobsOf(db, tripId, computeJobId)
    .filter((job) => job.status === "failed")
    .map((job) => {
      const { destinationId, originKey, mode } = job.payload as SearchPayload;
      const task: SearchTask = job.type === "search_stays" ? { type: "search_stays", destinationId } : { type: "search_transport", destinationId, originKey: originKey!, mode: mode! };
      return { task, error: job.error };
    });
}

/** The keys of what failed in the computation before `currentJobId`: what a "search again" has to search once more. */
export function failedSearchKeysBefore(db: Db, tripId: string, currentJobId: string): Set<string> {
  const previous = computeJobsOf(db, tripId).find((job) => job.id !== currentJobId);
  return new Set(previous ? failedSearchesOf(db, tripId, previous.id).map(({ task }) => searchKeyOf(task)) : []);
}

/** A search of the last computation that gave up: what it was for, and why. */
export type SearchProblem =
  | { kind: "transport"; mode: TransportMode; from: string; to: string; message: string | null }
  | { kind: "stays"; to: string; message: string | null }
  /** A destination that was added after the last computation: nothing has been looked up for it yet */
  | { kind: "not_searched"; to: string };

/**
 * The searches of the trip's latest computation that failed, and the destinations added since it ran, so
 * that the dashboard can say that what it shows as "nothing found" may only be a search that did not work
 * or was never made. Nothing while a computation is under way. A search that failed has not changed what
 * is stored: the earlier results, if any, are still shown.
 */
export function getSearchProblems(db: Db, tripId: string): SearchProblem[] {
  const trip = getTrip(db, tripId);
  const [latest] = computeJobsOf(db, tripId);
  if (!trip || !latest || (ACTIVE as readonly string[]).includes(latest.status) || trip.status === "computing") return [];

  const city = (label: string) => label.split(",")[0];
  const searched = new Set(searchJobsOf(db, tripId, latest.id).map((job) => (job.payload as SearchPayload).destinationId));
  const unsearched = trip.destinations
    .filter((destination) => !searched.has(destination.id) && commonWindow(trip.guests, destination) !== null)
    .map((destination): SearchProblem => ({ kind: "not_searched", to: city(destination.label) }));

  const failed = failedSearchesOf(db, tripId, latest.id).flatMap(({ task, error }): SearchProblem[] => {
    const destination = trip.destinations.find((d) => d.id === task.destinationId);
    if (!destination) return [];
    if (task.type === "search_stays") return [{ kind: "stays", to: city(destination.label), message: error }];
    const guest = trip.guests.find((g) => g.originKey === task.originKey);
    return guest ? [{ kind: "transport", mode: task.mode, from: city(guest.homeLabel), to: city(destination.label), message: error }] : [];
  });
  return [...failed, ...unsearched];
}

/**
 * What has to be searched for, given who can get where (use-cases.md A-S4): for each destination
 * the guests' days allow, the transport from each place guests leave from by each mode they accept
 * (and the mode offered to a guest who is blocked, so that its cost can be shown), and the stays.
 * Modes already known to be unreachable, and modes nobody can search, are left out. Without `force`,
 * what is already stored is not searched again, except the searches in `retry` (the ones that failed).
 */
export function planSearches(
  db: Db,
  trip: TripDetails,
  matrix: ReachabilityMatrix,
  adapters: AdapterSet,
  { force = false, retry = new Set<string>() }: { force?: boolean; retry?: Set<string> } = {},
): SearchTask[] {
  const tasks: SearchTask[] = [];
  const hasTransport = (destinationId: string, originKey: string, mode: TransportMode) =>
    db
      .select({ id: schema.transportOptions.id })
      .from(schema.transportOptions)
      .where(
        and(
          eq(schema.transportOptions.destinationId, destinationId),
          eq(schema.transportOptions.originKey, originKey),
          eq(schema.transportOptions.mode, mode),
        ),
      )
      .limit(1)
      .all().length > 0;
  const hasStays = (destinationId: string) =>
    db.select({ id: schema.stayOptions.id }).from(schema.stayOptions).where(eq(schema.stayOptions.destinationId, destinationId)).limit(1).all().length > 0;

  for (const destination of trip.destinations) {
    // Its dates may leave no day on which everyone is free: nothing to look for then
    if (!commonWindow(trip.guests, destination)) continue;

    const wanted = new Map<string, { originKey: string; mode: TransportMode }>();
    for (const cell of matrix.cells.filter((c) => c.destinationId === destination.id)) {
      const guest = trip.guests.find((g) => g.id === cell.guestId)!;
      const modes = cell.modes.filter((m) => m.state !== "unreachable").map((m) => m.mode);
      if (cell.fallback) modes.push(cell.fallback);
      for (const mode of modes) wanted.set(`${guest.originKey}|${mode}`, { originKey: guest.originKey, mode });
    }
    for (const { originKey, mode } of wanted.values()) {
      if (adapters.transportAdaptersFor(mode).length === 0) continue;
      const task: SearchTask = { type: "search_transport", destinationId: destination.id, originKey, mode };
      if (!force && !retry.has(searchKeyOf(task)) && hasTransport(destination.id, originKey, mode)) continue;
      tasks.push(task);
    }
    const staysTask: SearchTask = { type: "search_stays", destinationId: destination.id };
    if (adapters.stayAdapters().length > 0 && (force || retry.has(searchKeyOf(staysTask)) || !hasStays(destination.id))) {
      tasks.push(staysTask);
    }
  }
  return tasks;
}

export type ProgressStep = {
  id: string;
  label: string;
  done: number;
  total: number;
  state: "pending" | "running" | "done" | "failed";
  /** Why it failed, when it did and the reason is known */
  error?: string;
  /** About how long it still has to go, while the computation is under way; null when it is over */
  secondsLeft?: number | null;
  /** How long it took, once it is over, when it can be told */
  tookSeconds?: number | null;
  /** Taking much longer than it usually does */
  slow?: boolean;
};

export type ComputeProgress = {
  status: TripStatus;
  steps: ProgressStep[];
  /** Why the computation gave up, when it did */
  error: string | null;
  /** Things worth telling the person once it is done, such as "not rated by the AI" */
  notices: string[];
  /** About how long the whole computation still has to go, once it is known what there is to do; null otherwise */
  secondsLeft: number | null;
};

const STEP_LABELS: Record<string, string> = {
  routes: "Checking routes",
  stays: "Looking for places to stay",
  survey: "Looking around the places to stay",
  prices: "Finding local prices and things to do",
  "rate:stays": "Rating the places to stay",
  "rate:transport": "Rating the journeys",
  advice: "Writing the advice on the Extra",
};

/** What each kind of rating is about, in the notices. */
const RATED_THING: Record<RatingKind, string> = { stays: "places to stay", transport: "journeys" };
const transportLabel = (mode: TransportMode) => (mode === "plane" ? "Searching flights" : `Searching ${MODE_LABELS[mode].toLowerCase()} routes`);

/**
 * The state of a group of jobs. In progress as soon as any is being worked on, waiting to be tried
 * again, or finished while others are still to come; failed when some gave up and none is left to run.
 */
/** The reason the first job that gave up gave, for a failed step. */
const errorOf = (jobs: Job[]) => jobs.find((job) => job.status === "failed")?.error ?? undefined;

function stateOf(jobs: Job[]): ProgressStep["state"] {
  if (jobs.length > 0 && jobs.every((job) => job.status === "done")) return "done";
  if (jobs.some((job) => job.status === "running" || (job.status === "queued" && job.attempts > 0))) return "running";

  const stillToRun = jobs.some((job) => job.status === "queued");
  const started = jobs.some((job) => job.status === "done" || job.status === "failed");
  if (stillToRun) return started ? "running" : "pending";
  return jobs.some((job) => job.status === "failed") ? "failed" : "pending";
}

/**
 * What the person should be told about the ratings: that the AI could not rate something and the
 * rules did, with the reason, since the scores would otherwise look like the AI's.
 */
function ratingNotices(db: Db, tripId: string): string[] {
  const runs = db
    .select()
    .from(schema.ratingRuns)
    .where(and(eq(schema.ratingRuns.tripId, tripId), eq(schema.ratingRuns.source, "rules")))
    .all();
  return (["stays", "transport"] as const).flatMap((kind) => {
    const ofKind = runs.filter((run) => run.kind === kind);
    if (ofKind.length === 0) return [];
    const why = ofKind.find((run) => run.message)?.message;
    return [`Not rated by the AI: the ${RATED_THING[kind]} were scored with simple rules${why ? ` (${why.replace(/\.$/, "")})` : ""}.`];
  });
}

/** The destinations whose local prices are the rules' (T8.4): the person is told, as for the ratings */
function priceNotices(db: Db, tripId: string): string[] {
  const rows = db
    .select({ label: schema.destinations.label, message: schema.destinationPrices.message })
    .from(schema.destinationPrices)
    .innerJoin(schema.destinations, eq(schema.destinations.id, schema.destinationPrices.destinationId))
    .where(and(eq(schema.destinations.tripId, tripId), eq(schema.destinationPrices.source, "rules")))
    .all();
  if (rows.length === 0) return [];
  const places = rows
    .map((row) => row.label.split(",")[0])
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
  const why = /^Not given by the AI \((.*?)\):/.exec(rows[0].message ?? "")?.[1];
  return [`Local prices by the rules, not the AI, for ${places}: country averages${why ? ` (${why})` : ""}.`];
}

/** The destinations whose advice on the Extra is the rules', not the AI's (T8.8) */
function adviceNotices(db: Db, tripId: string): string[] {
  const rows = db
    .select({ label: schema.destinations.label, message: schema.extraAdvice.message })
    .from(schema.extraAdvice)
    .innerJoin(schema.destinations, eq(schema.destinations.id, schema.extraAdvice.destinationId))
    .where(and(eq(schema.destinations.tripId, tripId), eq(schema.extraAdvice.source, "rules")))
    .all();
  if (rows.length === 0) return [];
  const why = /^Not written by the AI \((.*)\)$/.exec(rows[0].message ?? "")?.[1];
  return [`Advice on the Extra by the rules, not the AI${why ? ` (${why})` : ""}.`];
}

/** The kind of work a job is, for how long it takes: a flight search is not a train search */
const kindOf = (job: Pick<Job, "type" | "payload">) => (job.type === "search_transport" ? `search_transport:${(job.payload as SearchPayload).mode}` : job.type);
/** What the job is about: doing it again for the same thing can be much quicker */
const subjectOf = (job: Pick<Job, "payload">) => {
  const { destinationId, originKey } = job.payload as SearchPayload;
  return [destinationId, originKey].filter(Boolean).join("|");
};

/** How long the work took on this computer so far: every job that is over, and the route checks of the computations */
function experienceOn(db: Db, exceptComputeId: string): Experience {
  const rows = db
    .select()
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, ["done", "failed"]))
    .orderBy(desc(schema.jobs.updatedAt))
    .limit(2000)
    .all()
    .map(toJob)
    .reverse();
  return experienceOf(
    rows
      // compute_trip only waits for the others; this computation's own jobs are counted apart
      .filter((job) => job.type !== "compute_trip" && (job.payload as SearchPayload).parent !== exceptComputeId)
      .map((job) => ({ kind: kindOf(job), subject: subjectOf(job), createdAt: job.createdAt, finishedAt: job.updatedAt, ok: job.status === "done", attempts: job.attempts })),
  );
}

/** The steps still to be planned, which come after the searches: one job per destination each, as compute_trip does */
const LATER_STEPS = [
  { id: "survey", type: "survey_places", mark: "survey" },
  { id: "prices", type: "price_destination", mark: "survey" },
  { id: "rate:stays", type: "rate_stays", mark: "rating" },
  { id: "rate:transport", type: "rate_transport", mark: "rating" },
  { id: "advice", type: "advise_extras", mark: "advice" },
] as const;

/**
 * How the latest computation of a trip is going, step by step: the routes, then the transport
 * searches (one step per mode), the stays, and what comes after. Worked out from the jobs, so it is always current.
 * While it is under way, the steps still to be planned are listed too (as waiting), and each says about how long it has
 * left, from how long the same work took before on this computer.
 */
export function getProgress(db: Db, tripId: string, now: Date = new Date()): ComputeProgress {
  const [trip] = db.select().from(schema.trips).where(eq(schema.trips.id, tripId)).all();
  if (!trip) throw new NotFoundError("Trip not found");

  const [compute] = computeJobsOf(db, tripId);
  if (!compute) return { status: trip.status, steps: [], error: null, notices: [], secondsLeft: null };

  const children = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.tripId, tripId), inArray(schema.jobs.type, ["search_transport", "search_stays", "survey_places", "price_destination", "rate_stays", "rate_transport", "advise_extras"])))
    .all()
    .map(toJob)
    .filter((job) => (job.payload as { parent?: string }).parent === compute.id);

  const routes = compute.progress?.routes;
  const planned = compute.progress?.plan?.done === 1;
  const steps: ProgressStep[] = [
    {
      id: "routes",
      label: STEP_LABELS.routes,
      done: routes?.done ?? 0,
      total: routes?.total ?? 0,
      state: planned ? "done" : compute.status === "failed" ? "failed" : compute.status === "running" || routes ? "running" : "pending",
    },
  ];

  const transport = children.filter((job) => job.type === "search_transport");
  const modes = [...new Set(transport.map((job) => (job.payload as { mode: TransportMode }).mode))];
  for (const mode of modes) {
    const group = transport.filter((job) => (job.payload as { mode: TransportMode }).mode === mode);
    steps.push({ id: `transport:${mode}`, label: transportLabel(mode), done: group.filter((j) => j.status === "done").length, total: group.length, state: stateOf(group), error: errorOf(group) });
  }
  const stays = children.filter((job) => job.type === "search_stays");
  if (stays.length > 0) {
    steps.push({ id: "stays", label: STEP_LABELS.stays, done: stays.filter((j) => j.status === "done").length, total: stays.length, state: stateOf(stays), error: errorOf(stays) });
  }
  // What is around the places to stay, from OpenStreetMap (T8.3)
  const surveys = children.filter((job) => job.type === "survey_places");
  if (surveys.length > 0) {
    steps.push({ id: "survey", label: STEP_LABELS.survey, done: surveys.filter((j) => j.status === "done").length, total: surveys.length, state: stateOf(surveys), error: errorOf(surveys) });
  }
  const priced = children.filter((job) => job.type === "price_destination");
  if (priced.length > 0) {
    steps.push({ id: "prices", label: STEP_LABELS.prices, done: priced.filter((j) => j.status === "done").length, total: priced.length, state: stateOf(priced), error: errorOf(priced) });
  }
  // The AI rates what was found: one step per kind of option, once the searches are done
  for (const kind of ["stays", "transport"] as const) {
    const group = children.filter((job) => job.type === `rate_${kind}`);
    if (group.length > 0) {
      steps.push({ id: `rate:${kind}`, label: STEP_LABELS[`rate:${kind}`], done: group.filter((j) => j.status === "done").length, total: group.length, state: stateOf(group), error: errorOf(group) });
    }
  }

  // The advice on the Extra (T8.8), once the ratings are done
  const advice = children.filter((job) => job.type === "advise_extras");
  if (advice.length > 0) {
    steps.push({ id: "advice", label: STEP_LABELS.advice, done: advice.filter((j) => j.status === "done").length, total: advice.length, state: stateOf(advice), error: errorOf(advice) });
  }

  const underWay = (ACTIVE as readonly string[]).includes(compute.status);
  const secondsLeft = withTimes(db, { compute, children, steps, planned, underWay, now });

  return { status: trip.status, steps, error: compute.status === "failed" ? compute.error : null, notices: [...ratingNotices(db, tripId), ...priceNotices(db, tripId), ...adviceNotices(db, tripId)], secondsLeft };
}

/** The jobs a step is made of */
function jobsOfStep(id: string, children: Job[]): Job[] {
  if (id.startsWith("transport:")) return children.filter((job) => kindOf(job) === `search_${id}`);
  if (id === "stays") return children.filter((job) => job.type === "search_stays");
  const later = LATER_STEPS.find((step) => step.id === id);
  return later ? children.filter((job) => job.type === later.type) : [];
}

/**
 * Puts the times on the steps (how long they took, or have left), adds the steps that are not planned yet while the
 * computation is under way, and gives what it has left in all: the worker runs one job at a time, so it is their sum.
 * Null before the searches are planned, when nobody knows what there is to do, and when it is over.
 */
function withTimes(
  db: Db,
  { compute, children, steps, planned, underWay, now }: { compute: Job; children: Job[]; steps: ProgressStep[]; planned: boolean; underWay: boolean; now: Date },
): number | null {
  // How long each of this computation's finished jobs took, one after the other
  const took = new Map<string, number>();
  let before = 0;
  for (const job of children.filter((child) => child.status === "done" || child.status === "failed").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    const end = Date.parse(job.updatedAt);
    took.set(job.id, Math.max(0, (end - Math.max(Date.parse(job.createdAt), before)) / 1000));
    before = end;
  }
  const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0);

  const routes = steps.find((step) => step.id === "routes")!;
  if (routes.state === "done" && children.length > 0) {
    // Checked between the computation being asked for and its searches being queued
    const first = Math.min(...children.map((job) => Date.parse(job.createdAt)));
    routes.tookSeconds = Math.max(0, (first - Date.parse(compute.createdAt)) / 1000);
  }
  for (const step of steps) {
    const jobs = jobsOfStep(step.id, children);
    if ((step.state === "done" || step.state === "failed") && jobs.length > 0) step.tookSeconds = sum(jobs.map((job) => took.get(job.id) ?? 0));
  }
  if (!underWay) return null;

  const experience = experienceOn(db, compute.id);
  const usually = (kind: string, subject: string) => usualSeconds(experience, kind, subject, children.filter((job) => job.status === "done" && kindOf(job) === kind).map((job) => took.get(job.id)!));
  const leftOf = (job: Job) => {
    const time = usually(kindOf(job), subjectOf(job));
    // A running job was last written when the worker took it
    return job.status === "running" ? remainingSeconds(time, (now.getTime() - Date.parse(job.updatedAt)) / 1000) : time;
  };

  for (const step of steps) {
    if (step.state === "done" || step.state === "failed") continue;
    const jobs = jobsOfStep(step.id, children).filter((job) => job.status === "queued" || job.status === "running");
    if (step.id === "routes") step.secondsLeft = usually("routes", "");
    else step.secondsLeft = sum(jobs.map(leftOf));
    step.slow = jobs.some((job) => job.status === "running" && isSlow(usually(kindOf(job), subjectOf(job)), (now.getTime() - Date.parse(job.updatedAt)) / 1000));
  }
  if (!planned) return null;

  const destinations = db.select({ id: schema.destinations.id }).from(schema.destinations).where(eq(schema.destinations.tripId, compute.tripId)).all();
  for (const { id, type, mark } of LATER_STEPS) {
    if (compute.progress?.[mark]?.done === 1 || steps.some((step) => step.id === id)) continue;
    steps.push({ id, label: STEP_LABELS[id], done: 0, total: destinations.length, state: "pending", secondsLeft: sum(destinations.map((destination) => usually(type, destination.id))) });
  }
  return sum(steps.map((step) => step.secondsLeft ?? 0));
}
