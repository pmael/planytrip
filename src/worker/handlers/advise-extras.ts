import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { checkExtraAdvice, ExtraAdviceAnswerSchema, extraAdvicePrompt } from "@/ai/extra-advice";
import { ratings as config } from "@/config";
import { adviceFrom, adviceInputOf, keptExtraAdvice, rulesAdvice, storeExtraAdvice } from "@/server/services/extraAdvice";
import { AdviseExtrasPayloadSchema, parsePayload } from "../payloads";
import { defaultRetryPolicy } from "../queue";
import type { JobHandler } from "../types";

/** Why the AI could not advise, in words for the person who will read "rule-based" */
function whyNot(error: unknown): string {
  if (error instanceof ClaudeUnavailableError) return error.message;
  return `the AI did not answer properly: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`;
}

/**
 * advise_extras: the advice on fitting a destination's Extra into the budgets (task.md T8.8, use-cases.md R12), asked of
 * the AI once while the trip is set up (and on "Ask again"), and kept with the fingerprint of what it was written for.
 * - What the AI already wrote for exactly these facts is not asked again.
 * - Its lines are checked: a lever it was not given, more steps than there are, or an amount of its own, and the line is
 *   dropped; the euros are always the app's.
 * - Without the AI (or failing on its last try), the rules advise each guest over budget, said to be rule-based.
 */
export const createAdviseExtrasHandler =
  (ask: AskFn): JobHandler =>
  async (job, { db }) => {
    const { destinationId } = parsePayload(AdviseExtrasPayloadSchema, job.payload);
    const advice = adviceInputOf(db, job.tripId, destinationId);
    if (!advice) return;
    const kept = keptExtraAdvice(db, destinationId);
    if (kept?.source === "ai" && kept.inputHash === advice.hash) return;

    try {
      const answer = await ask(extraAdvicePrompt(advice.facts), ExtraAdviceAnswerSchema, { timeoutMs: config.timeoutMs });
      const checked = checkExtraAdvice(answer, advice.facts);
      const message = checked.dropped > 0 ? `${checked.dropped} line${checked.dropped > 1 ? "s" : ""} of the AI's answer ${checked.dropped > 1 ? "were" : "was"} not kept (a lever it was not given, too many steps, or an amount of its own)` : null;
      storeExtraAdvice(db, destinationId, { advice: adviceFrom(advice, checked), source: "ai", hash: advice.hash, message });
    } catch (error) {
      const finalAttempt = job.attempts > defaultRetryPolicy.maxRetries;
      if (error instanceof ClaudeUnavailableError || finalAttempt) {
        return storeExtraAdvice(db, destinationId, { advice: rulesAdvice(advice), source: "rules", hash: advice.hash, message: `Not written by the AI (${whyNot(error).replace(/\.$/, "")})` });
      }
      throw error;
    }
  };
