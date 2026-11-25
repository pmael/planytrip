import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { FavoriteSchema } from "@/server/schemas";
import { setFavoriteDestination } from "@/server/services/guests";

/** PUT /api/guests/:guestId/favorite: puts the guest's ★ on a destination, or removes it with null. */
export async function PUT(request: Request, ctx: RouteContext<"/api/guests/[guestId]/favorite">) {
  const { guestId } = await ctx.params;
  const parsed = await parseBody(request, FavoriteSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(setFavoriteDestination(db, guestId, parsed.data.destinationId));
  } catch (error) {
    return errorResponse(error);
  }
}
