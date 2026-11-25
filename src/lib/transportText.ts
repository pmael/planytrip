// How the Transports page writes down what the service worked out.
import { NO_AIRPORT, NO_ROAD_ROUTE } from "@/core/reachability";
import type { TransportVariant } from "@/core/types";
import { TRAIN_PROVIDER_LABELS } from "@/scrapers/transport/train-operators";

const PROVIDER_LABELS: Record<string, string> = {
  transavia: "Transavia",
  vueling: "Vueling",
  iberia: "Iberia",
  easyjet: "easyJet",
  "air-austral": "Air Austral",
  "google-flights": "Google Flights",
  flixbus: "FlixBus",
  klm: "KLM",
  swiss: "SWISS",
  "tap-air-portugal": "TAP Air Portugal",
  sas: "SAS",
  "lot-polish-airlines": "LOT Polish Airlines",
  osrm: "Road",
  valhalla: "Road",
  fixture: "Sample fare",
};

/** "air-austral" → "Air Austral", with the usual names written as the companies write them. */
export function providerLabel(provider: string): string {
  return (
    PROVIDER_LABELS[provider] ??
    TRAIN_PROVIDER_LABELS[provider] ??
    provider
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** What sets a car option apart from the others of its route; nothing to say for a plain fare. */
export const VARIANT_LABELS: Record<TransportVariant, string | null> = {
  standard: null,
  tolls: "With tolls",
  no_tolls: "No tolls",
  overnight_stop: "Overnight stop",
};

/** "Uncomfortable: 3 stops, 23 h 40 of travel, over 20 h" */
export const uncomfortableText = (reasons: string[]) =>
  reasons.length > 0 ? `Uncomfortable: ${reasons.join(", ")}` : "Uncomfortable";

/** Why a mode offers nothing at a destination. */
export function blockedText(reason: string, destination: string): string {
  if (reason === NO_ROAD_ROUTE) return `There is no road to ${destination}`;
  if (reason === NO_AIRPORT) return `There is no airport near ${destination}`;
  return `Can't get to ${destination} this way`;
}
