import { db } from "@/db/client";
import { notFound } from "@/server/http";
import { PdfUnavailableError, renderSummaryPdf } from "@/server/services/summaryPdf";

/**
 * GET /api/summaries/:summaryId/pdf: the summary as a PDF, made by printing its own page with Chrome.
 * The page is always fetched from this app's own loopback address on the port it was reached on,
 * never from a host the request names. 503 when Chrome cannot be started.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/summaries/[summaryId]/pdf">) {
  const { summaryId } = await ctx.params;
  const reached = new URL(request.url);
  const baseUrl = `http://127.0.0.1:${reached.port || (reached.protocol === "https:" ? "443" : "80")}`;

  try {
    const result = await renderSummaryPdf(db, summaryId, { baseUrl });
    if (!result) return notFound("Summary not found");
    return new Response(new Uint8Array(result.pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${result.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof PdfUnavailableError) return Response.json({ error: "pdf_unavailable", message: error.message }, { status: 503 });
    throw error;
  }
}
