import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { checkSynthesis, factsOf, inputHashOf, promptFor, SynthesisSchema } from "@/ai/destination-synthesis";
import { getDeliberationView } from "@/server/services/deliberation";
import { hasSynthesis, storeSynthesis } from "@/server/services/synthesis";
import { PermanentJobError } from "../queue";
import type { JobHandler } from "../types";

/** The AI is given a lot to read and writes a lot back: more room than a short question. */
const TIMEOUT_MS = 180_000;

/**
 * synthesize_destinations: asks Claude which destination it would pick for the trip as it stands
 * now, and keeps the answer for exactly those facts. Without the CLI there is nothing to retry; a
 * timeout or an answer that does not hold up is tried again by the queue.
 */
export const createSynthesizeHandler =
  (ask: AskFn): JobHandler =>
  async (job, { db }) => {
    const view = getDeliberationView(db, job.tripId);
    if (!view || view.kind !== "ready") throw new PermanentJobError("The trip has not been worked out yet");

    const facts = factsOf(view);
    const inputHash = inputHashOf(facts);
    if (hasSynthesis(db, job.tripId, inputHash)) return;

    try {
      const answer = await ask(promptFor(facts), SynthesisSchema, { timeoutMs: TIMEOUT_MS });
      storeSynthesis(db, job.tripId, inputHash, checkSynthesis(answer, facts));
    } catch (error) {
      if (error instanceof ClaudeUnavailableError) throw new PermanentJobError(error.message);
      throw error;
    }
  };
