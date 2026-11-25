import { db } from "@/db/client";
import { PriceObservationsBodySchema } from "@/server/schemas";
import { defaultImportDeps, ImportRefusedError, importPriceObservations } from "@/server/services/priceObservations";

/** Only the extension, from this machine: the origin of a browser extension, and a local address (a page on the web cannot be the one asking). */
function refusal(request: Request): Response | null {
  const origin = request.headers.get("origin") ?? "";
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
  if (!origin.startsWith("chrome-extension://") || !["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    return Response.json({ error: "Requête refusée : seule l'extension Trip Manager, depuis cette machine, peut envoyer des prix" }, { status: 403 });
  }
  return null;
}

/**
 * POST /api/price-observations: the trains and prices the browser extension read on the person's own SNCF Connect, Eurostar or Iryo tab. They
 * are kept, matched with the trains the app found, and compared with what it had estimated. 400 (with a message in French,
 * which the extension shows) when the page was not read well enough; 403 for any caller but the extension.
 */
export async function POST(request: Request) {
  const refused = refusal(request);
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Le contenu envoyé n'est pas du JSON" }, { status: 400 });
  }
  const parsed = PriceObservationsBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Les données envoyées sont invalides", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) }, { status: 400 });
  }

  try {
    return Response.json(await importPriceObservations(db, parsed.data, defaultImportDeps(db)));
  } catch (error) {
    if (error instanceof ImportRefusedError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
