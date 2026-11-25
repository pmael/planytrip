import { db } from "@/db/client";
import { notFound, validationError } from "@/server/http";
import { BudgetQuerySchema } from "@/server/schemas";
import { getBudgetView } from "@/server/services/dashboard";

/**
 * GET /api/trips/:tripId/budget?show=dates,housing,transports&guest=: the destinations side by side, the
 * recommendation with its reasons, and every guest's own view of each card. `guest` says whose view
 * the page opens on; it only changes the display, never the figures (C-S4).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/trips/[tripId]/budget">) {
  const { tripId } = await ctx.params;
  const query = BudgetQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  const view = getBudgetView(db, tripId, { show: query.data.show, guestId: query.data.guest });
  return view ? Response.json(view) : notFound("Trip not found");
}
