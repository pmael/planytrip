import { vi } from "vitest";
import { checkSynthesis, type Facts, type Synthesis } from "@/ai/destination-synthesis";
import type { AskFn } from "@/ai/claude";
import type { StayAnalysisAnswer } from "@/ai/stay-analysis";

/** An answer that is valid for these facts: picks `pick` (the first destination by default) and judges everything. */
export function answerFor(facts: Facts, pick: string = facts.destinations[0].id): Synthesis {
  return {
    pickDestinationId: pick,
    confidence: "medium",
    headline: "Go where everyone can afford to go",
    reasoning: "It is the only one that works for everybody.",
    destinations: facts.destinations.map((d, index) => ({
      destinationId: d.id,
      verdict: d.id === pick ? "good" : "ok",
      score: 80 - index * 10,
      summary: `${d.name} in one sentence.`,
      strengths: ["Cheap"],
      concerns: [],
    })),
    tradeoffs: ["A bigger budget for Jessy would open up Mont-Saxonnex."],
    guests: facts.guests.map((g) => ({ guestId: g.id, note: `${g.name} is fine with it.` })),
  };
}

/** A fake `ask` that gives the answers it is handed, in turn, and counts how often it is asked. */
export function fakeAsk(...answers: (Synthesis | Error | ((prompt: string) => Synthesis))[]) {
  const ask = vi.fn(async (prompt: string) => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(prompt) : next;
  });
  return ask as unknown as AskFn & typeof ask;
}

export { checkSynthesis };

/** An answer about one accommodation that is valid for the schema. */
export function stayAnswer(overrides: Partial<StayAnalysisAnswer> = {}): StayAnalysisAnswer {
  return {
    verdict: "ok",
    fitScore: 66,
    pros: ["Sleeps all three"],
    cons: ["Takes 75 % of Jessy's budget"],
    summary: "A workable apartment, tight for Jessy.",
    ...overrides,
  };
}

/** A fake `ask` for the stay analysis: hands out the answers in turn (the last one repeats). */
export function fakeStayAsk(...answers: (StayAnalysisAnswer | Error)[]) {
  return fakeAsk(...(answers as never[]));
}
