import { db } from "@/db/client";
import { errorResponse } from "@/server/http";
import { getProgress } from "@/server/services/compute";

/** GET /api/trips/:tripId/progress: how the latest computation is going, step by step. */
export async function GET(_request: Request, ctx: RouteContext<"/api/trips/[tripId]/progress">) {
  const { tripId } = await ctx.params;
  try {
    return Response.json(getProgress(db, tripId));
  } catch (error) {
    return errorResponse(error);
  }
}
