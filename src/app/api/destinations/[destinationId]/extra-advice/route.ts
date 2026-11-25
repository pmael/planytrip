import { db } from "@/db/client";
import { errorResponse } from "@/server/http";
import { askExtraAdvice, extraAdviceStatus } from "@/server/services/extraAdvice";

/** GET /api/destinations/:destinationId/extra-advice: whether the advice on the Extra exists, is being written, or may be out of date. Asks for nothing. */
export async function GET(_request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/extra-advice">) {
  const { destinationId } = await ctx.params;
  try {
    return Response.json(extraAdviceStatus(db, destinationId));
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/destinations/:destinationId/extra-advice: "Ask again". The worker writes it anew for the trip as it is now (the AI, or the rules without it). */
export async function POST(_request: Request, ctx: RouteContext<"/api/destinations/[destinationId]/extra-advice">) {
  const { destinationId } = await ctx.params;
  try {
    return Response.json(askExtraAdvice(db, destinationId), { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
