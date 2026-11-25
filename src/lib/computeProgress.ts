// How far along a computation is, as one number for the progress bar.
import type { ComputeProgress } from "@/server/services/compute";

/** The route checks come first and are quick: they count for a fifth, the searches for the rest. */
const ROUTES_WEIGHT = 0.2;

/**
 * A fraction between 0 and 1. It only ever goes up: the number of searches is not known until the
 * routes are checked and the searches planned, and that must not pull the bar back. A trip that is
 * ready is at 1, whatever the steps say.
 */
export function computeFraction(progress: ComputeProgress | null): number {
  if (!progress) return 0;
  if (progress.status === "ready") return 1;

  const routes = progress.steps.find((step) => step.id === "routes");
  const routesPart = routes?.state === "done" ? 1 : routes && routes.total > 0 ? routes.done / routes.total : 0;

  const searches = progress.steps.filter((step) => step.id !== "routes");
  const total = searches.reduce((sum, step) => sum + step.total, 0);
  const finished = searches.reduce((sum, step) => sum + step.done, 0);
  const searchesPart = total > 0 ? finished / total : 0;

  return ROUTES_WEIGHT * routesPart + (1 - ROUTES_WEIGHT) * searchesPart;
}
