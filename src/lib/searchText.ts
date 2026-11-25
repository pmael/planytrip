// How the app tells the person that a search failed: without it, "no flight found" looks like there is none.
import type { TransportMode } from "@/core/types";
import type { SearchProblem } from "@/server/services/compute";
import { listOf } from "./ratingText";

const WHAT: Record<TransportMode, string> = { plane: "flights", train: "trains", bus: "buses", car: "car routes" };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type SearchNotice = { title: string; text: string; detail: string | null; action: string };

/** What to tell the person about the searches that failed; null when none did. */
export function searchNoticeOf(problems: SearchProblem[]): SearchNotice | null {
  if (problems.length === 0) return null;

  const failed = problems.flatMap((problem) => (problem.kind === "not_searched" ? [] : [problem]));
  const parts = [
    ...new Set(failed.map((problem) => (problem.kind === "stays" ? `places to stay in ${problem.to}` : `${WHAT[problem.mode]} from ${problem.from} to ${problem.to}`))),
  ];
  const unsearched = [...new Set(problems.flatMap((problem) => (problem.kind === "not_searched" ? [problem.to] : [])))];

  const sentences = [
    ...(parts.length > 0
      ? [`${capitalise(listOf(parts))} could not be searched, so what is shown for ${parts.length === 1 ? "it" : "them"} may be missing: that is not the same as there being none.`]
      : []),
    ...(unsearched.length > 0 ? [`${listOf(unsearched)} ${unsearched.length === 1 ? "was" : "were"} added after the last search: nothing has been looked up for ${unsearched.length === 1 ? "it" : "them"} yet.`] : []),
  ];
  const count = parts.length + unsearched.length;
  return {
    title:
      parts.length > 0 && unsearched.length === 0
        ? count === 1 ? "A search did not work" : `${count} searches did not work`
        : unsearched.length > 0 && parts.length === 0
          ? unsearched.length === 1 ? "A destination has not been searched yet" : `${unsearched.length} destinations have not been searched yet`
          : "Some searches are missing",
    text: sentences.join(" "),
    detail: failed.find((problem) => problem.message)?.message ?? null,
    action: "Search again",
  };
}
