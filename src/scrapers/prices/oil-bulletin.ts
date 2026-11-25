// Fuel prices from the EU Weekly Oil Bulletin (task.md T8.12): the European Commission's weekly table of what petrol and
// diesel cost at the pump, taxes included, in each of the 27 EU countries. Open data (reuse with attribution), real
// figures, not estimates.
//
// The bulletin's page links to "Weekly prices with Taxes" as an .xlsx file, updated in place each Monday (its name keeps
// an older date). The page is read to find that link, then the file, and both are kept a week. The app's car runs on
// petrol (Euro-super 95). Countries outside the EU (Switzerland, Norway, the United Kingdom) are not in it.
import { fuel as settings } from "@/config";
import type { ScrapeCache } from "../types";
import { ScrapeBlockedError, ScrapeChangedError, ScrapeError } from "../errors";
import { userAgentFor } from "../http";
import { firstSheetRows } from "../xlsx";

export type OilBulletin = {
  /** The Monday the prices are for, "2026-11-09" */
  date: string;
  /** Euro-super 95, €/L, taxes included, by country as the bulletin names it ("France", "Czechia") */
  petrolEurPerL: Record<string, number>;
  /** Where a person can see it */
  url: string;
};

/** The latest bulletin; throws a ScrapeError when it cannot be read (the caller then keeps its own figure) */
export type FuelPricesSource = (options?: { cache?: ScrapeCache }) => Promise<OilBulletin>;

/** Excel's day 0 is 30 December 1899 */
const fromExcelDay = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);

/** The prices of the bulletin's "with taxes" sheet; throws a ScrapeChangedError when it is not laid out as it was */
export function parseOilBulletin(xlsx: Buffer, url: string): OilBulletin {
  let rows: Map<number, Map<string, string>>;
  try {
    rows = firstSheetRows(xlsx);
  } catch (error) {
    throw new ScrapeChangedError(`The Oil Bulletin's file could not be read: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const header = rows.get(1) ?? new Map<string, string>();
  const column = [...header].find(([, text]) => /euro-super\s*95/i.test(text))?.[0];
  const units = rows.get(2) ?? new Map<string, string>();
  if (!column || !/1000\s*l/i.test(units.get(column) ?? "")) throw new ScrapeChangedError("The Oil Bulletin's sheet no longer has Euro-super 95 in € per 1000 litres where it was");
  const day = Number(units.get("A"));
  if (!Number.isFinite(day) || day < 40_000) throw new ScrapeChangedError("The Oil Bulletin's sheet no longer says its date where it did");

  const petrolEurPerL: Record<string, number> = {};
  for (const [number, cells] of rows) {
    const country = (cells.get("A") ?? "").trim();
    const per1000 = Number(cells.get(column));
    if (number < 3 || !country || /^CE\/EC\/EG|EUR\d|Euro Area/i.test(country) || !Number.isFinite(per1000) || per1000 <= 0) continue;
    petrolEurPerL[country] = Math.round(per1000) / 1000;
  }
  if (Object.keys(petrolEurPerL).length < 20) throw new ScrapeChangedError("The Oil Bulletin's sheet has fewer countries than it should");
  return { date: fromExcelDay(day), petrolEurPerL, url };
}

const comparable = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z]/g, "");

/** What some places call a country the bulletin names otherwise */
const ALIASES: Record<string, string> = { czechrepublic: "czechia", holland: "netherlands" };

/** A country's petrol price, by its English name ("Spain", "Czech Republic"); null when the bulletin does not have it */
export function petrolPriceIn(bulletin: OilBulletin, country: string): number | null {
  const wanted = ALIASES[comparable(country)] ?? comparable(country);
  const found = Object.entries(bulletin.petrolEurPerL).find(([name]) => comparable(name) === wanted);
  return found ? found[1] : null;
}

/** The bulletin's page link to the "Weekly prices with Taxes" file */
export function latestFileLink(pageHtml: string): string | null {
  const href = /href="([^"]*\/document\/download\/[^"]*?with%20Taxes[^"]*?\.xlsx)"/i.exec(pageHtml)?.[1];
  return href ? new URL(href.replaceAll("&amp;", "&"), settings.oilBulletin.page).toString() : null;
}

async function get(url: string, fetchImpl: typeof fetch): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "user-agent": userAgentFor(null) }, signal: AbortSignal.timeout(settings.oilBulletin.timeoutMs) });
  } catch (error) {
    throw new ScrapeError(`Could not reach the EU Weekly Oil Bulletin: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new ScrapeBlockedError("The European Commission's site turned the request away");
  if (!response.ok) throw new ScrapeError(`The EU Weekly Oil Bulletin answered ${response.status}`);
  return response;
}

/** The latest bulletin: its page, then its file, kept a week */
export function createOilBulletin(fetchImpl: typeof fetch = fetch): FuelPricesSource {
  return async ({ cache } = {}) => {
    const produce = async (): Promise<OilBulletin> => {
      const page = await (await get(settings.oilBulletin.page, fetchImpl)).text();
      const link = latestFileLink(page);
      if (!link) throw new ScrapeChangedError("The Oil Bulletin's page no longer links to its prices with taxes");
      const file = Buffer.from(await (await get(link, fetchImpl)).arrayBuffer());
      return parseOilBulletin(file, settings.oilBulletin.page);
    };
    return cache ? cache.remember("with-taxes", "oil-bulletin", settings.oilBulletin.cacheTtlMs, produce) : produce();
  };
}

export const oilBulletin: FuelPricesSource = createOilBulletin();
