// Small helpers shared by the route handlers, so each one stays a few lines long.
import { z } from "zod";
import { GeocoderUnavailableError } from "@/geo/geocode";
import { ConflictError, FieldError, NotFoundError } from "./errors";

/** 400 with the fields that failed, in a shape the UI can show next to its inputs. */
export function validationError(error: z.ZodError): Response {
  return Response.json({ error: "validation", ...z.flattenError(error) }, { status: 400 });
}

export const notFound = (what = "Not found") => Response.json({ error: what }, { status: 404 });

/** A request from this app's own pages: not from another site, which could otherwise act behind the person's back. */
export function fromThisApp(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || new URL(origin).host === request.headers.get("host");
}

/**
 * Reads the JSON body and validates it. An empty body counts as `{}` so a POST with nothing to say
 * works. Returns the parsed data, or the 400 response to send back.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.output<T> } | { response: Response }> {
  const text = await request.text();
  let body: unknown = {};
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return { response: Response.json({ error: "Invalid JSON" }, { status: 400 }) };
    }
  }

  const result = schema.safeParse(body);
  return result.success ? { data: result.data } : { response: validationError(result.error) };
}

/** Turns the errors services throw on purpose into their HTTP answer; anything else is a real bug and is rethrown. */
export function errorResponse(error: unknown): Response {
  if (error instanceof NotFoundError) return notFound(error.message);
  if (error instanceof ConflictError) {
    return Response.json({ error: "conflict", reason: error.reason, message: error.message }, { status: 409 });
  }
  if (error instanceof FieldError) {
    return Response.json(
      { error: "validation", formErrors: [], fieldErrors: { [error.field]: [error.message] } },
      { status: 400 },
    );
  }
  if (error instanceof GeocoderUnavailableError) {
    return Response.json({ error: "geocoder_unavailable" }, { status: 502 });
  }
  throw error;
}
