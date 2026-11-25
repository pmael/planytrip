// The price model in use (task.md T7.9, price-model.md P3.3): whether it may be used, and the price it gives for a train. A model
// is used only once it has the data and beats the simple method on data it never saw; until then the estimate stays as it is.
import { priceModel as settings } from "@/config";
import { modelStatus, priceByDistance, priceInRange, type FeatureInput, type ModelStatus, type SubModelStatus } from "@/core/price-model";
import { trainTypeOfLegs } from "@/core/priceObservations";
import { distanceKm } from "@/geo/airports";
import type { PricePredictor, TrainJourney } from "@/scrapers/transport/train-types";
import { readPriceModelFile, readPriceModelReport, type PriceModelFiles } from "./priceModelFiles";

/** Where the model stands: for the accuracy page, and for the decision to use it. */
export function readModelStatus({ files = settings, now = new Date() }: { files?: PriceModelFiles; now?: Date } = {}): ModelStatus {
  return modelStatus(readPriceModelReport(files), settings.activation, settings.staleAfterDays, now);
}

/**
 * What the model looks at in a journey of the timetable. Null for a journey with a train that is not SNCF's: the model learns from
 * prices seen on SNCF Connect, and says nothing of Renfe or SBB.
 */
export function featureInputOf(journey: TrainJourney, now: Date): FeatureInput | null {
  if (!journey.legs.every((leg) => /^SNCF/i.test(leg.operator))) return null;
  const first = journey.legs[0].from;
  const last = journey.legs[journey.legs.length - 1].to;
  const travelDate = journey.departAt.slice(0, 10);
  return {
    daysBefore: Math.max(0, Math.round((Date.parse(`${travelDate}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)),
    travelDate,
    departTime: journey.departAt.slice(11, 16),
    trainType: trainTypeOfLegs(journey.legs),
    changes: journey.legs.length - 1,
    durationMin: journey.durationMin,
    // As the observations measure it, whole kilometres, station to station
    distanceKm: Math.round(distanceKm(first.lat, first.lon, last.lat, last.lon)),
  };
}

const noteOf = (status: SubModelStatus, observations: number) =>
  `Estimated by the model trained on ${observations} prices seen on SNCF Connect (typical error ${Math.round(status.mae ?? 0)} €)`;

/** The model as the train search uses it: a price for a train, or null when the model is not in use for it. */
export function createModelPredictor({ files = settings, now = () => new Date() }: { files?: PriceModelFiles; now?: () => Date } = {}): PricePredictor {
  const inUse = () => {
    const [file, report] = [readPriceModelFile(files), readPriceModelReport(files)];
    return file && report ? { file, status: modelStatus(report, settings.activation, settings.staleAfterDays, now()) } : null;
  };

  return {
    withinRange(journey, range) {
      const current = inUse();
      const input = current?.status.range.usable ? featureInputOf(journey, now()) : null;
      const price = current && input ? priceInRange(current.file, input, range) : null;
      return current && price !== null ? { priceEur: price, note: noteOf(current.status.range, current.status.observations) } : null;
    },
    byDistance(journey) {
      const current = inUse();
      const input = current?.status.perKm.usable ? featureInputOf(journey, now()) : null;
      const price = current && input ? priceByDistance(current.file, input) : null;
      return current && price !== null ? { priceEur: price, note: noteOf(current.status.perKm, current.status.observations) } : null;
    },
  };
}

/** The model in use by the app: it reads the files again when `train.py` writes them. */
export const modelPredictor: PricePredictor = createModelPredictor();
