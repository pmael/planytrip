// Prices seen on SNCF Connect, sent by the browser extension (task.md T7.9, price-model.md): storing them, matching each
// with the train of an option the app found, and keeping what the app had estimated for it at that moment.
import { and, eq, like, or } from "drizzle-orm";
import { priceObservations as settings, trains } from "@/config";
import { optionRaw, rangeCarrierOf, sameTrain, type OptionPrice, type OptionRaw } from "@/core/priceObservations";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { distanceKm } from "@/geo/airports";
import { ScrapeError } from "@/scrapers/errors";
import { createHttp, userAgentFor } from "@/scrapers/http";
import { createScrapeCache } from "@/scrapers/cache";
import { createFareFile, fareRange, parseFares, type FareTable } from "@/scrapers/transport/sncf-fares";
import { createStationLocator, type StationLocator } from "@/scrapers/transport/transitous";
import type { PriceObservationsBody } from "../schemas";

/** The import cannot be taken as it is, and the message says why (in French: the extension shows it). */
export class ImportRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRefusedError";
  }
}

export type ImportDeps = {
  /** SNCF's published fares */
  fareTable: () => Promise<FareTable>;
  /** Where a station is, for the distance of a train no option was matched with */
  locate: StationLocator;
};

export type ImportResult = {
  /** Prices stored */
  saved: number;
  /** Of which matched with the train of an option */
  matched: number;
  /** Already stored by a capture of the same page */
  duplicates: number;
  /** Trains the page showed with no price to keep, or that were not trains */
  skipped: number;
};

let table: Promise<FareTable> | null = null;
/** The fare file is read once for as long as the app runs, and again when it could not be. */
const sncfFareTable = () => (table ??= createFareFile()().then(parseFares).catch((error) => ((table = null), Promise.reject(error))));

/** The real thing: SNCF's file, and Transitous to find the stations (the answers kept for a month). */
export const defaultImportDeps = (db: Db): ImportDeps => ({
  fareTable: sncfFareTable,
  locate: createStationLocator({
    http: createHttp({ source: "Transitous", userAgent: userAgentFor(trains.transitous.contact), pauseMs: trains.transitous.pauseMs, timeoutMs: trains.transitous.timeoutMs }),
    cache: createScrapeCache(db),
  }),
});

const daysBetween = (capturedAt: string, travelDate: string) => Math.round((Date.parse(`${travelDate}T00:00:00Z`) - Date.parse(`${capturedAt.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/** What the extension could not know and the app can: how the page's trains compare with what it found and estimated. */
export async function importPriceObservations(db: Db, body: PriceObservationsBody, deps: ImportDeps = defaultImportDeps(db)): Promise<ImportResult> {
  const daysBefore = daysBetween(body.capturedAt, body.date);
  if (daysBefore < 0) throw new ImportRefusedError("Ce trajet est déjà passé : ses prix ne disent rien du prix d'un voyage à venir");

  // The trains the app found for that day, the freshest search first: a page is matched with those
  const candidates = db
    .select({ id: schema.transportOptions.id, rawJson: schema.transportOptions.rawJson, fetchedAt: schema.transportOptions.fetchedAt })
    .from(schema.transportOptions)
    .where(and(eq(schema.transportOptions.mode, "train"), or(like(schema.transportOptions.outDepartAt, `${body.date}%`), like(schema.transportOptions.backDepartAt, `${body.date}%`))))
    .all()
    .flatMap((row) => {
      const raw = optionRaw(row.rawJson);
      return raw ? [{ id: row.id, raw, fetchedAt: row.fetchedAt }] : [];
    })
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
  const waysToTry = body.direction === "out" ? (["out"] as const) : body.direction === "back" ? (["back"] as const) : (["out", "back"] as const);

  let fares: FareTable | null = null;
  try {
    fares = await deps.fareTable();
  } catch {
    // Without SNCF's file there is no range: the other columns are still worth keeping
  }
  /** Where a station is; null when nobody can say. A failure of the locator is not a failure of the import. */
  const where = async (name: string) => {
    try {
      return name ? await deps.locate(name) : null;
    } catch (error) {
      if (error instanceof ScrapeError) return null;
      throw error;
    }
  };

  const result: ImportResult = { saved: 0, matched: 0, duplicates: 0, skipped: 0 };
  for (const offer of body.offers) {
    // No price, or a "station" that is a line of the extension's own preview ("→ 08:14 · TGV INOUI · 0 corr. · 51 € (1re 74 €)"): not a train of a page
    const notAStation = (name: string | null | undefined) => /[→€·]/.test(name ?? "");
    if (offer.price2ndEur === null || offer.price2ndEur === undefined || notAStation(offer.departStation) || notAStation(offer.arriveStation)) {
      result.skipped++;
      continue;
    }
    const [departStation, arriveStation] = [offer.departStation ?? "", offer.arriveStation ?? ""];
    const seen = { travelDate: body.date, departTime: offer.departTime, departStation, arriveStation };

    let found: { optionId: string; raw: OptionRaw; price: OptionPrice; from?: { lat: number; lon: number }; to?: { lat: number; lon: number } } | null = null;
    for (const candidate of candidates) {
      for (const way of waysToTry) {
        const side = candidate.raw[way];
        if (side && sameTrain(seen, side.way, settings.matchMinutes)) {
          found = { optionId: candidate.id, raw: candidate.raw, price: side.price, from: side.way.fromPoint, to: side.way.toPoint };
          break;
        }
      }
      if (found) break;
    }

    // As the crow flies, from the station it leaves to the one it arrives at: from the option when there is one, else where the stations are
    const [from, to] = found?.from && found.to ? [found.from, found.to] : await Promise.all([where(departStation), where(arriveStation)]);
    const distance = from && to ? Math.round(distanceKm(from.lat, from.lon, to.lat, to.lon)) : null;

    // SNCF publishes a range for a direct TGV INOUI or OUIGO
    const carrier = rangeCarrierOf(offer.trainType ?? null, offer.changes ?? null);
    const range = carrier && fares && departStation && arriveStation ? fareRange(fares, carrier, departStation, arriveStation) : null;

    // What the app estimated for this train, before anything changes it: a price it was told by the seller is not an estimate
    const estimate = found && found.price.kind === "estimated" ? found.price : null;

    const inserted = db
      .insert(schema.priceObservations)
      .values({
        source: body.source,
        capturedAt: body.capturedAt,
        travelDate: body.date,
        daysBefore,
        direction: body.direction ?? null,
        originLabel: body.origin,
        destinationLabel: body.destination,
        departStation,
        arriveStation,
        departTime: offer.departTime,
        arriveTime: offer.arriveTime,
        durationMin: offer.durationMin ?? null,
        changes: offer.changes ?? null,
        trainType: offer.trainType ?? null,
        price2ndEur: offer.price2ndEur,
        price1stEur: offer.price1stEur ?? null,
        distanceKm: distance,
        rangeMinEur: range?.min ?? null,
        rangeMaxEur: range?.max ?? null,
        transportOptionId: found?.optionId ?? null,
        estimateEur: estimate?.priceEur ?? null,
        estimateMethod: estimate?.source ?? null,
        rawJson: JSON.stringify({ offer, pageUrl: body.pageUrl ?? null }),
      })
      .onConflictDoNothing()
      .run();
    if (inserted.changes === 0) result.duplicates++;
    else {
      result.saved++;
      if (found) result.matched++;
    }
  }
  return result;
}

