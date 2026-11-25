import type { BudgetDelta } from "@/core/types";

/** "Jessy +70 €" → "This choice puts Jessy 70 € over budget" (use-cases.md B.1 step 6, B-S9). */
export const overBudgetMessage = (warnings: string[]) =>
  `This choice puts ${warnings.map((warning) => warning.replace(" +", " ")).join(", ")} over budget`;

/**
 * Saves a ❤ (`PUT`) or takes it off (`DELETE`) and says what that does to everyone's budget.
 * Throws when the server refuses, so the caller can put things back as they were.
 */
export async function sendSelection(destinationId: string, method: "PUT" | "DELETE", body: object): Promise<BudgetDelta> {
  const response = await fetch(`/api/destinations/${destinationId}/selections`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Selections answered ${response.status}`);
  return (await response.json()).budget;
}
