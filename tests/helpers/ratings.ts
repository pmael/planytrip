import { vi } from "vitest";
import type { AskFn } from "@/ai/claude";
import type { GivenRating } from "@/ai/option-ratings";

/**
 * A fake AI for the rating prompts: it reads the candidate codes out of the facts in the prompt and
 * rates every one of them, `good` and 80 down by default. `rate` changes what it says for a code.
 * `skipLast` makes it leave the last candidate unrated, as a careless answer would.
 */
export function fakeRatingAsk(rate: (code: string, index: number) => Partial<GivenRating> = () => ({}), { skipLast = false } = {}) {
  const ask = vi.fn(async (prompt: string) => {
    const codes = [...prompt.matchAll(/"code": "([ST]\d+)"/g)].map((match) => match[1]);
    const rated = skipLast && codes.length > 1 ? codes.slice(0, -1) : codes;
    return {
      ratings: rated.map((code, index) => ({ code, verdict: "good" as const, score: 80 - index, reason: `The AI rated ${code}`, ...rate(code, index) })),
    };
  });
  return ask as unknown as AskFn & typeof ask;
}

/** A fake AI that fails every time with the given error. */
export function failingAsk(error: Error) {
  const ask = vi.fn(async () => {
    throw error;
  });
  return ask as unknown as AskFn & typeof ask;
}
