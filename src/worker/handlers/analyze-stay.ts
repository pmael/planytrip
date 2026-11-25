import { eq } from "drizzle-orm";
import { ClaudeUnavailableError, type AskFn } from "@/ai/claude";
import { StayAnalysisAnswerSchema, stayPromptFor, tidyStayAnswer } from "@/ai/stay-analysis";
import * as schema from "@/db/schema";
import { stayAnalysisInputOf } from "@/server/services/stayAnalysisInput";
import { AnalyzeStayPayloadSchema, parsePayload } from "../payloads";
import { PermanentJobError } from "../queue";
import type { JobHandler } from "../types";

/** One accommodation is a short question: less room than the whole trip's synthesis. */
const TIMEOUT_MS = 120_000;

/**
 * analyze_stay ("Why this?"): asks Claude to explain how well one accommodation suits the group, and
 * keeps the answer with the fingerprint of the facts it was written for. The score stays the one the
 * stay was rated while the trip was set up; only a stay nobody rated takes the AI's own. An answer
 * already kept for exactly these facts is not asked for again (the cache). Without the CLI there is
 * nothing to retry; a timeout or an answer that does not hold up is tried again by the queue.
 */
export const createAnalyzeStayHandler =
  (ask: AskFn): JobHandler =>
  async (job, { db }) => {
    const { stayId } = parsePayload(AnalyzeStayPayloadSchema, job.payload);
    const input = stayAnalysisInputOf(db, stayId);
    if (!input) throw new PermanentJobError("The accommodation, or its trip, no longer exists");

    const [kept] = db.select({ inputHash: schema.stayAnalyses.inputHash }).from(schema.stayAnalyses).where(eq(schema.stayAnalyses.stayId, stayId)).all();
    if (kept?.inputHash === input.inputHash) return;

    try {
      const answer = tidyStayAnswer(await ask(stayPromptFor(input.facts), StayAnalysisAnswerSchema, { timeoutMs: TIMEOUT_MS }));
      // A stay that was rated when the trip was set up keeps that score: this only explains it
      const columns = {
        verdict: input.rating?.verdict ?? answer.verdict,
        fitScore: input.rating?.score ?? answer.fitScore,
        prosJson: JSON.stringify(answer.pros),
        consJson: JSON.stringify(answer.cons),
        summary: answer.summary,
        inputHash: input.inputHash,
      };
      db.insert(schema.stayAnalyses)
        .values({ stayId, ...columns })
        .onConflictDoUpdate({ target: schema.stayAnalyses.stayId, set: { ...columns, createdAt: new Date().toISOString() } })
        .run();
    } catch (error) {
      if (error instanceof ClaudeUnavailableError) throw new PermanentJobError(error.message);
      throw error;
    }
  };
