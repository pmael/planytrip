// The AI's advice on fitting the Extra into the budgets (task.md T8.8, use-cases.md R12): for the group, and for each
// guest who is tight or over. It is given the levers the rules worked out, each with what it saves; it only chooses and
// words them. Every euro shown is the app's: a line that names another lever, more steps than there are, or an amount
// of its own is dropped.
import { createHash } from "node:crypto";
import { z } from "zod";
import { LEVER_IDS, type LeverId } from "@/core/extras";
import { shorten, tidyText } from "./text";

const Line = z.object({
  lever: z.enum(LEVER_IDS).describe("One of the levers given for this guest (or for the group), copied exactly"),
  steps: z.number().int().min(1).describe("How many times: 2 nights out fewer is 2 steps; 1 for a lever that has one step"),
  text: z.string().describe("One short, practical sentence, at most 140 characters, WITHOUT any amount of money: the app adds the euros"),
});

export const ExtraAdviceAnswerSchema = z.object({
  group: z.array(Line).describe("At most 3 lines for the whole group, or none"),
  guests: z
    .array(z.object({ code: z.string().describe("The guest's code, copied exactly"), lines: z.array(Line).describe("At most 3 lines for this guest") }))
    .describe("Only the guests whose status is tight or over"),
});

export type ExtraAdviceAnswer = z.infer<typeof ExtraAdviceAnswerSchema>;

/** A lever as the AI is shown it: how many steps it has and what one step saves */
export type OfferedLever = { lever: LeverId; maxSteps: number; savingPerStepEur: number; what: string };

export type ExtraAdviceFacts = {
  destination: { name: string; objective: string; budgetLevel: string; nights: number };
  guests: {
    code: string;
    name: string;
    budgetEur: number;
    transportAndHousingEur: number;
    extra: Record<string, number>;
    mandatoryEur: number;
    plusEur: number;
    totalEur: number;
    status: "comfy" | "tight" | "over";
    levers: OfferedLever[];
  }[];
  /** What the whole group could change together, the saving each */
  groupLevers: OfferedLever[];
};

export const extraAdviceHashOf = (facts: ExtraAdviceFacts) => createHash("sha256").update(JSON.stringify(facts)).digest("hex").slice(0, 24);

export function extraAdvicePrompt(facts: ExtraAdviceFacts): string {
  return `You are helping a group of friends fit what a trip costs them once there (food, getting around, going out, things to do: "the Extra") into each guest's budget. The app has worked out every amount; your job is to ADVISE, in a few short, practical lines, how to spend less where it matters. The advice is written once, now: the app shows it later without asking you again.

The facts give each guest's budget, what transport and housing already cost them, their Extra line by line (the Mandatory: food, the transfer, parking, the tourist tax; the Plus: what the trip is for), their total and their status: "comfy" (within 80 % of their budget), "tight" (above 80 %, or above the budget only because of the Plus) or "over" (the Mandatory alone takes them past their budget).

The levers are the only things you may advise: each guest's own ("levers"), and the group's ("groupLevers", saving each guest the amount shown). For every line:
- "lever": one of the levers given, copied exactly; "steps": how many of it, at most its "maxSteps", and exactly as many as the text says (leaving out two visits is 2 steps, and the text names two).
- "text": one sentence of at most 140 characters, without any amount of money (the app adds the exact euros), saying what to do in plain words, for this destination ("eat from the supermarket at lunch", "one club night instead of two").
- Group lines (at most 3): what the group could agree on, when it would help several guests (one big night out together rather than several, a cheaper day pass for all). None if nothing helps.
- Guest lines (at most 3 each): only for guests who are "tight" or "over", the levers that help them most first. A guest who cannot fit even with every lever: still give the most useful ones.
- Be kind and practical, never judge a guest. Refer to guests by their first name, never guess a gender. Write in English.

Facts (JSON):
${JSON.stringify(facts, null, 1)}`;
}

export type CheckedLine = { lever: LeverId; steps: number; text: string };

/** An amount of money written in a line: the AI's own euros are not shown */
const AMOUNT = /\d[\d.,]*\s*(?:€|eur(?:o|os)?\b)|€\s*\d/i;

/**
 * The lines of the answer that hold up: a lever that was offered (to that guest, or to the group), no more steps than it
 * has, a sentence without amounts of its own, at most 3 each. A guest not given or not tight or over gets none.
 */
export function checkExtraAdvice(answer: ExtraAdviceAnswer, facts: ExtraAdviceFacts): { group: CheckedLine[]; guests: Map<string, CheckedLine[]>; dropped: number } {
  let dropped = 0;
  const keep = (lines: ExtraAdviceAnswer["group"], offered: OfferedLever[]): CheckedLine[] => {
    const kept: CheckedLine[] = [];
    for (const line of lines) {
      const lever = offered.find((candidate) => candidate.lever === line.lever);
      const text = shorten(tidyText(line.text), 180);
      if (!lever || line.steps > lever.maxSteps || AMOUNT.test(text) || !text || kept.length >= 3 || kept.some((other) => other.lever === line.lever)) {
        dropped++;
        continue;
      }
      kept.push({ lever: line.lever, steps: line.steps, text });
    }
    return kept;
  };
  const guests = new Map<string, CheckedLine[]>();
  for (const entry of answer.guests) {
    const guest = facts.guests.find((candidate) => candidate.code === entry.code.trim());
    if (!guest || guest.status === "comfy" || guests.has(guest.code)) {
      dropped += entry.lines.length;
      continue;
    }
    guests.set(guest.code, keep(entry.lines, guest.levers));
  }
  return { group: keep(answer.group, facts.groupLevers), guests, dropped };
}
