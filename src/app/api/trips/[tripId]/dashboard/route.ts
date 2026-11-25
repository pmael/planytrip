import { db } from "@/db/client";
import { notFound, validationError } from "@/server/http";
import { DashboardQuerySchema } from "@/server/schemas";
import { getDashboard } from "@/server/services/dashboard";

/** GET /api/trips/:tripId/dashboard?dest=: the dashboard home for a destination (the recommended one by default). */
export async function GET(request: Request, ctx: RouteContext<"/api/trips/[tripId]/dashboard">) {
  const { tripId } = await ctx.params;
  const query = DashboardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  const view = getDashboard(db, tripId, query.data.dest);
  return view ? Response.json(view) : notFound("Trip not found");
}
