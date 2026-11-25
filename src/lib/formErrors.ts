// Turns what the API and the schemas report into one message per form field.

/** Error message per form field name; `_form` is for the whole form. */
export type FieldErrors = Record<string, string>;

/** One problem as the API or a zod issue describes it. */
export type ApiFieldError = { field: string; message: string };

export const DATES_ORDER_MESSAGE = "The end date can't be before the start date";

/**
 * `fieldOf` says which form field an API field belongs to, `messages` is what to show for each form
 * field, and `keepServerMessage` lets a precise server message through (e.g. "No city found for …").
 * The first problem of a field wins.
 */
export function mapApiErrors(
  apiErrors: ApiFieldError[],
  rules: {
    fieldOf: Record<string, string>;
    messages: Record<string, string>;
    keepServerMessage?: (error: ApiFieldError) => boolean;
  },
): FieldErrors {
  const errors: FieldErrors = {};
  for (const error of apiErrors) {
    const formField = rules.fieldOf[error.field] ?? "_form";
    if (errors[formField]) continue;
    errors[formField] =
      error.message.includes("must not be before") || error.message.includes("can't be before")
        ? DATES_ORDER_MESSAGE
        : rules.keepServerMessage?.(error)
          ? error.message
          : (rules.messages[formField] ?? error.message);
  }
  return errors;
}

/** The problems listed in the body of a 400 answer ({ fieldErrors: { homeQuery: ["..."] } }). */
export function apiErrorsOf(body: { fieldErrors?: Record<string, string[]> }): ApiFieldError[] {
  return Object.entries(body.fieldErrors ?? {}).flatMap(([field, messages]) =>
    messages.map((message) => ({ field, message })),
  );
}
