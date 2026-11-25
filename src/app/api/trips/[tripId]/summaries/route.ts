import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { SummaryCreateSchema } from "@/server/schemas";
import { validateDestination } from "@/server/services/summaries";

/**
 * POST /api/trips/:tripId/summaries { destinationId }: validates a destination. Freezes its scenario
 * as a summary and marks the trip validated. 409 when the trip has not been worked out yet.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/summaries">) {
  const { tripId } = await ctx.params;
  const parsed = await parseBody(request, SummaryCreateSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(validateDestination(db, tripId, parsed.data.destinationId), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
