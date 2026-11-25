// The local prices of a destination by the rules (task.md T8.4, use-cases.md R10): the EU average price of each thing
// times the country's price level (Eurostat), and the check of the AI's prices against them. Pure.
import { extraPrices } from "@/config";
import type { LocalPrice, LocalPrices } from "./extras";

export const PRICE_KEYS = Object.keys(extraPrices.euAverage) as (keyof LocalPrices)[];

/** A country's price levels by Eurostat category ("A0111": restaurants and hotels), EU average = 100 */
export type PriceLevels = Record<string, number>;

type Settings = Pick<typeof extraPrices, "euAverage" | "levelOf" | "believable">;

const cents = (eur: number) => Math.round(eur * 100) / 100;

/**
 * Every price by the rules. `levels` null: the country has no price level (Eurostat covers Europe, the US and Japan),
 * and the EU average is used, which `message` says.
 */
export function rulesPrices(levels: PriceLevels | null, country: string, settings: Settings = extraPrices): { prices: LocalPrices; message: string } {
  const levelOf = (key: keyof LocalPrices) => levels?.[settings.levelOf[key]];
  const prices = Object.fromEntries(
    PRICE_KEYS.map((key) => [key, { eur: cents((settings.euAverage[key] * (levelOf(key) ?? 100)) / 100), source: "rules" } satisfies LocalPrice]),
  ) as LocalPrices;
  // Eurostat lists the United Kingdom without a figure since it left the EU
  const known = PRICE_KEYS.filter((key) => levelOf(key) !== undefined).length;
  const message =
    known === PRICE_KEYS.length
      ? `the EU average of each thing times ${country}'s price level (Eurostat)`
      : known === 0
        ? `no price level is known for ${country}: the EU average of each thing`
        : `the EU average of each thing times ${country}'s price level (Eurostat), the EU average where it has none`;
  return { prices, message };
}

/**
 * The AI's prices, each one checked against the rules': one too far from it (an answer in the wrong unit, a typo) is
 * replaced by the rules' and counted in `replaced`.
 */
export function checkedPrices(given: Record<keyof LocalPrices, number>, rules: LocalPrices, settings: Settings = extraPrices): { prices: LocalPrices; replaced: (keyof LocalPrices)[] } {
  const replaced: (keyof LocalPrices)[] = [];
  const prices = Object.fromEntries(
    PRICE_KEYS.map((key) => {
      const value = given[key];
      const reference = rules[key].eur;
      const believable = Number.isFinite(value) && value > 0 && value >= reference * settings.believable.min && value <= reference * settings.believable.max;
      if (!believable) replaced.push(key);
      return [key, believable ? { eur: cents(value), source: "ai" } : rules[key]];
    }),
  ) as LocalPrices;
  return { prices, replaced };
}
