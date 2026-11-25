// What the "Add a destination" popup sends, and the messages shown when it is wrong.
import { DestinationInputSchema, type DestinationInput } from "@/server/schemas";
import { field } from "./form";
import { apiErrorsOf, mapApiErrors, type FieldErrors } from "./formErrors";

const RULES = {
  fieldOf: {
    query: "place",
    place: "place",
    budgetLevel: "budget",
    objective: "objective",
    dateFrom: "dates",
    dateTo: "dates",
  },
  messages: {
    place: "Choose a destination from the suggestions",
    budget: "Choose a type of budget",
    objective: "Choose an objective",
    dates: "Check the dates",
  },
  // "No place found for …" and "… is already in the list" say more than a generic message
  keepServerMessage: ({ field, message }: { field: string; message: string }) =>
    field === "query" && (message.startsWith("No place found") || message.includes("already in the list")),
};

/** What the form holds, in the shape of the API input (not yet validated). */
export function destinationPayload(form: FormData): unknown {
  let place: unknown;
  try {
    const json = field(form, "placePlace");
    place = json ? JSON.parse(json) : undefined;
  } catch {
    place = undefined;
  }
  const typed = field(form, "place");

  return {
    ...(place ? { place } : typed ? { query: typed } : {}),
    budgetLevel: field(form, "budget") || undefined,
    objective: field(form, "objective") || undefined,
    dateFrom: field(form, "datesFrom") || undefined,
    dateTo: field(form, "datesTo") || undefined,
  };
}

export function validateDestinationForm(form: FormData): { input: DestinationInput } | { errors: FieldErrors } {
  const payload = destinationPayload(form) as Record<string, unknown>;
  const result = DestinationInputSchema.safeParse(payload);
  if (result.success) return { input: result.data };

  const errors = mapApiErrors(
    result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ""), message: issue.message })),
    RULES,
  );
  if (!payload.place && !payload.query) errors.place ??= RULES.messages.place;
  return { errors };
}

export function destinationErrorsFromResponse(body: { fieldErrors?: Record<string, string[]> }): FieldErrors {
  return mapApiErrors(apiErrorsOf(body), RULES);
}
