import { db } from "@/db/client";
import { parseBody } from "@/server/http";
import { TripCreateSchema } from "@/server/schemas";
import { createTrip } from "@/server/services/trips";

/** POST /api/trips: starts a draft trip. */
export async function POST(request: Request) {
  const parsed = await parseBody(request, TripCreateSchema);
  if ("response" in parsed) return parsed.response;

  return Response.json(createTrip(db, parsed.data), { status: 201 });
}
