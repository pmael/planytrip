// The single source of every on-screen colour (use-cases.md R8). The UI maps these four words
// to actual shades; nothing else in the app decides what is "good" or "bad".
import type { DatesCoverage } from "./dates";
import type { BudgetTier, Color, ComfortLevel, StayVerdict, Trend } from "./types";

const FROM_TIER: Record<BudgetTier, Color> = { comfy: "green", limited: "yellow", over: "red" };
const FROM_VERDICT: Record<StayVerdict, Color> = { good: "green", ok: "yellow", bad: "red" };
const FROM_COVERAGE: Record<DatesCoverage, Color> = { covers: "green", partial: "yellow", none: "red" };
// ▲ is the lowest figure, so the best; ▼ the highest, so the worst (use-cases.md C-S3)
const FROM_TREND: Record<Trend, Color> = { "▲": "green", "≈": "yellow", "▼": "red" };

/** A price among its peers: the cheapest third is green, the middle yellow, the dearest red. */
function relativePrice(value: number, prices: readonly number[]): Color {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (prices.length < 2 || max === min) return "neutral";
  const position = (value - min) / (max - min);
  if (position < 1 / 3) return "green";
  if (position < 2 / 3) return "yellow";
  return "red";
}

/** Budget tier (R6): comfy, limited or over. */
export function colorOf(metric: "budget", value: BudgetTier | null | undefined): Color;
/** Comfort level (R2). */
export function colorOf(metric: "comfort", value: ComfortLevel | null | undefined): Color;
/**
 * Price among comparable prices, split in thirds of the price range (cheaper is greener).
 * `prices` is every value being compared, `value` included; neutral when they are all equal.
 */
export function colorOf(metric: "relativePrice", value: number, prices: readonly number[]): Color;
/** How well a guest's dates fit the window. */
export function colorOf(metric: "dates", value: DatesCoverage): Color;
/** A ▲ ▼ ≈ marker: the lowest figure among the destinations is green, the highest red, the rest yellow. */
export function colorOf(metric: "trend", value: Trend | null | undefined): Color;
/** The AI verdict on an accommodation; neutral (grey) while unavailable. */
export function colorOf(metric: "aiVerdict", value: StayVerdict | null | undefined): Color;
export function colorOf(metric: string, value: unknown, ctx?: unknown): Color {
  switch (metric) {
    case "budget":
      return FROM_TIER[value as BudgetTier] ?? "neutral";
    case "comfort":
      return (value as ComfortLevel | null | undefined) ?? "neutral";
    case "relativePrice":
      return relativePrice(value as number, ctx as readonly number[]);
    case "dates":
      return FROM_COVERAGE[value as DatesCoverage] ?? "neutral";
    case "trend":
      return FROM_TREND[value as Trend] ?? "neutral";
    case "aiVerdict":
      return FROM_VERDICT[value as StayVerdict] ?? "neutral";
    default:
      return "neutral";
  }
}
