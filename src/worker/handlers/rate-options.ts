import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import {
  checkRatings,
  OptionRatingsAnswerSchema,
  stayRatingPrompt,
  transportRatingPrompt,
  type StayRatingFacts,
  type TransportRatingFacts,
} from "@/ai/option-ratings";
import { ratings as config } from "@/config";
import type { RatingKind } from "@/core/types";
import { ratingInputOf, type RatingInput } from "@/server/services/ratingInputs";
import { ratingRunOf, storeRatings, type RatingToStore } from "@/server/services/ratings";
import { parsePayload, RateOptionsPayloadSchema } from "../payloads";
import { defaultRetryPolicy } from "../queue";
import type { JobHandler } from "../types";

/** Why the AI could not rate, in words for the person who will read "not rated by the AI". */
function whyNot(error: unknown): string {
  if (error instanceof ClaudeUnavailableError) return error.message;
  return `The AI did not answer properly: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}`;
}

/**
 * rate_stays / rate_transport: asks the AI to rate every accommodation (or every journey) of one
 * destination against the others and the group's budgets, and keeps the ratings with the fingerprint of
 * what it was shown. This is the only place the dashboard's scores come from, and it runs while the
 * trip is set up: afterwards the dashboard only reads them.
 *
 * - What was already rated by the AI for exactly these facts is not asked again (the cache).
 * - When the AI cannot be used (no CLI, not logged in), or has failed on its last try, the rules
 *   rate instead and the ratings say so: "not rated by the AI". Setting up the trip never waits for
 *   an AI that is not there.
 * - A timeout or an answer that does not hold up is tried again by the queue first.
 */
export const createRateOptionsHandler =
  (kind: RatingKind, ask: AskFn): JobHandler =>
  async (job, { db }) => {
    const { destinationId } = parsePayload(RateOptionsPayloadSchema, job.payload);
    const input = ratingInputOf(db, destinationId, kind);
    if (!input) return;

    const kept = ratingRunOf(db, destinationId, kind);
    if (kept?.source === "ai" && kept.inputHash === input.hash) return;

    const byRules = (message: string) => {
      const ratings = new Map<string, RatingToStore>([...input.rules].map(([id, rule]) => [id, { ...rule, source: "rules" }]));
      storeRatings(db, input, ratings, { source: "rules", message });
    };

    try {
      const prompt = kind === "stays" ? stayRatingPrompt((input as RatingInput<StayRatingFacts>).facts) : transportRatingPrompt((input as RatingInput<TransportRatingFacts>).facts);
      const answer = await ask(prompt, OptionRatingsAnswerSchema, { timeoutMs: config.timeoutMs });
      const given = checkRatings(answer, input.codes);

      // What the AI was not shown (the least promising, beyond the cap) is rated by the rules, and says so
      const ratings = new Map<string, RatingToStore>();
      for (const [id, rule] of input.rules) {
        const rating = given.get(id);
        ratings.set(id, rating ? { ...rating, source: "ai" } : { ...rule, source: "rules" });
      }
      storeRatings(db, input, ratings, { source: "ai", message: null });
    } catch (error) {
      const finalAttempt = job.attempts > defaultRetryPolicy.maxRetries;
      if (error instanceof ClaudeUnavailableError || finalAttempt) return byRules(whyNot(error));
      throw error;
    }
  };
