import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { SelectionClearSchema, SelectionInputSchema } from "@/server/schemas";
import { clearSelection, setSelection } from "@/server/services/selections";

/** PUT /api/destinations/:destinationId/selections: puts a ❤ on an option and says what it does to everyone's budget. */
export async function PUT(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/selections">) {
  const { destinationId } = await ctx.params;
  const parsed = await parseBody(request, SelectionInputSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(setSelection(db, destinationId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/destinations/:destinationId/selections: takes a ❤ off. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/selections">) {
  const { destinationId } = await ctx.params;
  const parsed = await parseBody(request, SelectionClearSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(clearSelection(db, destinationId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}
