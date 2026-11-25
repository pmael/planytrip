import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { priceModel } from "@/config";
import {
  featureVector,
  inHolidays,
  modelStatus,
  PriceModelFileSchema,
  priceByDistance,
  priceInRange,
  predictTarget,
  type FeatureInput,
  type PriceModelReport,
  type ReportEntry,
} from "@/core/price-model";

const fixture = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "tests/fixtures/price-model", name), "utf8"));

type Case = { days_before: number; travel_date: string; depart_time: string; train_type: string | null; changes: number | null; duration_min: number | null; distance_km: number | null };
const { cases, expected } = fixture("cases.json") as { cases: Case[]; expected: Record<"ridge" | "gbr", { range: number[]; perKm: number[] }> };
const inputOf = (c: Case): FeatureInput => ({ daysBefore: c.days_before, travelDate: c.travel_date, departTime: c.depart_time, trainType: c.train_type, changes: c.changes, durationMin: c.duration_min, distanceKm: c.distance_km });

describe("the model, evaluated in TypeScript as scikit-learn evaluated it (T7.9: tools/price-model/golden.py)", () => {
  describe.each(["ridge", "gbr"] as const)("a %s", (kind) => {
    const file = PriceModelFileSchema.parse(fixture(`${kind}.json`));

    it("is read from the file train.py wrote", () => {
      expect(file.models.range?.kind).toBe(kind);
      expect(file.models.perKm?.kind).toBe(kind);
      expect(file.holidays.length).toBeGreaterThan(0);
    });

    it("gives the place in the published range that scikit-learn gives, for every train", () => {
      cases.forEach((c, i) => {
        expect(predictTarget(file.models.range!, file.holidays, inputOf(c)), `case ${i}: ${JSON.stringify(c)}`).toBeCloseTo(expected[kind].range[i], 9);
      });
    });

    it("gives the price per kilometre that scikit-learn gives, for every train", () => {
      cases.forEach((c, i) => {
        expect(predictTarget(file.models.perKm!, file.holidays, inputOf(c)), `case ${i}: ${JSON.stringify(c)}`).toBeCloseTo(expected[kind].perKm[i], 9);
      });
    });

    it("turns them into euros: the range's low end plus the place in it, and the kilometres times the rate", () => {
      const input = inputOf(cases[0]);
      const t = predictTarget(file.models.range!, file.holidays, input);
      expect(priceInRange(file, input, { min: 25.5, max: 101 })).toBeCloseTo(Math.max(0, 25.5 + t * (101 - 25.5)), 9);
      const perKm = predictTarget(file.models.perKm!, file.holidays, input);
      expect(priceByDistance(file, input)).toBeCloseTo(Math.max(file.baseline.minEur, perKm * 360), 9);
    });
  });

  it("builds one number for each name train.py gives the features", () => {
    const file = fixture("ridge.json") as { featureNames: string[] };
    const vector = featureVector(inputOf(cases[0]), [], 0);
    expect(vector).toHaveLength(file.featureNames.length);
    const at = (name: string) => vector[file.featureNames.indexOf(name)];
    // Friday 4 December 2026, 07:37, a direct TGV INOUI, 41 days ahead, 251 minutes for 360 km
    expect(at("days_before")).toBe(41);
    expect(at("log1p_days_before")).toBeCloseTo(Math.log(42), 12);
    expect(at("duration_per_km")).toBeCloseTo(251 / 360, 12);
    expect(at("wd_4")).toBe(1);
    expect(at("wd_0")).toBe(0);
    expect(at("h_lt8")).toBe(1);
    expect(at("is_friday_or_sunday")).toBe(1);
    expect(at("tt_TGV INOUI")).toBe(1);
    expect(at("tt_OUIGO")).toBe(0);
  });

  describe("the edges", () => {
    const base = inputOf(cases[0]);
    const feature = (input: FeatureInput, name: string, holidays: [string, string][] = []) => featureVector(input, holidays, 0.7)[(fixture("ridge.json") as { featureNames: string[] }).featureNames.indexOf(name)];

    it("puts a departure in the bucket that starts at its hour (07:59 and 08:00, 19:59 and 20:00)", () => {
      expect(feature({ ...base, departTime: "07:59" }, "h_lt8")).toBe(1);
      expect(feature({ ...base, departTime: "08:00" }, "h_lt8")).toBe(0);
      expect(feature({ ...base, departTime: "08:00" }, "h_8_12")).toBe(1);
      expect(feature({ ...base, departTime: "19:59" }, "h_16_20")).toBe(1);
      expect(feature({ ...base, departTime: "20:00" }, "h_ge20")).toBe(1);
      expect(feature({ ...base, departTime: "00:15" }, "h_lt8")).toBe(1);
    });

    it("takes Friday and Sunday for the days people travel", () => {
      expect(feature({ ...base, travelDate: "2026-12-04" }, "is_friday_or_sunday")).toBe(1);
      expect(feature({ ...base, travelDate: "2026-12-05" }, "is_friday_or_sunday")).toBe(0);
      expect(feature({ ...base, travelDate: "2026-12-06" }, "is_friday_or_sunday")).toBe(1);
      expect(feature({ ...base, travelDate: "2026-12-06" }, "wd_6")).toBe(1);
    });

    it("counts the holidays from their first day up to the day classes resume", () => {
      const holidays: [string, string][] = [["2026-12-19", "2027-01-04"]];
      expect(inHolidays("2026-12-18", holidays)).toBe(false);
      expect(inHolidays("2026-12-19", holidays)).toBe(true);
      expect(inHolidays("2027-01-03", holidays)).toBe(true);
      expect(inHolidays("2027-01-04", holidays)).toBe(false);
      expect(feature({ ...base, travelDate: "2026-12-20" }, "school_holiday", holidays)).toBe(1);
    });

    it("uses the typical time per kilometre when the duration or the distance is not known, and a type it does not know is OTHER", () => {
      expect(feature({ ...base, durationMin: null }, "duration_per_km")).toBe(0.7);
      expect(feature({ ...base, distanceKm: null }, "duration_per_km")).toBe(0.7);
      expect(feature({ ...base, distanceKm: 0 }, "duration_per_km")).toBe(0.7);
      expect(feature({ ...base, trainType: "SOMETHING ELSE" }, "tt_OTHER")).toBe(1);
      expect(feature({ ...base, trainType: null }, "tt_OTHER")).toBe(1);
    });

    it("does not count a negative number of days ahead", () => {
      expect(feature({ ...base, daysBefore: -3 }, "days_before")).toBe(0);
    });

    it("has no price per kilometre without a distance, and no price from a model that was not trained", () => {
      const file = PriceModelFileSchema.parse(fixture("ridge.json"));
      expect(priceByDistance(file, { ...base, distanceKm: null })).toBeNull();
      expect(priceByDistance({ ...file, models: { ...file.models, perKm: null } }, base)).toBeNull();
      expect(priceInRange({ ...file, models: { ...file.models, range: null } }, base, { min: 10, max: 50 })).toBeNull();
    });

    it("never gives a price below the least price", () => {
      const file = PriceModelFileSchema.parse(fixture("ridge.json"));
      expect(priceByDistance(file, { ...base, distanceKm: 1 })).toBe(file.baseline.minEur);
    });
  });
});

describe("modelStatus: whether the app may use the model (price-model.md P3.3)", () => {
  const rule = priceModel.activation;
  const metrics = (mae: number) => ({ n: 100, mae, median: mae, within10: 0.8, bias: 0 });
  const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
    rows: 80, sessions: 18, groups: 14, routes: 5, status: "trained", selected: "ridge", against: "range_mid", improvement: 0.3, cv: "leave-one-group-out",
    heldOut: { model: metrics(7), range_mid: metrics(10) }, ...over,
  });
  const report = (over: Partial<PriceModelReport> = {}): PriceModelReport => ({
    version: 1, trainedAt: "2026-10-30T12:00:00Z", observations: 120, sessions: 18, holidays: { periods: 65, status: "downloaded" },
    models: { range: entry(), perKm: entry({ against: "per_km", improvement: 0.1, heldOut: { model: metrics(9), per_km: metrics(10) } }) }, oof: {}, ...over,
  });
  const now = new Date("2026-11-15T12:00:00Z");
  const status = (r: PriceModelReport | null) => modelStatus(r, rule, 60, now);

  it("says there is no model before the first training", () => {
    expect(status(null)).toMatchObject({ state: "missing", message: "pas encore de modèle (0/100 observations)", stale: false });
  });

  it("says how much data is missing: 100 observations", () => {
    expect(status(report({ observations: 62 }))).toMatchObject({ state: "not-enough-data", message: "pas encore assez de données (62/100)" });
    expect(status(report({ observations: 62 })).range.usable).toBe(false);
  });

  it("wants 15 different searches too: a hundred cards of the same few pages teach little", () => {
    expect(status(report({ sessions: 9 }))).toMatchObject({ state: "not-enough-data", message: "pas encore assez de recherches différentes (9/15 sessions de capture)" });
  });

  it("is active for the kind of train where it beats the simple method by 15 % or more, and only for that", () => {
    const s = status(report());
    expect(s.state).toBe("active");
    expect(s.range).toMatchObject({ usable: true, mae: 7, baselineMae: 10, baseline: "range_mid", reason: "bat range_mid de 30 %" });
    // 10 % is not enough
    expect(s.perKm.usable).toBe(false);
    expect(s.perKm.reason).toMatch(/ne bat pas assez per_km \(10 % d'erreur en moins, il en faut 15 %\)/);
    expect(s.message).toBe("modèle utilisé pour : fourchette SNCF");
  });

  it("is exactly at the limit: 15 % counts", () => {
    expect(status(report({ models: { ...report().models, range: entry({ improvement: 0.15 }) } })).range.usable).toBe(true);
    expect(status(report({ models: { ...report().models, range: entry({ improvement: 0.149 }) } })).range.usable).toBe(false);
  });

  it("is inactive, and says the current estimate stays, when it beats neither", () => {
    const s = status(report({ models: { range: entry({ improvement: 0.05 }), perKm: entry({ improvement: -0.2 }) } }));
    expect(s).toMatchObject({ state: "inactive", message: "le modèle ne bat pas assez l'estimation actuelle : elle reste en place" });
  });

  it("does not use a model that has seen too few different routes, or route-days: held out one at a time it would look fine and know nothing of the others", () => {
    expect(status(report({ models: { ...report().models, range: entry({ routes: 1, groups: 6 }) } })).range).toMatchObject({ usable: false, reason: "pas assez de trajets différents (1/3)" });
    expect(status(report({ models: { ...report().models, range: entry({ routes: 4, groups: 6 }) } })).range).toMatchObject({ usable: false, reason: "pas assez de trajets et de jours différents (6/10)" });
    expect(status(report({ models: { ...report().models, range: entry({ routes: 3, groups: 10 }) } })).range.usable).toBe(true);
    // An old report that does not say is not trusted
    expect(status(report({ models: { ...report().models, range: entry({ routes: undefined, groups: undefined }) } })).range.usable).toBe(false);
  });

  it("does not use a model with too few rows of its kind, or one that was not trained", () => {
    expect(status(report({ models: { ...report().models, range: entry({ rows: 20 }) } })).range).toMatchObject({ usable: false, reason: "pas assez de lignes (20/30)" });
    expect(status(report({ models: { ...report().models, range: entry({ status: "not trained: 12 rows", heldOut: undefined, improvement: undefined }) } })).range).toMatchObject({ usable: false, reason: "pas assez de lignes pour l'entraîner" });
  });

  it("flags a model trained more than 60 days ago as stale, and keeps using it: fares drift, but a model is not nothing", () => {
    expect(status(report()).stale).toBe(false);
    const old = modelStatus(report({ trainedAt: "2026-08-01T00:00:00Z" }), rule, 60, now);
    expect(old).toMatchObject({ stale: true, state: "active" });
  });
});
