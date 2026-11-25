// What the step-3 preview says about one guest going to one destination (use-cases.md A.1 step 4).
import { formatDuration } from "@/core/comfort";
import { NO_AIRPORT, NO_ROAD_ROUTE, type ReachabilityCell } from "@/core/reachability";
import type { TransportMode } from "@/core/types";

export const MODE_LABELS: Record<TransportMode, string> = {
  plane: "Plane",
  train: "Train",
  bus: "Bus",
  car: "Car",
};

export type CellDescription = {
  /** How to colour it: ✅ ok, ⚠️ warning, ⛔ blocked, or still unknown */
  tone: ReachabilityCell["status"];
  title: string;
  detail: string | null;
  /** A mode to offer in one click ("Add plane"), when the guest is blocked */
  offer: TransportMode | null;
};

const BLOCKED_TITLES: Record<string, string> = {
  [NO_ROAD_ROUTE]: "No road route",
  [NO_AIRPORT]: "No airport nearby",
};

const lower = (text: string) => text.toLowerCase();

export function describeCell(cell: ReachabilityCell): CellDescription {
  switch (cell.status) {
    case "ok": {
      const reachable = cell.modes.filter((m) => m.state === "reachable");
      const car = reachable.find((m) => m.mode === "car");
      return {
        tone: "ok",
        title: `By ${reachable.map((m) => lower(MODE_LABELS[m.mode])).join(" or ")}`,
        detail: car?.distanceKm != null && car.durationMin != null ? `${car.distanceKm} km · ${formatDuration(car.durationMin)}` : null,
        offer: null,
      };
    }
    case "warning":
      return {
        tone: "warning",
        title: `About ${Math.round(cell.warning?.hours ?? 0)} h of driving`,
        detail: "An overnight stop will be suggested",
        offer: null,
      };
    case "blocked":
      return {
        tone: "blocked",
        title: BLOCKED_TITLES[cell.reason ?? ""] ?? "Can't get there",
        detail: cell.fallback ? null : "No other mode gets there",
        offer: cell.fallback,
      };
    case "unverified": {
      const outage = cell.modes.some((m) => m.state === "unverified");
      return {
        tone: "unverified",
        title: "Not verified",
        detail: outage ? "The routing service is unavailable" : "Checking…",
        offer: null,
      };
    }
  }
}
