// The words the dashboard uses for the Extra (extra.md §8, task.md T8.9): what it is mostly spent on, by the trip's
// objective.
import type { Objective } from "@/core/types";

/** The Home card's two words: the Mandatory's main line, then what the Plus is for */
export const EXTRA_WORDS: Record<Objective, readonly [string, string]> = {
  none: ["Groceries", "Transport"],
  partying: ["Food", "Nights out"],
  chill: ["Restaurants", "Relax"],
  culture: ["Food", "Visits"],
  nature: ["Food", "Hikes & car"],
};
