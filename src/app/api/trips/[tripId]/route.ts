import { db } from "@/db/client";
import { notFound, parseBody } from "@/server/http";
import { TripUpdateSchema } from "@/server/schemas";
import { getTrip, updateTrip } from "@/server/services/trips";

/** GET /api/trips/:tripId: the trip with its guests, destinations and common window. */
export async function GET(_request: Request, ctx: RouteContext<"/api/trips/[tripId]">) {
  const { tripId } = await ctx.params;
  const trip = getTrip(db, tripId);
  return trip ? Response.json(trip) : notFound("Trip not found");
}

/** PATCH /api/trips/:tripId: rename the trip or set its number of nights. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/trips/[tripId]">) {
  const { tripId } = await ctx.params;
  const parsed = await parseBody(request, TripUpdateSchema);
  if ("response" in parsed) return parsed.response;

  const trip = updateTrip(db, tripId, parsed.data);
  return trip ? Response.json(trip) : notFound("Trip not found");
}
