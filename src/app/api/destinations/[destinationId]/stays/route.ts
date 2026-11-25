import { db } from "@/db/client";
import { errorResponse, validationError } from "@/server/http";
import { StaysQuerySchema } from "@/server/schemas";
import { listStays } from "@/server/services/stays";

/** GET /api/destinations/:destinationId/stays?provider=&cursor=&limit=5: a page of the offers, best first. */
export async function GET(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/stays">) {
  const { destinationId } = await ctx.params;
  const query = StaysQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  try {
    return Response.json(listStays(db, destinationId, query.data));
  } catch (error) {
    return errorResponse(error);
  }
}
