// Turns database rows into the domain types of core/types.ts: JSON columns are parsed and
// the selection rows become a proper union.
import type {
  Destination,
  Job,
  JobProgress,
  Guest,
  GuestModes,
  RouteCheck,
  Selection,
  StayAnalysis,
  StayOption,
  Summary,
  Trip,
  TransportOption,
} from "@/core/types";
import type * as schema from "./schema";

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

const list = (json: string) => JSON.parse(json) as string[];

export const toTrip = (row: Row<typeof schema.trips>): Trip => ({ ...row });

export const toGuest = ({ homeAirportsJson, ...row }: Row<typeof schema.guests>): Guest => ({
  ...row,
  homeAirports: list(homeAirportsJson),
});

export function toGuestModes(rows: Row<typeof schema.guestModes>[]): GuestModes {
  const modes: GuestModes = {};
  for (const { guestId, mode } of rows) (modes[guestId] ??= []).push(mode);
  return modes;
}

export const toDestination = ({ airportsJson, ...row }: Row<typeof schema.destinations>): Destination => ({
  ...row,
  airports: list(airportsJson),
});

export const toRouteCheck = (row: Row<typeof schema.routeChecks>): RouteCheck => ({ ...row });

// The raw scraped payload stays in the database, the domain does not need it
/* eslint-disable @typescript-eslint/no-unused-vars */
export const toTransportOption = ({
  rawJson: _rawJson,
  ...row
}: Row<typeof schema.transportOptions>): TransportOption => ({ ...row });

export const toStayOption = ({
  photosJson,
  reviewsSampleJson,
  rawJson: _rawJson,
  ...row
}: Row<typeof schema.stayOptions>): StayOption => ({
  ...row,
  photos: list(photosJson),
  reviewsSample: reviewsSampleJson ? list(reviewsSampleJson) : null,
});

/* eslint-enable @typescript-eslint/no-unused-vars */

export const toStayAnalysis = ({ prosJson, consJson, ...row }: Row<typeof schema.stayAnalyses>): StayAnalysis => ({
  ...row,
  pros: list(prosJson),
  cons: list(consJson),
});

export function toSelection(row: Row<typeof schema.selections>): Selection {
  const { id, tripId, destinationId, reason, createdAt } = row;
  if (row.kind === "transport") {
    return {
      id, tripId, destinationId, reason, createdAt,
      kind: "transport",
      guestId: row.guestId!,
      transportOptionId: row.transportOptionId!,
    };
  }
  return { id, tripId, destinationId, reason, createdAt, kind: "stay", stayOptionId: row.stayOptionId! };
}

export const toJob = ({ payloadJson, progressJson, ...row }: Row<typeof schema.jobs>): Job => ({
  ...row,
  payload: JSON.parse(payloadJson) as unknown,
  progress: progressJson ? (JSON.parse(progressJson) as JobProgress) : null,
});

/** A stored summary, its snapshot parsed but not yet checked: the service checks its shape. */
export const toSummary = ({ snapshotJson, ...row }: Row<typeof schema.summaries>): Summary => ({
  ...row,
  snapshot: JSON.parse(snapshotJson),
});
