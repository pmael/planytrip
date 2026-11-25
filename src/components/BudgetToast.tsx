"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { glassSurface } from "./GlassCard";
import { cn } from "@/lib/utils";

/**
 * A short message that fades by itself, for what a ❤ does to the budget (use-cases.md B-S9). `tone`
 * "warning" is for a guest pushed over budget, "error" for something that did not work.
 */
export function BudgetToast({
  message,
  tone = "warning",
  onDismiss,
}: {
  message: string;
  tone?: "warning" | "error";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        glassSurface,
        "fixed bottom-8 left-1/2 z-50 flex max-w-[min(640px,90vw)] animate-[fade-up_0.4s_ease-out_both] items-center gap-4 rounded-full px-8 py-4 text-xl text-white shadow-[0_8px_30px_rgb(0_0_0/0.35)]",
        tone === "warning" ? "border-amber-300/50 bg-[#7a6a3a]/90" : "border-rose-300/50 bg-[#7d5256]/90",
      )}
    >
      <TriangleAlert aria-hidden className="size-7 shrink-0 stroke-[1.5]" />
      <p>{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-2 cursor-pointer rounded-full px-3 text-2xl leading-none text-white/70 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
      >
        ×
      </button>
    </div>
  );
}
