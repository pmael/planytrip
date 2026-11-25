// Every country's price levels, from Eurostat (prc_ppp_ind, "price level indices", EU27 = 100), for the local prices the
// rules give when the AI is not there (task.md T8.4). One small file for every country and category, kept on disk for
// three months (it changes once a year), asked again after that; an old copy is used when Eurostat cannot be reached.
import { extraPrices } from "@/config";
import type { PriceLevels } from "@/core/local-prices";
import { ScrapeChangedError } from "../errors";
import { createFareFile } from "../transport/sncf-fares";

/** Eurostat's country codes that are not ISO's */
const ISO_OF: Record<string, string> = { EL: "GR", UK: "GB" };

type JsonStat = {
  id?: string[];
  size?: number[];
  value?: Record<string, number>;
  dimension?: Record<string, { category?: { index?: Record<string, number> } }>;
};

/** Each country's price levels (by ISO code), each category at the latest year it has. */
export function parsePriceLevels(text: string): Map<string, PriceLevels> {
  let data: JsonStat;
  try {
    data = JSON.parse(text) as JsonStat;
  } catch {
    throw new ScrapeChangedError("Eurostat's price levels are not JSON");
  }
  const { id, size, value, dimension } = data;
  if (!id || !size || !value || !dimension) throw new ScrapeChangedError("Eurostat's price levels are not in the form expected (JSON-stat)");

  const indexes = id.map((name) => Object.entries(dimension[name]?.category?.index ?? {}).sort((a, b) => a[1] - b[1]).map(([code]) => code));
  const position = (name: string) => id.indexOf(name);
  const [cat, geo, time] = [position("ppp_cat"), position("geo"), position("time")];
  if (cat < 0 || geo < 0 || time < 0) throw new ScrapeChangedError("Eurostat's price levels have no category, country or year");

  // A flat index runs over the dimensions in order, the last one fastest
  const strides = size.map((_, i) => size.slice(i + 1).reduce((product, n) => product * n, 1));
  const latest = new Map<string, Map<string, { year: string; level: number }>>();
  for (const [flat, level] of Object.entries(value)) {
    const n = Number(flat);
    const coordinate = (dim: number) => indexes[dim][Math.floor(n / strides[dim]) % size[dim]];
    const country = ISO_OF[coordinate(geo)] ?? coordinate(geo);
    if (!/^[A-Z]{2}$/.test(country)) continue;
    const category = coordinate(cat);
    const year = coordinate(time);
    const byCategory = latest.get(country) ?? new Map();
    const kept = byCategory.get(category);
    if (!kept || year > kept.year) byCategory.set(category, { year, level });
    latest.set(country, byCategory);
  }
  return new Map([...latest].map(([country, byCategory]) => [country, Object.fromEntries([...byCategory].map(([category, { level }]) => [category, level]))]));
}

/** A country's price levels, null for one Eurostat does not cover. Throws a ScrapeError when nothing can be read. */
export type PriceLevelsSource = (country: string) => Promise<PriceLevels | null>;

export function createPriceLevels({
  load = createFareFile({ ...extraPrices.eurostat, what: "Eurostat's price levels" }),
}: { load?: () => Promise<string> } = {}): PriceLevelsSource {
  let table: Promise<Map<string, PriceLevels>> | null = null;
  return async (country) => {
    table ??= load().then(parsePriceLevels).catch((error) => ((table = null), Promise.reject(error)));
    return (await table).get(country.toUpperCase()) ?? null;
  };
}

export const eurostatPriceLevels: PriceLevelsSource = createPriceLevels();
