import { db } from "@/db/client";
import { GeocoderUnavailableError } from "@/geo/geocode";
import { validationError } from "@/server/http";
import { GeoSearchQuerySchema } from "@/server/schemas";
import { searchPlaces } from "@/server/services/geo";

/** GET /api/geo/search?q=: places matching the text, for the city fields. */
export async function GET(request: Request) {
  const parsed = GeoSearchQuerySchema.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return validationError(parsed.error);

  try {
    return Response.json(await searchPlaces(db, parsed.data.q));
  } catch (error) {
    if (error instanceof GeocoderUnavailableError) {
      return Response.json({ error: "geocoder_unavailable" }, { status: 502 });
    }
    throw error;
  }
}
