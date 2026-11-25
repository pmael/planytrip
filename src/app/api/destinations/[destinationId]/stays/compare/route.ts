import { db } from "@/db/client";
import { errorResponse, validationError } from "@/server/http";
import { StayCompareQuerySchema } from "@/server/schemas";
import { compareStays } from "@/server/services/stays";

/** GET /api/destinations/:destinationId/stays/compare?ids=a,b,c: 2 or 3 offers side by side, with what each would do to every guest's budget. */
export async function GET(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/stays/compare">) {
  const { destinationId } = await ctx.params;
  const query = StayCompareQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return validationError(query.error);

  try {
    return Response.json(compareStays(db, destinationId, query.data.ids));
  } catch (error) {
    return errorResponse(error);
  }
}
