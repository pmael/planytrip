// ▲ ▼ ≈ markers that compare a figure between destinations (use-cases.md C-S3).
import type { Trend } from "./types";

// Totals are compared unrounded, so two figures that differ by float noise are a tie
const TIE = 1e-6;

/**
 * ▲ marks the lowest value among the destinations, ▼ the highest, ≈ the ones in between.
 * Ties share a marker. When every value is equal (or there is only one), everything is ≈.
 */
export function trends(values: Record<string, number>): Record<string, Trend> {
  const entries = Object.entries(values);
  const numbers = entries.map(([, value]) => value);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const allEqual = max - min <= TIE;

  return Object.fromEntries(
    entries.map(([destinationId, value]): [string, Trend] => {
      if (allEqual) return [destinationId, "≈"];
      if (value - min <= TIE) return [destinationId, "▲"];
      if (max - value <= TIE) return [destinationId, "▼"];
      return [destinationId, "≈"];
    }),
  );
}
