import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { GuestPatchSchema } from "@/server/schemas";
import { deleteGuest, updateGuest } from "@/server/services/guests";

/** PATCH /api/guests/:guestId: changes some fields of a guest. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/guests/[guestId]">) {
  const { guestId } = await ctx.params;
  const parsed = await parseBody(request, GuestPatchSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(await updateGuest(db, guestId, parsed.data));
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/guests/:guestId: removes the guest. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/guests/[guestId]">) {
  const { guestId } = await ctx.params;
  try {
    return Response.json(deleteGuest(db, guestId));
  } catch (error) {
    return errorResponse(error);
  }
}
