import { db } from "@/db/client";
import { errorResponse, parseBody } from "@/server/http";
import { StayAnalysisRequestSchema } from "@/server/schemas";
import { getOrRequestStayAnalysis } from "@/server/services/stays";

/**
 * GET /api/stays/:stayId/analysis: the AI's advice on an accommodation. Without any yet it asks for
 * it: answer `pending` and ask again in a moment; `unavailable` when the AI cannot help right now.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/stays/[stayId]/analysis">) {
  const { stayId } = await ctx.params;
  try {
    return Response.json(getOrRequestStayAnalysis(db, stayId));
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/stays/:stayId/analysis { refresh: true }: asks again for the advice, when the offer or the
 * group changed since it was written. Answers like GET: the previous advice stays in `previous` while
 * the new one is on its way. Without a change there is nothing to ask again about.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/stays/[stayId]/analysis">) {
  const { stayId } = await ctx.params;
  const parsed = await parseBody(request, StayAnalysisRequestSchema);
  if ("response" in parsed) return parsed.response;

  try {
    return Response.json(getOrRequestStayAnalysis(db, stayId, { refresh: parsed.data.refresh }));
  } catch (error) {
    return errorResponse(error);
  }
}
