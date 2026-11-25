import { z } from "zod";
import { TransportModeSchema } from "@/server/schemas";
import { PermanentJobError } from "./queue";

/**
 * compute_trip: `force` searches everything again, even what is already stored; `retryFailed` searches
 * again only what failed the last time (and whatever is still missing).
 */
export const ComputePayloadSchema = z.object({ force: z.boolean().default(false), retryFailed: z.boolean().default(false) });

/** Where a search job comes from, so that progress can be told per computation. */
const parent = z.string().min(1);

/** search_transport: `force` asks the site again even when what it said is still kept. */
export const SearchTransportPayloadSchema = z.object({
  parent,
  destinationId: z.string().min(1),
  originKey: z.string().min(1),
  mode: TransportModeSchema,
  force: z.boolean().default(false),
});

/** search_stays: `force` asks the site again even when what it said is still kept. */
export const SearchStaysPayloadSchema = z.object({ parent, destinationId: z.string().min(1), force: z.boolean().default(false) });

/** survey_places: whose stays to look around; `force` asks OpenStreetMap again even when the area's answer is kept. */
export const SurveyPlacesPayloadSchema = z.object({ parent, destinationId: z.string().min(1), force: z.boolean().default(false) });

/** price_destination: whose local prices and things to do the AI is asked for. */
export const PriceDestinationPayloadSchema = z.object({ parent, destinationId: z.string().min(1) });

/** rate_stays / rate_transport: which destination's options the AI is asked to rate. */
export const RateOptionsPayloadSchema = z.object({ parent, destinationId: z.string().min(1) });

/** advise_extras: whose Extra the AI is asked to advise on; `parent` when a computation queued it, none for "Ask again". */
export const AdviseExtrasPayloadSchema = z.object({ parent: z.string().optional(), destinationId: z.string().min(1) });

/** analyze_stay: which accommodation the AI is asked about. */
export const AnalyzeStayPayloadSchema = z.object({ stayId: z.string().min(1) });

/** Reads a job's payload. One that is wrong will not get better by trying again. */
export function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.output<T> {
  const result = schema.safeParse(payload);
  if (!result.success) throw new PermanentJobError(`Invalid job payload: ${z.prettifyError(result.error)}`);
  return result.data;
}
