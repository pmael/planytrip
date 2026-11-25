import { copyFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceByDistance, priceInRange, type FeatureInput, type PriceModelReport } from "@/core/price-model";
import { PriceModelFileSchema } from "@/core/price-model";
import { createSncfFares } from "@/scrapers/transport/sncf-fares";
import { createTrainsAdapter } from "@/scrapers/transport/trains";
import type { Timetable } from "@/scrapers/transport/transitous";
import type { TrainJourney } from "@/scrapers/transport/train-types";
import type { TransportQuery } from "@/scrapers/types";
import { createModelPredictor, featureInputOf, readModelStatus } from "@/server/priceModel";
import { readPriceModelFile } from "@/server/priceModelFiles";
import { journey, memoryCache, trainFixture, trainJson } from "./helpers/trains";

const now = new Date("2026-10-24T10:00:00Z");
let folder: string;
let files: { file: string; reportFile: string };
beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), "price-model-"));
  files = { file: path.join(folder, "price-model.json"), reportFile: path.join(folder, "price-model-report.json") };
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

const metrics = (mae: number) => ({ n: 100, mae, median: mae, within10: 0.8, bias: 0 });
const entry = (improvement: number, against: string) => ({ rows: 80, sessions: 18, groups: 14, routes: 5, status: "trained", selected: "ridge" as const, against, improvement, heldOut: { model: metrics(6.4), [against]: metrics(10) } });
const report = (improvement = 0.3, over: Partial<PriceModelReport> = {}): PriceModelReport => ({
  version: 1, trainedAt: "2026-10-20T12:00:00Z", observations: 120, sessions: 18, holidays: { periods: 3, status: "file given" },
  models: { range: entry(improvement, "range_mid"), perKm: entry(improvement, "per_km") }, oof: {}, ...over,
});
/** The model files as train.py would have written them (here, from synthetic prices) */
const install = (r: PriceModelReport | null = report()) => {
  copyFileSync(path.join(process.cwd(), "tests/fixtures/price-model/ridge.json"), files.file);
  if (r) writeFileSync(files.reportFile, JSON.stringify(r));
};
const model = () => PriceModelFileSchema.parse(trainJson("../price-model/ridge.json"));

describe("featureInputOf (T7.9: what the model looks at in a journey of the timetable)", () => {
  it("describes a direct SNCF train as the observations describe it", () => {
    expect(featureInputOf(journey(), now)).toEqual<FeatureInput>({
      daysBefore: 41,
      travelDate: "2026-12-04",
      departTime: "07:37",
      trainType: "TGV INOUI",
      changes: 0,
      durationMin: 251,
      // Toulouse Matabiau to Lyon Part Dieu, whole kilometres
      distanceKm: expect.any(Number),
    });
    const km = featureInputOf(journey(), now)!.distanceKm!;
    expect(km).toBeGreaterThan(355);
    expect(km).toBeLessThan(365);
    expect(Number.isInteger(km)).toBe(true);
  });

  it("calls a journey with changes MIXED, and counts the changes", () => {
    const two: TrainJourney = { ...journey(), legs: [journey().legs[0], { ...journey().legs[0], train: "TER 1", mode: "REGIONAL_RAIL" }] };
    expect(featureInputOf(two, now)).toMatchObject({ trainType: "MIXED", changes: 1 });
  });

  it("has nothing for a journey with a train that is not SNCF's: the model knows SNCF Connect's prices, not Renfe's", () => {
    expect(featureInputOf(journey({ operator: "RENFE OPERADORA" }), now)).toBeNull();
    const mixed: TrainJourney = { ...journey(), legs: [journey().legs[0], { ...journey().legs[0], operator: "SBB" }] };
    expect(featureInputOf(mixed, now)).toBeNull();
  });

  it("counts no negative days when the train leaves today", () => {
    expect(featureInputOf(journey({ departAt: "2026-10-24T18:00", arriveAt: "2026-10-24T22:00" }), now)!.daysBefore).toBe(0);
  });
});

describe("createModelPredictor (price-model.md P3.3: used only once it has proved itself)", () => {
  const predictor = () => createModelPredictor({ files, now: () => now });

  it("gives the price the model gives, with where it comes from, once it has the data and beats the simple method", () => {
    install();
    const direct = predictor().withinRange(journey(), { min: 25.5, max: 101 })!;
    expect(direct.priceEur).toBeCloseTo(priceInRange(model(), featureInputOf(journey(), now)!, { min: 25.5, max: 101 })!, 9);
    expect(direct.note).toBe("Estimated by the model trained on 120 prices seen on SNCF Connect (typical error 6 €)");

    const byDistance = predictor().byDistance(journey())!;
    expect(byDistance.priceEur).toBeCloseTo(priceByDistance(model(), featureInputOf(journey(), now)!)!, 9);
  });

  it("gives nothing before the first training: no report, no model", () => {
    expect(predictor().withinRange(journey(), { min: 25.5, max: 101 })).toBeNull();
    expect(predictor().byDistance(journey())).toBeNull();
    install(null);
    expect(predictor().byDistance(journey())).toBeNull();
  });

  it("gives nothing while the data is short, even with a model that looks good", () => {
    install(report(0.5, { observations: 60 }));
    expect(predictor().withinRange(journey(), { min: 25.5, max: 101 })).toBeNull();
    install(report(0.5, { sessions: 8 }));
    expect(predictor().byDistance(journey())).toBeNull();
  });

  it("gives nothing for the kind of train where the model does not beat the simple method by 15 %", () => {
    install(report(0.1));
    expect(predictor().withinRange(journey(), { min: 25.5, max: 101 })).toBeNull();
    install({ ...report(0.3), models: { range: entry(0.3, "range_mid"), perKm: entry(0.05, "per_km") } });
    expect(predictor().withinRange(journey(), { min: 25.5, max: 101 })).not.toBeNull();
    expect(predictor().byDistance(journey())).toBeNull();
  });

  it("gives nothing for a train that is not SNCF's", () => {
    install();
    expect(predictor().byDistance(journey({ operator: "RENFE OPERADORA" }))).toBeNull();
  });

  it("reads the files again when they change, without a restart", () => {
    install(report(0.1));
    expect(predictor().byDistance(journey())).toBeNull();
    // train.py writes a better report
    writeFileSync(files.reportFile, JSON.stringify(report(0.4)));
    const later = new Date(Date.now() + 5000);
    utimesSync(files.reportFile, later, later);
    expect(predictor().byDistance(journey())).not.toBeNull();
  });

  it("is as if there were no model when the file is not one", () => {
    writeFileSync(files.file, "{ not json");
    writeFileSync(files.reportFile, JSON.stringify(report()));
    expect(readPriceModelFile(files)).toBeNull();
    expect(predictor().byDistance(journey())).toBeNull();
  });
});

describe("readModelStatus", () => {
  it("is what the accuracy page says of the model", () => {
    expect(readModelStatus({ files, now })).toMatchObject({ state: "missing" });
    install(report(0.3));
    expect(readModelStatus({ files, now })).toMatchObject({ state: "active", observations: 120, sessions: 18, stale: false });
  });
});

describe("the model in the trains' prices", () => {
  const csv = () => trainFixture("sncf-fares.csv");

  it("replaces the middle of SNCF's range for a direct train, and says so: the source is the model", async () => {
    install();
    const source = createSncfFares({ load: async () => csv(), config: { positionInRange: 0.5 }, predictor: createModelPredictor({ files, now: () => now }) });
    const [quote] = await source.quote([journey()], { cache: memoryCache() });
    const wanted = priceInRange(model(), featureInputOf(journey(), now)!, { min: 25.5, max: 101 })!;
    expect(quote).toMatchObject({ kind: "estimated", source: "model", priceEur: Math.round(wanted) });
    expect(quote!.note).toMatch(/^Estimated by the model trained on 120 prices/);
  });

  it("leaves the middle of the range alone when the model is not in use", async () => {
    install(report(0.05));
    const source = createSncfFares({ load: async () => csv(), config: { positionInRange: 0.5 }, predictor: createModelPredictor({ files, now: () => now }) });
    expect((await source.quote([journey()], { cache: memoryCache() }))[0]).toMatchObject({ priceEur: 63, source: "sncf-fares" });
  });

  it("does not ask the model about a journey with changes: its prices are the sum of the ranges", async () => {
    install();
    const two = journey();
    two.legs.push({ ...two.legs[0], from: { name: "Lyon Part Dieu", lat: 45.76, lon: 4.86 }, to: { name: "Toulouse Matabiau", lat: 43.61, lon: 1.45 } });
    const source = createSncfFares({ load: async () => csv(), config: { positionInRange: 0.5 }, predictor: createModelPredictor({ files, now: () => now }) });
    expect((await source.quote([two], { cache: memoryCache() }))[0]).toMatchObject({ priceEur: 127, source: "sncf-fares" });
  });

  describe("and when the train has no range at all", () => {
    const query: TransportQuery = {
      mode: "train",
      origin: { key: "toulouse-france", label: "Toulouse, France", lat: 43.6047, lon: 1.4442, airports: [] },
      destination: { id: "d", label: "Lyon, France", lat: 45.764, lon: 4.8357, airports: [] },
      window: { from: "2026-12-04", to: "2026-12-06" },
    };
    const back = journey({ from: { name: "Lyon Part Dieu", lat: 45.7606, lon: 4.8594 }, to: { name: "Toulouse Matabiau", lat: 43.6112, lon: 1.4536 }, departAt: "2026-12-06T16:39", arriveAt: "2026-12-06T20:39" });
    const timetable: Timetable = { journeys: vi.fn(async (_f, _t, day) => (day === "2026-12-04" ? [journey({ train: "IC 4655", mode: "LONG_DISTANCE" })] : [{ ...back, legs: [{ ...back.legs[0], train: "IC 4656", mode: "LONG_DISTANCE" }] }])) };
    const adapter = (withModel: boolean) => createTrainsAdapter({ timetable, fares: [], now: () => now, predictor: withModel ? createModelPredictor({ files, now: () => now }) : undefined });

    it("works the price out from the distance as before while the model is not in use", async () => {
      install(report(0.05));
      const [option] = await adapter(true).search(query);
      expect(option.priceNote).toMatch(/^Estimated from the distance/);
    });

    it("takes the model's price per kilometre once it is in use, and names it", async () => {
      install();
      const [option] = await adapter(true).search(query);
      expect(option).toMatchObject({ priceKind: "estimated", priceNote: expect.stringMatching(/^Estimated by the model trained on 120 prices seen on SNCF Connect/) });
      const [plain] = await adapter(false).search(query);
      expect(option.priceEur).not.toBe(plain.priceEur);
      expect((option.raw as { out: { price: { source: string } } }).out.price.source).toBe("model");
    });
  });
});
