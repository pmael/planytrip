import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { GuestModesSchema } from "@/server/schemas";
import { setGuestModes } from "@/server/services/guests";

/** PUT /api/guests/:guestId/modes: sets the accepted modes (the preferred one always stays) and returns who can get where. */
export async function PUT(request: Request, ctx: RouteContext<"/api/guests/[guestId]/modes">) {
  const { guestId } = await ctx.params;
  const parsed = await parseBody(request, GuestModesSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(await setGuestModes(db, guestId, parsed.data.modes));
  } catch (error) {
    return errorResponse(error);
  }
}
