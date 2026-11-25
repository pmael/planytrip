// The background worker: takes jobs from the queue one at a time and runs them, so that slow work
// (routes, flights, stays, the AI) never holds up a page. Start it with `npm run worker`, it also
// starts with `npm run dev`.
import { pathToFileURL } from "node:url";
import { jobs as jobConfig } from "@/config";
import type { Job } from "@/core/types";
import type { Db } from "@/db/types";
import {
  claimNextJob,
  completeJob,
  defaultRetryPolicy,
  failJob,
  PermanentJobError,
  reportProgress,
  requeueInterruptedJobs,
  rescheduleJob,
  type RetryPolicy,
} from "./queue";
import type { Handlers } from "./types";

export type ProcessResult =
  | { outcome: "idle" }
  | { outcome: "done" | "later" | "retry" | "failed"; job: Job; error?: string };

type Options = { now?: () => Date; policy?: RetryPolicy };

/**
 * Takes the next due job and runs it: idle when there is none, done when it worked, later when it
 * asked to be run again after a delay (it is waiting for something), retry when it failed and was
 * put back in the queue, failed when it was given up on.
 */
export async function processNextJob(db: Db, handlers: Handlers, { now = () => new Date(), policy = defaultRetryPolicy }: Options = {}): Promise<ProcessResult> {
  const job = claimNextJob(db, now());
  if (!job) return { outcome: "idle" };

  const handler = handlers[job.type];
  try {
    if (!handler) throw new PermanentJobError(`No handler for the "${job.type}" job`);
    const result = await handler(job, { db, reportProgress: (step, done, total) => reportProgress(db, job.id, step, done, total) });
    if (result) {
      rescheduleJob(db, job, result.rescheduleInMs, now());
      return { outcome: "later", job };
    }
    completeJob(db, job.id);
    return { outcome: "done", job };
  } catch (error) {
    const outcome = failJob(db, job, error, { permanent: error instanceof PermanentJobError, now: now(), policy });
    return { outcome, job, error: error instanceof Error ? error.message : String(error) };
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Runs jobs until `signal` is aborted: the job being run is finished first. Jobs a crashed worker
 * left running are put back in the queue as it starts.
 */
export async function runWorker(
  db: Db,
  handlers: Handlers,
  {
    pollMs = jobConfig.pollMs,
    signal,
    policy,
    log = () => {},
  }: { pollMs?: number; signal?: AbortSignal; policy?: RetryPolicy; log?: (message: string) => void } = {},
): Promise<void> {
  const interrupted = requeueInterruptedJobs(db);
  if (interrupted > 0) log(`${interrupted} interrupted job(s) put back in the queue`);

  while (!signal?.aborted) {
    try {
      const result = await processNextJob(db, handlers, { policy });
      if (result.outcome === "idle") {
        await sleep(pollMs, signal);
        continue;
      }
      const { job } = result;
      if (result.outcome === "later") continue; // waiting for others: not worth a line each time
      log(
        result.outcome === "done"
          ? `${job.type} ${job.id} done`
          : `${job.type} ${job.id} ${result.outcome === "retry" ? `failed (attempt ${job.attempts}), will retry` : "failed for good"}: ${result.error}`,
      );
    } catch (error) {
      // The queue itself failing (database locked...) must not kill the worker
      log(`worker error: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(pollMs, signal);
    }
  }
}

async function main() {
  // Loaded here so that importing this module (tests) never opens data/trip.db
  const { db } = await import("@/db/client");
  const { handlers } = await import("./handlers");
  const controller = new AbortController();
  for (const stop of ["SIGINT", "SIGTERM"] as const) {
    process.on(stop, () => {
      console.log(`[worker] ${stop}, finishing the current job…`);
      controller.abort();
    });
  }
  console.log("[worker] started");
  await runWorker(db, handlers, { signal: controller.signal, log: (message) => console.log(`[worker] ${message}`) });
  // The scrapers share one Chrome: it is closed with the worker, not left running
  const { closeBrowser } = await import("@/scrapers/browser");
  await closeBrowser();
  console.log("[worker] stopped");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
