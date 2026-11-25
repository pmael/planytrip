import { db } from "@/db/client";
import { errorResponse, validationError } from "@/server/http";
import { TransportsQuerySchema } from "@/server/schemas";
import { getDestinationTransports } from "@/server/services/transports";

/**
 * GET /api/destinations/:destinationId/transports?guest=&mode=&sort=&includeRed=: how one guest can get
 * there, a column per mode with its Cheapest and Most Practical options and the rest under `more`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/transports">) {
  const { destinationId } = await ctx.params;
  const query = TransportsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  try {
    const { guest, mode, sort, includeRed } = query.data;
    return Response.json(getDestinationTransports(db, destinationId, { guestId: guest, mode, sort, includeRed }));
  } catch (error) {
    return errorResponse(error);
  }
}
