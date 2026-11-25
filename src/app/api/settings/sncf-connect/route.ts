import { connection } from "next/server";
import { readAppSettings, writeAppSettings } from "@/server/appSettings";
import { chromeDebuggingOn } from "@/server/chromeDebugging";
import { fromThisApp, parseBody } from "@/server/http";
import { SncfConnectSettingSchema } from "@/server/schemas";

const view = (enabled: boolean) => ({ enabled, chromeReady: chromeDebuggingOn() });

/**
 * GET /api/settings/sncf-connect: whether SNCF Connect's own prices are read through Chrome, and whether Chrome has remote
 * debugging on right now. Read at request time: the file and Chrome change behind the page's back.
 */
export async function GET() {
  await connection();
  return Response.json(view(readAppSettings().sncfConnect));
}

/** PUT /api/settings/sncf-connect {enabled}: turns it on or off. It counts from the next search; nothing already found changes. */
export async function PUT(request: Request) {
  if (!fromThisApp(request)) return Response.json({ error: "Request refused" }, { status: 403 });
  const parsed = await parseBody(request, SncfConnectSettingSchema);
  if ("response" in parsed) return parsed.response;
  return Response.json(view(writeAppSettings({ sncfConnect: parsed.data.enabled }).sncfConnect));
}
