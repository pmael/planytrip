import { db } from "@/db/client";
import { notFound, validationError } from "@/server/http";
import { ExtraQuerySchema } from "@/server/schemas";
import { getExtraView } from "@/server/services/extraView";

/**
 * GET /api/trips/:tripId/extra?dest=&guest=: a destination's Extra line by line, each line with its detail, for everyone
 * or one guest, each guest's whole trip with it, and the advice (task.md T8.10). Asks for nothing.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/trips/[tripId]/extra">) {
  const { tripId } = await ctx.params;
  const query = ExtraQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  const view = getExtraView(db, tripId, { destinationId: query.data.dest, guestId: query.data.guest });
  return view ? Response.json(view) : notFound("Trip not found");
}
