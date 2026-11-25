// The train-price model (task.md T7.9, price-model.md P3): evaluating what tools/price-model/train.py trained, and deciding
// whether the app may use it. Pure. The features are built here exactly as train.py builds them, and tests/price-model.test.ts holds
// the two to the numbers scikit-learn gave for the same trains.
import { z } from "zod";
import { TRAIN_TYPES } from "./priceObservations";

// ── The model file ──────────────────────────────────────────────────────────

const Scaler = z.object({ mean: z.array(z.number()), scale: z.array(z.number()) });
const Impute = z.object({ duration_per_km: z.number() });
const Ridge = z.object({ intercept: z.number(), coef: z.array(z.number()) });
const Tree = z.object({ left: z.array(z.number()), right: z.array(z.number()), feature: z.array(z.number()), threshold: z.array(z.number()), value: z.array(z.number()) });
const Forest = z.object({ init: z.number(), learning_rate: z.number(), trees: z.array(Tree) });

const SubModel = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ridge"), rows: z.number(), impute: Impute, scaler: Scaler, estimator: Ridge }),
  z.object({ kind: z.literal("gbr"), rows: z.number(), impute: Impute, scaler: Scaler, estimator: Forest }),
]);
export type SubModel = z.infer<typeof SubModel>;

export const PriceModelFileSchema = z.object({
  version: z.literal(1),
  trainedAt: z.string(),
  observations: z.number(),
  sessions: z.number(),
  baseline: z.object({ eurPerKm: z.number(), minEur: z.number() }),
  holidays: z.array(z.tuple([z.string(), z.string()])),
  models: z.object({ range: SubModel.nullable(), perKm: SubModel.nullable() }),
});
export type PriceModelFile = z.infer<typeof PriceModelFileSchema>;

const Metrics = z.object({ n: z.number(), mae: z.number(), median: z.number(), within10: z.number(), bias: z.number() });
export type Metrics = z.infer<typeof Metrics>;
const ReportEntry = z.object({
  rows: z.number(),
  sessions: z.number(),
  /** Routes and days: what is held out together */
  groups: z.number().optional(),
  /** Different routes (origin and destination) in the rows */
  routes: z.number().optional(),
  status: z.string(),
  selected: z.enum(["ridge", "gbr"]).optional(),
  against: z.string().optional(),
  improvement: z.number().optional(),
  cv: z.string().optional(),
  candidates: z.record(z.string(), z.object({ mae: z.number() })).optional(),
  heldOut: z.record(z.string(), Metrics).optional(),
  folds: z.array(z.object({ fold: z.number(), n: z.number(), groups: z.number().optional(), sessions: z.number().optional(), mae: z.record(z.string(), z.number()) })).optional(),
});
export type ReportEntry = z.infer<typeof ReportEntry>;

export const PriceModelReportSchema = z.object({
  version: z.literal(1),
  trainedAt: z.string(),
  observations: z.number(),
  sessions: z.number(),
  holidays: z.object({ periods: z.number(), status: z.string() }),
  models: z.object({ range: ReportEntry, perKm: ReportEntry }),
  /** The price the model gave each observation when it had not been trained on it, by observation id */
  oof: z.record(z.string(), z.number()),
});
export type PriceModelReport = z.infer<typeof PriceModelReportSchema>;

// ── The features ────────────────────────────────────────────────────────────

/** What the model looks at in a train. The same words as a row of `price_observations`. */
export type FeatureInput = {
  /** Days from now to the travel date */
  daysBefore: number;
  /** YYYY-MM-DD */
  travelDate: string;
  /** HH:MM, local */
  departTime: string;
  trainType: string | null;
  changes: number | null;
  durationMin: number | null;
  /** As the crow flies, station to station */
  distanceKm: number | null;
};

const HOUR_BUCKETS: [number, number][] = [[0, 8], [8, 12], [12, 16], [16, 20], [20, 24]];
const KNOWN_TYPES: readonly string[] = [...TRAIN_TYPES, "OTHER"];

/** Monday is 0, as in Python's `weekday()`. */
const weekdayOf = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

/** A school holiday in at least one zone: [start, end), the end being the day classes resume. */
export const inHolidays = (date: string, ranges: [string, string][]) => ranges.some(([start, end]) => start <= date && date < end);

/** The numbers the model is given, in the order train.py's FEATURE_NAMES lists them. */
export function featureVector(input: FeatureInput, holidays: [string, string][], durationPerKmFallback: number): number[] {
  const days = Math.max(input.daysBefore, 0);
  const durationPerKm = input.durationMin !== null && input.distanceKm !== null && input.distanceKm > 0 ? input.durationMin / input.distanceKm : durationPerKmFallback;
  const weekday = weekdayOf(input.travelDate);
  const hour = Number(input.departTime.slice(0, 2));
  // A journey with changes is MIXED, whatever the page's first logo said
  const type = (input.changes ?? 0) > 0 ? "MIXED" : input.trainType !== null && KNOWN_TYPES.includes(input.trainType) ? input.trainType : "OTHER";
  return [
    days,
    Math.log1p(days),
    input.changes ?? 0,
    durationPerKm,
    ...Array.from({ length: 7 }, (_, i) => (weekday === i ? 1 : 0)),
    ...HOUR_BUCKETS.map(([low, high]) => (low <= hour && hour < high ? 1 : 0)),
    weekday === 4 || weekday === 6 ? 1 : 0,
    inHolidays(input.travelDate, holidays) ? 1 : 0,
    ...KNOWN_TYPES.map((t) => (t === type ? 1 : 0)),
  ];
}

// ── Evaluating ──────────────────────────────────────────────────────────────

/** What the model predicts for a train: a place in the published range, or a price per kilometre, by the model's kind. */
export function predictTarget(model: SubModel, holidays: [string, string][], input: FeatureInput): number {
  const raw = featureVector(input, holidays, model.impute.duration_per_km);
  const x = raw.map((value, i) => (value - model.scaler.mean[i]) / model.scaler.scale[i]);
  if (model.kind === "ridge") return model.estimator.coef.reduce((sum, coef, i) => sum + coef * x[i], model.estimator.intercept);

  let total = model.estimator.init;
  for (const tree of model.estimator.trees) {
    let node = 0;
    // A leaf has no child
    while (tree.left[node] !== -1) node = x[tree.feature[node]] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    total += model.estimator.learning_rate * tree.value[node];
  }
  return total;
}

/** A direct TGV INOUI or OUIGO: where the model puts its price in SNCF's published range, in euros. */
export function priceInRange(file: PriceModelFile, input: FeatureInput, range: { min: number; max: number }): number | null {
  if (!file.models.range) return null;
  return Math.max(0, range.min + predictTarget(file.models.range, file.holidays, input) * (range.max - range.min));
}

/** Any other train: the model's price per kilometre, over the distance, at least the least price. */
export function priceByDistance(file: PriceModelFile, input: FeatureInput): number | null {
  if (!file.models.perKm || input.distanceKm === null || input.distanceKm <= 0) return null;
  return Math.max(file.baseline.minEur, predictTarget(file.models.perKm, file.holidays, input) * input.distanceKm);
}

// ── Whether the app may use it ──────────────────────────────────────────────

export type Activation = { minObservations: number; minSessions: number; minImprovement: number; minRowsPerModel: number; minRoutes: number; minGroups: number };

export type SubModelStatus = {
  /** The model is used for this kind of train */
  usable: boolean;
  /** Why, or why not, in French (the accuracy page says it as it is) */
  reason: string;
  /** Held-out mean absolute error of the model and of the simple method it must beat, in euros */
  mae: number | null;
  baselineMae: number | null;
  baseline: string | null;
  /** 0.2 is 20 % less error than the simple method */
  improvement: number | null;
  rows: number;
};

export type ModelStatus = {
  state: "missing" | "not-enough-data" | "inactive" | "active";
  /** The sentence for the page */
  message: string;
  observations: number;
  sessions: number;
  trainedAt: string | null;
  /** Trained more than `staleAfterDays` ago: fares drift */
  stale: boolean;
  range: SubModelStatus;
  perKm: SubModelStatus;
};

const percent = (value: number) => `${Math.round(value * 100)} %`;

function subStatus(entry: ReportEntry | null, dataEnough: boolean, rule: Activation): SubModelStatus {
  if (!entry) return { usable: false, reason: "pas encore entraîné", mae: null, baselineMae: null, baseline: null, improvement: null, rows: 0 };
  const base = { rows: entry.rows, improvement: entry.improvement ?? null, baseline: entry.against ?? null };
  const mae = entry.heldOut?.model?.mae ?? null;
  const baselineMae = entry.against ? (entry.heldOut?.[entry.against]?.mae ?? null) : null;
  if (entry.status !== "trained" || mae === null || entry.improvement === undefined) return { ...base, usable: false, reason: "pas assez de lignes pour l'entraîner", mae, baselineMae };
  if (!dataEnough) return { ...base, usable: false, reason: "pas encore assez de données", mae, baselineMae };
  if (entry.rows < rule.minRowsPerModel) return { ...base, usable: false, reason: `pas assez de lignes (${entry.rows}/${rule.minRowsPerModel})`, mae, baselineMae };
  // Seen on a few routes only, it would be judged on those and used on all the others
  if ((entry.routes ?? 0) < rule.minRoutes) return { ...base, usable: false, reason: `pas assez de trajets différents (${entry.routes ?? 0}/${rule.minRoutes})`, mae, baselineMae };
  if ((entry.groups ?? 0) < rule.minGroups) return { ...base, usable: false, reason: `pas assez de trajets et de jours différents (${entry.groups ?? 0}/${rule.minGroups})`, mae, baselineMae };
  if (entry.improvement < rule.minImprovement) {
    return { ...base, usable: false, reason: `ne bat pas assez ${entry.against} (${percent(entry.improvement)} d'erreur en moins, il en faut ${percent(rule.minImprovement)})`, mae, baselineMae };
  }
  return { ...base, usable: true, reason: `bat ${entry.against} de ${percent(entry.improvement)}`, mae, baselineMae };
}

/** From the report of the last training: is there enough data, does the model beat the simple method on data it never saw, and is it recent. */
export function modelStatus(report: PriceModelReport | null, rule: Activation, staleAfterDays: number, now: Date = new Date()): ModelStatus {
  if (!report) {
    const nothing = subStatus(null, false, rule);
    return { state: "missing", message: `pas encore de modèle (0/${rule.minObservations} observations)`, observations: 0, sessions: 0, trainedAt: null, stale: false, range: nothing, perKm: nothing };
  }

  const enoughObservations = report.observations >= rule.minObservations;
  const enoughSessions = report.sessions >= rule.minSessions;
  const dataEnough = enoughObservations && enoughSessions;
  const [range, perKm] = [subStatus(report.models.range, dataEnough, rule), subStatus(report.models.perKm, dataEnough, rule)];
  const stale = now.getTime() - Date.parse(report.trainedAt) > staleAfterDays * 86_400_000;
  const common = { observations: report.observations, sessions: report.sessions, trainedAt: report.trainedAt, stale, range, perKm };

  if (!enoughObservations) return { ...common, state: "not-enough-data", message: `pas encore assez de données (${report.observations}/${rule.minObservations})` };
  if (!enoughSessions) return { ...common, state: "not-enough-data", message: `pas encore assez de recherches différentes (${report.sessions}/${rule.minSessions} sessions de capture)` };
  if (!range.usable && !perKm.usable) return { ...common, state: "inactive", message: "le modèle ne bat pas assez l'estimation actuelle : elle reste en place" };
  const used = [range.usable ? "fourchette SNCF" : null, perKm.usable ? "prix au km" : null].filter(Boolean).join(" et ");
  return { ...common, state: "active", message: `modèle utilisé pour : ${used}` };
}
