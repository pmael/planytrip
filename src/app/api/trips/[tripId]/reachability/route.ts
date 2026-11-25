import { db } from "@/db/client";
import { errorResponse } from "@/server/http";
import { checkReachability } from "@/server/services/reachability";

/** POST /api/trips/:tripId/reachability: checks who can get where, and returns the guest × destination matrix. */
export async function POST(_request: Request, ctx: RouteContext<"/api/trips/[tripId]/reachability">) {
  const { tripId } = await ctx.params;
  try {
    return Response.json(await checkReachability(db, tripId));
  } catch (error) {
    return errorResponse(error);
  }
}
