// SNCF's published fare ranges (task.md T7.8): for each pair of stations, the lowest and the highest full fare
// of a TGV INOUI or an OUIGO, by class. Open data (data.gouv.fr, ODbL). It is a range, not the price of a train:
// the lowest applies to the cheapest days and the highest to the last seats, so what is counted is a point in
// between (config.trains.sncfFares.positionInRange) and it is said to be an estimate.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { trains } from "@/config";
import { stationKey } from "@/core/stations";
import { ScrapeError } from "../errors";
import type { FareQuote, FareSource, PricePredictor, RailLeg } from "./train-types";

export type Range = { min: number; max: number };
export type FareTable = Map<string, Range>;

// The names of stations are compared the way core/stations.ts does
export { stationKey };

/** The carrier of a train in the dataset's words, or null for a train the dataset does not cover. */
export function carrierOf(leg: Pick<RailLeg, "train" | "operator">): string | null {
  if (!/^SNCF/i.test(leg.operator)) return null;
  if (/^TGV INOUI/i.test(leg.train)) return "TGV INOUI";
  if (/^OUIGO_TC/i.test(leg.train)) return "OUIGO TRAIN CLASSIQUE";
  if (/^OUIGO/i.test(leg.train)) return "OUIGO";
  return null;
}

const key = (carrier: string, from: string, to: string) => `${carrier}|${stationKey(from)}|${stationKey(to)}`;

/** The published range between two stations for a carrier, whichever way the file wrote the pair; null when it has none. */
export function fareRange(table: FareTable, carrier: string, from: string, to: string): Range | null {
  return table.get(key(carrier, from, to)) ?? table.get(key(carrier, to, from)) ?? null;
}

/** The second-class full fares of the file: "Transporteur;Gare origine;…;Classe;Profil tarifaire;Prix minimum;Prix maximum". */
export function parseFares(csv: string): FareTable {
  const table: FareTable = new Map();
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  const header = lines[0]?.split(";") ?? [];
  const col = (name: string) => header.findIndex((h) => h.trim() === name);
  const [carrier, from, to, klass, profile, min, max] = ["Transporteur", "Gare origine", "Gare destination", "Classe", "Profil tarifaire", "Prix minimum", "Prix maximum"].map(col);
  if ([carrier, from, to, klass, profile, min, max].some((index) => index < 0)) throw new ScrapeError("The SNCF fare file is not in the form the scraper knows");

  for (const line of lines.slice(1)) {
    const cells = line.split(";");
    if (cells[klass] !== "2" || cells[profile] !== "Tarif Normal") continue;
    const range = { min: Number(cells[min]), max: Number(cells[max]) };
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) continue;
    table.set(key(cells[carrier], cells[from], cells[to]), range);
  }
  return table;
}

/** The file, kept on disk for a month: it changes when the fares do, a few times a year. SNCF's list of stations is kept the same way. */
export function createFareFile({
  file = trains.sncfFares.file,
  url = trains.sncfFares.url,
  maxAgeMs = trains.sncfFares.maxAgeMs,
  timeoutMs = trains.sncfFares.timeoutMs,
  fetchImpl = fetch,
  now = Date.now,
  what = "SNCF's fares",
}: { file?: string; url?: string; maxAgeMs?: number; timeoutMs?: number; fetchImpl?: typeof fetch; now?: () => number; what?: string } = {}): () => Promise<string> {
  return async () => {
    try {
      if (now() - (await stat(file)).mtimeMs < maxAgeMs) return await readFile(file, "utf8");
    } catch {
      // Not there yet
    }
    let text: string;
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": "planytrip/1.0 (personal use)" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      text = await response.text();
    } catch (error) {
      // An old copy is better than none: fares move slowly
      try {
        return await readFile(file, "utf8");
      } catch {
        throw new ScrapeError(`Could not get ${what}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
    return text;
  };
}

export function createSncfFares({
  load = createFareFile(),
  config = trains.sncfFares,
  link = trains.links.sncf,
  predictor,
}: { load?: () => Promise<string>; config?: { positionInRange: number }; link?: string; predictor?: PricePredictor } = {}): FareSource<FareQuote | null> {
  let table: Promise<FareTable> | null = null;
  const fares = () => (table ??= load().then(parseFares).catch((error) => ((table = null), Promise.reject(error))));

  const rangeOf = (known: FareTable, leg: RailLeg): Range | null => {
    const carrier = carrierOf(leg);
    // The fares do not depend on the direction
    return carrier ? fareRange(known, carrier, leg.from.name, leg.to.name) : null;
  };

  return {
    id: "sncf-fares",
    async quote(journeys) {
      const known = await fares();
      return journeys.map((journey): FareQuote | null => {
        const ranges = journey.legs.map((leg) => rangeOf(known, leg));
        // Every train of the journey must be one the file knows, else it says nothing of its price
        if (ranges.some((range) => range === null)) return null;
        const found = ranges as Range[];
        // For a direct train, the model of the prices seen on SNCF Connect says where in its range the price falls, once it is proved
        const modeled = journey.legs.length === 1 ? predictor?.withinRange(journey, found[0]) : null;
        if (modeled) return { priceEur: Math.round(modeled.priceEur), kind: "estimated", note: modeled.note, source: "model", link };
        const min = found.reduce((sum, r) => sum + r.min, 0);
        const max = found.reduce((sum, r) => sum + r.max, 0);
        return {
          priceEur: Math.round(min + (max - min) * config.positionInRange),
          kind: "estimated",
          note: `SNCF's published fares for this route: ${Math.round(min)} to ${Math.round(max)} € one way`,
          source: "sncf-fares",
          link,
        };
      });
    },
  };
}
