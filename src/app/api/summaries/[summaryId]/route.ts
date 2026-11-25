import { db } from "@/db/client";
import { notFound } from "@/server/http";
import { deleteSummary, getSummary } from "@/server/services/summaries";

/** GET /api/summaries/:summaryId: the summary as it was frozen, with the prices that have moved since. */
export async function GET(_request: Request, ctx: RouteContext<"/api/summaries/[summaryId]">) {
  const { summaryId } = await ctx.params;
  const summary = getSummary(db, summaryId);
  return summary ? Response.json(summary) : notFound("Summary not found");
}

/** DELETE /api/summaries/:summaryId: takes the decision back. A trip with no summary left is ready again. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/summaries/[summaryId]">) {
  const { summaryId } = await ctx.params;
  const result = deleteSummary(db, summaryId);
  return result ? Response.json(result) : notFound("Summary not found");
}
