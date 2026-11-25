import { describe, expect, it } from "vitest";
import { computeFraction } from "@/lib/computeProgress";
import type { ComputeProgress, ProgressStep } from "@/server/services/compute";

const step = (id: string, done: number, total: number, state: ProgressStep["state"]): ProgressStep => ({
  id, label: id, done, total, state,
});
const progress = (steps: ProgressStep[], status: ComputeProgress["status"] = "computing"): ComputeProgress => ({
  status, steps, error: null, notices: [], secondsLeft: null,
});

describe("computeFraction", () => {
  it("is 0 before anything is known", () => {
    expect(computeFraction(null)).toBe(0);
    expect(computeFraction(progress([]))).toBe(0);
  });

  it("counts the route checks for a fifth", () => {
    expect(computeFraction(progress([step("routes", 3, 6, "running")]))).toBeCloseTo(0.1);
    expect(computeFraction(progress([step("routes", 6, 6, "done")]))).toBeCloseTo(0.2);
  });

  it("counts the searches for the rest, across all the sources", () => {
    const steps = [
      step("routes", 6, 6, "done"),
      step("transport:car", 1, 2, "running"),
      step("transport:plane", 3, 6, "running"),
      step("stays", 0, 3, "pending"),
    ];
    // 4 of 11 searches
    expect(computeFraction(progress(steps))).toBeCloseTo(0.2 + 0.8 * (4 / 11));
  });

  it("does not drop when the searches are planned and their number becomes known", () => {
    const beforePlan = computeFraction(progress([step("routes", 6, 6, "done")]));
    const afterPlan = computeFraction(progress([
      step("routes", 6, 6, "done"),
      step("transport:plane", 0, 6, "pending"),
      step("stays", 0, 3, "pending"),
    ]));
    expect(afterPlan).toBeGreaterThanOrEqual(beforePlan);
  });

  it("goes up at every step of a whole computation", () => {
    const stages = [
      progress([]),
      progress([step("routes", 0, 6, "running")]),
      progress([step("routes", 4, 6, "running")]),
      progress([step("routes", 6, 6, "done"), step("transport:plane", 0, 4, "pending"), step("stays", 0, 2, "pending")]),
      progress([step("routes", 6, 6, "done"), step("transport:plane", 2, 4, "running"), step("stays", 0, 2, "pending")]),
      progress([step("routes", 6, 6, "done"), step("transport:plane", 4, 4, "done"), step("stays", 1, 2, "running")]),
      progress([step("routes", 6, 6, "done"), step("transport:plane", 4, 4, "done"), step("stays", 2, 2, "done")]),
    ];
    const fractions = stages.map(computeFraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBeCloseTo(1);
  });

  it("is 1 for a trip that is ready, whatever the steps say", () => {
    expect(computeFraction(progress([step("routes", 0, 0, "pending")], "ready"))).toBe(1);
    expect(computeFraction(progress([], "ready"))).toBe(1);
  });

  it("counts a step as nothing when it has nothing to do", () => {
    expect(computeFraction(progress([step("routes", 6, 6, "done"), step("stays", 0, 0, "pending")]))).toBeCloseTo(0.2);
  });
});
