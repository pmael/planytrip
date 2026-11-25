// How wrong the estimates are, on the prices seen on SNCF Connect, Eurostar and Iryo (task.md T7.9, price-model.md P2). Pure: it is given the
// observations and what each method would have estimated for each, and compares them on the same trains.
import type { Metrics } from "./price-model";
import { baselineEstimate } from "./priceObservations";

export const ACCURACY_METHODS = ["current", "per_km", "range_mid", "range_max", "model"] as const;
export type AccuracyMethod = (typeof ACCURACY_METHODS)[number];

/** A train seen on a page, with what is known of it. */
export type ObservedTrain = {
  id: string;
  originLabel: string;
  destinationLabel: string;
  travelDate: string;
  departTime: string;
  trainType: string | null;
  daysBefore: number;
  /** The cheapest second-class fare on sale when it was seen */
  real: number;
  distanceKm: number | null;
  rangeMinEur: number | null;
  rangeMaxEur: number | null;
  /** The price the model gave it when it had not been trained on it */
  modelEur: number | null;
};

export type Estimates = Record<AccuracyMethod, number | null>;

export type Rule = { perKm: { eurPerKm: number; minEur: number }; /** Where in the range the app counts the price (0.5 is the middle) */ rangePosition: number };

/** What each method estimates for a train. `current` is what the app does: a point in the range for a direct TGV, else the rate per kilometre. */
export function estimatesFor(train: ObservedTrain, rule: Rule): Estimates {
  const input = { distanceKm: train.distanceKm, rangeMinEur: train.rangeMinEur, rangeMaxEur: train.rangeMaxEur };
  const inRange = train.rangeMinEur !== null && train.rangeMaxEur !== null ? train.rangeMinEur + (train.rangeMaxEur - train.rangeMinEur) * rule.rangePosition : null;
  const perKm = baselineEstimate("per_km", input, rule.perKm);
  return {
    current: inRange ?? perKm,
    per_km: perKm,
    range_mid: baselineEstimate("range_mid", input, rule.perKm),
    range_max: baselineEstimate("range_max", input, rule.perKm),
    model: train.modelEur,
  };
}

/** Errors are estimate minus real, in euros: a positive bias is an estimate that is too high. */
export function metricsOf(errors: number[]): Metrics | null {
  if (errors.length === 0) return null;
  const absolute = errors.map(Math.abs).sort((a, b) => a - b);
  const middle = Math.floor(absolute.length / 2);
  return {
    n: errors.length,
    mae: absolute.reduce((sum, e) => sum + e, 0) / absolute.length,
    median: absolute.length % 2 === 1 ? absolute[middle] : (absolute[middle - 1] + absolute[middle]) / 2,
    within10: absolute.filter((e) => e <= 10).length / absolute.length,
    bias: errors.reduce((sum, e) => sum + e, 0) / errors.length,
  };
}

export type Breakdown = { key: string; label: string; n: number; mae: Record<AccuracyMethod, number | null> };
export type Miss = { id: string; route: string; travelDate: string; departTime: string; trainType: string | null; daysBefore: number; real: number; estimate: number; error: number };

export type Accuracy = {
  /** Each method on every train it can estimate */
  all: Record<AccuracyMethod, Metrics | null>;
  /** Each method on the trains every method can estimate: the fair comparison */
  common: Record<AccuracyMethod, Metrics | null>;
  commonRows: number;
  byTrainType: Breakdown[];
  byDaysBefore: Breakdown[];
  /** The trains the current estimate missed by most */
  worst: Miss[];
  scatter: Record<AccuracyMethod, { estimate: number; real: number }[]>;
};

export const DAYS_BUCKETS = [
  { key: "0-7", label: "0 à 7 jours", test: (d: number) => d <= 7 },
  { key: "8-30", label: "8 à 30 jours", test: (d: number) => d >= 8 && d <= 30 },
  { key: "31-90", label: "31 à 90 jours", test: (d: number) => d >= 31 && d <= 90 },
  { key: "90+", label: "plus de 90 jours", test: (d: number) => d > 90 },
];

const empty = <T>(value: T): Record<AccuracyMethod, T> => Object.fromEntries(ACCURACY_METHODS.map((m) => [m, value])) as Record<AccuracyMethod, T>;

/** The mean absolute error of each method over some trains, on the trains each can estimate. */
function maeBy(rows: { train: ObservedTrain; estimates: Estimates }[]): Record<AccuracyMethod, number | null> {
  return Object.fromEntries(
    ACCURACY_METHODS.map((method) => {
      const errors = rows.flatMap(({ train, estimates }) => (estimates[method] === null ? [] : [Math.abs(estimates[method]! - train.real)]));
      return [method, errors.length === 0 ? null : errors.reduce((sum, e) => sum + e, 0) / errors.length];
    }),
  ) as Record<AccuracyMethod, number | null>;
}

export function computeAccuracy(trains: ObservedTrain[], rule: Rule, { worstCount = 20, maxPoints = 400 }: { worstCount?: number; maxPoints?: number } = {}): Accuracy {
  const rows = trains.map((train) => ({ train, estimates: estimatesFor(train, rule) }));
  // The model has only an opinion on the trains it was held out for: if it has any, the fair comparison is on those
  const modelPresent = rows.some(({ estimates }) => estimates.model !== null);
  const compared = ACCURACY_METHODS.filter((m) => m !== "current" && (m !== "model" || modelPresent));
  const commonRows = rows.filter(({ estimates }) => compared.every((m) => estimates[m] !== null));

  const errorsOf = (list: typeof rows, method: AccuracyMethod) => list.flatMap(({ train, estimates }) => (estimates[method] === null ? [] : [estimates[method]! - train.real]));
  const all = empty<Metrics | null>(null);
  const common = empty<Metrics | null>(null);
  for (const method of ACCURACY_METHODS) {
    all[method] = metricsOf(errorsOf(rows, method));
    common[method] = commonRows.length === 0 ? null : metricsOf(errorsOf(commonRows, method));
  }

  const groupBy = (key: (train: ObservedTrain) => string): Breakdown[] => {
    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(key(row.train), [...(groups.get(key(row.train)) ?? []), row]);
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([label, list]) => ({ key: label, label, n: list.length, mae: maeBy(list) }));
  };
  const byDaysBefore = DAYS_BUCKETS.flatMap((bucket): Breakdown[] => {
    const list = rows.filter(({ train }) => bucket.test(train.daysBefore));
    return list.length === 0 ? [] : [{ key: bucket.key, label: bucket.label, n: list.length, mae: maeBy(list) }];
  });

  const worst = rows
    .flatMap(({ train, estimates }) => (estimates.current === null ? [] : [{ train, estimate: estimates.current }]))
    .sort((a, b) => Math.abs(b.estimate - b.train.real) - Math.abs(a.estimate - a.train.real))
    .slice(0, worstCount)
    .map(({ train, estimate }): Miss => ({
      id: train.id,
      route: `${train.originLabel} → ${train.destinationLabel}`,
      travelDate: train.travelDate,
      departTime: train.departTime,
      trainType: train.trainType,
      daysBefore: train.daysBefore,
      real: train.real,
      estimate,
      error: estimate - train.real,
    }));

  const scatter = empty<{ estimate: number; real: number }[]>([]);
  for (const method of ACCURACY_METHODS) {
    scatter[method] = rows.flatMap(({ train, estimates }) => (estimates[method] === null ? [] : [{ estimate: estimates[method]!, real: train.real }])).slice(0, maxPoints);
  }

  return { all, common, commonRows: commonRows.length, byTrainType: groupBy((train) => train.trainType ?? "inconnu"), byDaysBefore, worst, scatter };
}
