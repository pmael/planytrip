"use client";

import { Popover } from "@base-ui/react/popover";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatEur } from "@/lib/form";
import { tripPath } from "@/lib/trip";
import { cn } from "@/lib/utils";
import { glassSurface } from "./GlassCard";

/**
 * "Validate this destination" (use-cases.md C.1 step 6): asks for a confirmation, then freezes the
 * scenario as a summary and opens it. It says what is being frozen and what is wrong with it, if
 * anything, because a destination that does not work for everyone can still be chosen. When the
 * group already validated this destination, it links to the summary instead.
 */
export function ValidateButton({
  tripId,
  destinationId,
  destinationName,
  totalEur,
  perGuestEur,
  problems,
  validatedSummaryId,
  className,
}: {
  tripId: string;
  destinationId: string;
  destinationName: string;
  totalEur: number;
  perGuestEur: number;
  /** What keeps it from working for everyone, written out ("Jessy +90 €"); empty when nothing does */
  problems: string[];
  /** The summary of this destination, when it was validated already */
  validatedSummaryId: string | null;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pill =
    "flex h-[60px] cursor-pointer items-center gap-3 rounded-full border px-6 text-xl whitespace-nowrap text-white outline-none transition-[background-color,box-shadow,transform] duration-300 focus-visible:ring-2 focus-visible:ring-emerald-200/70 active:scale-[0.97] [&_svg]:size-6 [&_svg]:shrink-0 [&_svg]:stroke-[1.5]";

  if (validatedSummaryId) {
    return (
      <Link
        href={`${tripPath(tripId, "/summary")}?id=${validatedSummaryId}`}
        className={cn(pill, "border-emerald-200/60 bg-[#3f7a62]/85 shadow-[0_0_22px_rgb(46_196_143/0.4)] hover:bg-[#4a8a70]", className)}
      >
        <BadgeCheck aria-hidden />
        Validated: view the summary
      </Link>
    );
  }

  async function validate() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/trips/${tripId}/summaries`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationId }),
      });
      if (!response.ok) throw new Error(`Summaries answered ${response.status}`);
      const summary: { id: string } = await response.json();
      router.push(`${tripPath(tripId, "/summary")}?id=${summary.id}`);
    } catch {
      setError("Couldn’t validate, please try again.");
      setBusy(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn(pill, "border-white/30 bg-white/[0.14] hover:bg-white/25", className)}>
        <BadgeCheck aria-hidden />
        Validate
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={12} align="end" className="z-50">
          <Popover.Popup
            className={cn(
              glassSurface,
              "w-[min(440px,92vw)] origin-top-right rounded-[32px] bg-[#5a5a5a]/95 p-7 text-white outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
            )}
          >
            <Popover.Title className="text-2xl font-normal">Validate {destinationName}?</Popover.Title>
            <p className="mt-2 text-lg text-white/80">
              {formatEur(totalEur)} in total, {formatEur(perGuestEur)} per guest. This freezes the offers, the prices and what each guest pays into a summary you can keep and share.
            </p>
            {problems.length > 0 && (
              <div role="note" className="mt-4 flex gap-3 rounded-[18px] bg-amber-300/15 px-4 py-3 text-base text-amber-50">
                <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 stroke-[1.6]" />
                <p>It doesn&rsquo;t work for everyone yet: {problems.join(", ")}. You can still validate it, and the summary will say so.</p>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 text-base text-rose-200">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setOpen(false)} className="h-[50px] cursor-pointer rounded-full border border-white/25 bg-white/[0.12] px-6 text-lg outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-emerald-300/60">
                Cancel
              </button>
              <button
                type="button"
                onClick={validate}
                disabled={busy}
                className="h-[50px] cursor-pointer rounded-full border border-emerald-200/50 bg-[#3f7a62]/90 px-7 text-lg outline-none transition-colors hover:bg-[#4a8a70] focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? "Validating…" : "Validate"}
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
