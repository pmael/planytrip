import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { SynthesisRequestSchema } from "@/server/schemas";
import { getSynthesisState, requestSynthesis } from "@/server/services/synthesis";

/** GET /api/trips/:tripId/synthesis: where the AI's take on the destinations stands (none, pending, ready, unavailable). Asks for nothing. */
export async function GET(_request: Request, ctx: RouteContext<"/api/trips/[tripId]/synthesis">) {
  const { tripId } = await ctx.params;
  try {
    return Response.json(getSynthesisState(db, tripId));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/trips/:tripId/synthesis: asks the worker for it when nobody has yet. With `refresh: true`
 * it asks again for the trip as it is now, and tries again after a failure.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/synthesis">) {
  const { tripId } = await ctx.params;
  const parsed = await parseBody(request, SynthesisRequestSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(requestSynthesis(db, tripId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
