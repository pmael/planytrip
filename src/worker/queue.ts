// The job queue: a thin layer over the `jobs` table. Jobs go queued → running → done, or are put
// back in the queue with a delay when they fail, until they are given up on (failed).
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { jobs as jobConfig } from "@/config";
import type { Job, JobProgress, JobType } from "@/core/types";
import { toJob } from "@/db/mappers";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

/** Throw this from a handler when trying again cannot help (bad payload, unsupported job). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export type RetryPolicy = {
  /** How many times a failing job is tried again, after its first run */
  maxRetries: number;
  /** Wait before retry number 1, 2...; the last value repeats */
  backoffMs: readonly number[];
};

export const defaultRetryPolicy: RetryPolicy = { maxRetries: jobConfig.maxRetries, backoffMs: jobConfig.backoffMs };

const MAX_ERROR_LENGTH = 1000;

/** Puts a job in the queue. It runs as soon as the worker is free, or after `runAfter`. */
export function enqueueJob(
  db: Db,
  job: { tripId: string; type: JobType; payload?: unknown; runAfter?: Date },
): Job {
  const [row] = db
    .insert(schema.jobs)
    .values({
      tripId: job.tripId,
      type: job.type,
      payloadJson: JSON.stringify(job.payload ?? {}),
      ...(job.runAfter && { runAfter: job.runAfter.toISOString() }),
    })
    .returning()
    .all();
  return toJob(row);
}

/** Puts several jobs in the queue in one statement: either all of them are there, or none. */
export function enqueueJobs(db: Db, jobs: { tripId: string; type: JobType; payload?: unknown }[]): void {
  if (jobs.length === 0) return;
  db.insert(schema.jobs)
    .values(jobs.map((job) => ({ tripId: job.tripId, type: job.type, payloadJson: JSON.stringify(job.payload ?? {}) })))
    .run();
}

export function getJob(db: Db, jobId: string): Job | null {
  const [row] = db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).all();
  return row ? toJob(row) : null;
}

/**
 * Takes the oldest job that is due, marks it running and counts the attempt. The read and the
 * write happen in one immediate transaction, so two workers can never take the same job.
 */
export function claimNextJob(db: Db, now: Date = new Date()): Job | null {
  const claimed = db.transaction(
    (tx) => {
      const [next] = tx
        .select()
        .from(schema.jobs)
        .where(and(eq(schema.jobs.status, "queued"), lte(schema.jobs.runAfter, now.toISOString())))
        // Jobs made in the same millisecond keep the order they were inserted in (rowid)
        .orderBy(asc(schema.jobs.createdAt), asc(sql`rowid`))
        .limit(1)
        .all();
      if (!next) return null;
      return tx
        .update(schema.jobs)
        .set({ status: "running", attempts: next.attempts + 1 })
        .where(eq(schema.jobs.id, next.id))
        .returning()
        .all()[0];
    },
    { behavior: "immediate" },
  );
  return claimed ? toJob(claimed) : null;
}

export function completeJob(db: Db, jobId: string): void {
  db.update(schema.jobs).set({ status: "done", error: null }).where(eq(schema.jobs.id, jobId)).run();
}

export type FailOutcome = "retry" | "failed";

/**
 * Records that a job's run failed. It goes back in the queue, to run again after a delay, unless
 * it has used up its retries (or `permanent` says retrying is pointless): then it stays failed.
 */
export function failJob(
  db: Db,
  job: Pick<Job, "id" | "attempts">,
  error: unknown,
  { permanent = false, now = new Date(), policy = defaultRetryPolicy }: { permanent?: boolean; now?: Date; policy?: RetryPolicy } = {},
): FailOutcome {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
  // `attempts` already counts the run that just failed: after the 1st, retry number 1 is next
  const retryNumber = job.attempts;
  if (permanent || retryNumber > policy.maxRetries) {
    db.update(schema.jobs).set({ status: "failed", error: message }).where(eq(schema.jobs.id, job.id)).run();
    return "failed";
  }

  const delay = policy.backoffMs[Math.min(retryNumber, policy.backoffMs.length) - 1] ?? 0;
  db.update(schema.jobs)
    .set({ status: "queued", error: message, runAfter: new Date(now.getTime() + delay).toISOString() })
    .where(eq(schema.jobs.id, job.id))
    .run();
  return "retry";
}

/**
 * Puts a running job back in the queue to run again after `delayMs`. The run that was just counted
 * is given back, so waiting never uses up the job's retries.
 */
export function rescheduleJob(db: Db, job: Pick<Job, "id" | "attempts">, delayMs: number, now: Date = new Date()): void {
  db.update(schema.jobs)
    .set({ status: "queued", attempts: Math.max(0, job.attempts - 1), runAfter: new Date(now.getTime() + delayMs).toISOString() })
    .where(eq(schema.jobs.id, job.id))
    .run();
}

/** Notes how far a step of a job is, for the progress screen. Other steps are kept as they are. */
export function reportProgress(db: Db, jobId: string, step: string, done: number, total: number): void {
  const [row] = db.select({ progressJson: schema.jobs.progressJson }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).all();
  if (!row) return;
  const progress: JobProgress = row.progressJson ? JSON.parse(row.progressJson) : {};
  progress[step] = { done, total };
  db.update(schema.jobs).set({ progressJson: JSON.stringify(progress) }).where(eq(schema.jobs.id, jobId)).run();
}

/** Jobs a crashed worker left running go back in the queue. Meant to be called as the worker starts. */
export function requeueInterruptedJobs(db: Db): number {
  return db.update(schema.jobs).set({ status: "queued" }).where(eq(schema.jobs.status, "running")).returning().all().length;
}
