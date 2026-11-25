// What the accuracy page shows (task.md T7.9, price-model.md P2): the prices seen on SNCF Connect, Eurostar and Iryo, and how wrong each estimate was.
import { trains, priceModel as modelSettings } from "@/config";
import { computeAccuracy, type Accuracy, type ObservedTrain } from "@/core/priceAccuracy";
import type { ModelStatus } from "@/core/price-model";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { readPriceModelReport, type PriceModelFiles } from "../priceModelFiles";
import { readModelStatus } from "../priceModel";

export type AccuracyView = Accuracy & {
  observations: number;
  /** Different searches: all the cards of one page count once */
  sessions: number;
  matched: number;
  firstCapturedAt: string | null;
  lastCapturedAt: string | null;
  model: ModelStatus;
  /** The rate per kilometre the app estimates with */
  perKm: { eurPerKm: number; minEur: number };
  /** Where in SNCF's range the app counts a price (0.5: the middle) */
  rangePosition: number;
};

export function getPriceAccuracy(db: Db, { files = modelSettings, now = new Date() }: { files?: PriceModelFiles; now?: Date } = {}): AccuracyView {
  const rows = db.select().from(schema.priceObservations).all();
  const report = readPriceModelReport(files);
  const rule = { perKm: trains.distanceEstimate, rangePosition: trains.sncfFares.positionInRange };

  const seen = rows.map(
    (row): ObservedTrain => ({
      id: row.id,
      originLabel: row.originLabel,
      destinationLabel: row.destinationLabel,
      travelDate: row.travelDate,
      departTime: row.departTime,
      trainType: row.trainType,
      daysBefore: row.daysBefore,
      real: row.price2ndEur,
      distanceKm: row.distanceKm,
      rangeMinEur: row.rangeMinEur,
      rangeMaxEur: row.rangeMaxEur,
      // Only what the model said when it was held out: never what it says of the trains it learned from
      modelEur: report?.oof[row.id] ?? null,
    }),
  );
  const captures = rows.map((row) => row.capturedAt).sort();
  return {
    ...computeAccuracy(seen, rule),
    observations: rows.length,
    // One page read: every train of a page shares the instant it was captured at, and a page read twice is two
    sessions: new Set(rows.map((row) => `${row.source}|${row.capturedAt}`)).size,
    matched: rows.filter((row) => row.transportOptionId !== null).length,
    firstCapturedAt: captures[0] ?? null,
    lastCapturedAt: captures[captures.length - 1] ?? null,
    model: readModelStatus({ files, now }),
    perKm: trains.distanceEstimate,
    rangePosition: trains.sncfFares.positionInRange,
  };
}
