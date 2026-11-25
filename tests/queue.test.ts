import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { createTrip } from "@/server/services/trips";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  getJob,
  reportProgress,
  requeueInterruptedJobs,
  type RetryPolicy,
} from "@/worker/queue";
import { createTestDb } from "./helpers/db";

let db: Db;
let close: () => void;
let tripId: string;
beforeEach(() => {
  ({ db, close } = createTestDb());
  tripId = createTrip(db).id;
});
afterEach(() => close());

const t0 = new Date("2027-01-01T12:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const policy: RetryPolicy = { maxRetries: 2, backoffMs: [5_000, 30_000] };

const enqueue = (payload?: unknown) => enqueueJob(db, { tripId, type: "search_stays", payload });

describe("enqueueJob", () => {
  it("puts a job in the queue, with its payload", () => {
    const job = enqueue({ destinationId: "d1" });
    expect(job).toMatchObject({ tripId, type: "search_stays", status: "queued", attempts: 0, error: null, progress: null });
    expect(job.payload).toEqual({ destinationId: "d1" });
  });

  it("defaults the payload to an empty object", () => {
    expect(enqueue().payload).toEqual({});
  });

  it("can be told to wait", () => {
    const job = enqueueJob(db, { tripId, type: "compute_trip", runAfter: later(60_000) });
    expect(job.runAfter).toBe(later(60_000).toISOString());
  });
});

describe("claimNextJob", () => {
  it("takes the job, marks it running and counts the attempt", () => {
    const queued = enqueue();
    const claimed = claimNextJob(db);
    expect(claimed).toMatchObject({ id: queued.id, status: "running", attempts: 1 });
    expect(getJob(db, queued.id)?.status).toBe("running");
  });

  it("gives nothing when the queue is empty", () => {
    expect(claimNextJob(db)).toBeNull();
  });

  it("takes the oldest job first", () => {
    const first = enqueue();
    const second = enqueue();
    expect(claimNextJob(db)?.id).toBe(first.id);
    expect(claimNextJob(db)?.id).toBe(second.id);
  });

  it("keeps the order jobs were queued in, even when they are made in the same millisecond", () => {
    const ids = Array.from({ length: 25 }, () => enqueue().id);
    const claimed = Array.from({ length: 25 }, () => claimNextJob(db)!.id);
    expect(claimed).toEqual(ids);
  });

  it("never gives the same job twice", () => {
    enqueue();
    expect(claimNextJob(db)).not.toBeNull();
    expect(claimNextJob(db)).toBeNull();
  });

  it("leaves running, done and failed jobs alone", () => {
    const running = enqueue();
    const done = enqueue();
    const failed = enqueue();
    db.update(schema.jobs).set({ status: "running" }).where(eq(schema.jobs.id, running.id)).run();
    db.update(schema.jobs).set({ status: "done" }).where(eq(schema.jobs.id, done.id)).run();
    db.update(schema.jobs).set({ status: "failed" }).where(eq(schema.jobs.id, failed.id)).run();
    expect(claimNextJob(db)).toBeNull();
  });

  it("waits for a job's time to come", () => {
    const job = enqueueJob(db, { tripId, type: "search_stays", runAfter: later(10_000) });
    expect(claimNextJob(db, t0)).toBeNull();
    expect(claimNextJob(db, later(9_999))).toBeNull();
    expect(claimNextJob(db, later(10_000))?.id).toBe(job.id);
  });

  it("skips a job that is not due to take one that is", () => {
    enqueueJob(db, { tripId, type: "search_stays", runAfter: later(10_000) });
    const due = enqueue();
    expect(claimNextJob(db, t0)?.id).toBe(due.id);
  });
});

describe("completeJob", () => {
  it("marks the job done and clears an earlier error", () => {
    enqueue();
    const job = claimNextJob(db)!;
    failJob(db, job, new Error("boom"), { now: t0, policy });
    const again = claimNextJob(db, later(60_000))!;
    completeJob(db, again.id);
    expect(getJob(db, job.id)).toMatchObject({ status: "done", error: null });
  });
});

describe("failJob: retried 2 times with backoff", () => {
  const claimAt = (now: Date) => claimNextJob(db, now)!;

  it("puts the job back in the queue to run again after 5 s", () => {
    const job = (enqueue(), claimAt(t0));
    expect(failJob(db, job, new Error("flaky"), { now: t0, policy })).toBe("retry");
    expect(getJob(db, job.id)).toMatchObject({ status: "queued", attempts: 1, error: "flaky", runAfter: later(5_000).toISOString() });
    expect(claimNextJob(db, later(4_999))).toBeNull();
  });

  it("waits 30 s before the second retry", () => {
    enqueue();
    const first = claimAt(t0);
    failJob(db, first, new Error("1"), { now: t0, policy });
    const second = claimAt(later(5_000));
    expect(second.attempts).toBe(2);
    expect(failJob(db, second, new Error("2"), { now: later(5_000), policy })).toBe("retry");
    expect(getJob(db, first.id)?.runAfter).toBe(later(35_000).toISOString());
  });

  it("gives up after the second retry, so the job runs 3 times in all", () => {
    enqueue();
    let now = t0;
    const runs: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      const job = claimNextJob(db, now);
      if (!job) break;
      runs.push(job.attempts);
      const outcome = failJob(db, job, new Error(`failure ${attempt}`), { now, policy });
      if (outcome === "failed") break;
      now = later(now.getTime() - t0.getTime() + 60_000);
    }
    expect(runs).toEqual([1, 2, 3]);
    const [job] = db.select().from(schema.jobs).all();
    expect(job).toMatchObject({ status: "failed", attempts: 3, error: "failure 3" });
    expect(claimNextJob(db, later(10 * 60_000))).toBeNull();
  });

  it("fails at once when told retrying is pointless", () => {
    const job = (enqueue(), claimAt(t0));
    expect(failJob(db, job, new Error("bad payload"), { now: t0, policy, permanent: true })).toBe("failed");
    expect(getJob(db, job.id)).toMatchObject({ status: "failed", attempts: 1, error: "bad payload" });
  });

  it("keeps the last backoff value for further retries", () => {
    const long: RetryPolicy = { maxRetries: 4, backoffMs: [1_000, 2_000] };
    expect(failJob(db, (enqueue(), claimAt(t0)), "x", { now: t0, policy: long })).toBe("retry");
    const [job] = db.select().from(schema.jobs).all();
    failJob(db, { id: job.id, attempts: 3 }, "x", { now: t0, policy: long });
    expect(getJob(db, job.id)?.runAfter).toBe(later(2_000).toISOString());
  });

  it("works with a message that is not an Error, and cuts a very long one", () => {
    const job = (enqueue(), claimAt(t0));
    failJob(db, job, "x".repeat(5_000), { now: t0, policy });
    expect(getJob(db, job.id)?.error).toHaveLength(1_000);
  });
});

describe("reportProgress", () => {
  it("notes how far a step is", () => {
    const job = enqueue();
    reportProgress(db, job.id, "routes", 2, 6);
    expect(getJob(db, job.id)?.progress).toEqual({ routes: { done: 2, total: 6 } });
  });

  it("updates a step and keeps the others", () => {
    const job = enqueue();
    reportProgress(db, job.id, "routes", 2, 6);
    reportProgress(db, job.id, "flights", 0, 4);
    reportProgress(db, job.id, "routes", 6, 6);
    expect(getJob(db, job.id)?.progress).toEqual({ routes: { done: 6, total: 6 }, flights: { done: 0, total: 4 } });
  });

  it("ignores a job that does not exist", () => {
    expect(() => reportProgress(db, "doesnotexist", "routes", 1, 2)).not.toThrow();
  });
});

describe("requeueInterruptedJobs", () => {
  it("puts jobs a crashed worker left running back in the queue", () => {
    enqueue();
    const crashed = claimNextJob(db)!;
    enqueue();
    expect(requeueInterruptedJobs(db)).toBe(1);
    expect(getJob(db, crashed.id)?.status).toBe("queued");
    expect(claimNextJob(db)?.id).toBe(crashed.id);
  });

  it("does nothing when nothing was interrupted", () => {
    enqueue();
    expect(requeueInterruptedJobs(db)).toBe(0);
  });
});
