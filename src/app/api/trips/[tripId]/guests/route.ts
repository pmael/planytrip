import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { GuestInputSchema } from "@/server/schemas";
import { addGuest } from "@/server/services/guests";

/** POST /api/trips/:tripId/guests: adds a guest (A-S1) and returns the new common window (A-S2). */
export async function POST(request: Request, ctx: RouteContext<"/api/trips/[tripId]/guests">) {
  const { tripId } = await ctx.params;
  const parsed = await parseBody(request, GuestInputSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(await addGuest(db, tripId, parsed.data), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
