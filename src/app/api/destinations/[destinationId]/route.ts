import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { DestinationPatchSchema } from "@/server/schemas";
import { deleteDestination, updateDestination } from "@/server/services/destinations";

/** PATCH /api/destinations/:destinationId: changes some fields of a destination. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]">) {
  const { destinationId } = await ctx.params;
  const parsed = await parseBody(request, DestinationPatchSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(await updateDestination(db, destinationId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/destinations/:destinationId: removes the destination. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/destinations/[destinationId]">) {
  const { destinationId } = await ctx.params;
  try {
    deleteDestination(db, destinationId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
