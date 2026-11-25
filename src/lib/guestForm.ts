// What the "Add a guest" popup sends, and the messages shown when it is wrong (use-cases.md A-S1).
// The schema is the one the server uses, so the form and the API can never disagree.
import { GuestInputSchema, type GuestInput } from "@/server/schemas";
import { field } from "./form";
import { apiErrorsOf, mapApiErrors, type FieldErrors } from "./formErrors";

export type { FieldErrors };

const RULES = {
  fieldOf: {
    name: "name",
    homeQuery: "home",
    homePlace: "home",
    maxBudgetEur: "budget",
    availableFrom: "availabilities",
    availableTo: "availabilities",
    preferredMode: "transport",
  },
  messages: {
    name: "Enter the guest's name",
    home: "Choose a city from the suggestions",
    budget: "Enter a budget above 0",
    availabilities: "Pick a start date and an end date",
    transport: "Choose a means of transportation",
  },
  keepServerMessage: ({ field, message }: { field: string; message: string }) =>
    field === "homeQuery" && message.startsWith("No city found"),
};

/** What the form holds, in the shape of the API input (not yet validated). */
export function guestPayload(form: FormData): unknown {
  let homePlace: unknown;
  try {
    const json = field(form, "homePlace");
    homePlace = json ? JSON.parse(json) : undefined;
  } catch {
    homePlace = undefined;
  }
  const home = field(form, "home");
  const budget = field(form, "budget").replace(/\D/g, "");

  return {
    name: field(form, "name"),
    // A city picked from the suggestions wins, otherwise the server geocodes what was typed
    ...(homePlace ? { homePlace } : home ? { homeQuery: home } : {}),
    maxBudgetEur: budget ? Number(budget) : undefined,
    availableFrom: field(form, "availabilitiesFrom") || undefined,
    availableTo: field(form, "availabilitiesTo") || undefined,
    preferredMode: field(form, "transport") || undefined,
  };
}

/** Checks the popup's values before they are sent. */
export function validateGuestForm(form: FormData): { input: GuestInput } | { errors: FieldErrors } {
  const payload = guestPayload(form) as Record<string, unknown>;
  const result = GuestInputSchema.safeParse(payload);
  if (result.success) return { input: result.data };

  const errors = mapApiErrors(
    result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? ""), message: issue.message })),
    RULES,
  );
  // The schema only checks "a city or a place" once every other field is valid, so say it right away
  if (!payload.homePlace && !payload.homeQuery) errors.home ??= RULES.messages.home;
  return { errors };
}

/** Turns the body of a 400 answer into form errors. */
export function errorsFromResponse(body: { fieldErrors?: Record<string, string[]> }): FieldErrors {
  return mapApiErrors(apiErrorsOf(body), RULES);
}
