import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeAccuracy, estimatesFor, metricsOf, type ObservedTrain } from "@/core/priceAccuracy";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { getPriceAccuracy } from "@/server/services/priceAccuracy";
import { createTestDb } from "./helpers/db";

const rule = { perKm: { eurPerKm: 0.15, minEur: 9 }, rangePosition: 0.5 };
const train = (over: Partial<ObservedTrain>): ObservedTrain => ({
  id: "x", originLabel: "Toulouse", destinationLabel: "Lyon", travelDate: "2026-12-04", departTime: "07:37", trainType: "TGV INOUI", daysBefore: 41, real: 66,
  distanceKm: 360, rangeMinEur: 25.5, rangeMaxEur: 101, modelEur: null, ...over,
});

describe("metricsOf (T7.9 P2: how wrong an estimate is)", () => {
  it("is nothing for no trains", () => {
    expect(metricsOf([])).toBeNull();
  });

  it("gives the mean and the median of the errors without their sign, the share within 10 €, and the bias with its sign", () => {
    // Estimates too low by 12 and 2, too high by 7 and 35 (estimate - real)
    expect(metricsOf([-12, -2, 7, 35])).toEqual({ n: 4, mae: 14, median: 9.5, within10: 0.5, bias: 7 });
  });

  it("takes the middle one for an odd count, and counts 10 € exactly as within", () => {
    expect(metricsOf([-10, 3, 40])).toMatchObject({ median: 10, within10: 2 / 3 });
  });

  it("says an estimate that is always too low has a negative bias", () => {
    expect(metricsOf([-5, -15])!.bias).toBe(-10);
  });
});

describe("estimatesFor", () => {
  it("gives each method's estimate for a direct train with a range", () => {
    const estimates = estimatesFor(train({}), rule);
    expect(estimates.per_km).toBeCloseTo(54);
    expect(estimates.range_mid).toBe(63.25);
    expect(estimates.range_max).toBe(101);
    // What the app does: a point of the range for such a train
    expect(estimates.current).toBe(63.25);
    expect(estimates.model).toBeNull();
  });

  it("counts the point of the range the app counts, as config says", () => {
    expect(estimatesFor(train({}), { ...rule, rangePosition: 1 }).current).toBe(101);
    expect(estimatesFor(train({}), { ...rule, rangePosition: 0 }).current).toBe(25.5);
  });

  it("uses the rate per kilometre for the app's estimate of a train with no range, and has no range estimates", () => {
    const estimates = estimatesFor(train({ rangeMinEur: null, rangeMaxEur: null, distanceKm: 380 }), rule);
    expect(estimates).toMatchObject({ current: 57, per_km: 57, range_mid: null, range_max: null });
  });

  it("has no per-kilometre estimate without a distance, and falls back on the range", () => {
    expect(estimatesFor(train({ distanceKm: null }), rule)).toMatchObject({ per_km: null, current: 63.25 });
    expect(estimatesFor(train({ distanceKm: null, rangeMinEur: null, rangeMaxEur: null }), rule).current).toBeNull();
  });

  it("gives the model's held-out price as it is", () => {
    expect(estimatesFor(train({ modelEur: 65.2 }), rule).model).toBe(65.2);
  });
});

describe("computeAccuracy", () => {
  // A, B and C are direct TGVs of Toulouse - Lyon seen at 66, 101 and 71 €; D is a journey with two changes, seen at 49.50 €
  const A = train({ id: "A", real: 66, daysBefore: 41 });
  const B = train({ id: "B", real: 101, daysBefore: 3, departTime: "15:42" });
  const C = train({ id: "C", real: 71, daysBefore: 12, departTime: "17:43" });
  const D = train({ id: "D", real: 49.5, daysBefore: 120, trainType: "MIXED", rangeMinEur: null, rangeMaxEur: null, distanceKm: 380, originLabel: "Toulouse", destinationLabel: "Lyon Saint-Exupéry" });
  const trains = [A, B, C, D];

  it("measures each method on the trains it can estimate", () => {
    const { all } = computeAccuracy(trains, rule);
    // per km: 54 - 66, 54 - 101, 54 - 71, 57 - 49.5
    expect(all.per_km).toMatchObject({ n: 4, bias: (-12 - 47 - 17 + 7.5) / 4 });
    expect(all.per_km!.mae).toBeCloseTo((12 + 47 + 17 + 7.5) / 4);
    // the middle of the range: only the three that have one
    expect(all.range_mid!.n).toBe(3);
    expect(all.range_mid!.mae).toBeCloseTo((2.75 + 37.75 + 7.75) / 3);
    expect(all.range_max).toMatchObject({ n: 3 });
    expect(all.range_max!.mae).toBeCloseTo((35 + 0 + 30) / 3);
    // the current estimate is the middle of the range where there is one, the rate where there is none
    expect(all.current!.n).toBe(4);
    expect(all.current!.mae).toBeCloseTo((2.75 + 37.75 + 7.75 + 7.5) / 4);
    expect(all.model).toBeNull();
  });

  it("compares the methods on the same trains: those every method can estimate", () => {
    const { common, commonRows } = computeAccuracy(trains, rule);
    expect(commonRows).toBe(3);
    expect(common.per_km!.n).toBe(3);
    expect(common.per_km!.mae).toBeCloseTo((12 + 47 + 17) / 3);
    expect(common.range_mid!.mae).toBeCloseTo((2.75 + 37.75 + 7.75) / 3);
  });

  it("brings the model in, on the trains it was held out for, and compares everything on those", () => {
    const withModel = [{ ...A, modelEur: 65 }, { ...B, modelEur: 90 }, { ...C, modelEur: 72 }, D];
    const { all, common, commonRows } = computeAccuracy(withModel, rule);
    expect(all.model).toMatchObject({ n: 3 });
    expect(all.model!.mae).toBeCloseTo((1 + 11 + 1) / 3);
    // D has no held-out price: the fair comparison leaves it out
    expect(commonRows).toBe(3);
    expect(common.model!.mae).toBeCloseTo(13 / 3);
    // The model is far closer than the middle of the range, on the same trains
    expect(common.model!.mae).toBeLessThan(common.range_mid!.mae);
  });

  it("has no common comparison when no train can be estimated by every method", () => {
    const { common, commonRows } = computeAccuracy([D], rule);
    expect(commonRows).toBe(0);
    expect(common.per_km).toBeNull();
  });

  it("splits by the type of train, the most seen first", () => {
    const { byTrainType } = computeAccuracy(trains, rule);
    expect(byTrainType.map((g) => [g.label, g.n])).toEqual([["TGV INOUI", 3], ["MIXED", 1]]);
    expect(byTrainType[1].mae.per_km).toBeCloseTo(7.5);
    expect(byTrainType[1].mae.range_mid).toBeNull();
  });

  it("splits by days ahead: 0 to 7, 8 to 30, 31 to 90, over 90, leaving out the buckets with nothing in them", () => {
    const { byDaysBefore } = computeAccuracy(trains, rule);
    expect(byDaysBefore.map((g) => [g.label, g.n])).toEqual([["0 à 7 jours", 1], ["8 à 30 jours", 1], ["31 à 90 jours", 1], ["plus de 90 jours", 1]]);
    expect(computeAccuracy([A], rule).byDaysBefore.map((g) => g.key)).toEqual(["31-90"]);
    const edges = computeAccuracy([train({ id: "7", daysBefore: 7 }), train({ id: "8", daysBefore: 8 }), train({ id: "30", daysBefore: 30 }), train({ id: "31", daysBefore: 31 }), train({ id: "90", daysBefore: 90 }), train({ id: "91", daysBefore: 91 })], rule).byDaysBefore;
    expect(edges.map((g) => [g.key, g.n])).toEqual([["0-7", 1], ["8-30", 2], ["31-90", 2], ["90+", 1]]);
  });

  it("lists the trains the current estimate missed by most, the worst first", () => {
    const { worst } = computeAccuracy(trains, rule);
    expect(worst.map((m) => m.id)).toEqual(["B", "C", "D", "A"]);
    expect(worst[0]).toEqual({ id: "B", route: "Toulouse → Lyon", travelDate: "2026-12-04", departTime: "15:42", trainType: "TGV INOUI", daysBefore: 3, real: 101, estimate: 63.25, error: -37.75 });
    expect(computeAccuracy(trains, rule, { worstCount: 2 }).worst).toHaveLength(2);
  });

  it("gives the points of the scatter plot for each method: its estimate against the real price", () => {
    const { scatter } = computeAccuracy(trains, rule);
    expect(scatter.range_mid).toEqual([{ estimate: 63.25, real: 66 }, { estimate: 63.25, real: 101 }, { estimate: 63.25, real: 71 }]);
    expect(scatter.per_km).toHaveLength(4);
    expect(scatter.model).toEqual([]);
    expect(computeAccuracy(trains, rule, { maxPoints: 2 }).scatter.per_km).toHaveLength(2);
  });

  it("is empty with nothing seen", () => {
    const empty = computeAccuracy([], rule);
    expect(empty.all.current).toBeNull();
    expect(empty).toMatchObject({ commonRows: 0, byTrainType: [], byDaysBefore: [], worst: [] });
  });
});

describe("getPriceAccuracy", () => {
  let db: Db;
  let close: () => void;
  let folder: string;
  beforeEach(() => {
    ({ db, close } = createTestDb());
    folder = mkdtempSync(path.join(tmpdir(), "accuracy-"));
  });
  afterEach(() => {
    close();
    rmSync(folder, { recursive: true, force: true });
  });
  const files = () => ({ file: path.join(folder, "m.json"), reportFile: path.join(folder, "r.json") });
  const insert = (over: Partial<typeof schema.priceObservations.$inferInsert> = {}) =>
    db.insert(schema.priceObservations).values({
      source: "sncf-connect", capturedAt: "2026-10-24T17:40:00.000Z", travelDate: "2026-12-04", daysBefore: 41, originLabel: "Toulouse", destinationLabel: "Lyon",
      departStation: "Toulouse Matabiau", arriveStation: "Lyon Part Dieu", departTime: "07:37", arriveTime: "11:48", changes: 0, trainType: "TGV INOUI", price2ndEur: 66,
      distanceKm: 360, rangeMinEur: 25.5, rangeMaxEur: 101, rawJson: "{}", ...over,
    }).returning().get();

  it("is empty, and says the model is missing, before anything was imported", () => {
    const view = getPriceAccuracy(db, { files: files() });
    expect(view).toMatchObject({ observations: 0, sessions: 0, matched: 0, firstCapturedAt: null, lastCapturedAt: null, commonRows: 0 });
    expect(view.model.state).toBe("missing");
  });

  it("counts the observations, the searches (a page read counts once, whatever its trains, and twice when read twice) and the trains matched with an option", () => {
    insert();
    insert({ departTime: "15:42", price2ndEur: 101 });
    insert({ capturedAt: "2026-10-24T17:55:00.000Z", departTime: "17:43", price2ndEur: 71 });
    insert({ capturedAt: "2026-10-25T09:00:00.000Z", departTime: "17:43", price2ndEur: 75 });
    const view = getPriceAccuracy(db, { files: files() });
    expect(view).toMatchObject({ observations: 4, sessions: 3, matched: 0, firstCapturedAt: "2026-10-24T17:40:00.000Z", lastCapturedAt: "2026-10-25T09:00:00.000Z" });
    expect(view.all.range_mid!.n).toBe(4);
    expect(view.perKm).toEqual({ eurPerKm: 0.15, minEur: 9 });
  });

  it("takes the model's price for a train from its held-out predictions, by observation id", () => {
    const a = insert();
    const b = insert({ departTime: "15:42", price2ndEur: 101 });
    const f = files();
    writeFileSync(f.reportFile, JSON.stringify({
      version: 1, trainedAt: "2026-10-30T12:00:00Z", observations: 120, sessions: 18, holidays: { periods: 3, status: "x" },
      models: { range: { rows: 2, sessions: 2, status: "trained" }, perKm: { rows: 0, sessions: 0, status: "not trained" } },
      oof: { [a.id]: 65, [b.id]: 90 },
    }));
    const view = getPriceAccuracy(db, { files: f, now: new Date("2026-11-01T00:00:00Z") });
    expect(view.all.model).toMatchObject({ n: 2 });
    expect(view.all.model!.mae).toBeCloseTo((1 + 11) / 2);
    // 120 observations from 18 searches is enough data; this report has no held-out numbers, so the model is not used
    expect(view.model).toMatchObject({ state: "inactive", observations: 120, sessions: 18 });
  });
});
