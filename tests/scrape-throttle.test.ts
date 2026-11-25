import { describe, expect, it } from "vitest";
import { createPoliteThrottle } from "@/scrapers/throttle";

/** A clock that only moves when the throttle sleeps or a task takes time. */
function fakeClock() {
  let time = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => time,
    advance: (ms: number) => void (time += ms),
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

describe("createPoliteThrottle", () => {
  it("starts the first task at once", async () => {
    const clock = fakeClock();
    const run = createPoliteThrottle({ minMs: 2000, maxMs: 4000, ...clock, random: () => 0.5 });
    await run(async () => "first");
    expect(clock.sleeps).toEqual([]);
  });

  it("waits a pause between the end of one task and the start of the next, picked between the two limits", async () => {
    const clock = fakeClock();
    const run = createPoliteThrottle({ minMs: 2000, maxMs: 4000, ...clock, random: () => 0.5 });
    await run(async () => clock.advance(100));
    await run(async () => undefined);
    expect(clock.sleeps).toEqual([3000]);
  });

  it("does not pause for what a slow task already took", async () => {
    const clock = fakeClock();
    const run = createPoliteThrottle({ minMs: 2000, maxMs: 2000, ...clock });
    await run(async () => undefined);
    clock.advance(5000);
    await run(async () => undefined);
    expect(clock.sleeps).toEqual([]);
  });

  it("varies the pause, so the rhythm is not that of a machine", async () => {
    const clock = fakeClock();
    const randoms = [0, 1];
    const run = createPoliteThrottle({ minMs: 1000, maxMs: 3000, ...clock, random: () => randoms.shift()! });
    await run(async () => undefined);
    await run(async () => undefined);
    await run(async () => undefined);
    expect(clock.sleeps).toEqual([1000, 3000]);
  });

  it("runs tasks one at a time, in the order they were asked for, whatever they take", async () => {
    const clock = fakeClock();
    const run = createPoliteThrottle({ minMs: 0, maxMs: 0, ...clock });
    const order: string[] = [];
    const slow = run(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("slow");
    });
    const quick = run(async () => void order.push("quick"));
    await Promise.all([slow, quick]);
    expect(order).toEqual(["slow", "quick"]);
  });

  it("gives back what a task returns, and does not hold up the next one when a task fails", async () => {
    const clock = fakeClock();
    const run = createPoliteThrottle({ minMs: 0, maxMs: 0, ...clock });
    await expect(run(async () => 42)).resolves.toBe(42);
    await expect(run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(run(async () => "after")).resolves.toBe("after");
  });
});
