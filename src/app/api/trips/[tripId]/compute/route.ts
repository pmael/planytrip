import { db } from "@/db/client";
import { errorResponse, validationError } from "@/server/http";
import { ComputeQuerySchema } from "@/server/schemas";
import { startCompute } from "@/server/services/compute";

/**
 * POST /api/trips/:tripId/compute?force=0|1&rerate=0|1&retry=0|1: starts working out the trip's options (`rerate`: only the
 * ratings, from what is stored; `retry`: only the searches that failed last time). The worker does the work: this only answers with the job to follow. 409 when there is nothing to compute yet.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/compute">) {
  const { tripId } = await ctx.params;
  const query = ComputeQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  try {
    return Response.json(startCompute(db, tripId, { force: query.data.force, rerate: query.data.rerate, retry: query.data.retry }), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
