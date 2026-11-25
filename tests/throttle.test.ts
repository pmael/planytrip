import { describe, expect, it } from "vitest";
import { createThrottle } from "@/geo/throttle";

describe("createThrottle", () => {
  it("never starts two tasks closer than the interval, even when asked at the same time", async () => {
    const run = createThrottle(60);
    const starts: number[] = [];
    await Promise.all([1, 2, 3].map(() => run(async () => void starts.push(Date.now()))));
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(55);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(55);
  });

  it("returns what the task returns", async () => {
    expect(await createThrottle(0)(async () => 42)).toBe(42);
  });

  it("runs tasks in the order they were asked", async () => {
    const run = createThrottle(0);
    const order: number[] = [];
    await Promise.all([run(async () => order.push(1)), run(async () => order.push(2)), run(async () => order.push(3))]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("lets the next task run after one fails, and passes the failure on", async () => {
    const run = createThrottle(0);
    await expect(run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(run(async () => "fine")).resolves.toBe("fine");
  });
});
