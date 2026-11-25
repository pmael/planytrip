import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobType } from "@/core/types";
import type { Db } from "@/db/types";
import { createTrip } from "@/server/services/trips";
import { processNextJob, runWorker } from "@/worker";
import { enqueueJob, getJob, PermanentJobError, type RetryPolicy } from "@/worker/queue";
import type { Handlers } from "@/worker/types";
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
const enqueue = (type: JobType = "search_stays", payload?: unknown) => enqueueJob(db, { tripId, type, payload });

describe("processNextJob", () => {
  it("is idle when there is nothing to do", async () => {
    expect(await processNextJob(db, {})).toEqual({ outcome: "idle" });
  });

  it("takes a manually inserted job from queued to running to done", async () => {
    const job = enqueue("search_stays", { destinationId: "d1" });
    const statusWhileRunning: string[] = [];
    const handlers: Handlers = {
      search_stays: async (running) => {
        statusWhileRunning.push(getJob(db, running.id)!.status);
        expect(running.payload).toEqual({ destinationId: "d1" });
      },
    };

    expect(getJob(db, job.id)?.status).toBe("queued");
    const result = await processNextJob(db, handlers, { now: () => t0, policy });
    expect(statusWhileRunning).toEqual(["running"]);
    expect(result).toMatchObject({ outcome: "done", job: { id: job.id } });
    expect(getJob(db, job.id)).toMatchObject({ status: "done", attempts: 1, error: null });
  });

  it("runs the handler of the job's own type", async () => {
    enqueue("search_transport");
    const stays = vi.fn(async () => {});
    const transport = vi.fn(async () => {});
    await processNextJob(db, { search_stays: stays, search_transport: transport });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(stays).not.toHaveBeenCalled();
  });

  it("lets a handler report its progress", async () => {
    const job = enqueue("compute_trip");
    await processNextJob(db, {
      compute_trip: async (_job, { reportProgress }) => {
        reportProgress("routes", 1, 3);
        reportProgress("routes", 3, 3);
      },
    });
    expect(getJob(db, job.id)?.progress).toEqual({ routes: { done: 3, total: 3 } });
  });

  it("gives the handler the database", async () => {
    enqueue();
    let received: Db | undefined;
    await processNextJob(db, { search_stays: async (_job, context) => void (received = context.db) });
    expect(received).toBe(db);
  });

  describe("a failing job is retried 2 times, with backoff", () => {
    it("goes back in the queue after a failure and runs again once its time comes", async () => {
      const job = enqueue();
      const handler = vi.fn(async () => {
        throw new Error("flaky");
      });

      const first = await processNextJob(db, { search_stays: handler }, { now: () => t0, policy });
      expect(first).toMatchObject({ outcome: "retry", error: "flaky" });
      expect(getJob(db, job.id)).toMatchObject({ status: "queued", runAfter: later(5_000).toISOString() });

      // Not due yet
      expect((await processNextJob(db, { search_stays: handler }, { now: () => later(4_000), policy })).outcome).toBe("idle");
      expect(handler).toHaveBeenCalledTimes(1);

      const second = await processNextJob(db, { search_stays: handler }, { now: () => later(5_000), policy });
      expect(second.outcome).toBe("retry");
      expect(getJob(db, job.id)?.runAfter).toBe(later(35_000).toISOString());
    });

    it("runs three times in all, then stays failed", async () => {
      const job = enqueue();
      const handler = vi.fn(async () => {
        throw new Error("always");
      });
      const outcomes: string[] = [];
      for (const at of [0, 5_000, 35_000, 100_000]) {
        outcomes.push((await processNextJob(db, { search_stays: handler }, { now: () => later(at), policy })).outcome);
      }
      expect(outcomes).toEqual(["retry", "retry", "failed", "idle"]);
      expect(handler).toHaveBeenCalledTimes(3);
      expect(getJob(db, job.id)).toMatchObject({ status: "failed", attempts: 3, error: "always" });
    });

    it("ends done when a retry works", async () => {
      const job = enqueue();
      const handler = vi
        .fn()
        .mockRejectedValueOnce(new Error("once"))
        .mockResolvedValueOnce(undefined);
      await processNextJob(db, { search_stays: handler }, { now: () => t0, policy });
      const second = await processNextJob(db, { search_stays: handler }, { now: () => later(5_000), policy });
      expect(second.outcome).toBe("done");
      expect(getJob(db, job.id)).toMatchObject({ status: "done", attempts: 2, error: null });
    });
  });

  describe("a job that is waiting for others", () => {
    it("is put back in the queue for later, without using up a retry", async () => {
      const job = enqueue();
      const handler = vi.fn(async () => ({ rescheduleInMs: 2_000 }));
      const result = await processNextJob(db, { search_stays: handler }, { now: () => t0, policy });
      expect(result).toMatchObject({ outcome: "later", job: { id: job.id } });
      expect(getJob(db, job.id)).toMatchObject({ status: "queued", attempts: 0, error: null, runAfter: later(2_000).toISOString() });
    });

    it("is run again once its time comes, and not before", async () => {
      enqueue();
      const handler = vi.fn().mockResolvedValueOnce({ rescheduleInMs: 2_000 }).mockResolvedValueOnce(undefined);
      await processNextJob(db, { search_stays: handler }, { now: () => t0, policy });
      expect((await processNextJob(db, { search_stays: handler }, { now: () => later(1_999), policy })).outcome).toBe("idle");
      expect((await processNextJob(db, { search_stays: handler }, { now: () => later(2_000), policy })).outcome).toBe("done");
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("can wait many times and still keeps all its retries for real failures", async () => {
      const job = enqueue();
      const handler = vi.fn(async () => ({ rescheduleInMs: 0 }));
      for (let i = 0; i < 10; i++) await processNextJob(db, { search_stays: handler }, { now: () => t0, policy });
      expect(getJob(db, job.id)?.attempts).toBe(0);

      const failing = vi.fn(async () => { throw new Error("boom"); });
      await processNextJob(db, { search_stays: failing }, { now: () => t0, policy });
      expect(getJob(db, job.id)).toMatchObject({ status: "queued", attempts: 1, error: "boom" });
    });
  });

  it("does not retry a job that fails for good", async () => {
    const job = enqueue();
    const result = await processNextJob(db, {
      search_stays: async () => {
        throw new PermanentJobError("The payload is wrong");
      },
    }, { now: () => t0, policy });
    expect(result).toMatchObject({ outcome: "failed", error: "The payload is wrong" });
    expect(getJob(db, job.id)).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("fails for good a job nobody knows how to run", async () => {
    const job = enqueue("analyze_stay");
    const result = await processNextJob(db, {}, { now: () => t0, policy });
    expect(result).toMatchObject({ outcome: "failed", error: 'No handler for the "analyze_stay" job' });
    expect(getJob(db, job.id)?.status).toBe("failed");
  });

  it("copes with a handler throwing something that is not an Error", async () => {
    enqueue();
    const result = await processNextJob(db, { search_stays: async () => Promise.reject("just a string") }, { now: () => t0, policy });
    expect(result).toMatchObject({ outcome: "retry", error: "just a string" });
  });
});

describe("runWorker", () => {
  const fast: RetryPolicy = { maxRetries: 2, backoffMs: [0, 0] };

  it("runs every queued job, then waits for more, and stops when told to", async () => {
    const ids = [enqueue().id, enqueue().id, enqueue().id];
    const ran: string[] = [];
    const controller = new AbortController();
    const done = runWorker(db, { search_stays: async (job) => void ran.push(job.id) }, { pollMs: 5, signal: controller.signal, policy: fast });

    await vi.waitFor(() => expect(ran).toHaveLength(3));
    // A job queued while the worker is waiting is picked up too
    const late = enqueue().id;
    await vi.waitFor(() => expect(ran).toHaveLength(4));
    controller.abort();
    await done;

    expect(ran).toEqual([...ids, late]);
    expect(ran.every((id) => getJob(db, id)?.status === "done")).toBe(true);
  });

  it("retries a failing job until it works or is given up on", async () => {
    const job = enqueue();
    let calls = 0;
    const controller = new AbortController();
    const done = runWorker(
      db,
      {
        search_stays: async () => {
          if (++calls < 3) throw new Error(`failure ${calls}`);
        },
      },
      { pollMs: 5, signal: controller.signal, policy: fast },
    );
    // First two runs throw, the third works
    await vi.waitFor(() => expect(getJob(db, job.id)?.status).toBe("done"));
    controller.abort();
    await done;
    expect(calls).toBe(3);
  });

  it("gives up on a job that never works, after 3 runs, and carries on with the next one", async () => {
    const bad = enqueue("search_transport");
    const good = enqueue("search_stays");
    let badRuns = 0;
    const controller = new AbortController();
    const done = runWorker(
      db,
      {
        search_transport: async () => {
          badRuns++;
          throw new Error("never");
        },
        search_stays: async () => {},
      },
      { pollMs: 5, signal: controller.signal, policy: fast },
    );
    await vi.waitFor(() => expect(getJob(db, bad.id)?.status).toBe("failed"));
    await vi.waitFor(() => expect(getJob(db, good.id)?.status).toBe("done"));
    controller.abort();
    await done;
    expect(badRuns).toBe(3);
  });

  it("puts back in the queue a job a crashed worker left running, and runs it", async () => {
    const job = enqueue();
    // A previous worker claimed it and died
    const { claimNextJob } = await import("@/worker/queue");
    claimNextJob(db);
    const logs: string[] = [];
    const controller = new AbortController();
    const done = runWorker(db, { search_stays: async () => {} }, { pollMs: 5, signal: controller.signal, log: (m) => logs.push(m) });
    await vi.waitFor(() => expect(getJob(db, job.id)?.status).toBe("done"));
    controller.abort();
    await done;
    expect(logs[0]).toMatch(/1 interrupted job/);
  });

  it("finishes the job it is running before stopping", async () => {
    const job = enqueue();
    const controller = new AbortController();
    let finished = false;
    const done = runWorker(
      db,
      {
        search_stays: async () => {
          controller.abort();
          await new Promise((resolve) => setTimeout(resolve, 20));
          finished = true;
        },
      },
      { pollMs: 5, signal: controller.signal },
    );
    await done;
    expect(finished).toBe(true);
    expect(getJob(db, job.id)?.status).toBe("done");
  });

  it("stops at once when it is already told to", async () => {
    enqueue();
    const controller = new AbortController();
    controller.abort();
    await runWorker(db, { search_stays: async () => {} }, { pollMs: 5, signal: controller.signal });
    expect(getJob(db, (await import("@/worker/queue")).claimNextJob(db)!.id)?.status).toBe("running");
  });

  it("logs what happens to each job", async () => {
    enqueue();
    enqueue("search_transport");
    const logs: string[] = [];
    const controller = new AbortController();
    const done = runWorker(
      db,
      { search_stays: async () => {}, search_transport: async () => Promise.reject(new PermanentJobError("nope")) },
      { pollMs: 5, signal: controller.signal, log: (m) => logs.push(m) },
    );
    await vi.waitFor(() => expect(logs).toHaveLength(2));
    controller.abort();
    await done;
    expect(logs[0]).toMatch(/^search_stays \w+ done$/);
    expect(logs[1]).toMatch(/^search_transport \w+ failed for good: nope$/);
  });

  it("does not die when the queue itself fails while it is running", async () => {
    const logs: string[] = [];
    const controller = new AbortController();
    const done = runWorker(db, {}, { pollMs: 5, signal: controller.signal, log: (m) => logs.push(m) });
    await new Promise((resolve) => setTimeout(resolve, 30)); // it is up and polling
    close(); // the database goes away under the worker
    await vi.waitFor(() => expect(logs.some((m) => m.startsWith("worker error"))).toBe(true));
    controller.abort();
    await expect(done).resolves.toBeUndefined();
    ({ db, close } = createTestDb()); // so afterEach has something to close
  });
});
