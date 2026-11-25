import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Wizard progress. `value` and `from` are between 0 and 1: on mount the fill grows
 * from `from` (where the previous step ended) to `value`, so moving between steps
 * reads as one continuous bar. The notches mark the `steps` stages of the wizard.
 * `done` makes the bar flash once, to say the wizard is finished. With `live`, the fill does not
 * play that growing animation: it follows `value` as it changes, for work that is really under way.
 */
export function ProgressBar({
  value,
  from = 0,
  steps = 4,
  durationMs = 1200,
  easing = "cubic-bezier(0.22, 1, 0.36, 1)",
  done = false,
  live = false,
  className,
}: {
  value: number;
  from?: number;
  steps?: number;
  /** How long the fill takes to grow from `from` to `value`. */
  durationMs?: number;
  easing?: string;
  done?: boolean;
  live?: boolean;
  className?: string;
}) {
  const percent = Math.min(Math.max(value, 0), 1) * 100;
  const fromPercent = Math.min(Math.max(from, 0), 1) * 100;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className={cn("relative h-3 w-full rounded-full", done && "animate-[bar-flash_1.1s_ease-out_2]", className)}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full bg-white">
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-full bg-[#2ec48f] shadow-[0_0_14px_rgb(46_196_143/0.8)]",
            live ? "transition-[width] duration-700 ease-out" : "animate-[progress-fill_1s_both]",
          )}
          style={
            live
              ? { width: `${percent}%` }
              : ({
                  width: `${percent}%`,
                  "--progress-from": `${fromPercent}%`,
                  animationDuration: `${durationMs}ms`,
                  animationTimingFunction: easing,
                } as CSSProperties)
          }
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-1/4 animate-[progress-shimmer_2.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/70 to-transparent",
              done && "[animation-duration:1.1s]",
            )}
          />
        </div>
        {Array.from({ length: steps - 1 }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#0d4a35]/25"
            style={{ left: `${((i + 1) / steps) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
