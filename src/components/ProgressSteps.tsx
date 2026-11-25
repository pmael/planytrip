import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { estimateText, tookText } from "@/lib/durationText";
import type { ProgressStep } from "@/server/services/compute";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

const STATE_LABEL: Record<ProgressStep["state"], string> = {
  pending: "waiting",
  running: "in progress",
  done: "done",
  failed: "failed",
};

function StateIcon({ state }: { state: ProgressStep["state"] }) {
  if (state === "running") return <LoaderCircle aria-hidden className="size-5 animate-spin text-white" />;
  if (state === "done") {
    return (
      <span className="flex size-5 animate-[pop_0.5s_ease-out_both] items-center justify-center rounded-full bg-[#2ec48f] text-[#0d4a35]">
        <Check aria-hidden className="size-3.5 stroke-[3]" />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="flex size-5 animate-[pop_0.5s_ease-out_both] items-center justify-center rounded-full bg-rose-300 text-rose-950">
        <X aria-hidden className="size-3.5 stroke-[3]" />
      </span>
    );
  }
  return <span aria-hidden className="size-5 rounded-full border-2 border-white/30" />;
}

/** The time of a step: about how long it has left, or how long it took */
function timeOf(step: ProgressStep): { short: string; spoken: string } | null {
  if (step.state === "done" || step.state === "failed") {
    if (step.tookSeconds == null) return null;
    return { short: tookText(step.tookSeconds), spoken: `took ${tookText(step.tookSeconds)}` };
  }
  if (step.slow) return { short: "longer than usual", spoken: "taking longer than usual" };
  if (step.secondsLeft == null) return null;
  const text = estimateText(step.secondsLeft);
  return { short: text.startsWith("a ") ? text : `≈ ${text}`, spoken: `about ${text}${step.state === "running" ? " left" : ""}` };
}

/** "About 6 min left": the whole computation, above its steps. Nothing to say yet while the routes are checked. */
export function TimeLeft({ seconds, className }: { seconds: number | null; className?: string }) {
  const text = seconds === null ? "" : estimateText(seconds);
  return (
    <p className={cn("text-center text-xl text-white/80 tabular-nums", className)}>
      {seconds === null ? "Working out how long it will take…" : text.startsWith("a ") ? `A${text.slice(1)} left` : `About ${text} left`}
    </p>
  );
}

/**
 * What the computation is doing, one row per step and per source (the routes, each means of
 * transportation, the stays, the ratings), with how many of its searches are done and about how long it
 * has left, or how long it took. A step that failed says why when the reason is known.
 */
export function ProgressSteps({ steps, className }: { steps: ProgressStep[]; className?: string }) {
  return (
    <ul aria-label="Progress" className={cn("flex w-full max-w-[640px] flex-col gap-2.5", className)}>
      {steps.map((step) => {
        const time = timeOf(step);
        return (
          <li
            key={step.id}
            aria-label={`${step.label}: ${STATE_LABEL[step.state]}${time ? `, ${time.spoken}` : ""}`}
            className={cn(
              glassSurface,
              "flex min-h-12 animate-[fade-up_0.45s_cubic-bezier(0.22,1,0.36,1)_both] items-center gap-3 px-5 py-1.5 text-lg sm:gap-4 sm:px-6 shadow-none transition-[color,border-color,background-color] duration-500",
              "rounded-[24px]",
              step.state === "pending" && "border-white/10 bg-white/[0.06] text-white/45",
              step.state === "running" && "border-white/30 bg-white/[0.16] text-white",
              step.state === "done" && "border-emerald-300/30 text-white/80",
              step.state === "failed" && "border-rose-300/40 bg-rose-400/10 text-rose-100",
            )}
          >
            <StateIcon state={step.state} />
            <span className="min-w-0 flex-1">
              <span className="block leading-snug">{step.label}</span>
              {step.state === "failed" && step.error && (
                <span className="block truncate text-sm text-rose-200/80" title={step.error}>
                  {step.error}
                </span>
              )}
            </span>
            {step.total > 0 && (
              <span className="hidden text-base text-white/60 tabular-nums sm:block">
                {step.done}/{step.total}
              </span>
            )}
            {time && <span className={cn("text-right text-base whitespace-nowrap tabular-nums sm:min-w-[6.5rem]", step.slow ? "text-amber-200" : step.state === "running" ? "text-emerald-200" : "text-white/55")}>{time.short}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the person should know once the computation is done, such as "Not rated by the AI": the scores
 * would otherwise look like the AI's. The dashboard keeps saying it until it is put right.
 */
export function ProgressNotices({ notices, className }: { notices: string[]; className?: string }) {
  if (notices.length === 0) return null;
  return (
    <ul aria-label="Notices" className={cn("flex w-full max-w-[520px] flex-col gap-2", className)}>
      {notices.map((notice) => (
        <li
          key={notice}
          role="status"
          className="flex animate-[fade-up_0.45s_cubic-bezier(0.22,1,0.36,1)_both] items-start gap-3 rounded-[20px] border border-amber-200/40 bg-amber-300/15 px-4 py-2.5 text-sm text-amber-50"
        >
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-200" />
          <span className="min-w-0 break-words">{notice}</span>
        </li>
      ))}
    </ul>
  );
}
