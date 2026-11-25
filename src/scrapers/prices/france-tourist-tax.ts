// France's tourist tax, commune by commune, from the State's open data (task.md T8.5): the commune at a point (its INSEE
// code, geo.api.gouv.fr), then the rates it voted (DELTA, data.economie.gouv.fr). Plain JSON requests, kept a month.
//
// What the data taught (2026-11-14):
// - A rental with no star rating (most Airbnbs) pays a share of the price per person per night (Paris: 5 %), with the
//   extra taxes on top, at most the highest rate the commune voted times the same extras (Paris 2026: €15.93).
// - The extra taxes (département 10 %, Île-de-France 200 % and 15 %) are in `tarif_total`, but Paris's 2025 rows have
//   lost the regional ones its 2024 rows had: the largest multiplier of the last two years is taken.
// - "Forfait": the host pays it from the number of beds, the guest does not.
import { touristTaxes } from "@/config";
import type { TaxRule } from "@/core/tourist-tax";
import { noCache } from "../cache";
import { createHttp, userAgentFor, type Http } from "../http";
import type { ScrapeCache } from "../types";

const SOURCE = "france-tourist-tax";

export type DeltaRow = {
  date_effet: string | null;
  date_fin?: string | null;
  libelle_commune?: string | null;
  hebergement: string | null;
  regime: string | null;
  tarif: number | null;
  unite: string | null;
  tarif_total: number | null;
};

const cents = (eur: number) => Math.round(eur * 100) / 100;
/** "VILLE DE PARIS" → "Ville de Paris", "SAINT-PAUL" → "Saint-Paul" */
const SMALL_WORDS = new Set(["de", "du", "des", "la", "le", "les", "en", "sur", "sous", "et", "aux"]);
const capitalised = (name: string) =>
  name
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");

/** The rule for a rental with no star rating in a commune, from its rows, for a stay in `year`; null when it voted none. */
export function ruleFromDelta(rows: DeltaRow[], year: number, unclassified: string = touristTaxes.france.unclassified): TaxRule | null {
  const years = [...new Set(rows.map((row) => Number(row.date_effet)).filter((y) => Number.isFinite(y) && y <= year))].sort((a, b) => b - a);
  const [latest] = years;
  if (latest === undefined) return null;
  const ofYear = rows.filter((row) => Number(row.date_effet) === latest);
  const rental = ofYear.find((row) => row.hebergement === unclassified && row.tarif !== null && row.tarif > 0);
  if (!rental) return null;

  // The extras on top: the largest seen these two years, since the latest rows may have lost some. They are whole
  // percents, and the totals are rounded to the cent: 10.73 / 3.30 is 3.2515 for 3.25
  const multiplier =
    Math.round(
      Math.max(
        1,
        ...rows
          .filter((row) => years.slice(0, 2).includes(Number(row.date_effet)) && row.tarif && row.tarif_total && row.tarif > 0)
          .map((row) => row.tarif_total! / row.tarif!),
      ) * 100,
    ) / 100;
  const highest = Math.max(0, ...ofYear.filter((row) => row.unite === "€" && row.tarif).map((row) => row.tarif!));
  const commune = capitalised(rental.libelle_commune ?? "the commune");
  const forfait = /forfait/i.test(rental.regime ?? "");
  const extras = multiplier > 1.001 ? `, with the extra taxes (×${multiplier.toFixed(2)})` : "";

  if (rental.unite === "%") {
    const cap = highest > 0 ? cents(highest * multiplier) : null;
    return {
      perPersonNightEur: null,
      percentOfPrice: Math.round(rental.tarif! * multiplier * 1000) / 1000,
      capPerNightEur: cap,
      maxNights: null,
      paidByHost: forfait,
      source: "open-data",
      label: `${commune} (${latest}): ${rental.tarif} % of the price a person a night${extras}${cap !== null ? `, at most €${cap}` : ""}${forfait ? "; paid by the host (forfait)" : ""}`,
    };
  }
  return {
    perPersonNightEur: cents(rental.tarif! * multiplier),
    percentOfPrice: null,
    capPerNightEur: null,
    maxNights: null,
    paidByHost: forfait,
    source: "open-data",
    label: `${commune} (${latest}): €${rental.tarif} a person a night${extras}${forfait ? "; paid by the host (forfait)" : ""}`,
  };
}

/** "75056" → département "75", commune "056"; overseas "97415" → "974", "15" */
export const deltaKeyOf = (code: string) => (code.startsWith("97") ? { departement: code.slice(0, 3), commune: code.slice(3) } : { departement: code.slice(0, 2), commune: code.slice(2) });

export type FranceTaxRules = (place: { lat: number; lon: number }, year: number, context?: { cache?: ScrapeCache }) => Promise<TaxRule | null>;

/** Points tried around a place, for one the geography API puts in the sea (the coast of La Réunion) */
const AROUND = [
  [0, 0],
  [0.02, 0],
  [-0.02, 0],
  [0, 0.02],
  [0, -0.02],
];

export function createFranceTaxRules({
  http = createHttp({ source: "France's open data", userAgent: userAgentFor(null), pauseMs: { min: 300, max: 600 }, timeoutMs: touristTaxes.france.timeoutMs }),
  config = touristTaxes.france,
}: { http?: Http; config?: typeof touristTaxes.france } = {}): FranceTaxRules {
  return async (place, year, { cache = noCache } = {}) => {
    const remember = <T>(key: string, produce: () => Promise<T>) => cache.remember(key, SOURCE, config.cacheTtlMs, produce);

    const code = await remember(`commune|${place.lat.toFixed(3)},${place.lon.toFixed(3)}`, async () => {
      for (const [dLat, dLon] of AROUND) {
        const url = `${config.communeUrl}?${new URLSearchParams({ lat: String(place.lat + dLat), lon: String(place.lon + dLon), fields: "code,nom", format: "json" })}`;
        const found = (await http.getJson(url)) as { code?: string }[];
        if (Array.isArray(found) && found[0]?.code) return found[0].code;
      }
      return null;
    });
    if (!code) return null;

    const { departement, commune } = deltaKeyOf(code);
    const rows = await remember(`rates|${code}`, async () => {
      const url = `${config.ratesUrl}?${new URLSearchParams({ where: `departement="${departement}" and commune="${commune}"`, order_by: "date_effet desc", limit: "100" })}`;
      const answer = (await http.getJson(url)) as { results?: DeltaRow[] };
      return answer.results ?? [];
    });
    return ruleFromDelta(rows, year, config.unclassified);
  };
}

export const franceTaxRules: FranceTaxRules = createFranceTaxRules();
