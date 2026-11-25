import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { DestinationInputSchema } from "@/server/schemas";
import { addDestination } from "@/server/services/destinations";

/** POST /api/trips/:tripId/destinations: adds a destination to compare. */
export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/destinations">) {
  const { tripId } = await ctx.params;
  const parsed = await parseBody(request, DestinationInputSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(await addDestination(db, tripId, parsed.data), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
