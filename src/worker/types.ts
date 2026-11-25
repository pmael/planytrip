import type { Job, JobType } from "@/core/types";
import type { Db } from "@/db/types";

export type JobContext = {
  db: Db;
  /** Says how far a named step of this job is, for the progress screen */
  reportProgress: (step: string, done: number, total: number) => void;
};

/** What a handler can answer besides finishing: "not done, ask me again later". */
export type JobResult = { rescheduleInMs: number };

/**
 * Does the work of one job. Throwing makes the job fail (and be retried, unless it is a
 * PermanentJobError). Returning `{ rescheduleInMs }` puts it back in the queue to run again after
 * that delay, without using up a retry: how a job waits for others without holding up the worker.
 */
export type JobHandler = (job: Job, context: JobContext) => Promise<void | JobResult>;

export type Handlers = Partial<Record<JobType, JobHandler>>;
